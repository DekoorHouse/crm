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
const { sendConversionEvent, generateGeminiResponse, generateGeminiResponseWithCache, getOrCreateCache, skipAiTimer, sendAdvancedWhatsAppMessage, invalidateGeminiCache, getMetaSpend } = require('./services');

const router = express.Router();

// --- Helper para procesar pedidos y adjuntar info de contacto/anuncio ---
async function processOrdersData(ordersSnapshot) {
    const orders = [];
    for (const doc of ordersSnapshot.docs) {
        const orderData = doc.data();
        const contactId = orderData.contactId || orderData.telefono;
        let adSource = 'Desconocido';
        let clientName = 'Sin nombre';

        if (contactId) {
            const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
            if (contactDoc.exists) {
                const contactData = contactDoc.data();
                clientName = contactData.name || clientName;
                if (contactData.adReferral) {
                    adSource = contactData.adReferral.ad_name || contactData.adReferral.source_id || adSource;
                }
            }
        }

        orders.push({
            id: doc.id,
            consecutiveOrderNumber: orderData.consecutiveOrderNumber,
            clientName: clientName,
            total: orderData.precio || 0,
            createdAt: orderData.createdAt ? orderData.createdAt.toDate() : null,
            adSource: adSource,
            producto: orderData.producto,
            estatus: orderData.estatus || 'Sin estatus'
        });
    }
    return orders;
}

// --- Helper para generar snapshot diario de KPIs ---
async function generateDailySnapshot(dateISO) {
    const start = new Date(dateISO + 'T00:00:00-06:00'); // Hora México
    const end = new Date(dateISO + 'T23:59:59-06:00');
    const firestoreStart = admin.firestore.Timestamp.fromDate(start);
    const firestoreEnd = admin.firestore.Timestamp.fromDate(end);

    const ordersSnap = await db.collection('pedidos')
        .where('createdAt', '>=', firestoreStart)
        .where('createdAt', '<=', firestoreEnd)
        .get();

    let proyectado = 0;
    let real = 0;
    let totalOrders = 0;
    let confirmedOrders = 0;

    ordersSnap.docs.forEach(doc => {
        const data = doc.data();
        const amount = parseFloat(data.precio) || 0;
        const rawStatus = (data.estatus || '').toLowerCase();

        proyectado += amount;
        totalOrders++;

        if (rawStatus.includes('fabricar') || rawStatus.includes('pagado')) {
            real += amount;
            confirmedOrders++;
        }
    });

    // Obtener gasto publicitario
    let adSpend = 0;
    try {
        const metaSpend = await getMetaSpend(dateISO, '1890131678412987');
        if (metaSpend !== null) {
            adSpend = metaSpend;
        } else {
            const kpiDoc = await db.collection('daily_kpis').doc(dateISO).get();
            if (kpiDoc.exists) {
                adSpend = kpiDoc.data().costo_publicidad || 0;
            }
        }
    } catch (e) {
        console.error('[SNAPSHOT] Error obteniendo ad spend:', e.message);
    }

    const efectividadPedidos = totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : 0;
    const efectividadDinero = proyectado > 0 ? (real / proyectado) * 100 : 0;
    const roas = adSpend > 0 ? (real / adSpend) : 0;

    return {
        date: dateISO,
        proyectado: Math.round(proyectado * 100) / 100,
        real: Math.round(real * 100) / 100,
        totalOrders,
        confirmedOrders,
        efectividadPedidos: Math.round(efectividadPedidos * 10) / 10,
        efectividadDinero: Math.round(efectividadDinero * 10) / 10,
        adSpend: Math.round(adSpend * 100) / 100,
        roas: Math.round(roas * 10) / 10
    };
}

// --- Endpoint GET /api/orders/today (Pedidos del día con origen de anuncio) ---
router.get('/orders/today', async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const firestoreTodayStart = admin.firestore.Timestamp.fromDate(todayStart);

        let query = db.collection('pedidos')
            .where('createdAt', '>=', firestoreTodayStart);

        const { time } = req.query; // HH:mm
        if (time) {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const limitDate = new Date(`${year}-${month}-${day}T${time}:59`);
            query = query.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(limitDate));
        }

        const ordersSnapshot = await query.orderBy('createdAt', 'desc').get();

        if (ordersSnapshot.empty) {
            return res.status(200).json({ success: true, orders: [] });
        }

        const orders = await processOrdersData(ordersSnapshot);
        res.status(200).json({ success: true, orders: orders });
    } catch (error) {
        console.error("Error fetching today's orders:", error);
        res.status(500).json({ success: false, message: 'Error al obtener los pedidos de hoy.', error: error.message });
    }
});

// --- Endpoint GET /api/orders/history (Pedidos por fecha específica) ---
router.get('/orders/history', async (req, res) => {
    try {
        const { date } = req.query; // Formato YYYY-MM-DD
        if (!date) {
            return res.status(400).json({ success: false, message: 'Se requiere una fecha.' });
        }

        // Crear rango de fecha (desde el inicio hasta el final del día)
        const start = new Date(date + 'T00:00:00');
        let end = new Date(date + 'T23:59:59');

        const firestoreStart = admin.firestore.Timestamp.fromDate(start);
        const { time } = req.query; // HH:mm
        if (time) {
            end = new Date(date + 'T' + time + ':59');
        }
        const firestoreEnd = admin.firestore.Timestamp.fromDate(end);

        const ordersSnapshot = await db.collection('pedidos')
            .where('createdAt', '>=', firestoreStart)
            .where('createdAt', '<=', firestoreEnd)
            .orderBy('createdAt', 'desc')
            .get();

        const orders = await processOrdersData(ordersSnapshot);
        res.status(200).json({ success: true, orders: orders });
    } catch (error) {
        console.error("Error fetching orders history:", error);
        res.status(500).json({ success: false, message: 'Error al obtener el historial de pedidos.', error: error.message });
    }
});

// --- Endpoint GET /api/kpi/daily (Obtener gasto publicitario del día) ---
router.get('/kpi/daily', async (req, res) => {
    try {
        let { date } = req.query; // Formato YYYY-MM-DD
        if (!date) {
            date = new Date().toISOString().split('T')[0];
        }

        // 1. Intentar obtener el gasto directamente de Meta Ads
        // El ID de la cuenta publicitaria es el solicitado por el usuario: 1890131678412987
        const metaSpend = await getMetaSpend(date, '1890131678412987');
        
        let spend = 0;

        if (metaSpend !== null) {
            // Si logramos obtenerlo de Meta, lo usamos y actualizamos Firestore como respaldo
            spend = metaSpend;
            console.log(`[KPI] Gasto de Meta obtenido para ${date}: ${spend}. Sincronizando Firestore...`);
            
            await db.collection('daily_kpis').doc(date).set({
                fecha: date,
                costo_publicidad: spend,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                source: 'meta_ads'
            }, { merge: true });
        } else {
            // Si Meta falló, intentamos leer lo último que tengamos en Firestore
            console.log(`[KPI] Meta falló o no disponible. Buscando en Firestore para ${date}...`);
            const kpiSnapshot = await db.collection('daily_kpis')
                .where('fecha', '==', date)
                .limit(1)
                .get();

            if (!kpiSnapshot.empty) {
                spend = kpiSnapshot.docs[0].data().costo_publicidad || 0;
            }
        }

        res.status(200).json({ success: true, spend: spend });
    } catch (error) {
        console.error("Error fetching daily KPI:", error);
        res.status(500).json({ success: false, message: 'Error al obtener el gasto publicitario.', error: error.message });
    }
});


// --- Endpoint Temporal: Actualizar nombres de anuncios de las últimas 20 horas ---
router.get('/admin/test-update-ads-20h', async (req, res) => {
    console.log('[DEBUG] Entrando a la ruta test-update-ads-20h');
    try {
        const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
        const firestoreTimestamp = admin.firestore.Timestamp.fromDate(twentyHoursAgo);

        console.log(`[DEBUG] Buscando chats con anuncios desde: ${twentyHoursAgo.toISOString()}`);
        console.log('[DEBUG] Iniciando consulta a Firestore: contacts_whatsapp...');
        
        const snapshot = await db.collection('contacts_whatsapp')
            .where('lastMessageTimestamp', '>=', firestoreTimestamp)
            .get();

        console.log(`[DEBUG] Consulta a Firestore finalizada. Documentos encontrados: ${snapshot.size}`);

        if (snapshot.empty) {
            console.log('[DEBUG] No se encontraron resultados. Enviando respuesta 200.');
            return res.status(200).json({ success: true, message: 'No se encontraron chats en las últimas 20 horas.', found: 0, updated: 0 });
        }

        let foundCount = 0;
        let updatedCount = 0;
        let errorsCount = 0;

        const results = [];

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const adReferral = data.adReferral;

            // Solo procesar si tiene un source_id de anuncio
            if (adReferral && adReferral.source_id && adReferral.source_type === 'ad') {
                foundCount++;
                const adId = adReferral.source_id;

                try {
                    console.log(`[DEBUG] Procesando contacto: ${doc.id}, Ad ID: ${adId}`);
                    console.log(`[DEBUG] Llamando a Meta Graph API para el Ad ID: ${adId}`);
                    
                    const metaResponse = await axios.get(`https://graph.facebook.com/v18.0/${adId}`, {
                        params: {
                            fields: 'name',
                            access_token: process.env.META_GRAPH_TOKEN
                        }
                    });

                    console.log(`[DEBUG] Respuesta de Meta recibida para ${adId}: ${JSON.stringify(metaResponse.data)}`);

                    if (metaResponse.data && metaResponse.data.name) {
                        const adName = metaResponse.data.name;
                        
                        console.log(`[DEBUG] Actualizando Firestore para el contacto ${doc.id} con ad_name: ${adName}`);
                        // Actualizar en Firestore
                        await doc.ref.update({
                            'adReferral.ad_name': adName
                        });
                        console.log(`[DEBUG] Actualización en Firestore exitosa para ${doc.id}`);
                        
                        updatedCount++;
                        results.push({ id: doc.id, adId, status: 'updated', name: adName });
                    } else {
                        console.log(`[DEBUG] Meta no devolvió un nombre para ${adId}`);
                        results.push({ id: doc.id, adId, status: 'no_name_returned' });
                    }
                } catch (error) {
                    console.error(`[ERROR CRÍTICO EN BUCLE] test-update-ads-20h (Ad ID ${adId}):`, error.message);
                    if (error.response) {
                        console.error('[DEBUG] Detalles del error de Meta:', JSON.stringify(error.response.data));
                    }
                    errorsCount++;
                    results.push({ id: doc.id, adId, status: 'error', error: error.message });
                }
            }
        }

        console.log('[DEBUG] Finalizando procesamiento. Enviando respuesta summary.');
        res.status(200).json({
            success: true,
            summary: {
                total_recent_chats: snapshot.size,
                chats_with_ads: foundCount,
                updated_successfully: updatedCount,
                errors: errorsCount
            },
            details: results
        });

    } catch (error) {
        console.error('[ERROR CRÍTICO] test-update-ads-20h falló:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno en test-update-ads-20h.', 
            error: error.message,
            stack: error.stack 
        });
    }
});

// --- CONSTANTES ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const PORT = process.env.PORT || 3000;

// --- ENDPOINT SIMULADOR IA ---
router.post('/simulate-ai', async (req, res) => {
    try {
        const { message, mediaBase64, mediaMimeType, history } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, message: 'Se requiere un mensaje.' });
        }

        // Recuperar instrucciones del bot
        const botDoc = await db.collection('crm_settings').doc('bot').get();
        const systemPrompt = botDoc.exists ? botDoc.data().instructions : 'Eres un asistente virtual amigable y servicial.';

        // Construir historial de conversación y recolectar media
        const mediaParts = [];
        let mediaCount = 0;

        const dbHistory = (history || []).map(msg => {
            if (msg.role === 'user' && msg.mediaBase64 && mediaCount < 2) {
                // Remove the prefix (e.g., "data:image/jpeg;base64," or "data:audio/ogg;base64,")
                const base64Data = msg.mediaBase64.replace(/^data:\w+\/\w+;base64,/, '');
                // Detect mime type from prefix or use provided
                const mimeMatch = msg.mediaBase64.match(/^data:(\w+\/\w+);base64,/);
                const mimeType = mimeMatch ? mimeMatch[1] : (msg.mediaMimeType || 'image/jpeg');
                
                mediaParts.unshift({ inlineData: { data: base64Data, mimeType: mimeType } }); // unshift to keep chronological order logic similar to services.js
                mediaCount++;
            }
            return {
                role: msg.role === 'user' ? 'user' : 'model',
                text: msg.content
            };
        });
        
        // Handle current message text, and potentially media if sent alongside it
        if (mediaBase64 && mediaCount < 2) {
            const base64Data = mediaBase64.replace(/^data:\w+\/\w+;base64,/, '');
            const mimeMatch = mediaBase64.match(/^data:(\w+\/\w+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : (mediaMimeType || 'image/jpeg');
            mediaParts.push({ inlineData: { data: base64Data, mimeType: mimeType } });
            mediaCount++;
        }
        dbHistory.push({ role: 'user', text: message || '' });

        const conversationHistory = dbHistory.map(d => {
            return `${d.role === 'user' ? 'Cliente' : 'Asistente'}: ${d.text}`;
        }).join('\n');

        const dynamicPrompt = `**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;

        // Intentar con Context Caching
        let aiResult;
        try {
            const cacheName = await getOrCreateCache(systemPrompt);
            if (cacheName) {
                aiResult = await generateGeminiResponseWithCache(cacheName, dynamicPrompt, mediaParts);
            } else {
                throw new Error('Caché no disponible');
            }
        } catch (cacheError) {
            // Fallback: construir prompt completo sin caché
            console.warn(`[SIMULATOR] Caché falló (${cacheError.message}). Usando método sin caché.`);
            const kbSnapshot = await db.collection('ai_knowledge_base').get();
            const knowledgeBase = kbSnapshot.docs.map(doc => `P: ${doc.data().topic}\nR: ${doc.data().answer}`).join('\n\n');
            const qrSnapshot = await db.collection('quick_replies').get();
            const quickRepliesText = qrSnapshot.docs.filter(doc => doc.data().message).map(doc => `- ${doc.data().shortcut}: ${doc.data().message}`).join('\n');

            const fullPrompt = `**Instrucciones Generales:**\n${systemPrompt}\n\n**Regla Especial de Mensajes Múltiples:** SOLO usa la etiqueta [SPLIT] si tus instrucciones EXPLÍCITAMENTE dicen enviar algo "en otro mensaje", "seguido de" otro mensaje, o "en dos mensajes separados". Si NO hay una instrucción explícita de separar en varios mensajes, responde TODO en un ÚNICO mensaje. NUNCA dividas una respuesta en múltiples mensajes por tu cuenta.\n\n**Base de Conocimiento:**\n${knowledgeBase || 'No hay información adicional.'}\n\n**Respuestas Rápidas:**\n${quickRepliesText || 'No hay respuestas rápidas.'}\n\n**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si el cliente envió multimedia, analízala cuidadosamente. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;
            aiResult = await generateGeminiResponse(fullPrompt, mediaParts);
        }

        const rawResponse = aiResult.text || '';
        const shouldQuote = /\[CITA\]/i.test(rawResponse);
        const aiResponse = rawResponse.replace(/\[CITA\]/ig, '').trim();

        res.status(200).json({ 
            success: true, 
            response: aiResponse,
            shouldQuote: shouldQuote,
            inputTokens: aiResult.inputTokens || 0,
            outputTokens: aiResult.outputTokens || 0,
            cachedTokens: aiResult.cachedTokens || 0
        });
    } catch (error) {
        console.error('Error en simulación de IA:', error);
        res.status(500).json({ success: false, message: 'Error procesando simulación IA.' });
    }
});
// --- FIN ENDPOINT SIMULADOR IA ---

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
                    '-crf 28' // Controla la calidad (más alto = menor calidad, menor tamaño)
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
        // Si ya es ogg o no es audio, devolver original
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
                return resolve({ buffer: inputBuffer, mimeType: mimeType }); // Devolver original en caso de error
            }

            ffmpeg(tempInput.name)
                // Opciones para OGG Opus compatible con WhatsApp (nota de voz)
                .outputOptions(['-c:a libopus', '-b:a 16k', '-vbr off', '-ar 16000'])
                .on('end', () => {
                    fs.readFile(tempOutput.name, (err, convertedBuffer) => {
                        tempInput.removeCallback();
                        tempOutput.removeCallback();
                        if (err) {
                            console.warn(`[AUDIO CONVERTER] Fallo al leer archivo convertido. Se enviará como archivo estándar.`);
                            return resolve({ buffer: inputBuffer, mimeType: mimeType }); // Devolver original
                        }
                        console.log(`[AUDIO CONVERTER] Conversión a OGG Opus exitosa.`);
                        resolve({ buffer: convertedBuffer, mimeType: 'audio/ogg' }); // Devolver convertido
                    });
                })
                .on('error', (err) => {
                    tempInput.removeCallback();
                    tempOutput.removeCallback();
                    console.warn(`[AUDIO CONVERTER] Falló la conversión a OGG: ${err.message}. Se enviará como archivo de audio estándar.`);
                    resolve({ buffer: inputBuffer, mimeType: mimeType }); // Devolver original
                })
                .save(tempOutput.name);
        });
    });
}
// --- FIN: NUEVA FUNCIÓN ---

