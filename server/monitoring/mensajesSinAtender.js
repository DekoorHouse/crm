/**
 * Detector de conversaciones sin respuesta: la red de seguridad genérica.
 *
 * POR QUÉ EXISTE
 * El webhook ya pide reintento cuando algo truena antes de guardar (ver debeReintentar en
 * whatsappHandler.js), pero queda un hueco: si el mensaje SÍ se guardó y la falla ocurre
 * DESPUÉS —al actualizar el contacto, al pedirle la respuesta a la IA— el reintento de Meta
 * choca con el chequeo de duplicados y contesta 200 sin reprocesar. Resultado: el mensaje
 * aparece en el chat pero Andrea nunca lo contesta, y nadie se entera.
 *
 * Este barrido no intenta adivinar la causa: mira el síntoma, que es el mismo para cualquier
 * falla imaginada o no. Por eso cubre huecos que todavía no conocemos.
 *
 * CÓMO DECIDE (en dos fases, para no gritar en falso)
 * FASE 1 — barata, sobre el contacto. Trae dos marcas de tiempo: lastClientMsgAt (último mensaje
 * DEL CLIENTE) y lastMessageTimestamp (último de la conversación, entre o salga). Cualquier envío
 * —IA, bienvenida, humano, plantilla— bumpea lastMessageTimestamp, así que
 * `lastMessageTimestamp <= lastClientMsgAt` deja como CANDIDATO a todo aquel donde después del
 * cliente parece no haber salido nada. Una sola consulta indexada para todo el CRM.
 *
 * FASE 2 — se leen los últimos mensajes de cada candidato (son pocos) y se confirma si de verdad
 * no hubo saliente. Hace falta porque la fase 1 sola miente en un caso real: los mensajes que
 * entran traen la hora de WhatsApp con precisión de SEGUNDO, y cuando la IA contesta el mensaje
 * anterior en ese mismo segundo, ambas marcas quedan idénticas y el contacto parece sin responder
 * aunque acabe de recibir respuesta. Sin la fase 2, el aviso trae basura — y un aviso con basura
 * se ignora, que es la única forma en que esta red de seguridad puede fallar de verdad.
 *
 * Sirve para WhatsApp, Messenger e Instagram: los tres escriben esos campos en contacts_whatsapp
 * y marcan lo entrante con status 'received'.
 *
 * Se reportan aparte los dos casos, porque no son el mismo problema:
 *  - botActive true  → la IA debía contestar y no contestó. Falla del sistema. Se listan.
 *  - botActive false → alguien la apagó y toca a un humano. El webhook ya los marca con
 *    needsAttention 'ai_off' y salen en el tablero; aquí solo se cuentan, para no gritar por
 *    un pendiente humano normal.
 *
 * Variables de entorno:
 *  - SIN_ATENDER_GRACIA_MIN  (default 25; debe superar los 10 min que la IA espera cuando está
 *                             recibiendo datos de envío, o cada cliente en ese paso sería falsa alarma)
 *  - SIN_ATENDER_VENTANA_H   (default 6)
 *  - SIN_ATENDER_CRON        (default cada 15 min)
 *  - SIN_ATENDER_TEMPLATE    (opcional; plantilla aprobada, 2 variables)
 *  - SIN_ATENDER_ENABLED     ('false' lo apaga)
 *  - ALERTA_OPS_PHONE        (compartida con el watchdog)
 */
const cron = require('node-cron');
const { db, admin } = require('../config');
const { enviarAlertaWhatsApp } = require('./alertaWhatsApp');

const GRACIA_MIN = Number(process.env.SIN_ATENDER_GRACIA_MIN || 25);
const VENTANA_H = Number(process.env.SIN_ATENDER_VENTANA_H || 6);
const ALERT_TEMPLATE = process.env.SIN_ATENDER_TEMPLATE || '';
const ENABLED = String(process.env.SIN_ATENDER_ENABLED || 'true').toLowerCase() !== 'false';
const RAW_CRON = process.env.SIN_ATENDER_CRON || '*/15 * * * *';
const CRON_SCHEDULE = cron.validate(RAW_CRON) ? RAW_CRON : '*/15 * * * *';
if (CRON_SCHEDULE !== RAW_CRON) {
    console.warn(`[SIN-ATENDER] SIN_ATENDER_CRON inválido ("${RAW_CRON}"); usando "*/15 * * * *"`);
}

const TIMEZONE = 'America/Mexico_City';
const STATE_DOC = 'mensajes_sin_atender';
const MAX_EN_MENSAJE = 8;   // cuántos nombres caben en el WhatsApp sin volverlo ilegible
const MAX_A_MARCAR = 50;    // tope de escrituras por barrido (tras una caída pueden ser cientos)
const MAX_A_CONFIRMAR = 200; // tope de candidatos a verificar en fase 2 (protege de un barrido carísimo)
const ULTIMOS_MENSAJES = 8;  // cuántos mensajes recientes basta mirar para hallar un saliente

