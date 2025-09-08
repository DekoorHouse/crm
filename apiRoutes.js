const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { db, admin } = require('./config');
const { sendConversionEvent, generateGeminiResponse } = require('./services');
// Se importa dinámicamente para evitar dependencias circulares
const { sendAdvancedWhatsAppMessage } = require('./whatsappHandler');

const router = express.Router();

// --- CONSTANTES ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const PORT = process.env.PORT || 3000;

// --- FUNCIÓN MOVIDA PARA EVITAR DEPENDENCIA CIRCULAR ---
async function buildAdvancedTemplatePayload(contactId, templateObject, imageUrl = null, bodyParams = []) {
    console.log('[DIAGNÓSTICO] Objeto de plantilla recibido:', JSON.stringify(templateObject, null, 2));
    const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
    const contactName = contactDoc.exists ? contactDoc.data().name : 'Cliente';
    const { name: templateName, components: templateComponents, language } = templateObject;
    const payloadComponents = [];
    let messageToSaveText = `📄 Plantilla: ${templateName}`;

    const headerDef = templateComponents?.find(c => c.type === 'HEADER');
    if (headerDef?.format === 'IMAGE') {
        if (!imageUrl) throw new Error(`La plantilla '${templateName}' requiere una imagen.`);
        payloadComponents.push({ type: 'header', parameters: [{ type: 'image', image: { link: imageUrl } }] });
        messageToSaveText = `🖼️ Plantilla con imagen: ${templateName}`;
    }
    if (headerDef?.format === 'TEXT' && headerDef.text?.includes('{{1}}')) {
        // Asumiendo que el parámetro del encabezado es siempre el nombre del contacto por simplicidad
        payloadComponents.push({ type: 'header', parameters: [{ type: 'text', text: contactName }] });
    }

    const bodyDef = templateComponents?.find(c => c.type === 'BODY');
    if (bodyDef) {
        const matches = bodyDef.text?.match(/\{\{\d\}\}/g);
        if (matches) {
            // El primer parámetro es siempre el nombre del contacto.
            const allParams = [contactName, ...bodyParams];
            const parameters = allParams.slice(0, matches.length).map(param => ({ type: 'text', text: String(param) })); // Asegurarse de que sea string
            
            payloadComponents.push({ type: 'body', parameters });
            
            // Para guardar en la BD, se reemplazan las variables en el texto
            let tempText = bodyDef.text;
            parameters.forEach((param, index) => {
                tempText = tempText.replace(`{{${index + 1}}}`, param.text);
            });
            messageToSaveText = tempText;

        } else {
            // El cuerpo no tiene variables
            payloadComponents.push({ type: 'body', parameters: [] });
            messageToSaveText = bodyDef.text || messageToSaveText;
        }
    }

    const buttonsDef = templateComponents?.find(c => c.type === 'BUTTONS');
    buttonsDef?.buttons?.forEach((button, index) => {
        if (button.type === 'URL' && button.url?.includes('{{1}}')) {
            payloadComponents.push({ type: 'button', sub_type: 'url', index: index.toString(), parameters: [{ type: 'text', text: contactId }] });
        }
    });

    const payload = {
        messaging_product: 'whatsapp', to: contactId, type: 'template',
        template: { name: templateName, language: { code: language } }
    };
    if (payloadComponents.length > 0) payload.template.components = payloadComponents;
    console.log(`[DIAGNÓSTICO] Payload final construido para ${contactId}:`, JSON.stringify(payload, null, 2));
    return { payload, messageToSaveText };
}


// --- RUTAS DE CONTACTOS ---
router.get('/contacts', async (req, res) => {
    try {
        const { limit = 30, startAfterId } = req.query;
        let query = db.collection('contacts_whatsapp').orderBy('lastMessageTimestamp', 'desc').limit(Number(limit));
        if (startAfterId) {
            const lastDoc = await db.collection('contacts_whatsapp').doc(startAfterId).get();
            if (lastDoc.exists) query = query.startAfter(lastDoc);
        }
        const snapshot = await query.get();
        const contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const lastVisibleId = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null;
        res.status(200).json({ success: true, contacts, lastVisibleId });
    } catch (error) {
        console.error('Error fetching paginated contacts:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener contactos.' });
    }
});