// --- INICIO: Helper function to parse ad IDs ---
/**
 * Parses the adIds input (string or array) into a clean array of strings.
 * @param {string|string[]} adIdsInput - The input from the request body.
 * @returns {string[]} An array of unique, trimmed ad IDs.
 */
function parseAdIds(adIdsInput) {
    if (!adIdsInput) return [];
    let ids = [];
    if (Array.isArray(adIdsInput)) {
        ids = adIdsInput;
    } else if (typeof adIdsInput === 'string') {
        // Split by comma, trim whitespace, and filter out empty strings
        ids = adIdsInput.split(',').map(id => id.trim()).filter(id => id);
    }
    // Remove duplicates and ensure they are strings
    return [...new Set(ids.map(id => String(id).trim()).filter(id => id))];
}
// --- FIN: Helper function ---

/**
 * Sube un archivo multimedia a los servidores de WhatsApp y devuelve su ID.
 * MODIFICADO: Añade compresión de video y conversión de audio antes de la subida.
 * @param {string} mediaUrl La URL pública del archivo (GCS o externa).
 * @param {string} mimeType El tipo MIME del archivo (ej. 'video/mp4').
 * @returns {Promise<string>} El ID del medio asignado por WhatsApp.
 */
async function uploadMediaToWhatsApp(mediaUrl, mimeType) {
    try {
        console.log(`[MEDIA UPLOAD] Descargando ${mediaUrl} para procesar y subir...`);
        // Descargar el archivo como buffer
        const fileResponse = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
        let fileBuffer = fileResponse.data;
        let finalMimeType = mimeType;
        // Extraer nombre de archivo de la URL
        const fileName = path.basename(new URL(mediaUrl).pathname) || `media.${mimeType.split('/')[1] || 'bin'}`;

        // --- INICIO: PASO DE COMPRESIÓN/CONVERSIÓN AÑADIDO ---
        if (mimeType.startsWith('video/')) {
            fileBuffer = await compressVideoIfNeeded(fileBuffer, mimeType);
        } else if (mimeType.startsWith('audio/')) {
            // Convertir audio a OGG Opus si es necesario
            const conversionResult = await convertAudioToOggOpusIfNeeded(fileBuffer, mimeType);
            fileBuffer = conversionResult.buffer;
            finalMimeType = conversionResult.mimeType; // Podría ser 'audio/ogg' ahora
        }
        // --- FIN: PASO DE COMPRESIÓN/CONVERSIÓN AÑADIDO ---

        // Crear FormData para la subida a WhatsApp
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', fileBuffer, {
            filename: fileName, // Nombre de archivo original
            contentType: finalMimeType, // Tipo MIME final (puede haber cambiado para audio)
        });

        console.log(`[MEDIA UPLOAD] Subiendo ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB, tipo: ${finalMimeType}) a WhatsApp...`);
        // Realizar la subida a la API de Medios de WhatsApp
        const uploadResponse = await axios.post(
            `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/media`,
            form,
            {
                headers: {
                    ...form.getHeaders(), // Headers necesarios para FormData
                    'Authorization': `Bearer ${WHATSAPP_TOKEN}`
                },
                maxContentLength: Infinity, // Permitir archivos grandes
                maxBodyLength: Infinity,
            }
        );

        const mediaId = uploadResponse.data.id;
        if (!mediaId) {
            throw new Error("La API de WhatsApp no devolvió un ID de medio.");
        }

        console.log(`[MEDIA UPLOAD] Archivo subido con éxito. Media ID: ${mediaId}`);
        return mediaId; // Devolver el ID del medio de WhatsApp

    } catch (error) {
        // Manejo detallado de errores
        console.error('❌ Error al subir archivo a WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw new Error('No se pudo subir el archivo a los servidores de WhatsApp.');
    }
}


/**
 * Construye el payload para enviar una plantilla avanzada de WhatsApp (con header, body, botones).
 * @param {string} contactId ID del contacto (número de teléfono).
 * @param {object} templateObject Objeto de la plantilla obtenido de la API de Meta.
 * @param {string|null} [imageUrl=null] URL de la imagen para plantillas con cabecera de imagen.
 * @param {string[]} [bodyParams=[]] Array de strings para reemplazar variables {{2}}, {{3}}, etc. en el cuerpo.
 * @returns {Promise<{payload: object, messageToSaveText: string}>} Objeto con el payload y el texto para guardar en DB.
 */
async function buildAdvancedTemplatePayload(contactId, templateObject, imageUrl = null, bodyParams = []) {
    // ... (el resto de la función no necesita cambios)
    console.log('[DIAGNÓSTICO] Objeto de plantilla recibido:', JSON.stringify(templateObject, null, 2));
    const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
    // Usa el nombre del contacto si existe, si no 'Cliente'
    const contactName = contactDoc.exists ? contactDoc.data().name : 'Cliente';

    // Extraer datos relevantes de la plantilla
    const { name: templateName, components: templateComponents, language } = templateObject;

    const payloadComponents = []; // Array para los componentes del payload final
    let messageToSaveText = `📄 Plantilla: ${templateName}`; // Texto por defecto para guardar en DB

    // --- Procesar Cabecera (HEADER) ---
    const headerDef = templateComponents?.find(c => c.type === 'HEADER');
    if (headerDef?.format === 'IMAGE') {
        if (!imageUrl) throw new Error(`La plantilla '${templateName}' requiere una imagen.`);
        // Añadir componente de cabecera de imagen
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'image', image: { link: imageUrl } }]
        });
        messageToSaveText = `🖼️ Plantilla con imagen: ${templateName}`;
    }
    // Si la cabecera es texto y espera una variable ({{1}}), usar el nombre del contacto
    if (headerDef?.format === 'TEXT' && headerDef.text?.includes('{{1}}')) {
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'text', text: contactName }]
        });
    }

    // --- Procesar Cuerpo (BODY) ---
    const bodyDef = templateComponents?.find(c => c.type === 'BODY');
    if (bodyDef) {
        // Encontrar cuántas variables ({{n}}) espera el cuerpo
        const matches = bodyDef.text?.match(/\{\{\d\}\}/g);
        if (matches) {
            // Combinar nombre del contacto (para {{1}}) con los parámetros adicionales (para {{2}}, {{3}}, ...)
            const allParams = [contactName, ...bodyParams];
            // Crear los parámetros de texto, asegurándose de no exceder los esperados
            const parameters = allParams.slice(0, matches.length).map(param => ({
                type: 'text',
                text: String(param) // Asegurar que sea string
            }));

            payloadComponents.push({ type: 'body', parameters });

            // Reconstruir el texto del mensaje para guardarlo en la DB
            let tempText = bodyDef.text;
            parameters.forEach((param, index) => {
                tempText = tempText.replace(`{{${index + 1}}}`, param.text);
            });
            messageToSaveText = tempText;

        } else {
            // Si el cuerpo no tiene variables, añadir componente vacío
            payloadComponents.push({ type: 'body', parameters: [] });
            messageToSaveText = bodyDef.text || messageToSaveText; // Usar texto del cuerpo si existe
        }
    }

    // --- Procesar Botones (BUTTONS) ---
    const buttonsDef = templateComponents?.find(c => c.type === 'BUTTONS');
    buttonsDef?.buttons?.forEach((button, index) => {
        // Si el botón es de tipo URL y espera una variable ({{1}}), usar el contactId
        if (button.type === 'URL' && button.url?.includes('{{1}}')) {
            payloadComponents.push({
                type: 'button',
                sub_type: 'url',
                index: index.toString(), // El índice debe ser string
                parameters: [{ type: 'text', text: contactId }] // Usar el ID del contacto
            });
        }
        // Nota: Los botones de respuesta rápida (quick_reply) no necesitan parámetros aquí.
    });

    // Construir el payload final
    const payload = {
        messaging_product: 'whatsapp',
        to: contactId,
        type: 'template',
        template: {
            name: templateName,
            language: { code: language }
            // components se añade solo si hay alguno
        }
    };
    if (payloadComponents.length > 0) {
        payload.template.components = payloadComponents;
    }

    console.log(`[DIAGNÓSTICO] Payload final construido para ${contactId}:`, JSON.stringify(payload, null, 2));
    // Devolver el payload y el texto representativo
    return { payload, messageToSaveText };
}


// --- El resto de las rutas no necesitan cambios ---
// ... (todas las demás rutas permanecen igual) ...
// --- Endpoint GET /api/contacts/pending-ia-count (Conteo global de pendientes IA) ---
router.get('/contacts/pending-ia-count', async (req, res) => {
    try {
        const { departmentId } = req.query;
        let query = db.collection('contacts_whatsapp').where('status', '==', 'pendientes_ia');

        // Filtrar por departamento si es necesario (para que el conteo sea relevante al usuario)
        if (departmentId && departmentId !== 'all') {
            if (departmentId.includes(',')) {
                const ids = departmentId.split(',').map(id => id.trim()).filter(id => id);
                if (ids.length > 0) {
                    query = query.where('assignedDepartmentId', 'in', ids.slice(0, 10));
                }
            } else {
                query = query.where('assignedDepartmentId', '==', departmentId);
            }
        }

        const countSnapshot = await query.count().get();
        const totalCount = countSnapshot.data().count;

        res.status(200).json({ success: true, count: totalCount });
    } catch (error) {
        console.error('Error getting pending IA count:', error);
        res.status(500).json({ success: false, message: 'Error al obtener el conteo.', error: error.message });
    }
});

// --- Endpoint GET /api/contacts (Paginado y con filtro de etiqueta) ---
router.get('/contacts', async (req, res) => {
    try {
        const { limit = 30, startAfterId, tag, departmentId } = req.query; // AÑADIDO: departmentId
        let query = db.collection('contacts_whatsapp');

        // Aplicar filtro de etiqueta si se proporciona
        if (tag) {
            query = query.where('status', '==', tag);
        }

        // Aplicar filtro de no leídos si se proporciona
        if (req.query.unreadOnly === 'true') {
            query = query.where('unreadCount', '>', 0);
        }

        // --- INICIO: Filtro por Departamento ---
        // Si se proporciona departmentId, filtrar por 'assignedDepartmentId'
        if (departmentId && departmentId !== 'all') {
            // Soporte para múltiples IDs separados por coma (para usuarios con múltiples departamentos)
            if (departmentId.includes(',')) {
                const ids = departmentId.split(',').map(id => id.trim()).filter(id => id);
                if (ids.length > 0) {
                    // Nota: Firestore limita el operador 'in' a 10 valores.
                    query = query.where('assignedDepartmentId', 'in', ids.slice(0, 10));
                }
            } else {
                query = query.where('assignedDepartmentId', '==', departmentId);
            }
        }
        // --- FIN: Filtro por Departamento ---

        // Ordenar por último mensaje y limitar resultados (Firestore requiere ordenar primero por el campo de la desigualdad)
        if (req.query.unreadOnly === 'true') {
            query = query.orderBy('unreadCount', 'desc').orderBy('lastMessageTimestamp', 'desc').limit(Number(limit));
        } else {
            query = query.orderBy('lastMessageTimestamp', 'desc').limit(Number(limit));
        }

        // Paginación: Empezar después del último documento de la página anterior
        if (startAfterId) {
            const lastDoc = await db.collection('contacts_whatsapp').doc(startAfterId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc); // Iniciar consulta después de este documento
            }
        }

        // Ejecutar la consulta
        const snapshot = await query.get();
        const contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Obtener el ID del último documento para la siguiente página
        const lastVisibleId = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null;

        res.status(200).json({ success: true, contacts, lastVisibleId });
    } catch (error) {
        console.error('Error fetching paginated contacts:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener contactos.', errorDetails: error.message || error.details || error.toString() });
    }
});

// --- Endpoint PUT /api/contacts/:contactId/transfer (Transferir Chat a Departamento) ---
router.put('/contacts/:contactId/transfer', async (req, res) => {
    const { contactId } = req.params;
    const { targetDepartmentId } = req.body;

    if (!targetDepartmentId) {
        return res.status(400).json({ success: false, message: 'Se requiere el ID del departamento destino.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        await contactRef.update({ 
            assignedDepartmentId: targetDepartmentId,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), // Trigger frontend update
            unreadCount: 1 // Mark as unread
        });
        res.status(200).json({ success: true, message: `Chat transferido al departamento '${targetDepartmentId}'.` });
    } catch (error) {
        console.error(`Error al transferir el chat ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error al transferir el chat.' });
    }
});

// --- Endpoint GET /api/contacts/search (Búsqueda de contactos) ---
router.get('/contacts/search', async (req, res) => {
    const { query } = req.query;
    console.log(`[SEARCH] Iniciando búsqueda para: "${query}"`);
    if (!query) {
        return res.status(400).json({ success: false, message: 'Se requiere un término de búsqueda.' });
    }

    try {
        const searchResults = [];
        const lowercaseQuery = query.toLowerCase();
        const uniqueIds = new Set(); // Para evitar duplicados

        const addResult = (doc) => {
            if (!uniqueIds.has(doc.id)) {
                searchResults.push({ id: doc.id, ...doc.data() });
                uniqueIds.add(doc.id);
            }
        };

        // 1. Buscar por número de pedido (DHxxxx)
        if (lowercaseQuery.startsWith('dh') && /dh\d+/.test(lowercaseQuery)) {
            const orderNumber = parseInt(lowercaseQuery.replace('dh', ''), 10);
            if (!isNaN(orderNumber)) {
                const orderSnapshot = await db.collection('pedidos').where('consecutiveOrderNumber', '==', orderNumber).limit(1).get();
                if (!orderSnapshot.empty) {
                    const orderData = orderSnapshot.docs[0].data();
                    const contactId = orderData.telefono;
                    if (contactId) {
                        const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
                        if (contactDoc.exists) addResult(contactDoc);
                    }
                }
            }
        }

        // 2. Buscar por número de teléfono exacto (ID del documento)
        const phoneDoc = await db.collection('contacts_whatsapp').doc(query).get();
        if (phoneDoc.exists) addResult(phoneDoc);

        // 3. Buscar por nombre (usando name_lowercase)
        const nameSnapshot = await db.collection('contacts_whatsapp')
            .where('name_lowercase', '>=', lowercaseQuery)
            .where('name_lowercase', '<=', lowercaseQuery + '\uf8ff') // Técnica de prefijo
            .orderBy('name_lowercase') // Necesario para where con rango
            .limit(20) // Limitar resultados por eficiencia
            .get();
        nameSnapshot.forEach(addResult);

        // 4. Buscar por inicio de número de teléfono (prefijo)
        const partialPhoneSnapshot = await db.collection('contacts_whatsapp')
            .where(admin.firestore.FieldPath.documentId(), '>=', query)
            .where(admin.firestore.FieldPath.documentId(), '<=', query + '\uf8ff') // Técnica de prefijo
            .orderBy(admin.firestore.FieldPath.documentId()) // Necesario para where con rango en ID
            .limit(20)
            .get();
        partialPhoneSnapshot.forEach(addResult);

        // 5. Buscar por número local (prefijo 521 + query) si es numérico y corto
        if (/^\d+$/.test(query) && query.length >= 3) {
            const prefixedQuery = "521" + query;
            const prefixedSnapshot = await db.collection('contacts_whatsapp')
                .where(admin.firestore.FieldPath.documentId(), '>=', prefixedQuery)
                .where(admin.firestore.FieldPath.documentId(), '<=', prefixedQuery + '\uf8ff')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(20)
                .get();
            prefixedSnapshot.forEach(addResult);
        }

        // Ordenar resultados finales por fecha del último mensaje
        searchResults.sort((a, b) => (b.lastMessageTimestamp?.toMillis() || 0) - (a.lastMessageTimestamp?.toMillis() || 0));

        res.status(200).json({ success: true, contacts: searchResults });
    } catch (error) {
        console.error('Error searching contacts:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al buscar contactos.' });
    }
});

// --- Endpoint PUT /api/contacts/:contactId (Actualizar contacto) ---
router.put('/contacts/:contactId', async (req, res) => {
    const { contactId } = req.params;
    const { name, email, nickname } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
    }

    try {
        // Actualizar documento del contacto y notificar cambios en tiempo real
        await db.collection('contacts_whatsapp').doc(contactId).update({
            name: name,
            email: email || null, // Guardar null si está vacío
            nickname: nickname || null, // Guardar null si está vacío
            name_lowercase: name.toLowerCase(), // Actualizar campo para búsquedas
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() // Trigger sync
        });
        res.status(200).json({ success: true, message: 'Contacto actualizado.' });
    } catch (error) {
        console.error('Error al actualizar el contacto:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el contacto.' });
    }
});

// --- Endpoint PUT /api/contacts/:contactId/status (Actualizar estatus/etiqueta de contacto) ---
router.put('/contacts/:contactId/status', async (req, res) => {
    const { contactId } = req.params;
    const { status } = req.body; // El nuevo estatus (ej. 'seguimiento')

    if (status === undefined) {
        return res.status(400).json({ success: false, message: 'El campo "status" es obligatorio.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);

        // Verificar si el contacto existe antes de actualizar
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }

        // Actualizar el campo 'status' y el timestamp para notificar a todos los dispositivos en tiempo real
        await contactRef.update({
            status: status,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).json({ success: true, message: `Estatus del contacto actualizado a "${status}".` });
    } catch (error) {
        console.error(`Error al actualizar el estatus para el contacto ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el estatus del contacto.' });
    }
});

