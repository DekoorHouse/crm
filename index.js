const { app } = require('./config');
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const path = require('path');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
app.use('/webhook', whatsappRouter);
app.use('/api', apiRouter);

// --- RUTA NUEVA PARA LA PÁGINA DE PEDIDOS ---
// Esta ruta específica debe ir ANTES de la ruta genérica '*' para que funcione.
app.get('/pedidos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pedidos.html'));
});

// --- RUTA PARA SERVIR LA APLICACIÓN FRONTEND ---
// Esta ruta debe ir al final para no interferir con las rutas de la API y el webhook
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
