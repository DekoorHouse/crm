/**
 * apiAuth.js — Autenticación para TODAS las rutas /api (montado en server/index.js).
 *
 * Hasta 2026-07 los endpoints /api estaban abiertos: cualquiera con la URL podía leer
 * contactos, mandar mensajes de WhatsApp o quemar tokens de Gemini. Este middleware
 * exige una credencial en cada petición /api, salvo la lista PUBLIC_RULES de abajo.
 *
 * Credenciales aceptadas (en este orden):
 *   1. Header `x-worker-key` == WORKER_API_KEY (scripts locales: send-design-approval,
 *      gen-grabado, gen-lampara-bn, fb-group-publish, wa-publish, o curls manuales).
 *   2. Header `Authorization: Bearer <Firebase ID token>` de un usuario permitido.
 *   3. Cookie `__session` de /admon (la crea POST /api/admin/session-login).
 *
 * Usuario permitido = ADMIN_EMAIL, o email listado en API_AUTH_ALLOWED_EMAILS, o email
 * con documento en la colección `users` de Firestore (la que administra el CRM en
 * Ajustes → Usuarios). Así dar de alta un empleado en el CRM basta para darle API.
 * OJO: cualquiera puede crearse una cuenta en el proyecto Firebase (el signup por API
 * está abierto), por eso NO basta con "token válido": el email debe estar permitido.
 *
 * Modos (env var API_AUTH_MODE):
 *   'off'     → no hace nada (kill-switch total).
 *   'log'     → DEFAULT. Deja pasar todo, pero loguea `[api-auth] BLOQUEARÍA ...` por
 *               cada petición que en modo enforce sería rechazada. Sirve para desplegar
 *               sin riesgo y ver en los logs de Render qué faltó antes de encender.
 *   'enforce' → responde 401 a las peticiones sin credencial válida.
 *
 * Rollout: deploy en 'log' → revisar logs unos días → poner API_AUTH_MODE=enforce y
 * WORKER_API_KEY en Render (+ el mismo WORKER_API_KEY en el .env local). Si algo
 * truena: API_AUTH_MODE=off y redeploy.
 */
'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');

