// Importa las librerías necesarias
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const { db, admin } = require('./config'); // Importa tu configuración de Firebase Admin

// --- Variables de Estado ---
let sock = null; // Instancia del socket de Baileys
let qrCode = null; // Código QR actual (si existe)
let connectionStatus = 'disconnected'; // disconnected | connecting | connected | requires_scan
const SESSION_FILE_PATH = path.join(__dirname, 'whatsapp-session'); // Carpeta para guardar la sesión

/**
 * Inicializa y conecta el cliente de WhatsApp Web.
 * Gestiona la autenticación y establece los listeners de eventos.
 */
async function initializeWhatsAppWebClient() {
    // Si ya hay un socket o está conectando, no hacer nada
    if (sock || connectionStatus === 'connecting') {
        console.log('[WebWhatsApp] Ya existe una instancia o está conectando.');
        return;
    }

    console.log('[WebWhatsApp] Inicializando cliente...');
    connectionStatus = 'connecting';
    qrCode = null; // Reinicia el QR

    try {
        // Usa MultiFileAuthState para guardar/cargar la sesión en archivos
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_FILE_PATH);

        // Crea la instancia del socket
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // No imprimir QR en terminal, lo manejaremos nosotros
            browser: Browsers.macOS('Chrome'), // Simula ser Chrome en macOS
            logger: require('pino')({ level: 'silent' }) // Desactiva logs detallados de Baileys
        });

        // --- Listeners de Eventos Principales ---

        // Listener para actualizaciones de conexión (QR, conectado, desconectado, etc.)
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('[WebWhatsApp] Código QR generado.');
                qrCode = qr;
                connectionStatus = 'requires_scan';
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom) &&
                    lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`[WebWhatsApp] Conexión cerrada. Razón: ${lastDisconnect?.error?.message}. Reintentando: ${shouldReconnect}`);
                qrCode = null; // Ya no hay QR
                connectionStatus = 'disconnected';
                // Si no fue un cierre de sesión manual, intenta reconectar
                if (shouldReconnect) {
                    // Espera un poco antes de reintentar para no saturar
                    setTimeout(initializeWhatsAppWebClient, 5000); // Reintenta en 5 segundos
                } else {
                    // Si fue loggedOut, limpia la sesión
                    console.log('[WebWhatsApp] Cierre de sesión detectado. Limpiando sesión guardada.');
                    if (fs.existsSync(SESSION_FILE_PATH)) {
                        fs.rmSync(SESSION_FILE_PATH, { recursive: true, force: true });
                    }
                    sock = null; // Resetea la instancia del socket
                }
            } else if (connection === 'open') {
                console.log('[WebWhatsApp] Conexión establecida exitosamente.');
                qrCode = null; // Ya no se necesita el QR
                connectionStatus = 'connected';
            }
        });

        // Listener para guardar las credenciales (sesión) cuando cambian
        sock.ev.on('creds.update', saveCreds);

        // Listener para mensajes entrantes
        sock.ev.on('messages.upsert', async (m) => {
            // console.log('[WebWhatsApp] Mensaje recibido:', JSON.stringify(m, undefined, 2));
            if (m.messages && m.type === 'notify') {
                // Procesa solo el primer mensaje (generalmente viene uno)
                const msg = m.messages[0];
                // Ignora notificaciones de estado (ej: 'mensaje eliminado') y mensajes propios
                if (!msg.message || msg.key.fromMe) {
                    return;
                }
                await processIncomingMessage(msg);
            }
        });

    } catch (error) {
        console.error('[WebWhatsApp] Error al inicializar:', error);
        connectionStatus = 'disconnected';
        sock = null;
    }
}

/**
 * Procesa un mensaje entrante de Baileys y lo guarda en Firestore.
 * (Esta función necesita adaptarse cuidadosamente a la estructura de Baileys)
 * @param {import('@whiskeysockets/baileys').WAMessage} msg El objeto del mensaje de Baileys.
 */