// --- Endpoint POST /api/contacts/:contactId/skip-ai (Saltar temporizador de IA) ---
router.post('/contacts/:contactId/skip-ai', async (req, res) => {
    const { contactId } = req.params;
    try {
        const skipped = await skipAiTimer(contactId);
        if (skipped) {
            res.status(200).json({ success: true, message: 'Temporizador saltado correctamente.' });
        } else {
            res.status(404).json({ success: false, message: 'No se encontró un temporizador activo para este contacto.' });
        }
    } catch (error) {
        console.error(`Error al saltar el timer de la IA para ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error interno al saltar el temporizador.' });
    }
});

// --- Endpoint POST /api/contacts/:contactId/cancel-ai (Cancelar generación de IA) ---
router.post('/contacts/:contactId/cancel-ai', async (req, res) => {
    const { contactId } = req.params;
    try {
        const { cancelAiResponse } = require('./services');
        await cancelAiResponse(contactId);
        res.status(200).json({ success: true, message: 'Generación cancelada.' });
    } catch (error) {
        console.error(`Error al cancelar la IA para ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error al cancelar.' });
    }
});

// --- Endpoint DELETE /api/contacts/:contactId/messages (Borrar historial de chat) ---
router.delete('/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        
        // Función interna para borrar en lotes (evita límites de batch de Firestore)
        async function deleteMessages(query) {
            const snapshot = await query.get();
            if (snapshot.size === 0) return;

            const batch = db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();

            // Llamada recursiva para el siguiente lote
            if (snapshot.size > 0) {
                return deleteMessages(query);
            }
        }

        // Ejecutar borrado en lotes de 400
        await deleteMessages(contactRef.collection('messages').limit(400));

        // Actualizar datos de contacto para reflejar el borrado
        await contactRef.update({
            lastMessage: 'Historial borrado por el equipo.',
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: 0
        });

        res.status(200).json({ success: true, message: 'Historial de chat borrado correctamente.' });
    } catch (error) {
        console.error(`❌ Error al borrar el historial para ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'No se pudo borrar el historial del chat.' });
    }
});

// --- Endpoint GET /api/contacts/:contactId/orders (Historial de pedidos) ---
router.get('/contacts/:contactId/orders', async (req, res) => {
    try {
        const { contactId } = req.params;

        // Buscar pedidos donde el campo 'telefono' coincida con el contactId
        const snapshot = await db.collection('pedidos')
            .where('telefono', '==', contactId)
            .get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, orders: [] }); // Devolver array vacío si no hay pedidos
        }

        // Mapear los documentos a un formato deseado
        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                consecutiveOrderNumber: data.consecutiveOrderNumber,
                producto: data.producto,
                // Convertir timestamp a ISO string si existe
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                estatus: data.estatus || 'Sin estatus' // Valor por defecto
            };
        });

        // Ordenar por fecha de creación descendente (más reciente primero)
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.status(200).json({ success: true, orders });
    } catch (error) {
        console.error(`Error al obtener el historial de pedidos para ${req.params.contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener el historial de pedidos.' });
    }
});

// --- Endpoint POST /api/contacts/:contactId/messages (Enviar mensaje) ---
router.post('/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid, template, tempId } = req.body; // tempId es opcional, para UI optimista

    // Validaciones básicas
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    }
    if (!text && !fileUrl && !template) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío (texto, archivo o plantilla).' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        let messageToSave; // Objeto para guardar en Firestore
        let messageId; // ID del mensaje de WhatsApp (wamid)
        let isFinalCommand = false;
        let cleanedText = text;

        if (text && (text.toLowerCase().includes('/final') || text.toLowerCase().includes('ya registramos tu pedido'))) {
            isFinalCommand = true;
            if (text.toLowerCase().includes('/final')) {
                cleanedText = text.replace(/\/final/gi, '').trim();
            } else {
                cleanedText = text; // Mantenemos la frase intacta si no es el comando técnico /final
            }
        }

        // --- Lógica para enviar PLANTILLA ---
        if (template) {
            // Construir payload de plantilla (asumiendo que buildAdvancedTemplatePayload maneja parámetros)
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template, null, []); // Sin imagen, sin params extra aquí
            // Añadir contexto si se está respondiendo a un mensaje
            if (reply_to_wamid) {
                payload.context = { message_id: reply_to_wamid };
            }

            // Enviar a la API de WhatsApp
            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
            });
            messageId = response.data.messages[0].id;
            // Preparar datos para Firestore
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: messageToSaveText // Texto representativo de la plantilla
            };
        }
        // --- Lógica para enviar ARCHIVO (imagen, video, audio, documento) ---
        else if (fileUrl && fileType) {
            // Asegurar que el archivo en GCS sea público si es de nuestro bucket
            if (fileUrl && fileUrl.includes(bucket.name)) {
                try {
                    const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                    await bucket.file(decodeURIComponent(filePath)).makePublic();
                    console.log(`[GCS-CHAT] Archivo ${decodeURIComponent(filePath)} hecho público para envío.`);
                } catch (gcsError) {
                    console.error(`[GCS-CHAT] Advertencia: No se pudo hacer público el archivo ${fileUrl}:`, gcsError.message);
                }
            }

            // Subir el archivo a WhatsApp para obtener media ID
            const mediaId = await uploadMediaToWhatsApp(fileUrl, fileType);

            // Determinar el tipo de mensaje para la API de WhatsApp
            const type = fileType.startsWith('image/') ? 'image' :
                fileType.startsWith('video/') ? 'video' :
                    fileType.startsWith('audio/') ? 'audio' : 'document';

            const mediaObject = { id: mediaId };
            // Añadir caption si es relevante y hay texto (usar texto filtrado de comandos)
            if (type !== 'audio' && cleanedText) {
                mediaObject.caption = cleanedText;
            }

            // Construir payload para la API de WhatsApp
            const messagePayload = {
                messaging_product: 'whatsapp',
                to: contactId,
                type: type,
                [type]: mediaObject // { image: { id: mediaId, caption: text } } o similar
            };
            // Añadir contexto si se responde
            if (reply_to_wamid) {
                messagePayload.context = { message_id: reply_to_wamid };
            }

            // Enviar a la API de WhatsApp
            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, messagePayload, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            messageId = response.data.messages[0].id;

            // Preparar datos para Firestore
            const messageTextForDb = text || (type === 'video' ? '🎥 Video' : type === 'image' ? '📷 Imagen' : type === 'audio' ? '🎵 Audio' : '📄 Documento');
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: messageTextForDb, fileUrl: fileUrl, fileType: fileType
            };

        }
        // --- Lógica para enviar solo TEXTO ---
        else {
            // Usar la función de envío avanzada que maneja solo texto
            const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text, reply_to_wamid });
            messageId = sentMessageData.id;
            // Preparar datos para Firestore
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: sentMessageData.textForDb
            };
        }

        // Añadir contexto a los datos de Firestore si se está respondiendo
        if (reply_to_wamid) {
            messageToSave.context = { id: reply_to_wamid };
        }
        // Limpiar campos nulos antes de guardar
        Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);

        // Guardar en Firestore (usando tempId si se proporcionó para UI optimista)
        const messageRef = tempId ? contactRef.collection('messages').doc(tempId) : contactRef.collection('messages').doc();
        await messageRef.set(messageToSave); // Usar set() para manejar tanto creación como posible sobreescritura (en caso de tempId)

        // Actualizar último mensaje y resetear contador de no leídos en el contacto
        const contactUpdateData = {
            lastMessage: messageToSave.text,
            lastMessageTimestamp: messageToSave.timestamp, // Usar el timestamp del servidor
            unreadCount: 0 // Resetear contador al enviar un mensaje
        };

        // Si se detectó el comando /final, desactivar bot y mover a la cola de pendientes IA
        if (isFinalCommand) {
            contactUpdateData.botActive = false;
            contactUpdateData.status = 'pendientes_ia';
        }

        await contactRef.update(contactUpdateData);

        res.status(200).json({ success: true, message: 'Mensaje(s) enviado(s).' });
    } catch (error) {
        // Manejo de errores detallado
        console.error('❌ Error al enviar mensaje/plantilla de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar el mensaje a través de WhatsApp.' });
    }
});
// ... (resto de las rutas sin cambios)
// --- Endpoint POST /api/contacts/:contactId/queue-message (Encolar mensaje si >24h) ---
router.post('/contacts/:contactId/queue-message', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid } = req.body;

    // Validar que haya contenido
    if (!text && !fileUrl) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        let isFinalCommand = false;
        let cleanedText = text;

        if (text && (text.toLowerCase().includes('/final') || text.toLowerCase().includes('ya registramos tu pedido'))) {
            isFinalCommand = true;
            if (text.toLowerCase().includes('/final')) {
                cleanedText = text.replace(/\/final/gi, '').trim();
            } else {
                cleanedText = text;
            }
        }

        // Determinar texto para DB (igual que en envío normal)
        let messageToSaveText = cleanedText;
        if (fileUrl && !cleanedText) {
            const type = fileType.startsWith('image/') ? 'image' :
                fileType.startsWith('video/') ? 'video' :
                fileType.startsWith('audio/') ? 'audio' : 'document';
            messageToSaveText = (type === 'video' ? '🎥 Video' : type === 'image' ? '📷 Imagen' : '🎵 Audio');
        }

        // Crear objeto del mensaje para guardar
        const messageToSave = {
            from: PHONE_NUMBER_ID, // Mensaje saliente
            status: 'queued', // Marcar como encolado
            timestamp: admin.firestore.FieldValue.serverTimestamp(), // Hora actual
            text: messageToSaveText,
            fileUrl: fileUrl || null,
            fileType: fileType || null,
        };

        // Añadir contexto si es una respuesta
        if (reply_to_wamid) {
            messageToSave.context = { id: reply_to_wamid };
        }

        // Guardar el mensaje en la subcolección 'messages'
        await contactRef.collection('messages').add(messageToSave);

        // Actualizar la vista previa del último mensaje y el estado del bot
        const contactUpdateData = {
            lastMessage: `[En cola] ${messageToSave.text}`, // Añadir prefijo para UI
            lastMessageTimestamp: messageToSave.timestamp,
        };

        if (isFinalCommand) {
            contactUpdateData.botActive = false;
            contactUpdateData.status = 'pendientes_ia';
        }

        await contactRef.update(contactUpdateData);

        res.status(200).json({ success: true, message: 'Mensaje encolado con éxito.' });

    } catch (error) {
        console.error('❌ Error al encolar mensaje:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error del servidor al encolar el mensaje.' });
    }
});

// --- Endpoint GET /api/contacts/:contactId/messages-paginated (Obtener mensajes paginados) ---
router.get('/contacts/:contactId/messages-paginated', async (req, res) => {
    try {
        const { contactId } = req.params;
        const { limit = 30, before } = req.query; // 'before' es un timestamp en segundos

        let query = db.collection('contacts_whatsapp')
            .doc(contactId)
            .collection('messages')
            .orderBy('timestamp', 'desc') // Ordenar por más reciente primero
            .limit(Number(limit));

        // Si se proporciona 'before', obtener mensajes *anteriores* a ese timestamp
        if (before) {
            // Convertir timestamp de segundos (del cliente) a Timestamp de Firestore
            const firestoreTimestamp = admin.firestore.Timestamp.fromMillis(parseInt(before) * 1000);
            // CORRECCIÓN: Usar startAfter en lugar de where <, ya que la consulta va desc
            // Necesitamos el documento anterior para usar startAfter, o ajustar la lógica
            // Alternativa más simple: Filtrar por timestamp <
            query = query.where('timestamp', '<', firestoreTimestamp);
            // Si se quiere paginación estricta con startAfter, se necesitaría obtener el documento
            // const lastDocSnapshot = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').where('timestamp','==', firestoreTimestamp).limit(1).get();
            // if(!lastDocSnapshot.empty) query = query.startAfter(lastDocSnapshot.docs[0]);
        }

        const snapshot = await query.get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, messages: [] });
        }

        // Mapear documentos, incluyendo el ID del documento de Firestore (docId)
        const messages = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));

        // Nota: La API devuelve los mensajes ordenados del más reciente al más antiguo.
        // El frontend los invertirá si necesita mostrarlos en orden cronológico.
        res.status(200).json({ success: true, messages });

    } catch (error) {
        console.error(`Error al obtener mensajes paginados para ${req.params.contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener mensajes.' });
    }
});


// --- Endpoint POST /api/contacts/:contactId/messages/:messageDocId/react (Enviar/quitar reacción) ---
router.post('/contacts/:contactId/messages/:messageDocId/react', async (req, res) => {
    const { contactId, messageDocId } = req.params;
    const { emoji } = req.body; // Emoji para reaccionar, o string vacío para quitar

    try {
        // 1. Obtener el ID de mensaje de WhatsApp (wamid) desde Firestore
        const messageDoc = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').doc(messageDocId).get();
        if (!messageDoc.exists) {
            return res.status(404).json({ success: false, message: 'Mensaje no encontrado.' });
        }
        const messageData = messageDoc.data();
        const wamid = messageData.id; // El ID de WhatsApp

        if (!wamid) {
            return res.status(400).json({ success: false, message: 'Este mensaje no tiene un ID de WhatsApp válido.' });
        }

        // 2. Enviar la reacción a la API de WhatsApp
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: contactId,
            type: 'reaction',
            reaction: {
                message_id: wamid,
                emoji: emoji || "" // Emoji o cadena vacía para eliminar
            }
        };

        await axios.post(
            `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
            payload,
            { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        // 3. Actualizar el estado en Firestore (opcional, para reflejarlo en UI)
        await db.collection('contacts_whatsapp').doc(contactId).collection('messages').doc(messageDocId).update({
            reaction: emoji || admin.firestore.FieldValue.delete()
        });

        res.status(200).json({ success: true, message: emoji ? 'Reacción enviada.' : 'Reacción eliminada.' });

    } catch (error) {
        console.error('Error al enviar reacción:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar la reacción.' });
    }
});

