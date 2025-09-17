const { app } = require('./config');
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const path = require('path');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
app.use('/webhook', whatsappRouter);
app.use('/api', apiRouter);

// --- INICIO DE LA CORRECCIÓN: Rutas para servir archivos estáticos y páginas HTML ---

// Servir la página de administración cuando se acceda a /admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Servir la página de pedidos cuando se acceda a /pedidos
app.get('/pedidos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pedidos.html'));
});

// Servir la aplicación principal (CRM) en la ruta raíz y cualquier otra ruta no definida
// Esto asegura que si alguien va a "/", vea el CRM, y que las rutas internas del CRM funcionen.
app.get('*', (req, res) => {
    // Excluye las rutas de la API y del webhook para evitar conflictos
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhook')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- FIN DE LA CORRECCIÓN ---

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
  console.log(`Panel de Administración disponible en: http://localhost:${PORT}/admin`);
  console.log(`Gestor de Pedidos disponible en: http://localhost:${PORT}/pedidos`);
  console.log(`CRM Principal disponible en: http://localhost:${PORT}/`);
});
