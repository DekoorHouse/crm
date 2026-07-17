// --- Aprobación de diseño por el cliente (automática) ------------------------------------------
// Para diseños ESPECIALES (sin mockup: 4 corazones, foto, logo…) que se le mandan al cliente
// para que apruebe ANTES de cortar. Cuando el cliente responde, un clasificador con IA decide:
//   APPROVED  -> se marca aprobado (el svg-corte-worker local sube el SVG a Drive), se confirma
//                al cliente y se avisa al admin. 100% sin que el equipo vea el chat.
//   CHANGES   -> se avisa al admin con el cambio pedido y se pausa la IA (un humano rediseña y
//                reenvía la captura). No se puede automatizar el rediseño.
//   UNCLEAR   -> se le vuelve a preguntar al cliente para confirmar.
//
// SEGURIDAD: aprobar solo SUBE el SVG a Drive; NO corta nada (el corte en el láser sigue siendo
// un paso manual con un humano viendo el diseño). Por eso auto-subir es de bajo riesgo.
// Kill-switch: crm_settings/general.designApprovalAutoActive = false.
'use strict';
const { db, admin } = require('../config');

const ADMIN_PHONE = process.env.ADMIN_ALERT_PHONE || '5216182297167';

// ¿Este contacto está esperando que el cliente apruebe un diseño?
function isPending(contactData) {
    return !!(contactData && contactData.designApprovalPending === true && contactData.designApprovalOrderId);
}

// Clasifica la respuesta del cliente a la pregunta de aprobación. Conservador: solo APPROVED
// cuando es un "sí" claro y sin condiciones. Cualquier corrección, nombre, fecha o duda -> CHANGES
// o UNCLEAR. Devuelve { decision: 'approved'|'changes'|'unclear', changeSummary }.
async function classifyReply(clientText, orderContext) {
    const svc = require('../services');
    const sys = `Eres un clasificador. A un cliente de una tienda de lámparas personalizadas se le envió una imagen del DISEÑO de su lámpara y se le preguntó si lo aprueba o quiere cambios. Clasifica su respuesta.

Contexto del pedido (lo que dice el diseño actual): ${orderContext || '(no disponible)'}

Responde SOLO un JSON válido, sin markdown:
{"decision":"approved"|"changes"|"unclear","changeSummary":"..."}

Reglas ESTRICTAS:
- "approved" SOLO si el cliente aprueba de forma clara e incondicional (ej: "sí", "está bien así", "me encanta", "aprobado", "así déjalo", "perfecto", "sí adelante"). Un simple "sí" a la pregunta cuenta como approved.
- "changes" si pide CUALQUIER modificación o señala un error (nombre, fecha, ortografía, posición, tamaño, "cámbiale", "está mal", "no es así", "le falta"). En changeSummary resume en pocas palabras QUÉ quiere cambiar.
- "unclear" si es ambiguo, hace una pregunta, o no se entiende si aprueba o pide cambio.
- Ante la duda entre approved y changes/unclear, NUNCA elijas approved. Solo aprueba si es inequívoco.
- changeSummary vacío salvo en "changes".`;

    let raw;
    try {
        const r = await svc.generateGeminiResponse(String(clientText || '').slice(0, 2000), [], sys);
        raw = (r && r.text) || '';
    } catch (e) {
        console.warn('[design-approval] clasificador falló:', e.message);
        return { decision: 'unclear', changeSummary: '', error: e.message };
    }
    const clean = raw.replace(/```json|```/g, '').trim();
    try {
        const j = JSON.parse(clean);
        const decision = ['approved', 'changes', 'unclear'].includes(j.decision) ? j.decision : 'unclear';
        return { decision, changeSummary: String(j.changeSummary || '').slice(0, 300) };
    } catch (_) {
        // Si el modelo no devolvió JSON limpio, ser conservador.
        console.warn('[design-approval] respuesta no-JSON del clasificador:', clean.slice(0, 120));
        return { decision: 'unclear', changeSummary: '' };
    }
}

// Texto legible de los datos del diseño (para contexto del clasificador y avisos al admin).
function orderDesignText(orderData) {
    const da = orderData.designApproval || {};
    if (da.designText) return da.designText;
    const datos = (Array.isArray(orderData.items) ? orderData.items.map(i => i.datosProducto).filter(Boolean).join(' | ') : '') || orderData.datosProducto || '';
    return datos;
}

