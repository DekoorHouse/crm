const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const FormData = require('form-data');
const path = require('path');
// --- INICIO DE MODIFICACIÓN: Se añaden librerías para manejo de archivos y video ---
const fs = require('fs');
const tmp = require('tmp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Configurar la ruta de ffmpeg para que la librería pueda encontrarlo
ffmpeg.setFfmpegPath(ffmpegPath);
// --- FIN DE MODIFICACIÓN ---

const { db, admin, bucket } = require('./config');
const { sendConversionEvent, generateGeminiResponse, sendAdvancedWhatsAppMessage } = require('./services');

const router = express.Router();

// --- CONSTANTES ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const PORT = process.env.PORT || 3000;
// --- INICIO: NUEVAS CONSTANTES PARA COMPRESIÓN ---
const VIDEO_SIZE_LIMIT_MB = 15.5; // Límite seguro de 15.5MB (el de WhatsApp es 16MB)
const VIDEO_SIZE_LIMIT_BYTES = VIDEO_SIZE_LIMIT_MB * 1024 * 1024;
const TARGET_BITRATE = '1000k'; // Bitrate objetivo de 1 Mbps para la compresión
// --- FIN: NUEVAS CONSTANTES ---

// --- INICIO: NUEVA FUNCIÓN DE COMPRESIÓN DE VIDEO ---
/**
 * Comprime un búfer de video si excede el límite de tamaño de WhatsApp.
 * @param {Buffer} inputBuffer El búfer de video a procesar.
 * @param {string} mimeType El tipo MIME del video.
 * @returns {Promise<Buffer>} Una promesa que se resuelve con el búfer de video (potencialmente comprimido).
 */
function compressVideoIfNeeded(inputBuffer, mimeType) {
    return new Promise((resolve, reject) => {
        // Si no es un video o ya está dentro del límite, no hacer nada
        if (!mimeType.startsWith('video/') || inputBuffer.length <= VIDEO_SIZE_LIMIT_BYTES) {
            console.log(`[COMPRESSOR] El archivo no es un video o está dentro del límite (${(inputBuffer.length / 1024 / 1024).toFixed(2)} MB). Omitiendo compresión.`);
            return resolve(inputBuffer);
        }

        console.log(`[COMPRESSOR] El video excede el límite (${(inputBuffer.length / 1024 / 1024).toFixed(2)} MB > ${VIDEO_SIZE_LIMIT_MB} MB). Iniciando compresión.`);

        const tempInput = tmp.fileSync({ postfix: '.mp4' });
        const tempOutput = tmp.fileSync({ postfix: '.mp4' });

        fs.writeFile(tempInput.name, inputBuffer, (err) => {
            if (err) {
                tempInput.removeCallback();
                tempOutput.removeCallback();
                return reject(err);
            }

            ffmpeg(tempInput.name)
                .outputOptions([
                    '-c:v libx264',
                    `-b:v ${TARGET_BITRATE}`,
                    '-c:a aac',
                    '-b:a 128k',
                    '-preset ultrafast', // Prioriza la velocidad sobre la calidad de compresión
                    '-crf 28'
                ])
                .on('end', () => {
                    console.log('[COMPRESSOR] Procesamiento con FFmpeg finalizado.');
                    fs.readFile(tempOutput.name, (err, compressedBuffer) => {
                        tempInput.removeCallback();
                        tempOutput.removeCallback();
                        if (err) return reject(err);
                        console.log(`[COMPRESSOR] Compresión exitosa. Nuevo tamaño: ${(compressedBuffer.length / 1024 / 1024).toFixed(2)} MB.`);
                        resolve(compressedBuffer);
                    });
                })
                .on('error', (err) => {
                    console.error('[COMPRESSOR] Error de FFmpeg:', err);
                    tempInput.removeCallback();
                    tempOutput.removeCallback();
                    reject(new Error('No se pudo comprimir el video. ' + err.message));
                })
                .save(tempOutput.name);
        });
    });
}
// --- FIN: NUEVA FUNCIÓN ---

// --- INICIO: NUEVA FUNCIÓN PARA CONVERSIÓN DE AUDIO ---
/**
 * Convierte un búfer de audio a formato OGG con códec Opus para ser enviado como nota de voz.
 * @param {Buffer} inputBuffer El búfer de audio a procesar.
 * @param {string} mimeType El tipo MIME original del audio.
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} Una promesa que resuelve con el búfer (potencialmente convertido) y el nuevo tipo MIME.
 */
function convertAudioToOggOpusIfNeeded(inputBuffer, mimeType) {
    return new Promise((resolve) => { // No rechaza, siempre resuelve.
        if (!mimeType.startsWith('audio/') || mimeType === 'audio/ogg') {
            return resolve({ buffer: inputBuffer, mimeType: mimeType });
        }

        console.log(`[AUDIO CONVERTER] Convirtiendo audio de ${mimeType} a OGG Opus.`);
        const tempInput = tmp.fileSync({ postfix: `.${mimeType.split('/')[1] || 'tmp'}` });
        const tempOutput = tmp.fileSync({ postfix: '.ogg' });

        fs.writeFile(tempInput.name, inputBuffer, (err) => {
            if (err) {
                tempInput.removeCallback();
                tempOutput.removeCallback();
                console.warn(`[AUDIO CONVERTER] Fallo al escribir archivo temporal. Se enviará como archivo estándar.`);
                return resolve({ buffer: inputBuffer, mimeType: mimeType });
            }

            ffmpeg(tempInput.name)
                .outputOptions(['-c:a libopus', '-b:a 16k', '-vbr off', '-ar 16000'])
                .on('end', () => {
                    fs.readFile(tempOutput.name, (err, convertedBuffer) => {
                        tempInput.removeCallback();
                        tempOutput.removeCallback();
                        if (err) {
                             console.warn(`[AUDIO CONVERTER] Fallo al leer archivo convertido. Se enviará como archivo estándar.`);
                             return resolve({ buffer: inputBuffer, mimeType: mimeType });
                        }
                        console.log(`[AUDIO CONVERTER] Conversión a OGG Opus exitosa.`);
                        resolve({ buffer: convertedBuffer, mimeType: 'audio/ogg' });
                    });
                })
                .on('error', (err) => {
                    tempInput.removeCallback();
                    tempOutput.removeCallback();
                    console.warn(`[AUDIO CONVERTER] Falló la conversión a OGG: ${err.message}. Se enviará como archivo de audio estándar.`);
                    resolve({ buffer: inputBuffer, mimeType: mimeType });
                })
                .save(tempOutput.name);
        });
    });
}
// --- FIN: NUEVA FUNCIÓN ---


/**
 * Sube un archivo multimedia a los servidores de WhatsApp y devuelve su ID.
 * MODIFICADO: Añade compresión de video y conversión de audio antes de la subida.
 * @param {string} mediaUrl La URL pública del archivo.
 * @param {string} mimeType El tipo MIME del archivo (ej. 'video/mp4').
 * @returns {Promise<string>} El ID del medio asignado por WhatsApp.
 */
async function uploadMediaToWhatsApp(mediaUrl, mimeType) {
    try {
        console.log(`[MEDIA UPLOAD] Descargando ${mediaUrl} para procesar y subir...`);
        const fileResponse = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
        let fileBuffer = fileResponse.data;
        let finalMimeType = mimeType;
        const fileName = path.basename(new URL(mediaUrl).pathname) || `media.${mimeType.split('/')[1] || 'bin'}`;

        // --- INICIO: PASO DE COMPRESIÓN/CONVERSIÓN AÑADIDO ---
        if (mimeType.startsWith('video/')) {
            fileBuffer = await compressVideoIfNeeded(fileBuffer, mimeType);
        } else if (mimeType.startsWith('audio/')) {
            const conversionResult = await convertAudioToOggOpusIfNeeded(fileBuffer, mimeType);
            fileBuffer = conversionResult.buffer;
            finalMimeType = conversionResult.mimeType;
        }
        // --- FIN: PASO DE COMPRESIÓN/CONVERSIÓN AÑADIDO ---

        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', fileBuffer, {
            filename: fileName,
            contentType: finalMimeType,
        });

        console.log(`[MEDIA UPLOAD] Subiendo ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB) a WhatsApp...`);
        const uploadResponse = await axios.post(
            `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/media`,
            form,
            {
                headers: { ...form.getHeaders(), 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                maxContentLength: Infinity, maxBodyLength: Infinity,
            }
        );

        const mediaId = uploadResponse.data.id;
        if (!mediaId) throw new Error("La API de WhatsApp no devolvió un ID de medio.");

        console.log(`[MEDIA UPLOAD] Archivo subido con éxito. Media ID: ${mediaId}`);
        return mediaId;

    } catch (error) {
        console.error('❌ Error al subir archivo a WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw new Error('No se pudo subir el archivo a los servidores de WhatsApp.');
    }
}


async function buildAdvancedTemplatePayload(contactId, templateObject, imageUrl = null, bodyParams = []) {
    // ... (el resto de la función no necesita cambios)
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
        payloadComponents.push({ type: 'header', parameters: [{ type: 'text', text: contactName }] });
    }

    const bodyDef = templateComponents?.find(c => c.type === 'BODY');
    if (bodyDef) {
        const matches = bodyDef.text?.match(/\{\{\d\}\}/g);
        if (matches) {
            const allParams = [contactName, ...bodyParams];
            const parameters = allParams.slice(0, matches.length).map(param => ({ type: 'text', text: String(param) }));
            
            payloadComponents.push({ type: 'body', parameters });
            
            let tempText = bodyDef.text;
            parameters.forEach((param, index) => {
                tempText = tempText.replace(`{{${index + 1}}}`, param.text);
            });
            messageToSaveText = tempText;

        } else {
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


// --- El resto de las rutas no necesitan cambios ---
// ... (todas las demás rutas permanecen igual) ...
router.get('/contacts', async (req, res) => {
    try {
        const { limit = 30, startAfterId, tag } = req.query;
        let query = db.collection('contacts_whatsapp');

        if (tag) {
            query = query.where('status', '==', tag);
        }

        query = query.orderBy('lastMessageTimestamp', 'desc').limit(Number(limit));
        
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

        if (lowercaseQuery.startsWith('dh') && /dh\d+/.test(lowercaseQuery)) {
            const orderNumber = parseInt(lowercaseQuery.replace('dh', ''), 10);
            if (!isNaN(orderNumber)) {
                const orderSnapshot = await db.collection('pedidos').where('consecutiveOrderNumber', '==', orderNumber).limit(1).get();
                if (!orderSnapshot.empty) {
                    const orderData = orderSnapshot.docs[0].data();
                    const contactId = orderData.telefono;
                    if (contactId) {
                        const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
                        if (contactDoc.exists && !searchResults.some(c => c.id === contactDoc.id)) {
                            searchResults.push({ id: contactDoc.id, ...contactDoc.data() });
                        }
                    }
                }
            }
        }

        const phoneDoc = await db.collection('contacts_whatsapp').doc(query).get();
        if (phoneDoc.exists && !searchResults.some(c => c.id === phoneDoc.id)) {
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

router.get('/contacts/:contactId/orders', async (req, res) => {
    try {
        const { contactId } = req.params;
        
        const snapshot = await db.collection('pedidos')
                                 .where('telefono', '==', contactId)
                                 .get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, orders: [] });
        }

        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                consecutiveOrderNumber: data.consecutiveOrderNumber,
                producto: data.producto,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                estatus: data.estatus || 'Sin estatus'
            };
        });

        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.status(200).json({ success: true, orders });
    } catch (error) {
        console.error(`Error al obtener el historial de pedidos para ${req.params.contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener el historial de pedidos.' });
    }
});

router.post('/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid, template, tempId } = req.body;
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    if (!text && !fileUrl && !template) return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        let messageToSave;
        let messageId;

        if (template) {
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template, null, []);
            if (reply_to_wamid) payload.context = { message_id: reply_to_wamid };
            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
            });
            messageId = response.data.messages[0].id;
            messageToSave = { from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(), id: messageId, text: messageToSaveText };

        } else if (fileUrl && fileType) {
            if (fileUrl && fileUrl.includes(bucket.name)) {
                try {
                    const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                    await bucket.file(filePath).makePublic();
                    console.log(`[GCS-CHAT] Archivo ${filePath} hecho público para envío.`);
                } catch (gcsError) {
                    console.error(`[GCS-CHAT] Advertencia: No se pudo hacer público el archivo ${fileUrl}:`, gcsError.message);
                }
            }
            
            const mediaId = await uploadMediaToWhatsApp(fileUrl, fileType);

            const type = fileType.startsWith('image/') ? 'image' :
                         fileType.startsWith('video/') ? 'video' :
                         fileType.startsWith('audio/') ? 'audio' : 'document';
            
            const messagePayload = {
                messaging_product: 'whatsapp',
                to: contactId,
                type: type,
                [type]: {
                    id: mediaId,
                    caption: text || ''
                }
            };
            if (reply_to_wamid) {
                messagePayload.context = { message_id: reply_to_wamid };
            }

            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, messagePayload, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            messageId = response.data.messages[0].id;

            const messageTextForDb = text || (type === 'video' ? '🎥 Video' : '📎 Archivo');
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: messageTextForDb, fileUrl: fileUrl, fileType: fileType
            };

        } else {
            const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text, reply_to_wamid });
            messageId = sentMessageData.id;
            messageToSave = { from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(), id: messageId, text: sentMessageData.textForDb };
        }

        if (reply_to_wamid) messageToSave.context = { id: reply_to_wamid };
        Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);
        const messageRef = tempId ? contactRef.collection('messages').doc(tempId) : contactRef.collection('messages').doc();
        await messageRef.set(messageToSave);
        await contactRef.update({ lastMessage: messageToSave.text, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), unreadCount: 0 });
        
        res.status(200).json({ success: true, message: 'Mensaje(s) enviado(s).' });
    } catch (error) {
        console.error('❌ Error al enviar mensaje/plantilla de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar el mensaje a través de WhatsApp.' });
    }
});
// ... (resto de las rutas sin cambios)
router.post('/contacts/:contactId/queue-message', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid } = req.body;

    if (!text && !fileUrl) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        
        let messageToSaveText = text;
        if (fileUrl && !text) {
            const type = fileType.startsWith('image/') ? 'image' :
                         fileType.startsWith('video/') ? 'video' :
                         fileType.startsWith('audio/') ? 'audio' : 'document';
            messageToSaveText = (type === 'video' ? '🎥 Video' : type === 'image' ? '📷 Imagen' : '📎 Archivo');
        }

        const messageToSave = {
            from: PHONE_NUMBER_ID,
            status: 'queued',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            text: messageToSaveText,
            fileUrl: fileUrl || null,
            fileType: fileType || null,
        };

        if (reply_to_wamid) {
            messageToSave.context = { id: reply_to_wamid };
        }

        await contactRef.collection('messages').add(messageToSave);
        
        await contactRef.update({
            lastMessage: `[En cola] ${messageToSave.text}`,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.status(200).json({ success: true, message: 'Mensaje encolado con éxito.' });

    } catch (error) {
        console.error('❌ Error al encolar mensaje:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error del servidor al encolar el mensaje.' });
    }
});

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
            const firestoreTimestamp = admin.firestore.Timestamp.fromMillis(parseInt(before) * 1000);
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

            await contactRef.set({
                name: `Nuevo Contacto (${contactId.slice(-4)})`,
                wa_id: contactId,
                lastMessage: messageToSaveText,
                lastMessageTimestamp: timestamp,
                unreadCount: 0
            }, { merge: true });

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

router.post('/storage/generate-signed-url', async (req, res) => {
    const { fileName, contentType, pathPrefix } = req.body;
    if (!fileName || !contentType || !pathPrefix) {
        return res.status(400).json({ success: false, message: 'Faltan fileName, contentType o pathPrefix.' });
    }

    const filePath = `${pathPrefix}/${Date.now()}_${fileName.replace(/\s/g, '_')}`;
    const file = bucket.file(filePath);

    const options = {
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType: contentType,
    };

    try {
        const [signedUrl] = await file.getSignedUrl(options);
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

        res.status(200).json({
            success: true,
            signedUrl,
            publicUrl,
        });
    } catch (error) {
        console.error('Error al generar la URL firmada:', error);
        res.status(500).json({ success: false, message: 'No se pudo generar la URL para la subida.' });
    }
});


router.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const docRef = db.collection('pedidos').doc(orderId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }
        res.status(200).json({ success: true, order: { id: doc.id, ...doc.data() } });
    } catch (error) {
        console.error('Error fetching single order:', error);
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

router.put('/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const updateData = req.body;

    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Falta el ID del pedido.' });
    }

    try {
        const orderRef = db.collection('pedidos').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }

        const existingData = orderDoc.data();

        // Manejar la eliminación de fotos de Storage
        const existingPhotos = new Set([
            ...(existingData.fotoUrls || []), 
            ...(existingData.fotoPromocionUrls || [])
        ]);
        const updatedPhotos = new Set([
            ...(updateData.fotoUrls || []), 
            ...(updateData.fotoPromocionUrls || [])
        ]);

        const photosToDelete = [...existingPhotos].filter(url => !updatedPhotos.has(url));
        
        const deletePromises = photosToDelete.map(url => {
            try {
                const filePath = new URL(url).pathname.split('/').slice(2).join('/');
                return bucket.file(decodeURIComponent(filePath)).delete().catch(err => console.warn(`No se pudo eliminar la foto antigua ${url}:`, err.message));
            } catch (error) {
                console.warn(`URL de foto inválida, no se puede eliminar de storage: ${url}`);
                return Promise.resolve();
            }
        });

        await Promise.all(deletePromises);

        await orderRef.update(updateData);

        res.status(200).json({ success: true, message: 'Pedido actualizado con éxito.' });

    } catch (error) {
        console.error(`Error al actualizar el pedido ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el pedido.' });
    }
});

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


router.post('/quick-replies', async (req, res) => {
    const { shortcut, message, fileUrl, fileType } = req.body;
    if (!shortcut || (!message && !fileUrl)) return res.status(400).json({ success: false, message: 'Atajo y mensaje/archivo son obligatorios.' });
    if (fileUrl && !fileType) return res.status(400).json({ success: false, message: 'Tipo de archivo es obligatorio.' });
    try {
        if (fileUrl && fileUrl.includes(bucket.name)) {
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(filePath).makePublic();
                console.log(`[GCS-QR] Archivo ${filePath} hecho público con éxito.`);
            } catch (gcsError) {
                console.error(`[GCS-QR] No se pudo hacer público el archivo ${fileUrl}:`, gcsError);
            }
        }

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
        if (fileUrl && fileUrl.includes(bucket.name)) {
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(filePath).makePublic();
                console.log(`[GCS-QR] Archivo ${filePath} hecho público con éxito.`);
            } catch (gcsError) {
                console.error(`[GCS-QR] No se pudo hacer público el archivo ${fileUrl}:`, gcsError);
            }
        }

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


router.post('/ad-responses', async (req, res) => {
    const { adName, adId, message, fileUrl, fileType } = req.body;
    if (!adName || !adId || (!message && !fileUrl)) return res.status(400).json({ success: false, message: 'Datos incompletos.' });
    try {
        if (fileUrl && fileUrl.includes(bucket.name)) {
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(filePath).makePublic();
                console.log(`[GCS] Archivo ${filePath} hecho público con éxito.`);
            } catch (gcsError) {
                console.error(`[GCS] No se pudo hacer público el archivo ${fileUrl}:`, gcsError);
            }
        }
        
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
        if (fileUrl && fileUrl.includes(bucket.name)) {
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(filePath).makePublic();
                console.log(`[GCS] Archivo ${filePath} hecho público con éxito.`);
            } catch (gcsError) {
                console.error(`[GCS] No se pudo hacer público el archivo ${fileUrl}:`, gcsError);
            }
        }

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
    } catch (error) { res.status(500).json({ success: false, message: 'Error al actualizar el prompt.' }); }
});

router.delete('/ai-ad-prompts/:id', async (req, res) => {
    try {
        await db.collection('ai_ad_prompts').doc(req.params.id).delete();
        res.status(200).json({ success: true, message: 'Prompt eliminado.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar el prompt.' }); }
});


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
        await axios.post(`http://localhost:${PORT}/webhook`, fakePayload, { headers: { 'Content-Type': 'application/json' } });
        console.log(`[SIMULATOR] Simulación enviada al webhook con éxito.`);
        res.status(200).json({ success: true, message: 'Simulación procesada.' });
    } catch (error) {
        console.error('❌ ERROR EN EL SIMULADOR:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Error interno al procesar la simulación.' });
    }
});

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
            .where('timestamp', '>=', startTimestamp)
            .where('timestamp', '<=', endTimestamp)
            .get();
        
        const metricsByDate = {};
        messagesSnapshot.forEach(doc => {
            const message = doc.data();
            
            if (message.from === PHONE_NUMBER_ID) {
                return;
            }

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
                if (messageSequence && messageSequence.length > 0) {
                    for (const qr of messageSequence) {
                        const sentMessageData = await sendAdvancedWhatsAppMessage(job.contactId, { text: qr.message, fileUrl: qr.fileUrl, fileType: qr.fileType });
                        
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
                
                const photoMessageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: sentPhotoData.id, text: sentPhotoData.textForDb, fileUrl: sentPhotoData.fileUrlForDb, 
                    fileType: sentPhotoData.fileTypeForDb, isAutoReply: true
                };
                Object.keys(photoMessageToSave).forEach(key => photoMessageToSave[key] == null && delete photoMessageToSave[key]);
                await contactRef.collection('messages').add(photoMessageToSave);
                lastMessageText = sentPhotoData.textForDb;

                await contactRef.update({
                    lastMessage: lastMessageText,
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                results.successful.push({ orderId: job.orderId });
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

