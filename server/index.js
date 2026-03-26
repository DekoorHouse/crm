const { app } = require('./config');
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const autoPostRouter = require('./autopost/autoPostRoutes');
const { router: laserRouter, bridge: laserBridge } = require('./laser/laserRoutes');
const { startScheduler } = require('./autopost/autoPostScheduler');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
// Messenger ANTES de WhatsApp porque '/webhook' capturaría '/webhook/messenger'
const { router: messengerRouter } = require('./messengerHandler');
app.use('/webhook/messenger', messengerRouter);

app.use('/webhook', whatsappRouter);

// Endpoint para servir variables de entorno al frontend de forma segura
app.get('/env-config.js', (req, res) => {
    res.type('application/javascript');
    // Si no hay API_URL definida, vacía para que use rutas relativas (mismo dominio)
    res.send(`window.API_BASE_URL = "${process.env.API_URL || ''}";`);
});

// IMPORTANTE: Definir el router de la API antes que los archivos estáticos
app.use('/api', apiRouter);
app.use('/api/autopost', autoPostRouter);
app.use('/api/laser', laserRouter);

// --- SERVIR ARCHIVOS ESTÁTICOS ---
app.use(express.static(path.join(__dirname, '..', 'public')));

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

app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'checador', 'panel.html'));
});

app.get('/checador/panel', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'checador', 'panel.html'));
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

// Esta ruta debe ir al final para no interferir con las rutas de la API y el webhook
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---
const server = app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  // Iniciar scheduler de auto-publicacion Google Photos -> Facebook
  startScheduler();
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
