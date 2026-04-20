/**
 * Carritos abandonados - Scheduler automatico
 *
 * Cada 30 min revisa carritos con status='pending' y antiguedad >= CART_RECOVERY_DELAY_HOURS
 * y envia un mensaje de WhatsApp usando una PLANTILLA APROBADA de Meta.
 *
 * IMPORTANTE: Enviar mensajes a clientes fuera de la ventana de 24h REQUIERE
 * una plantilla (HSM) aprobada por Meta. Define el nombre en:
 *   CART_RECOVERY_TEMPLATE_NAME (default: "carrito_abandonado")
 *
 * Si la plantilla no existe o no esta configurada, el scheduler solo loggea
 * warnings y no envia. Marca el carrito como 'messaged' tras exito.
 */
const cron = require('node-cron');
const axios = require('axios');
const { db, admin } = require('../config');

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const TEMPLATE_NAME = process.env.CART_RECOVERY_TEMPLATE_NAME || 'carrito_abandonado';
const DELAY_HOURS = parseFloat(process.env.CART_RECOVERY_DELAY_HOURS || '2');
const MAX_ATTEMPTS = parseInt(process.env.CART_RECOVERY_MAX_ATTEMPTS || '3');
const CRON_SCHEDULE = process.env.CART_RECOVERY_CRON || '*/30 * * * *'; // cada 30 min

let cachedTemplate = null;
let cachedTemplateAt = 0;
const TEMPLATE_CACHE_MS = 10 * 60 * 1000; // 10 min

let scheduledTask = null;

// Normaliza telefono a formato wa_id (52 + 10 digitos para MX)
function toWaId(phone) {
    const digits = (phone || '').replace(/\D/g, '');
    const last10 = digits.slice(-10);
    if (digits.startsWith('521')) return '52' + last10; // normalizar 521 -> 52
    if (digits.length === 10) return '52' + last10;
    return digits; // asumir ya viene bien
}

async function fetchRecoveryTemplate() {
    const now = Date.now();
    if (cachedTemplate && (now - cachedTemplateAt) < TEMPLATE_CACHE_MS) {
        return cachedTemplate;
    }
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
        throw new Error('Faltan credenciales de WhatsApp Business (WHATSAPP_BUSINESS_ACCOUNT_ID/WHATSAPP_TOKEN)');
    }
    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
    const all = res.data?.data || [];
    const approved = all.filter(t => t.status === 'APPROVED');
    const tpl = approved.find(t => t.name === TEMPLATE_NAME);
    if (!tpl) {
        const names = approved.map(t => t.name).join(', ');
        throw new Error(`Plantilla "${TEMPLATE_NAME}" no encontrada o no aprobada. Disponibles: ${names}`);
    }
    cachedTemplate = tpl;
    cachedTemplateAt = now;
    return tpl;
}

// Construye payload de template con nombre del cliente en {{1}} si el BODY lo espera
function buildTemplatePayload(waId, template, customerName) {
    const body = (template.components || []).find(c => c.type === 'BODY');
    const components = [];

    if (body?.text && /\{\{1\}\}/.test(body.text)) {
        const params = [{ type: 'text', text: customerName || 'Cliente' }];
        const matches = body.text.match(/\{\{\d+\}\}/g) || [];
        // Rellenar parametros extra con strings vacios si la plantilla espera mas variables
        for (let i = 1; i < matches.length; i++) {
            params.push({ type: 'text', text: '' });
        }
        components.push({ type: 'body', parameters: params });
    }

    const payload = {
        messaging_product: 'whatsapp',
        to: waId,
        type: 'template',
        template: {
            name: template.name,
            language: { code: template.language || 'es_MX' }
        }
    };
    if (components.length > 0) payload.template.components = components;
    return payload;
}