router.get('/contacts/search', async (req, res) => {
    const { query } = req.query;
    console.log(`[SEARCH] Iniciando búsqueda para: "${query}"`);
    if (!query) return res.status(400).json({ success: false, message: 'Se requiere un término de búsqueda.' });
    try {
        const searchResults = [];
        const lowercaseQuery = query.toLowerCase();
        const phoneDoc = await db.collection('contacts_whatsapp').doc(query).get();
        if (phoneDoc.exists) {
            searchResults.push({ id: phoneDoc.id, ...phoneDoc.data() });
        }
        const nameSnapshot = await db.collection('contacts_whatsapp').where('name_lowercase', '>=', lowercaseQuery).where('name_lowercase', '<=', lowercaseQuery + '\uf8ff').limit(20).get();
        nameSnapshot.forEach(doc => { if (!searchResults.some(c => c.id === doc.id)) searchResults.push({ id: doc.id, ...doc.data() }); });
        const partialPhoneSnapshot = await db.collection('contacts_whatsapp').where(admin.firestore.FieldPath.documentId(), '>=', query).where(admin.firestore.FieldPath.documentId(), '<=', query + '\uf8ff').limit(20).get();
        partialPhoneSnapshot.forEach(doc => { if (!searchResults.some(c => c.id === doc.id)) searchResults.push({ id: doc.id, ...doc.data() }); });
        if (/^\d+$/.test(query) && query.length >= 3) {
            const prefixedQuery = "521" + query;
            const prefixedSnapshot = await db.collection('contacts_whatsapp').where(admin.firestore.FieldPath.documentId(), '>=', prefixedQuery).where(admin.firestore.FieldPath.documentId(), '<=', prefixedQuery + '\uf8ff').limit(20).get();
            prefixedSnapshot.forEach(doc => { if (!searchResults.some(c => c.id === doc.id)) searchResults.push({ id: doc.id, ...doc.data() }); });
        }
        searchResults.sort((a, b) => (b.lastMessageTimestamp?.toMillis() || 0) - (a.lastMessageTimestamp?.toMillis() || 0));
        res.status(200).json({ success: true, contacts: searchResults });
    } catch (error) {
        console.error('Error searching contacts:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al buscar contactos.' });
    }
});

router.put('/contacts/:contactId', async (req, res) => {
    const { contactId } = req.params;
    const { name, email, nickname } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
    try {
        await db.collection('contacts_whatsapp').doc(contactId).update({
            name, email: email || null, nickname: nickname || null, name_lowercase: name.toLowerCase()
        });
        res.status(200).json({ success: true, message: 'Contacto actualizado.' });
    } catch (error) {
        console.error('Error al actualizar el contacto:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el contacto.' });
    }
});

// --- RUTA CORREGIDA PARA HISTORIAL DE PEDIDOS ---
router.get('/contacts/:contactId/orders', async (req, res) => {
    try {
        const { contactId } = req.params;
        
        // --- INICIO DE LA CORRECCIÓN ---
        // 1. Se elimina el .orderBy('createdAt', 'desc') para evitar el error de índice.
        const snapshot = await db.collection('pedidos')
                                 .where('telefono', '==', contactId)
                                 .get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, orders: [] });
        }

        // 2. Se mapean los resultados y LUEGO se ordenan en JavaScript.
        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                consecutiveOrderNumber: data.consecutiveOrderNumber,
                producto: data.producto,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
            };
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Orden descendente
        // --- FIN DE LA CORRECCIÓN ---

        res.status(200).json({ success: true, orders });
    } catch (error) {
        console.error(`Error al obtener el historial de pedidos para ${req.params.contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener el historial de pedidos.' });
    }
});


// --- RUTAS DE MENSAJES Y PLANTILLAS ---
router.post('/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid, template, tempId } = req.body;
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    if (!text && !fileUrl && !template) return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        if (template) {
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template, null, []);
            if (reply_to_wamid) payload.context = { message_id: reply_to_wamid };
            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
            });
            const messageId = response.data.messages[0].id;
            const messageToSave = { from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(), id: messageId, text: messageToSaveText };
            if (reply_to_wamid) messageToSave.context = { id: reply_to_wamid };
            const messageRef = tempId ? contactRef.collection('messages').doc(tempId) : contactRef.collection('messages').doc();
            await messageRef.set(messageToSave);
            await contactRef.update({ lastMessage: messageToSaveText, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), unreadCount: 0 });
        } else {
            const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text, fileUrl, fileType, reply_to_wamid });
            const messageToSave = { from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(), id: sentMessageData.id, text: sentMessageData.textForDb, fileUrl: sentMessageData.fileUrlForDb, fileType: sentMessageData.fileTypeForDb };
            if (reply_to_wamid) messageToSave.context = { id: reply_to_wamid };
            Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);
            const messageRef = tempId ? contactRef.collection('messages').doc(tempId) : contactRef.collection('messages').doc();
            await messageRef.set(messageToSave);
            await contactRef.update({ lastMessage: sentMessageData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), unreadCount: 0 });
        }
        res.status(200).json({ success: true, message: 'Mensaje(s) enviado(s).' });
    } catch (error) {
        console.error('❌ Error al enviar mensaje/plantilla de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar el mensaje a través de WhatsApp.' });
    }
});

// --- NUEVA RUTA PARA MENSAJES PAGINADOS (PREVISUALIZACIÓN) ---
router.get('/contacts/:contactId/messages-paginated', async (req, res) => {
    try {
        const { contactId } = req.params;
        const { limit = 30, before } = req.query;

        let query = db.collection('contacts_whatsapp')
                      .doc(contactId)
                      .collection('messages')
                      .orderBy('timestamp', 'desc')
                      .limit(Number(limit));

        if (before) {
            // 'before' es un timestamp Unix en segundos del último mensaje que tiene el cliente
            const firestoreTimestamp = admin.firestore.Timestamp.fromMillis(parseInt(before) * 1000);
            // Buscamos mensajes ANTERIORES a ese timestamp
            query = query.where('timestamp', '<', firestoreTimestamp);
        }

        const snapshot = await query.get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, messages: [] });
        }

        const messages = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));

        res.status(200).json({ success: true, messages });

    } catch (error) {
        console.error(`Error al obtener mensajes paginados para ${req.params.contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener mensajes.' });
    }
});


