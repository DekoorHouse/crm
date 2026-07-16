const { app, admin } = require('./config');
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const autoPostRouter = require('./autopost/autoPostRoutes');
const waGroupRouter = require('./autopost/whatsappGroupRoutes');
const fbGroupRouter = require('./autopost/fbGroupRoutes');
const { router: laserRouter, bridge: laserBridge } = require('./laser/laserRoutes');
const metaAdsRouter = require('./meta/metaAdsRoutes');
const mockupsRouter = require('./mockups/mockupsRoutes');
const mercadopagoRouter = require('./mercadopago/mercadopagoRoutes');
const transferenciasRouter = require('./transferencias/transferenciasRoutes');
const carritosRouter = require('./carritos/carritosRoutes');
const leadsRouter = require('./leads/leadReactivationRoutes');
const repartosMtyRouter = require('./repartos/repartosRoutes');
const repartosDgoRouter = require('./repartos/dgoRoutes');
const { startScheduler } = require('./autopost/autoPostScheduler');
const { startWhatsAppScheduler } = require('./autopost/whatsappGroupScheduler');
const { startCartRecoveryScheduler } = require('./carritos/carritosScheduler');
const { startInventarioScheduler } = require('./inventario/inventarioScheduler');
const { startLeadReactivationScheduler } = require('./leads/leadReactivationScheduler');
const { startOrderFollowupScheduler } = require('./leads/orderFollowupScheduler');
const { startScheduledReminderScheduler } = require('./leads/scheduledReminderScheduler');
const { startScheduledMessagesScheduler } = require('./scheduledMessages/scheduledMessagesScheduler');
const { startShippingDigestScheduler } = require('./shipping/shippingDigestScheduler');
const { startSpendCapAlertScheduler } = require('./meta/spendCapAlertScheduler');
const { startMockupAutoScheduler } = require('./mockups/mockupAutoScheduler');
const orderFollowupRouter = require('./leads/orderFollowupRoutes');
const scheduledReminderRouter = require('./leads/scheduledReminderRoutes');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const cookieParser = require('cookie-parser');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
// Messenger e Instagram ANTES de WhatsApp porque '/webhook' capturaría sub-rutas
const { router: messengerRouter } = require('./messengerHandler');
app.use('/webhook/messenger', messengerRouter);
app.use('/webhook/instagram', messengerRouter); // Mismo handler, diferencia por object: 'instagram'

app.use('/webhook', whatsappRouter);

// Endpoint para servir variables de entorno al frontend de forma segura
app.get('/env-config.js', (req, res) => {
    res.type('application/javascript');
    // Si no hay API_URL definida, vacía para que use rutas relativas (mismo dominio)
    res.send(`window.API_BASE_URL = "${process.env.API_URL || ''}";
window.GOOGLE_MAPS_KEY = "${process.env.GOOGLE_MAPS_KEY || ''}";`);
});