async function processIncomingMessage(msg) {
    try {
        const from = msg.key.remoteJid; // ID del remitente (ej: 'xxxxxxxxxx@s.whatsapp.net')
        // Limpia el ID para usarlo como ID de documento en Firestore (quita el @s.whatsapp.net)
        const contactId = from.split('@')[0];
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);

        console.log(`[WebWhatsApp] Procesando mensaje de: ${contactId}`);

        // Extrae información básica
        const messageTimestamp = msg.messageTimestamp ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : msg.messageTimestamp.low) : Math.floor(Date.now() / 1000);
        const wamId = msg.key.id; // ID único del mensaje de WhatsApp

        // --- Construye messageData (similar a whatsappHandler.js pero adaptado) ---
        const messageData = {
            timestamp: admin.firestore.Timestamp.fromMillis(messageTimestamp * 1000),
            from: contactId,
            status: 'received',
            id: wamId,
            type: '', // Se determinará a continuación
            // adId: null, // Baileys no provee información de Ad Referral directamente
        };

        const messageContent = msg.message;

        // Determina el tipo y extrae el contenido
        if (messageContent?.conversation) {
            messageData.type = 'text';
            messageData.text = messageContent.conversation;
        } else if (messageContent?.extendedTextMessage) {
            messageData.type = 'text';
            messageData.text = messageContent.extendedTextMessage.text;
            // Manejar contexto (respuestas) si es necesario
            // const context = messageContent.extendedTextMessage.contextInfo;
            // if (context?.quotedMessage) { ... }
        } else if (messageContent?.imageMessage) {
            messageData.type = 'image';
            messageData.text = messageContent.imageMessage.caption || '📷 Imagen';
            // TODO: Descargar y subir imagen a Firebase Storage
            // try {
            //     const stream = await downloadMediaMessage(msg, 'buffer');
            //     // Subir 'stream' a Firebase Storage y obtener publicUrl
            //     // messageData.fileUrl = publicUrl;
            //     // messageData.fileType = messageContent.imageMessage.mimetype;
            // } catch (e) { console.error('Error descargando imagen:', e); }
        } else if (messageContent?.videoMessage) {
            messageData.type = 'video';
            messageData.text = messageContent.videoMessage.caption || '🎥 Video';
            // TODO: Descargar y subir video
        } else if (messageContent?.audioMessage) {
            messageData.type = 'audio';
            messageData.text = messageContent.audioMessage.ptt ? '🎤 Mensaje de voz' : '🎵 Audio';
            // TODO: Descargar y subir audio
        } else if (messageContent?.documentMessage) {
            messageData.type = 'document';
            messageData.text = messageContent.documentMessage.caption || messageContent.documentMessage.fileName || '📄 Documento';
            messageData.document = { filename: messageContent.documentMessage.fileName };
            // TODO: Descargar y subir documento
        } else if (messageContent?.stickerMessage) {
            messageData.type = 'sticker';
            messageData.text = 'Sticker';
            // TODO: Descargar y subir sticker (webp)
        } else if (messageContent?.locationMessage) {
            messageData.type = 'location';
            messageData.location = { // Adaptar la estructura si es necesario
                latitude: messageContent.locationMessage.degreesLatitude,
                longitude: messageContent.locationMessage.degreesLongitude,
                name: messageContent.locationMessage.name,
                address: messageContent.locationMessage.address,
            };
            messageData.text = `📍 Ubicación: ${messageContent.locationMessage.name || 'Ver mapa'}`;
        }
        // Añadir manejo para otros tipos si es necesario (buttonsResponseMessage, listResponseMessage, etc.)
        else {
            console.warn(`[WebWhatsApp] Tipo de mensaje no manejado: ${Object.keys(messageContent || {})[0]}`);
            messageData.type = 'unknown';
            messageData.text = 'Mensaje no soportado';
        }

        // Guarda el mensaje en Firestore
        await contactRef.collection('messages').add(messageData);

        // Actualiza el documento del contacto
        const contactDoc = await contactRef.get();
        const contactUpdateData = {
            name: msg.pushName || contactDoc.data()?.name || contactId, // Usar pushName si está disponible
            name_lowercase: (msg.pushName || contactDoc.data()?.name || contactId).toLowerCase(),
            wa_id: contactId, // Guardar el ID limpio
            lastMessage: messageData.text,
            lastMessageTimestamp: messageData.timestamp,
            unreadCount: admin.firestore.FieldValue.increment(1)
        };
        await contactRef.set(contactUpdateData, { merge: true });

        console.log(`[WebWhatsApp] Mensaje de ${contactId} procesado y guardado.`);

        // Aquí podrías añadir lógica de auto-respuesta si lo deseas, similar a whatsappHandler.js

    } catch (error) {
        console.error(`[WebWhatsApp] Error procesando mensaje de ${msg.key.remoteJid}:`, error);
    }
}

