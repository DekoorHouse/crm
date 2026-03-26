// --- START: UI & VIEW TEMPLATES ---
// Este archivo contiene todas las funciones que generan el HTML para la aplicación.

// --- PLANTILLAS DE VISTAS PRINCIPALES ---

const ChatViewTemplate = () => `
    <div id="chat-view">
        <aside id="contacts-panel" class="w-full md:w-1/3 lg:w-1/4 h-full flex flex-col">
            <div class="p-4 border-b border-gray-200 relative">
                <input type="text" id="search-contacts-input" placeholder="Buscar o iniciar un nuevo chat..." class="w-full pr-8">
                <button id="clear-search-btn" class="absolute right-6 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 hidden">
                    <i class="fas fa-times-circle"></i>
                </button>
            </div>
            <div id="tag-filters-container" class="p-2 flex flex-wrap gap-2 justify-center border-b border-[var(--color-border)] bg-[var(--color-container-bg)] items-center"></div>
            <div id="contacts-loading" class="p-4 text-center text-gray-400">Cargando contactos...</div>
            <div id="contacts-list" class="flex-1 overflow-y-auto"></div>
        </aside>
        <section id="chat-panel" class="flex-1 flex flex-col relative"></section>
        <aside id="contact-details-panel"></aside>
    </div>
`;

const PipelineViewTemplate = () => `
    <div class="view-container !p-0 flex flex-col h-full">
        <div class="view-header !p-4 !mb-0 border-b border-gray-200">
            <h1>Pipeline de Ventas</h1>
        </div>
        <div id="pipeline-container" class="pipeline-container flex-1"></div>
    </div>
`;

const TagsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Etiquetas</h1>
            <div class="flex items-center gap-4">
                <button onclick="openTagModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar</button>
                <button onclick="handleDeleteAllTags()" class="btn btn-danger"><i class="fas fa-trash-alt mr-2"></i>Eliminar Todas</button>
            </div>
        </div>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th class="w-10"></th>
                        <th>Nombre</th>
                        <th>Color</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="tags-table-body"></tbody>
            </table>
        </div>
    </div>
`;

const DepartmentsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Gestión de Departamentos</h1>
            <button onclick="openDepartmentModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Departamento</button>
        </div>
        <p class="mb-6 text-gray-600">Crea departamentos (bandejas de entrada) para organizar tus chats y asignar agentes específicos.</p>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Color</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="departments-table-body"></tbody>
            </table>
        </div>
    </div>
`;

const AdRoutingViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Reglas de Enrutamiento de Ads</h1>
            <button onclick="openAdRoutingModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Regla</button>
        </div>
        <p class="mb-6 text-gray-600">Define a qué departamento deben llegar automáticamente los chats nuevos según el anuncio de origen (Ad ID).</p>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th>Nombre de la Regla</th>
                        <th>Ad IDs</th>
                        <th>Departamento Destino</th>
                        <th>IA Activa</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="ad-routing-table-body"></tbody>
            </table>
        </div>
    </div>
`;

const CampaignsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Crear Campaña (Solo Texto)</h1>
        </div>
        <div class="max-w-2xl">
            <div class="campaign-form-section">
                <label for="campaign-tag-select">1. Enviar a contactos con la etiqueta:</label>
                <select id="campaign-tag-select" onchange="updateCampaignRecipientCount()" class="!mb-2"></select>
                <p id="recipient-count-display">Se enviará a 0 contactos.</p>
            </div>
            <div class="campaign-form-section">
                <label for="campaign-template-select">2. Seleccionar Plantilla de Mensaje:</label>
                <select id="campaign-template-select" class="!mb-2"></select>
            </div>
            <div class="campaign-form-section">
                <button id="send-campaign-btn" onclick="handleSendCampaign()" class="btn btn-primary btn-lg">
                    <i class="fas fa-paper-plane mr-2"></i>
                    Enviar Campaña
                </button>
            </div>
        </div>
    </div>
`;

const CampaignsWithImageViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Crear Campaña con Imagen</h1>
        </div>
        <div class="max-w-2xl">
            <div class="campaign-form-section">
                <label class="font-bold">1. Enviar a (elige una opción):</label>
                <div class="mt-2 p-4 border rounded-lg bg-gray-50">
                    <label for="campaign-image-tag-select" class="text-sm font-semibold">Contactos con la etiqueta:</label>
                    <select id="campaign-image-tag-select" onchange="updateCampaignRecipientCount('image')" class="!mb-2"></select>
                    <p id="recipient-count-display-image">Se enviará a 0 contactos.</p>
                </div>
                <p class="text-center my-3 font-bold text-gray-400">Ó</p>
                <div class="p-4 border rounded-lg bg-gray-50">
                    <label for="campaign-image-phone-input" class="text-sm font-semibold">Un número de teléfono específico:</label>
                    <input type="text" id="campaign-image-phone-input" oninput="updateCampaignRecipientCount('image')" placeholder="Ej: 521..." class="!mb-0">
                </div>
            </div>
            <div class="campaign-form-section">
                <label for="campaign-image-template-select" class="font-bold">2. Seleccionar Plantilla de Mensaje (con cabecera de imagen):</label>
                <select id="campaign-image-template-select" class="!mb-2"></select>
            </div>
            <div class="campaign-form-section">
                <label for="campaign-image-url-input" class="font-bold">3. URL de la Imagen:</label>
                <input type="text" id="campaign-image-url-input" placeholder="https://ejemplo.com/imagen.jpg" class="!mb-2">
            </div>
            <div class="campaign-form-section">
                <button id="send-campaign-image-btn" onclick="handleSendCampaignWithImage()" class="btn btn-primary btn-lg">
                    <i class="fas fa-paper-plane mr-2"></i>
                    Enviar Campaña con Imagen
                </button>
            </div>
        </div>
    </div>