// --- INICIO: ENDPOINTS DE GESTIÓN DE USUARIOS (AGENTS) ---

// GET /api/users - Listar todos los usuarios (de Auth y Firestore)
router.get('/users', async (req, res) => {
    try {
        // 1. Obtener usuarios de Firebase Authentication
        const listUsersResult = await admin.auth().listUsers();
        const authUsers = listUsersResult.users
            .filter(userRecord => userRecord.email) // Filtrar usuarios que no tienen email
            .map(userRecord => ({
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName,
                disabled: userRecord.disabled
            }));

        // 2. Obtener usuarios de la colección 'users' de Firestore
        const snapshot = await db.collection('users').get();
        const firestoreUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 3. Combinar los datos
        // Usaremos el email como clave para unir, asumiendo que es único.
        const combinedUsers = authUsers.map(authUser => {
            // Encontrar el usuario correspondiente en Firestore por email
            const firestoreUser = firestoreUsers.find(fsUser => fsUser.email && fsUser.email.toLowerCase() === authUser.email.toLowerCase());
            // Devolver un objeto combinado. Los datos de Firestore (rol, deptos) prevalecen.
            // El ID de documento de Firestore es el email en minúsculas, así que lo usamos.
            return {
                id: authUser.email.toLowerCase(), // Ahora es seguro llamar a toLowerCase
                uid: authUser.uid,
                email: authUser.email,
                name: firestoreUser?.name || authUser.displayName || authUser.email.split('@')[0],
                role: firestoreUser?.role || 'agent',
                assignedDepartments: firestoreUser?.assignedDepartments || [],
                disabled: authUser.disabled
            };
        });

        res.status(200).json({ success: true, users: combinedUsers });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Error al obtener la lista de usuarios.' });
    }
});

// POST /api/users - Crear un nuevo usuario
router.post('/users', async (req, res) => {
    const { email, name, role, assignedDepartments } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'El correo electrónico es obligatorio.' });
    }

    try {
        // Usar el email como ID del documento para unicidad y fácil acceso
        // Convertir a minúsculas para evitar duplicados por case sensitivity
        const userId = email.toLowerCase().trim();

        const newUser = {
            email: userId, // Guardar email normalizado
            name: name || '',
            role: role || 'agent', // 'admin' o 'agent'
            assignedDepartments: assignedDepartments || [], // Array de IDs de departamentos
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('users').doc(userId).set(newUser);

        res.status(201).json({ success: true, message: 'Usuario creado correctamente.', user: { id: userId, ...newUser } });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, message: 'Error al crear el usuario.' });
    }
});

// PUT /api/users/:userId - Actualizar un usuario
router.put('/users/:userId', async (req, res) => {
    const { userId } = req.params; // Esperamos que sea el email (o ID)
    const { name, role, assignedDepartments } = req.body;

    try {
        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (role !== undefined) updates.role = role;
        if (assignedDepartments !== undefined) updates.assignedDepartments = assignedDepartments;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await userRef.update(updates);

        res.status(200).json({ success: true, message: 'Usuario actualizado correctamente.' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar el usuario.' });
    }
});

// DELETE /api/users/:userId - Eliminar un usuario
router.delete('/users/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        await db.collection('users').doc(userId).delete();
        res.status(200).json({ success: true, message: 'Usuario eliminado correctamente.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Error al eliminar el usuario.' });
    }
});

// GET /api/users/profile/:email - Obtener perfil por email (para login)
router.get('/users/profile/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const userId = email.toLowerCase().trim();
        const doc = await db.collection('users').doc(userId).get();

        if (!doc.exists) {
            // --- LÓGICA DE AUTO-CREACIÓN MEJORADA ---
            // Verificar si el usuario existe en Firebase Authentication
            try {
                const userRecord = await admin.auth().getUserByEmail(userId);
                
                // Si llegamos aquí, el usuario EXISTE en Auth pero NO en la base de datos.
                // Lo creamos automáticamente.
                
                // Determinar rol inicial: Alex es admin, los demás agentes por defecto.
                const initialRole = (userId === 'alex@dekoor.com') ? 'admin' : 'agent';
                
                const newUserData = {
                    email: userId,
                    name: userRecord.displayName || userId.split('@')[0], // Usar nombre de Auth o parte del correo
                    role: initialRole,
                    assignedDepartments: [], // Sin departamentos asignados inicialmente (acceso restringido hasta asignar)
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                };

                // Guardar en Firestore
                await db.collection('users').doc(userId).set(newUserData);
                console.log(`[AUTO-CREATE] Usuario ${userId} sincronizado de Auth a Firestore con rol ${initialRole}.`);

                return res.status(200).json({ success: true, user: { id: userId, ...newUserData } });

            } catch (authError) {
                // Si el usuario NO existe en Authentication (error user-not-found), devolvemos 404 real
                if (authError.code === 'auth/user-not-found') {
                    console.warn(`[LOGIN] Intento de acceso para email no registrado en Auth: ${userId}`);
                    return res.status(404).json({ success: false, message: 'Usuario no registrado en el sistema.' });
                }
                throw authError; // Otros errores
            }
            // -----------------------------
        }

        res.status(200).json({ success: true, user: { id: doc.id, ...doc.data() } });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ success: false, message: 'Error al obtener perfil.' });
    }
});

// --- FIN: ENDPOINTS DE GESTIÓN DE USUARIOS ---

// --- INICIO: ENDPOINTS DE GESTIÓN DE DEPARTAMENTOS ---

// GET /api/departments - Listar todos los departamentos
router.get('/departments', async (req, res) => {
    try {
        const snapshot = await db.collection('departments').orderBy('name').get();
        const departments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json({ success: true, departments });
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).json({ success: false, message: 'Error al obtener departamentos.' });
    }
});

// POST /api/departments - Crear un nuevo departamento
router.post('/departments', async (req, res) => {
    const { name, color, users: userEmails } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: 'El nombre del departamento es obligatorio.' });
    }
    try {
        const newDept = {
            name,
            color: color || '#6c757d', // Default color
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection('departments').add(newDept);
        const deptId = docRef.id;

        // Asignar los usuarios seleccionados al nuevo departamento
        if (Array.isArray(userEmails) && userEmails.length > 0) {
            const batch = db.batch();
            const usersSnapshot = await db.collection('users').get();
            
            for (const userDoc of usersSnapshot.docs) {
                if (userEmails.includes(userDoc.data().email)) {
                    batch.update(userDoc.ref, { 
                        assignedDepartments: admin.firestore.FieldValue.arrayUnion(deptId) 
                    });
                }
            }
            await batch.commit();
        }

        res.status(201).json({ success: true, message: 'Departamento creado.', department: { id: deptId, ...newDept } });
    } catch (error) {
        console.error('Error creating department:', error);
        res.status(500).json({ success: false, message: 'Error al crear el departamento.' });
    }
});

// PUT /api/departments/:id - Actualizar un departamento y sus usuarios
router.put('/departments/:id', async (req, res) => {
    const { id } = req.params;
    const { name, color, users: userEmails } = req.body; // userEmails es un array de emails

    try {
        const deptRef = db.collection('departments').doc(id);
        const batch = db.batch();

        // 1. Actualizar nombre y color del departamento
        const deptUpdateData = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (name) deptUpdateData.name = name;
        if (color) deptUpdateData.color = color;
        batch.update(deptRef, deptUpdateData);

        // 2. Actualizar usuarios asignados (si se proporcionó la lista)
        if (Array.isArray(userEmails)) {
            // Obtener todos los usuarios para comparar
            const usersSnapshot = await db.collection('users').get();
            
            for (const userDoc of usersSnapshot.docs) {
                const userRef = userDoc.ref;
                const userData = userDoc.data();
                const userEmail = userData.email;
                const assignedDepts = userData.assignedDepartments || [];
                
                const shouldBeAssigned = userEmails.includes(userEmail);
                const isCurrentlyAssigned = assignedDepts.includes(id);

                if (shouldBeAssigned && !isCurrentlyAssigned) {
                    // Añadir departamento al usuario
                    batch.update(userRef, { assignedDepartments: admin.firestore.FieldValue.arrayUnion(id) });
                } else if (!shouldBeAssigned && isCurrentlyAssigned) {
                    // Quitar departamento del usuario
                    batch.update(userRef, { assignedDepartments: admin.firestore.FieldValue.arrayRemove(id) });
                }
            }
        }

        await batch.commit();
        res.status(200).json({ success: true, message: 'Departamento y asignaciones actualizados.' });

    } catch (error) {
        console.error(`Error updating department ${id}:`, error);
        res.status(500).json({ success: false, message: 'Error al actualizar el departamento.' });
    }
});


// DELETE /api/departments/:id - Eliminar un departamento
router.delete('/departments/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const batch = db.batch();
        // 1. Eliminar el departamento
        batch.delete(db.collection('departments').doc(id));

        // 2. Quitar el departamento de todos los usuarios que lo tengan asignado
        const usersSnapshot = await db.collection('users').where('assignedDepartments', 'array-contains', id).get();
        usersSnapshot.forEach(doc => {
            batch.update(doc.ref, { assignedDepartments: admin.firestore.FieldValue.arrayRemove(id) });
        });

        await batch.commit();
        res.status(200).json({ success: true, message: 'Departamento eliminado correctamente.' });
    } catch (error) {
        console.error(`Error deleting department ${id}:`, error);
        res.status(500).json({ success: false, message: 'Error al eliminar el departamento.' });
    }
});

// --- FIN: ENDPOINTS DE GESTIÓN DE DEPARTAMENTOS ---

// --- Endpoint GET /api/whatsapp-templates (Obtener plantillas aprobadas) ---
router.get('/whatsapp-templates', async (req, res) => {
    // Validar credenciales
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp Business.' });
    }

    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    try {
        // Llamar a la API de Meta
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });

        // Filtrar solo plantillas APROBADAS y mapear a formato útil
        const templates = response.data.data
            .filter(t => t.status === 'APPROVED') // Solo aprobadas
            .map(t => ({
                name: t.name,
                language: t.language,
                status: t.status,
                category: t.category,
                // Mapear componentes (header, body, footer, buttons)
                components: t.components.map(c => ({
                    type: c.type,
                    text: c.text, // Texto (puede tener variables {{n}})
                    format: c.format, // Para header (IMAGE, TEXT, VIDEO, DOCUMENT)
                    buttons: c.buttons // Array de botones si type es BUTTONS
                }))
            }));
        res.status(200).json({ success: true, templates });
    } catch (error) {
        console.error('Error al obtener plantillas de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al obtener las plantillas de WhatsApp.' });
    }
});


// --- Endpoint POST /api/campaigns/send-template (Enviar campaña de texto) ---
router.post('/campaigns/send-template', async (req, res) => {
    const { contactIds, template } = req.body; // template es el objeto completo

    // Validaciones
    if (!contactIds?.length || !template) {
        return res.status(400).json({ success: false, message: 'Se requieren IDs de contacto y una plantilla.' });
    }

    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let successful = 0;
    let failed = 0;
    const failedDetails = [];

    // Enviar mensaje a cada contacto (con pequeño delay)
    for (const contactId of contactIds) {
        try {
            // Construir payload usando la función helper
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template); // Sin imagen, sin params extra

            // Enviar a WhatsApp
            const response = await axios.post(url, payload, { headers });
            const messageId = response.data.messages[0].id;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();

            // Guardar en Firestore
            const contactRef = db.collection('contacts_whatsapp').doc(contactId);
            await contactRef.collection('messages').add({
                from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId, text: messageToSaveText
            });
            // Actualizar último mensaje del contacto
            await contactRef.update({
                lastMessage: messageToSaveText, lastMessageTimestamp: timestamp, unreadCount: 0
            });

            successful++;
        } catch (error) {
            console.error(`Error en campaña (texto) a ${contactId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
            failed++;
            failedDetails.push({ contactId, error: error.response ? JSON.stringify(error.response.data) : error.message });
        }
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay de 300ms
    }

    res.status(200).json({
        success: true,
        message: `Campaña de texto procesada.`,
        results: { successful: successful, failed: failed, details: failedDetails }
    });
});

// --- Endpoint POST /api/campaigns/send-template-with-image (Enviar campaña con imagen) ---
router.post('/campaigns/send-template-with-image', async (req, res) => {
    const { contactIds, templateObject, imageUrl, phoneNumber } = req.body;

    // Validaciones
    if ((!contactIds || !contactIds.length) && !phoneNumber) {
        return res.status(400).json({ success: false, message: 'Se requiere una lista de IDs de contacto o un número de teléfono.' });
    }
    if (!templateObject || !templateObject.name) {
        return res.status(400).json({ success: false, message: 'Se requiere el objeto de la plantilla.' });
    }
    if (!imageUrl) {
        return res.status(400).json({ success: false, message: 'Se requiere la URL de la imagen.' });
    }
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    }

    // Determinar a quién enviar
    const targets = phoneNumber ? [phoneNumber] : contactIds;
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let successful = 0;
    let failed = 0;
    const failedDetails = [];

    // Enviar a cada destinatario
    for (const contactId of targets) {
        try {
            // Construir payload (incluyendo imageUrl)
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, templateObject, imageUrl);

            // Enviar a WhatsApp
            const response = await axios.post(url, payload, { headers });
            const messageId = response.data.messages[0].id;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();

            // Guardar/Actualizar contacto y mensaje en Firestore
            const contactRef = db.collection('contacts_whatsapp').doc(contactId);
            // Asegurarse de que el contacto exista (crear si no)
            await contactRef.set({
                name: `Nuevo Contacto (${contactId.slice(-4)})`, // Nombre genérico
                wa_id: contactId,
                lastMessage: messageToSaveText,
                lastMessageTimestamp: timestamp,
                unreadCount: 0 // Resetear no leídos
            }, { merge: true }); // Usar merge para no sobrescribir datos existentes como tags

            // Guardar el mensaje enviado
            await contactRef.collection('messages').add({
                from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId,
                text: messageToSaveText, fileUrl: imageUrl, fileType: 'image/external' // Marcar como imagen externa
            });

            successful++;
        } catch (error) {
            console.error(`Error en campaña con imagen a ${contactId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
            failed++;
            failedDetails.push({ contactId, error: error.response ? JSON.stringify(error.response.data) : error.message });
        }
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay
    }

    res.status(200).json({
        success: true,
        message: `Campaña con imagen procesada.`,
        results: { successful: successful, failed: failed, details: failedDetails }
    });
});

// --- Endpoint POST /api/storage/generate-signed-url (Generar URL firmada para subida a GCS) ---
router.post('/storage/generate-signed-url', async (req, res) => {
    const { fileName, contentType, pathPrefix } = req.body;

    // Validaciones
    if (!fileName || !contentType || !pathPrefix) {
        return res.status(400).json({ success: false, message: 'Faltan fileName, contentType o pathPrefix.' });
    }

    // Crear ruta única en GCS
    const filePath = `${pathPrefix}/${Date.now()}_${fileName.replace(/\s/g, '_')}`;
    const file = bucket.file(filePath);

    // Opciones para la URL firmada (v4, escritura, expira en 15 min)
    const options = {
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType: contentType, // Forzar tipo de contenido en la subida
    };

    try {
        // Generar la URL firmada
        const [signedUrl] = await file.getSignedUrl(options);
        // Generar la URL pública (para guardar en Firestore después de subir)
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

        // Devolver ambas URLs al cliente
        res.status(200).json({
            success: true,
            signedUrl, // URL para subir el archivo
            publicUrl, // URL para acceder al archivo después
        });
    } catch (error) {
        console.error('Error al generar la URL firmada:', error);
        res.status(500).json({ success: false, message: 'No se pudo generar la URL para la subida.' });
    }
});


// --- Endpoint GET /api/orders/cohort-progression (Progresión de cobro por cohorte) ---
router.get('/orders/cohort-progression', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'Se requiere una fecha (date).' });
        }

        const start = new Date(date + 'T00:00:00-06:00');
        const end = new Date(date + 'T23:59:59-06:00');
        const firestoreStart = admin.firestore.Timestamp.fromDate(start);
        const firestoreEnd = admin.firestore.Timestamp.fromDate(end);

        const ordersSnap = await db.collection('pedidos')
            .where('createdAt', '>=', firestoreStart)
            .where('createdAt', '<=', firestoreEnd)
            .get();

        let proyectado = 0;
        const totalOrders = ordersSnap.docs.length;
        const confirmations = [];

        ordersSnap.docs.forEach(doc => {
            const data = doc.data();
            const amount = parseFloat(data.precio) || 0;
            const rawStatus = (data.estatus || '').toLowerCase();
            const isConfirmed = rawStatus.includes('fabricar') || rawStatus.includes('pagado');

            proyectado += amount;

            if (isConfirmed) {
                let confirmDate = date;
                if (data.confirmedAt && data.confirmedAt.toDate) {
                    const d = data.confirmedAt.toDate();
                    const mx = new Date(d.getTime() - 6 * 60 * 60 * 1000);
                    confirmDate = mx.toISOString().split('T')[0];
                }
                confirmations.push({ date: confirmDate, amount, orderId: doc.id });
            }
        });

        const byDay = {};
        confirmations.forEach(c => {
            if (!byDay[c.date]) byDay[c.date] = { amount: 0, count: 0 };
            byDay[c.date].amount += c.amount;
            byDay[c.date].count += 1;
        });

        const sortedDays = Object.keys(byDay).sort();
        let cumAmount = 0;
        let cumCount = 0;
        const progression = sortedDays.map(day => {
            cumAmount += byDay[day].amount;
            cumCount += byDay[day].count;
            return {
                date: day,
                dayAmount: Math.round(byDay[day].amount * 100) / 100,
                dayCount: byDay[day].count,
                cumAmount: Math.round(cumAmount * 100) / 100,
                cumCount: cumCount
            };
        });

        const totalConfirmed = Math.round(cumAmount * 100) / 100;

        res.status(200).json({
            success: true,
            cohortDate: date,
            proyectado: Math.round(proyectado * 100) / 100,
            totalOrders,
            totalConfirmed,
            totalConfirmedOrders: cumCount,
            progression
        });
    } catch (error) {
        console.error('Error fetching cohort progression:', error);
        res.status(500).json({ success: false, message: 'Error al obtener la progresión.', error: error.message });
    }
});