// IMPORTANTE: Definir el router de la API antes que los archivos estáticos
app.use('/api', apiRouter);
app.use('/api/autopost', autoPostRouter);
app.use('/api/wa-group', waGroupRouter);
app.use('/api/fb-group', fbGroupRouter);
app.use('/api/laser', laserRouter);
app.use('/api/meta-ads', metaAdsRouter);
app.use('/api/mockups', mockupsRouter);
app.use('/api/mercadopago', mercadopagoRouter);
app.use('/api/pagos/transferencia', transferenciasRouter);
app.use('/api/carritos-abandonados', carritosRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/order-followup', orderFollowupRouter);
app.use('/api/reminders', scheduledReminderRouter);
app.use('/api/repartos-mty', repartosMtyRouter);
app.use('/api/repartos-dgo', repartosDgoRouter);
app.use('/api/messenger-import', require('./messengerImport'));

// --- Facebook Login for Business (OAuth para App Review) ---
app.use('/auth/facebook', require('./facebookAuth'));

// --- COOKIE PARSER ---
app.use(cookieParser());

// --- SESSION AUTH PARA /admon/ ---
// Único email autorizado para el panel admon. Cualquier otro usuario es rechazado.
const ALLOWED_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@dekoor.com').toLowerCase();

// Crear session cookie a partir de Firebase ID token
app.post('/api/admin/session-login', async (req, res) => {
    const idToken = req.body.idToken;
    if (!idToken) return res.status(400).json({ error: 'Token requerido' });
    try {
        // Verificar el token y extraer el email
        const decoded = await admin.auth().verifyIdToken(idToken);
        const email = (decoded.email || '').toLowerCase();
        if (email !== ALLOWED_ADMIN_EMAIL) {
            console.warn('Intento de login no autorizado:', decoded.email);
            return res.status(403).json({ error: 'Usuario no autorizado para el panel admon' });
        }

        // Crear session cookie (5 días)
        const expiresIn = 5 * 24 * 60 * 60 * 1000;
        const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
        res.cookie('__session', sessionCookie, {
            maxAge: expiresIn,
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            path: '/'
        });
        res.json({ ok: true });
    } catch (error) {
        console.error('Error creando session cookie:', error.message);
        res.status(401).json({ error: 'Token inválido' });
    }
});

// Cerrar sesión server-side
app.post('/api/admin/session-logout', (req, res) => {
    res.clearCookie('__session', { path: '/' });
    res.json({ ok: true });
});

// Middleware: proteger /admon/ con session cookie
app.use('/admon', async (req, res, next) => {
    // Permitir archivos estáticos de JS/CSS (necesarios para el login form)
    if (req.path.match(/\.(js|css|png|ico|webp|json|svg|woff|woff2)$/)) {
        return next();
    }
    const sessionCookie = req.cookies?.__session || '';
    if (!sessionCookie) {
        // Sin cookie → servir la página de login standalone
        return res.sendFile(path.join(__dirname, '..', 'public', 'admon', 'login.html'));
    }
    try {
        const decoded = await admin.auth().verifySessionCookie(sessionCookie, true);
        // Doble verificación: solo el email autorizado puede pasar
        if ((decoded.email || '').toLowerCase() !== ALLOWED_ADMIN_EMAIL) {
            res.clearCookie('__session', { path: '/' });
            return res.sendFile(path.join(__dirname, '..', 'public', 'admon', 'login.html'));
        }
        next(); // Cookie válida y email autorizado → continuar
    } catch (error) {
        res.clearCookie('__session', { path: '/' });
        return res.sendFile(path.join(__dirname, '..', 'public', 'admon', 'login.html'));
    }
});

// --- PWA: Service Worker del CRM (servir con Service-Worker-Allowed para que el scope /crm/ funcione) ---
app.get('/crm-sw.js', (req, res) => {
    res.setHeader('Service-Worker-Allowed', '/crm/');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '..', 'public', 'crm-sw.js'));
});

// --- PWA: Service Worker de Comunicación Masiva (scope raíz para cubrir
// /audiencias/, /cobranza/, /retargeting/ con una sola app instalable) ---
app.get('/comunicacion-sw.js', (req, res) => {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '..', 'public', 'comunicacion-sw.js'));
});

// --- PWA: Service Worker raíz (sitio público + CRM vanilla instalado). Se sirve SIN caché para que
// al subir el CACHE_NAME de public/sw.js la actualización llegue de inmediato y la PWA no se quede con
// JS/HTML viejo (si se cacheara, el SW tardaba en detectar el cambio y seguía sirviendo código stale). ---
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});

