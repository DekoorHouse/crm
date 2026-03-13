const { app } = require('./config');
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const path = require('path');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
app.use('/webhook', whatsappRouter);

// IMPORTANTE: Definir rutas críticas antes que el router general o estáticos
app.get('/api/orders/today', apiRouter); // apiRouter manejará el subpath si es router.get('/orders/today')
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