// --- Endpoint POST /api/orders/backfill-confirmed (Rellenar confirmedAt en pedidos existentes) ---
router.post('/orders/backfill-confirmed', async (req, res) => {
    try {
        const ordersSnap = await db.collection('pedidos').get();
        let updated = 0;
        let skipped = 0;
        const batch = db.batch();

        ordersSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.confirmedAt) { skipped++; return; }

            const rawStatus = (data.estatus || '').toLowerCase();
            const isConfirmed = rawStatus.includes('fabricar') || rawStatus.includes('pagado');
            if (!isConfirmed) { skipped++; return; }

            if (data.createdAt) {
                batch.update(doc.ref, { confirmedAt: data.createdAt });
                updated++;
            }
        });

        if (updated > 0) await batch.commit();

        res.status(200).json({
            success: true,
            message: `Backfill completado. ${updated} pedidos actualizados, ${skipped} omitidos.`,
            updated,
            skipped
        });
    } catch (error) {
        console.error('Error en backfill:', error);
        res.status(500).json({ success: false, message: 'Error en backfill.', error: error.message });
    }
});

// --- Endpoint GET /api/orders/:orderId (Obtener un pedido por ID) ---
router.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const docRef = db.collection('pedidos').doc(orderId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }
        // Devolver datos del pedido incluyendo su ID
        res.status(200).json({ success: true, order: { id: doc.id, ...doc.data() } });
    } catch (error) {
        console.error('Error fetching single order:', error);
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

// --- Endpoint PUT /api/orders/:orderId (Actualizar un pedido) ---
router.put('/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const updateData = req.body; // Datos enviados desde el frontend

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

        // --- Manejo de eliminación de fotos ---
        // Combinar URLs de fotos existentes (pedido y promoción)
        const existingPhotos = new Set([
            ...(existingData.fotoUrls || []),
            ...(existingData.fotoPromocionUrls || [])
        ]);
        // Combinar URLs de fotos actualizadas
        const updatedPhotos = new Set([
            ...(updateData.fotoUrls || []),
            ...(updateData.fotoPromocionUrls || [])
        ]);

        // Encontrar URLs que estaban antes pero ya no están
        const photosToDelete = [...existingPhotos].filter(url => !updatedPhotos.has(url));

        // Borrar las fotos eliminadas de GCS
        const deletePromises = photosToDelete.map(url => {
            try {
                // Extraer la ruta del archivo de la URL pública
                const filePath = new URL(url).pathname.split(`/${bucket.name}/`)[1];
                if (!filePath) throw new Error('Invalid GCS URL path');
                console.log(`[GCS DELETE] Intentando borrar: ${decodeURIComponent(filePath)}`);
                return bucket.file(decodeURIComponent(filePath)).delete()
                    .catch(err => console.warn(`No se pudo eliminar la foto antigua ${url}:`, err.message)); // No fallar si el borrado falla
            } catch (error) {
                console.warn(`URL de foto inválida o error al parsear, no se puede eliminar de storage: ${url}`, error.message);
                return Promise.resolve(); // Continuar aunque falle el parseo/borrado
            }
        });

        await Promise.all(deletePromises); // Esperar a que terminen los intentos de borrado

        // Hacer públicas las fotos nuevas
        for (const url of updatedPhotos) {
            if (url && url.includes(bucket.name) && !existingPhotos.has(url)) {
                try {
                    const filePath = new URL(url).pathname.split(`/${bucket.name}/`)[1];
                    if (filePath) {
                        await bucket.file(decodeURIComponent(filePath)).makePublic();
                    }
                } catch (e) {
                    console.error('Error al hacer pública la foto nueva de GCS:', e);
                }
            }
        }

        // Registrar confirmedAt cuando el pedido se confirma por primera vez vía API
        if (updateData.estatus) {
            const newStatus = (updateData.estatus || '').toLowerCase();
            const oldStatus = (existingData.estatus || '').toLowerCase();
            const isConfirming = newStatus.includes('fabricar') || newStatus.includes('pagado');
            const wasConfirmed = oldStatus.includes('fabricar') || oldStatus.includes('pagado');
            if (isConfirming && !wasConfirmed && !existingData.confirmedAt) {
                updateData.confirmedAt = admin.firestore.FieldValue.serverTimestamp();
            }
        }

        // Actualizar el documento del pedido en Firestore con los nuevos datos
        await orderRef.update(updateData);

        res.status(200).json({ success: true, message: 'Pedido actualizado con éxito.' });

    } catch (error) {
        console.error(`Error al actualizar el pedido ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el pedido.' });
    }
});


// --- Endpoint POST /api/orders (Crear nuevo pedido) ---
router.post('/orders', async (req, res) => {
    // Extraer datos del cuerpo de la solicitud
    const {
        contactId, // ID del contacto de WhatsApp asociado
        producto,
        telefono, // Puede ser diferente al contactId si se edita manualmente
        precio,
        datosProducto,
        datosPromocion,
        comentarios,
        fotoUrls, // Array de URLs de GCS para fotos del producto
        fotoPromocionUrls // Array de URLs de GCS para fotos de la promoción
    } = req.body;

    // Validaciones básicas
    if (!contactId || !producto || !telefono) {
        return res.status(400).json({ success: false, message: 'Faltan datos obligatorios: contactId, producto y teléfono.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        // Referencia al contador de pedidos en Firestore
        const orderCounterRef = db.collection('counters').doc('orders');

        // --- Generar número de pedido consecutivo usando una transacción ---
        const newOrderNumber = await db.runTransaction(async (transaction) => {
            const counterDoc = await transaction.get(orderCounterRef);
            let currentCounter = counterDoc.exists ? counterDoc.data().lastOrderNumber || 0 : 0;
            // Asegurar que el contador empiece en 1001 si es menor
            const nextOrderNumber = (currentCounter < 1000) ? 1001 : currentCounter + 1;
            // Actualizar el contador dentro de la transacción
            transaction.set(orderCounterRef, { lastOrderNumber: nextOrderNumber }, { merge: true });
            return nextOrderNumber;
        });

        // Crear objeto del nuevo pedido
        const nuevoPedido = {
            contactId, // Guardar ID del contacto asociado
            producto,
            telefono,
            precio: precio || 0,
            datosProducto: datosProducto || '',
            datosPromocion: datosPromocion || '',
            comentarios: comentarios || '',
            fotoUrls: fotoUrls || [], // Guardar array de URLs
            fotoPromocionUrls: fotoPromocionUrls || [], // Guardar array de URLs
            consecutiveOrderNumber: newOrderNumber, // Número consecutivo
            createdAt: admin.firestore.FieldValue.serverTimestamp(), // Fecha de creación
            estatus: "Sin estatus", // Estatus inicial
            telefonoVerificado: false, // Checkbox inicial
            estatusVerificado: false // Checkbox inicial
            // createdBy: userId (si se implementa autenticación de usuarios del CRM)
        };

        // Hacer públicas las fotos para que se vean en la lista de pedidos
        const allUrls = [...(fotoUrls || []), ...(fotoPromocionUrls || [])];
        for (const url of allUrls) {
            if (url && url.includes(bucket.name)) {
                try {
                    const filePath = new URL(url).pathname.split(`/${bucket.name}/`)[1];
                    if (filePath) {
                        await bucket.file(decodeURIComponent(filePath)).makePublic();
                    }
                } catch (e) {
                    console.error('Error al hacer pública la foto de GCS:', e);
                }
            }
        }

        // Añadir el nuevo pedido a la colección 'pedidos'
        const newOrderRef = await db.collection('pedidos').add(nuevoPedido);

        // Actualizar el documento del contacto con la información del último pedido y MARCAR COMO COMPRADOR
        await contactRef.update({
            lastOrderNumber: newOrderNumber,
            lastOrderDate: nuevoPedido.createdAt, // Usar el mismo timestamp
            purchaseStatus: 'completed', // <-- NUEVO: Marcar como comprador para el ícono de corona
            purchaseValue: parseFloat(precio) || 0, // Opcional: guardar valor
            purchaseDate: admin.firestore.FieldValue.serverTimestamp() // Opcional: guardar fecha de compra
        });

        // --- INICIO: Enviar evento Purchase a Meta ---
        try {
            console.log(`[META EVENT] Iniciando envío de evento Purchase para pedido DH${newOrderNumber}, contactId: ${contactId}`);
            // Obtener datos actualizados del contacto para el evento
            const contactDoc = await contactRef.get();
            if (!contactDoc.exists) {
                console.warn(`[META EVENT] No se encontró el documento del contacto ${contactId}. No se enviará evento Purchase.`);
            } else {
                const contactData = contactDoc.data();

                // Verificar si tiene wa_id (necesario para Meta)
                if (!contactData.wa_id) {
                    console.warn(`[META EVENT] El contacto ${contactId} no tiene wa_id. No se puede enviar evento Purchase a Meta.`);
                } else {
                    const eventInfo = {
                        wa_id: contactData.wa_id,
                        profile: { name: contactData.name }
                    };

                    const customData = {
                        value: parseFloat(precio) || 0,
                        currency: 'MXN'
                    };

                    console.log(`[META EVENT] Datos: wa_id=${contactData.wa_id}, adReferral=${JSON.stringify(contactData.adReferral || {})}, valor=${precio}`);
                    // Enviar evento
                    await sendConversionEvent('Purchase', eventInfo, contactData.adReferral || {}, customData);
                    console.log(`[META EVENT] Evento Purchase enviado por pedido DH${newOrderNumber} valor $${precio}`);
                }
            }
        } catch (metaError) {
            console.error('[META EVENT] Error al enviar evento Purchase automático:', metaError.message);
            if (metaError.response) console.error('[META EVENT] Respuesta de Meta:', JSON.stringify(metaError.response.data));
            // No fallar el request principal si falla el evento
        }
        // --- FIN: Enviar evento Purchase a Meta ---

        // Devolver éxito y el número de pedido generado
        res.status(201).json({
            success: true,
            message: 'Pedido registrado con éxito.',
            orderNumber: `DH${newOrderNumber}` // Formato DHxxxx
        });

    } catch (error) {
        console.error('Error al registrar el nuevo pedido:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al registrar el pedido.' });
    }
});


// --- Endpoint POST /api/contacts/:contactId/mark-as-purchase (Marcar compra y enviar evento a Meta) ---
router.post('/contacts/:contactId/mark-as-purchase', async (req, res) => {
    const { contactId } = req.params;
    const { value } = req.body; // Valor de la compra

    // Validar valor
    if (!value || isNaN(parseFloat(value))) {
        return res.status(400).json({ success: false, message: 'Se requiere un valor numérico válido para la compra.' });
    }

    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }
        const contactData = contactDoc.data();

        // Evitar registrar la compra dos veces
        if (contactData.purchaseStatus === 'completed') {
            return res.status(400).json({ success: false, message: 'Este contacto ya realizó una compra registrada.' });
        }
        // Asegurar que tenemos el wa_id para el evento de Meta
        if (!contactData.wa_id) {
            return res.status(500).json({ success: false, message: "Error interno: El contacto no tiene un ID de WhatsApp guardado para enviar el evento a Meta." });
        }

        // Preparar información para el evento de Meta
        const eventInfo = {
            wa_id: contactData.wa_id,
            profile: { name: contactData.name }
        };
        const customEventData = {
            value: parseFloat(value),
            currency: 'MXN' // Moneda
        };

        // Enviar evento 'Purchase' a la API de Conversiones de Meta
        await sendConversionEvent('Purchase', eventInfo, contactData.adReferral || {}, customEventData);

        // Actualizar el estado del contacto en Firestore
        await contactRef.update({
            purchaseStatus: 'completed',
            purchaseValue: parseFloat(value),
            purchaseCurrency: 'MXN',
            purchaseDate: admin.firestore.FieldValue.serverTimestamp()
            // Podrías añadir lógica para actualizar la etiqueta ('status') aquí si es necesario
            // status: 'venta_cerrada' // Por ejemplo
        });

        res.status(200).json({ success: true, message: 'Compra registrada y evento enviado a Meta con éxito.' });
    } catch (error) {
        console.error(`Error en mark-as-purchase para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar la compra.' });
    }
});