const MODE = (() => {
    const raw = String(process.env.API_AUTH_MODE || 'log').trim().toLowerCase();
    if (['off', 'log', 'enforce'].includes(raw)) return raw;
    console.warn(`[api-auth] API_AUTH_MODE="${raw}" no es off|log|enforce; usando 'log'.`);
    return 'log';
})();

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@dekoor.com').toLowerCase();
const EXTRA_ALLOWED = String(process.env.API_AUTH_ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const WORKER_KEY = String(process.env.WORKER_API_KEY || '').trim();

// --- RUTAS PÚBLICAS ---------------------------------------------------------
// Estas rutas las llaman clientes finales, repartidores o terceros SIN sesión.
// `method` omitido = cualquier método. `path` con '*' final = prefijo.
// Todo lo que NO esté aquí exige credencial (en modo enforce).
const PUBLIC_RULES = [
    // Infra de esta misma capa: el frontend pregunta el modo para decidir su gate de login.
    { method: 'GET', path: '/api/auth/mode' },

    // Login del panel /admon: el body trae el ID token, todavía no hay cookie.
    { method: 'POST', path: '/api/admin/session-login' },
    { method: 'POST', path: '/api/admin/session-logout' },

    // Único callback de tercero bajo /api. Valida su propio HMAC con MP_WEBHOOK_SECRET.
    { method: 'POST', path: '/api/mercadopago/webhook' },

    // Sitio público: checkout, pagos y widgets.
    { method: 'POST', path: '/api/mercadopago/checkout' },
    { method: 'GET', path: '/api/mercadopago/order/*' },      // /sitio/pago-exitoso consulta la orden
    { method: 'GET', path: '/api/pagos/transferencia/info' },
    { method: 'POST', path: '/api/pagos/transferencia' },
    { method: 'POST', path: '/api/carritos-abandonados' },     // tracking de carrito desde el sitio
    { method: 'GET', path: '/api/config/prices' },
    { method: 'GET', path: '/api/pedidos-recientes' },         // ticker de compras recientes del sitio
    { method: 'GET', path: '/api/wa/file' },                   // proxy de imágenes (sitio + galería referencias)

    // Formularios que el cliente abre desde un link de WhatsApp.
    { method: 'GET', path: '/api/envio/pedido/*' },            // precarga de /datos-estafeta
    { method: 'POST', path: '/api/datos-envio' },              // el cliente manda sus datos de envío
    { method: 'GET', path: '/api/codigo-postal/*' },
    { method: 'GET', path: '/api/buscar-cp' },
    { method: 'GET', path: '/api/estados' },
    { method: 'GET', path: '/api/rastreo/*' },                 // página pública de rastreo

    // Repartos MTY (form del cliente + app del repartidor, que valida su token de tanda).
    { method: 'GET', path: '/api/repartos-mty/pedido/*' },
    { method: 'POST', path: '/api/repartos-mty' },
    { method: 'GET', path: '/api/repartos-mty/tanda/*' },
    { method: 'POST', path: '/api/repartos-mty/tanda/*' },

    // Repartos DGO (form del cliente).
    { method: 'GET', path: '/api/repartos-dgo/pedido/*' },
    { method: 'POST', path: '/api/repartos-dgo' },

    // Referencias: galería pública de clientes (subidas pasan por moderación interna).
    { method: 'GET', path: '/api/referencias/home' },
    { method: 'GET', path: '/api/referencias/mapa' },
    { method: 'POST', path: '/api/referencias/upload' },
    { method: 'POST', path: '/api/referencias/crear' },
    { method: 'POST', path: '/api/referencias/notificar' },

    // Kiosco del checador: verifica la red del taller ANTES de que el empleado inicie sesión.
    { method: 'GET', path: '/api/checador/check-network' },
];

// Precompila las reglas para el hot path.
const COMPILED_RULES = PUBLIC_RULES.map(r => ({
    method: r.method ? r.method.toUpperCase() : null,
    exact: r.path.endsWith('*') ? null : r.path.toLowerCase(),
    prefix: r.path.endsWith('*') ? r.path.slice(0, -1).toLowerCase() : null,
}));

function isPublicPath(method, pathLower) {
    const m = method === 'HEAD' ? 'GET' : method; // Express atiende HEAD con los handlers GET
    for (const r of COMPILED_RULES) {
        if (r.method && r.method !== m) continue;
        if (r.exact !== null ? pathLower === r.exact : pathLower.startsWith(r.prefix)) return true;
    }
    return false;
}

// --- LLAVE DE WORKER --------------------------------------------------------
function workerKeyOk(req) {
    if (!WORKER_KEY) return false;
    const got = String(req.get('x-worker-key') || '');
    if (!got) return false;
    const a = Buffer.from(got);
    const b = Buffer.from(WORKER_KEY);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- ALLOWLIST DE EMAILS ----------------------------------------------------
// Cache en memoria para no leer Firestore en cada petición (positivos 5 min,
// negativos 1 min). La fuente es la colección `users` (doc id = email minúsculas).
const emailCache = new Map(); // email -> { ok, exp }
const CACHE_OK_MS = 5 * 60 * 1000;
const CACHE_NEG_MS = 60 * 1000;

async function isEmailAllowed(emailRaw) {
    const email = String(emailRaw || '').toLowerCase();
    if (!email) return false;
    if (email === ADMIN_EMAIL || EXTRA_ALLOWED.includes(email)) return true;
    const hit = emailCache.get(email);
    if (hit && hit.exp > Date.now()) return hit.ok;
    let ok = false;
    try {
        ok = (await admin.firestore().collection('users').doc(email).get()).exists;
    } catch (e) {
        console.error('[api-auth] error consultando users:', e.message);
        ok = !!(hit && hit.ok); // si Firestore falla, conserva el último veredicto positivo
    }
    emailCache.set(email, { ok, exp: Date.now() + (ok ? CACHE_OK_MS : CACHE_NEG_MS) });
    if (emailCache.size > 500) emailCache.delete(emailCache.keys().next().value);
    return ok;
}

// --- RESOLUCIÓN DE CREDENCIAL -----------------------------------------------
async function resolveCredential(req) {
    if (workerKeyOk(req)) return { via: 'worker-key' };

    const m = String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
    if (m) {
        try {
            const decoded = await admin.auth().verifyIdToken(m[1]);
            const email = String(decoded.email || '').toLowerCase();
            if (await isEmailAllowed(email)) return { via: 'token', email, uid: decoded.uid };
            return { error: `email no permitido (${email || 'token sin email'})` };
        } catch (e) {
            return { error: 'token inválido (' + (e.code || e.message) + ')' };
        }
    }

    const session = req.cookies && req.cookies.__session;
    if (session) {
        try {
            // checkRevoked=false: verificación local (rápida); la cookie expira sola a los 5 días.
            const decoded = await admin.auth().verifySessionCookie(session, false);
            const email = String(decoded.email || '').toLowerCase();
            if (await isEmailAllowed(email)) return { via: 'session', email, uid: decoded.uid };
            return { error: `cookie de sesión de email no permitido (${email})` };
        } catch (e) {
            return { error: 'cookie de sesión inválida' };
        }
    }

    return { error: 'sin credenciales' };
}

// --- MIDDLEWARE -------------------------------------------------------------
async function apiAuth(req, res, next) {
    if (MODE === 'off') return next();

    // Solo vigila /api. Normaliza mayúsculas y slash final porque el routing de
    // Express es case-insensitive y tolera '/': /API/orders/ llega al mismo handler.
    let p = String(req.path || '').toLowerCase().replace(/\/+$/, '') || '/';
    if (p !== '/api' && !p.startsWith('/api/')) return next();

    if (req.method === 'OPTIONS') return next(); // preflight CORS, sin headers de auth
    if (isPublicPath(req.method, p)) { req.apiAuth = { via: 'public' }; return next(); }

    // Todo el trabajo async va en try/catch: Express 4 no atrapa errores async y un
    // unhandled rejection tumbaría el proceso completo en Render.
    try {
        const cred = await resolveCredential(req);
        if (!cred.error) { req.apiAuth = cred; return next(); }

        if (MODE === 'log') {
            console.warn(`[api-auth] BLOQUEARÍA ${req.method} ${req.originalUrl.split('?')[0]} — ${cred.error} | origin=${req.get('origin') || '-'} ref=${req.get('referer') || '-'} ip=${req.ip} ua=${String(req.get('user-agent') || '').slice(0, 70)}`);
            req.apiAuth = { via: 'log-pass', error: cred.error };
            return next();
        }

        res.set('WWW-Authenticate', 'Bearer realm="api"');
        // success:false + error + message: cubre las tres convenciones de error de los frontends.
        return res.status(401).json({ success: false, error: 'No autorizado', message: 'No autorizado: inicia sesión de nuevo.', code: 'AUTH_REQUIRED' });
    } catch (e) {
        console.error('[api-auth] error inesperado:', e);
        if (MODE === 'log') return next(); // en observación nunca rompemos la petición
        return res.status(401).json({ success: false, error: 'No autorizado', message: 'Error de autenticación, intenta de nuevo.', code: 'AUTH_ERROR' });
    }
}

// Resumen al arrancar, para ver de un vistazo en los logs de Render cómo quedó.
console.log(`[api-auth] modo=${MODE}${MODE === 'log' ? ' (solo observa; para exigir credenciales: API_AUTH_MODE=enforce)' : ''} | rutas públicas=${PUBLIC_RULES.length} | worker key=${WORKER_KEY ? 'configurada' : 'NO configurada'} | emails extra=${EXTRA_ALLOWED.length}`);
if (MODE === 'enforce' && !WORKER_KEY) {
    console.warn('[api-auth] enforce SIN WORKER_API_KEY: los scripts locales (send-design-approval, gen-grabado, fb/wa-publish) van a recibir 401.');
}

module.exports = { apiAuth, API_AUTH_MODE: MODE };
