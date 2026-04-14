const express = require('express');
const axios = require('axios');
const { db, admin } = require('./config');

const router = express.Router();

const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const GRAPH_VERSION = 'v19.0';

/**
 * Obtiene perfil del usuario (Messenger o Instagram)
 */
async function fetchUserProfile(userId, channel) {
    const token = channel === 'instagram' ? (IG_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN) : FB_PAGE_ACCESS_TOKEN;
    const fields = channel === 'instagram' ? 'name,username,profile_pic' : 'name,profile_pic';
    try {
        const res = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${userId}`, {
            params: { fields, access_token: token }
        });
        return {
            name: res.data.name || res.data.username || null,
            username: res.data.username || null,
            profileImageUrl: res.data.profile_pic || null
        };
    } catch (error) {
        console.error(`[IMPORT] Error al obtener perfil ${userId}:`, error.response?.data?.error?.message || error.message);
        return { name: null, username: null, profileImageUrl: null };
    }
}

/**
 * Importa una conversación completa (Messenger o Instagram)
 */
async function importConversation(conversationId, channel, stats) {
    const token = channel === 'instagram' ? (IG_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN) : FB_PAGE_ACCESS_TOKEN;
    const prefix = channel === 'instagram' ? 'ig' : 'fb';
    const pageId = FB_PAGE_ID;

    try {
        // 1. Obtener info de la conversación para saber el ID del otro participante
        const convRes = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${conversationId}`, {
            params: {
                fields: 'participants,updated_time',
                access_token: token
            }
        });

        const participants = convRes.data.participants?.data || [];
        // El participante que NO es la Page
        const userParticipant = participants.find(p => p.id !== pageId);
        if (!userParticipant) {
            console.log(`[IMPORT] No se encontró usuario en conversación ${conversationId}, saltando`);
            return;
        }

        const userId = userParticipant.id;
        const contactId = `${prefix}_${userId}`;
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();

        // 2. Obtener/actualizar perfil
        let profile = { name: userParticipant.name || null, profileImageUrl: null };
        if (!profile.name) {
            profile = await fetchUserProfile(userId, channel);
        }
        const finalName = profile.name || `${channel === 'instagram' ? 'IG' : 'FB'} User (${userId.slice(-4)})`;

        // 3. Crear o actualizar contacto (sin sobrescribir lastMessage si ya existe)
        const contactData = {
            name: finalName,
            name_lowercase: finalName.toLowerCase(),
            channel,
            [channel === 'instagram' ? 'igsid' : 'psid']: userId,
            profileImageUrl: profile.profileImageUrl || null,
        };
        if (profile.username) contactData.igUsername = profile.username;

        if (!contactDoc.exists) {
            contactData.unreadCount = 0;
            contactData.lastMessage = '';
            contactData.lastMessageTimestamp = admin.firestore.Timestamp.fromDate(new Date(convRes.data.updated_time));
            // Asignar al departamento General si existe
            const deptSnap = await db.collection('departments').where('name', '==', 'General').limit(1).get();
            if (!deptSnap.empty) contactData.assignedDepartmentId = deptSnap.docs[0].id;
            await contactRef.set(contactData);
            stats.contactsCreated++;
            console.log(`[IMPORT] Contacto creado: ${contactId} (${finalName})`);
        } else {
            // Solo actualizar nombre/perfil si el actual es genérico
            const current = contactDoc.data();
            const updates = {};
            if (current.name?.startsWith('Facebook User') || current.name?.startsWith('IG User') || !current.name) {
                updates.name = finalName;
                updates.name_lowercase = finalName.toLowerCase();
            }
            if (!current.profileImageUrl && profile.profileImageUrl) {
                updates.profileImageUrl = profile.profileImageUrl;
            }
            if (!current.channel) updates.channel = channel;
            if (!current[channel === 'instagram' ? 'igsid' : 'psid']) {
                updates[channel === 'instagram' ? 'igsid' : 'psid'] = userId;
            }
            if (Object.keys(updates).length > 0) {
                await contactRef.update(updates);
                stats.contactsUpdated++;
                console.log(`[IMPORT] Contacto actualizado: ${contactId} (${finalName})`);
            }
        }

        // 4. Importar mensajes
        let messagesUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${conversationId}/messages`;
        let messagesParams = {
            fields: 'id,created_time,from,to,message,attachments',
            limit: 100,
            access_token: token
        };

        let importedInConv = 0;
        let pageCount = 0;
        const MAX_PAGES = 20; // Limitar a 20 páginas (2000 mensajes) por conversación

        while (messagesUrl && pageCount < MAX_PAGES) {
            const msgsRes = await axios.get(messagesUrl, { params: messagesParams });
            const messages = msgsRes.data.data || [];

            for (const msg of messages) {
                // Verificar duplicado
                const existingSnap = await contactRef.collection('messages').where('id', '==', msg.id).limit(1).get();
                if (!existingSnap.empty) continue;

                const fromId = msg.from?.id;
                const isFromPage = fromId === pageId;

                const messageData = {
                    id: msg.id,
                    timestamp: admin.firestore.Timestamp.fromDate(new Date(msg.created_time)),
                    from: isFromPage ? 'page' : contactId,
                    status: isFromPage ? 'sent' : 'received',
                    text: msg.message || '',
                    channel,
                };

                // Procesar adjuntos
                if (msg.attachments?.data?.length > 0) {
                    const att = msg.attachments.data[0];
                    if (att.image_data?.url) {
                        messageData.fileUrl = att.image_data.url;
                        messageData.fileType = 'image/jpeg';
                        if (!messageData.text) messageData.text = '📷 Imagen';
                    } else if (att.video_data?.url) {
                        messageData.fileUrl = att.video_data.url;
                        messageData.fileType = 'video/mp4';
                        if (!messageData.text) messageData.text = '🎥 Video';
                    } else if (att.file_url) {
                        messageData.fileUrl = att.file_url;
                        messageData.fileType = att.mime_type || 'application/octet-stream';
                        if (!messageData.text) messageData.text = '📄 Documento';
                    }
                }

                if (!messageData.text) messageData.text = '[Mensaje sin contenido]';

                await contactRef.collection('messages').add(messageData);
                importedInConv++;
                stats.messagesImported++;
            }

            // Paginación
            messagesUrl = msgsRes.data.paging?.next || null;
            messagesParams = {}; // La URL "next" ya trae los params
            pageCount++;

            // Rate limiting: pausa entre páginas
            if (messagesUrl) await new Promise(r => setTimeout(r, 500));
        }

        // 5. Actualizar lastMessage del contacto con el mensaje más reciente
        if (importedInConv > 0) {
            const lastMsgSnap = await contactRef.collection('messages')
                .orderBy('timestamp', 'desc').limit(1).get();
            if (!lastMsgSnap.empty) {
                const lastMsg = lastMsgSnap.docs[0].data();
                await contactRef.update({
                    lastMessage: (lastMsg.text || '').substring(0, 100),
                    lastMessageTimestamp: lastMsg.timestamp
                });
            }
        }

        console.log(`[IMPORT] Conversación ${contactId}: ${importedInConv} mensajes importados`);
    } catch (error) {
        console.error(`[IMPORT] Error en conversación ${conversationId}:`, error.response?.data?.error?.message || error.message);
        stats.errors++;
    }
}

/**
 * Lista todas las conversaciones de una plataforma
 */
async function listConversations(platform) {
    const token = platform === 'instagram' ? (IG_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN) : FB_PAGE_ACCESS_TOKEN;
    const conversations = [];

    let url = `https://graph.facebook.com/${GRAPH_VERSION}/${FB_PAGE_ID}/conversations`;
    let params = {
        platform,
        fields: 'id,updated_time',
        limit: 50,
        access_token: token
    };

    let pageCount = 0;
    const MAX_PAGES = 10;

    while (url && pageCount < MAX_PAGES) {
        const res = await axios.get(url, { params });
        conversations.push(...(res.data.data || []));
        url = res.data.paging?.next || null;
        params = {};
        pageCount++;
        if (url) await new Promise(r => setTimeout(r, 300));
    }

    return conversations;
}

