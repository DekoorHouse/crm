const { app } = require('./config');
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const path = require('path');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
app.use('/webhook', whatsappRouter);

// Trace para depuración de rutas API
app.use('/api', (req, res, next) => {
    console.log(`[INDEX-TRACE] Petición entrante a /api: ${req.method} ${req.originalUrl}`);
    next();
});

app.use('/api', apiRouter);

// --- RUTA PARA SERVIR LA APLICACIÓN FRONTEND ---
// Esta ruta debe ir al final para no interferir con las rutas de la API y el webhook
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