`;

const DifusionViewTemplate = () => `
    <div class="view-container p-4 sm:p-8">
        <style>
            .table-input, .custom-select {
                border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px;
                width: 100%; transition: all 0.2s ease;
            }
            .table-input:focus, .custom-select:focus {
                outline: none; border-color: #81B29A;
                box-shadow: 0 0 0 3px rgba(129, 178, 154, 0.2);
            }
            .table-input.verified { border-color: #81B29A; background-color: #f0fff4; }
            .table-input.error { border-color: #dc3545; background-color: #fff1f2; }
            .photo-cell { display: flex; align-items: center; justify-content: center; width: 120px; height: 80px; }
            .photo-uploader {
                width: 100%; height: 100%; border: 2px dashed #d1d5db; border-radius: 8px;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; transition: all 0.2s ease; position: relative;
            }
            .photo-uploader:hover, .photo-uploader.drag-over { border-color: #81B29A; background-color: #f0fff4; }
            .photo-uploader i { font-size: 1.5rem; color: #9ca3af; }
            .photo-uploader .preview-img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; }
            .photo-uploader .delete-btn {
                position: absolute; top: -8px; right: -8px; background: #dc3545; color: white;
                border-radius: 50%; width: 24px; height: 24px; border: none; cursor: pointer;
                display: none; align-items: center; justify-content: center; z-index: 10;
            }
            .photo-uploader:hover .delete-btn { display: flex; }
            .photo-uploader input[type="file"] { display: none; }
            .status-tag { padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 0.8rem; }
            #quick-reply-dropdown { z-index: 50; max-height: 250px; overflow-y: auto; }
            .message-pill { cursor: grab; transition: all 0.2s ease; }
            .message-pill:active { cursor: grabbing; background-color: #F2CC8F; }
            .message-pill .remove-pill { cursor: pointer; opacity: 0.6; transition: opacity 0.2s; }
            .message-pill .remove-pill:hover { opacity: 1; }
            .sortable-ghost { opacity: 0.4; background: #e0e7ff; }
        </style>
        <div class="max-w-7xl mx-auto bg-white p-6 rounded-xl shadow-lg">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 border-b pb-4">
                <div>
                    <h1 class="text-3xl font-bold text-gray-800" style="font-family: var(--font-heading);">
                        <i class="fas fa-rocket text-indigo-500"></i>
                        Envío Masivo de Fotos
                    </h1>
                    <p class="mt-2 text-gray-500">
                        Añade los pedidos, sube sus fotos y envíalas a todos tus clientes con un solo clic.
                    </p>
                </div>
                <div class="flex items-center gap-4 mt-4 sm:mt-0">
                    <span id="job-counter" class="font-semibold text-gray-600">0 Pedidos en la lista</span>
                    <button id="send-all-btn" class="btn btn-primary text-base" disabled>
                        <i class="fas fa-paper-plane"></i> Enviar Todo
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div id="message-sequence-builder" class="border-b md:border-b-0 md:border-r pr-6 pb-6">
                    <h2 class="text-xl font-semibold text-gray-700 mb-3" style="font-family: var(--font-heading);">
                        <i class="fas fa-stream text-gray-400"></i>
                        Secuencia de Mensajes (&lt; 24h)
                    </h2>
                    <p class="text-sm text-gray-500 mb-4">Se enviará esta secuencia y la foto si el cliente contactó hace menos de 24 horas.</p>
                    <div id="selected-messages-container" class="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg min-h-[50px]"></div>
                    <div id="add-message-controls" class="relative mt-4">
                        <button id="add-message-btn" class="btn btn-subtle">
                            <i class="fas fa-plus"></i> Agregar Mensaje
                        </button>
                        <div id="quick-reply-dropdown" class="absolute hidden mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-xl"></div>
                    </div>
                </div>

                <div id="contingency-plan-builder">
                    <h2 class="text-xl font-semibold text-gray-700 mb-3" style="font-family: var(--font-heading);">
                        <i class="fas fa-history text-gray-400"></i>
                        Plan de Contingencia (&gt; 24h)
                    </h2>
                    <p class="text-sm text-gray-500 mb-4">Si el cliente contactó hace MÁS de 24h, se enviará esta plantilla. Al responder, recibirá la secuencia normal.</p>
                    <div>
                        <label for="contingency-template-select" class="font-semibold text-sm mb-2 block">Plantilla de Reactivación</label>
                        <select id="contingency-template-select" class="custom-select">
                            <option value="">-- Seleccionar plantilla --</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="overflow-x-auto border-t pt-6">
            <div class="table-responsive-wrapper">
                <table class="table w-full">
                    <thead>
                        <tr class="bg-gray-50">
                            <th class="w-12 text-center">#</th>
                            <th class="w-48">No. Pedido o Teléfono</th>
                            <th>Cliente</th>
                            <th class="text-center">Foto del Pedido</th>
                            <th>Estatus</th>
                            <th class="w-16"></th>
                        </tr>
                    </thead>
                    <tbody id="bulk-table-body">
                        <tr id="empty-state-row">
                            <td colspan="6" class="text-center text-gray-400 py-12">
                                <i class="fas fa-images text-4xl mb-4"></i>
                                <p class="font-semibold">Aún no hay pedidos en la lista.</p>
                                <p>Usa el botón "Agregar Fila" para empezar.</p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            </div>

            <div class="mt-6 flex justify-start">
                <button id="add-row-btn" class="btn btn-subtle">
                    <i class="fas fa-plus-circle"></i> Agregar Fila
                </button>
            </div>
        </div>
    </div>
`;

const MensajesAdsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Mensajes de Bienvenida por Anuncio</h1>
            <button onclick="openAdResponseModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Mensaje</button>
        </div>
        <p class="mb-6 text-gray-600">Configura respuestas automáticas para los clientes que llegan desde un anuncio de Facebook o Instagram. El sistema identificará el anuncio y enviará el mensaje correspondiente.</p>
        <table class="table">
            <thead>
                <tr>
                    <th>Nombre del Anuncio</th>
                    <th>IDs del Anuncio</th>
                    <th>Mensaje</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody id="ad-responses-table-body"></tbody>
        </table>
    </div>
`;



const ContactsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Contactos</h1>
             <div class="flex items-center gap-4">
                <button onclick="openEditContactModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Contacto</button>
            </div>
        </div>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>WhatsApp</th>
                        <th>Correo Electrónico</th>
                        <th>Etiquetas</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="contacts-table-body"></tbody>
            </table>
        </div>
    </div>
`;

const QuickRepliesViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Respuestas Rápidas</h1>
            <button onclick="openQuickReplyModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Respuesta</button>
        </div>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th>Atajo</th>
                        <th>Mensaje</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="quick-replies-table-body"></tbody>
            </table>
        </div>
    </div>
`;



const SettingsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Ajustes Generales</h1>
        </div>
        <div class="max-w-2xl space-y-8">
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Automatización</h2>
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="font-semibold">Mensaje de Ausencia</h3>
                        <p class="text-sm text-gray-500">Enviar una respuesta automática fuera del horario de atención.</p>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="away-message-toggle" onchange="handleAwayMessageToggle(this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Integraciones</h2>
                <div>
                    <label for="google-sheet-id-input" class="font-semibold">ID de Google Sheet para Cobertura</label>
                    <p class="text-sm text-gray-500 mb-3">Pega aquí el ID de tu hoja de cálculo con los códigos postales.</p>
                    <div class="flex items-center gap-3">
                        <input type="text" id="google-sheet-id-input" class="!mb-0" placeholder="Ej: 1aBcDeFgHiJkLmNoPqRsTuVwXyZ_1234567890">
                        <button id="save-google-sheet-id-btn" class="btn btn-primary flex-shrink-0">Guardar</button>
                    </div>
                </div>
            </div>
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Herramientas de Prueba</h2>
                <form id="simulate-ad-form">
                    <div>
                        <label class="font-semibold">Simular Mensaje de Anuncio</label>
                        <p class="text-sm text-gray-500 mb-3">Prueba cómo responde el sistema a un nuevo mensaje de un anuncio. Usa un número de 12 o 13 dígitos (código de país + número).</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                            <div>
                                <label for="sim-phone-number" class="text-xs font-bold">Número de Teléfono (Ej: 521618...)</label>
                                <input type="text" id="sim-phone-number" class="!mb-0" placeholder="521..." required>
                            </div>
                            <div>
                                <label for="sim-ad-id" class="text-xs font-bold">ID del Anuncio</label>
                                <input type="text" id="sim-ad-id" class="!mb-0" placeholder="120..." required>
                            </div>
                        </div>
                         <div>
                            <label for="sim-message-text" class="text-xs font-bold">Texto del Mensaje</label>
                            <input type="text" id="sim-message-text" class="!mb-0" value="Hola, quiero más información." required>
                        </div>
                        <button id="simulate-ad-btn" type="submit" class="btn btn-secondary mt-4">
                            <i class="fas fa-paper-plane mr-2"></i> Enviar Simulación
                        </button>
                    </div>
                </form>
            </div>
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Mantenimiento</h2>
                <div>
                    <p class="text-sm text-gray-500 mb-3">Asigna todos los chats que actualmente no tienen un departamento al departamento por defecto "General".</p>
                    <button onclick="handleMigrateOrphans()" class="btn btn-secondary">
                        <i class="fas fa-random mr-2"></i> Migrar Chats Huérfanos a General
                    </button>
                </div>
            </div>
        </div>
    </div>
`;

const AITrainingViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1><i class="fas fa-brain mr-2"></i>Entrenamiento de IA</h1>
        </div>
        <div class="max-w-3xl space-y-8">
            <!-- Sección: Instrucciones del Bot -->
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-2">🧠 Instrucciones del Bot</h2>
                <p class="text-sm text-gray-500 mb-4">Define la personalidad, tono y reglas generales de la IA. Este texto se envía como contexto en cada conversación.</p>
                <textarea id="ai-bot-instructions" rows="8" class="w-full p-3 border border-gray-300 rounded-lg text-sm" placeholder="Ej: Eres el asistente virtual de Mi Empresa. Responde siempre en español, de forma amigable y profesional...">${state.aiBotInstructions || ''}</textarea>
                <div class="flex justify-end mt-3">
                    <button id="save-bot-instructions-btn" class="btn btn-primary">
                        <i class="fas fa-save mr-2"></i>Guardar Instrucciones
                    </button>
                </div>
            </div>

            <!-- Sección: Base de Conocimiento -->
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-2">📚 Base de Conocimiento</h2>
                <p class="text-sm text-gray-500 mb-4">Agrega preguntas frecuentes. La IA usará esta información para responder a tus clientes con precisión.</p>
                <div class="flex justify-end mb-4">
                    <button onclick="openKnowledgeModal()" class="btn btn-primary">
                        <i class="fas fa-plus mr-2"></i>Agregar Conocimiento
                    </button>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Tema</th>
                            <th>Respuesta</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="knowledge-base-table-body"></tbody>
                </table>
            </div>

            <!-- Sección: Uso de Tokens -->
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-2">📊 Uso y Costos de IA</h2>
                <p class="text-sm text-gray-500 mb-4">Monitorea el consumo de tokens y el costo estimado de la IA. Precios basados en Gemini Flash.</p>
                
                <!-- Stats de Hoy -->
                <div class="mb-6">
                    <h3 class="font-semibold text-lg mb-3">📅 Hoy</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div class="bg-blue-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Peticiones</p>
                            <p id="usage-today-requests" class="text-2xl font-bold text-blue-600">-</p>
                        </div>
                        <div class="bg-green-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Tokens Entrada</p>
                            <p id="usage-today-input" class="text-2xl font-bold text-green-600">-</p>
                        </div>
                        <div class="bg-purple-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Tokens Salida</p>
                            <p id="usage-today-output" class="text-2xl font-bold text-purple-600">-</p>
                        </div>
                        <div class="bg-amber-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Costo Estimado</p>
                            <p id="usage-today-cost" class="text-2xl font-bold text-amber-600">-</p>
                        </div>
                    </div>
                </div>

                <!-- Stats del Mes -->
                <div>
                    <h3 class="font-semibold text-lg mb-3">📆 Este Mes</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div class="bg-blue-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Peticiones</p>
                            <p id="usage-month-requests" class="text-2xl font-bold text-blue-600">-</p>
                        </div>
                        <div class="bg-green-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Tokens Entrada</p>
                            <p id="usage-month-input" class="text-2xl font-bold text-green-600">-</p>
                        </div>
                        <div class="bg-purple-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Tokens Salida</p>
                            <p id="usage-month-output" class="text-2xl font-bold text-purple-600">-</p>
                        </div>
                        <div class="bg-amber-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Costo Estimado</p>
                            <p id="usage-month-cost" class="text-2xl font-bold text-amber-600">-</p>
                        </div>
                    </div>
                </div>

                <p class="text-xs text-gray-400 mt-4 text-right">* Costos estimados: $0.10 USD / 1M tokens entrada, $0.40 USD / 1M tokens salida (Gemini Flash)</p>
            </div>
        </div>
    </div>
`;


const AIChatSimulatorViewTemplate = () => `
    <div class="view-container flex flex-col h-full bg-gray-50">
        <div class="view-header flex-none bg-white p-4 border-b">
            <h1><i class="fas fa-robot text-purple-500 mr-2"></i> Simulador de Inteligencia Artificial</h1>
            <p class="text-sm text-gray-500 mt-1">Prueba la personalidad y respuestas de tu IA sin afectar contactos reales ni pagar costos de envío en WhatsApp.</p>
        </div>
        
        <div class="flex-1 flex flex-col max-w-4xl mx-auto w-full p-4 overflow-hidden">
            <!-- Simulación de Pantalla de WhatsApp -->
            <div class="flex-1 bg-[#efeae2] rounded-t-xl border border-gray-300 shadow-inner flex flex-col relative overflow-hidden" style="background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png');">
                <!-- Chat Header -->
                <div class="bg-[#075e54] text-white p-3 flex items-center gap-3 z-10 shadow-md">
                    <div class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#075e54]">
                        <i class="fas fa-robot text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-bold">Asistente IA (Pruebas)</h3>
                        <p class="text-xs text-white/80">en línea</p>
                    </div>
                    <button class="ml-auto hover:bg-white/20 p-2 rounded-full transition-colors" onclick="clearSimulatorChat()">
                        <i class="fas fa-trash-alt"></i> Limpiar Chat
                    </button>
                </div>
                
                <!-- Chat History -->
                <div id="simulator-chat-history" class="flex-1 overflow-y-auto p-4 space-y-3" 
                     ondragover="event.preventDefault(); this.classList.add('bg-[#dcf8c6]', 'bg-opacity-50')" 
                     ondragleave="event.preventDefault(); this.classList.remove('bg-[#dcf8c6]', 'bg-opacity-50')" 
                     ondrop="handleSimulatorDrop(event); this.classList.remove('bg-[#dcf8c6]', 'bg-opacity-50')">
                    <div class="text-center my-4">
                        <span class="bg-[#e1f3fb] text-[#1f2937] text-xs px-3 py-1 rounded-lg inline-block shadow-sm">
                            <i class="fas fa-lock mr-1"></i> Los mensajes y llamadas están cifrados de extremo a extremo.
                        </span>
                    </div>
                    <!-- Messages will appear here -->
                </div>
                
                <div id="simulator-typing-indicator" class="hidden absolute bottom-2 left-4 bg-white px-4 py-2 rounded-xl rounded-bl-sm shadow-md flex items-center gap-2 z-10 w-fit">
                    <div class="flex items-center gap-1">
                        <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                        <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                        <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                    </div>
                    <span id="simulator-timer-text" class="text-xs text-gray-500 ml-2">Esperando (20s)</span>
                    <button onclick="skipSimulatorTimer()" class="ml-2 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-0.5 rounded transition-colors" title="Responder ahora">
                        <i class="fas fa-forward"></i>
                    </button>
                </div>
            </div>

            <!-- Chat Input -->
            <div id="simulator-token-bar" class="bg-gradient-to-r from-purple-50 to-blue-50 px-4 py-1.5 border border-t-0 border-gray-300 flex items-center justify-between text-xs text-gray-500 font-mono">
                <div class="flex items-center gap-3">
                    <span><i class="fas fa-arrow-up text-orange-400"></i> Nuevos: <b id="simulator-input-tokens" class="text-gray-700">0</b></span>
                    <span><i class="fas fa-database text-purple-400"></i> Cacheados: <b id="simulator-cached-tokens" class="text-purple-600">0</b></span>
                    <span><i class="fas fa-arrow-down text-green-400"></i> Salida: <b id="simulator-output-tokens" class="text-gray-700">0</b></span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-gray-400"><i class="fas fa-coins"></i> Total: <b id="simulator-total-tokens" class="text-gray-600">0</b></span>
                    <span class="text-green-600 font-semibold"><i class="fas fa-dollar-sign"></i> Costo: <b id="simulator-cost">$0.000000</b></span>
                </div>
            </div>
            <div class="bg-[#f0f0f0] p-3 rounded-b-xl border border-t-0 border-gray-300 flex flex-col gap-2 shadow-md">
                <div class="flex items-center gap-2 pl-2">
                    <label class="text-xs font-bold text-gray-500">Enviar como:</label>
                    <select id="simulator-role-select" class="text-xs border border-gray-300 rounded p-1 bg-white text-gray-700 outline-none cursor-pointer hover:border-gray-400 focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884]">
                        <option value="user">Cliente</option>
                        <option value="assistant">Agente de Dekoor</option>
                    </select>
                </div>
                <div class="flex items-end gap-2">
                    <input type="file" id="simulator-media-upload" accept="image/*, audio/*" class="hidden" onchange="handleSimulatorMediaUpload(event)">
                    <button class="text-gray-500 hover:text-gray-700 p-2" onclick="document.getElementById('simulator-media-upload').click()"><i class="fas fa-paperclip text-xl"></i></button>
                    <button class="text-gray-500 hover:text-gray-700 p-2"><i class="far fa-smile text-xl"></i></button>
                    <div class="flex-1 bg-white rounded-lg px-2 py-2 shadow-sm flex flex-col justify-center min-h-[44px]">
                        <div id="simulator-media-preview-container" class="hidden mb-2 relative inline-block w-fit">
                            <img id="simulator-image-preview" src="" class="hidden h-16 rounded border object-cover">
                            <audio id="simulator-audio-preview" controls class="hidden h-10 w-48 rounded"></audio>
                            <button onclick="removeSimulatorMedia()" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 shadow">&times;</button>
                        </div>
                        <textarea id="simulator-chat-input" class="w-full bg-transparent focus:outline-none resize-none max-h-32 text-[15px] px-2" rows="1" placeholder="Escribe un mensaje..." onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendSimulatorMessage(); }"></textarea>
                    </div>
                    <button id="simulator-send-btn" onclick="sendSimulatorMessage()" class="bg-[#00a884] text-white w-11 h-11 rounded-full flex items-center justify-center hover:bg-[#008f6f] transition-colors shadow-sm flex-shrink-0">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>
    </div>
`;


const MetricsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Métricas de Mensajes</h1>
        </div>
        <div id="metrics-loading" class="text-center p-8">
            <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
            <p class="mt-4 text-gray-600">Cargando datos generales...</p>
        </div>
        <div id="metrics-content" class="hidden">
            <div class="metrics-grid mb-8">
                <div class="chart-container">
                    <h2>Mensajes Recibidos por Día (Últimos 30 días)</h2>
                    <canvas id="daily-messages-chart"></canvas>
                </div>
                <div class="chart-container">
                    <h2>Distribución de Mensajes por Etiqueta (Últimos 30 días)</h2>
                    <canvas id="tags-distribution-chart"></canvas>
                </div>
            </div>

            <div class="settings-card mt-8">
                <h2 class="text-xl font-bold mb-4">Mensajes Entrantes por Anuncio</h2>
                <p class="text-sm text-gray-500 mb-4">Selecciona un rango de fechas para ver cuántos mensajes iniciales provinieron de cada Ad ID.</p>
                <div class="flex flex-wrap items-end gap-4 mb-4">
                    <div>
                        <label for="ad-metrics-date-range" class="font-semibold text-xs">Rango de Fechas:</label>
                        <input type="text" id="ad-metrics-date-range" placeholder="Seleccionar rango..." readonly class="!mb-0 cursor-pointer">
                    </div>
                    <button id="load-ad-metrics-btn" class="btn btn-primary btn-sm"><i class="fas fa-sync-alt mr-2"></i>Cargar Datos</button>
                    <button id="clear-ad-metrics-filter-btn" class="btn btn-subtle btn-sm"><i class="fas fa-times mr-2"></i>Limpiar</button>
                </div>
                <div id="ad-metrics-results-container">
                    <div id="ad-metrics-loading" class="text-center text-gray-500 py-4 hidden">
                        <i class="fas fa-spinner fa-spin mr-2"></i> Cargando métricas de anuncios...
                    </div>
                    <div id="ad-metrics-no-data" class="text-center text-gray-500 py-4 hidden">
                        No se encontraron mensajes de anuncios para el período seleccionado.
                    </div>
                    <div id="ad-metrics-table-container" class="mt-4 hidden">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>ID del Anuncio (Ad ID)</th>
                                    <th>Número de Mensajes Recibidos</th>
                                </tr>
                            </thead>
                            <tbody id="ad-metrics-table-body">
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>
`;

// --- PLANTILLAS DE COMPONENTES ---

const UserIcon = (contact, size = 'h-9 w-9') => {
    // Corona zafiro — pedido confirmado (Fabricar)
    if (contact && contact.purchaseStatus === 'completed') {
         return `<div class="${size} rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold relative sapphire-crown" style="background: linear-gradient(135deg, #0F52BA, #1E90FF); box-shadow: 0 2px 6px rgba(15,82,186,0.45);">
                <i class="fas fa-crown text-sm" style="filter: drop-shadow(0 0 3px rgba(0,212,255,0.5));"></i>
                <span class="gem-badge gem-filled" style="position:absolute;bottom:-1px;right:-1px;width:13px;height:13px;border-radius:50%;background:radial-gradient(circle at 35% 35%, #00D4FF, #0F52BA);border:1.5px solid rgba(255,255,255,0.8);box-shadow:0 0 6px rgba(0,212,255,0.7);"></span>
            </div>`;
    }

    // Corona plateada — pedido registrado, falta confirmar (hueco de gema)
    if (contact && contact.purchaseStatus === 'registered') {
         return `<div class="${size} rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold relative silver-crown" style="background: linear-gradient(135deg, #C0C0C0, #8C8C8C); box-shadow: 0 2px 4px rgba(0,0,0,0.18);">
                <i class="fas fa-crown text-sm" style="opacity:0.9;"></i>
                <span class="gem-badge gem-socket" style="position:absolute;bottom:-1px;right:-1px;width:13px;height:13px;border-radius:50%;background:rgba(0,0,0,0.25);border:1.5px dashed rgba(255,255,255,0.45);box-shadow:inset 0 1px 3px rgba(0,0,0,0.4);"></span>
            </div>`;
    }

    if (contact && contact.profileImageUrl) {
        return `<img src="${contact.profileImageUrl}" alt="${contact.name}" class="${size} rounded-full object-cover">`;
    }

    const contactStatusKey = contact.status;
    const tag = state.tags.find(t => t.key === contactStatusKey);
    const bgColor = tag ? tag.color : '#d1d5db';
    const initial = contact.name ? contact.name.charAt(0).toUpperCase() : '?';

    return `<div class="${size} rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold" style="background-color: ${bgColor};">
                ${initial}
            </div>`;
};

const ContactItemTemplate = (contact, isSelected) => {
    const typingText = contact.lastMessage || 'Sin mensajes.';

    let timeHTML = '';
    if (contact.lastMessageTimestamp) {
        const date = contact.lastMessageTimestamp;
        const timeString = isSameDay(new Date(), date)
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
        timeHTML = `<span class="contact-time-label">${timeString}</span>`;
    }

    const unreadBadgeHTML = contact.unreadCount > 0
        ? `<span class="unread-badge">${contact.unreadCount}</span>`
        : '';

    const timeOrBadgeHTML = timeHTML + unreadBadgeHTML;

    const orderBadgeHTML = contact.lastOrderNumber
        ? `<span class="order-badge">DH${contact.lastOrderNumber}</span>`
        : '';
    
    const defaultColor = '#d1d5db';
    let color = defaultColor;
    if (contact.assignedDepartmentId) {
        const department = state.departments.find(d => d.id === contact.assignedDepartmentId);
        if (department) {
            color = department.color;
        }
    }
    const departmentStripe = `style="border-left-color: ${color};"`;

    const mainContent = `
        <div class="flex-grow overflow-hidden ml-2">
            <div class="flex justify-between items-center">
                <h3 class="font-semibold text-sm truncate">
                    <i class="${contact.channel === 'messenger' ? 'fab fa-facebook-messenger text-blue-500' : 'fab fa-whatsapp text-green-500'} mr-1 text-[10px]"></i>
                    ${contact.name || 'Desconocido'}
                    ${contact.botActive ? '<i class="fas fa-robot text-green-500 ml-1 text-[10px]" title="IA Activa"></i>' : ''}
                </h3>
                <div class="contact-meta">
                     ${timeOrBadgeHTML}
                     <button type="button" class="preview-icon" onclick="event.stopPropagation(); openConversationPreview(event, '${contact.id}')" title="Ver conversación">
                        <i class="fas fa-eye"></i>
                     </button>
                     <button type="button" class="preview-icon" onclick="event.stopPropagation(); handleMarkAsUnread(event, '${contact.id}')" title="Marcar como no leído">
                        <i class="fas fa-envelope"></i>
                     </button>
                </div>
            </div>
            <div class="flex justify-between items-center">
                <p class="text-xs truncate pr-2 text-gray-500">${typingText}</p>
                ${orderBadgeHTML}
            </div>
        </div>`;

    const onClickAction = `onclick="handleSelectContact('${contact.id}')"`;
    const aiActive = contact.botActive === true;
    const aiClass = aiActive ? 'ai-active' : '';

    return `<div ${onClickAction} class="contact-item flex items-center p-1.5 cursor-pointer ${isSelected ? 'selected' : ''} ${aiClass}" data-contact-id="${contact.id}" ${departmentStripe}>
                ${UserIcon(contact)}
                ${mainContent}
            </div>`;
};

const MessageStatusIconTemplate = (status) => {
    const sentColor = '#9ca3af';
    const readColor = '#53bdeb';
    switch (status) {
        case 'pending': return `<i class="far fa-clock message-status-icon" style="color: ${sentColor};"></i>`;
        case 'queued': return `<i class="far fa-clock message-status-icon" style="color: #60a5fa;"></i>`;
        case 'read': return `<i class="fas fa-check-double" style="color: ${readColor};"></i>`;
        case 'delivered': return `<i class="fas fa-check-double" style="color: ${sentColor};"></i>`;
        case 'sent': return `<i class="fas fa-check" style="color: ${sentColor};"></i>`;
        default: return '';
    }
};

const RepliedMessagePreviewTemplate = (originalMessage) => {
    if (!originalMessage) return '';

    const authorName = originalMessage.from === state.selectedContactId
        ? state.contacts.find(c => c.id === state.selectedContactId)?.name || 'Cliente'
        : 'Tú';

    let textPreview = '';
    if ((originalMessage.type === 'image' || originalMessage.fileType?.startsWith('image/')) && originalMessage.fileUrl) {
        const caption = originalMessage.text && originalMessage.text !== '📷 Imagen' ? originalMessage.text : '';
        let captionHtml = caption ? `<div class="reply-media-text"><p class="reply-media-caption">${caption}</p></div>` : '';
        textPreview = `<div class="reply-media-preview"><img src="${originalMessage.fileUrl}" alt="Miniatura de respuesta" class="reply-thumbnail">${captionHtml}</div>`;
    } else {
        let plainText = originalMessage.text || 'Mensaje';
        if (originalMessage.type === 'audio') plainText = '🎤 Mensaje de voz';
        else if (originalMessage.type === 'video' || originalMessage.fileType?.startsWith('video/')) plainText = '🎥 Video';
        else if (originalMessage.type === 'location') plainText = '📍 Ubicación';
        else if (originalMessage.fileType) plainText = '📄 Documento';
        textPreview = `<p class="reply-text">${plainText}</p>`;
    }

    return `<div class="reply-preview"><p class="reply-author">${authorName}</p>${textPreview}</div>`;
};

const MessageBubbleTemplate = (message) => {
    const isSent = message.from !== state.selectedContactId;
    const time = message.timestamp && typeof message.timestamp.seconds === 'number'
        ? new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

    let contentHTML = '';
    let bubbleExtraClass = '';
    let timeAndStatusHTML = `<div class="text-xs text-right mt-1 opacity-70 flex justify-end items-center space-x-2"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status) : ''}</div>`;

    const defaultTexts = ['📷 Imagen', '🎥 Video', '🎵 Audio', '📄 Documento', 'Sticker'];
    
    const hasText = message.text && 
                    !defaultTexts.includes(message.text) && 
                    !/^(🎤|🎵|📷|🎥|📄|Sticker)/.test(message.text);

    if (message.fileUrl && message.fileType) {
        if (message.fileType.startsWith('image/')) {
            bubbleExtraClass = 'has-image';
            const bubbleBgColor = isSent ? 'var(--color-bubble-sent-bg)' : 'var(--color-bubble-received-bg)';
            const fullImageUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`;
            contentHTML += `<div style="background-color: ${bubbleBgColor}" class="rounded-lg overflow-hidden"><img src="${fullImageUrl}" alt="Imagen enviada" class="chat-image-preview" onclick="openImageModal('${fullImageUrl}')">${hasText ? `<div class="p-2 pt-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>` : ''}<div class="time-overlay"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status) : ''}</div></div>`;
            timeAndStatusHTML = '';
        } else if (message.fileType.startsWith('video/')) {
            bubbleExtraClass = 'has-video';
            const separator = message.fileUrl.includes('?') ? '&' : '?';
            const videoUrl = message.timestamp ? `${message.fileUrl}${separator}v=${message.timestamp.seconds}` : message.fileUrl;
            const fullVideoUrl = videoUrl.startsWith('http') ? videoUrl : `${API_BASE_URL}${videoUrl}`;
            contentHTML += `<video controls playsinline preload="metadata" class="video rounded-lg mb-1" src="${fullVideoUrl}" onclick="event.stopPropagation()">Tu navegador no soporta videos.</video>`;
            if(hasText) contentHTML += `<div class="px-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
        } else if (message.fileType.startsWith('audio/')) {
             const audioSrc = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`;
             contentHTML += `<audio controls preload="metadata" class="chat-audio-player"><source src="${audioSrc}" type="${message.fileType}">Tu navegador no soporta audio.</audio>`;
        } else if (message.type === 'document' || message.fileType.startsWith('application/')) {
            const fullDocUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`;
            contentHTML += `<a href="${fullDocUrl}" target="_blank" rel="noopener noreferrer" class="document-link"><i class="fas fa-file-alt document-icon"></i><span class="document-text">${message.document?.filename || message.text || 'Ver Documento'}</span></a>`;
        } else if (message.type === 'sticker') {
            const fullStickerUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`;
            contentHTML += `<img src="${fullStickerUrl}" alt="Sticker" class="chat-sticker-preview">`;
        }
    } else if (message.type === 'location' && message.location) {
        const { latitude, longitude, name, address } = message.location;
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
        contentHTML += `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="block text-blue-600 hover:underline"><div class="font-semibold"><i class="fas fa-map-marker-alt mr-2 text-red-500"></i>${name || 'Ubicación'}</div>${address ? `<p class="text-xs text-gray-500 mt-1">${address}</p>` : ''}<p class="text-xs mt-1">Toca para ver en el mapa</p></a>`;
    } else if (message.type === 'sticker') {
        contentHTML += `<div class="sticker-fallback"><i class="far fa-sticky-note"></i><span>Sticker</span></div>`;
    } else if (message.text) {
         contentHTML += `<div><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
    }

    let replyPreviewHTML = '';
    if (message.context && message.context.id) {
        const originalMessage = state.messages.find(m => m.id === message.context.id);
        replyPreviewHTML = RepliedMessagePreviewTemplate(originalMessage);
    }

    const copyButtonHTML = message.text ? `<button class="message-action-btn" onclick="copyFormattedText('${message.text.replace(/'/g, '\\\'')}', this)" title="Copiar"><i class="far fa-copy"></i></button>` : '';

    const actionsHTML = `
        <div class="message-actions">
             <div class="reaction-bar">
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '👍')">👍</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '❤️')">❤️</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '😂')">😂</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '😢')">😢</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '🙏')">🙏</button>
             </div>
             <button class="message-action-btn" onclick="handleStartReply(event, '${message.docId}')" title="Responder"><i class="fas fa-reply"></i></button>
             ${copyButtonHTML}
        </div>
    `;

    const reactionHTML = message.reaction ? `<div class="reactions-container ${isSent ? '' : 'received-reaction'}">${message.reaction}</div>` : '';

    const bubbleAlignment = isSent ? 'sent' : 'received';
    let bubbleClasses = isSent ? 'sent' : 'received';
    if (message.status === 'queued') bubbleClasses += ' message-queued';

    return `
        <div class="message-group ${bubbleAlignment}" data-doc-id="${message.docId}">
            <div class="message-bubble ${bubbleClasses} ${bubbleExtraClass}">
                ${replyPreviewHTML}
                ${contentHTML}
                ${timeAndStatusHTML}
                ${reactionHTML}
                ${actionsHTML}
            </div>
        </div>`;
};

const NoteItemTemplate = (note) => {
    const time = note.timestamp ? new Date(note.timestamp.seconds * 1000).toLocaleString('es-ES') : 'Fecha desconocida';
    const isEditing = state.isEditingNote === note.id;

    return isEditing
        ? `<div class="note-item">
             <textarea id="edit-note-input-${note.id}" class="!mb-2" rows="3">${note.text}</textarea>
             <div class="flex justify-end gap-2">
               <button class="btn btn-subtle btn-sm" onclick="toggleEditNote(null)">Cancelar</button>
               <button class="btn btn-primary btn-sm" onclick="handleUpdateNote('${note.id}')">Guardar</button>
             </div>
           </div>`
        : `<div class="note-item">
             <p>${note.text}</p>
             <div class="note-meta">
               <span>${time}</span>
               <div class="note-actions">
                 <button onclick="toggleEditNote('${note.id}')" title="Editar nota"><i class="fas fa-pencil-alt"></i></button>
                 <button onclick="handleDeleteNote('${note.id}')" title="Eliminar nota"><i class="fas fa-trash-alt"></i></button>
               </div>
             </div>
           </div>`;
};

const LocalFilePreviewTemplate = (files) => {
    if (!Array.isArray(files)) files = [files];
    const items = files.map((file, index) => {
        const objectURL = URL.createObjectURL(file);
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        const isAudio = file.type.startsWith('audio/');
        const sizeMB = file.size / (1024 * 1024);
        const sizeText = sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${(file.size / 1024).toFixed(0)} KB`;
        const shortName = file.name.length > 18 ? file.name.substring(0, 15) + '...' : file.name;
        let thumb;
        if (isImage) {
            thumb = `<img src="${objectURL}" alt="Vista previa" class="file-thumb">`;
        } else if (isVideo) {
            thumb = `<div class="file-thumb file-thumb-icon video"><i class="fas fa-play"></i></div>`;
        } else if (isAudio) {
            thumb = `<div class="file-thumb file-thumb-icon audio"><i class="fas fa-music"></i></div>`;
        } else {
            thumb = `<div class="file-thumb file-thumb-icon doc"><i class="fas fa-file-alt"></i></div>`;
        }
        return `<div class="file-preview-item">
            <button type="button" class="file-remove-btn" onclick="removeStagedFile(${index})" title="Quitar"><i class="fas fa-times"></i></button>
            ${thumb}
            <div class="file-preview-info">
                <span class="file-preview-name">${shortName}</span>
                <span class="file-preview-size">${sizeText}</span>
            </div>
        </div>`;
    }).join('');
    return `<div class="file-preview-grid">${items}</div>`;
};

