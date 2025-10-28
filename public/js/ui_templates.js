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
            <div id="tag-filters-container" class="p-2 flex flex-wrap gap-2 justify-center border-b border-gray-200 bg-white items-center"></div>
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
                    <th>IDs del Anuncio</th> <!-- MODIFICADO: Cabecera -->
                    <th>Mensaje</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody id="ad-responses-table-body"></tbody>
        </table>
    </div>
`;

const AIAdPromptsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Prompts de IA por Anuncio</h1>
            <button onclick="openAIAdPromptModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Prompt</button>
        </div>
        <p class="mb-6 text-gray-600">Asigna instrucciones específicas (prompts) para la IA basadas en el anuncio del que proviene el cliente. Si un anuncio no tiene un prompt aquí, se usarán las instrucciones generales del bot.</p>
        <table class="table">
            <thead>
                <tr>
                    <th>Nombre del Anuncio</th>
                    <th>ID del Anuncio</th>
                    <th>Prompt</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody id="ai-ad-prompts-table-body"></tbody>
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
`;

const QuickRepliesViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Respuestas Rápidas</h1>
            <button onclick="openQuickReplyModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Respuesta</button>
        </div>
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
`;

const KnowledgeBaseViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Base de Conocimiento de IA</h1>
            <button onclick="openKnowledgeBaseModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Respuesta</button>
        </div>
        <p class="mb-6 text-gray-600">Aquí puedes añadir respuestas a preguntas frecuentes. El bot usará esta información para contestar automáticamente.</p>
        <table class="table">
            <thead>
                <tr>
                    <th>Tema / Palabras Clave</th>
                    <th>Respuesta Base</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody id="kb-table-body"></tbody>
        </table>
    </div>
`;

const AjustesIAViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Ajustes de Inteligencia Artificial</h1>
        </div>

        <div class="max-w-4xl space-y-8">
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Automatización Global</h2>
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="font-semibold">Bot IA Global</h3>
                        <p class="text-sm text-gray-500">Activar la inteligencia artificial para todas las conversaciones nuevas.</p>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="global-bot-toggle" onchange="handleGlobalBotToggle(this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>

            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Instrucciones del Bot</h2>
                <p class="mb-4 text-gray-600">Define el comportamiento general del bot. Estas instrucciones se usarán a menos que un prompt de anuncio específico las anule.</p>
                <button onclick="openBotSettingsModal()" class="btn btn-secondary"><i class="fas fa-pencil-alt mr-2"></i>Editar Prompt General</button>
            </div>

            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Anulaciones Individuales del Bot</h2>
                <p class="mb-4 text-gray-600">Activa o desactiva el bot para conversaciones individuales. Esto anulará el ajuste global.</p>
                <div class="mb-4">
                    <input type="text" id="bot-contact-search-input" placeholder="Buscar contacto por nombre o número..." class="!mb-0">
                </div>
                <div class="max-h-96 overflow-y-auto">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Contacto</th>
                                <th>Bot Activo</th>
                            </tr>
                        </thead>
                        <tbody id="bot-contacts-table-body"></tbody>
                    </table>
                </div>
            </div>
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
        </div>
    </div>
`;

// --- INICIO DE MODIFICACIÓN: Plantilla de Métricas ---
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
            <!-- Sección Original: Gráficas Generales -->
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

            <!-- NUEVA SECCIÓN: Mensajes por Anuncio -->
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
                                <!-- Las filas se generarán dinámicamente -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <!-- Fin Nueva Sección -->
        </div>
    </div>
`;
// --- FIN DE MODIFICACIÓN ---

// --- PLANTILLAS DE COMPONENTES ---
const UserIcon = (contact, size = 'h-9 w-9') => {
    if (contact && contact.profileImageUrl) {
        return `<img src="${contact.profileImageUrl}" alt="${contact.name}" class="${size} rounded-full object-cover">`;
    }
    // Fallback con iniciales y color de etiqueta
    const contactStatusKey = contact.status;
    const tag = state.tags.find(t => t.key === contactStatusKey);
    const bgColor = tag ? tag.color : '#d1d5db'; // Color gris por defecto
    const initial = contact.name ? contact.name.charAt(0).toUpperCase() : '?';

    // Usar clases de Tailwind para tamaño y centrado si es posible
    return `<div class="${size} rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold" style="background-color: ${bgColor};">
                ${initial}
            </div>`;
};