router.post('/contacts/:contactId/messages/:messageDocId/react', async (req, res) => {
    const { contactId, messageDocId } = req.params;
    const { reaction } = req.body;
    try {
        const messageRef = db.collection('contacts_whatsapp').doc(contactId).collection('messages').doc(messageDocId);
        const messageDoc = await messageRef.get();
        if (!messageDoc.exists) return res.status(404).json({ success: false, message: 'Mensaje no encontrado.' });
        const wamid = messageDoc.data().id;
        const payload = { messaging_product: 'whatsapp', to: contactId, type: 'reaction', reaction: { message_id: wamid, emoji: reaction || "" } };
        await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });
        await messageRef.update({ reaction: reaction || admin.firestore.FieldValue.delete() });
        res.status(200).json({ success: true, message: 'Reacción enviada y actualizada.' });
    } catch (error) {
        console.error('Error al procesar la reacción:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Error del servidor al procesar la reacción.' });
    }
});

router.get('/whatsapp-templates', async (req, res) => {
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp Business.' });
    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    try {
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
        const templates = response.data.data.filter(t => t.status === 'APPROVED').map(t => ({
            name: t.name, language: t.language, status: t.status, category: t.category,
            components: t.components.map(c => ({ type: c.type, text: c.text, format: c.format, buttons: c.buttons }))
        }));
        res.status(200).json({ success: true, templates });
    } catch (error) {
        console.error('Error al obtener plantillas de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al obtener las plantillas de WhatsApp.' });
    }
});