const RemoteFilePreviewTemplate = (file) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    let previewElement;
    if (isImage) {
        previewElement = `<img src="${file.url}" alt="Vista previa">`;
    } else if (isVideo) {
        previewElement = `<video src="${file.url}" alt="Vista previa"></video>`;
    } else if (isAudio) {
        previewElement = `<div class="p-3"><i class="fas fa-music text-2xl text-gray-500"></i></div>`;
    } else {
        previewElement = `<div class="p-3"><i class="fas fa-file text-2xl text-gray-500"></i></div>`;
    }
    return ` <div class="file-preview-content"> <div id="cancel-file-btn" onclick="cancelStagedFile()"><i class="fas fa-times"></i></div> ${previewElement} <div class="ml-3 text-sm text-gray-600 truncate"> <p class="font-semibold">${file.name || 'Archivo adjunto'}</p></div> </div>`;
};

const StatusButtonsTemplate = (contact) => {
    let buttonsHtml = '<div class="status-btn-group">';

    // Botón especial para Pendientes IA (siempre visible)
    const isIAActive = contact.status === 'pendientes_ia';
    buttonsHtml += `<button
                        onclick="handleStatusChange('${contact.id}', 'pendientes_ia')"
                        class="status-btn ${isIAActive ? 'active' : ''}"
                        style="--btn-color: #8b5cf6;"
                        title="Marcar como Pendiente de Revisión IA"
                    >
                        <i class="fas fa-robot text-[10px] mr-1"></i> Pendientes IA
                    </button>`;

    // Verificar si algún tag del dropdown está activo
    const activeTag = state.tags.find(t => t.key === contact.status);
    const dropdownLabel = activeTag ? activeTag.label : '<i class="fas fa-ellipsis-h"></i>';

    // Dropdown con los demás tags
    let dropdownItems = '';
    state.tags.forEach(tag => {
        const isActive = contact.status === tag.key;
        dropdownItems += `<button
                            onclick="handleStatusChange('${contact.id}', '${tag.key}'); closeStatusDropdown();"
                            class="status-dropdown-item ${isActive ? 'active' : ''}"
                            style="--btn-color: ${tag.color};"
                        >
                            <span class="status-dropdown-dot" style="background-color: ${tag.color};"></span>
                            ${tag.label}
                        </button>`;
    });

    buttonsHtml += `<div class="status-dropdown-wrapper">
        <button class="status-btn status-dropdown-toggle ${activeTag ? 'active' : ''}"
                style="--btn-color: ${activeTag ? activeTag.color : '#6b7280'};"
                onclick="toggleStatusDropdown(event)">
            ${dropdownLabel}
        </button>
        <div class="status-dropdown-menu hidden">
            ${dropdownItems}
        </div>
    </div>`;

    buttonsHtml += '</div>';
    return buttonsHtml;
};

