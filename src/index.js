const { app } = require('./config/config');
const { router: whatsappRouter } = require('./api/whatsappHandler');
const apiRouter = require('./api/apiRoutes');
const path = require('path');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
app.use('/webhook', whatsappRouter);
app.use('/api', apiRouter);

// --- RUTA PARA SERVIR LA APLICACIÓN FRONTEND ---
// Esta ruta debe ir al final para no interferir con las rutas de la API y el webhook
app.get('*', (req, res) => {
    // La ruta ahora sube un nivel desde 'src' para encontrar 'public'
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});

