// =================================================================
// === Vigilante de la cola "Pendientes IA" ========================
// =================================================================
// Un contacto entra a Pendientes IA cuando la IA cierra una venta ("ya registramos
// tu pedido" / /final). Lo normal es que el registro automático cree el pedido en
// segundos y lo saque de la cola. Si algo falla (extractor, comando no emitido,
// reinicio de Render a media extracción), el cliente se queda creyendo que su
// pedido existe y NADIE se entera: no hay diseño, ni foto, ni cobranza.
// (Caso real 18-jul-2026: 5216471109101 y ~10 contactos más con días atorados.)
//
// Este vigilante corre cada 30 min y avisa al admin (un solo WhatsApp con la lista)
// de los contactos que llevan >1 h en la cola SIN un pedido creado desde que entraron.
// Los "cambios sobre pedidos existentes" (sí tienen pedido reciente) no alarman: esos
// ya se avisaron individualmente al ocurrir y son revisión normal.
const cron = require('node-cron');
const { db, admin } = require('../config');

const CRON_SCHEDULE = '*/30 * * * *';       // cada 30 minutos
const STUCK_MS = 60 * 60 * 1000;            // >1 h en la cola sin pedido = atorado
const REALERT_MS = 24 * 60 * 60 * 1000;     // re-avisar del mismo contacto máx. 1 vez al día
const ADMIN_VERIFY_PHONE = process.env.ADMIN_VERIFY_PHONE || '5216182297167';

let task = null;
let running = false;

async function runPendientesIaCheckOnce() {
    if (running) return { skipped: 'ya corriendo' };
    running = true;
    try {
        const snap = await db.collection('contacts_whatsapp').where('status', '==', 'pendientes_ia').get();
        const now = Date.now();
        const stuck = [];

        for (const doc of snap.docs) {
            const c = doc.data();
            // Referencia de entrada a la cola: el sello pendientesIaAt (nuevo). Los contactos
            // viejos sin sello usan lastMessageTimestamp como aproximación.
            const refTs = c.pendientesIaAt || c.lastMessageTimestamp;
            const refMs = refTs && refTs.toDate ? refTs.toDate().getTime() : 0;
            if (!refMs || (now - refMs) < STUCK_MS) continue;

            const alertedMs = c.pendientesIaAlertedAt && c.pendientesIaAlertedAt.toDate ? c.pendientesIaAlertedAt.toDate().getTime() : 0;
            if (alertedMs && (now - alertedMs) < REALERT_MS) continue;

            // ¿Se creó un pedido alrededor de su entrada a la cola (2 h antes o después)?
            // Entonces NO es un cierre perdido: es un cambio pendiente de revisión (tiene DH)
            // o el registro sí ocurrió y la etiqueta quedó por otra razón. Sin query compuesta
            // (contactId + createdAt requeriría índice): un contacto tiene pocos pedidos.
            const pedidosSnap = await db.collection('pedidos').where('contactId', '==', doc.id).get();
            const tienePedidoReciente = pedidosSnap.docs.some(p => {
                const ca = p.data().createdAt;
                return ca && ca.toDate && ca.toDate().getTime() >= (refMs - 2 * 60 * 60 * 1000);
            });
            if (tienePedidoReciente) continue;

            stuck.push({ ref: doc.ref, name: c.name || doc.id, id: doc.id, hrs: ((now - refMs) / 3600000).toFixed(1) });
        }

        if (stuck.length === 0) return { revisados: snap.size, atorados: 0 };

        const lines = stuck.map(s => `• ${s.name} — ${s.id} (${s.hrs} h en la cola)`).join('\n');
        try {
            const { sendAdvancedWhatsAppMessage } = require('../services'); // perezoso: evita ciclo de módulos
            await sendAdvancedWhatsAppMessage(ADMIN_VERIFY_PHONE, {
                text: `⏰ *Ventas cerradas SIN pedido registrado*\n\nA estos clientes la IA les dijo "ya registramos tu pedido", pero el pedido NO existe en el CRM:\n\n${lines}\n\nRegístralos manualmente desde su chat (el resumen confirmado está en la conversación). Mientras no se registren, no hay diseño, ni foto, ni cobranza.`
            });
        } catch (e) {
            console.warn('[PENDIENTES_IA] No se pudo enviar la alerta al admin:', e.message);
        }
        for (const s of stuck) {
            await s.ref.update({ pendientesIaAlertedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
        }
        console.log(`[PENDIENTES_IA] Alerta enviada al admin: ${stuck.length} contacto(s) con venta cerrada sin pedido.`);
        return { revisados: snap.size, atorados: stuck.length };
    } catch (e) {
        console.error('[PENDIENTES_IA] Error en el vigilante:', e.message);
        return { error: e.message };
    } finally {
        running = false;
    }
}

function startPendientesIaWatchdog() {
    if (task) return;
    task = cron.schedule(CRON_SCHEDULE, runPendientesIaCheckOnce);
    console.log(`[PENDIENTES_IA] Vigilante iniciado (${CRON_SCHEDULE}): avisa ventas cerradas con >1 h sin pedido registrado.`);
}

module.exports = { startPendientesIaWatchdog, runPendientesIaCheckOnce };