const ReplyContextBarTemplate = (message) => {
    if (!message) return '';
    const authorName = message.from === state.selectedContactId ? state.contacts.find(c => c.id === state.selectedContactId)?.name || 'Cliente' : 'Tú';
    const textPreview = message.text || (message.fileType ? `📷 Archivo` : '');
    return `
        <button id="cancel-reply-btn" onclick="cancelReply()"><i class="fas fa-times"></i></button>
        <div class="reply-preview !p-0 !border-l-2 !m-0">
            <p class="reply-author">Respondiendo a ${authorName}</p>
            <p class="reply-text">${textPreview}</p>
        </div>
    `;
};

const AdReferralBannerTemplate = (adReferral) => {
    if (!adReferral || !adReferral.source_id) return '';
    
    // Diferenciar entre anuncio (ad) y publicación (post)
    const isPost = adReferral.source_type === 'post';
    const icon = isPost ? 'fa-share-square' : 'fa-bullhorn';
    const typeLabel = isPost ? 'Publicación' : 'Anuncio';
    
    // Extraer título/nombre interno o fallback
    const title = adReferral.ad_name || adReferral.headline || adReferral.body || `ID: ${adReferral.source_id}`;
    const url = adReferral.source_url || '#';
    
    return `
        <div class="ad-referral-banner">
            <div class="ad-referral-icon">
                <i class="fas ${icon}"></i>
            </div>
            <div class="ad-referral-content">
                <p class="ad-referral-label">Origen: Meta ${typeLabel}</p>
                <p class="ad-referral-title">${title}</p>
            </div>
            ${adReferral.source_url ? `
            <a href="${url}" target="_blank" class="ad-referral-link" title="Ver anuncio original">
                <i class="fas fa-external-link-alt"></i>
            </a>` : ''}
        </div>
    `;
};

