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

            // Clasificar: si el contacto tiene ALGÚN pedido en el CRM, lo atorado es un CAMBIO
            // pendiente de aplicar sobre ese pedido; si no tiene ninguno, es el caso grave:
            // venta cerrada sin registrar. Sin query compuesta (contactId + createdAt
            // requeriría índice nuevo): un contacto tiene pocos pedidos, se filtra en memoria.
            const pedidosSnap = await db.collection('pedidos').where('contactId', '==', doc.id).limit(5).get();
            const ultimoDH = pedidosSnap.docs
                .map(p => p.data())
                .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))[0];

            stuck.push({
                ref: doc.ref,
                name: c.name || doc.id,
                id: doc.id,
                hrs: ((now - refMs) / 3600000).toFixed(1),
                pedido: ultimoDH ? `DH${ultimoDH.consecutiveOrderNumber} (${ultimoDH.estatus || 'Sin estatus'})` : null
            });
        }

        if (stuck.length === 0) return { revisados: snap.size, atorados: 0 };

        const sinPedido = stuck.filter(s => !s.pedido);
        const conPedido = stuck.filter(s => s.pedido);
        let text = '⏰ *Cola Pendientes IA con más de 1 h sin resolver*\n';
        if (sinPedido.length) {
            text += `\n*Ventas cerradas SIN pedido registrado* (la IA les dijo "ya registramos tu pedido" y el pedido NO existe — regístralos desde su chat):\n`
                + sinPedido.map(s => `• ${s.name} — ${s.id} (${s.hrs} h)`).join('\n') + '\n';
        }
        if (conPedido.length) {
            text += `\n*Cambios confirmados por el cliente pendientes de aplicar* (ya tienen pedido; revisa y aplica el cambio):\n`
                + conPedido.map(s => `• ${s.name} — ${s.id} (${s.hrs} h) → ${s.pedido}`).join('\n') + '\n';
        }
        text += '\nMientras sigan en la cola no avanzan a diseño/foto/cobranza.';
        try {
            const { sendAdvancedWhatsAppMessage } = require('../services'); // perezoso: evita ciclo de módulos
            await sendAdvancedWhatsAppMessage(ADMIN_VERIFY_PHONE, { text });
        } catch (e) {
            console.warn('[PENDIENTES_IA] No se pudo enviar la alerta al admin:', e.message);
        }
        for (const s of stuck) {
            await s.ref.update({ pendientesIaAlertedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
        }
        console.log(`[PENDIENTES_IA] Alerta enviada al admin: ${sinPedido.length} sin pedido, ${conPedido.length} con cambio pendiente.`);
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
