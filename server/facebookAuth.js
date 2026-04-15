const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { db, admin } = require('./config');

const router = express.Router();

const GRAPH_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const FB_OAUTH_REDIRECT_URI =
    process.env.FB_OAUTH_REDIRECT_URI ||
    `${process.env.API_URL || 'https://app.dekoormx.com'}/auth/facebook/callback`;

const REQUESTED_SCOPES = [
    'public_profile',
    'email',
    'pages_show_list',
    'pages_manage_metadata',
    'pages_messaging',
    'pages_read_engagement',
    'business_management',
];

// Estado efimero: uid -> state (5 min). Evita CSRF en el callback OAuth.
const pendingStates = new Map();
function putState(uid) {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, { uid, ts: Date.now() });
    // limpieza simple
    for (const [k, v] of pendingStates) {
        if (Date.now() - v.ts > 5 * 60 * 1000) pendingStates.delete(k);
    }
    return state;
}
function consumeState(state) {
    const entry = pendingStates.get(state);
    if (!entry) return null;
    pendingStates.delete(state);
    if (Date.now() - entry.ts > 5 * 60 * 1000) return null;
    return entry;
}

function ensureConfig(res) {
    if (!FB_APP_ID || !FB_APP_SECRET) {
        res.status(500).send('Facebook App no configurada en el servidor (FB_APP_ID / FB_APP_SECRET).');
        return false;
    }
    return true;
}

async function verifyFirebaseToken(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    try {
        return await admin.auth().verifyIdToken(token);
    } catch {
        return null;
    }
}