// --- Endpoint POST /api/contacts/:contactId/send-view-content (Enviar evento ViewContent a Meta) ---
router.post('/contacts/:contactId/send-view-content', async (req, res) => {
    const { contactId } = req.params;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }
        const contactData = contactDoc.data();

        if (!contactData.wa_id) {
            return res.status(500).json({ success: false, message: "Error interno: El contacto no tiene un ID de WhatsApp guardado para enviar el evento a Meta." });
        }

        // Preparar información para el evento
        const eventInfo = {
            wa_id: contactData.wa_id,
            profile: { name: contactData.name }
        };

        // Enviar evento 'ViewContent'
        await sendConversionEvent('ViewContent', eventInfo, contactData.adReferral || {});

        res.status(200).json({ success: true, message: 'Evento ViewContent enviado a Meta con éxito.' });
    } catch (error) {
        console.error(`Error en send-view-content para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar el envío de ViewContent.' });
    }
});


// --- Endpoints para Notas Internas (/api/contacts/:contactId/notes) ---
// POST (Crear)
router.post('/contacts/:contactId/notes', async (req, res) => {
    const { contactId } = req.params;
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    }
    try {
        // Añadir nota a la subcolección 'notes' del contacto
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').add({
            text,
            timestamp: admin.firestore.FieldValue.serverTimestamp() // Guardar hora de creación
        });
        res.status(201).json({ success: true, message: 'Nota guardada con éxito.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al guardar la nota.' });
    }
});

// PUT (Actualizar)
router.put('/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    }
    try {
        // Actualizar el texto de la nota específica
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId).update({
            text: text
            // Podrías añadir un campo 'updatedAt' si quisieras rastrear ediciones
        });
        res.status(200).json({ success: true, message: 'Nota actualizada con éxito.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar la nota.' });
    }
});

// DELETE (Borrar)
router.delete('/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    try {
        // Borrar la nota específica
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId).delete();
        res.status(200).json({ success: true, message: 'Nota eliminada con éxito.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar la nota.' });
    }
});


// --- Endpoints para Respuestas Rápidas (/api/quick-replies) ---
// POST (Crear)
router.post('/quick-replies', async (req, res) => {
    const { shortcut, message, fileUrl, fileType } = req.body;
    // Validaciones
    if (!shortcut || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'El atajo y un mensaje o archivo adjunto son obligatorios.' });
    }
    if (fileUrl && !fileType) { // Si hay archivo, se necesita el tipo
        return res.status(400).json({ success: false, message: 'El tipo de archivo es obligatorio si se adjunta uno.' });
    }

    try {
        // Asegurar que archivo GCS sea público
        if (fileUrl && fileUrl.includes(bucket.name)) {
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(decodeURIComponent(filePath)).makePublic();
                console.log(`[GCS-QR] Archivo ${decodeURIComponent(filePath)} hecho público con éxito.`);
            } catch (gcsError) {
                console.error(`[GCS-QR] No se pudo hacer público el archivo ${fileUrl}:`, gcsError);
                // No fallar la operación, solo loguear
            }
        }

        // Verificar si el atajo ya existe
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty) {
            return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        }

        // Crear datos para Firestore (null si no hay valor)
        const replyData = {
            shortcut,
            message: message || null,
            fileUrl: fileUrl || null,
            fileType: fileType || null
        };
        // Añadir a Firestore
        const newReply = await db.collection('quick_replies').add(replyData);
        res.status(201).json({ success: true, id: newReply.id, data: replyData });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al crear la respuesta rápida.' });
    }
});

// PUT (Actualizar)
router.put('/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    const { shortcut, message, fileUrl, fileType } = req.body;
    // Validaciones
    if (!shortcut || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'El atajo y un mensaje o archivo adjunto son obligatorios.' });
    }
    if (fileUrl && !fileType) {
        return res.status(400).json({ success: false, message: 'El tipo de archivo es obligatorio si se adjunta uno.' });
    }

    try {
        // Asegurar que archivo GCS sea público
        if (fileUrl && fileUrl.includes(bucket.name)) {
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(decodeURIComponent(filePath)).makePublic();
                console.log(`[GCS-QR] Archivo ${decodeURIComponent(filePath)} hecho público con éxito.`);
            } catch (gcsError) {
                console.error(`[GCS-QR] No se pudo hacer público el archivo ${fileUrl}:`, gcsError);
            }
        }

        // Verificar si el nuevo atajo ya existe en *otro* documento
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) { // Asegurarse de que no sea el mismo documento
            return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya está en uso por otra respuesta.` });
        }

        // Crear datos para actualizar
        const updateData = {
            shortcut,
            message: message || null,
            fileUrl: fileUrl || null,
            fileType: fileType || null
        };
        // Actualizar en Firestore
        await db.collection('quick_replies').doc(id).update(updateData);
        res.status(200).json({ success: true, message: 'Respuesta rápida actualizada.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar.' });
    }
});

// DELETE (Borrar)
router.delete('/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Borrar de Firestore
        await db.collection('quick_replies').doc(id).delete();
        res.status(200).json({ success: true, message: 'Respuesta rápida eliminada.' });
        // Nota: No se borra el archivo de GCS asociado automáticamente.
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar.' });
    }
});


// --- Endpoints para Etiquetas (/api/tags) ---
// POST (Crear)
router.post('/tags', async (req, res) => {
    const { label, color, key, order } = req.body;
    if (!label || !color || !key || order === undefined) {
        return res.status(400).json({ success: false, message: 'Faltan datos (label, color, key, order).' });
    }
    try {
        await db.collection('crm_tags').add({ label, color, key, order });
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al crear la etiqueta.' });
    }
});

// PUT (Actualizar Orden)
router.put('/tags/order', async (req, res) => {
    const { orderedIds } = req.body; // Array de IDs en el nuevo orden
    if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ success: false, message: 'Se esperaba un array de IDs.' });
    }
    try {
        const batch = db.batch();
        // Actualizar el campo 'order' de cada etiqueta según su posición en el array
        orderedIds.forEach((id, index) => {
            const docRef = db.collection('crm_tags').doc(id);
            batch.update(docRef, { order: index });
        });
        await batch.commit(); // Ejecutar todas las actualizaciones en lote
        res.status(200).json({ success: true, message: 'Orden de etiquetas actualizado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar orden.' });
    }
});

// PUT (Actualizar una etiqueta)
router.put('/tags/:id', async (req, res) => {
    const { id } = req.params;
    const { label, color, key } = req.body;
    if (!label || !color || !key) {
        return res.status(400).json({ success: false, message: 'Faltan datos (label, color, key).' });
    }
    try {
        await db.collection('crm_tags').doc(id).update({ label, color, key });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al actualizar la etiqueta.' });
    }
});

// DELETE (Borrar una etiqueta)
router.delete('/tags/:id', async (req, res) => {
    try {
        await db.collection('crm_tags').doc(req.params.id).delete();
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al eliminar la etiqueta.' });
    }
});

// DELETE (Borrar TODAS las etiquetas)
router.delete('/tags', async (req, res) => {
    try {
        const snapshot = await db.collection('crm_tags').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref)); // Añadir borrado de cada doc al lote
        await batch.commit(); // Ejecutar borrado en lote
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al eliminar todas las etiquetas.' });
    }
});


// --- Endpoints para Mensajes de Anuncios (/api/ad-responses) ---
// POST (Crear)
router.post('/ad-responses', async (req, res) => {
    const { adName, adIds: adIdsInput, message, fileUrl, fileType } = req.body;
    const adIds = parseAdIds(adIdsInput); // Usa la función helper para limpiar

    if (!adName || adIds.length === 0 || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'Nombre, al menos un Ad ID válido, y un mensaje o archivo son obligatorios.' });
    }

    try {
        if (fileUrl && fileUrl.includes(bucket.name)) { // Hacer público archivo GCS
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(decodeURIComponent(filePath)).makePublic();
                console.log(`[GCS-AD] Archivo ${decodeURIComponent(filePath)} hecho público.`);
            } catch (gcsError) { console.error(`[GCS-AD] Warn: No se pudo hacer público ${fileUrl}:`, gcsError); }
        }

        // Verificar conflictos de Ad ID
        const snapshot = await db.collection('ad_responses').where('adIds', 'array-contains-any', adIds).get();
        if (!snapshot.empty) {
            const conflictingIds = snapshot.docs.reduce((acc, doc) => {
                const docIds = doc.data().adIds || [];
                const overlap = adIds.filter(id => docIds.includes(id));
                return acc.concat(overlap);
            }, []);
            if (conflictingIds.length > 0) {
                return res.status(409).json({ success: false, message: `Los Ad IDs ya están en uso: ${[...new Set(conflictingIds)].join(', ')}` });
            }
        }

        // Guardar en Firestore
        const data = { adName, adIds, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        const newResponse = await db.collection('ad_responses').add(data);
        res.status(201).json({ success: true, id: newResponse.id, data });
    } catch (error) {
        console.error("Error creating ad response:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al crear el mensaje.' });
    }
});

// PUT (Actualizar)
router.put('/ad-responses/:id', async (req, res) => {
    const { id } = req.params;
    const { adName, adIds: adIdsInput, message, fileUrl, fileType } = req.body;
    const adIds = parseAdIds(adIdsInput); // Limpiar IDs

    if (!adName || adIds.length === 0 || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'Nombre, al menos un Ad ID válido, y un mensaje o archivo son obligatorios.' });
    }
    try {
        if (fileUrl && fileUrl.includes(bucket.name)) { // Hacer público archivo GCS
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(decodeURIComponent(filePath)).makePublic();
                console.log(`[GCS-AD] Archivo ${decodeURIComponent(filePath)} hecho público.`);
            } catch (gcsError) { console.error(`[GCS-AD] Warn: No se pudo hacer público ${fileUrl}:`, gcsError); }
        }

        // Verificar conflictos (excluyendo el documento actual)
        const snapshot = await db.collection('ad_responses').where('adIds', 'array-contains-any', adIds).get();
        let conflict = false;
        let conflictingIdsList = [];
        snapshot.forEach(doc => {
            if (doc.id !== id) { // No comparar consigo mismo
                const docIds = doc.data().adIds || [];
                const overlap = adIds.filter(newId => docIds.includes(newId));
                if (overlap.length > 0) {
                    conflict = true;
                    conflictingIdsList = conflictingIdsList.concat(overlap);
                }
            }
        });

        if (conflict) {
            return res.status(409).json({ success: false, message: `Ad IDs en uso por otros mensajes: ${[...new Set(conflictingIdsList)].join(', ')}` });
        }

        // Actualizar en Firestore
        const data = { adName, adIds, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        await db.collection('ad_responses').doc(id).update(data);
        res.status(200).json({ success: true, message: 'Mensaje de anuncio actualizado.' });
    } catch (error) {
        console.error("Error updating ad response:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar.' });
    }
});
// DELETE (Borrar)
router.delete('/ad-responses/:id', async (req, res) => {
    try {
        // Borrar de Firestore
        await db.collection('ad_responses').doc(req.params.id).delete();
        res.status(200).json({ success: true, message: 'Mensaje de anuncio eliminado.' });
        // Nota: No se borra el archivo de GCS asociado.
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar.' });
    }
});



// --- Endpoints para Ajustes Generales (/api/settings/...) ---
// GET (Obtener estado del mensaje de ausencia)
router.get('/settings/away-message', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        // Devolver estado o true por defecto si no existe
        res.status(200).json({ success: true, settings: { isActive: doc.exists ? doc.data().awayMessageActive : true } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener ajuste de mensaje de ausencia.' });
    }
});

// POST (Guardar estado del mensaje de ausencia)
router.post('/settings/away-message', async (req, res) => {
    try {
        // Guardar estado en el documento 'general' (usar merge para no borrar otros ajustes)
        await db.collection('crm_settings').doc('general').set({ awayMessageActive: req.body.isActive }, { merge: true });
        res.status(200).json({ success: true, message: 'Ajuste de mensaje de ausencia guardado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar ajuste.' });
    }
});



// GET (Obtener ID de Google Sheet)
router.get('/settings/google-sheet', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        // Devolver ID o string vacío si no existe
        res.status(200).json({ success: true, settings: { googleSheetId: doc.exists ? doc.data().googleSheetId : '' } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener ID de Google Sheet.' });
    }
});

// POST (Guardar ID de Google Sheet)
router.post('/settings/google-sheet', async (req, res) => {
    try {
        // Guardar ID en el documento 'general'
        await db.collection('crm_settings').doc('general').set({ googleSheetId: req.body.googleSheetId }, { merge: true });
        res.status(200).json({ success: true, message: 'ID de Google Sheet guardado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar ID.' });
    }
});



// --- Endpoint POST /api/test/simulate-ad-message (Simular mensaje de anuncio) ---
router.post('/test/simulate-ad-message', async (req, res) => {
    const { from, adId, text } = req.body;
    if (!from || !adId || !text) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros (from, adId, text).' });
    }

    // Construir un payload falso similar al que enviaría Meta
    const fakePayload = {
        object: 'whatsapp_business_account',
        entry: [{
            id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || 'DUMMY_WABA_ID', // Usar variable de entorno o dummy
            changes: [{
                value: {
                    messaging_product: 'whatsapp',
                    metadata: {
                        display_phone_number: (PHONE_NUMBER_ID || '15550001111').slice(-10), // Usar variable o dummy
                        phone_number_id: PHONE_NUMBER_ID || '15550001111'
                    },
                    contacts: [{ profile: { name: `Test User ${from.slice(-4)}` }, wa_id: from }],
                    messages: [{
                        from: from,
                        id: `wamid.TEST_${uuidv4()}`, // ID de mensaje falso único
                        timestamp: Math.floor(Date.now() / 1000).toString(),
                        text: { body: text },
                        type: 'text',
                        // Incluir la sección 'referral' para simular origen de anuncio
                        referral: {
                            source_url: `https://fb.me/xxxxxxxx`, // URL genérica
                            source_type: 'ad',
                            source_id: adId, // El Ad ID proporcionado
                            headline: 'Anuncio de Prueba Simulado' // Texto genérico
                        }
                    }]
                },
                field: 'messages'
            }]
        }]
    };

    try {
        console.log(`[SIMULATOR] Recibida simulación para ${from} desde Ad ID ${adId}.`);
        // Enviar el payload falso al propio endpoint del webhook
        // Asegúrate de que la URL y el puerto sean correctos para tu entorno (local o producción)
        const webhookUrl = `http://localhost:${PORT}/webhook`; // Cambiar si es necesario
        await axios.post(webhookUrl, fakePayload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`[SIMULATOR] Simulación enviada al webhook (${webhookUrl}) con éxito.`);
        res.status(200).json({ success: true, message: 'Simulación procesada por el webhook.' });
    } catch (error) {
        console.error('❌ ERROR EN EL SIMULADOR:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Error interno al procesar la simulación.' });
    }
});

// --- Endpoint GET /api/metrics (Obtener métricas de mensajes) ---
router.get('/metrics', async (req, res) => {
    try {
        // Rango de fechas: últimos 30 días
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30); // Restar 30 días
        const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);

        // Obtener todas las etiquetas de los contactos para mapear
        const contactsSnapshot = await db.collection('contacts_whatsapp').get();
        const contactTags = {};
        contactsSnapshot.forEach(doc => {
            contactTags[doc.id] = doc.data().status || 'sin_etiqueta'; // Mapear ID de contacto a su etiqueta
        });

        // Obtener todos los mensajes entrantes en el rango de fechas usando collectionGroup
        const messagesSnapshot = await db.collectionGroup('messages')
            .where('timestamp', '>=', startTimestamp)
            .where('timestamp', '<=', endTimestamp)
            .where('from', '!=', PHONE_NUMBER_ID) // Solo mensajes entrantes (no enviados por el bot)
            .get();

        // Procesar mensajes para agrupar por fecha y etiqueta
        const metricsByDate = {};
        messagesSnapshot.forEach(doc => {
            const message = doc.data();
            const contactId = doc.ref.parent.parent.id; // ID del contacto (documento padre de la subcolección)

            // Obtener fecha en formato YYYY-MM-DD
            const dateKey = message.timestamp.toDate().toISOString().split('T')[0];

            // Inicializar contador para la fecha si no existe
            if (!metricsByDate[dateKey]) {
                metricsByDate[dateKey] = { totalMessages: 0, tags: {} };
            }

            // Incrementar contador total para la fecha
            metricsByDate[dateKey].totalMessages++;

            // Obtener etiqueta del contacto
            const tag = contactTags[contactId] || 'sin_etiqueta'; // Usar 'sin_etiqueta' si no tiene

            // Inicializar y/o incrementar contador para esa etiqueta en esa fecha
            if (!metricsByDate[dateKey].tags[tag]) {
                metricsByDate[dateKey].tags[tag] = 0;
            }
            metricsByDate[dateKey].tags[tag]++;
        });

        // Formatear resultados en un array ordenado por fecha
        const formattedMetrics = Object.keys(metricsByDate)
            .map(date => ({
                date,
                totalMessages: metricsByDate[date].totalMessages,
                tags: metricsByDate[date].tags // Objeto con cuentas por etiqueta para ese día
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date)); // Ordenar cronológicamente

        res.status(200).json({ success: true, data: formattedMetrics });
    } catch (error) {
        console.error('❌ Error al obtener las métricas:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener métricas.' });
    }
});