const ContactItemTemplate = (contact, isSelected) => {
    const typingText = contact.lastMessage || 'Sin mensajes.'; // Texto de último mensaje o estado

    // Generar HTML para la hora o contador de no leídos
    let timeOrBadgeHTML = '';
    if (contact.unreadCount > 0) {
        timeOrBadgeHTML = `<span class="unread-badge">${contact.unreadCount}</span>`;
    } else if (contact.lastMessageTimestamp) {
        const date = contact.lastMessageTimestamp; // Ya es un objeto Date
        const timeString = isSameDay(new Date(), date)
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) // HH:MM si es hoy
            : date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); // DD/Mes si es otro día
        timeOrBadgeHTML = `<span class="text-xs text-gray-400">${timeString}</span>`;
    }

    // Badge para el número de pedido (si existe)
    const orderBadgeHTML = contact.lastOrderNumber
        ? `<span class="order-badge">DH${contact.lastOrderNumber}</span>`
        : '';

    // Contenido principal del item
    const mainContent = `
        <div class="flex-grow overflow-hidden ml-2">
            <div class="flex justify-between items-center">
                <h3 class="font-semibold text-sm text-gray-800 truncate">${contact.name || 'Desconocido'}</h3>
                <div class="contact-meta">
                     ${timeOrBadgeHTML}
                     <button class="preview-icon" onclick="openConversationPreview(event, '${contact.id}')" title="Ver conversación">
                        <i class="fas fa-eye"></i>
                     </button>
                </div>
            </div>
            <div class="flex justify-between items-center">
                <p class="text-xs truncate pr-2 text-gray-500">${typingText}</p>
                ${orderBadgeHTML}
            </div>
        </div>`;

    // Acción al hacer clic
    const onClickAction = `onclick="handleSelectContact('${contact.id}')"`;

    // Ensamblar el elemento HTML final
    return `<div ${onClickAction} class="contact-item flex items-center p-1.5 cursor-pointer ${isSelected ? 'selected' : ''}" data-contact-id="${contact.id}">
                ${UserIcon(contact)}
                ${mainContent}
            </div>`;
};

// Muestra el icono de estado del mensaje (reloj, check, doble check)
const MessageStatusIconTemplate = (status) => {
    const sentColor = '#9ca3af'; // Gris para enviado/entregado
    const readColor = '#53bdeb'; // Azul para leído
    switch (status) {
        case 'pending': return `<i class="far fa-clock message-status-icon" style="color: ${sentColor};"></i>`; // Reloj simple (enviando)
        case 'queued': return `<i class="far fa-clock message-status-icon" style="color: #60a5fa;"></i>`; // Reloj azul (encolado >24h)
        case 'read': return `<i class="fas fa-check-double" style="color: ${readColor};"></i>`; // Doble check azul
        case 'delivered': return `<i class="fas fa-check-double" style="color: ${sentColor};"></i>`; // Doble check gris
        case 'sent': return `<i class="fas fa-check" style="color: ${sentColor};"></i>`; // Check simple gris
        default: return ''; // Sin icono si el estado es desconocido
    }
};

// Genera la vista previa de un mensaje respondido
const RepliedMessagePreviewTemplate = (originalMessage) => {
    if (!originalMessage) return ''; // Si no se encuentra el mensaje original

    // Determinar el autor del mensaje original
    const authorName = originalMessage.from === state.selectedContactId
        ? state.contacts.find(c => c.id === state.selectedContactId)?.name || 'Cliente' // Nombre del contacto o 'Cliente'
        : 'Tú'; // Si lo envió el usuario del CRM

    let textPreview = '';
    // Si el mensaje original era una imagen o video con URL
    if ((originalMessage.type === 'image' || originalMessage.fileType?.startsWith('image/')) && originalMessage.fileUrl) {
        const caption = originalMessage.text && originalMessage.text !== '📷 Imagen' ? originalMessage.text : '';
        let captionHtml = caption ? `<div class="reply-media-text"><p class="reply-media-caption">${caption}</p></div>` : '';
        textPreview = `<div class="reply-media-preview"><img src="${originalMessage.fileUrl}" alt="Miniatura de respuesta" class="reply-thumbnail">${captionHtml}</div>`;
    } else {
        // Para otros tipos de mensaje (texto, audio, etc.)
        let plainText = originalMessage.text || 'Mensaje';
        if (originalMessage.type === 'audio') plainText = '🎤 Mensaje de voz';
        else if (originalMessage.type === 'video' || originalMessage.fileType?.startsWith('video/')) plainText = '🎥 Video';
        else if (originalMessage.type === 'location') plainText = '📍 Ubicación';
        else if (originalMessage.fileType) plainText = '📄 Documento'; // Fallback para documentos
        textPreview = `<p class="reply-text">${plainText}</p>`;
    }

    // Ensamblar el HTML de la vista previa
    return `<div class="reply-preview"><p class="reply-author">${authorName}</p>${textPreview}</div>`;
};


