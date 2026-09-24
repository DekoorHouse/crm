'use strict';

// GPU rentada en RunPod para Qwen Image 2.1. El CRM crea el pod antes del horario de trabajo y lo termina
// al salir: el disco del pod es temporal, así que cada mañana qwenPodBootstrap.sh instala todo desde cero
// (~10 min). Fuera de horario se puede encender a mano; se apaga solo tras un rato sin usarse.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const fetch = require('node-fetch');
const { db } = require('../config');

const API = 'https://rest.runpod.io/v1';
const TIMEZONE = 'America/Mexico_City';
// Horario "9-17" y días en formato cron ("1-5" = lunes a viernes). Se enciende 15 min antes para estar lista a la hora.
const HOURS = (process.env.QWEN_POD_HOURS || '9-17').split('-').map(Number);
const DAYS = process.env.QWEN_POD_DAYS || '1-5';
const IDLE_MS = 45 * 60 * 1000;
const BOOT_LIMIT_MS = 40 * 60 * 1000;
// Versiones con las que se probó Qwen Image 2.1 el 24-sep-2026.
const COMFY_COMMIT = '93810483a4739a1588236919a3128d3070244146';
const TORCH_VERSION = '2.11.0';
const GPU_TYPES = ['NVIDIA GeForce RTX 4090', 'NVIDIA GeForce RTX 5090', 'NVIDIA RTX PRO 4500 Blackwell', 'NVIDIA L40S', 'NVIDIA RTX 6000 Ada Generation', 'NVIDIA RTX A6000'];
const stateRef = () => db.collection('crm_settings').doc('qwen_pod');
let bootstrapScript;
let healthCache = { at: 0 };
let scheduled = false;

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function enabled() { return !!process.env.RUNPOD_API_KEY; }
// El token del proxy se deriva de la llave de RunPod y un nonce por pod: en Firestore, que el equipo puede leer, solo queda el nonce.
function podToken(nonce) { return crypto.createHmac('sha256', process.env.RUNPOD_API_KEY).update(`qwen-pod:${nonce}`).digest('hex'); }
function podUrl(podId) { return `https://${podId}-3000.proxy.runpod.net`; }
function scheduleLabel() { return `${DAYS === '1-5' ? 'L–V' : DAYS === '1-6' ? 'L–S' : `días ${DAYS}`} ${HOURS[0]}:00–${HOURS[1]}:00`; }