// --- SEO SITIO PÚBLICO: páginas de colección con URL propia e indexable ---
// /sitio/coleccion/ninos/ etc. sirven el template de colección con title, h1,
// canonical y Open Graph únicos por colección (el catálogo lo pinta el JS del
// cliente, que detecta la colección desde el path).
const SITIO_COLECCIONES = {
    ninos: {
        h1: 'Lámparas 3D personalizadas para niños',
        title: 'Lámparas 3D Personalizadas para Niños con Nombre | DEKOOR',
        desc: 'Lámparas personalizadas para niños: su personaje favorito, su foto y su nombre grabados con láser. Envío gratis a todo México.',
        visible: 'Lámparas 3D mágicas para los más pequeños del hogar. Personalizadas con su nombre y personaje favorito.',
        img: 'lamp-ariel.webp'
    },
    pareja: {
        h1: 'Lámparas personalizadas para pareja con foto',
        title: 'Lámparas Personalizadas para Pareja con Foto | DEKOOR',
        desc: 'Regalos románticos: lámpara 3D con su foto, nombres y fecha especial grabados con láser. Aniversarios y novios. Envío gratis a todo México.',
        visible: 'Regalos románticos personalizados con tu foto y mensaje especial. El detalle perfecto para esa persona.',
        img: 'lamp-pareja.webp'
    },
    empresas: {
        h1: 'Lámparas corporativas con logo grabado con láser',
        title: 'Lámparas Corporativas con Logo para Empresas | DEKOOR',
        desc: 'Regalos corporativos y reconocimientos con el logo de tu empresa grabado con láser. Precios de mayoreo desde 10 piezas. Envío a todo México.',
        visible: 'Reconocimientos, trofeos y regalos corporativos con el logo de tu empresa o equipo favorito.',
        img: 'lamp-empresas.webp'
    },
    familia: {
        h1: 'Lámparas personalizadas con foto familiar',
        title: 'Lámparas Personalizadas con Foto de Familia | DEKOOR',
        desc: 'Tu foto familiar convertida en lámpara 3D grabada con láser. El regalo para mamá, papá y abuelos. Envío gratis a todo México.',
        visible: 'Inmortaliza los mejores momentos familiares. Fotos de mamá, papá, abuelos e hijos.',
        img: 'lamp-familia2.webp'
    },
    mascotas: {
        h1: 'Lámparas personalizadas con foto de tu mascota',
        title: 'Lámparas Personalizadas con Foto de Mascotas | DEKOOR',
        desc: 'La foto de tu perro o gato convertida en lámpara 3D grabada con láser. El regalo perfecto para amantes de las mascotas. Envío gratis a todo México.',
        visible: 'Tu mejor amigo hecho luz. Lámparas con la foto de tu perro, gato o compañero de vida grabada con láser.',
        img: 'lamp-mascotas.webp'
    },
    graduacion: {
        h1: 'Lámparas personalizadas de graduación',
        title: 'Lámparas Personalizadas de Graduación con Foto | DEKOOR',
        desc: 'Regalos de graduación personalizados: lámpara 3D con foto, nombre, carrera y generación grabados con láser. Envío gratis a todo México.',
        visible: 'Su logro merece brillar: lámparas con foto, nombre, generación y carrera para celebrar la graduación.',
        img: 'og-logo.png'
    },
    profesiones: {
        h1: 'Lámparas personalizadas de profesiones y oficios',
        title: 'Lámparas Personalizadas para Doctores, Maestros y Más | DEKOOR',
        desc: 'Regalos para profesionistas: lámpara 3D con el símbolo de su profesión u oficio y su nombre grabados con láser. Envío gratis a todo México.',
        visible: 'Doctores, maestras, ingenieros, abogados... su vocación convertida en luz con su nombre grabado.',
        img: 'og-logo.png'
    },
    deportes: {
        h1: 'Lámparas personalizadas de deportes y aficiones',
        title: 'Lámparas Personalizadas de Deportes y Aficiones | DEKOOR',
        desc: 'Su equipo, su deporte o su pasión favorita en una lámpara 3D con su nombre grabado con láser. Envío gratis a todo México.',
        visible: 'Su equipo, su deporte o su pasión favorita con su nombre grabado con láser. Para fans de verdad.',
        img: 'lamp-deportes.webp'
    },
    memorial: {
        h1: 'Lámparas memorial con foto de tu ser querido',
        title: 'Lámparas Memorial Personalizadas con Foto | DEKOOR',
        desc: 'Un recuerdo luminoso para honrar a tu ser querido: lámpara memorial personalizada con foto y mensaje grabados con láser. Envío a todo México.',
        visible: 'Un tributo luminoso para honrar la memoria de tus seres queridos. Un recuerdo que siempre brilla.',
        img: 'lamp-memorial.webp'
    },
    religiosas: {
        h1: 'Lámparas religiosas personalizadas: Virgen y santos',
        title: 'Lámparas Religiosas: Virgen de Guadalupe y Santos | DEKOOR',
        desc: 'Virgen de Guadalupe, santos y mensajes de fe grabados con láser, personalizados con tu nombre. Envío gratis a todo México.',
        visible: 'Lámparas con imágenes religiosas personalizadas. Vírgenes, santos y mensajes de fe grabados con láser.',
        img: 'lamp-religiosas.webp'
    },
    cuadros: {
        h1: 'Cuadros personalizados con fotos grabadas en madera',
        title: 'Cuadros Personalizados con Fotos Grabadas en Madera | DEKOOR',
        desc: 'Cuadros de madera con tus fotos grabadas con láser: collages de corazón y mosaicos para tu pared. Cotización gratis por WhatsApp.',
        visible: 'Cuadros de madera personalizados con tus fotos grabadas con láser. El regalo que decora y emociona.',
        img: 'cuadro-multifoto.webp'
    }
};