// 1) Inicia el flujo OAuth. El frontend redirige aqui con ?uid=<firebase-uid>
router.get('/start', (req, res) => {
    if (!ensureConfig(res)) return;
    const uid = (req.query.uid || '').toString();
    if (!uid) return res.status(400).send('Falta uid');

    const state = putState(uid);
    const params = new URLSearchParams({
        client_id: FB_APP_ID,
        redirect_uri: FB_OAUTH_REDIRECT_URI,
        state,
        response_type: 'code',
        scope: REQUESTED_SCOPES.join(','),
    });
    res.redirect(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`);
});

// 2) Callback al que Meta redirige tras aceptar permisos
router.get('/callback', async (req, res) => {
    if (!ensureConfig(res)) return;
    const { code, state, error, error_description } = req.query;

    if (error) {
        return res.redirect(`/crm/ajustes?fb_error=${encodeURIComponent(error_description || error)}`);
    }
    if (!code || !state) return res.status(400).send('Parametros faltantes');

    const entry = consumeState(state.toString());
    if (!entry) return res.status(400).send('Estado invalido o expirado');

    try {
        // Intercambiar code por user access token (corto)
        const tokenRes = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
            params: {
                client_id: FB_APP_ID,
                client_secret: FB_APP_SECRET,
                redirect_uri: FB_OAUTH_REDIRECT_URI,
                code,
            },
        });
        const shortToken = tokenRes.data.access_token;

        // Long-lived token (~60 dias)
        const longRes = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: FB_APP_ID,
                client_secret: FB_APP_SECRET,
                fb_exchange_token: shortToken,
            },
        });
        const userAccessToken = longRes.data.access_token;
        const expiresIn = longRes.data.expires_in || 60 * 24 * 60 * 60;

        // Perfil del usuario
        const meRes = await axios.get(`${GRAPH_BASE}/me`, {
            params: { fields: 'id,name,email', access_token: userAccessToken },
        });

        // Paginas del usuario (pages_show_list)
        const pagesRes = await axios.get(`${GRAPH_BASE}/me/accounts`, {
            params: {
                fields: 'id,name,access_token,category,tasks',
                access_token: userAccessToken,
            },
        });
        const pages = (pagesRes.data.data || []).map((p) => ({
            id: p.id,
            name: p.name,
            accessToken: p.access_token,
            category: p.category || null,
            tasks: p.tasks || [],
            subscribed: false,
        }));

        await db.collection('users').doc(entry.uid)
            .collection('integrations').doc('facebook').set({
                userId: meRes.data.id,
                userName: meRes.data.name,
                userEmail: meRes.data.email || null,
                userAccessToken,
                pages,
                scopes: REQUESTED_SCOPES,
                connectedAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + expiresIn * 1000),
            }, { merge: true });

        res.redirect('/crm/ajustes?fb_connected=1');
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.error('[FB OAuth] callback error:', msg);
        res.redirect(`/crm/ajustes?fb_error=${encodeURIComponent(msg)}`);
    }
});

// 3) Estado de la integracion (para la UI)
router.get('/status', async (req, res) => {
    const decoded = await verifyFirebaseToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'No autorizado' });
    try {
        const snap = await db.collection('users').doc(decoded.uid)
            .collection('integrations').doc('facebook').get();
        if (!snap.exists) return res.json({ success: true, connected: false });
        const data = snap.data();
        res.json({
            success: true,
            connected: true,
            userName: data.userName,
            userEmail: data.userEmail,
            pages: (data.pages || []).map((p) => ({
                id: p.id,
                name: p.name,
                category: p.category,
                subscribed: !!p.subscribed,
            })),
            expiresAt: data.expiresAt?.toMillis?.() || null,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4) Suscribir una pagina a la app (pages_manage_metadata)
router.post('/subscribe-page', express.json(), async (req, res) => {
    const decoded = await verifyFirebaseToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'No autorizado' });
    const { pageId } = req.body || {};
    if (!pageId) return res.status(400).json({ success: false, message: 'Falta pageId' });

    try {
        const ref = db.collection('users').doc(decoded.uid)
            .collection('integrations').doc('facebook');
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: 'No conectado' });
        const data = snap.data();
        const page = (data.pages || []).find((p) => p.id === pageId);
        if (!page) return res.status(404).json({ success: false, message: 'Pagina no encontrada' });

        await axios.post(
            `${GRAPH_BASE}/${pageId}/subscribed_apps`,
            null,
            {
                params: {
                    subscribed_fields: 'messages,messaging_postbacks,message_deliveries,messaging_optins',
                    access_token: page.accessToken,
                },
            }
        );

        const updatedPages = data.pages.map((p) =>
            p.id === pageId ? { ...p, subscribed: true } : p
        );
        await ref.update({ pages: updatedPages });

        res.json({ success: true });
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        res.status(500).json({ success: false, message: msg });
    }
});

// 5) Enviar mensaje de prueba desde la pagina (pages_messaging)
router.post('/send-test-message', express.json(), async (req, res) => {
    const decoded = await verifyFirebaseToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'No autorizado' });
    const { pageId, recipientId, text, messagingType } = req.body || {};
    if (!pageId || !recipientId || !text) {
        return res.status(400).json({ success: false, message: 'Parametros faltantes' });
    }
    try {
        const snap = await db.collection('users').doc(decoded.uid)
            .collection('integrations').doc('facebook').get();
        const page = (snap.data()?.pages || []).find((p) => p.id === pageId);
        if (!page) return res.status(404).json({ success: false, message: 'Pagina no encontrada' });

        const payload = {
            recipient: { id: recipientId },
            message: { text },
            messaging_type: messagingType || 'RESPONSE',
        };

        const r = await axios.post(
            `${GRAPH_BASE}/${pageId}/messages`,
            payload,
            { params: { access_token: page.accessToken } }
        );
        res.json({ success: true, messageId: r.data.message_id });
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        res.status(500).json({ success: false, message: msg });
    }
});

// 6) Insights basicos de la pagina (pages_read_engagement)
router.get('/page-insights/:pageId', async (req, res) => {
    const decoded = await verifyFirebaseToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'No autorizado' });
    try {
        const snap = await db.collection('users').doc(decoded.uid)
            .collection('integrations').doc('facebook').get();
        const page = (snap.data()?.pages || []).find((p) => p.id === req.params.pageId);
        if (!page) return res.status(404).json({ success: false, message: 'Pagina no encontrada' });

        const r = await axios.get(`${GRAPH_BASE}/${req.params.pageId}`, {
            params: {
                fields: 'id,name,followers_count,fan_count,link,category',
                access_token: page.accessToken,
            },
        });
        res.json({ success: true, data: r.data });
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        res.status(500).json({ success: false, message: msg });
    }
});

// 7) Desconectar la integracion
router.post('/disconnect', async (req, res) => {
    const decoded = await verifyFirebaseToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'No autorizado' });
    try {
        await db.collection('users').doc(decoded.uid)
            .collection('integrations').doc('facebook').delete();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