// --- Endpoint GET /api/orders/verify/:orderId (Verificar pedido o teléfono) ---
router.get('/orders/verify/:orderId', async (req, res) => {
    const { orderId } = req.params;

    // Verificar si es un número de teléfono (simplificado)
    const isPhoneNumber = /^\d{10,}$/.test(orderId.replace(/\D/g, ''));
    if (isPhoneNumber) {
        // Si es teléfono, devolver directamente el ID y nombre N/A
        return res.status(200).json({ success: true, contactId: orderId, customerName: 'N/A (Teléfono directo)' });
    }

    // Si no es teléfono, intentar parsear como número de pedido (DHxxxx)
    const match = orderId.match(/(\d+)/); // Extraer números
    if (!match) {
        return res.status(400).json({ success: false, message: 'Formato de ID de pedido inválido. Se esperaba "DH" seguido de números o un teléfono.' });
    }
    const consecutiveOrderNumber = parseInt(match[1], 10);

    try {
        // Buscar pedido por número consecutivo
        const ordersQuery = db.collection('pedidos').where('consecutiveOrderNumber', '==', consecutiveOrderNumber).limit(1);
        const snapshot = await ordersQuery.get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }

        const pedidoData = snapshot.docs[0].data();
        const contactId = pedidoData.telefono; // Obtener teléfono del pedido

        if (!contactId) {
            return res.status(404).json({ success: false, message: 'El pedido encontrado no tiene un número de teléfono asociado.' });
        }

        // Buscar el nombre del contacto asociado al teléfono
        const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
        const customerName = contactDoc.exists ? contactDoc.data().name : 'Cliente (No en CRM)';

        // Devolver ID de contacto (teléfono) y nombre del cliente
        res.status(200).json({ success: true, contactId, customerName });

    } catch (error) {
        console.error(`Error al verificar el pedido ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al verificar el pedido.' });
    }
});

// --- Endpoint POST /api/difusion/bulk-send (Envío masivo para difusión) ---
router.post('/difusion/bulk-send', async (req, res) => {
    const { jobs, messageSequence, contingencyTemplate } = req.body;

    // Validación básica de entrada
    if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
        return res.status(400).json({ success: false, message: 'La lista de trabajos de envío es inválida o está vacía.' });
    }

    const results = { successful: [], failed: [], contingent: [] };

    // Procesar cada trabajo de envío
    for (const job of jobs) {
        // Validar datos del trabajo individual
        if (!job.contactId || !job.orderId || !job.photoUrl) {
            results.failed.push({ orderId: job.orderId, reason: 'Datos del trabajo incompletos (contactId, orderId, o photoUrl faltantes).' });
            continue; // Saltar al siguiente trabajo
        }

        try {
            const contactRef = db.collection('contacts_whatsapp').doc(job.contactId);
            const contactDoc = await contactRef.get();

            // Crear contacto si no existe
            if (!contactDoc.exists) {
                console.log(`[DIFUSION] El contacto ${job.contactId} no existe. Creando nuevo registro.`);
                await contactRef.set({
                    name: `Nuevo Contacto (${job.contactId.slice(-4)})`, // Nombre genérico
                    wa_id: job.contactId,
                    lastMessage: 'Inicio de conversación por difusión.',
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                    // unreadCount no se establece aquí, se maneja al recibir mensaje
                }, { merge: true }); // Usar merge por si acaso
                console.log(`[DIFUSION] Contacto ${job.contactId} creado.`);
            }

            // Verificar si la última respuesta del cliente fue hace menos de 24h
            const messagesSnapshot = await contactRef.collection('messages')
                .where('from', '==', job.contactId) // Mensajes DEL cliente
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

            // --- Lógica de envío basada en la ventana de 24h ---
            if (isWithin24Hours) {
                // --- DENTRO de 24h: Enviar secuencia + foto ---
                console.log(`[DIFUSION] Contacto ${job.contactId} dentro de 24h. Enviando secuencia y foto.`);
                let lastMessageText = ''; // Para actualizar el contacto

                // Enviar secuencia de mensajes (si existe)
                if (messageSequence && messageSequence.length > 0) {
                    for (const qr of messageSequence) {
                        const sentMessageData = await sendAdvancedWhatsAppMessage(job.contactId, { text: qr.message, fileUrl: qr.fileUrl, fileType: qr.fileType });
                        // Guardar mensaje enviado en Firestore
                        const messageToSave = {
                            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            id: sentMessageData.id, text: sentMessageData.textForDb, isAutoReply: true
                        };
                        await contactRef.collection('messages').add(messageToSave);
                        lastMessageText = sentMessageData.textForDb;
                        await new Promise(resolve => setTimeout(resolve, 500)); // Pequeño delay
                    }
                }

                // Enviar la foto del pedido
                const sentPhotoData = await sendAdvancedWhatsAppMessage(job.contactId, { text: null, fileUrl: job.photoUrl, fileType: 'image/jpeg' /* Asumir JPEG */ });
                // Guardar mensaje de foto en Firestore
                const photoMessageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: sentPhotoData.id, text: sentPhotoData.textForDb, fileUrl: sentPhotoData.fileUrlForDb,
                    fileType: sentPhotoData.fileTypeForDb, isAutoReply: true
                };
                Object.keys(photoMessageToSave).forEach(key => photoMessageToSave[key] == null && delete photoMessageToSave[key]); // Limpiar nulos
                await contactRef.collection('messages').add(photoMessageToSave);
                lastMessageText = sentPhotoData.textForDb;

                // Actualizar último mensaje del contacto
                await contactRef.update({
                    lastMessage: lastMessageText,
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                results.successful.push({ orderId: job.orderId });

            } else {
                // --- FUERA de 24h: Enviar plantilla de contingencia ---
                console.log(`[DIFUSION] Contacto ${job.contactId} fuera de 24h. Enviando plantilla de contingencia.`);

                // Validar que se proporcionó una plantilla
                if (!contingencyTemplate || !contingencyTemplate.name) {
                    results.failed.push({ orderId: job.orderId, reason: 'Fuera de ventana de 24h y no se proporcionó plantilla de contingencia válida.' });
                    continue; // Saltar al siguiente trabajo
                }

                // Parámetros para la plantilla (asumiendo que {{1}} es el ID del pedido y {{2}} la imagen)
                const bodyParams = [job.orderId]; // Parámetros a partir de {{2}}
                // Construir payload de la plantilla (con imagen como cabecera)
                const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(job.contactId, contingencyTemplate, job.photoUrl, bodyParams);

                // Enviar plantilla a WhatsApp
                const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
                });

                // Guardar mensaje de plantilla en Firestore
                const messageId = response.data.messages[0].id;
                const messageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: messageId, text: messageToSaveText, isAutoReply: true
                };
                await contactRef.collection('messages').add(messageToSave);
                // Actualizar último mensaje del contacto
                await contactRef.update({
                    lastMessage: messageToSaveText,
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // Guardar registro de envío contingente para ejecutarlo cuando el cliente responda
                await db.collection('contingentSends').add({
                    contactId: job.contactId,
                    status: 'pending', // Marcar como pendiente
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    payload: { // Guardar la información necesaria para el envío posterior
                        messageSequence: messageSequence || [], // Secuencia original
                        photoUrl: job.photoUrl, // Foto original
                        orderId: job.orderId // ID del pedido original
                    }
                });

                results.contingent.push({ orderId: job.orderId });
            }
        } catch (error) {
            console.error(`Error procesando el trabajo para el pedido ${job.orderId} (Contacto: ${job.contactId}):`, error.response ? error.response.data : error.message);
            results.failed.push({ orderId: job.orderId, reason: error.message || 'Error desconocido durante el envío.' });
        }
    } // Fin del bucle for

    // Devolver resultados consolidados
    res.status(200).json({ success: true, message: 'Proceso de envío masivo completado.', results });
});

// --- INICIO: Nuevo Endpoint para Conteo de Mensajes por Ad ID ---
router.get('/metrics/messages-by-ad', async (req, res) => {
    const { startDate, endDate } = req.query; // Espera fechas en formato YYYY-MM-DD

    // Validación básica de fechas
    if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: 'Se requieren las fechas de inicio (startDate) y fin (endDate) en formato YYYY-MM-DD.' });
    }

    try {
        // Convertir strings de fecha a Timestamps de Firestore
        // Asegurarse de que startDate sea el inicio del día y endDate el final del día
        const start = new Date(`${startDate}T00:00:00.000Z`); // UTC para Firestore
        const end = new Date(`${endDate}T23:59:59.999Z`); // UTC para Firestore

        if (isNaN(start) || isNaN(end)) {
            return res.status(400).json({ success: false, message: 'Formato de fecha inválido. Usar YYYY-MM-DD.' });
        }

        const startTimestamp = admin.firestore.Timestamp.fromDate(start);
        const endTimestamp = admin.firestore.Timestamp.fromDate(end);

        console.log(`[METRICS AD] Buscando mensajes entre ${startTimestamp.toDate()} y ${endTimestamp.toDate()}`);

        // Consulta usando collectionGroup para buscar en todas las subcolecciones 'messages'
        const messagesQuery = db.collectionGroup('messages')
            .where('timestamp', '>=', startTimestamp)
            .where('timestamp', '<=', endTimestamp)
            .where('from', '!=', PHONE_NUMBER_ID) // Solo mensajes entrantes
            .where('adId', '!=', null); // Solo mensajes que SÍ tengan un adId guardado

        const snapshot = await messagesQuery.get();

        if (snapshot.empty) {
            console.log('[METRICS AD] No se encontraron mensajes entrantes con Ad ID en el rango especificado.');
            return res.status(200).json({ success: true, counts: {} }); // Devolver objeto vacío
        }

        // Procesar los resultados para contar por Ad ID
        const countsByAdId = {};
        snapshot.forEach(doc => {
            const messageData = doc.data();
            const adId = messageData.adId; // El campo que guardamos en whatsappHandler.js

            if (adId) { // Doble verificación por si acaso
                countsByAdId[adId] = (countsByAdId[adId] || 0) + 1;
            }
        });

        console.log(`[METRICS AD] Conteo final:`, countsByAdId);
        res.status(200).json({ success: true, counts: countsByAdId });

    } catch (error) {
        console.error('❌ Error al obtener conteo de mensajes por Ad ID:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al procesar la solicitud de métricas por Ad ID.' });
    }
});
// --- FIN: Nuevo Endpoint ---

// --- INICIO DE NUEVAS RUTAS PARA DEPARTAMENTOS Y REGLAS DE ENRUTAMIENTO ---


// 2. REGLAS DE ENRUTAMIENTO DE ANUNCIOS (/api/ad-routing-rules)

// GET /api/ad-routing-rules: Listar todas las reglas
router.get('/ad-routing-rules', async (req, res) => {
    try {
        const snapshot = await db.collection('ad_routing_rules').get();
        const rules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json({ success: true, rules });
    } catch (error) {
        console.error('Error al obtener reglas de enrutamiento:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener reglas.' });
    }
});

// POST /api/ad-routing-rules: Crear nueva regla
router.post('/ad-routing-rules', async (req, res) => {
    const { ruleName, adIds: adIdsInput, targetDepartmentId, enableAi } = req.body;
    const adIds = parseAdIds(adIdsInput); // Usa la función helper existente para limpiar IDs

    if (!ruleName || adIds.length === 0 || !targetDepartmentId) {
        return res.status(400).json({ success: false, message: 'Nombre, Ad IDs y Departamento son obligatorios.' });
    }

    try {
        const newRule = {
            ruleName,
            adIds,
            targetDepartmentId,
            enableAi: !!enableAi,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection('ad_routing_rules').add(newRule);
        res.status(201).json({ success: true, id: docRef.id, ...newRule });
    } catch (error) {
        console.error('Error al crear regla de enrutamiento:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al crear regla.' });
    }
});

// PUT /api/ad-routing-rules/:id: Actualizar regla
router.put('/ad-routing-rules/:id', async (req, res) => {
    const { id } = req.params;
    const { ruleName, adIds: adIdsInput, targetDepartmentId, enableAi } = req.body;
    const adIds = parseAdIds(adIdsInput);

    try {
        await db.collection('ad_routing_rules').doc(id).update({
            ruleName,
            adIds,
            targetDepartmentId,
            enableAi: !!enableAi
        });
        res.status(200).json({ success: true, message: 'Regla actualizada.' });
    } catch (error) {
        console.error('Error al actualizar regla de enrutamiento:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar regla.' });
    }
});

// DELETE /api/ad-routing-rules/:id: Eliminar regla
router.delete('/ad-routing-rules/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('ad_routing_rules').doc(id).delete();
        res.status(200).json({ success: true, message: 'Regla eliminada.' });
    } catch (error) {
        console.error('Error al eliminar regla de enrutamiento:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar regla.' });
    }
});

// --- FIN DE NUEVAS RUTAS ---

// --- Endpoint POST /api/maintenance/migrate-orphans (Mantenimiento) ---
router.post('/maintenance/migrate-orphans', async (req, res) => {
    try {
        // 1. Buscar el ID del departamento "General"
        const generalDeptSnapshot = await db.collection('departments').where('name', '==', 'General').limit(1).get();
        if (generalDeptSnapshot.empty) {
            return res.status(404).json({ success: false, message: 'No se encontró el departamento "General".' });
        }
        const generalDeptId = generalDeptSnapshot.docs[0].id;

        // 2. Obtener TODOS los contactos
        const allContactsSnapshot = await db.collection('contacts_whatsapp').get();

        // 3. Filtrar en el backend para encontrar los huérfanos
        const orphanContacts = [];
        allContactsSnapshot.forEach(doc => {
            const data = doc.data();
            // Un chat es huérfano si la propiedad no existe O si es null/undefined/vacía
            if (!data.assignedDepartmentId) {
                orphanContacts.push(doc);
            }
        });
        
        if (orphanContacts.length === 0) {
            return res.status(200).json({ success: true, message: 'No se encontraron chats huérfanos para migrar.' });
        }

        // 4. Crear un batch para actualizar todos los huérfanos
        const batch = db.batch();
        orphanContacts.forEach(doc => {
            const contactRef = db.collection('contacts_whatsapp').doc(doc.id);
            batch.update(contactRef, { assignedDepartmentId: generalDeptId });
        });

        // 5. Ejecutar el batch
        await batch.commit();

        // 6. Devolver resumen
        const migratedCount = orphanContacts.length;
        res.status(200).json({
            success: true,
            message: `Se migraron ${migratedCount} chats al departamento General.`
        });

    } catch (error) {
        console.error('Error en la migración de chats huérfanos:', error);
        res.status(500).json({ success: false, message: 'Ocurrió un error en el servidor durante la migración.' });
    }
});

// --- Endpoint para Rastreo de J&T Express ---
router.get('/jt/track', async (req, res) => {
    const { waybill, phoneVerify } = req.query;

    if (!waybill) {
        return res.status(400).json({ success: false, message: 'Se requiere un número de guía.' });
    }

    try {
        console.log(`[J&T TRACK] Consultando guía: ${waybill}, Verificación: ${phoneVerify || 'No proporcionada'}`);
        
        const response = await axios.get('https://official.jtjms-mx.com/official/logisticsTracking/v3/getDetailByWaybillNo', {
            params: {
                waybillNo: waybill,
                langType: 'es', 
                phoneVerify: phoneVerify || ''
            },
            headers: {
                'Referer': 'https://www.jtexpress.mx/',
                'Origin': 'https://www.jtexpress.mx',
                'langtype': 'es',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });



        if (response.data && response.data.succ) {
            return res.status(200).json({ success: true, data: response.data.data });
        } else {
            // Manejar errores específicos de la API de J&T
            return res.status(200).json({ 
                success: false, 
                message: response.data.msg || 'No se encontró información para esta guía.',
                code: response.data.code 
            });
        }
    } catch (error) {
        console.error('Error consultando J&T Tracking:', error.message);
        res.status(500).json({ success: false, message: 'Error interno conectando con el servidor de J&T.' });
    }
});

// --- Endpoint GET /api/snapshots/daily (Leer snapshot guardado o generar en vivo) ---
router.get('/snapshots/daily', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'Se requiere una fecha (date).' });
        }

        // Intentar leer snapshot guardado
        const snapshotDoc = await db.collection('daily_snapshots').doc(date).get();

        if (snapshotDoc.exists) {
            return res.status(200).json({
                success: true,
                source: 'snapshot',
                snapshot: snapshotDoc.data()
            });
        }

        // Fallback: generar en vivo (sin guardar)
        const liveSnapshot = await generateDailySnapshot(date);
        return res.status(200).json({
            success: true,
            source: 'live',
            snapshot: liveSnapshot
        });
    } catch (error) {
        console.error('Error fetching daily snapshot:', error);
        res.status(500).json({ success: false, message: 'Error al obtener el snapshot diario.', error: error.message });
    }
});

// --- Endpoint POST /api/snapshots/daily (Guardar snapshot inmutable) ---
router.post('/snapshots/daily', async (req, res) => {
    try {
        let { date } = req.body;
        if (!date) {
            // Por defecto: ayer
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            date = yesterday.toISOString().split('T')[0];
        }

        // Verificar si ya existe (inmutabilidad)
        const existing = await db.collection('daily_snapshots').doc(date).get();
        if (existing.exists) {
            return res.status(409).json({
                success: false,
                message: `Ya existe un snapshot para ${date}. Los snapshots son inmutables.`,
                snapshot: existing.data()
            });
        }

        // Generar y guardar
        const snapshotData = await generateDailySnapshot(date);
        snapshotData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        snapshotData.source = 'manual';

        await db.collection('daily_snapshots').doc(date).set(snapshotData);

        res.status(201).json({ success: true, message: `Snapshot guardado para ${date}.`, snapshot: snapshotData });
    } catch (error) {
        console.error('Error saving daily snapshot:', error);
        res.status(500).json({ success: false, message: 'Error al guardar el snapshot.', error: error.message });
    }
});

// --- DATOS PARA ENVÍO ---
router.post('/datos-envio', async (req, res) => {
    try {
        const { numeroPedido, nombreCompleto, telefono, direccion, numInterior, colonia, estado, ciudad, codigoPostal, referencia } = req.body;

        if (!numeroPedido || !nombreCompleto || !telefono || !direccion || !colonia || !estado || !ciudad || !codigoPostal) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }

        if (!/^\d{10}$/.test(telefono)) {
            return res.status(400).json({ success: false, message: 'El teléfono debe tener 10 dígitos.' });
        }

        if (!/^\d{5}$/.test(codigoPostal)) {
            return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
        }

        await db.collection('datos_envio').add({
            numeroPedido,
            nombreCompleto,
            telefono,
            direccion,
            numInterior: numInterior || '',
            colonia,
            estado,
            ciudad,
            codigoPostal,
            referencia: referencia || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.status(201).json({ success: true, message: 'Datos de envío guardados correctamente.' });
    } catch (error) {
        console.error('Error guardando datos de envío:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.', error: error.message });
    }
});

// --- Background Removal (server-side AI) ---
let removeBackgroundFn = null;

router.post('/remove-background', async (req, res) => {
    try {
        const { image } = req.body; // base64 data URL
        if (!image) return res.status(400).json({ error: 'No image provided' });

        // Lazy-load the library (model stays in memory after first call)
        if (!removeBackgroundFn) {
            const bgModule = await import('@imgly/background-removal-node');
            removeBackgroundFn = bgModule.removeBackground || bgModule.default;
        }

        // Convert data URL to Blob for the library
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const blob = new Blob([buffer], { type: 'image/png' });

        const resultBlob = await removeBackgroundFn(blob);

        // Convert result blob to base64 data URL
        const arrayBuffer = await resultBlob.arrayBuffer();
        const resultBuffer = Buffer.from(arrayBuffer);
        const resultBase64 = `data:image/png;base64,${resultBuffer.toString('base64')}`;

        res.json({ image: resultBase64 });
    } catch (err) {
        console.error('Background removal error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Endpoint GET /api/meta/test-event (Diagnóstico de conexión con Meta CAPI) ---
router.get('/meta/test-event', async (req, res) => {
    const META_PIXEL_ID = process.env.META_PIXEL_ID;
    const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
    const FB_PAGE_ID = process.env.FB_PAGE_ID;

    const diagnostics = {
        META_PIXEL_ID_SET: !!META_PIXEL_ID,
        META_PIXEL_ID_PREVIEW: META_PIXEL_ID ? `${META_PIXEL_ID.substring(0, 4)}...` : null,
        META_CAPI_ACCESS_TOKEN_SET: !!META_CAPI_ACCESS_TOKEN,
        META_CAPI_ACCESS_TOKEN_LENGTH: META_CAPI_ACCESS_TOKEN ? META_CAPI_ACCESS_TOKEN.length : 0,
        FB_PAGE_ID_SET: !!FB_PAGE_ID,
        testEventResult: null
    };

    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        diagnostics.testEventResult = 'SKIP: Faltan credenciales. Configura META_PIXEL_ID y META_CAPI_ACCESS_TOKEN en las variables de entorno.';
        return res.json(diagnostics);
    }

    // Enviar evento de prueba con test_event_code para que no afecte métricas reales
    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events`;
    const userData = {
        ph: [require('crypto').createHash('sha256').update('5215500000000').digest('hex')]
    };
    if (FB_PAGE_ID) userData.page_id = FB_PAGE_ID;

    const testPayload = {
        data: [{
            event_name: 'Purchase',
            event_time: Math.floor(Date.now() / 1000),
            event_id: `test_diag_${Date.now()}`,
            action_source: 'website',
            user_data: userData,
            custom_data: {
                value: 0.01,
                currency: 'MXN'
            }
        }],
        test_event_code: 'TEST_DIAG_CRM'
    };

    try {
        const response = await axios.post(url, testPayload, {
            headers: { 'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        diagnostics.testEventResult = { status: 'SUCCESS', metaResponse: response.data };
    } catch (error) {
        diagnostics.testEventResult = {
            status: 'ERROR',
            message: error.message,
            metaResponse: error.response ? error.response.data : null,
            httpStatus: error.response ? error.response.status : null
        };
    }

    res.json(diagnostics);
});

// --- Endpoints para configuración Meta: conectar páginas a datasets ---

// Obtener info del dataset y sus páginas conectadas
router.get('/meta/config/dataset', async (req, res) => {
    const token = req.query.token || process.env.META_CAPI_ACCESS_TOKEN;
    const pixelId = req.query.dataset_id || process.env.META_PIXEL_ID;
    if (!token || !pixelId) return res.status(400).json({ error: 'Falta token o dataset_id' });

    try {
        // Info del dataset
        const dsRes = await axios.get(`https://graph.facebook.com/v19.0/${pixelId}`, {
            params: { fields: 'name,id,owner_business', access_token: token }
        });
        // Páginas conectadas
        let connectedPages = [];
        try {
            const pagesRes = await axios.get(`https://graph.facebook.com/v19.0/${pixelId}/stats`, {
                params: { fields: 'connected_page', access_token: token }
            });
            connectedPages = pagesRes.data.data || [];
        } catch (e) {
            // Intentar otro edge
        }
        res.json({ dataset: dsRes.data, connectedPages });
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: error.response?.data?.error || error.message
        });
    }
});

// Listar páginas de Facebook accesibles con el token
router.get('/meta/config/pages', async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'Se requiere un access_token' });

    try {
        const response = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
            params: { fields: 'id,name,access_token', limit: 100, access_token: token }
        });
        res.json({ pages: response.data.data || [] });
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: error.response?.data?.error || error.message
        });
    }
});