let coleccionSeoTemplate = null;
function renderColeccionSeo(id) {
    const seo = SITIO_COLECCIONES[id];
    if (!coleccionSeoTemplate) {
        coleccionSeoTemplate = require('fs').readFileSync(
            path.join(__dirname, '..', 'public', 'sitio', 'coleccion', 'index.html'), 'utf8'
        );
    }
    const url = `https://app.dekoormx.com/sitio/coleccion/${id}/`;
    const imgUrl = `https://app.dekoormx.com/sitio/img/${seo.img}`;
    return coleccionSeoTemplate
        .split('<title>Colección de Regalos Personalizados | Dekoor</title>')
        .join(`<title>${seo.title}</title>`)
        .split('content="Explora nuestra colección de regalos personalizados con grabado láser. Lámparas 3D, cuadros con foto, letreros y más. Envío a todo México."')
        .join(`content="${seo.desc}"`)
        .split('content="Explora nuestra colección de regalos personalizados con grabado láser."')
        .join(`content="${seo.desc}"`)
        .split('content="Colección de Regalos Personalizados | Dekoor"')
        .join(`content="${seo.title}"`)
        .split('href="https://app.dekoormx.com/sitio/coleccion/"')
        .join(`href="${url}"`)
        .split('<meta property="og:url" content="https://app.dekoormx.com/sitio/coleccion/">')
        .join(`<meta property="og:url" content="${url}">`)
        .split('https://app.dekoormx.com/sitio/img/og-logo.png')
        .join(imgUrl)
        .split('<meta property="og:image:width" content="1200">')
        .join('<meta property="og:image:width" content="896">')
        .split('<meta property="og:image:height" content="630">')
        .join('<meta property="og:image:height" content="1195">')
        .split('<h1 id="collectionTitle">Cargando...</h1>')
        .join(`<h1 id="collectionTitle">${seo.h1}</h1>`)
        .split('<p id="collectionDesc"></p>')
        .join(`<p id="collectionDesc">${seo.visible}</p>`)
        .split('<li id="breadcrumbCurrent" style="color:var(--text-dark);font-weight:600;">Cargando...</li>')
        .join(`<li id="breadcrumbCurrent" style="color:var(--text-dark);font-weight:600;">${seo.h1}</li>`);
}

// Redirect 301 de las URLs viejas con query (?id=ninos) a las rutas indexables.
// Debe ir ANTES de express.static para interceptar el index.html del directorio.
app.get('/sitio/coleccion/', (req, res, next) => {
    const id = String(req.query.id || '').toLowerCase();
    if (id && SITIO_COLECCIONES[id]) return res.redirect(301, `/sitio/coleccion/${id}/`);
    next();
});

app.get('/sitio/coleccion/:id', (req, res, next) => {
    const id = String(req.params.id || '').toLowerCase();
    if (!SITIO_COLECCIONES[id]) return next();
    try {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderColeccionSeo(id));
    } catch (e) {
        console.error('[SITIO] Error renderizando colección SEO:', e.message);
        res.sendFile(path.join(__dirname, '..', 'public', 'sitio', 'coleccion', 'index.html'));
    }
});

// --- SERVIR ARCHIVOS ESTÁTICOS ---
// Caché HTTP: sin esto cada visita revalida cada recurso contra Render (default max-age=0).
// Imágenes/fuentes 7 días (los reemplazos de fotos usan nombres nuevos o toleran 7d),
// CSS/JS 1 hora (el sitio además se actualiza vía CACHE_NAME del service worker).
app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res, filePath) => {
        if (/\.(webp|jpe?g|png|gif|svg|ico|woff2?|ttf)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800');
        } else if (/\.(css|js)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }
}));

// --- NUEVA APP NEXT.JS ---
const nextjsDir = path.join(__dirname, '..', 'public', 'nextjs');