// --- RUTAS DE CAMPAÑAS ---
router.post('/campaigns/send-template', async (req, res) => {
    const { contactIds, template } = req.body;
    if (!contactIds?.length || !template) return res.status(400).json({ success: false, message: 'Se requieren IDs y una plantilla.' });
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    const promises = contactIds.map(async (contactId) => {
        try {
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template);
            const response = await axios.post(url, payload, { headers });
            const messageId = response.data.messages[0].id;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            const contactRef = db.collection('contacts_whatsapp').doc(contactId);
            await contactRef.collection('messages').add({ from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId, text: messageToSaveText });
            await contactRef.update({ lastMessage: messageToSaveText, lastMessageTimestamp: timestamp, unreadCount: 0 });
            return { status: 'fulfilled', value: contactId };
        } catch (error) {
            console.error(`Error en campaña a ${contactId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
            return { status: 'rejected', reason: { contactId, error: error.response ? JSON.stringify(error.response.data) : error.message } };
        }
    });
    const outcomes = await Promise.all(promises);
    const successful = outcomes.filter(o => o.status === 'fulfilled').map(o => o.value);
    const failed = outcomes.filter(o => o.status === 'rejected').map(o => o.reason);
    res.status(200).json({ success: true, message: `Campaña procesada.`, results: { successful, failed } });
});

router.post('/campaigns/send-template-with-image', async (req, res) => {
    const { contactIds, templateObject, imageUrl, phoneNumber } = req.body;
    if ((!contactIds || !contactIds.length) && !phoneNumber) return res.status(400).json({ success: false, message: 'Se requiere una lista de IDs o un número.' });
    if (!templateObject || !templateObject.name) return res.status(400).json({ success: false, message: 'Se requiere el objeto de la plantilla.' });
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });

    const targets = phoneNumber ? [phoneNumber] : contactIds;
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    const promises = targets.map(async (contactId) => {
        try {
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, templateObject, imageUrl);
            const response = await axios.post(url, payload, { headers });
            const messageId = response.data.messages[0].id;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            const contactRef = db.collection('contacts_whatsapp').doc(contactId);

            // --- INICIO DE LA CORRECCIÓN ---
            // Se combina la creación y actualización en un solo paso para manejar contactos nuevos.
            await contactRef.set({
                name: `Nuevo Contacto (${contactId.slice(-4)})`,
                wa_id: contactId,
                lastMessage: messageToSaveText,
                lastMessageTimestamp: timestamp,
                unreadCount: 0
            }, { merge: true });
            // --- FIN DE LA CORRECCIÓN ---

            await contactRef.collection('messages').add({ from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId, text: messageToSaveText, fileUrl: imageUrl, fileType: 'image/external' });
            
            return { status: 'fulfilled', value: contactId };
        } catch (error) {
            console.error(`Error en campaña con imagen a ${contactId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
            return { status: 'rejected', reason: { contactId, error: error.response ? JSON.stringify(error.response.data) : error.message } };
        }
    });
    const outcomes = await Promise.all(promises);
    const successful = outcomes.filter(o => o.status === 'fulfilled').map(o => o.value);
    const failed = outcomes.filter(o => o.status === 'rejected').map(o => o.reason);
    res.status(200).json({ success: true, message: `Campaña con imagen procesada.`, results: { successful, failed } });
});

// --- RUTAS DE PEDIDOS ---
router.post('/orders', async (req, res) => {
    const { 
        contactId,
        producto,
        telefono,
        precio,
        datosProducto,
        datosPromocion,
        comentarios,
        fotoUrls,
        fotoPromocionUrls 
    } = req.body;

    if (!contactId || !producto || !telefono) {
        return res.status(400).json({ success: false, message: 'Faltan datos obligatorios: contactId, producto y teléfono.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const orderCounterRef = db.collection('counters').doc('orders');

        const newOrderNumber = await db.runTransaction(async (transaction) => {
            const counterDoc = await transaction.get(orderCounterRef);
            let currentCounter = counterDoc.exists ? counterDoc.data().lastOrderNumber || 0 : 0;
            const nextOrderNumber = (currentCounter < 1000) ? 1001 : currentCounter + 1;
            transaction.set(orderCounterRef, { lastOrderNumber: nextOrderNumber }, { merge: true });
            return nextOrderNumber;
        });

        const nuevoPedido = {
            contactId,
            producto,
            telefono,
            precio: precio || 0,
            datosProducto: datosProducto || '',
            datosPromocion: datosPromocion || '',
            comentarios: comentarios || '',
            fotoUrls: fotoUrls || [],
            fotoPromocionUrls: fotoPromocionUrls || [],
            consecutiveOrderNumber: newOrderNumber,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            estatus: "Sin estatus",
            telefonoVerificado: false,
            estatusVerificado: false
        };

        await db.collection('pedidos').add(nuevoPedido);
        
        await contactRef.update({
            lastOrderNumber: newOrderNumber,
            lastOrderDate: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(201).json({ 
            success: true, 
            message: 'Pedido registrado con éxito.', 
            orderNumber: `DH${newOrderNumber}` 
        });

    } catch (error) {
        console.error('Error al registrar el nuevo pedido:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al registrar el pedido.' });
    }
});


// --- RUTAS DE EVENTOS DE CONVERSIÓN ---
router.post('/contacts/:contactId/mark-as-registration', async (req, res) => {
    const { contactId } = req.params;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        const contactData = contactDoc.data();
        if (contactData.registrationStatus === 'completed') return res.status(400).json({ success: false, message: 'Este contacto ya fue registrado.' });
        if (!contactData.wa_id) return res.status(500).json({ success: false, message: "Error: El contacto no tiene un ID de WhatsApp guardado." });
        const eventInfo = { wa_id: contactData.wa_id, profile: { name: contactData.name } };
        await sendConversionEvent('CompleteRegistration', eventInfo, contactData.adReferral || {});
        await contactRef.update({ registrationStatus: 'completed', registrationDate: admin.firestore.FieldValue.serverTimestamp(), status: 'venta' });
        res.status(200).json({ success: true, message: 'Contacto marcado como "Registro Completado" y etiquetado como Venta.' });
    } catch (error) {
        console.error(`Error en mark-as-registration para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar la solicitud.' });
    }
});

router.post('/contacts/:contactId/mark-as-purchase', async (req, res) => {
    const { contactId } = req.params;
    const { value } = req.body;
    if (!value || isNaN(parseFloat(value))) return res.status(400).json({ success: false, message: 'Se requiere un valor numérico válido.' });
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        const contactData = contactDoc.data();
        if (contactData.purchaseStatus === 'completed') return res.status(400).json({ success: false, message: 'Este contacto ya realizó una compra.' });
        if (!contactData.wa_id) return res.status(500).json({ success: false, message: "Error: El contacto no tiene un ID de WhatsApp guardado." });
        const eventInfo = { wa_id: contactData.wa_id, profile: { name: contactData.name } };
        await sendConversionEvent('Purchase', eventInfo, contactData.adReferral || {}, { value: parseFloat(value), currency: 'MXN' });
        await contactRef.update({ purchaseStatus: 'completed', purchaseValue: parseFloat(value), purchaseCurrency: 'MXN', purchaseDate: admin.firestore.FieldValue.serverTimestamp() });
        res.status(200).json({ success: true, message: 'Compra registrada y evento enviado a Meta.' });
    } catch (error) {
        console.error(`Error en mark-as-purchase para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar la compra.' });
    }
});

router.post('/contacts/:contactId/send-view-content', async (req, res) => {
    const { contactId } = req.params;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        const contactData = contactDoc.data();
        if (!contactData.wa_id) return res.status(500).json({ success: false, message: "Error: El contacto no tiene un ID de WhatsApp guardado." });
        const eventInfo = { wa_id: contactData.wa_id, profile: { name: contactData.name } };
        await sendConversionEvent('ViewContent', eventInfo, contactData.adReferral || {});
        res.status(200).json({ success: true, message: 'Evento ViewContent enviado.' });
    } catch (error) {
        console.error(`Error en send-view-content para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar el envío de ViewContent.' });
    }
});


// --- RUTAS DE NOTAS ---
router.post('/contacts/:contactId/notes', async (req, res) => {
    const { contactId } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    try {
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').add({ text, timestamp: admin.firestore.FieldValue.serverTimestamp() });
        res.status(201).json({ success: true, message: 'Nota guardada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al guardar la nota.' }); }
});

router.put('/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'El texto no puede estar vacío.' });
    try {
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId).update({ text });
        res.status(200).json({ success: true, message: 'Nota actualizada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al actualizar la nota.' }); }
});

router.delete('/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    try {
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId).delete();
        res.status(200).json({ success: true, message: 'Nota eliminada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar la nota.' }); }
});


// --- RUTAS DE RESPUESTAS RÁPIDAS (QUICK REPLIES) ---
router.post('/quick-replies', async (req, res) => {
    const { shortcut, message, fileUrl, fileType } = req.body;
    if (!shortcut || (!message && !fileUrl)) return res.status(400).json({ success: false, message: 'Atajo y mensaje/archivo son obligatorios.' });
    if (fileUrl && !fileType) return res.status(400).json({ success: false, message: 'Tipo de archivo es obligatorio.' });
    try {
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty) return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        const replyData = { shortcut, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        const newReply = await db.collection('quick_replies').add(replyData);
        res.status(201).json({ success: true, id: newReply.id, data: replyData });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.put('/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    const { shortcut, message, fileUrl, fileType } = req.body;
    if (!shortcut || (!message && !fileUrl)) return res.status(400).json({ success: false, message: 'Atajo y mensaje/archivo son obligatorios.' });
    if (fileUrl && !fileType) return res.status(400).json({ success: false, message: 'Tipo de archivo es obligatorio.' });
    try {
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        const updateData = { shortcut, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        await db.collection('quick_replies').doc(id).update(updateData);
        res.status(200).json({ success: true, message: 'Respuesta rápida actualizada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.delete('/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('quick_replies').doc(id).delete();
        res.status(200).json({ success: true, message: 'Respuesta rápida eliminada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});


// --- RUTAS DE ETIQUETAS (TAGS) ---
router.post('/tags', async (req, res) => {
    const { label, color, key, order } = req.body;
    if (!label || !color || !key || order === undefined) return res.status(400).json({ success: false, message: 'Faltan datos.' });
    try {
        await db.collection('crm_tags').add({ label, color, key, order });
        res.status(201).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al crear la etiqueta.' }); }
});

router.put('/tags/order', async (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ success: false, message: 'Se esperaba un array de IDs.' });
    try {
        const batch = db.batch();
        orderedIds.forEach((id, index) => batch.update(db.collection('crm_tags').doc(id), { order: index }));
        await batch.commit();
        res.status(200).json({ success: true, message: 'Orden de etiquetas actualizado.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.put('/tags/:id', async (req, res) => {
    const { id } = req.params;
    const { label, color, key } = req.body;
    if (!label || !color || !key) return res.status(400).json({ success: false, message: 'Faltan datos.' });
    try {
        await db.collection('crm_tags').doc(id).update({ label, color, key });
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al actualizar la etiqueta.' }); }
});

router.delete('/tags/:id', async (req, res) => {
    try {
        await db.collection('crm_tags').doc(req.params.id).delete();
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar la etiqueta.' }); }
});

router.delete('/tags', async (req, res) => {
    try {
        const snapshot = await db.collection('crm_tags').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar todas las etiquetas.' }); }
});


// --- RUTAS DE RESPUESTAS DE ANUNCIOS (AD RESPONSES) ---
router.post('/ad-responses', async (req, res) => {
    const { adName, adId, message, fileUrl, fileType } = req.body;
    if (!adName || !adId || (!message && !fileUrl)) return res.status(400).json({ success: false, message: 'Datos incompletos.' });
    try {
        const existing = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
        if (!existing.empty) return res.status(409).json({ success: false, message: `El Ad ID '${adId}' ya existe.` });
        const data = { adName, adId, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        const newResponse = await db.collection('ad_responses').add(data);
        res.status(201).json({ success: true, id: newResponse.id, data });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.put('/ad-responses/:id', async (req, res) => {
    const { id } = req.params;
    const { adName, adId, message, fileUrl, fileType } = req.body;
    if (!adName || !adId || (!message && !fileUrl)) return res.status(400).json({ success: false, message: 'Datos incompletos.' });
    try {
        const existing = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) return res.status(409).json({ success: false, message: `El Ad ID '${adId}' ya está en uso.` });
        const data = { adName, adId, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        await db.collection('ad_responses').doc(id).update(data);
        res.status(200).json({ success: true, message: 'Mensaje de anuncio actualizado.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.delete('/ad-responses/:id', async (req, res) => {
    try {
        await db.collection('ad_responses').doc(req.params.id).delete();
        res.status(200).json({ success: true, message: 'Mensaje de anuncio eliminado.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});


// --- RUTAS DE PROMPTS DE IA POR ANUNCIO ---
router.post('/ai-ad-prompts', async (req, res) => {
    const { adName, adId, prompt } = req.body;
    if (!adName || !adId || !prompt) return res.status(400).json({ success: false, message: 'Datos incompletos.' });
    try {
        const existing = await db.collection('ai_ad_prompts').where('adId', '==', adId).limit(1).get();
        if (!existing.empty) return res.status(409).json({ success: false, message: `El Ad ID '${adId}' ya tiene un prompt.` });
        const newPrompt = await db.collection('ai_ad_prompts').add({ adName, adId, prompt });
        res.status(201).json({ success: true, id: newPrompt.id });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.put('/ai-ad-prompts/:id', async (req, res) => {
    const { id } = req.params;
    const { adName, adId, prompt } = req.body;
    if (!adName || !adId || !prompt) return res.status(400).json({ success: false, message: 'Datos incompletos.' });
    try {
        const existing = await db.collection('ai_ad_prompts').where('adId', '==', adId).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) return res.status(409).json({ success: false, message: `El Ad ID '${adId}' ya está en uso.` });
        await db.collection('ai_ad_prompts').doc(id).update({ adName, adId, prompt });
        res.status(200).json({ success: true, message: 'Prompt actualizado.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.delete('/ai-ad-prompts/:id', async (req, res) => {
    try {
        await db.collection('ai_ad_prompts').doc(req.params.id).delete();
        res.status(200).json({ success: true, message: 'Prompt eliminado.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});


// --- RUTAS DE AJUSTES (SETTINGS) ---
router.get('/bot/settings', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('bot').get();
        res.status(200).json({ success: true, settings: doc.exists ? doc.data() : { instructions: '' } });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al obtener ajustes.' }); }
});

router.post('/bot/settings', async (req, res) => {
    try {
        await db.collection('crm_settings').doc('bot').set({ instructions: req.body.instructions });
        res.status(200).json({ success: true, message: 'Ajustes guardados.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al guardar ajustes.' }); }
});

router.post('/bot/toggle', async (req, res) => {
    try {
        await db.collection('contacts_whatsapp').doc(req.body.contactId).update({ botActive: req.body.isActive });
        res.status(200).json({ success: true, message: `Bot ${req.body.isActive ? 'activado' : 'desactivado'}.` });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al actualizar estado del bot.' }); }
});

router.get('/settings/away-message', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        res.status(200).json({ success: true, settings: { isActive: doc.exists ? doc.data().awayMessageActive : true } });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al obtener ajustes.' }); }
});

router.post('/settings/away-message', async (req, res) => {
    try {
        await db.collection('crm_settings').doc('general').set({ awayMessageActive: req.body.isActive }, { merge: true });
        res.status(200).json({ success: true, message: 'Ajustes guardados.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al guardar ajustes.' }); }
});

router.get('/settings/global-bot', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        res.status(200).json({ success: true, settings: { isActive: doc.exists ? doc.data().globalBotActive : false } });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al obtener ajustes.' }); }
});

router.post('/settings/global-bot', async (req, res) => {
    try {
        await db.collection('crm_settings').doc('general').set({ globalBotActive: req.body.isActive }, { merge: true });
        res.status(200).json({ success: true, message: 'Ajustes guardados.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al guardar ajustes.' }); }
});

router.get('/settings/google-sheet', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        res.status(200).json({ success: true, settings: { googleSheetId: doc.exists ? doc.data().googleSheetId : '' } });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al obtener ajustes.' }); }
});

router.post('/settings/google-sheet', async (req, res) => {
    try {
        await db.collection('crm_settings').doc('general').set({ googleSheetId: req.body.googleSheetId }, { merge: true });
        res.status(200).json({ success: true, message: 'ID de Google Sheet guardado.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al guardar.' }); }
});

// --- RUTAS DE BASE DE CONOCIMIENTO (KNOWLEDGE BASE) ---
router.post('/knowledge-base', async (req, res) => {
    const { topic, answer, fileUrl, fileType } = req.body;
    if (!topic || !answer) return res.status(400).json({ success: false, message: 'Tema y respuesta son obligatorios.' });
    try {
        const data = { topic, answer, fileUrl: fileUrl || null, fileType: fileType || null };
        const newEntry = await db.collection('ai_knowledge_base').add(data);
        res.status(201).json({ success: true, id: newEntry.id, data });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.put('/knowledge-base/:id', async (req, res) => {
    const { id } = req.params;
    const { topic, answer, fileUrl, fileType } = req.body;
    if (!topic || !answer) return res.status(400).json({ success: false, message: 'Tema y respuesta son obligatorios.' });
    try {
        const data = { topic, answer, fileUrl: fileUrl || null, fileType: fileType || null };
        await db.collection('ai_knowledge_base').doc(id).update(data);
        res.status(200).json({ success: true, message: 'Entrada actualizada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

router.delete('/knowledge-base/:id', async (req, res) => {
    try {
        await db.collection('ai_knowledge_base').doc(req.params.id).delete();
        res.status(200).json({ success: true, message: 'Entrada eliminada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

// --- RUTAS DE IA Y SIMULACIÓN ---
router.post('/contacts/:contactId/generate-reply', async (req, res) => {
    const { contactId } = req.params;
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        const messagesSnapshot = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        if (messagesSnapshot.empty) return res.status(400).json({ success: false, message: 'No hay mensajes.' });
        const conversationHistory = messagesSnapshot.docs.map(doc => `${doc.data().from === contactId ? 'Cliente' : 'Asistente'}: ${doc.data().text}`).reverse().join('\\n');
        const prompt = `Eres un asistente virtual amigable y servicial para un CRM de ventas. Tu objetivo es ayudar a cerrar ventas y resolver dudas. Responde al último mensaje del cliente de manera concisa y profesional.\n\n--- Historial ---\n${conversationHistory}\n\n--- Tu Respuesta ---\nAsistente:`;
        const suggestion = await generateGeminiResponse(prompt);
        res.status(200).json({ success: true, message: 'Respuesta generada.', suggestion });
    } catch (error) {
        console.error('Error al generar respuesta con IA:', error);
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

router.post('/test/simulate-ad-message', async (req, res) => {
    const { from, adId, text } = req.body;
    if (!from || !adId || !text) return res.status(400).json({ success: false, message: 'Faltan parámetros.' });
    const fakePayload = {
        object: 'whatsapp_business_account',
        entry: [{
            id: WHATSAPP_BUSINESS_ACCOUNT_ID,
            changes: [{
                value: {
                    messaging_product: 'whatsapp',
                    metadata: { display_phone_number: PHONE_NUMBER_ID.slice(2), phone_number_id: PHONE_NUMBER_ID },
                    contacts: [{ profile: { name: `Test User ${from.slice(-4)}` }, wa_id: from }],
                    messages: [{
                        from, id: `wamid.TEST_${uuidv4()}`, timestamp: Math.floor(Date.now() / 1000).toString(),
                        text: { body: text }, type: 'text',
                        referral: { source_url: `https://fb.me/xxxxxxxx`, source_type: 'ad', source_id: adId, headline: 'Anuncio de Prueba' }
                    }]
                },
                field: 'messages'
            }]
        }]
    };
    try {
        console.log(`[SIMULATOR] Recibida simulación para ${from} desde Ad ID ${adId}.`);
        // Se asume que el webhook está en la raíz, no en /webhook
        await axios.post(`http://localhost:${PORT}/webhook`, fakePayload, { headers: { 'Content-Type': 'application/json' } });
        console.log(`[SIMULATOR] Simulación enviada al webhook con éxito.`);
        res.status(200).json({ success: true, message: 'Simulación procesada.' });
    } catch (error) {
        console.error('❌ ERROR EN EL SIMULADOR:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Error interno al procesar la simulación.' });
    }
});