const ChatWindowTemplate = (contact) => {
    const emptyChat = `<div class="flex-1 flex flex-col items-center justify-center text-gray-500 bg-opacity-50 bg-white"><i class="fas fa-comments text-8xl mb-4 text-gray-300"></i><h2 class="text-xl font-semibold">Selecciona un chat para empezar</h2><p>Mantén tu CRM conectado y organizado.</p></div>`;
    if (!contact) { return emptyChat; }

    // --- Department Color Logic for Header ---
    let headerStyle = '';
    if (contact.assignedDepartmentId) {
        const department = state.departments.find(d => d.id === contact.assignedDepartmentId);
        if (department && department.color) {
            // Using a top border for the header
            headerStyle = `style="border-top: 4px solid ${department.color};"`;
        }
    }
    // --- End Department Color Logic for Header ---

    const isSessionExpired = state.isSessionExpired;

    const sessionExpiredNotification = isSessionExpired
        ? `<div class="session-expired-banner">
             <i class="fas fa-lock mr-2"></i> Chat cerrado. Envía una plantilla para reactivar.
           </div>`
        : '';

    const placeholderText = isSessionExpired
        ? 'La ventana de 24h ha cerrado. Los mensajes se encolarán.'
        : 'Escribe un mensaje o usa / para respuestas rápidas...';

    const footerContent = `
        <form id="message-form" class="flex items-center space-x-3">
             <label for="file-input" class="cursor-pointer p-2 chat-icon-btn"><i class="fas fa-paperclip text-xl"></i></label>
             <input type="file" id="file-input" onchange="handleFileInputChange(event)" accept="image/*,video/*,audio/*" multiple>
             <button type="button" id="emoji-toggle-btn" onclick="toggleEmojiPicker()" class="p-2 chat-icon-btn"><i class="far fa-smile text-xl"></i></button>
             ${contact.channel !== 'messenger' ? '<button type="button" id="template-toggle-btn" onclick="toggleTemplatePicker()" class="p-2 chat-icon-btn" title="Enviar plantilla"><i class="fas fa-scroll"></i></button>' : ''}
             <button type="button" id="generate-reply-btn" onclick="handleGenerateReply()" class="p-2 chat-icon-btn" title="Contestar con IA"><i class="fas fa-magic"></i></button>
             <textarea id="message-input" placeholder="${placeholderText}" class="flex-1 !mb-0" rows="1"></textarea>
             <button type="submit" class="btn btn-primary rounded-full w-12 h-12 p-0"><i class="fas fa-paper-plane text-lg"></i></button>
        </form>`;

    const mainContent = `<div class="relative flex-1 flex flex-col min-h-0">
             <main id="messages-container" class="flex-1 p-4 overflow-y-auto">
                <div id="sticky-date-header" class="date-separator"></div>
                <div id="messages-content"></div>
                <!-- Espaciador para que el indicador flotante no tape el último mensaje -->
                <div id="ai-typing-spacer" class="h-16 hidden"></div>
             </main>
             <div id="ai-typing-indicator" class="hidden absolute bottom-4 left-4 bg-white px-4 py-2 rounded-xl rounded-bl-sm shadow-md flex items-center gap-2 z-10 w-fit border border-gray-100">
                <div class="flex items-center gap-1">
                    <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                    <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                    <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                </div>
                <span id="ai-timer-text" class="text-xs text-gray-500 ml-2 font-medium">Esperando (20s)</span>
                <div class="flex items-center gap-1 ml-2">
                    <button id="ai-skip-btn" onclick="skipAiWait()" class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded transition-colors" title="Responder ahora">
                        <i class="fas fa-forward"></i>
                    </button>
                    <button id="ai-cancel-btn" onclick="cancelAiResponse()" class="hidden text-xs bg-red-100 hover:bg-red-200 text-red-600 px-2 py-0.5 rounded transition-colors" title="Cancelar respuesta">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
             </div>
           </div>`;

    const notesBadge = state.notes.length > 0 ? `<span class="note-count-badge">${state.notes.length}</span>` : '';
    const replyContextBarHTML = state.replyingToMessage ? `<div id="reply-context-bar">${ReplyContextBarTemplate(state.replyingToMessage)}</div>` : '';

    const isBotActiveForContact = contact.botActive === true;
    const botToggleHTML = `
        <button
            onclick="handleBotToggle('${contact.id}', ${!isBotActiveForContact})"
            class="p-2 rounded-full hover:bg-gray-200 transition-colors ${isBotActiveForContact ? 'text-green-500' : 'text-gray-400'}"
            title="${isBotActiveForContact ? 'Desactivar IA para este chat' : 'Activar IA para este chat'}">
            <i class="fas fa-robot text-xl"></i>
        </button>
    `;

    // --- NUEVO: Botón de Transferencia de Chat ---
    const transferButtonHTML = `
        <button onclick="openTransferModal('${contact.id}')" class="p-2 rounded-full hover:bg-gray-200 transition-colors text-gray-500 ml-2" title="Transferir Chat">
            <i class="fas fa-exchange-alt"></i>
        </button>
    `;

    const clearHistoryButtonHTML = `
        <button onclick="handleClearChatHistory('${contact.id}')" class="p-2 rounded-full hover:bg-red-50 transition-colors text-red-500 ml-2" title="Borrar Historial de Chat">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;

    return `
        <div id="drag-drop-overlay-chat" class="drag-overlay hidden">
            <div class="drag-overlay-content">
                <i class="fas fa-file-import text-5xl mb-4"></i>
                <p>Suelta para adjuntar el archivo</p>
            </div>
        </div>
        <header class="chat-header p-2 shadow-sm flex items-center space-x-2" ${headerStyle}>
            <button id="chat-back-btn" onclick="closeChatOnMobile()" class="hidden"><i class="fas fa-arrow-left"></i></button>
            <div class="flex-shrink-0 pt-0.5">${UserIcon(contact)}</div>
            <div class="flex-grow">
                <h2 class="text-base font-semibold cursor-pointer" style="color: var(--color-text);" onclick="openContactDetails()">
                    <i class="${contact.channel === 'messenger' ? 'fab fa-facebook-messenger text-blue-500' : 'fab fa-whatsapp text-green-500'} mr-1"></i>${contact.name}
                </h2>
                <div class="flex items-center text-xs text-gray-500">
                    ${contact.channel === 'messenger'
                        ? '<span>Facebook Messenger</span>'
                        : `<span>+${contact.id}</span>
                           <button onclick="event.stopPropagation(); copyToClipboard('${contact.id}', this)" class="ml-2 text-gray-400 hover:text-primary transition-colors focus:outline-none" title="Copiar número"><i class="far fa-copy"></i></button>`
                    }
                </div>
                <div id="contact-status-wrapper" class="mt-1.5"></div>
            </div>
            <div class="flex items-center pr-2">
                ${botToggleHTML}
                ${transferButtonHTML}
                ${clearHistoryButtonHTML}
            </div>
        </header>

        ${AdReferralBannerTemplate(contact.adReferral)}
        <div class="bg-white border-b border-gray-200 flex">
            <button class="tab-btn active"><i class="fas fa-comments mr-2"></i>Chat</button>
        </div>
        ${mainContent}
        <div id="file-preview-container"></div>
        <footer class="chat-footer relative">
            <div id="drag-drop-overlay-footer" class="drag-overlay-footer hidden">
                <div class="drag-overlay-content">
                    <i class="fas fa-file-import text-3xl mb-2"></i>
                    <p>Suelta aquí para adjuntar</p>
                </div>
            </div>
            ${sessionExpiredNotification}
            ${replyContextBarHTML}
            <div id="quick-reply-picker" class="picker-container hidden"></div>
            <div id="template-picker" class="picker-container hidden"></div>
            <div id="upload-progress" class="text-center text-sm text-yellow-600 mb-2 hidden"></div>
            ${footerContent}
            <div id="emoji-picker" class="hidden"></div>
        </footer>`;
};

const ContactDetailsSidebarTemplate = (contact) => {
    if (!contact) return '';

    return `
        <div class="h-full flex flex-col">
            <header class="p-4 flex items-center justify-between border-b border-gray-200">
                <h3 class="font-semibold text-lg">Detalles del contacto</h3>
                <button onclick="closeContactDetails()" class="text-gray-500 hover:text-gray-800"><i class="fas fa-times"></i></button>
            </header>
            <div class="flex-1 p-6 overflow-y-auto">
                <div class="text-center mb-6">
                    ${UserIcon(contact, 'h-24 w-24 mx-auto')}
                    <h2 class="text-2xl font-bold mt-4">${contact.name || 'Desconocido'}</h2>
                    <p class="text-gray-500">+${contact.id}</p>
                     <p class="text-sm text-gray-500 mt-1">${contact.email || ''}</p>
                     <p class="text-sm text-gray-500 mt-1"><em>${contact.nickname || ''}</em></p>
                </div>

                <div id="order-history-container" class="mt-4 border-t pt-4">
                     <h4 class="font-semibold text-gray-500 mb-3 text-sm uppercase tracking-wider">Historial de Pedidos</h4>
                     <div id="contact-orders-list" class="space-y-2">
                        <!-- El contenido se cargará dinámicamente -->
                     </div>
                </div>

                <div id="sidebar-notes-container" class="mt-6 border-t pt-4">
                     <div class="flex justify-between items-center mb-3">
                         <h4 class="font-semibold text-gray-500 text-sm uppercase tracking-wider">Notas Internas</h4>
                         <button onclick="toggleSidebarNoteInput()" class="text-blue-500 hover:text-blue-700 p-1" title="Agregar nota">
                             <i class="fas fa-plus"></i>
                         </button>
                     </div>
                     <div id="sidebar-note-input-container" class="hidden mb-3 bg-gray-50 p-2 rounded border border-gray-100">
                         <textarea id="sidebar-note-input" class="w-full p-2 text-xs border rounded mb-2 focus:ring-1 focus:ring-blue-400 outline-none" rows="2" placeholder="Escribe una nota interna..."></textarea>
                         <div class="flex justify-end gap-2">
                             <button onclick="toggleSidebarNoteInput()" class="text-[10px] text-gray-400 hover:text-gray-600">Cancelar</button>
                             <button onclick="handleSaveSidebarNote()" class="btn btn-primary !py-1 !px-2 !text-[10px] rounded">Guardar</button>
                         </div>
                     </div>
                     <div id="sidebar-notes-list" class="p-2 min-h-[40px] transition-all duration-300">
                        <!-- Las notas se cargarán aquí -->
                     </div>
                </div>

                <div class="mt-6 border-t pt-6 space-y-2">
                   <button onclick="handleMarkAsPurchase()" class="btn btn-secondary w-full btn-sm"><i class="fas fa-shopping-cart mr-2"></i>Registrar Compra (Meta)</button>
                   <button onclick="handleSendViewContent()" class="btn btn-subtle w-full btn-sm"><i class="fas fa-eye mr-2"></i>Enviar 'Contenido Visto' (Meta)</button>
                   <button onclick="abrirModalPedido()" class="btn btn-primary w-full btn-sm mt-4"><i class="fas fa-plus-circle mr-2"></i>Registrar Nuevo Pedido</button>
                </div>
            </div>
            </footer>
        </div>
    `;
};

const DateSeparatorTemplate = (dateString) => {
    return `<div class="date-separator date-separator-anchor">${dateString}</div>`;
};

const NewOrderModalTemplate = () => `
    <div id="new-order-modal" class="modal-overlay">
        <div class="modal-content" id="modalContentNuevoPedido">
            <button onclick="closeNewOrderModal()" class="modal-close-btn" title="Cerrar">&times;</button>
            <div id="nuevoPedidoContainer">
                 <h2 id="modalTitle"><i class="fas fa-pencil-alt"></i> Registrar Nuevo Pedido</h2>
                 <form id="formularioNuevoPedido">
                     <div class="form-grid">
                         <div class="form-item">
                             <label for="pedidoProductoSelect">Producto (*):</label>
                             <select id="pedidoProductoSelect" required>
                                <option value="Modelo 7">Modelo 7</option>
                                <option value="Portallaves">Portallaves</option>
                                <option value="Calendario">Calendario</option>
                                <option value="Placa de perro">Placa de perro</option>
                                <option value="Otro">Otro</option>
                             </select>
                             <input type="text" id="pedidoProductoOtro" style="display: none;" placeholder="Nombre del producto">
                         </div>
                         <div class="form-item">
                             <label for="pedidoTelefono">Teléfono (*):</label>
                             <input type="tel" id="pedidoTelefono" placeholder="Ej: 521..." required>
                         </div>
                         <div class="form-item">
                              <label for="pedidoPrecio">Precio (MXN):</label>
                              <input type="number" id="pedidoPrecio" step="0.01" placeholder="Ej: 275.00" value="275">
                          </div>

                          <div class="form-item form-item-full">
                               <label for="pedidoFotoFile">Fotos del Pedido (Clic derecho o Ctrl+C para copiar):</label>
                               <div class="file-input-container" id="fileInputContainerProducto" tabindex="0">
                                   <input type="file" id="pedidoFotoFile" accept="image/*" multiple>
                                   <div class="file-input-header">
                                       <label for="pedidoFotoFile" class="custom-file-upload">
                                           <i class="fas fa-upload"></i> Seleccionar
                                       </label>
                                       <span>O arrastra y suelta imágenes aquí</span>
                                   </div>
                                   <div class="previews-container" id="fotosPreviewContainer">
                                       </div>
                               </div>
                          </div>
                         <div class="form-item form-item-full">
                             <label for="pedidoDatosProducto">Detalles del Producto:</label>
                             <textarea id="pedidoDatosProducto" placeholder="Describe los detalles específicos del producto solicitado..."></textarea>
                         </div>

                         <div class="form-item form-item-full">
                            <label for="pedidoFotoPromocionFile">Fotos de la Promoción (Clic derecho o Ctrl+C para copiar):</label>
                            
                            <!-- NEW CHECKBOX CONTAINER -->
                            <div class="checkbox-container" id="mismaFotoContainer" style="display: none;">
                                <input type="checkbox" id="mismaFotoCheckbox">
                                <label for="mismaFotoCheckbox">Usar la(s) misma(s) foto(s) del pedido</label>
                            </div>
                            
                            <div class="file-input-container" id="fileInputContainerPromocion" tabindex="0">
                                <input type="file" id="pedidoFotoPromocionFile" accept="image/*" multiple>
                                <div class="file-input-header">
                                    <label for="pedidoFotoPromocionFile" class="custom-file-upload">
                                        <i class="fas fa-upload"></i> Seleccionar
                                    </label>
                                    <span>O arrastra y suelta imágenes aquí</span>
                                </div>
                                <div class="previews-container" id="promoFotosPreviewContainer">
                                    </div>
                            </div>
                        </div>
                        <div class="form-item form-item-full">
                            <label for="pedidoDatosPromocion">Detalles de la Promoción:</label>
                            <textarea id="pedidoDatosPromocion" placeholder="Describe la promoción aplicada, si existe..."></textarea>
                        </div>

                        <div class="form-item form-item-full">
                               <label for="pedidoComentarios">Comentarios Adicionales:</label>
                               <textarea id="pedidoComentarios" placeholder="Añade cualquier otra nota relevante sobre el pedido..."></textarea>
                        </div>
                     </div>
                     <div id="mensajeErrorPedido"></div>
                     <div class="form-actions">
                          <button type="button" onclick="closeNewOrderModal()"><i class="fas fa-times"></i> Cancelar</button>
                          <button type="submit" id="btnGuardarPedido"><i class="fas fa-save"></i> Guardar Pedido</button>
                     </div>
                 </form>
            </div>
        </div>
    </div>
`;

const OrderConfirmationModalTemplate = (orderNumber) => `
    <div id="order-confirmation-modal" class="modal-backdrop">
        <div class="modal-content !max-w-md !p-8 text-center">
            <div class="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">
                <i class="fas fa-check-circle"></i>
            </div>
            <h2 class="text-2xl font-bold text-gray-800 mb-4">¡Pedido Registrado!</h2>
            <p class="text-gray-600 mb-8">El pedido ha sido guardado exitosamente con el número:</p>
            
            <div class="flex items-center justify-center gap-3 bg-slate-100 p-4 rounded-2xl mb-8 group cursor-pointer hover:bg-slate-200 transition-colors" onclick="copyOrderNumber('DH${orderNumber}', this)">
                <span id="numeroPedidoConfirmacion" class="text-3xl font-black text-primary tracking-wider">DH${orderNumber}</span>
                <div class="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-gray-400 group-hover:text-primary transition-colors">
                    <i class="fas fa-copy"></i>
                </div>
            </div>

            <button onclick="closeOrderConfirmationModal()" class="w-full py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-900 transition-all active:scale-95 shadow-lg">
                Cerrar
            </button>
        </div>
    </div>
`;

const ConversationPreviewModalTemplate = (contact) => `
    <div id="conversation-preview-modal" class="modal-backdrop" onclick="closeConversationPreviewModal()">
        <div class="modal-content !p-0 !max-w-3xl !w-full" onclick="event.stopPropagation()">
            <div id="preview-chat-panel" class="h-full flex flex-col relative">
                <header class="chat-header p-2 shadow-sm flex items-center justify-between space-x-2">
                    <div class="flex items-center space-x-2">
                        <div class="flex-shrink-0 pt-0.5">${UserIcon(contact)}</div>
                        <div class="flex-grow">
                            <h2 class="text-base font-semibold" style="color: var(--color-text);">${contact.name}</h2>
                            <p class="text-xs text-gray-500">+${contact.id}</p>
                        </div>
                    </div>
                    <button class="image-modal-close !relative !top-0 !right-0" onclick="closeConversationPreviewModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </header>
                <main id="preview-messages-container" class="relative flex-1 p-4 overflow-y-auto">
                     <div id="preview-loading-spinner" class="h-16 flex items-center justify-center">
                        <i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
                     </div>
                    <div id="preview-messages-content"></div>
                </main>
            </div>
        </div>
    </div>
`;

const OrderHistoryItemTemplate = (order) => {
    const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
    const estatus = order.estatus || 'Sin estatus';

    const statusOptionsHTML = state.orderStatuses
        .map(status => `<option value="${status.key}" ${estatus === status.key ? 'selected' : ''} style="color: ${status.color}; font-weight: 600;">${status.label}</option>`)
        .join('');

    const currentStatusStyle = state.orderStatuses.find(s => s.key === estatus) || { color: '#e9ecef' };

    return `
        <div class="order-history-item">
            <div class="order-history-row">
                <button class="order-number" onclick="openOrderEditModal('${order.id}')">
                    DH${order.consecutiveOrderNumber}
                </button>
                <span class="order-date">${orderDate}</span>
            </div>
            <div class="order-history-row">
                <span class="order-product" title="${order.producto}">${order.producto}</span>
            </div>
            <div class="order-history-row">
                <select
                    class="order-history-status-select"
                    data-order-id="${order.id}"
                    onchange="handleOrderStatusChange('${order.id}', this.value, this)"
                    style="background-color: ${currentStatusStyle.color}20; color: ${currentStatusStyle.color}; border-color: ${currentStatusStyle.color}50;"
                >
                    ${statusOptionsHTML}
                </select>
            </div>
        </div>
    `;
};

const OrderEditModalTemplate = (order) => `
    <div id="order-edit-modal" class="modal-overlay" onclick="closeOrderEditModal()">
        <div class="modal-content" onclick="event.stopPropagation()">
            <button onclick="closeOrderEditModal()" class="modal-close-btn" title="Cerrar">&times;</button>
            <div id="editPedidoContainer">
                 <h2 id="editModalTitle"><i class="fas fa-edit"></i> Editar Pedido DH${order.consecutiveOrderNumber}</h2>
                 <form id="edit-order-form">
                     <div class="form-grid">
                         <div class="form-item">
                             <label for="edit-order-product-select">Producto (*):</label>
                             <select id="edit-order-product-select" required>
                                <option value="Modelo 7">Modelo 7</option>
                                <option value="Portallaves">Portallaves</option>
                                <option value="Calendario">Calendario</option>
                                <option value="Placa de perro">Placa de perro</option>
                                <option value="Otro">Otro</option>
                             </select>
                             <input type="text" id="edit-order-product-other" style="display: none;" placeholder="Nombre del producto">
                         </div>
                         <div class="form-item">
                             <label for="edit-order-phone">Teléfono (*):</label>
                             <input type="tel" id="edit-order-phone" placeholder="Ej: 521..." required>
                         </div>
                         <div class="form-item">
                              <label for="edit-order-price">Precio (MXN):</label>
                              <input type="number" id="edit-order-price" step="0.01" placeholder="Ej: 275.00">
                          </div>

                          <div class="form-item form-item-full">
                               <label for="edit-order-photo-file">Fotos del Pedido (Arrastra o pega imágenes):</label>
                               <div class="file-input-container" id="edit-order-file-input-container-product" tabindex="0">
                                   <input type="file" id="edit-order-photo-file" accept="image/*" multiple>
                                   <div class="file-input-header">
                                       <label for="edit-order-photo-file" class="custom-file-upload">
                                           <i class="fas fa-upload"></i> Seleccionar
                                       </label>
                                       <span>o arrastra y suelta aquí</span>
                                   </div>
                                   <div class="previews-container" id="edit-order-photos-preview-container"></div>
                               </div>
                          </div>
                         <div class="form-item form-item-full">
                             <label for="edit-order-product-details">Detalles del Producto:</label>
                             <textarea id="edit-order-product-details" placeholder="Describe los detalles específicos del producto solicitado..."></textarea>
                         </div>

                         <div class="form-item form-item-full">
                            <label for="edit-order-promo-photo-file">Fotos de la Promoción:</label>
                            <div class="checkbox-container" id="edit-order-same-photo-container" style="display: none;">
                                <input type="checkbox" id="edit-order-same-photo-checkbox">
                                <label for="edit-order-same-photo-checkbox">Usar la(s) misma(s) foto(s) del pedido</label>
                            </div>
                            <div class="file-input-container" id="edit-order-file-input-container-promo" tabindex="0">
                                <input type="file" id="edit-order-promo-photo-file" accept="image/*" multiple>
                                <div class="file-input-header">
                                    <label for="edit-order-promo-photo-file" class="custom-file-upload">
                                        <i class="fas fa-upload"></i> Seleccionar
                                    </label>
                                    <span>o arrastra y suelta aquí</span>
                                </div>
                                <div class="previews-container" id="edit-order-promo-photos-preview-container"></div>
                            </div>
                        </div>
                        <div class="form-item form-item-full">
                            <label for="edit-order-promo-details">Detalles de la Promoción:</label>
                            <textarea id="edit-order-promo-details" placeholder="Describe la promoción aplicada, si existe..."></textarea>
                        </div>

                        <div class="form-item form-item-full">
                               <label for="edit-order-comments">Comentarios Adicionales:</label>
                               <textarea id="edit-order-comments" placeholder="Añade cualquier otra nota relevante sobre el pedido..."></textarea>
                        </div>
                     </div>
                     <div id="edit-order-error-message"></div>
                     <div class="form-actions">
                          <button type="button" onclick="closeOrderEditModal()"><i class="fas fa-times"></i> Cancelar</button>
                          <button type="submit" id="order-update-btn"><i class="fas fa-save"></i> Guardar Cambios</button>
                     </div>
                 </form>
            </div>
        </div>
    </div>
`;