// POST /api/messenger-import/all — Importar Messenger + Instagram
router.post('/all', async (req, res) => {
    const { platform = 'both' } = req.body || {};
    const stats = { contactsCreated: 0, contactsUpdated: 0, messagesImported: 0, errors: 0 };

    // Responder inmediatamente, el proceso corre en background
    res.json({ success: true, message: 'Importación iniciada en segundo plano. Revisa los logs.' });

    try {
        const platforms = platform === 'both' ? ['messenger', 'instagram'] : [platform];

        for (const p of platforms) {
            console.log(`[IMPORT] Listando conversaciones de ${p}...`);
            const conversations = await listConversations(p);
            console.log(`[IMPORT] ${conversations.length} conversaciones encontradas en ${p}`);

            for (const conv of conversations) {
                await importConversation(conv.id, p, stats);
                // Pausa entre conversaciones
                await new Promise(r => setTimeout(r, 400));
            }
        }

        console.log(`[IMPORT] Finalizado. Stats:`, stats);
    } catch (error) {
        console.error('[IMPORT] Error crítico:', error.message);
    }
});

// POST /api/messenger-import/update-names — Solo actualizar nombres genéricos
router.post('/update-names', async (req, res) => {
    res.json({ success: true, message: 'Actualizando nombres en segundo plano. Revisa los logs.' });

    try {
        // Buscar contactos con nombre genérico
        const snap = await db.collection('contacts_whatsapp')
            .where('channel', 'in', ['messenger', 'instagram'])
            .get();

        let updated = 0;
        for (const doc of snap.docs) {
            const data = doc.data();
            if (!data.name?.startsWith('Facebook User') && !data.name?.startsWith('IG User')) continue;

            const userId = data.psid || data.igsid;
            if (!userId) continue;

            const profile = await fetchUserProfile(userId, data.channel);
            if (profile.name) {
                await doc.ref.update({
                    name: profile.name,
                    name_lowercase: profile.name.toLowerCase(),
                    ...(profile.profileImageUrl && !data.profileImageUrl ? { profileImageUrl: profile.profileImageUrl } : {}),
                    ...(profile.username ? { igUsername: profile.username } : {})
                });
                updated++;
                console.log(`[IMPORT NAMES] ${doc.id}: "${data.name}" → "${profile.name}"`);
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`[IMPORT NAMES] Actualizados: ${updated} contactos`);
    } catch (error) {
        console.error('[IMPORT NAMES] Error:', error.message);
    }
});

// POST /api/messenger-import/assign-department — Asignar departamento General a contactos FB/IG sin dept
router.post('/assign-department', async (req, res) => {
    res.json({ success: true, message: 'Asignando departamento General en segundo plano.' });

    try {
        // 1. Buscar el departamento "General"
        const deptSnap = await db.collection('departments').where('name', '==', 'General').limit(1).get();
        if (deptSnap.empty) {
            console.error('[IMPORT DEPT] No se encontró el departamento "General"');
            return;
        }
        const generalDeptId = deptSnap.docs[0].id;
        console.log(`[IMPORT DEPT] Departamento General: ${generalDeptId}`);

        // 2. Buscar contactos FB/IG sin departamento
        const snap = await db.collection('contacts_whatsapp')
            .where('channel', 'in', ['messenger', 'instagram'])
            .get();

        let updated = 0;
        const batchSize = 400;
        let batch = db.batch();
        let batchCount = 0;

        for (const doc of snap.docs) {
            const data = doc.data();
            if (data.assignedDepartmentId) continue; // Ya tiene departamento

            batch.update(doc.ref, { assignedDepartmentId: generalDeptId });
            batchCount++;
            updated++;

            if (batchCount >= batchSize) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
                console.log(`[IMPORT DEPT] ${updated} contactos asignados...`);
            }
        }

        if (batchCount > 0) await batch.commit();
        console.log(`[IMPORT DEPT] Total asignados: ${updated} contactos al departamento General`);
    } catch (error) {
        console.error('[IMPORT DEPT] Error:', error.message);
    }
});

module.exports = router;