// Genera el HTML para una burbuja de mensaje individual
const MessageBubbleTemplate = (message) => {
    const isSent = message.from !== state.selectedContactId; // Determina si es mensaje enviado o recibido
    // Formatea la hora del mensaje (HH:MM)
    const time = message.timestamp && typeof message.timestamp.seconds === 'number'
        ? new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

    let contentHTML = ''; // Contenido principal del mensaje (texto, imagen, etc.)
    let bubbleExtraClass = ''; // Clases CSS adicionales para la burbuja
    // HTML para la hora y el icono de estado
    let timeAndStatusHTML = `<div class="text-xs text-right mt-1 opacity-70 flex justify-end items-center space-x-2"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status) : ''}</div>`;

    const hasText = message.text && !/^(🎤|🎵|📷|🎥|📄|Sticker)/.test(message.text); // Verifica si hay texto real (no solo el placeholder de multimedia)

    // Si el mensaje tiene archivo adjunto (imagen, video, audio, doc)
    if (message.fileUrl && message.fileType) {
        if (message.fileType.startsWith('image/')) {
            bubbleExtraClass = 'has-image'; // Clase especial para imágenes (padding diferente)
            const sentBgClass = isSent ? `bg-[${'var(--color-bubble-sent-bg)'}]` : `bg-[${'var(--color-bubble-received-bg)'}]`;
            const fullImageUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`; // Asegura URL completa
            // Imagen + Texto (si hay) + Overlay de hora/estado
            contentHTML += `<div class="${sentBgClass} rounded-lg overflow-hidden"><img src="${fullImageUrl}" alt="Imagen enviada" class="chat-image-preview" onclick="openImageModal('${fullImageUrl}')">${hasText ? `<div class="p-2 pt-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>` : ''}<div class="time-overlay"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status) : ''}</div></div>`;
            timeAndStatusHTML = ''; // El overlay ya tiene la hora/estado
        } else if (message.fileType.startsWith('video/')) {
            const videoUrl = message.timestamp ? `${message.fileUrl}?v=${message.timestamp.seconds}` : message.fileUrl; // Añade timestamp para evitar caché
            const fullVideoUrl = videoUrl.startsWith('http') ? videoUrl : `${API_BASE_URL}${videoUrl}`; // URL completa
            // Reproductor de video + Texto (si hay)
            contentHTML += `<video controls class="message-bubble video rounded-lg mb-1"><source src="${fullVideoUrl}" type="${message.fileType}">Tu navegador no soporta videos.</video>`;
            if(hasText) contentHTML += `<div class="px-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
        } else if (message.fileType.startsWith('audio/')) {
             const audioSrc = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`; // URL completa
             // Reproductor de audio
             contentHTML += `<audio controls preload="metadata" class="chat-audio-player"><source src="${audioSrc}" type="${message.fileType}">Tu navegador no soporta audio.</audio>`;
        } else if (message.type === 'document' || message.fileType.startsWith('application/')) {
            const fullDocUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`; // URL completa
            // Enlace al documento
            contentHTML += `<a href="${fullDocUrl}" target="_blank" rel="noopener noreferrer" class="document-link"><i class="fas fa-file-alt document-icon"></i><span class="document-text">${message.document?.filename || message.text || 'Ver Documento'}</span></a>`;
        } else if (message.type === 'sticker') {
            const fullStickerUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`;
            contentHTML += `<img src="${fullStickerUrl}" alt="Sticker" class="chat-sticker-preview">`;
        }
    } else if (message.type === 'location' && message.location) {
        // Mensaje de ubicación
        const { latitude, longitude, name, address } = message.location;
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`; // Enlace a Google Maps
        contentHTML += `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="block text-blue-600 hover:underline"><div class="font-semibold"><i class="fas fa-map-marker-alt mr-2 text-red-500"></i>${name || 'Ubicación'}</div>${address ? `<p class="text-xs text-gray-500 mt-1">${address}</p>` : ''}<p class="text-xs mt-1">Toca para ver en el mapa</p></a>`;
    } else if (message.type === 'sticker') {
         // Fallback si no se pudo cargar la URL del sticker
        contentHTML += `<div class="sticker-fallback"><i class="far fa-sticky-note"></i><span>Sticker</span></div>`;
    } else if (message.text) {
        // Mensaje de solo texto
         contentHTML += `<div><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
    }

    // Añadir vista previa si es una respuesta
    let replyPreviewHTML = '';
    if (message.context && message.context.id) {
        const originalMessage = state.messages.find(m => m.id === message.context.id); // Busca el mensaje original por ID
        replyPreviewHTML = RepliedMessagePreviewTemplate(originalMessage);
    }

    // Botón de copiar (solo si hay texto)
    const copyButtonHTML = message.text ? `<button class="message-action-btn" onclick="copyFormattedText('${message.text.replace(/'/g, '\\\'')}', this)" title="Copiar"><i class="far fa-copy"></i></button>` : '';

    // HTML para las acciones (reaccionar, responder, copiar)
    const actionsHTML = `
        <div class="message-actions">
             <div class="reaction-bar">
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '👍')">👍</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '❤️')">❤️</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '😂')">😂</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '🙏')">🙏</button>
             </div>
             <button class="message-action-btn" onclick="handleStartReply(event, '${message.docId}')" title="Responder"><i class="fas fa-reply"></i></button>
             ${copyButtonHTML}
        </div>
    `;

    // HTML para mostrar la reacción (si existe)
    const reactionHTML = message.reaction ? `<div class="reactions-container ${isSent ? '' : 'received-reaction'}">${message.reaction}</div>` : '';

    // Clases CSS para la burbuja y el grupo
    const bubbleAlignment = isSent ? 'sent' : 'received';
    let bubbleClasses = isSent ? 'sent' : 'received';
    if (message.status === 'queued') bubbleClasses += ' message-queued'; // Clase especial si está en cola

    // Ensamblar el HTML final del mensaje
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


// Genera el HTML para un elemento de nota interna (modo visualización o edición)
const NoteItemTemplate = (note) => {
    const time = note.timestamp ? new Date(note.timestamp.seconds * 1000).toLocaleString('es-ES') : 'Fecha desconocida';
    const isEditing = state.isEditingNote === note.id; // Verifica si esta nota está en modo edición

    // Si está en modo edición, muestra un textarea
    return isEditing
        ? `<div class="note-item">
             <textarea id="edit-note-input-${note.id}" class="!mb-2" rows="3">${note.text}</textarea>
             <div class="flex justify-end gap-2">
               <button class="btn btn-subtle btn-sm" onclick="toggleEditNote(null)">Cancelar</button>
               <button class="btn btn-primary btn-sm" onclick="handleUpdateNote('${note.id}')">Guardar</button>
             </div>
           </div>`
        // Si no, muestra el texto y los botones de editar/eliminar
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

// Genera la vista previa de un archivo local (antes de enviarlo)
const LocalFilePreviewTemplate = (file) => {
    const objectURL = URL.createObjectURL(file); // URL temporal para el archivo local
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    let previewElement;
    if (isImage) {
        previewElement = `<img src="${objectURL}" alt="Vista previa">`;
    } else if (isVideo) {
        previewElement = `<video src="${objectURL}" alt="Vista previa"></video>`;
    } else if (isAudio) {
        previewElement = `<div class="p-3"><i class="fas fa-music text-2xl text-gray-500"></i></div>`; // Icono para audio
    } else {
        previewElement = `<div class="p-3"><i class="fas fa-file text-2xl text-gray-500"></i></div>`; // Icono genérico
    }
    // Ensambla el HTML con el botón de cancelar, la vista previa y la info del archivo
    return ` <div class="file-preview-content"> <div id="cancel-file-btn" onclick="cancelStagedFile()"><i class="fas fa-times"></i></div> ${previewElement} <div class="ml-3 text-sm text-gray-600 truncate"> <p class="font-semibold">${file.name}</p> <p>${(file.size / 1024).toFixed(1)} KB</p> </div> </div>`;
};
// Genera la vista previa de un archivo remoto (ej. de una respuesta rápida)
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
    // Similar al local, pero usa file.url y file.name
    return ` <div class="file-preview-content"> <div id="cancel-file-btn" onclick="cancelStagedFile()"><i class="fas fa-times"></i></div> ${previewElement} <div class="ml-3 text-sm text-gray-600 truncate"> <p class="font-semibold">${file.name || 'Archivo adjunto'}</p></div> </div>`;
};

// Genera los botones de estado/etiqueta para un contacto
const StatusButtonsTemplate = (contact) => {
    let buttonsHtml = '<div class="status-btn-group">';
    state.tags.forEach(tag => {
        const isActive = contact.status === tag.key; // Verifica si esta es la etiqueta activa
        // Genera un botón para cada etiqueta, con estilos basados en si está activa o no
        buttonsHtml += `<button
                            onclick="handleStatusChange('${contact.id}', '${tag.key}')"
                            class="status-btn ${isActive ? 'active' : ''}"
                            style="${isActive ? `background-color: ${tag.color}; color: white; border-color: ${tag.color};` : `background-color: ${tag.color}20; color: ${tag.color}; border-color: ${tag.color}50;`}"
                        >
                            ${tag.label}
                        </button>`;
    });
    buttonsHtml += '</div>';
    return buttonsHtml;
};

// Genera la barra que aparece cuando se está respondiendo a un mensaje
const ReplyContextBarTemplate = (message) => {
    if (!message) return ''; // Si no hay mensaje al que responder
    // Determina el autor del mensaje original
    const authorName = message.from === state.selectedContactId ? state.contacts.find(c => c.id === state.selectedContactId)?.name || 'Cliente' : 'Tú';
    // Genera una vista previa del texto o tipo de archivo
    const textPreview = message.text || (message.fileType ? `📷 Archivo` : '');
    // Ensambla el HTML con el botón de cancelar y la vista previa
    return `
        <button id="cancel-reply-btn" onclick="cancelReply()"><i class="fas fa-times"></i></button>
        <div class="reply-preview !p-0 !border-l-2 !m-0">
            <p class="reply-author">Respondiendo a ${authorName}</p>
            <p class="reply-text">${textPreview}</p>
        </div>
    `;
};

// Genera el HTML completo para la ventana de chat de un contacto seleccionado
const ChatWindowTemplate = (contact) => {
    const emptyChat = `<div class="flex-1 flex flex-col items-center justify-center text-gray-500 bg-opacity-50 bg-white"><i class="fab fa-whatsapp-square text-8xl mb-4 text-gray-300"></i><h2 class="text-xl font-semibold">Selecciona un chat para empezar</h2><p>Mantén tu CRM conectado y organizado.</p></div>`;
    if (!contact) { return emptyChat; } // Muestra mensaje si no hay contacto seleccionado

    const isSessionExpired = state.isSessionExpired; // Verifica si la sesión de 24h ha expirado

    // Banner que indica si la sesión ha expirado
    const sessionExpiredNotification = isSessionExpired
        ? `<div class="session-expired-banner">
             <i class="fas fa-lock mr-2"></i> Chat cerrado. Envía una plantilla para reactivar.
           </div>`
        : '';

    // Placeholder del input cambia según si la sesión expiró
    const placeholderText = isSessionExpired
        ? 'La ventana de 24h ha cerrado. Los mensajes se encolarán.'
        : 'Escribe un mensaje o usa / para respuestas rápidas...';

    // Contenido del footer (formulario de mensaje)
    const footerContent = `
        <form id="message-form" class="flex items-center space-x-3">
             <label for="file-input" class="cursor-pointer p-2 chat-icon-btn"><i class="fas fa-paperclip text-xl"></i></label>
             <input type="file" id="file-input" onchange="handleFileInputChange(event)" accept="image/*,video/*,audio/*">
             <button type="button" id="emoji-toggle-btn" onclick="toggleEmojiPicker()" class="p-2 chat-icon-btn"><i class="far fa-smile text-xl"></i></button>
             <button type="button" id="template-toggle-btn" onclick="toggleTemplatePicker()" class="p-2 chat-icon-btn" title="Enviar plantilla"><i class="fas fa-scroll"></i></button>
             <button type="button" id="generate-reply-btn" onclick="handleGenerateReply()" class="p-2 chat-icon-btn" title="Contestar con IA"><i class="fas fa-magic"></i></button>
             <textarea id="message-input" placeholder="${placeholderText}" class="flex-1 !p-0 !mb-0" rows="1"></textarea>
             <button type="submit" class="btn btn-primary rounded-full w-12 h-12 p-0"><i class="fas fa-paper-plane text-lg"></i></button>
        </form>`;

    // Contenido principal (mensajes o notas)
    const mainContent = state.activeTab === 'chat'
        ? `<main id="messages-container" class="relative flex-1 p-4 overflow-y-auto"><div id="sticky-date-header" class="date-separator"></div><div id="messages-content"></div></main>`
        : `<main id="notes-container" class="relative flex-1 p-4 overflow-y-auto bg-white">
             <form id="note-form" class="mb-4">
               <textarea id="note-input" placeholder="Escribe una nota interna..." class="!mb-2" rows="3"></textarea>
               <button type="submit" class="btn btn-primary btn-sm">Guardar Nota</button>
             </form>
             <div id="notes-content"></div>
           </main>`;

    // Badge para el contador de notas
    const notesBadge = state.notes.length > 0 ? `<span class="note-count-badge">${state.notes.length}</span>` : '';
    // Barra de contexto de respuesta (si aplica)
    const replyContextBarHTML = state.replyingToMessage ? `<div id="reply-context-bar">${ReplyContextBarTemplate(state.replyingToMessage)}</div>` : '';

    // Determina si el bot IA está activo para este contacto
    const isBotActiveForContact = contact.botActive !== false; // Activo por defecto o si es true
    // Botón para activar/desactivar la IA para este chat
    const botToggleHTML = `
        <button
            onclick="handleBotToggle('${contact.id}', ${!isBotActiveForContact})"
            class="p-2 rounded-full hover:bg-gray-200 transition-colors ${isBotActiveForContact ? 'text-green-500' : 'text-gray-400'}"
            title="${isBotActiveForContact ? 'Desactivar IA para este chat' : 'Activar IA para este chat'}">
            <i class="fas fa-robot text-xl"></i>
        </button>
    `;

    // Ensambla el HTML completo de la ventana de chat
    return `
        <div id="drag-drop-overlay-chat" class="drag-overlay hidden">
            <div class="drag-overlay-content">
                <i class="fas fa-file-import text-5xl mb-4"></i>
                <p>Suelta para adjuntar el archivo</p>
            </div>
        </div>
        <header class="chat-header p-2 shadow-sm flex items-center space-x-2">
            <div class="flex-shrink-0 pt-0.5">${UserIcon(contact)}</div>
            <div class="flex-grow">
                <h2 class="text-base font-semibold text-gray-800 cursor-pointer" onclick="openContactDetails()">${contact.name}</h2>
                <div class="flex items-center text-xs text-gray-500">
                    <span>+${contact.id}</span>
                    <button onclick="event.stopPropagation(); copyToClipboard('${contact.id}', this)" class="ml-2 text-gray-400 hover:text-primary transition-colors focus:outline-none" title="Copiar número"><i class="far fa-copy"></i></button>
                </div>
                <div id="contact-status-wrapper" class="mt-1.5"></div>
            </div>
            <div class="flex items-center pr-2">
                ${botToggleHTML}
            </div>
        </header>
        <div class="bg-white border-b border-gray-200 flex">
            <button class="tab-btn ${state.activeTab === 'chat' ? 'active' : ''}" onclick="setActiveTab('chat')"><i class="fas fa-comments mr-2"></i>Chat</button>
            <button class="tab-btn ${state.activeTab === 'notes' ? 'active' : ''}" onclick="setActiveTab('notes')"><i class="fas fa-sticky-note mr-2"></i>Notas Internas ${notesBadge}</button>
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