let scheduledTask = null;
let barridoEnCurso = false;

const aMillis = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;

function horaMx(ms) {
    return new Date(ms).toLocaleString('es-MX', { timeZone: TIMEZONE, hour12: true });
}

function minutosDesde(ms) {
    return Math.round((Date.now() - ms) / 60000);
}

/**
 * Fase 2: ¿salió algo DESPUÉS (o en el mismo segundo) del último mensaje del cliente?
 * Todo lo entrante se guarda con status 'received' en los tres canales; cualquier otro status
 * es un envío nuestro. Ante un error de lectura devuelve true (o sea, "ya le contestaron"):
 * más vale callar un caso que inventar una alarma con datos que no se pudieron confirmar.
 */
async function yaLeRespondieron(contactoId, clienteMs) {
    try {
        const snap = await db.collection('contacts_whatsapp').doc(contactoId)
            .collection('messages').orderBy('timestamp', 'desc').limit(ULTIMOS_MENSAJES).get();
        return snap.docs.some(d => {
            const m = d.data();
            return m.status !== 'received' && aMillis(m.timestamp) >= clienteMs;
        });
    } catch (e) {
        console.warn(`[SIN-ATENDER] No se pudieron leer los mensajes de ${contactoId} (${e.message}); se omite.`);
        return true;
    }
}

/**
 * Un barrido. `dryRun` reporta sin avisar, sin marcar y sin tocar el estado anti-spam.
 * Nunca lanza: es una red de seguridad, no puede ser ella la que tumbe el proceso.
 */