// --- RUTA DE MÉTRICAS ---
router.get('/metrics', async (req, res) => {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);
        const contactsSnapshot = await db.collection('contacts_whatsapp').get();
        const contactTags = {};
        contactsSnapshot.forEach(doc => { contactTags[doc.id] = doc.data().status || 'sin_etiqueta'; });
        const messagesSnapshot = await db.collectionGroup('messages')
            .where('timestamp', '>=', startTimestamp).where('timestamp', '<=', endTimestamp)
            .where('from', '!=', PHONE_NUMBER_ID).get();
        const metricsByDate = {};
        messagesSnapshot.forEach(doc => {
            const message = doc.data();
            const dateKey = message.timestamp.toDate().toISOString().split('T')[0];
            if (!metricsByDate[dateKey]) metricsByDate[dateKey] = { totalMessages: 0, tags: {} };
            metricsByDate[dateKey].totalMessages++;
            const tag = contactTags[doc.ref.parent.parent.id] || 'sin_etiqueta';
            if (!metricsByDate[dateKey].tags[tag]) metricsByDate[dateKey].tags[tag] = 0;
            metricsByDate[dateKey].tags[tag]++;
        });
        const formattedMetrics = Object.keys(metricsByDate)
            .map(date => ({ date, totalMessages: metricsByDate[date].totalMessages, tags: metricsByDate[date].tags }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        res.status(200).json({ success: true, data: formattedMetrics });
    } catch (error) {
        console.error('❌ Error al obtener las métricas:', error);
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

// --- NUEVAS RUTAS DE DIFUSIÓN ---

// Verificar un número de pedido y obtener datos del cliente
router.get('/orders/verify/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const isPhoneNumber = /^\d{10,}$/.test(orderId.replace(/\D/g, ''));
    if (isPhoneNumber) {
        return res.status(200).json({ success: true, contactId: orderId, customerName: 'N/A' });
    }

    const match = orderId.match(/(\d+)/);
    if (!match) {
        return res.status(400).json({ success: false, message: 'Formato de ID de pedido inválido. Se esperaba "DH" seguido de números.' });
    }
    const consecutiveOrderNumber = parseInt(match[1], 10);

    try {
        const ordersQuery = db.collection('pedidos').where('consecutiveOrderNumber', '==', consecutiveOrderNumber).limit(1);
        const snapshot = await ordersQuery.get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }

        const pedidoData = snapshot.docs[0].data();
        const contactId = pedidoData.telefono;

        if (!contactId) {
            return res.status(404).json({ success: false, message: 'El pedido no tiene un número de teléfono asociado.' });
        }

        const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
        const customerName = contactDoc.exists ? contactDoc.data().name : 'Cliente no en CRM';

        res.status(200).json({ success: true, contactId, customerName });

    } catch (error) {
        console.error(`Error al verificar el pedido ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al verificar el pedido.' });
    }
});

// Enviar una campaña de difusión masiva
router.post('/difusion/bulk-send', async (req, res) => {
    const { jobs, messageSequence, contingencyTemplate } = req.body;
    
    if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
        return res.status(400).json({ success: false, message: 'La lista de trabajos de envío es inválida.' });
    }
    
    const results = { successful: [], failed: [], contingent: [] };

    for (const job of jobs) {
        if (!job.contactId || !job.orderId || !job.photoUrl) {
            results.failed.push({ orderId: job.orderId, reason: 'Datos del trabajo incompletos.' });
            continue;
        }

        try {
            const contactRef = db.collection('contacts_whatsapp').doc(job.contactId);
            const contactDoc = await contactRef.get();

            // --- INICIO DE LA CORRECCIÓN ---
            // Si el contacto no existe, lo crea en lugar de fallar.
            if (!contactDoc.exists) {
                console.log(`[DIFUSION] El contacto ${job.contactId} no existe. Creando nuevo registro.`);
                await contactRef.set({
                    name: `Nuevo Contacto (${job.contactId.slice(-4)})`,
                    wa_id: job.contactId,
                    lastMessage: 'Inicio de conversación por difusión.',
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`[DIFUSION] Contacto ${job.contactId} creado.`);
            }
            // --- FIN DE LA CORRECCIÓN ---


            // CORRECCIÓN: Buscar el último mensaje enviado POR EL CLIENTE.
            const messagesSnapshot = await contactRef.collection('messages')
                .where('from', '==', job.contactId)
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();

            let isWithin24Hours = false;
            if (!messagesSnapshot.empty) {
                const lastMessageTimestamp = messagesSnapshot.docs[0].data().timestamp.toMillis();
                const now = Date.now();
                const hoursDiff = (now - lastMessageTimestamp) / (1000 * 60 * 60);
                if (hoursDiff <= 24) {
                    isWithin24Hours = true;
                }
            }

            if (isWithin24Hours) {
                let lastMessageText = '';
                // --- INICIO DE LA CORRECCIÓN ---
                if (messageSequence && messageSequence.length > 0) {
                    for (const qr of messageSequence) {
                        const sentMessageData = await sendAdvancedWhatsAppMessage(job.contactId, { text: qr.message, fileUrl: qr.fileUrl, fileType: qr.fileType });
                        
                        // AGREGADO: Guardar mensaje de la secuencia en la BD
                        const messageToSave = {
                            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            id: sentMessageData.id, text: sentMessageData.textForDb, isAutoReply: true
                        };
                        await contactRef.collection('messages').add(messageToSave);
                        lastMessageText = sentMessageData.textForDb;
                        
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
                
                const sentPhotoData = await sendAdvancedWhatsAppMessage(job.contactId, { text: null, fileUrl: job.photoUrl, fileType: 'image/jpeg' });
                
                // AGREGADO: Guardar mensaje de la foto en la BD
                const photoMessageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: sentPhotoData.id, text: sentPhotoData.textForDb, fileUrl: sentPhotoData.fileUrlForDb, 
                    fileType: sentPhotoData.fileTypeForDb, isAutoReply: true
                };
                Object.keys(photoMessageToSave).forEach(key => photoMessageToSave[key] == null && delete photoMessageToSave[key]);
                await contactRef.collection('messages').add(photoMessageToSave);
                lastMessageText = sentPhotoData.textForDb;

                // AGREGADO: Actualizar el último mensaje del contacto
                await contactRef.update({
                    lastMessage: lastMessageText,
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                results.successful.push({ orderId: job.orderId });
                // --- FIN DE LA CORRECCIÓN ---
            } else {
                if (!contingencyTemplate || !contingencyTemplate.name) {
                    results.failed.push({ orderId: job.orderId, reason: 'Fuera de 24h y no se proporcionó plantilla de contingencia.' });
                    continue;
                }

                const bodyParams = [job.orderId];
                const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(job.contactId, contingencyTemplate, job.photoUrl, bodyParams);
                
                const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
                });

                const messageId = response.data.messages[0].id;
                const messageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: messageId, text: messageToSaveText, isAutoReply: true
                };
                await contactRef.collection('messages').add(messageToSave);
                await contactRef.update({
                    lastMessage: messageToSaveText,
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                
                await db.collection('contingentSends').add({
                    contactId: job.contactId,
                    status: 'pending',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    payload: { 
                        messageSequence: messageSequence || [], 
                        photoUrl: job.photoUrl, 
                        orderId: job.orderId 
                    }
                });
                results.contingent.push({ orderId: job.orderId });
            }
        } catch (error) {
            console.error(`Error procesando el trabajo para el pedido ${job.orderId}:`, error.response ? error.response.data : error.message);
            results.failed.push({ orderId: job.orderId, reason: error.message || 'Error desconocido' });
        }
    }

    res.status(200).json({ success: true, message: 'Proceso de envío masivo completado.', results });
});


module.exports = router;
