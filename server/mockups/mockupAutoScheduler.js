/**
 * Auto-generación de mockups (previews de lámpara).
 *
 * Cada 10 min genera SOLO (no envía) previews para pedidos "Sin estatus" que:
 *   - Sean de la plantilla de CORAZONES.
 *   - Traigan SOLO nombres + fecha (sin cosas especiales: fotos, grabados, logo…).
 *   - No tengan ya un preview generado.
 * El preview queda en la sección Mockup para que el operador lo revise y envíe.
 *
 * Si Gemini se queda sin cuota/facturación, avisa por WhatsApp al ADMIN_ALERT_PHONE (dedupe 6h).
 * Se puede apagar con mockup_config/settings.autoGenerate = false.
 */
const cron = require('node-cron');
const { db } = require('../config');
const svc = require('./mockupsService');

const CRON_SCHEDULE = process.env.MOCKUP_AUTO_CRON || '*/10 * * * *';   // cada 10 min
const BATCH = parseInt(process.env.MOCKUP_AUTO_BATCH || '4', 10);       // máx por corrida automática (costo/tiempo)
const FORCE_BATCH = parseInt(process.env.MOCKUP_AUTO_FORCE_BATCH || '25', 10); // máx en corrida MANUAL ("Generar ahora")
const ADMIN_PHONE = process.env.ADMIN_ALERT_PHONE || '5216182297167';

// Errores de Gemini que significan "no hay con qué generar" (cuota agotada, facturación
// caída o llave inválida): no tiene caso seguir con el resto del lote, mejor avisar.
const NO_QUOTA_RE = /quota|RESOURCE_EXHAUSTED|billing|API[ _]key|PERMISSION_DENIED|error 4(01|03|29)/i;

// Palabras que indican "algo especial" -> NO auto-generar (queda para revisión manual).
const SPECIAL_RE = /foto|imagen|graba|logo|escudo|especial|personaje|mascota|dibuj|dise[nñ]|frase|leyenda|adicional|s[ií]mbolo|\bpng\b|\bjpg\b/i;

let running = false;
let task = null;

function datosOf(o) {
    return (Array.isArray(o.items) ? o.items : []).map(it => it.datosProducto).filter(Boolean).join('\n')
        || o.datosProducto || o.producto || '';
}
function productOf(o) {
    return String(o.producto || (o.items && o.items[0] && o.items[0].producto) || '').toLowerCase();
}
function isCorazones(o, tpl) {
    const prod = productOf(o);
    if (/corazon/i.test(prod)) return true;
    return (tpl.productMatch || []).some(m => m && prod.includes(String(m).toLowerCase()));
}

async function getConfig() {
    try {
        const d = await db.collection('mockup_config').doc('settings').get();
        return d.exists ? d.data() : {};
    } catch (_) { return {}; }
}

async function alertNoBalance() {
    const cfg = await getConfig();
    const last = cfg.lastBalanceAlert ? Date.parse(cfg.lastBalanceAlert) : 0;
    if (Date.now() - last < 6 * 3600 * 1000) return;   // dedupe: máx 1 aviso cada 6h
    try {
        const { sendAdvancedWhatsAppMessage } = require('../services');
        await sendAdvancedWhatsAppMessage(ADMIN_PHONE, {
            text: '⚠️ Mockup automático: Gemini no está generando imágenes (cuota agotada o problema de facturación). Revisa la cuenta de Google AI Studio para seguir generando previews de lámparas.',
        });
        await db.collection('mockup_config').doc('settings').set({ lastBalanceAlert: new Date().toISOString() }, { merge: true });
        console.log('[mockup-auto] ⚠️ Aviso de cuota enviado a', ADMIN_PHONE);
    } catch (e) { console.error('[mockup-auto] no se pudo avisar de la cuota:', e.message); }
}