async function sendRecoveryMessage(cart) {
    const template = await fetchRecoveryTemplate();
    const waId = toWaId(cart.customerPhone);
    if (!waId || waId.length < 12) {
        throw new Error(`Telefono invalido: ${cart.customerPhone}`);
    }

    const payload = buildTemplatePayload(waId, template, cart.customerName);
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const res = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
    });
    const messageId = res.data?.messages?.[0]?.id || null;

    // Guardar mensaje en el chat del CRM para que el operador vea el envio
    try {
        const bodyText = (template.components || []).find(c => c.type === 'BODY')?.text || `📄 Plantilla: ${template.name}`;
        const contactRef = db.collection('contacts_whatsapp').doc(waId);
        const contactSnap = await contactRef.get();
        if (!contactSnap.exists) {
            await contactRef.set({
                wa_id: waId,
                name: cart.customerName || `Cliente ${waId.slice(-4)}`,
                name_lowercase: (cart.customerName || '').toLowerCase(),
                lastMessage: bodyText.substring(0, 100),
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                unreadCount: 0,
                createdBy: 'cart_recovery_scheduler'
            }, { merge: true });
        }
        await contactRef.collection('messages').add({
            from: PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: messageId,
            text: bodyText.replace('{{1}}', cart.customerName || 'Cliente'),
            templateName: template.name,
            source: 'cart_recovery'
        });
        await contactRef.update({
            lastMessage: bodyText.substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[CART_RECOVERY] No se pudo guardar en CRM:', e.message);
    }

    return messageId;
}

async function runRecoverySweep() {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !WHATSAPP_BUSINESS_ACCOUNT_ID) {
        console.warn('[CART_RECOVERY] Saltando: faltan credenciales de WhatsApp.');
        return;
    }

    const cutoff = new Date(Date.now() - DELAY_HOURS * 60 * 60 * 1000);

    let snap;
    try {
        snap = await db.collection('abandoned_carts')
            .where('status', '==', 'pending')
            .where('createdAt', '<=', cutoff)
            .limit(50)
            .get();
    } catch (e) {
        console.error('[CART_RECOVERY] Error consultando carritos:', e.message);
        return;
    }

    if (snap.empty) return;

    console.log(`[CART_RECOVERY] Procesando ${snap.size} carritos pendientes...`);

    for (const doc of snap.docs) {
        const cart = { id: doc.id, ...doc.data() };
        const attempts = cart.recoveryAttempts || 0;
        if (attempts >= MAX_ATTEMPTS) {
            // Marcar como fallido definitivo y seguir
            await doc.ref.update({ status: 'message_failed', updatedAt: new Date() }).catch(() => {});
            continue;
        }

        try {
            const messageId = await sendRecoveryMessage(cart);
            await doc.ref.update({
                status: 'messaged',
                messagedAt: new Date(),
                recoveryMessageId: messageId,
                recoveryAttempts: attempts + 1,
                updatedAt: new Date()
            });
            console.log(`[CART_RECOVERY] ✓ ${cart.customerPhone} - ${cart.customerName} (msg: ${messageId})`);
        } catch (e) {
            const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            console.error(`[CART_RECOVERY] ✗ ${cart.customerPhone}: ${detail}`);
            await doc.ref.update({
                recoveryAttempts: attempts + 1,
                lastRecoveryError: detail.substring(0, 500),
                updatedAt: new Date()
            }).catch(() => {});
        }

        // Delay entre envios (evitar rate limit)
        await new Promise(r => setTimeout(r, 500));
    }
}

function startCartRecoveryScheduler() {
    if (scheduledTask) {
        console.log('[CART_RECOVERY] Scheduler ya iniciado');
        return;
    }
    console.log(`[CART_RECOVERY] Scheduler iniciado. Cron: ${CRON_SCHEDULE}. Delay: ${DELAY_HOURS}h. Template: ${TEMPLATE_NAME}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runRecoverySweep().catch(e => console.error('[CART_RECOVERY] Sweep error:', e.message));
    });
}

module.exports = {
    startCartRecoveryScheduler,
    runRecoverySweep // exportado para testing/trigger manual
};