function inSchedule(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
        .formatToParts(now).map(part => [part.type, part.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const days = DAYS.split(',').flatMap(range => { const [a, b = a] = range.split('-').map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); });
    const hour = Number(parts.hour);
    return days.includes(day) && hour >= HOURS[0] && hour < HOURS[1];
}

async function runpod(method, pathname, body) {
    const response = await fetch(`${API}${pathname}`, {
        method, timeout: 30000,
        headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw Object.assign(failure(`RunPod respondió ${response.status}: ${text.slice(0, 200)}`, 502), { runpodStatus: response.status });
    return text ? JSON.parse(text) : null;
}

async function startPod(reason) {
    if (!enabled()) throw failure('Falta RUNPOD_API_KEY en el servidor.', 503);
    const claimed = await db.runTransaction(async tx => {
        const data = (await tx.get(stateRef())).data() || {};
        if (data.podId || (data.status === 'creating' && Date.now() - Date.parse(data.updatedAt) < 5 * 60 * 1000)) return false;
        tx.set(stateRef(), { status: 'creating', reason, updatedAt: new Date().toISOString(), lastError: null }, { merge: true });
        return true;
    });
    if (!claimed) return getStatus();
    bootstrapScript ||= fs.readFileSync(path.join(__dirname, 'qwenPodBootstrap.sh'), 'utf8').replace(/\r\n/g, '\n');
    const nonce = crypto.randomUUID();
    try {
        const pod = await runpod('POST', '/pods', {
            name: 'dekoor-qwen-image', imageName: 'runpod/stable-diffusion:comfy-ui-6.0.0',
            gpuTypeIds: GPU_TYPES, gpuTypePriority: 'custom', allowedCudaVersions: ['13.0', '12.9', '12.8'],
            containerDiskInGb: 80, volumeInGb: 0, ports: ['3000/http'],
            dockerEntrypoint: ['bash', '-c'], dockerStartCmd: [bootstrapScript],
            env: { COMFY_COMMIT, TORCH_VERSION, DEKOOR_TOKEN: podToken(nonce) },
        });
        const now = new Date().toISOString();
        await stateRef().set({ podId: pod.id, nonce, status: 'starting', costPerHr: pod.costPerHr ?? null, gpu: pod.gpu?.displayName || null, createdAt: now, lastUsedAt: now, updatedAt: now }, { merge: true });
        console.log(`[QWEN] Pod ${pod.id} creado (${reason}).`);
    } catch (err) {
        const message = err.runpodStatus ? 'RunPod no tiene una GPU disponible ahora o rechazó la solicitud. Intenta en unos minutos.' : 'No se pudo encender la GPU.';
        console.warn('[QWEN] No se pudo crear el pod:', err.message);
        await stateRef().set({ status: 'off', lastError: message, updatedAt: new Date().toISOString() }, { merge: true });
        throw failure(message, 502);
    }
    healthCache = { at: 0 };
    return getStatus();
}

async function stopPod(reason) {
    const data = (await stateRef().get()).data() || {};
    if (data.podId) {
        try { await runpod('DELETE', `/pods/${data.podId}`); }
        catch (err) { if (![400, 404].includes(err.runpodStatus)) throw err; }
        console.log(`[QWEN] Pod ${data.podId} terminado (${reason}).`);
    }
    await stateRef().set({ podId: null, nonce: null, status: 'off', updatedAt: new Date().toISOString() }, { merge: true });
    healthCache = { at: 0 };
}

async function health(podId, nonce) {
    if (healthCache.podId === podId && Date.now() - healthCache.at < 8000) return healthCache.value;
    let value;
    try {
        const response = await fetch(`${podUrl(podId)}/dekoor/health`, { timeout: 8000, headers: { 'X-Dekoor-Token': podToken(nonce) } });
        value = response.ok ? await response.json() : { ready: false, stage: 'encendiendo la máquina' };
    } catch (_) { value = { ready: false, stage: 'encendiendo la máquina' }; }
    healthCache = { podId, at: Date.now(), value };
    return value;
}

async function getStatus() {
    const base = { enabled: enabled(), schedule: scheduleLabel(), inSchedule: inSchedule() };
    if (!enabled()) return { ...base, status: 'off', message: 'Falta conectar RunPod en el servidor.' };
    const data = (await stateRef().get()).data() || {};
    if (data.status === 'creating' && Date.now() - Date.parse(data.updatedAt) < 5 * 60 * 1000) return { ...base, status: 'starting', message: 'Pidiendo una GPU a RunPod…' };
    if (!data.podId) return { ...base, status: 'off', message: data.lastError || `GPU apagada · se enciende ${scheduleLabel()}`, error: !!data.lastError };
    const info = { ...base, gpu: data.gpu, costPerHr: data.costPerHr, since: data.createdAt };
    const { ready, stage } = await health(data.podId, data.nonce);
    if (ready) {
        if (data.status !== 'ready') await stateRef().set({ status: 'ready', readyAt: new Date().toISOString() }, { merge: true });
        return { ...info, status: 'ready', message: 'GPU encendida y lista' };
    }
    if (stage?.startsWith('error')) return { ...info, status: 'error', message: `La GPU no pudo prepararse (${stage.slice(7)}).`, error: true };
    return { ...info, status: 'starting', message: `Encendiendo la GPU: ${stage || 'preparando'}…` };
}

// Llamada a ComfyUI a través del proxy del pod. Solo se usa con el pod listo.
async function comfy(pathname, options = {}) {
    const data = (await stateRef().get()).data() || {};
    if (!data.podId) throw failure('La GPU de Qwen está apagada.', 503);
    const response = await fetch(`${podUrl(data.podId)}${pathname}`, {
        timeout: 60000, ...options, headers: { ...options.headers, 'X-Dekoor-Token': podToken(data.nonce) },
    });
    if (response.status === 401) throw failure('El pod de Qwen rechazó la conexión del CRM.', 502);
    return response;
}

async function markUsed() { await stateRef().set({ lastUsedAt: new Date().toISOString() }, { merge: true }).catch(() => {}); }

// Revisión periódica: apaga pods olvidados fuera de horario, los que no pudieron arrancar y limpia pods que ya no existen.
async function reconcile() {
    const data = (await stateRef().get()).data() || {};
    if (!data.podId) return;
    let pod = null;
    try { pod = await runpod('GET', `/pods/${data.podId}`); }
    catch (err) { if (![400, 404].includes(err.runpodStatus)) throw err; }
    if (!pod || pod.desiredStatus === 'TERMINATED' || pod.desiredStatus === 'EXITED') return stopPod('el pod ya no estaba activo');
    if (!inSchedule() && Date.now() - Date.parse(data.lastUsedAt || data.createdAt) > IDLE_MS) return stopPod('fuera de horario y sin uso');
    const { stage } = data.status === 'ready' ? {} : await health(data.podId, data.nonce);
    if (stage?.startsWith('error')) {
        await stopPod(stage);
        await stateRef().set({ lastError: `La GPU no pudo prepararse (${stage.slice(7)}) y se apagó. Intenta encenderla de nuevo.` }, { merge: true });
    } else if (data.status !== 'ready' && Date.now() - Date.parse(data.createdAt) > BOOT_LIMIT_MS) {
        await stopPod('no terminó de prepararse');
        await stateRef().set({ lastError: 'La GPU no terminó de prepararse y se apagó. Intenta encenderla de nuevo.' }, { merge: true });
    }
}

function startQwenPodScheduler() {
    if (scheduled || !enabled()) return;
    scheduled = true;
    const log = label => err => console.error(`[QWEN] Error al ${label}:`, err.message);
    cron.schedule(`45 ${HOURS[0] - 1} * * ${DAYS}`, () => startPod('horario').catch(log('encender')), { timezone: TIMEZONE });
    cron.schedule(`0 ${HOURS[1]} * * ${DAYS}`, () => stopPod('fin del horario').catch(log('apagar')), { timezone: TIMEZONE });
    cron.schedule('*/10 * * * *', () => reconcile().catch(log('revisar')), { timezone: TIMEZONE });
    console.log(`[QWEN] Scheduler iniciado: GPU ${scheduleLabel()} (${TIMEZONE}).`);
}

module.exports = { enabled, getStatus, startPod, stopPod, comfy, markUsed, reconcile, inSchedule, startQwenPodScheduler };
