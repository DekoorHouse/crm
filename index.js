// --- IMPORTACIONES ---
const { app } = require('./config'); // Configuración de Express y Firebase Admin
const { router: whatsappRouter } = require('./whatsappHandler'); // Rutas para la API OFICIAL de WhatsApp
const apiRouter = require('./apiRoutes'); // Rutas generales de la API del CRM
const webWhatsappRouter = require('./webWhatsappRoutes'); // NUEVO: Rutas para la API de WhatsApp WEB (Baileys)
const webWhatsappHandler = require('./webWhatsappHandler'); // NUEVO: Lógica principal de WhatsApp WEB (Baileys)
const path = require('path');

// --- PUERTO ---
const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---
app.use('/webhook', whatsappRouter); // Webhook para la API OFICIAL
app.use('/api/web', webWhatsappRouter); // NUEVO: Endpoints para WhatsApp WEB
app.use('/api', apiRouter); // Endpoints generales del CRM

// --- INICIALIZACIÓN DE WHATSAPP WEB ---
// Intenta iniciar la conexión de WhatsApp Web al arrancar el servidor.
// Usará la sesión guardada si existe, de lo contrario esperará a que se solicite el QR.
console.log('[Index] Intentando iniciar conexión de WhatsApp Web al arrancar...');
webWhatsappHandler.initializeWhatsAppWebClient().catch(err => {
    // Es normal que falle si no hay sesión guardada, solo loguear el error.
    console.error("[Index] Error inicializando WhatsApp Web al arrancar (puede ser normal si no hay sesión):", err.message);
});

// --- RUTA PARA SERVIR LA APLICACIÓN FRONTEND ---
// Sirve el archivo index.html principal para cualquier ruta no reconocida por la API/webhook.
// Asegúrate de tener enlaces correctos a tus otras páginas HTML (como webWhatsapp.html) desde index.html.
app.get('*', (req, res) => {
    // Determina qué archivo HTML servir basado en la ruta solicitada
    const requestedPath = req.path;
    let filePath;

    if (requestedPath === '/webWhatsapp.html') {
        filePath = path.join(__dirname, 'public', 'webWhatsapp.html');
    } else if (requestedPath === '/clientes.html') {
        filePath = path.join(__dirname, 'public', 'clientes.html');
    } else if (requestedPath === '/pedidos.html') {
        filePath = path.join(__dirname, 'public', 'pedidos.html');
    } else if (requestedPath === '/admin.html') {
        filePath = path.join(__dirname, 'public', 'admin.html');
    } else if (requestedPath === '/formulario-cliente.html') {
        filePath = path.join(__dirname, 'public', 'formulario-cliente.html');
    }
    // Añade más 'else if' para otras páginas HTML si las tienes

    else {
        // Por defecto, sirve index.html si no es una ruta específica conocida
        filePath = path.join(__dirname, 'public', 'index.html');
    }

    res.sendFile(filePath, (err) => {
        if (err) {
            // Si el archivo específico no se encuentra (ej. /webWhatsapp.html no existe),
            // intenta servir index.html como fallback para rutas de Single Page Application,
            // o muestra un 404 si index.html tampoco se encuentra.
            if (filePath !== path.join(__dirname, 'public', 'index.html')) {
                res.sendFile(path.join(__dirname, 'public', 'index.html'), (indexErr) => {
                    if (indexErr) {
                        res.status(404).send('Archivo no encontrado');
                    }
                });
            } else {
                res.status(404).send('Archivo no encontrado');
            }
        }
    });
});


// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
