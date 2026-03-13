const { app } = require('./config');
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
app.use('/webhook', whatsappRouter);

// Endpoint para servir variables de entorno al frontend de forma segura
app.get('/env-config.js', (req, res) => {
    res.type('application/javascript');
    // Si no hay API_URL definida, vacía para que use rutas relativas (mismo dominio)
    res.send(`window.API_BASE_URL = "${process.env.API_URL || ''}";`);
});

// IMPORTANTE: Definir el router de la API antes que los archivos estáticos
app.use('/api', apiRouter);

// --- SERVIR ARCHIVOS ESTÁTICOS ---
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTAS PARA SERVIR LA APLICACIÓN FRONTEND ---
app.get('/ads', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ads.html'));
});

// Esta ruta debe ir al final para no interferir con las rutas de la API y el webhook
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
