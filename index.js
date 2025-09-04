const { app } = require('./config');
const express = require('express'); // <-- LÍNEA AÑADIDA
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const path = require('path');

const PORT = process.env.PORT || 3000;

// --- NUEVA CONFIGURACIÓN PARA ARCHIVOS ESTÁTICOS ---
// Esto le dice a Express que la carpeta 'public' contiene archivos a los que se puede acceder directamente.
// Es la forma estándar y recomendada de manejar archivos HTML, CSS, JS, etc.
app.use(express.static(path.join(__dirname, 'public')));

// --- MONTAJE DE RUTAS ---
app.use('/webhook', whatsappRouter);
app.use('/api', apiRouter);

// --- RUTA NUEVA PARA LA PÁGINA DE PEDIDOS ---
// Esta ruta específica debe ir ANTES de la ruta genérica '*' para que funcione.
app.get('/pedidos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pedidos.html'));
});

// --- RUTA PARA SERVIR LA APLICACIÓN FRONTEND ---
// Esta ruta actúa como un "catch-all" (atrapa todo). Si ninguna de las rutas anteriores coincide,
// envía la página principal del CRM. Esto es útil para frameworks de una sola página.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});