// Extrae el TEXTO REAL del cliente. Ojo: en el webhook crudo de Meta `message.text` es un OBJETO
// {body}, no un string; las notas de voz traen la transcripción (async) en el doc guardado, y las
// imágenes su caption. Preferimos el doc guardado (ya normalizado + transcripción) y caemos al
// objeto crudo. Devuelve '' si no hay texto utilizable (sticker/foto/ubicación sin caption).
const MEDIA_PLACEHOLDER = /^(🎤|🎵|📷|🎥|📄|📎|📍|Sticker)/;
function extractClientText(saved, raw) {
    if (saved && typeof saved.transcription === 'string' && saved.transcription.trim()) return saved.transcription.trim();
    if (saved && typeof saved.text === 'string') {
        const t = saved.text.trim();
        if (t && !MEDIA_PLACEHOLDER.test(t)) return t;   // texto real (no placeholder de multimedia)
    }
    if (raw) {
        const rt = raw.text;
        if (typeof rt === 'string' && rt.trim()) return rt.trim();
        if (rt && typeof rt.body === 'string' && rt.body.trim()) return rt.body.trim();   // webhook crudo de WhatsApp/Messenger
        if (raw.image && typeof raw.image.caption === 'string' && raw.image.caption.trim()) return raw.image.caption.trim();
        if (typeof raw.body === 'string' && raw.body.trim()) return raw.body.trim();
        if (typeof raw.caption === 'string' && raw.caption.trim()) return raw.caption.trim();
    }
    return '';
}