// Genera el HTML para la barra lateral de detalles del contacto
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

                <!-- --- NUEVA SECCIÓN PARA EL HISTORIAL DE PEDIDOS --- -->
                <div id="order-history-container" class="mt-4 border-t pt-4">
                     <h4 class="font-semibold text-gray-500 mb-3 text-sm uppercase tracking-wider">Historial de Pedidos</h4>
                     <div id="contact-orders-list" class="space-y-2">
                        <!-- El contenido se cargará dinámicamente -->
                     </div>
                </div>
                <!-- --- FIN DE LA NUEVA SECCIÓN --- -->

                <div class="mt-6 border-t pt-6 space-y-2">
                   <button onclick="handleMarkAsPurchase()" class="btn btn-secondary w-full btn-sm"><i class="fas fa-shopping-cart mr-2"></i>Registrar Compra (Meta)</button>
                   <button onclick="handleSendViewContent()" class="btn btn-subtle w-full btn-sm"><i class="fas fa-eye mr-2"></i>Enviar 'Contenido Visto' (Meta)</button>
                   <button onclick="openNewOrderModal()" class="btn btn-primary w-full btn-sm mt-4"><i class="fas fa-plus-circle mr-2"></i>Registrar Nuevo Pedido</button>
                </div>
            </div>
            <footer class="p-4 border-t border-gray-200">
                <button onclick="openEditContactModal('${contact.id}')" class="btn btn-secondary w-full">Editar Contacto</button>
            </footer>
        </div>
    `;
};


// Genera el HTML para un separador de fecha en el chat
const DateSeparatorTemplate = (dateString) => {
    return `<div class="date-separator date-separator-anchor">${dateString}</div>`;
};

// --- Plantilla para el modal de Nuevo Pedido (reubicada desde feature-handlers.js) ---
const NewOrderModalTemplate = () => `
    <div id="new-order-modal" class="modal-backdrop">
        <div class="modal-content">
            <button onclick="closeNewOrderModal()" class="modal-close-btn" title="Cerrar">&times;</button>
            <h2 class="!text-xl !font-bold !text-primary"><i class="fas fa-pencil-alt mr-2"></i> Registrar Nuevo Pedido</h2>
            <form id="new-order-form">
                 <div class="form-grid">
                     <div class="form-item">
                         <label for="order-product-select">Producto (*):</label>
                         <select id="order-product-select" required>
                            <option value="Modelo 7">Modelo 7</option>
                            <option value="Portallaves">Portallaves</option>
                            <option value="Calendario">Calendario</option>
                            <option value="Placa de perro">Placa de perro</option>
                            <option value="Otro">Otro</option>
                         </select>
                         <input type="text" id="order-product-other" style="display: none;" placeholder="Nombre del producto">
                     </div>
                     <div class="form-item">
                         <label for="order-phone">Teléfono (*):</label>
                         <input type="tel" id="order-phone" placeholder="Ej: 521..." required>
                     </div>
                     <div class="form-item">
                          <label for="order-price">Precio (MXN):</label>
                          <input type="number" id="order-price" step="0.01" placeholder="Ej: 275.00" value="275">
                      </div>

                      <div class="form-item form-item-full">
                           <label for="order-photo-file">Fotos del Pedido (Arrastra o pega imágenes):</label>
                           <div class="file-input-container" id="order-file-input-container-product" tabindex="0">
                               <input type="file" id="order-photo-file" accept="image/*" multiple>
                               <div class="file-input-header">
                                   <label for="order-photo-file" class="custom-file-upload">
                                       <i class="fas fa-upload"></i> Seleccionar
                                   </label>
                                   <span>o arrastra y suelta aquí</span>
                               </div>
                               <div class="previews-container" id="order-photos-preview-container"></div>
                           </div>
                      </div>
                     <div class="form-item form-item-full">
                         <label for="order-product-details">Detalles del Producto:</label>
                         <textarea id="order-product-details" placeholder="Describe los detalles específicos del producto solicitado..."></textarea>
                     </div>

                     <div class="form-item form-item-full">
                        <label for="order-promo-photo-file">Fotos de la Promoción:</label>
                        <div class="checkbox-container" id="order-same-photo-container" style="display: none;">
                            <input type="checkbox" id="order-same-photo-checkbox">
                            <label for="order-same-photo-checkbox">Usar la(s) misma(s) foto(s) del pedido</label>
                        </div>
                        <div class="file-input-container" id="order-file-input-container-promo" tabindex="0">
                            <input type="file" id="order-promo-photo-file" accept="image/*" multiple>
                            <div class="file-input-header">
                                <label for="order-promo-photo-file" class="custom-file-upload">
                                    <i class="fas fa-upload"></i> Seleccionar
                                </label>
                                <span>o arrastra y suelta aquí</span>
                            </div>
                            <div class="previews-container" id="order-promo-photos-preview-container"></div>
                        </div>
                    </div>
                    <div class="form-item form-item-full">
                        <label for="order-promo-details">Detalles de la Promoción:</label>
                        <textarea id="order-promo-details" placeholder="Describe la promoción aplicada, si existe..."></textarea>
                    </div>

                    <div class="form-item form-item-full">
                           <label for="order-comments">Comentarios Adicionales:</label>
                           <textarea id="order-comments" placeholder="Añade cualquier otra nota relevante sobre el pedido..."></textarea>
                    </div>
                 </div>
                 <div id="order-error-message"></div>
                 <div class="form-actions">
                      <button type="button" onclick="closeNewOrderModal()" class="btn btn-subtle"><i class="fas fa-times mr-2"></i> Cancelar</button>
                      <button type="submit" id="order-save-btn" class="btn btn-primary"><i class="fas fa-save mr-2"></i> Guardar Pedido</button>
                 </div>
             </form>
        </div>
    </div>
