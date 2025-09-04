const { app } = require('./config');
const { router: whatsappRouter } = require('./whatsappHandler');
const apiRouter = require('./apiRoutes');
const path = require('path');

const PORT = process.env.PORT || 3000;

// --- MONTAJE DE RUTAS ---

// El webhook de WhatsApp se mantiene en la raíz para facilitar la configuración en Meta.
app.use('/webhook', whatsappRouter);

// Creamos un router principal para toda la aplicación del CRM.
const crmRouter = express.Router();

// Servimos los archivos estáticos (HTML, CSS, JS del cliente) desde la raíz de este router.
crmRouter.use(express.static(path.join(__dirname, 'public')));

// Montamos las rutas de la API bajo este router. Ahora serán accesibles en /pedidos/api/...
crmRouter.use('/api', apiRouter);

// Ruta "catch-all" para que el frontend (una Single Page Application) maneje el enrutamiento.
// Cualquier ruta bajo /pedidos/ que no sea un archivo estático o una ruta de API, servirá el index.html.
crmRouter.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Montamos todo el router del CRM bajo la ruta /pedidos.
app.use('/pedidos', crmRouter);

// Opcional: Redirigir la raíz a /pedidos para que la URL antigua siga funcionando.
app.get('/', (req, res) => {
    res.redirect('/pedidos');
});


// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