// Maneja la respuesta del cliente a una aprobación pendiente. Llamado desde processAutoReplyAIInner
// (early-return) cuando isPending(contactData). NUNCA lanza: ante error, no rompe el bot.
async function handleReply(contactId, message, contactRef, contactData) {
    const svc = require('../services');
    try {
        // Kill-switch global
        const gen = await db.collection('crm_settings').doc('general').get();
        if (gen.exists && gen.data().designApprovalAutoActive === false) {
            console.log('[design-approval] kill-switch OFF; dejo la respuesta para un humano.');
            await contactRef.update({ aiStatus: admin.firestore.FieldValue.delete() }).catch(() => {});
            return; // no auto-actuar; tampoco corre la IA de ventas (early-return en el caller)
        }

        const orderId = contactData.designApprovalOrderId;
        const orderRef = db.collection('pedidos').doc(String(orderId));
        const orderSnap = await orderRef.get();
        if (!orderSnap.exists) {
            console.warn('[design-approval] pedido no existe:', orderId, '— limpio la bandera.');
            await contactRef.update({ designApprovalPending: false, aiStatus: admin.firestore.FieldValue.delete() });
            return;
        }
        const order = orderSnap.data();
        const dh = 'DH' + (order.consecutiveOrderNumber || orderId);
        const designText = orderDesignText(order);

        await contactRef.update({ aiStatus: admin.firestore.FieldValue.delete() }).catch(() => {});

        // Guard: si el pedido se canceló / envió / ocultó de Envíos entre armar y responder, NO
        // auto-aprobar (evita resucitar un pedido muerto). Escala a un humano.
        const estatus = String(order.estatus || '').toLowerCase();
        const shipped = (order.guiaEnvio && order.guiaEnvio.guia) || order.ocultoDeEnvios;
        if (shipped || /cancel/.test(estatus)) {
            await contactRef.update({ designApprovalPending: false, botActive: false });
            await notifyAdmin(`⚠️ ${dh} — el cliente respondió sobre su diseño pero el pedido ya está "${order.estatus}"${shipped ? ' / con guía' : ''}. No se auto-aprobó; revisar a mano.`);
            return;
        }

        // Texto REAL del cliente: del doc guardado (normalizado + transcripción); fallback al crudo.
        let saved = {};
        try {
            const s = await contactRef.collection('messages').where('from', '==', String(contactId)).orderBy('timestamp', 'desc').limit(1).get();
            if (!s.empty) saved = s.docs[0].data();
        } catch (_) {}
        let clientText = extractClientText(saved, message);
        // Nota de voz: la transcripción se escribe async; si aún no está, un reintento breve.
        if (!clientText && MEDIA_PLACEHOLDER.test(String((saved && saved.text) || ''))) {
            await new Promise(r => setTimeout(r, 4000));
            try {
                const s2 = await contactRef.collection('messages').where('from', '==', String(contactId)).orderBy('timestamp', 'desc').limit(1).get();
                if (!s2.empty) saved = s2.docs[0].data();
            } catch (_) {}
            clientText = extractClientText(saved, message);
        }

        // Sin texto utilizable (sticker/foto/ubicación/voz sin transcripción) NO va al clasificador:
        // se trata como ambiguo (evita mandarle basura a Gemini y un falso 'approved' sobre nada).
        let decision = 'unclear', changeSummary = '';
        if (clientText) {
            const c = await classifyReply(clientText, designText);
            decision = c.decision; changeSummary = c.changeSummary;
        }
        console.log(`[design-approval] ${dh}: cliente dijo "${String(clientText).slice(0, 60)}" -> ${decision}${changeSummary ? ' (' + changeSummary + ')' : ''}`);

        if (decision === 'approved') {
            await orderRef.update({
                'designApproval.status': 'approved',
                'designApproval.approvedAt': admin.firestore.FieldValue.serverTimestamp(),
                'designApproval.approvedText': String(clientText).slice(0, 300),
                'designApproval.unclearRounds': 0,
            });
            // El contacto sale del modo aprobación; la IA de post-venta retoma normal.
            await contactRef.update({ designApprovalPending: false, aiStage: 'postventa', botActive: true });
            await svc.sendAdvancedWhatsAppMessage(contactId, {
                text: `¡Perfecto! 🎉 Tu diseño quedó aprobado y ya lo pasamos a producción ✨ En cuanto tu lámpara esté lista te aviso por aquí 🙌`,
            });
            await notifyAdmin(`✅ ${dh} — el cliente APROBÓ su diseño (${designText}). Se sube a Drive automáticamente y el pedido pasa a "Diseñado por IA".`);
            console.log(`[design-approval] ${dh} APROBADO. El worker local subirá el SVG a Drive.`);
            return;
        }

        if (decision === 'changes') {
            await orderRef.update({
                'designApproval.status': 'change_requested',
                'designApproval.changeText': changeSummary || String(clientText).slice(0, 300),
                'designApproval.changeRequestedAt': admin.firestore.FieldValue.serverTimestamp(),
                'designApproval.unclearRounds': 0,
            });
            // Un humano rediseña y reenvía: pausar la IA y sacar del modo aprobación.
            await contactRef.update({ designApprovalPending: false, botActive: false });
            await svc.sendAdvancedWhatsAppMessage(contactId, {
                text: `¡Gracias por avisar! 🙌 Le paso tu comentario al equipo de diseño y te reenvío la corrección lo antes posible ✨`,
            });
            await notifyAdmin(`✏️ ${dh} — el cliente pidió un CAMBIO en su diseño: "${changeSummary || clientText}". Requiere rediseño y reenviar la captura. (IA pausada en ese chat.)`);
            console.log(`[design-approval] ${dh} pidió cambio: ${changeSummary}`);
            return;
        }

        // unclear: re-preguntar; tras 2 rondas sin claridad, escalar a un humano (no loop infinito).
        const rounds = ((order.designApproval && order.designApproval.unclearRounds) || 0) + 1;
        await orderRef.update({ 'designApproval.unclearRounds': rounds });
        if (rounds >= 2) {
            await contactRef.update({ designApprovalPending: false, botActive: false });
            await svc.sendAdvancedWhatsAppMessage(contactId, {
                text: `Para confirmar tu diseño, con gusto te atiende una persona del equipo 🙌`,
            });
            await notifyAdmin(`❓ ${dh} — no pude confirmar si el cliente aprobó (respondió: "${clientText || '(sin texto / nota de voz)'}"). Requiere revisión humana; IA pausada.`);
            console.log(`[design-approval] ${dh}: ambiguo x${rounds}, escalado a humano.`);
            return;
        }
        await svc.sendAdvancedWhatsAppMessage(contactId, {
            text: `Solo para confirmar 🙏 respóndeme con un mensaje: ¿el diseño está bien así o te gustaría que cambiemos algo?`,
        });
        console.log(`[design-approval] ${dh}: respuesta ambigua (ronda ${rounds}), re-pregunté.`);
    } catch (e) {
        console.error('[design-approval] handleReply error:', e.message);
        try { await contactRef.update({ aiStatus: admin.firestore.FieldValue.delete() }); } catch (_) {}
    }
}

async function notifyAdmin(text) {
    try {
        const svc = require('../services');
        await svc.sendAdvancedWhatsAppMessage(ADMIN_PHONE, { text });
    } catch (e) { console.warn('[design-approval] no pude avisar al admin:', e.message); }
}

module.exports = { isPending, handleReply, classifyReply };