// Genera un preview y lo guarda como preview del pedido. Devuelve true | false | 'no-balance'.
async function generateOne(o, tpl, cfg = {}) {
    try {
        const parsed = svc.parseDatos(datosOf(o));
        if (!parsed.nombre1) return false;   // sin nombre, no
        let fields = { nombre1: parsed.nombre1, nombre2: parsed.nombre2, fecha: parsed.fecha, personalizacion: datosOf(o) };
        // Regla de renglones: nombres compuestos con '\n' decidido por nosotros (el prompt le
        // ordena el salto a la IA y el diseño de corte reproduce el mismo layout).
        if (cfg.nameLayoutRule !== false) fields = require('./nameLayout').applyNameLayout(fields);
        let prompt = svc.buildPromptFromTemplate(tpl.promptTemplate, fields);
        if (!prompt) return false;

        // Referencia (1) = la foto base. Referencia (2) = el "diseño a grabar" renderizado en el
        // SERVIDOR (@resvg + fuente manuscrita), para que la IA grabe EXACTAMENTE ese diseño
        // (nombres/fecha/símbolo), igual que el camino manual. Si falla o la plantilla no tiene
        // diseño, se genera sin ella. El PNG recién renderizado se le pasa a Gemini tal cual, pero
        // igual se sube a Storage porque su URL se guarda en el preview y la usa el diseño de corte.
        const refs = [await svc.fetchImageAsBase64(tpl.baseImageUrl)];
        let secondRefUrl = null;
        try {
            const rr = require('./refRenderer');
            const refPng = await rr.renderReferenceForTemplate(tpl, fields);
            if (refPng) {
                secondRefUrl = (await svc.uploadPublicImage(refPng, 'refs-auto')).url;
                refs.push({ mimeType: 'image/png', base64: refPng.toString('base64') });
                prompt += rr.SECOND_REF_PROMPT;
            }
        } catch (e) { console.warn('[mockup-auto] referencia falló (sigo sin ella):', e.message); }

        const aspectRatio = tpl.aspectRatio || '1:1';
        let result;
        try {
            result = await svc.generateImage(prompt, aspectRatio, refs, '2K');
        } catch (e) {
            // Sin cuota -> corta el lote y avisa. Cualquier otro error (p. ej. el modelo se negó
            // a generar este diseño) lo atrapa el catch de abajo y sigue con el siguiente pedido.
            if (NO_QUOTA_RE.test(e.message)) return 'no-balance';
            throw e;
        }

        const saved = await svc.saveToGallery(prompt, aspectRatio, result.images, result.usage, result.cost);
        const blockId = 'auto' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await db.collection('mockup_previews').doc(String(o.id)).set({
            orderId: String(o.id),
            previews: [{ blockId, imageUrl: saved[0].fullUrl, templateId: tpl.id, fields, secondRefUrl, createdAt: new Date().toISOString() }],
        }, { merge: true });
        // Verificar por visión cómo quedaron los textos (renglones) y guardarlo en el preview.
        await svc.verifyAndStoreLayout(String(o.id), blockId);
        // Sello: momento en que el preview quedó LISTO para revisión (mide el SLA del
        // piloto preview en pedidos A, y es útil como métrica general). Best-effort.
        try {
            const { admin } = require('../config');
            await db.collection('pedidos').doc(String(o.id)).update({ mockupListoAt: admin.firestore.FieldValue.serverTimestamp() });
        } catch (e) { console.warn('[mockup-auto] no se pudo sellar mockupListoAt:', e.message); }
        console.log('[mockup-auto] ✓ generado DH' + (o.consecutiveOrderNumber || '?'));
        return true;
    } catch (e) {
        console.error('[mockup-auto] falló DH' + (o.consecutiveOrderNumber || '?') + ':', e.message);
        return false;
    }
}

async function runOnce(opts) {
    const force = !!(opts && opts.force);   // corrida MANUAL ("Generar ahora"): ignora el toggle y usa lote grande
    if (running) return;
    running = true;
    try {
        const cfg = await getConfig();
        if (!force && cfg.autoGenerate === false) return;   // apagado por el operador (el manual sí corre)

        const templates = await svc.listTemplates();
        const corazones = templates.find(t => /corazon/i.test(t.nombre) || (t.productMatch || []).some(m => /corazon/i.test(m)));
        if (!corazones || !corazones.baseImageUrl) return;   // sin plantilla de corazones, nada que hacer

        const snap = await db.collection('pedidos').where('estatus', '==', 'Sin estatus').limit(500).get();
        const candidates = [];
        for (const d of snap.docs) {
            const o = { id: d.id, ...d.data() };
            if (o.mockupHidden === true) continue;
            if (!isCorazones(o, corazones)) continue;
            if (SPECIAL_RE.test(datosOf(o))) continue;   // algo especial -> revisión manual
            candidates.push(o);
        }

        const cap = force ? FORCE_BATCH : BATCH;
        let done = 0;
        for (const o of candidates) {
            if (done >= cap) break;
            const prev = await db.collection('mockup_previews').doc(String(o.id)).get();
            if (prev.exists && Array.isArray(prev.data().previews) && prev.data().previews.length) continue;   // ya tiene preview
            const res = await generateOne(o, corazones, cfg);
            if (res === 'no-balance') { await alertNoBalance(); break; }
            if (res === true) done++;
        }
        if (done) console.log('[mockup-auto] corrida: ' + done + ' preview(s) generados de ' + candidates.length + ' candidatos.');
    } catch (e) {
        console.error('[mockup-auto] error de corrida:', e.message);
    } finally {
        running = false;
    }
}

function startMockupAutoScheduler() {
    if (task) return;
    task = cron.schedule(CRON_SCHEDULE, runOnce);
    console.log('[mockup-auto] Scheduler iniciado. Cron: "' + CRON_SCHEDULE + '", batch ' + BATCH + ', aviso saldo a ' + ADMIN_PHONE + '.');
}

module.exports = { startMockupAutoScheduler, runOnce };