// Servir _next assets (JS/CSS bundles)
app.use('/_next', express.static(path.join(nextjsDir, '_next')));

// Legacy /pedidos-new routes (redirect to new paths)
app.get('/pedidos-new', (req, res) => res.redirect('/pedidos'));
app.get('/pedidos-new/pedidos', (req, res) => res.redirect('/pedidos'));
app.get('/pedidos-new/login', (req, res) => res.redirect('/login'));

// Next.js page routes
app.get('/pedidos', (req, res) => {
    res.sendFile(path.join(nextjsDir, 'pedidos.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(nextjsDir, 'login.html'));
});

// CRM routes — serve HTML for each section
app.get('/crm', (req, res) => {
    res.sendFile(path.join(nextjsDir, 'crm.html'));
});
const crmSections = [
    'chats', 'departamentos', 'reglas-ads', 'etiquetas',
    'mensajes-ads', 'respuestas-rapidas', 'entrenamiento-ia',
    'simulador-ia', 'ajustes', 'carritos-abandonados', 'rentabilidad',
    'campanas'
];
crmSections.forEach(section => {
    app.get(`/crm/${section}`, (req, res) => {
        res.sendFile(path.join(nextjsDir, 'crm', `${section}.html`));
    });
});

// --- RUTAS PARA SERVIR LA APLICACIÓN FRONTEND ---
app.get('/ads', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'ads', 'index.html'));
});

app.get('/editor', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'editor', 'index.html'));
});

app.get('/datos', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'datos', 'index.html'));
});


app.get('/autopost', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'autopost', 'index.html'));
});

app.get('/wa-group', (req, res) => {
    res.redirect('/autopost?tab=wa');
});

app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'checador', 'panel.html'));
});

app.get('/checador/panel', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'checador', 'panel.html'));
});

app.get('/checador/mi-perfil', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'checador', 'mi-perfil.html'));
});

app.get('/laser', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'laser', 'index.html'));
});

app.get('/envios', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'envios', 'index.html'));
});

app.get('/referencias', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'referencias', 'index.html'));
});

app.get('/referencias/moderacion', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'referencias', 'moderacion.html'));
});

app.get('/meta', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'meta', 'index.html'));
});

app.get('/mockups', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'mockups', 'index.html'));
});

app.get('/ps', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'ps', 'index.html'));
});

app.get('/terminos', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'terminos', 'index.html'));
});

app.get('/sitio/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'sitio', 'checkout', 'index.html'));
});

app.get('/sitio/pago-exitoso', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'sitio', 'pago-exitoso', 'index.html'));
});

app.get('/sitio/pago-fallido', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'sitio', 'pago-fallido', 'index.html'));
});

app.get('/sitio/pago-pendiente', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'sitio', 'pago-pendiente', 'index.html'));
});