// Descubrir edges disponibles en el dataset y la página
router.get('/meta/config/discover', async (req, res) => {
    const token = req.query.token;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const datasetId = req.query.dataset_id || process.env.META_PIXEL_ID;
    const pageId = req.query.page_id;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    const discovery = {};

    // 1. Metadata del dataset (con system token que sabemos tiene acceso)
    if (systemToken && datasetId) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${datasetId}`, {
                params: { metadata: 1, access_token: systemToken }
            });
            discovery.dataset = { id: r.data.id, name: r.data.name, type: r.data.metadata?.type, connections: r.data.metadata?.connections };
        } catch (e) {
            discovery.dataset = { error: e.response?.data?.error || e.message };
        }
    }

    // 2. Metadata de la página (con user token)
    if (token && pageId) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
                params: { metadata: 1, access_token: token }
            });
            discovery.page = { id: r.data.id, name: r.data.name, type: r.data.metadata?.type, connections: r.data.metadata?.connections };
        } catch (e) {
            discovery.page = { error: e.response?.data?.error || e.message };
        }
    }

    // 3. WABA info y datasets vinculados
    if (wabaId) {
        const tk = token || systemToken;
        if (tk) {
            try {
                const r = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}`, {
                    params: { metadata: 1, access_token: tk }
                });
                discovery.waba = { id: r.data.id, name: r.data.name, type: r.data.metadata?.type, connections: r.data.metadata?.connections };
            } catch (e) {
                discovery.waba = { error: e.response?.data?.error || e.message };
            }
        }
    }

    // 4. Businesses del usuario
    if (token) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/me/businesses`, {
                params: { fields: 'id,name', access_token: token }
            });
            discovery.businesses = r.data.data || [];
        } catch (e) {
            discovery.businesses = { error: e.response?.data?.error || e.message };
        }
    }

    res.json(discovery);
});

// Conectar una página a un dataset
router.post('/meta/config/connect-page', async (req, res) => {
    const { token, page_token, dataset_id, page_id } = req.body;
    if (!dataset_id || !page_id) {
        return res.status(400).json({ error: 'Se requieren dataset_id y page_id' });
    }

    const results = [];
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const allTokens = [
        ['page_token', page_token],
        ['user_token', token],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    // Descubrir business_id primero
    let businessId = null;
    if (token) {
        try {
            const r = await axios.get('https://graph.facebook.com/v19.0/me/businesses', {
                params: { fields: 'id,name', access_token: token }
            });
            if (r.data.data?.length > 0) businessId = r.data.data[0].id;
        } catch (e) { /* ignore */ }
    }

    // Método 1: POST /{page-id}/page_whatsapp_number_datasets (plural)
    for (const [label, tk] of allTokens) {
        try {
            const body = { dataset_id, access_token: tk };
            if (phoneNumberId) body.whatsapp_business_phone_number_id = phoneNumberId;
            const r = await axios.post(`https://graph.facebook.com/v19.0/${page_id}/page_whatsapp_number_datasets`, body);
            results.push({ method: `page_whatsapp_number_datasets (${label})`, success: true, data: r.data });
        } catch (e) {
            results.push({ method: `page_whatsapp_number_datasets (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    // Método 2: POST /{dataset-id}/connected_pages
    for (const [label, tk] of allTokens) {
        try {
            const r = await axios.post(`https://graph.facebook.com/v19.0/${dataset_id}/connected_pages`, {
                page_id, access_token: tk
            });
            results.push({ method: `connected_pages (${label})`, success: true, data: r.data });
        } catch (e) {
            results.push({ method: `connected_pages (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    // Método 3: A través del Business Manager - POST /{business-id}/adspixels/{pixel-id}/pages
    if (businessId) {
        for (const [label, tk] of allTokens) {
            try {
                const r = await axios.post(`https://graph.facebook.com/v19.0/${businessId}/adspixels`, {
                    adspixel_id: dataset_id, page_id, access_token: tk
                });
                results.push({ method: `business/adspixels (${label})`, success: true, data: r.data });
            } catch (e) {
                results.push({ method: `business/adspixels (${label})`, success: false, error: e.response?.data?.error || e.message });
            }
        }
    }

    // Método 4: POST /{dataset-id}/shared_pages
    for (const [label, tk] of allTokens) {
        try {
            const r = await axios.post(`https://graph.facebook.com/v19.0/${dataset_id}/shared_pages`, {
                page_id, access_token: tk
            });
            results.push({ method: `shared_pages (${label})`, success: true, data: r.data });
        } catch (e) {
            results.push({ method: `shared_pages (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    // Método 5: POST /{waba-id}/dataset (singular - edge descubierto en metadata)
    if (wabaId) {
        for (const [label, tk] of allTokens) {
            try {
                const r = await axios.post(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                    dataset_id, page_id, access_token: tk
                });
                results.push({ method: `waba/dataset (${label})`, success: true, data: r.data });
            } catch (e) {
                results.push({ method: `waba/dataset (${label})`, success: false, error: e.response?.data?.error || e.message });
            }
        }
    }

    // Método 6: POST /{waba-id}/dataset solo con dataset_id (sin page_id)
    if (wabaId) {
        for (const [label, tk] of allTokens) {
            try {
                const r = await axios.post(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                    dataset_id, access_token: tk
                });
                results.push({ method: `waba/dataset no-page (${label})`, success: true, data: r.data });
            } catch (e) {
                results.push({ method: `waba/dataset no-page (${label})`, success: false, error: e.response?.data?.error || e.message });
            }
        }
    }

    const anySuccess = results.some(r => r.success);
    res.json({ success: anySuccess, results });
});

// Desvincular y revincular WABA a un dataset diferente
router.post('/meta/config/switch-waba-dataset', async (req, res) => {
    const { token, old_dataset_id, new_dataset_id } = req.body;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    if (!wabaId) return res.status(400).json({ error: 'WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' });
    if (!new_dataset_id) return res.status(400).json({ error: 'Se requiere new_dataset_id' });

    const results = [];
    const tokensToTry = [
        ['user_token', token],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    // Paso 1: Intentar DELETE del dataset viejo
    if (old_dataset_id) {
        for (const [label, tk] of tokensToTry) {
            try {
                const r = await axios.delete(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                    data: { dataset_id: old_dataset_id, access_token: tk }
                });
                results.push({ step: `DELETE old (${label})`, success: true, data: r.data });
                break; // Si funciona, no intentar con otro token
            } catch (e) {
                results.push({ step: `DELETE old (${label})`, success: false, error: e.response?.data?.error || e.message });
            }
        }
    }

    // Paso 2: POST del dataset nuevo
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.post(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                dataset_id: new_dataset_id, access_token: tk
            });
            results.push({ step: `POST new (${label})`, success: true, data: r.data });
            break;
        } catch (e) {
            results.push({ step: `POST new (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    // Paso 3: Verificar cuál dataset está vinculado ahora
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                params: { access_token: tk }
            });
            results.push({ step: `GET verify (${label})`, success: true, data: r.data });
            break;
        } catch (e) {
            results.push({ step: `GET verify (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    res.json({ results });
});

// GET — Ver qué datasets están vinculados a la WABA
router.get('/meta/config/waba-datasets', async (req, res) => {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const userToken = req.query.token;

    if (!wabaId) return res.status(400).json({ error: 'WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' });

    const tokensToTry = [
        ['user_token', userToken],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                params: { access_token: tk }
            });
            return res.json({ waba_id: wabaId, token_used: label, datasets: r.data });
        } catch (e) {
            console.log(`[WABA datasets] ${label} falló:`, e.response?.data?.error || e.message);
        }
    }
    res.status(500).json({ error: 'No se pudo consultar datasets vinculados con ningún token disponible' });
});

// DELETE — Desvincular un dataset de la WABA (sin vincular otro)
router.delete('/meta/config/waba-dataset', async (req, res) => {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const { dataset_id, token } = req.body;

    if (!wabaId) return res.status(400).json({ error: 'WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' });
    if (!dataset_id) return res.status(400).json({ error: 'Se requiere dataset_id a desvincular' });

    const tokensToTry = [
        ['user_token', token],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    const results = [];

    // Paso 1: DELETE del dataset
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.delete(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                data: { dataset_id, access_token: tk }
            });
            results.push({ step: `DELETE (${label})`, success: true, data: r.data });
            break;
        } catch (e) {
            results.push({ step: `DELETE (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    // Paso 2: Verificar estado actual
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                params: { access_token: tk }
            });
            results.push({ step: `GET verify (${label})`, success: true, datasets_remaining: r.data });
            break;
        } catch (e) {
            results.push({ step: `GET verify (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    const delinkSuccess = results.some(r => r.step.startsWith('DELETE') && r.success);
    res.status(delinkSuccess ? 200 : 500).json({ waba_id: wabaId, dataset_delinked: dataset_id, results });
});

module.exports = router;