async function runBarridoSinAtender({ dryRun = false, force = false } = {}) {
    if (barridoEnCurso) return { saltado: 'barrido_en_curso' };
    barridoEnCurso = true;
    try {
        const ahora = Date.now();
        const desde = admin.firestore.Timestamp.fromMillis(ahora - VENTANA_H * 60 * 60 * 1000);
        const hasta = admin.firestore.Timestamp.fromMillis(ahora - GRACIA_MIN * 60 * 1000);

        // Desigualdad sobre un solo campo: le basta el índice de campo simple que Firestore crea
        // solo. No hace falta tocar firestore.indexes.json.
        const snap = await db.collection('contacts_whatsapp')
            .where('lastClientMsgAt', '>=', desde)
            .where('lastClientMsgAt', '<=', hasta)
            .get();

        // --- Fase 1: candidatos, sin leer un solo mensaje ---
        const candidatos = [];
        let conIaApagada = 0;
        for (const doc of snap.docs) {
            const c = doc.data();
            const clienteMs = aMillis(c.lastClientMsgAt);
            const ultimoMs = aMillis(c.lastMessageTimestamp);
            if (!clienteMs || ultimoMs > clienteMs) continue; // salió algo después: contestado
            if (c.botActive === true) {
                candidatos.push({
                    id: doc.id,
                    nombre: c.name || doc.id,
                    clienteMs,
                    texto: (c.lastMessage || '').slice(0, 60)
                });
            } else {
                conIaApagada++;
            }
        }
        candidatos.sort((a, b) => a.clienteMs - b.clienteMs); // el más viejo primero

        // --- Fase 2: confirmar contra los mensajes reales ---
        const aConfirmar = candidatos.slice(0, MAX_A_CONFIRMAR);
        if (candidatos.length > MAX_A_CONFIRMAR) {
            console.warn(`[SIN-ATENDER] ${candidatos.length} candidatos; solo se confirman los ${MAX_A_CONFIRMAR} más viejos.`);
        }
        const confirmaciones = await Promise.all(
            aConfirmar.map(c => yaLeRespondieron(c.id, c.clienteMs))
        );
        const iaDebioContestar = aConfirmar.filter((_, i) => !confirmaciones[i]);
        const descartadosEnFase2 = aConfirmar.length - iaDebioContestar.length;

        // Anti-spam: se avisa una vez por mensaje sin responder. Si el cliente vuelve a escribir
        // (cambia lastClientMsgAt) y sigue sin respuesta, eso sí es un aviso nuevo.
        const stateRef = db.collection('crm_settings').doc(STATE_DOC);
        const stateSnap = await stateRef.get();
        const reportados = (stateSnap.exists && stateSnap.data().reportados) || {};
        const nuevos = force
            ? iaDebioContestar
            : iaDebioContestar.filter(c => reportados[c.id] !== c.clienteMs);

        const resultado = {
            dryRun,
            force,
            revisados: snap.size,
            candidatosFase1: candidatos.length,
            descartadosEnFase2,
            sinRespuesta: iaDebioContestar.length,
            nuevos: nuevos.length,
            conIaApagada,
            ventana: `${GRACIA_MIN} min a ${VENTANA_H} h`,
            contactos: nuevos.map(c => ({ id: c.id, nombre: c.nombre, minutos: minutosDesde(c.clienteMs) }))
        };

        if (dryRun || !nuevos.length) {
            if (!dryRun && !nuevos.length) {
                console.log(`[SIN-ATENDER] OK — ${snap.size} conversaciones revisadas, ninguna nueva sin respuesta.`);
            }
            return resultado;
        }

        // Marcar en el CRM para que además salgan en el tablero de Pendientes, no solo en el
        // WhatsApp de aviso. Tope de escrituras por barrido; si se recorta, queda dicho.
        const aMarcar = nuevos.slice(0, MAX_A_MARCAR);
        if (nuevos.length > MAX_A_MARCAR) {
            console.warn(`[SIN-ATENDER] ${nuevos.length} sin respuesta; solo se marcan ${MAX_A_MARCAR} en el CRM (el aviso sí reporta el total).`);
        }
        await Promise.all(aMarcar.map(c =>
            db.collection('contacts_whatsapp').doc(c.id).update({
                needsAttention: true,
                needsAttentionReason: 'sin_respuesta',
                needsAttentionAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.warn(`[SIN-ATENDER] No se pudo marcar ${c.id}:`, e.message))
        ));

        const lista = nuevos.slice(0, MAX_EN_MENSAJE)
            .map(c => `• ${c.nombre} — hace ${minutosDesde(c.clienteMs)} min${c.texto ? `\n   _"${c.texto}"_` : ''}`)
            .join('\n');
        const texto = [
            `⚠️ *${nuevos.length} ${nuevos.length === 1 ? 'conversación' : 'conversaciones'} sin respuesta*`,
            '',
            `Con la IA encendida y sin que saliera nada después del mensaje del cliente (más de ${GRACIA_MIN} min).`,
            '',
            lista,
            nuevos.length > MAX_EN_MENSAJE ? `\n…y ${nuevos.length - MAX_EN_MENSAJE} más.` : '',
            '',
            'Ya quedaron marcadas como "Atender" en el CRM.',
            conIaApagada ? `\n(Aparte hay ${conIaApagada} con la IA apagada esperando a un humano.)` : ''
        ].filter(Boolean).join('\n');

        let via = null;
        try {
            const r = await enviarAlertaWhatsApp({
                texto,
                params: [horaMx(ahora), `${nuevos.length} conversaciones sin respuesta hace más de ${GRACIA_MIN} min`],
                plantilla: ALERT_TEMPLATE
            });
            via = r.via;
            console.warn(`[SIN-ATENDER] ⚠️ ${nuevos.length} sin respuesta. Aviso enviado a ${r.telefono} vía ${via}.`);
        } catch (e) {
            console.error('[SIN-ATENDER] No se pudo enviar el aviso:', e.message);
        }

        // El estado se guarda aunque el envío falle: ya quedaron marcadas en el CRM y el error
        // quedó en los logs. Reintentar el mismo aviso cada 15 min no aporta nada nuevo.
        const nuevoEstado = {};
        for (const c of iaDebioContestar) nuevoEstado[c.id] = c.clienteMs;
        // Conservar solo lo que sigue dentro de la ventana: si no, el documento crece sin fin.
        const corte = ahora - VENTANA_H * 60 * 60 * 1000;
        for (const [id, ms] of Object.entries(reportados)) {
            if (typeof ms === 'number' && ms >= corte && !(id in nuevoEstado)) nuevoEstado[id] = ms;
        }
        await stateRef.set({
            reportados: nuevoEstado,
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            ultimoAviso: { at: new Date(ahora).toISOString(), cuantos: nuevos.length, via }
        }, { merge: true });

        return { ...resultado, via, marcados: aMarcar.length };
    } catch (err) {
        console.error('[SIN-ATENDER] Error en el barrido:', err.message);
        return { error: err.message };
    } finally {
        barridoEnCurso = false;
    }
}

function startMensajesSinAtenderScheduler() {
    if (!ENABLED) {
        console.log('[SIN-ATENDER] Deshabilitado por SIN_ATENDER_ENABLED=false');
        return;
    }
    if (scheduledTask) {
        console.log('[SIN-ATENDER] Scheduler ya iniciado');
        return;
    }
    console.log(`[SIN-ATENDER] Scheduler iniciado. Cron: "${CRON_SCHEDULE}". Gracia: ${GRACIA_MIN} min. Ventana: ${VENTANA_H} h.`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runBarridoSinAtender().catch(e => console.error('[SIN-ATENDER] Error en barrido:', e.message));
    }, { timezone: TIMEZONE });
}

module.exports = { startMensajesSinAtenderScheduler, runBarridoSinAtender };
