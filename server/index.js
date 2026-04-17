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
const jtGuiasRouter = require('./jt/jtRoutes');
const { startScheduler } = require('./autopost/autoPostScheduler');
const { startWhatsAppScheduler } = require('./autopost/whatsappGroupScheduler');
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
app.use('/api/jt-guias', jtGuiasRouter);
app.use('/api/messenger-import', require('./messengerImport'));

// --- Facebook Login for Business (OAuth para App Review) ---
app.use('/auth/facebook', require('./facebookAuth'));

// --- COOKIE PARSER ---
app.use(cookieParser());

// --- SESSION AUTH PARA /admon/ ---
// Crear session cookie a partir de Firebase ID token
app.post('/api/admin/session-login', async (req, res) => {
    const idToken = req.body.idToken;
    if (!idToken) return res.status(400).json({ error: 'Token requerido' });
    try {
        // Verificar el token y crear session cookie (5 días)
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
        await admin.auth().verifySessionCookie(sessionCookie, true);
        next(); // Cookie válida → continuar
    } catch (error) {
        res.clearCookie('__session', { path: '/' });
        return res.sendFile(path.join(__dirname, '..', 'public', 'admon', 'login.html'));
    }
});

// --- SERVIR ARCHIVOS ESTÁTICOS ---
app.use(express.static(path.join(__dirname, '..', 'public')));

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
    'simulador-ia', 'ajustes'
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

app.get('/guias', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'guias', 'index.html'));
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
        { loc: '/jt-rastreo/', changefreq: 'monthly', priority: '0.6' },
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

// --- Rutas dinámicas de /datos-envio/:pedido ---
app.get('/datos-envio/:pedido', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'datos-envio', 'index.html'));
});

// Esta ruta debe ir al final para no interferir con las rutas de la API y el webhook
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---
const server = app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  // Iniciar scheduler de auto-publicacion Google Photos -> Facebook
  startScheduler();
  // Iniciar scheduler de WhatsApp Group
  startWhatsAppScheduler();
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
