// =================================================================
// === Servicio de COBRANZA con IA (motor compartido) ===============
// =================================================================
// Motor extraído de POST /api/cobranza/enviar (apiRoutes.js) para que lo usen:
//   1) el endpoint manual (la página public/cobranza), y
//   2) el scheduler de cobranza automática (cobranzaScheduler.js).
// La lógica y el CONTRATO de resultado son los MISMOS que tenía el endpoint:
//   { success:false, skipped:true, reason }                     — no se envió (con motivo)
//   { success:true, message, sentText, windowOpen, statusChanged } — se envió
// Se añade `futureDate` (aditivo) cuando la IA detecta promesa de pago futura,
// para que el scheduler pueda respetarla en corridas siguientes.
const axios = require('axios');
const { db, admin } = require('../config');
const { logAiUsage } = require('../aiUsage');
const { buildAdvancedTemplatePayload } = require('../whatsappTemplates');

// Caché corto de plantillas aprobadas de WhatsApp: el sweep automático cobra a muchos
// contactos seguidos y pedirle la lista a Meta por cada uno es lento e innecesario.
let templatesCache = null;
let templatesCacheAt = 0;
const TEMPLATES_CACHE_MS = 10 * 60 * 1000;

async function fetchApprovedTemplates() {
    const now = Date.now();
    if (templatesCache && (now - templatesCacheAt) < TEMPLATES_CACHE_MS) return templatesCache;
    let templatesData = [];
    try {
        const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        if (WHATSAPP_BUSINESS_ACCOUNT_ID && WHATSAPP_TOKEN) {
            const tplRes = await axios.get(
                `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,
                { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, params: { limit: 100 } }
            );
            templatesData = (tplRes.data.data || [])
                .filter(t => t.status === 'APPROVED')
                .map(t => ({
                    name: t.name,
                    language: t.language,
                    components: t.components?.map(c => ({ type: c.type, text: c.text, format: c.format, buttons: c.buttons })) || []
                }));
        }
    } catch (e) {
        console.warn('[Cobranza] Error cargando plantillas:', e.message);
    }
    templatesCache = templatesData;
    templatesCacheAt = now;
    return templatesData;
}

/**
 * Ejecuta UN intento de cobranza IA para un contacto (mismo comportamiento que tenía
 * el endpoint /cobranza/enviar). No decide elegibilidad de negocio (eso es del caller):
 * aquí solo están las salvaguardas de conversación (ya cobrado hoy, conversación hoy,
 * ventana 24h, FUTURE, SKIP) y el envío.
 */
async function cobrarContacto({ contactId, instructions, orderNumbers }) {
    // require perezoso para evitar ciclo de módulos (services es un módulo grande)
    const { sendAdvancedWhatsAppMessage, generateGeminiResponse } = require('../services');

    // 1. Verificar que el contacto existe
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    const contactDoc = await contactRef.get();
    if (!contactDoc.exists) {
        return { success: false, skipped: true, reason: 'Contacto no encontrado en WhatsApp' };
    }

    // 1.5 Verificar que no se haya cobrado hoy (por fecha calendario, no 24h)
    const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const contactData = contactDoc.data();
    if (contactData.lastCobranzaDate === todayMx) {
        return { success: false, skipped: true, reason: 'Ya se cobró hoy' };
    }

    // 2. Cargar historial de conversación (ordenado desc para detectar ventana 24h)
    const messagesSnapshot = await contactRef.collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

    // 2.1 Si la conversación tiene mensajes de hoy (cualquier dirección), no cobrar
    const hasMessagesToday = messagesSnapshot.docs.some(d => {
        const ts = d.data().timestamp?.toDate();
        if (!ts) return false;
        const msgDateMx = ts.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        return msgDateMx === todayMx;
    });
    if (hasMessagesToday) {
        return { success: false, skipped: true, reason: 'Tiene conversación hoy' };
    }

    // Detectar ventana de 24h: buscar último mensaje ENTRANTE del cliente
    const lastInboundMsg = messagesSnapshot.docs.find(d => d.data().from === contactId);
    const lastInboundTime = lastInboundMsg?.data()?.timestamp?.toDate();
    const windowOpen = lastInboundTime && (Date.now() - lastInboundTime.getTime() < 24 * 60 * 60 * 1000);

    const conversationHistory = messagesSnapshot.docs.map(doc => {
        const d = doc.data();
        const fromLabel = d.from === contactId ? 'Cliente' : 'Asistente';
        return `${fromLabel}: ${d.text || ''}`;
    }).reverse().join('\n');

    if (!conversationHistory.trim()) {
        return { success: false, skipped: true, reason: 'Sin historial de conversación' };
    }

    // 3. Cargar respuestas guardadas CON archivos adjuntos
    const quickRepliesSnapshot = await db.collection('quick_replies').get();
    const quickRepliesData = quickRepliesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const quickRepliesContext = quickRepliesData.map(qr => {
        let entry = `/${qr.shortcut}: ${qr.message || ''}`;
        if (qr.fileUrl) entry += ` [ARCHIVO: ${qr.fileUrl}]`;
        return entry;
    }).join('\n');

    // 4. Cargar plantillas de WhatsApp aprobadas (para chats cerrados)
    const templatesData = await fetchApprovedTemplates();
    const templatesContext = templatesData.map(t => {
        const body = t.components.find(c => c.type === 'BODY');
        return `[TEMPLATE:${t.name}]: ${body?.text || '(sin texto)'}`;
    }).join('\n');

    // 5. Info de pedidos del contacto
    const ordersInfo = (orderNumbers && orderNumbers.length) ? `Pedidos del cliente: ${orderNumbers.map(n => 'DH' + n).join(', ')}` : '';

    // 6. Construir prompt para la IA
    const windowStatus = windowOpen
        ? 'VENTANA DE 24H: ABIERTA - Puedes enviar mensaje normal o respuesta rápida.'
        : 'VENTANA DE 24H: CERRADA - Debes usar una plantilla. Responde con [TEMPLATE:nombre_plantilla]';

    const systemPrompt = `${instructions}

--- RESPUESTAS GUARDADAS DISPONIBLES ---
${quickRepliesContext}

--- PLANTILLAS DE WHATSAPP APROBADAS (para chats cerrados) ---
${templatesContext || '(ninguna disponible)'}

--- ESTADO DEL CHAT ---
${windowStatus}

--- FECHA DE HOY ---
Hoy es ${todayMx} (zona horaria America/Mexico_City, formato YYYY-MM-DD).

--- FORMATO DE RESPUESTA ---
- Para enviar una respuesta rápida: responde SOLAMENTE con el shortcut, ej: /a3
- Para enviar una plantilla (chat cerrado): responde con [TEMPLATE:nombre_plantilla]
- Para enviar un mensaje personalizado (chat abierto): escribe solo el mensaje
- Si necesitas cambiar el estatus del pedido, agrega al final: [ESTATUS:NuevoEstatus]
  Valores válidos: Foto enviada, Esperando pago, Pagado, Mns Amenazador, Cancelado
- Si el cliente YA DIJO una fecha específica en la que va a pagar y esa fecha es POSTERIOR a hoy (${todayMx}): responde SOLAMENTE con [FUTURE:YYYY-MM-DD] usando la fecha prometida en formato ISO. NO envíes ningún mensaje. Si la fecha prometida es hoy o ya pasó, NO uses [FUTURE] y continúa con el flujo normal de cobranza.
- Si el cobro ya se resolvió o ya pagó: responde SKIP
- No incluyas "Asistente:" ni etiquetas extra.`;

    const dynamicPrompt = `${ordersInfo}

--- HISTORIAL DE CONVERSACIÓN ---
${conversationHistory}

--- INSTRUCCIÓN ---
Analiza la conversación y decide qué acción de cobranza tomar.`;

    // 7. Llamar a Gemini
    const aiResponse = await generateGeminiResponse(dynamicPrompt, [], systemPrompt);
    let responseText = aiResponse.text.trim();

    // 8. Log de uso de tokens (fuente 'cobranza')
    await logAiUsage('cobranza', aiResponse);

    // 9. FUTURE - el cliente ya dio una fecha futura de pago
    const futureMatch = responseText.match(/\[FUTURE:(\d{4}-\d{2}-\d{2})\]/i);
    if (futureMatch) {
        const futureDate = futureMatch[1];
        if (futureDate > todayMx) {
            return {
                success: false,
                skipped: true,
                reason: `Cobranza futura (${futureDate})`,
                futureDate
            };
        }
        // Si la fecha no es realmente futura, removemos la etiqueta y continuamos
        responseText = responseText.replace(/\[FUTURE:.+?\]/i, '').trim();
    }

    // 9. SKIP
    if (responseText.toUpperCase().includes('SKIP')) {
        return { success: false, skipped: true, reason: 'IA determinó que no requiere cobro' };
    }

    // 10. Extraer y ejecutar cambio de estatus si la IA lo indica
    const statusMatch = responseText.match(/\[ESTATUS:(.+?)\]/);
    if (statusMatch) {
        const newStatus = statusMatch[1].trim();
        responseText = responseText.replace(/\[ESTATUS:.+?\]/, '').trim();
        // Buscar pedidos del contacto y actualizar estatus
        if (orderNumbers && orderNumbers.length > 0) {
            for (const orderNum of orderNumbers) {
                const orderQuery = await db.collection('pedidos')
                    .where('consecutiveOrderNumber', '==', orderNum)
                    .limit(1).get();
                if (!orderQuery.empty) {
                    await orderQuery.docs[0].ref.update({ estatus: newStatus });
                    console.log(`[Cobranza] Estatus de DH${orderNum} cambiado a: ${newStatus}`);
                }
            }
        }
    }

    // 11. Detectar si es un shortcut de respuesta rápida
    const shortcutMatch = responseText.match(/^\/(\S+)$/);
    let sendResult;

    if (shortcutMatch) {
        const shortcut = shortcutMatch[1];
        const qr = quickRepliesData.find(q => q.shortcut === shortcut);
        if (qr) {
            sendResult = await sendAdvancedWhatsAppMessage(contactId, {
                text: qr.message || '',
                fileUrl: qr.fileUrl || null,
                fileType: qr.fileType || null
            });
        } else {
            // Shortcut no encontrado, enviar como texto
            sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: responseText });
        }
    }
    // 12. Detectar si es plantilla (chat cerrado)
    else if (responseText.includes('[TEMPLATE:')) {
        const templateMatch = responseText.match(/\[TEMPLATE:(.+?)\]/);
        if (templateMatch) {
            const templateName = templateMatch[1].trim();
            const template = templatesData.find(t => t.name === templateName);
            if (template) {
                const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template);
                const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
                const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
                const tplResponse = await axios.post(
                    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
                    payload,
                    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
                );
                const messageId = tplResponse.data.messages[0].id;
                sendResult = { id: messageId, textForDb: messageToSaveText };
            } else {
                // Plantilla no encontrada, intentar enviar como texto normal
                const cleanText = responseText.replace(/\[TEMPLATE:.+?\]/, '').trim();
                if (cleanText) {
                    sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: cleanText });
                } else {
                    return { success: false, skipped: true, reason: `Plantilla '${templateName}' no encontrada` };
                }
            }
        }
    }
    // 13. Mensaje normal
    else {
        sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: responseText });
    }

    // 14. Guardar en historial de mensajes
    if (sendResult) {
        await contactRef.collection('messages').doc(sendResult.id).set({
            from: process.env.PHONE_NUMBER_ID || 'system',
            text: sendResult.textForDb,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'sent',
            id: sendResult.id,
            isAutoReply: true,
            ...(sendResult.fileUrlForDb ? { fileUrl: sendResult.fileUrlForDb, fileType: sendResult.fileTypeForDb } : {})
        });

        await contactRef.update({
            lastMessage: sendResult.textForDb,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            lastCobranzaDate: todayMx
        });
    }

    return {
        success: true,
        message: 'Mensaje enviado',
        sentText: responseText,
        windowOpen,
        statusChanged: statusMatch ? statusMatch[1].trim() : null
    };
}

module.exports = { cobrarContacto };