// --- SITEMAP DINÁMICO ---
app.get('/sitemap.xml', (req, res) => {
    const baseUrl = 'https://app.dekoormx.com';
    const collections = ['ninos', 'pareja', 'empresas', 'familia', 'memorial', 'otros'];
    const today = new Date().toISOString().split('T')[0];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Páginas estáticas
    const pages = [
        { loc: '/sitio/', changefreq: 'weekly', priority: '1.0' },
        { loc: '/sitio/coleccion/', changefreq: 'weekly', priority: '0.9' },
        { loc: '/referencias/', changefreq: 'weekly', priority: '0.8' },
        { loc: '/privacidad/', changefreq: 'yearly', priority: '0.3' },
        { loc: '/terminos/', changefreq: 'yearly', priority: '0.3' },
    ];

    pages.forEach(p => {
        xml += `  <url>\n    <loc>${baseUrl}${p.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>\n`;
    });

    // Colecciones dinámicas
    collections.forEach(col => {
        xml += `  <url>\n    <loc>${baseUrl}/sitio/coleccion/?id=${col}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    });

    xml += '</urlset>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

// --- PÁGINA 404 para rutas del sitio público ---
app.get('/sitio/*', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

// --- Formulario de datos de envío (post-venta, DHL nacional) ---
// El cliente lo recibe por WhatsApp con su número de pedido precargado (/datos-estafeta/DHxxxx).
app.get(['/datos-estafeta', '/datos-estafeta/:pedido'], (req, res) => {
    res.set('Cache-Control', 'no-cache'); // que el cliente reciba siempre la última versión del formulario
    res.sendFile(path.join(__dirname, '..', 'public', 'datos-estafeta', 'index.html'));
});

// --- Página pública de rastreo amigable (el cliente ve el estado de su guía) ---
// Número de guía en la URL: /rastreo/12345 (o /rastreo y lo escribe). Usa GET /api/rastreo/:guia.
app.get(['/rastreo', '/rastreo/:guia'], (req, res) => {
    res.set('Cache-Control', 'no-cache'); // que el cliente reciba siempre la última versión de la página
    res.sendFile(path.join(__dirname, '..', 'public', 'rastreo', 'index.html'));
});

// --- Repartos MTY (entregas locales por repartidor propio) ---
// Formulario público para que el cliente mande su dirección.
app.get(['/mty', '/mty/:pedido'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'repartos-mty', 'index.html'));
});
// Vista del repartidor: la tanda del día (protegida por token en la URL).
app.get('/reparto/:fecha', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'repartos-mty', 'reparto.html'));
});

// --- Repartos DGO (entregas locales en Durango) ---
// Formulario público para que el cliente mande su dirección + ubicación.
// Cae directo en la colección `entregas_repartidor` que escucha la app.
app.get(['/dgo', '/dgo/:pedido'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'repartos-dgo', 'index.html'));
});
// Panel admin (protegido por la session cookie de /admon).
app.get('/admon/repartos', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admon', 'repartos.html'));
});

// Esta ruta debe ir al final para no interferir con las rutas de la API y el webhook
app.get('*', (req, res) => {
    // Si se pide un archivo estático inexistente (.js, .css, .png, etc.), devolver
    // un 404 real en vez del HTML del CRM. Así el navegador no intenta ejecutar
    // HTML como JavaScript ("MIME type 'text/html' is not executable") ni se sirve
    // el CRM en rutas inválidas.
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---
const server = app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  // Iniciar scheduler de auto-publicacion Google Photos -> Facebook
  startScheduler();
  // Iniciar scheduler de WhatsApp Group
  startWhatsAppScheduler();
  // Iniciar scheduler de recuperacion de carritos abandonados
  startCartRecoveryScheduler();
  // Iniciar scheduler de reactivacion de leads sin pedido registrado
  startLeadReactivationScheduler();
  // Iniciar scheduler de seguimiento de "pedido en proceso" (datos a medias) por IA
  startOrderFollowupScheduler();

  // Iniciar scheduler de recordatorios programados a fecha futura
  startScheduledReminderScheduler();
  // Iniciar scheduler de reporte diario de inventario (18:00 hora MX)
  startInventarioScheduler();
  // Iniciar scheduler de mensajes programados (envío diferido desde el chat)
  startScheduledMessagesScheduler();
  // Iniciar scheduler del resumen diario de pedidos listos para guía (1:30 pm MX)
  startShippingDigestScheduler();
  // Iniciar scheduler de alerta de límite publicitario Meta Ads (cada 30 min)
  startSpendCapAlertScheduler();
  // Iniciar scheduler de auto-generación de mockups (cada 10 min; SOLO genera, no envía)
  startMockupAutoScheduler();
  // Conectar bridge TCP a MeerK40t
  laserBridge.connect();
});

// --- WebSocket para Laser ---
const wss = new WebSocketServer({ server, path: '/ws/laser' });

wss.on('connection', (ws) => {
    // Send current connection status
    ws.send(JSON.stringify({ type: 'status', connected: laserBridge.connected }));

    // Forward MeerK40t output to this client
    const onOutput = (text) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'output', text }));
        }
    };
    const onConnected = () => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'status', connected: true }));
        }
    };
    const onDisconnected = () => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'status', connected: false }));
        }
    };

    laserBridge.on('output', onOutput);
    laserBridge.on('connected', onConnected);
    laserBridge.on('disconnected', onDisconnected);

    // Receive commands from client
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.type === 'command' && msg.cmd) {
                laserBridge.send(msg.cmd);
            }
        } catch (e) { /* ignore bad messages */ }
    });

    ws.on('close', () => {
        laserBridge.off('output', onOutput);
        laserBridge.off('connected', onConnected);
        laserBridge.off('disconnected', onDisconnected);
    });
});