`;

// --- Plantilla para el modal de previsualización de conversación ---
const ConversationPreviewModalTemplate = (contact) => `
    <div id="conversation-preview-modal" class="modal-backdrop" onclick="closeConversationPreviewModal()">
        <div class="modal-content !p-0 !max-w-3xl !w-full" onclick="event.stopPropagation()">
            <div id="preview-chat-panel" class="h-full flex flex-col relative">
                <header class="chat-header p-2 shadow-sm flex items-center justify-between space-x-2">
                    <div class="flex items-center space-x-2">
                        <div class="flex-shrink-0 pt-0.5">${UserIcon(contact)}</div>
                        <div class="flex-grow">
                            <h2 class="text-base font-semibold text-gray-800">${contact.name}</h2>
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


// --- Plantilla para un item del historial de pedidos en la barra lateral ---
const OrderHistoryItemTemplate = (order) => {
    const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
    const estatus = order.estatus || 'Sin estatus';

    // Opciones del select de estatus
    const statusOptionsHTML = state.orderStatuses
        .map(status => `<option value="${status.key}" ${estatus === status.key ? 'selected' : ''} style="color: ${status.color}; font-weight: 600;">${status.label}</option>`)
        .join('');

    // Estilo inicial del select basado en el estatus actual
    const currentStatusStyle = state.orderStatuses.find(s => s.key === estatus) || { color: '#e9ecef' }; // Gris por defecto

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


// --- Plantilla para el modal de Edición de Pedido ---
const OrderEditModalTemplate = (order) => `
    <div id="order-edit-modal" class="modal-overlay" onclick="closeOrderEditModal()">
        <div class="modal-content" onclick="event.stopPropagation()">
            <button onclick="closeOrderEditModal()" class="modal-close-btn" title="Cerrar">&times;</button>
            <div id="editPedidoContainer">
                 <h2 id="editModalTitle"><i class="fas fa-edit"></i> Editar Pedido DH${order.consecutiveOrderNumber}</h2>
                 <form id="order-edit-form">
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
                          <button type="button" onclick="closeOrderEditModal()" class="btn btn-subtle"><i class="fas fa-times mr-2"></i> Cancelar</button>
                          <button type="submit" id="order-update-btn" class="btn btn-primary"><i class="fas fa-save mr-2"></i> Guardar Cambios</button>
                     </div>
                 </form>
            </div>
        </div>
    </div>
`;