/**
 * Envía un mensaje de texto usando la conexión activa de Baileys.
 * @param {string} recipientId ID del destinatario (ej: 'xxxxxxxxxx@s.whatsapp.net' o solo 'xxxxxxxxxx')
 * @param {string} text Contenido del mensaje.
 * @returns {Promise<object>} El resultado del envío de Baileys.
 */
async function sendWebWhatsAppMessage(recipientId, text) {
    if (!sock || connectionStatus !== 'connected') {
        throw new Error('El cliente de WhatsApp Web no está conectado.');
    }
    if (!recipientId || !text) {
        throw new Error('Se requiere destinatario y texto para enviar mensaje.');
    }

    // Asegúrate de que el ID tenga el formato correcto para Baileys
    const jid = recipientId.includes('@s.whatsapp.net') ? recipientId : `${recipientId}@s.whatsapp.net`;

    try {
        console.log(`[WebWhatsApp] Enviando mensaje a ${jid}`);
        const result = await sock.sendMessage(jid, { text: text });
        console.log(`[WebWhatsApp] Mensaje enviado con ID: ${result?.key?.id}`);

        // --- Guardar mensaje enviado en Firestore ---
        const contactId = jid.split('@')[0];
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        await contactRef.collection('messages').add({
            from: 'me', // O podrías usar el ID propio si lo obtienes de 'sock.user.id'
            status: 'sent', // Asumir 'sent', Baileys no da 'delivered'/'read' fácilmente para mensajes enviados
            timestamp: timestamp,
            id: result?.key?.id, // Guardar el wamId si está disponible
            text: text
        });
        // Actualizar último mensaje del contacto y resetear no leídos
        await contactRef.update({
            lastMessage: text,
            lastMessageTimestamp: timestamp,
            unreadCount: 0
        });
        // --- Fin Guardar mensaje ---

        return result;
    } catch (error) {
        console.error(`[WebWhatsApp] Error al enviar mensaje a ${jid}:`, error);
        throw error;
    }
}

/**
 * Cierra la conexión de WhatsApp Web y elimina la sesión guardada.
 */
async function disconnectWhatsAppWeb() {
    console.log('[WebWhatsApp] Solicitando desconexión...');
    if (sock) {
        try {
            await sock.logout(); // Cierra sesión en WhatsApp
            console.log('[WebWhatsApp] Logout completado.');
        } catch (error) {
            console.error('[WebWhatsApp] Error durante logout:', error);
        } finally {
            sock = null; // Limpia la instancia
        }
    }
    // Elimina la carpeta de sesión independientemente de si el logout tuvo éxito
    if (fs.existsSync(SESSION_FILE_PATH)) {
        try {
            fs.rmSync(SESSION_FILE_PATH, { recursive: true, force: true });
            console.log('[WebWhatsApp] Archivos de sesión eliminados.');
        } catch (error) {
            console.error('[WebWhatsApp] Error eliminando archivos de sesión:', error);
        }
    }
    qrCode = null;
    connectionStatus = 'disconnected';
    console.log('[WebWhatsApp] Cliente desconectado y sesión limpiada.');
}

/**
 * Devuelve el estado actual de la conexión.
 * @returns {string} El estado ('disconnected', 'connecting', 'connected', 'requires_scan').
 */
function getClientStatus() {
    return connectionStatus;
}

/**
 * Devuelve el código QR actual en formato base64 (si existe).
 * @returns {string|null} El código QR o null.
 */
function getQrCode() {
    return qrCode;
}

// Exporta las funciones necesarias para las rutas
module.exports = {
    initializeWhatsAppWebClient,
    getClientStatus,
    getQrCode,
    sendWebWhatsAppMessage,
    disconnectWhatsAppWeb
};
