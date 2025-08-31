// --- START: Firebase Configuration ---
const firebaseConfig = { 
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg", 
    authDomain: "pedidos-con-gemini.firebaseapp.com", 
    projectId: "pedidos-con-gemini", 
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175", 
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a", 
    measurementId: "G-FTCDCMZB1S" 
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

const API_BASE_URL = 'https://crm-rzon.onrender.com';

// --- DOM Elements ---
const loadingOverlay = document.getElementById('loading-overlay');
const loginView = document.getElementById('login-view');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginErrorMessage = document.getElementById('login-error-message');
const logoutButton = document.getElementById('logout-button');
const userInfoEl = document.getElementById('user-info');

const mainViewContainer = document.getElementById('main-view-container');
const errorContainerEl = document.getElementById('error-container');
const errorMessageEl = document.getElementById('error-message');
      
// --- State Management ---
let state = { 
    contacts: [], 
    messages: [], 
    notes: [],
    quickReplies: [],
    adResponses: [],
    aiAdPrompts: [], 
    templates: [],
    tags: [],
    knowledgeBase: [],
    botSettings: { instructions: '' },
    awayMessageSettings: { isActive: true },
    globalBotSettings: { isActive: false },
    googleSheetSettings: { googleSheetId: '' },
    selectedContactId: null, 
    loadingMessages: false, 
    isUploading: false, 
    stagedFile: null,
    stagedRemoteFile: null,
    activeFilter: 'all',
    activeTab: 'chat',
    emojiPickerOpen: false,
    quickReplyPickerOpen: false,
    templatePickerOpen: false,
    contactDetailsOpen: false,
    isEditingNote: null,
    replyingToMessage: null, 
    campaignMode: false,
    selectedContactIdsForCampaign: [],
    isTagSidebarOpen: true,
    activeView: 'chats',
};
let unsubscribeMessagesListener = null, unsubscribeContactsListener = null, unsubscribeNotesListener = null, unsubscribeQuickRepliesListener = null, unsubscribeTagsListener = null, unsubscribeAdResponsesListener = null, unsubscribeKnowledgeBaseListener = null, unsubscribeAIAdPromptsListener = null;
let ticking = false;
let tagsSortable = null;
let dailyMessagesChart = null;
let tagsDistributionChart = null;


// --- START: Authentication Logic ---
auth.onAuthStateChanged(user => {
    if (user) {
        loginView.classList.add('hidden');
        loginView.classList.remove('flex');
        appContainer.classList.remove('hidden');
        appContainer.classList.add('flex');
        userInfoEl.textContent = `Usuario: ${user.email}`;
        startApp();
    } else {
        stopApp();
        loginView.classList.remove('hidden');
        loginView.classList.add('flex');
        appContainer.add('hidden');
        appContainer.classList.remove('flex');
        userInfoEl.textContent = '';
    }
    loadingOverlay.style.opacity = '0';
    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
});

loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const submitButton = loginForm.querySelector('button[type="submit"]');
    
    loginErrorMessage.textContent = '';
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Ingresando...';

    auth.signInWithEmailAndPassword(email, password)
        .catch(error => {
            let friendlyMessage = 'Correo o contraseña incorrectos.';
            if (error.code === 'auth/invalid-email') {
                friendlyMessage = 'El formato del correo es incorrecto.';
            }
            loginErrorMessage.textContent = friendlyMessage;
        })
        .finally(() => {
            submitButton.disabled = false;
            submitButton.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i> Ingresar';
        });
});

logoutButton.addEventListener('click', () => {
    auth.signOut();
});
// --- END: Authentication Logic ---

// --- START: FUNCIÓN AUXILIAR PARA FORMATEAR TEXTO ---
function formatWhatsAppText(text) {
    if (!text) return '';
    
    let safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    safeText = safeText.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    safeText = safeText.replace(/\n/g, '<br>');

    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    safeText = safeText.replace(urlRegex, (url) => {
        let href = url;
        if (!url.startsWith('http')) {
            href = 'https://' + url;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">${url}</a>`;
    });

    return safeText;
}
// --- END: FUNCIÓN AUXILIAR PARA FORMATEAR TEXTO ---

// --- NUEVA FUNCIÓN PARA COPIAR CON FORMATO ---
function copyFormattedText(text, buttonElement) {
    const formattedHtml = formatWhatsAppText(text).replace(/<br>/g, '\n');
    const plainText = formattedHtml.replace(/<[^>]+>/g, '');

    const listener = (e) => {
        e.preventDefault();
        e.clipboardData.setData('text/html', formattedHtml);
        e.clipboardData.setData('text/plain', plainText);
    };

    document.addEventListener('copy', listener);
    document.execCommand('copy');
    document.removeEventListener('copy', listener);
    
    const originalIconHTML = buttonElement.innerHTML;
    buttonElement.innerHTML = '<i class="fas fa-check text-green-500"></i>';
    buttonElement.disabled = true;
    setTimeout(() => {
        buttonElement.innerHTML = originalIconHTML;
        buttonElement.disabled = false;
    }, 1500);
}

// --- PLANTILLAS DE VISTAS ---

const ChatViewTemplate = () => `
    <div id="chat-view">
        <aside id="contacts-panel" class="w-full md:w-1/3 lg:w-1/4 h-full flex flex-col">
            <div class="p-4 border-b border-gray-200">
                <input type="text" id="search-contacts-input" oninput="handleSearchContacts()" placeholder="Buscar o iniciar un nuevo chat..." class="w-full">
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

// --- INICIO: Nueva plantilla para campañas con imagen ---
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
// --- FIN: Nueva plantilla ---

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
                    <th>ID del Anuncio</th>
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

// --- NUEVA VISTA PARA AJUSTES DE IA ---
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

// NUEVA PLANTILLA PARA MÉTRICAS
const MetricsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Métricas de Mensajes</h1>
        </div>
        <div id="metrics-loading" class="text-center p-8">
            <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
            <p class="mt-4 text-gray-600">Cargando datos...</p>
        </div>
        <div id="metrics-content" class="hidden">
            <div class="metrics-grid">
                <div class="chart-container">
                    <h2>Mensajes Recibidos por Día (Últimos 30 días)</h2>
                    <canvas id="daily-messages-chart"></canvas>
                </div>
                <div class="chart-container">
                    <h2>Distribución de Mensajes por Etiqueta</h2>
                    <canvas id="tags-distribution-chart"></canvas>
                </div>
            </div>
        </div>
    </div>
`;

// --- PLANTILLAS DE COMPONENTES ---
const UserIcon = (contact, size = 'h-9 w-9') => {
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
    
    let timeOrBadgeHTML = '';
    if (contact.unreadCount > 0) {
        timeOrBadgeHTML = `<span class="unread-badge">${contact.unreadCount}</span>`;
    } else if (contact.lastMessageTimestamp) {
        const date = contact.lastMessageTimestamp.toDate();
        const timeString = isSameDay(new Date(), date)
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
        timeOrBadgeHTML = `<span class="text-xs text-gray-400">${timeString}</span>`;
    }

    const mainContent = `
        <div class="flex-grow overflow-hidden ml-2">
            <div class="flex justify-between items-center">
                <h3 class="font-semibold text-sm text-gray-800 truncate">${contact.name || 'Desconocido'}</h3>
                ${timeOrBadgeHTML}
            </div>
            <p class="text-xs truncate pr-2 text-gray-500">${typingText}</p>
        </div>`;

    const onClickAction = `onclick="handleSelectContact('${contact.id}')"`;

    return `<div ${onClickAction} class="contact-item flex items-center p-1.5 cursor-pointer ${isSelected ? 'selected' : ''}" data-contact-id="${contact.id}">
                ${UserIcon(contact)}
                ${mainContent}
            </div>`;
};

const MessageStatusIconTemplate = (status) => {
    const sentColor = '#9ca3af';
    const readColor = '#53bdeb';
    switch (status) {
        case 'read': return `<i class="fas fa-check-double" style="color: ${readColor};"></i>`;
        case 'delivered': return `<i class="fas fa-check-double" style="color: ${sentColor};"></i>`;
        case 'sent': return `<i class="fas fa-check" style="color: ${sentColor};"></i>`;
        default: return '';
    }
};

const RepliedMessagePreviewTemplate = (originalMessage) => {
    if (!originalMessage) return '';
    const authorName = originalMessage.from === state.selectedContactId ? state.contacts.find(c => c.id === state.selectedContactId)?.name || 'Cliente' : 'Tú';
    
    let textPreview = originalMessage.text || 'Mensaje'; // Valor por defecto
    if (originalMessage.type === 'audio') {
        textPreview = '🎤 Mensaje de voz';
    } else if (originalMessage.type === 'image' || originalMessage.fileType?.startsWith('image/')) {
        textPreview = '📷 Imagen';
    } else if (originalMessage.type === 'video' || originalMessage.fileType?.startsWith('video/')) {
        textPreview = '🎥 Video';
    } else if (originalMessage.type === 'location') {
        textPreview = '📍 Ubicación';
    } else if (originalMessage.fileType) { // Otros documentos
        textPreview = '📄 Documento';
    }

    return `
        <div class="reply-preview">
            <p class="reply-author">${authorName}</p>
            <p class="reply-text">${textPreview}</p>
        </div>
    `;
};

const MessageBubbleTemplate = (message) => {
    const isSent = message.from !== state.selectedContactId;
    const time = message.timestamp && typeof message.timestamp.seconds === 'number' 
        ? new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        : '';
    
    let contentHTML = '';
    let bubbleExtraClass = '';
    let timeAndStatusHTML = `<div class="text-xs text-right mt-1 opacity-70 flex justify-end items-center space-x-2"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status) : ''}</div>`;
    
    const hasMedia = message.fileUrl || message.mediaProxyUrl;
    const hasText = message.text && !message.text.startsWith('🎤') && !message.text.startsWith('🎵') && !message.text.startsWith('📷');

    if (message.type === 'audio' && message.mediaProxyUrl) {
        contentHTML += `<audio controls class="w-full max-w-xs"><source src="${message.mediaProxyUrl}" type="${message.audio?.mime_type || 'audio/ogg'}">Tu navegador no soporta audios.</audio>`;
    } else if (message.fileUrl && message.fileType) {
        if (message.fileType.startsWith('image/')) {
            bubbleExtraClass = 'has-image';
            const sentBgClass = isSent ? `bg-[${'var(--color-bubble-sent-bg)'}]` : `bg-[${'var(--color-bubble-received-bg)'}]`;
            contentHTML += `
                <div class="${sentBgClass} rounded-lg overflow-hidden">
                    <img src="${message.fileUrl}" alt="Imagen enviada" class="chat-image-preview" onclick="openImageModal('${message.fileUrl}')">
                    ${hasText ? `<div class="p-2 pt-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>` : ''}
                    <div class="time-overlay"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status) : ''}</div>
                </div>`;
            timeAndStatusHTML = '';
        } else if (message.fileType.startsWith('video/')) {
            const videoUrl = message.timestamp ? `${message.fileUrl}?v=${message.timestamp.seconds}` : message.fileUrl;
            contentHTML += `<video controls class="message-bubble video rounded-lg mb-1"><source src="${videoUrl}" type="${message.fileType}">Tu navegador no soporta videos.</video>`;
            if(hasText) contentHTML += `<div class="px-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
        }
    } else if (message.type === 'location' && message.location) {
        const { latitude, longitude, name, address } = message.location;
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
        contentHTML += `
            <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="block text-blue-600 hover:underline">
                <div class="font-semibold"><i class="fas fa-map-marker-alt mr-2 text-red-500"></i>${name || 'Ubicación'}</div>
                ${address ? `<p class="text-xs text-gray-500 mt-1">${address}</p>` : ''}
                <p class="text-xs mt-1">Toca para ver en el mapa</p>
            </a>
        `;
    } else if (hasText) {
         contentHTML += `<div><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
    }
    
    let replyPreviewHTML = '';
    if (message.context && message.context.id) {
        const originalMessage = state.messages.find(m => m.id === message.context.id);
        replyPreviewHTML = RepliedMessagePreviewTemplate(originalMessage);
    }

    const copyButtonHTML = hasText
        ? `<button class="message-action-btn" onclick="copyFormattedText('${message.text.replace(/'/g, '\\\'')}', this)" title="Copiar"><i class="far fa-copy"></i></button>`
        : '';

    const reactionPopoverHTML = `
        <div class="reaction-popover-container">
            <button class="message-action-btn" title="Reaccionar"><i class="far fa-smile"></i></button>
            <div class="reaction-popover">
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '👍')">👍</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '❤️')">❤️</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '😂')">😂</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '🙏')">🙏</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '🎉')">🎉</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '😢')">😢</button>
            </div>
        </div>
    `;

    const actionsHTML = `
        <div class="message-actions">
            <button class="message-action-btn" onclick="handleStartReply(event, '${message.docId}')" title="Responder"><i class="fas fa-reply"></i></button>
            ${reactionPopoverHTML}
            ${copyButtonHTML}
        </div>
    `;

    const reactionHTML = message.reaction ? `<div class="reactions-container ${isSent ? '' : 'received-reaction'}">${message.reaction}</div>` : '';

    const bubbleAlignment = isSent ? 'justify-end' : 'justify-start';
    const bubbleClasses = isSent ? 'sent' : 'received';
    
    return `
        <div class="flex my-1 ${bubbleAlignment}">
            <div class="message-bubble ${bubbleClasses} ${bubbleExtraClass}">
                ${actionsHTML}
                ${replyPreviewHTML}
                ${contentHTML}
                ${timeAndStatusHTML}
                ${reactionHTML}
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

const LocalFilePreviewTemplate = (file) => { const objectURL = URL.createObjectURL(file); const isImage = file.type.startsWith('image/'); const previewElement = isImage ? `<img src="${objectURL}" alt="Vista previa">` : `<video src="${objectURL}" alt="Vista previa"></video>`; return ` <div class="file-preview-content"> <div id="cancel-file-btn" onclick="cancelStagedFile()"><i class="fas fa-times"></i></div> ${previewElement} <div class="ml-3 text-sm text-gray-600 truncate"> <p class="font-semibold">${file.name}</p> <p>${(file.size / 1024).toFixed(1)} KB</p> </div> </div>`; };
const RemoteFilePreviewTemplate = (file) => { const isImage = file.type.startsWith('image/'); const previewElement = isImage ? `<img src="${file.url}" alt="Vista previa">` : `<video src="${file.url}" alt="Vista previa"></video>`; return ` <div class="file-preview-content"> <div id="cancel-file-btn" onclick="cancelStagedFile()"><i class="fas fa-times"></i></div> ${previewElement} <div class="ml-3 text-sm text-gray-600 truncate"> <p class="font-semibold">${file.name || 'Archivo adjunto'}</p></div> </div>`; };

const StatusButtonsTemplate = (contact) => {
    let buttonsHtml = '<div class="status-btn-group">';
    state.tags.forEach(tag => {
        const isActive = contact.status === tag.key;
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

const ChatWindowTemplate = (contact) => {
    const emptyChat = `<div class="flex-1 flex flex-col items-center justify-center text-gray-500 bg-opacity-50 bg-white"><i class="fab fa-whatsapp-square text-8xl mb-4 text-gray-300"></i><h2 class="text-xl font-semibold">Selecciona un chat para empezar</h2><p>Mantén tu CRM conectado y organizado.</p></div>`;
    if (!contact) { return emptyChat; }

    const footerContent = `
        <form id="message-form" class="flex items-center space-x-3">
             <label for="file-input" class="cursor-pointer p-2 chat-icon-btn"><i class="fas fa-paperclip text-xl"></i></label>
             <input type="file" id="file-input" onchange="handleFileInputChange(event)" accept="image/*,video/*">
             <button type="button" id="emoji-toggle-btn" onclick="toggleEmojiPicker()" class="p-2 chat-icon-btn"><i class="far fa-smile text-xl"></i></button>
             <button type="button" id="template-toggle-btn" onclick="toggleTemplatePicker()" class="p-2 chat-icon-btn" title="Enviar plantilla"><i class="fas fa-scroll"></i></button>
             <button type="button" id="generate-reply-btn" onclick="handleGenerateReply()" class="p-2 chat-icon-btn" title="Contestar con IA"><i class="fas fa-magic"></i></button>
             <textarea id="message-input" placeholder="Escribe un mensaje o usa / para respuestas rápidas..." class="flex-1 !p-0 !mb-0" rows="1"></textarea>
             <button type="submit" class="btn btn-primary rounded-full w-12 h-12 p-0"><i class="fas fa-paper-plane text-lg"></i></button>
        </form>`;
    
    const mainContent = state.activeTab === 'chat'
        ? `<main id="messages-container" class="relative flex-1 p-4 overflow-y-auto"><div id="sticky-date-header" class="date-separator"></div><div id="messages-content"></div></main>`
        : `<main id="notes-container" class="relative flex-1 p-4 overflow-y-auto bg-white">
             <form id="note-form" class="mb-4">
               <textarea id="note-input" placeholder="Escribe una nota interna..." class="!mb-2" rows="3"></textarea>
               <button type="submit" class="btn btn-primary btn-sm">Guardar Nota</button>
             </form>
             <div id="notes-content"></div>
           </main>`;
    
    const notesBadge = state.notes.length > 0 ? `<span class="note-count-badge">${state.notes.length}</span>` : '';
    const replyContextBarHTML = state.replyingToMessage ? `<div id="reply-context-bar">${ReplyContextBarTemplate(state.replyingToMessage)}</div>` : '';

    const isBotActiveForContact = contact.botActive !== false;
    const botToggleHTML = `
        <button 
            onclick="handleBotToggle('${contact.id}', ${!isBotActiveForContact})" 
            class="p-2 rounded-full hover:bg-gray-200 transition-colors ${isBotActiveForContact ? 'text-green-500' : 'text-gray-400'}" 
            title="${isBotActiveForContact ? 'Desactivar IA para este chat' : 'Activar IA para este chat'}">
            <i class="fas fa-robot text-xl"></i>
        </button>
    `;

    return `
        <div id="drag-drop-overlay" class="drag-overlay hidden"><div class="drag-overlay-content"><i class="fas fa-file-import text-5xl mb-4"></i><p>Suelta el archivo para adjuntarlo</p></div></div>
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

    const isRegistered = contact.registrationStatus === 'completed';
    const registrationButtonClass = isRegistered ? 'btn-success' : 'btn-subtle';
    const registrationButtonIcon = isRegistered ? 'fa-check-circle' : 'fa-user-check';

    const registrationButtonHTML = `
        <button 
            onclick="handleMarkAsRegistration()" 
            class="btn ${registrationButtonClass} w-full btn-sm">
            <i class="fas ${registrationButtonIcon} mr-2"></i>Aquí no se le pica
        </button>`;

    return `
        <div class="h-full flex flex-col">
            <header class="p-4 flex items-center justify-between border-b border-gray-200">
                <h3 class="font-semibold text-lg">Detalles del contacto</h3>
                <button onclick="closeContactDetails()" class="text-gray-500 hover:text-gray-800"><i class="fas fa-times"></i></button>
            </header>
            <div class="flex-1 p-6 overflow-y-auto">
                <div class="text-center mb-6">
                    ${UserIcon(contact, 'h-24 w-24')}
                    <h2 class="text-2xl font-bold mt-4">${contact.name || 'Desconocido'}</h2>
                    <p class="text-gray-500">+${contact.id}</p>
                </div>
                <div class="space-y-4 text-sm">
                    <div>
                        <p class="font-semibold text-gray-400">Correo Electrónico</p>
                        <p>${contact.email || 'No especificado'}</p>
                    </div>
                    <div>
                        <p class="font-semibold text-gray-400">Apodo</p>
                        <p>${contact.nickname || 'No especificado'}</p>
                    </div>
                </div>
                <div class="mt-6 border-t pt-6 space-y-2">
                   <button onclick="handleMarkAsPurchase()" class="btn btn-secondary w-full btn-sm"><i class="fas fa-shopping-cart mr-2"></i>Aquí se le pica si registras el pedido</button>
                   ${registrationButtonHTML}
                   <button onclick="handleSendViewContent()" class="btn btn-subtle w-full btn-sm"><i class="fas fa-eye mr-2"></i>Enviar 'Contenido Visto'</button>
                </div>
            </div>
            <footer class="p-4 border-t border-gray-200">
                <button onclick="openEditContactModal('${contact.id}')" class="btn btn-primary w-full">Editar Contacto</button>
            </footer>
        </div>
    `;
};

// --- START: FUNCIONES DE FECHA ---
function isSameDay(d1, d2) {
    if (!d1 || !d2) return false;
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function formatDateSeparator(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (isSameDay(date, today)) {
        return 'Hoy';
    }
    if (isSameDay(date, yesterday)) {
        return 'Ayer';
    }
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

const DateSeparatorTemplate = (dateString) => {
    return `<div class="date-separator date-separator-anchor">${dateString}</div>`;
};
// --- END: FUNCIONES DE FECHA ---

// --- INICIALIZACIÓN DE LA APP ---
function startApp() { 
    navigateTo(state.activeView);
    listenForContacts(); 
    listenForQuickReplies();
    listenForTags();
    listenForAdResponses();
    listenForAIAdPrompts();
    listenForKnowledgeBase();
    fetchTemplates();
    fetchBotSettings();
    fetchAwayMessageSettings();
    fetchGlobalBotSettings();
    fetchGoogleSheetSettings();
    document.addEventListener('click', handleClickOutside);
}

function stopApp() { 
    if (unsubscribeContactsListener) unsubscribeContactsListener(); 
    if (unsubscribeMessagesListener) unsubscribeMessagesListener(); 
    if (unsubscribeNotesListener) unsubscribeNotesListener();
    if (unsubscribeQuickRepliesListener) unsubscribeQuickRepliesListener();
    if (unsubscribeTagsListener) unsubscribeTagsListener();
    if (unsubscribeAdResponsesListener) unsubscribeAdResponsesListener();
    if (unsubscribeKnowledgeBaseListener) unsubscribeKnowledgeBaseListener();
    if (unsubscribeAIAdPromptsListener) unsubscribeAIAdPromptsListener();
    document.removeEventListener('click', handleClickOutside);
    state = { contacts: [], messages: [], notes: [], quickReplies: [], adResponses: [], aiAdPrompts: [], templates: [], tags: [], knowledgeBase: [], botSettings: { instructions: '' }, awayMessageSettings: { isActive: true }, globalBotSettings: { isActive: false }, googleSheetSettings: { googleSheetId: '' }, selectedContactId: null, loadingMessages: false, isUploading: false, stagedFile: null, stagedRemoteFile: null, activeFilter: 'all', activeTab: 'chat', emojiPickerOpen: false, quickReplyPickerOpen: false, templatePickerOpen: false, contactDetailsOpen: false, isEditingNote: null, replyingToMessage: null, campaignMode: false, selectedContactIdsForCampaign: [], isTagSidebarOpen: true, activeView: 'chats' }; 
    mainViewContainer.innerHTML = '';
}

// --- NAVEGACIÓN Y RENDERIZADO DE VISTAS ---
function navigateTo(viewName) {
    state.activeView = viewName;

    const iaSubmenuViews = ['prompts-ia', 'respuestas-ia', 'ajustes-ia'];

    document.querySelectorAll('#main-sidebar .nav-item').forEach(item => {
        const isDirectMatch = item.dataset.view === viewName;
        item.classList.toggle('active', isDirectMatch);
    });

    const iaMenu = document.getElementById('ia-menu')?.querySelector('.nav-item');
    if (iaMenu) {
        const isIAViewActive = iaSubmenuViews.includes(viewName);
        iaMenu.classList.toggle('active', isIAViewActive);
        if (isIAViewActive) {
            document.getElementById('ia-submenu').classList.remove('hidden');
            document.getElementById('ia-menu-chevron').classList.add('rotate-180');
        }
    }

    switch (viewName) {
        case 'chats':
            mainViewContainer.innerHTML = ChatViewTemplate();
            renderChatWindow(); 
            listenForContacts(); 
            break;
        case 'pipeline':
            mainViewContainer.innerHTML = PipelineViewTemplate();
            renderPipelineView();
            break;
        case 'contacts':
            mainViewContainer.innerHTML = ContactsViewTemplate();
            renderContactsView();
            break;
        case 'etiquetas':
            mainViewContainer.innerHTML = TagsViewTemplate();
            renderTagsView();
            break;
        case 'campanas':
            mainViewContainer.innerHTML = CampaignsViewTemplate();
            renderCampaignsView();
            break;
        // --- INICIO: Nuevo caso para la vista de campañas con imagen ---
        case 'campanas-imagen':
            mainViewContainer.innerHTML = CampaignsWithImageViewTemplate();
            renderCampaignsWithImageView();
            break;
        // --- FIN: Nuevo caso ---
        case 'mensajes-ads':
            mainViewContainer.innerHTML = MensajesAdsViewTemplate();
            renderAdResponsesView();
            break;
        case 'prompts-ia':
            mainViewContainer.innerHTML = AIAdPromptsViewTemplate();
            renderAIAdPromptsView();
            break;
        case 'respuestas-rapidas':
            mainViewContainer.innerHTML = QuickRepliesViewTemplate();
            renderQuickRepliesView();
            break;
        case 'respuestas-ia':
            mainViewContainer.innerHTML = KnowledgeBaseViewTemplate();
            renderKnowledgeBaseView();
            break;
        case 'ajustes-ia':
            mainViewContainer.innerHTML = AjustesIAViewTemplate();
            renderAjustesIAView();
            break;
        case 'metricas':
            mainViewContainer.innerHTML = MetricsViewTemplate();
            renderMetricsView();
            break;
        case 'ajustes':
            mainViewContainer.innerHTML = SettingsViewTemplate();
            renderAjustesView();
            break;
        default:
            mainViewContainer.innerHTML = `<div class="p-8"><h1 class="text-2xl font-bold">En construcción</h1><p class="mt-4 text-gray-600">Esta sección estará disponible próximamente.</p></div>`;
    }
}

function renderChatWindow() { 
    if (state.activeView !== 'chats') return;
    
    const chatPanelEl = document.getElementById('chat-panel');
    if (!chatPanelEl) return;

    const contact = state.contacts.find(c => c.id === state.selectedContactId); 
    chatPanelEl.innerHTML = ChatWindowTemplate(contact); 
    
    if (contact) { 
        const statusWrapper = document.getElementById('contact-status-wrapper');
        if (statusWrapper) { statusWrapper.innerHTML = StatusButtonsTemplate(contact); }
        if (state.activeTab === 'chat') {
            renderMessages();
            const messagesContainer = document.getElementById('messages-container'); 
            if (messagesContainer) { messagesContainer.addEventListener('scroll', () => { if (!ticking) { window.requestAnimationFrame(() => { handleScroll(); ticking = false; }); ticking = true; } }); }
            
            const messageForm = document.getElementById('message-form');
            const messageInput = document.getElementById('message-input'); 
            if (messageForm) messageForm.addEventListener('submit', handleSendMessage); 
            if (messageInput) { 
                messageInput.addEventListener('paste', handlePaste); 
                messageInput.addEventListener('input', handleQuickReplyInput);
                
                messageInput.addEventListener('input', () => {
                    messageInput.style.height = 'auto';
                    let newHeight = messageInput.scrollHeight;
                    if (newHeight > 120) {
                        newHeight = 120;
                    }
                    messageInput.style.height = newHeight + 'px';
                });
                messageInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        document.getElementById('message-form').requestSubmit();
                    }
                });

                messageInput.focus(); 
            } 
            setupDragAndDrop(); 
            
        } else if (state.activeTab === 'notes') {
            renderNotes();
            document.getElementById('note-form').addEventListener('submit', handleSaveNote);
        }
    } 
}

function renderTagsView() {
    if (state.activeView !== 'etiquetas') return;
    const tableBody = document.getElementById('tags-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = state.tags.map(tag => `
        <tr class="draggable-row" data-id="${tag.id}">
            <td class="drag-handle text-center"><i class="fas fa-grip-vertical"></i></td>
            <td class="font-semibold">${tag.label}</td>
            <td>
                <div class="tag-color-cell">
                    <span class="tag-color-swatch" style="background-color: ${tag.color};"></span>
                    <span>${tag.color}</span>
                </div>
            </td>
            <td class="actions-cell">
                <button onclick="openTagModal(state.tags.find(t => t.id === '${tag.id}'))" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteTag('${tag.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');

    initTagsSortable();
}

function renderContactsView() {
    if (state.activeView !== 'contacts') return;
    const tableBody = document.getElementById('contacts-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = state.contacts.map(contact => {
         const tag = state.tags.find(t => t.key === contact.status) || { label: 'Sin etiqueta', color: '#d1d5db' };
        return `
            <tr>
                <td class="font-semibold">${contact.name || 'Desconocido'}</td>
                <td>${contact.id}</td>
                <td>${contact.email || 'N/A'}</td>
                <td>
                    <span class="px-2 py-1 text-xs rounded-full text-white" style="background-color: ${tag.color};">${tag.label}</span>
                </td>
                <td class="actions-cell">
                    <a href="https://wa.me/${contact.id}" target="_blank" class="p-2"><i class="fab fa-whatsapp"></i></a>
                    <button onclick="openEditContactModal('${contact.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                    <button onclick="handleDeleteContact('${contact.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>
        `
    }).join('');
}

function renderCampaignsView() {
    if (state.activeView !== 'campanas') return;
    const tagSelect = document.getElementById('campaign-tag-select');
    const templateSelect = document.getElementById('campaign-template-select');

    if (tagSelect) {
        tagSelect.innerHTML = '<option value="all">Todos los contactos</option>' + state.tags.map(tag => `<option value="${tag.key}">${tag.label}</option>`).join('');
    }
    if (templateSelect) {
        templateSelect.innerHTML = '<option value="">-- Selecciona una plantilla --</option>' + state.templates.map(t => `<option value='${JSON.stringify(t)}'>${t.name} (${t.language})</option>`).join('');
    }
    updateCampaignRecipientCount();
}

// --- INICIO: Nueva función para renderizar la vista de campañas con imagen ---
function renderCampaignsWithImageView() {
    if (state.activeView !== 'campanas-imagen') return;
    const tagSelect = document.getElementById('campaign-image-tag-select');
    const templateSelect = document.getElementById('campaign-image-template-select');

    if (tagSelect) {
        tagSelect.innerHTML = '<option value="all">Todos los contactos</option>' + state.tags.map(tag => `<option value="${tag.key}">${tag.label}</option>`).join('');
    }
    if (templateSelect) {
        // Filtramos para mostrar solo plantillas que tengan un componente HEADER de tipo IMAGE
        const imageTemplates = state.templates.filter(t => t.components.some(c => c.type === 'HEADER' && c.format === 'IMAGE'));
        templateSelect.innerHTML = '<option value="">-- Selecciona una plantilla --</option>' + imageTemplates.map(t => `<option value='${t.name}'>${t.name} (${t.language})</option>`).join('');
    }
    updateCampaignRecipientCount('image');
}
// --- FIN: Nueva función ---

function renderQuickRepliesView() {
    if (state.activeView !== 'respuestas-rapidas') return;
    const tableBody = document.getElementById('quick-replies-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = state.quickReplies.map(reply => `
        <tr>
            <td class="font-semibold">/${reply.shortcut}</td>
            <td class="text-gray-600">${reply.message || ''} ${reply.fileUrl ? '<i class="fas fa-paperclip text-gray-400 ml-2"></i>' : ''}</td>
            <td class="actions-cell">
                <button onclick="openQuickReplyModal('${reply.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteQuickReply('${reply.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

function renderAdResponsesView() {
    if (state.activeView !== 'mensajes-ads') return;
    const tableBody = document.getElementById('ad-responses-table-body');
    if (!tableBody) return;

    if (state.adResponses.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-4">No has agregado ningún mensaje de anuncio todavía.</td></tr>`;
        return;
    }

    tableBody.innerHTML = state.adResponses.map(response => `
        <tr>
            <td class="font-semibold">${response.adName}</td>
            <td class="font-mono text-sm">${response.adId}</td>
            <td class="text-gray-600 max-w-sm truncate" title="${response.message}">${response.message || ''} ${response.fileUrl ? '<i class="fas fa-paperclip text-gray-400 ml-2"></i>' : ''}</td>
            <td class="actions-cell">
                <button onclick="openAdResponseModal('${response.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteAdResponse('${response.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

function renderAIAdPromptsView() {
    if (state.activeView !== 'prompts-ia') return;
    const tableBody = document.getElementById('ai-ad-prompts-table-body');
    if (!tableBody) return;

    if (state.aiAdPrompts.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-4">No has agregado ningún prompt de IA todavía.</td></tr>`;
        return;
    }

    tableBody.innerHTML = state.aiAdPrompts.map(prompt => `
        <tr>
            <td class="font-semibold">${prompt.adName}</td>
            <td class="font-mono text-sm">${prompt.adId}</td>
            <td class="text-gray-600 max-w-sm truncate" title="${prompt.prompt}">${prompt.prompt}</td>
            <td class="actions-cell">
                <button onclick="openAIAdPromptModal('${prompt.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteAIAdPrompt('${prompt.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

function renderPipelineView() {
    if (state.activeView !== 'pipeline') return;
    const container = document.getElementById('pipeline-container');
    if (!container) return;

    container.innerHTML = state.tags.map(tag => {
        const contactsInStage = state.contacts.filter(c => c.status === tag.key);
        const totalUnread = contactsInStage.reduce((sum, contact) => sum + (contact.unreadCount || 0), 0);
        const unreadHeaderBadge = totalUnread > 0 ? `<span class="unread-badge !bg-red-500">${totalUnread}</span>` : '';

        return `
            <div class="pipeline-column">
                <div class="pipeline-header">
                    <span class="tag-color-swatch" style="background-color: ${tag.color};"></span>
                    <span class="font-bold">${tag.label}</span>
                    <span class="ml-auto text-sm font-normal text-gray-500 flex items-center gap-2">
                        ${unreadHeaderBadge}
                        <span class="flex items-center gap-1"><i class="fas fa-user"></i> ${contactsInStage.length}</span>
                    </span>
                </div>
                <div class="pipeline-cards" data-tag-key="${tag.key}">
                    ${contactsInStage.map(contact => {
                        const unreadBadge = contact.unreadCount > 0 ? `<span class="unread-badge">${contact.unreadCount}</span>` : '';
                        return `
                        <div class="pipeline-card" data-contact-id="${contact.id}" style="border-left-color: ${tag.color};" onclick="handleSelectContactFromPipeline('${contact.id}')">
                            <div class="flex justify-between items-start">
                                <div class="contact-name">${contact.name || 'Desconocido'}</div>
                                ${unreadBadge}
                            </div>
                            <p class="last-message">${contact.lastMessage || 'Sin mensajes'}</p>
                        </div>
                        `
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
    
    document.querySelectorAll('.pipeline-cards').forEach(column => {
        new Sortable(column, {
            group: 'pipeline',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                const contactId = evt.item.dataset.contactId;
                const newTagKey = evt.to.dataset.tagKey;
                handleStatusChange(contactId, newTagKey);
            }
        });
    });
}

function renderKnowledgeBaseView() {
    if (state.activeView !== 'respuestas-ia') return;
    const kbTableBody = document.getElementById('kb-table-body');
    if (!kbTableBody) return;

    kbTableBody.innerHTML = state.knowledgeBase.map(entry => `
        <tr>
            <td class="font-semibold">${entry.topic}</td>
            <td class="text-gray-600">${entry.answer} ${entry.fileUrl ? '<i class="fas fa-paperclip text-gray-400 ml-2"></i>' : ''}</td>
            <td class="actions-cell">
                <button onclick="openKnowledgeBaseModal('${entry.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteKnowledgeBaseEntry('${entry.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

function renderAjustesIAView() {
    if (state.activeView !== 'ajustes-ia') return;
    
    const botToggle = document.getElementById('global-bot-toggle');
    if (botToggle) {
        botToggle.checked = state.globalBotSettings.isActive;
    }

    const botContactsTableBody = document.getElementById('bot-contacts-table-body');
    if(botContactsTableBody) {
        botContactsTableBody.innerHTML = state.contacts.map(contact => `
            <tr>
                <td class="font-semibold">${contact.name || contact.id}</td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" onchange="handleBotToggle('${contact.id}', this.checked)" ${contact.botActive !== false ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </td>
            </tr>
        `).join('');
    }
}

function renderAjustesView() {
    if (state.activeView !== 'ajustes') return;
    const awayToggle = document.getElementById('away-message-toggle');
    if (awayToggle) {
        awayToggle.checked = state.awayMessageSettings.isActive;
    }
    
    const sheetIdInput = document.getElementById('google-sheet-id-input');
    if (sheetIdInput) {
        sheetIdInput.value = state.googleSheetSettings.googleSheetId || '';
    }
    const saveSheetIdBtn = document.getElementById('save-google-sheet-id-btn');
    if (saveSheetIdBtn) {
        saveSheetIdBtn.addEventListener('click', handleSaveGoogleSheetId);
    }
    const simulateAdForm = document.getElementById('simulate-ad-form');
    if (simulateAdForm) {
        simulateAdForm.addEventListener('submit', handleSimulateAdMessage);
    }
}

// --- NUEVA FUNCIÓN PARA RENDERIZAR LA VISTA DE MÉTRICAS ---
async function renderMetricsView() {
    if (state.activeView !== 'metricas') return;

    const loadingEl = document.getElementById('metrics-loading');
    const contentEl = document.getElementById('metrics-content');

    try {
        const response = await fetch(`${API_BASE_URL}/api/metrics`);
        if (!response.ok) {
            throw new Error('No se pudieron cargar los datos de métricas.');
        }
        const result = await response.json();
        const metricsData = result.data;

        loadingEl.classList.add('hidden');
        contentEl.classList.remove('hidden');
        
        renderDailyMessagesChart(metricsData);
        renderTagsDistributionChart(metricsData);

    } catch (error) {
        console.error("Error fetching metrics:", error);
        showError(error.message);
        loadingEl.innerHTML = `<p class="text-red-500">${error.message}</p>`;
    }
}

function renderDailyMessagesChart(data) {
    const ctx = document.getElementById('daily-messages-chart')?.getContext('2d');
    if (!ctx) return;

    if (dailyMessagesChart) {
        dailyMessagesChart.destroy();
    }

    const labels = data.map(d => new Date(d.date).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }));
    const totalMessages = data.map(d => d.totalMessages);

    dailyMessagesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Mensajes Recibidos',
                data: totalMessages,
                backgroundColor: 'rgba(129, 178, 154, 0.6)',
                borderColor: 'rgba(129, 178, 154, 1)',
                borderWidth: 1,
                borderRadius: 5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

function renderTagsDistributionChart(data) {
    const ctx = document.getElementById('tags-distribution-chart')?.getContext('2d');
    if (!ctx) return;

    if (tagsDistributionChart) {
        tagsDistributionChart.destroy();
    }

    const tagCounts = {};
    data.forEach(dailyData => {
        for (const tagKey in dailyData.tags) {
            if (!tagCounts[tagKey]) {
                tagCounts[tagKey] = 0;
            }
            tagCounts[tagKey] += dailyData.tags[tagKey];
        }
    });

    const tagInfoMap = state.tags.reduce((acc, tag) => {
        acc[tag.key] = { label: tag.label, color: tag.color };
        return acc;
    }, {});
    tagInfoMap['sin_etiqueta'] = { label: 'Sin Etiqueta', color: '#a0aec0' };

    const labels = Object.keys(tagCounts).map(key => tagInfoMap[key]?.label || key);
    const counts = Object.values(tagCounts);
    const backgroundColors = Object.keys(tagCounts).map(key => tagInfoMap[key]?.color || '#a0aec0');

    tagsDistributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'Distribución por Etiqueta',
                data: counts,
                backgroundColor: backgroundColors,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += context.parsed;
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}


function updateCampaignRecipientCount(type = 'text') {
    const prefix = type === 'image' ? 'image-' : '';
    const tagSelect = document.getElementById(`campaign-${prefix}tag-select`);
    const phoneInput = document.getElementById(`campaign-${prefix}phone-input`);
    const display = document.getElementById(`recipient-count-display-${type === 'image' ? 'image' : ''}`);
    if (!display) return;

    // Si se escribe un número, desactiva la selección de etiquetas
    if (phoneInput && phoneInput.value.trim()) {
        if (tagSelect) {
            tagSelect.value = 'all'; // Reinicia la selección
            tagSelect.disabled = true;
        }
        display.textContent = `Se enviará a 1 número.`;
        return;
    }

    // Si el campo de número está vacío, reactiva la selección de etiquetas
    if (tagSelect) {
        tagSelect.disabled = false;
    }

    const selectedTagKey = tagSelect.value;
    let recipients = [];

    if (selectedTagKey === 'all') {
        recipients = state.contacts;
    } else {
        recipients = state.contacts.filter(c => c.status === selectedTagKey);
    }
    
    display.textContent = `Se enviará a ${recipients.length} contactos.`;
}

// --- START: OPTIMIZED MESSAGE RENDERING ---
function appendMessage(message) {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    const lastMessage = state.messages[state.messages.length - 2]; // Get message before the new one
    const lastMessageDate = lastMessage?.timestamp ? new Date(lastMessage.timestamp.seconds * 1000) : null;
    const currentMessageDate = message.timestamp ? new Date(message.timestamp.seconds * 1000) : null;

    if (currentMessageDate && !isSameDay(currentMessageDate, lastMessageDate)) {
        const separatorHtml = DateSeparatorTemplate(formatDateSeparator(currentMessageDate));
        contentContainer.insertAdjacentHTML('beforeend', separatorHtml);
    }

    const messageHtml = MessageBubbleTemplate(message);
    contentContainer.insertAdjacentHTML('beforeend', messageHtml);

    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderMessages() {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    let lastMessageDate = null;
    let messagesHtml = '';

    state.messages.forEach(message => {
        if (message.timestamp && typeof message.timestamp.seconds === 'number') {
            const currentMessageDate = new Date(message.timestamp.seconds * 1000);
            if (!isSameDay(currentMessageDate, lastMessageDate)) {
                messagesHtml += DateSeparatorTemplate(formatDateSeparator(currentMessageDate));
                lastMessageDate = currentMessageDate;
            }
        }
        messagesHtml += MessageBubbleTemplate(message);
    });

    contentContainer.innerHTML = messagesHtml;
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    handleScroll();
}
// --- END: OPTIMIZED MESSAGE RENDERING ---

function renderNotes() { 
    const contentContainer = document.getElementById('notes-content'); 
    if (!contentContainer) return; 
    contentContainer.innerHTML = state.notes.map(NoteItemTemplate).join(''); 
}

function handleScroll() { const container = document.getElementById('messages-container'); const stickyHeader = document.getElementById('sticky-date-header'); if (!container || !stickyHeader) return; const anchors = Array.from(container.querySelectorAll('.date-separator-anchor')); let currentStickyText = null; const scrollTop = container.scrollTop; for (let i = 0; i < anchors.length; i++) { const anchor = anchors[i]; if (scrollTop >= anchor.offsetTop - 16) { currentStickyText = anchor.textContent; } else { break; } } if (currentStickyText) { if (stickyHeader.textContent !== currentStickyText) { stickyHeader.textContent = currentStickyText; } stickyHeader.classList.add('visible'); } else { stickyHeader.classList.remove('visible'); } }

function showError(message) { errorMessageEl.textContent = message; errorContainerEl.classList.remove('hidden'); setTimeout(() => hideError(), 5000); }
function hideError() { errorContainerEl.classList.add('hidden'); }
function openImageModal(imageUrl) { const modal = document.getElementById('image-modal'); const modalImage = document.getElementById('modal-image-content'); modalImage.src = imageUrl; modal.classList.add('visible'); }
function closeImageModal() { const modal = document.getElementById('image-modal'); modal.classList.remove('visible'); const modalImage = document.getElementById('modal-image-content'); setTimeout(() => { modalImage.src = ''; }, 300); }
function copyToClipboard(text, buttonElement) { navigator.clipboard.writeText(text).then(() => { const originalIconHTML = buttonElement.innerHTML; buttonElement.innerHTML = '<i class="fas fa-check text-green-500"></i>'; buttonElement.disabled = true; setTimeout(() => { buttonElement.innerHTML = originalIconHTML; buttonElement.disabled = false; }, 1500); }).catch(err => { console.error('Error al copiar: ', err); alert('No se pudo copiar el número.'); }); }

function handleSelectContactFromPipeline(contactId) {
    navigateTo('chats');
    setTimeout(() => {
        handleSelectContact(contactId);
    }, 100);
}

async function handleSelectContact(contactId) { 
    if (state.campaignMode) return;
    if (state.selectedContactId === contactId && !state.contactDetailsOpen) {
        if (state.activeTab !== 'chat') { setActiveTab('chat'); }
        return;
    }
    closeContactDetails();
    cancelStagedFile(); 
    cancelReply();
    db.collection('contacts_whatsapp').doc(contactId).update({ unreadCount: 0 }).catch(err => console.error("Error al resetear contador:", err)); 
    state.selectedContactId = contactId; 
    state.loadingMessages = true; 
    state.activeTab = 'chat';
    state.isEditingNote = null;
    handleSearchContacts(); 
    
    if (unsubscribeMessagesListener) unsubscribeMessagesListener(); 
    
    let isInitialMessageLoad = true;
    unsubscribeMessagesListener = db.collection('contacts_whatsapp').doc(contactId).collection('messages').orderBy('timestamp', 'asc')
        .onSnapshot((snapshot) => {
            hideError();
            if (isInitialMessageLoad) {
                state.messages = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));
                state.loadingMessages = false;
                if (state.activeTab === 'chat') {
                    renderMessages();
                }
                isInitialMessageLoad = false;
            } else {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added") {
                        const newMessage = { docId: change.doc.id, ...change.doc.data() };
                        state.messages.push(newMessage);
                        if (state.activeTab === 'chat') {
                            appendMessage(newMessage);
                        }
                    }
                });
            }
        }, (error) => {
            console.error(error);
            showError(`Error al cargar mensajes.`);
            state.loadingMessages = false;
            state.messages = [];
            if (state.activeTab === 'chat') renderMessages();
        });
    
    if (unsubscribeNotesListener) unsubscribeNotesListener();
    unsubscribeNotesListener = db.collection('contacts_whatsapp').doc(contactId).collection('notes').orderBy('timestamp', 'desc').onSnapshot( (snapshot) => { state.notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if(state.selectedContactId === contactId) renderChatWindow(); }, (error) => { console.error(error); showError('Error al cargar notas.'); state.notes = []; if(state.activeTab === 'notes') renderNotes(); });
    
    renderChatWindow();
}

async function handleSendMessage(event) {
    event.preventDefault();
    const input = document.getElementById('message-input');
    let text = input.value.trim();
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    if (!contact || state.isUploading) return;

    const fileToSend = state.stagedFile;
    const remoteFileToSend = state.stagedRemoteFile;

    if (!text && !fileToSend && !remoteFileToSend) return;

    input.value = '';
    input.style.height = 'auto';
    cancelStagedFile(); 

    try {
        if (fileToSend) {
            const response = await uploadAndSendFile(fileToSend, text);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error del servidor.');
            }
        } else {
            await db.collection('contacts_whatsapp').doc(state.selectedContactId).update({ unreadCount: 0 });
            const messageData = { text };
            if (remoteFileToSend) {
                messageData.fileUrl = remoteFileToSend.url;
                messageData.fileType = remoteFileToSend.type;
            }
            if (state.replyingToMessage) {
                messageData.reply_to_wamid = state.replyingToMessage.id;
            }
            const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(messageData)
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error del servidor.');
            }
        }
        cancelReply();
    } catch (error) {
        console.error("Error en el proceso de envío:", error);
        showError(error.message);
        if (text && !fileToSend && !remoteFileToSend) { input.value = text; } 
    }
}

async function handleSendTemplate(templateObject) {
    if (!state.selectedContactId) return;

    const templateData = {
        template: templateObject
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(templateData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error del servidor al enviar plantilla.');
        }
        
        toggleTemplatePicker();
    } catch (error) {
        console.error("Error al enviar la plantilla:", error);
        showError(error.message);
    }
}

async function handleSaveNote(event) {
    event.preventDefault();
    const input = document.getElementById('note-input');
    const text = input.value.trim();
    if (!text || !state.selectedContactId) return;
    
    input.disabled = true;
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || 'Error del servidor'); }
        input.value = '';
    } catch (error) { console.error('Error al guardar la nota:', error); showError(error.message); } finally { input.disabled = false; }
}

async function handleUpdateNote(noteId) {
    const input = document.getElementById(`edit-note-input-${noteId}`);
    const newText = input.value.trim();
    if (!newText || !state.selectedContactId) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/notes/${noteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: newText }) });
        if (!response.ok) throw new Error('No se pudo actualizar la nota.');
        toggleEditNote(null);
    } catch (error) { showError(error.message); }
}

async function handleDeleteNote(noteId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta nota?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/notes/${noteId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('No se pudo eliminar la nota.');
    } catch (error) { showError(error.message); }
}

function toggleEditNote(noteId) { state.isEditingNote = state.isEditingNote === noteId ? null : noteId; renderNotes(); }

async function uploadAndSendFile(file, textCaption) { 
    if (!file || !state.selectedContactId || state.isUploading) return;
    const progressEl = document.getElementById('upload-progress');
    const submitButton = document.querySelector('#message-form button[type="submit"]');
    state.isUploading = true;
    progressEl.textContent = 'Subiendo 0%...';
    progressEl.classList.remove('hidden');
    if(submitButton) submitButton.disabled = true;
    
    const userIdentifier = auth.currentUser ? auth.currentUser.uid : 'anonymous_uploads';
    const filePath = `uploads/${userIdentifier}/${Date.now()}_${file.name}`;
    
    const fileRef = storage.ref(filePath);
    const uploadTask = fileRef.put(file);
    return new Promise((resolve, reject) => {
        uploadTask.on('state_changed', 
            (snapshot) => { const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100; progressEl.textContent = `Subiendo ${Math.round(progress)}%...`; }, 
            (error) => { state.isUploading = false; progressEl.classList.add('hidden'); if(submitButton) submitButton.disabled = false; reject(new Error("Falló la subida del archivo.")); }, 
            async () => {
                try {
                    const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
                    const messageData = { 
                        fileUrl: downloadURL, 
                        fileType: file.type,
                        text: textCaption 
                    };
                    if (state.replyingToMessage) {
                        messageData.reply_to_wamid = state.replyingToMessage.id;
                    }
                    const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messageData) });
                    resolve(response);
                } catch (error) { 
                    reject(error); 
                } finally { 
                    state.isUploading = false; 
                    progressEl.classList.add('hidden'); 
                    if(submitButton) submitButton.disabled = false; 
                }
            }
        );
    });
}

function handleStatusChange(contactId, newStatusKey) {
    const id = contactId || state.selectedContactId;
    if (!id) return;

    const contact = state.contacts.find(c => c.id === id);
    if (!contact) return;

    const finalStatus = contact.status === newStatusKey ? null : newStatusKey;

    db.collection('contacts_whatsapp').doc(id).update({ status: finalStatus }).catch(err => {
        console.error("Error updating status:", err);
        showError("No se pudo actualizar la etiqueta.");
    });
}

function stageFile(file) { if (!file || state.isUploading) return; if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { showError('Solo se pueden adjuntar imágenes y videos.'); return; } state.stagedFile = file; state.stagedRemoteFile = null; renderFilePreview(); }

function renderFilePreview() { 
    const container = document.getElementById('file-preview-container'); 
    if (container) { 
        if (state.stagedFile) { 
            container.innerHTML = LocalFilePreviewTemplate(state.stagedFile); 
        } else if (state.stagedRemoteFile) {
            container.innerHTML = RemoteFilePreviewTemplate(state.stagedRemoteFile);
        } else { 
            container.innerHTML = ''; 
        } 
    } 
}

function cancelStagedFile() { 
    if (state.stagedFile) { URL.revokeObjectURL(state.stagedFile); } 
    state.stagedFile = null; 
    state.stagedRemoteFile = null;
    const fileInput = document.getElementById('file-input'); 
    if(fileInput) fileInput.value = null; 
    renderFilePreview(); 
}

function handleFileInputChange(event) { const file = event.target.files[0]; if (file) stageFile(file); }
function handlePaste(event) { const items = (event.clipboardData || event.originalEvent.clipboardData).items; for (let i = 0; i < items.length; i++) { if (items[i].kind === 'file') { const file = items[i].getAsFile(); if(file) { event.preventDefault(); stageFile(file); break; } } } }
function setupDragAndDrop() { const chatArea = document.getElementById('chat-panel'); const overlay = document.getElementById('drag-drop-overlay'); if (!chatArea || !overlay) return; const showOverlay = () => overlay.classList.remove('hidden'); const hideOverlay = () => overlay.classList.add('hidden'); chatArea.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.types.includes('Files')) { showOverlay(); } }); chatArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); }); chatArea.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); if (e.relatedTarget === null || !chatArea.contains(e.relatedTarget)) { hideOverlay(); } }); chatArea.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); hideOverlay(); const files = e.dataTransfer.files; if (files.length > 0) { stageFile(files[0]); } }); }

function handleSearchContacts() {
    const searchInput = document.getElementById('search-contacts-input');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    let filteredContacts = state.contacts;
    if (state.activeFilter !== 'all') {
        filteredContacts = state.contacts.filter(c => c.status === state.activeFilter);
    }

    const contactsToRender = searchTerm ? filteredContacts.filter(c => (c.name || '').toLowerCase().includes(searchTerm) || c.id.includes(searchTerm) || (c.lastMessage || '').toLowerCase().includes(searchTerm)) : filteredContacts;
    
    const contactsListEl = document.getElementById('contacts-list');
    if (contactsListEl) {
        contactsListEl.innerHTML = contactsToRender.map(c => ContactItemTemplate(c, c.id === state.selectedContactId)).join('');
    }
}

function setFilter(filter) { 
    state.activeFilter = filter; 
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active')); 
    document.getElementById(`filter-${filter}`).classList.add('active'); 
    handleSearchContacts(); 
}

function setActiveTab(tab) { state.activeTab = tab; renderChatWindow(); }

function handleClickOutside(event) {
    const emojiPicker = document.getElementById('emoji-picker');
    const emojiToggleBtn = document.getElementById('emoji-toggle-btn');
    if (state.emojiPickerOpen && emojiPicker && emojiToggleBtn && !emojiPicker.contains(event.target) && !emojiToggleBtn.contains(event.target)) {
        toggleEmojiPicker();
    }

    const templatePicker = document.getElementById('template-picker');
    const templateToggleBtn = document.getElementById('template-toggle-btn');
    if (state.templatePickerOpen && templatePicker && templateToggleBtn && !templatePicker.contains(event.target) && !templateToggleBtn.contains(event.target)) {
        toggleTemplatePicker();
    }
}

function listenForContacts() {
    if (unsubscribeContactsListener) unsubscribeContactsListener();
    
    const contactsLoadingEl = document.getElementById('contacts-loading');
    if (contactsLoadingEl) contactsLoadingEl.style.display = 'block';

    unsubscribeContactsListener = db.collection('contacts_whatsapp').onSnapshot((snapshot) => {
        hideError();
        
        const messageInput = document.getElementById('message-input');
        let draftText = '';
        if (messageInput) {
            draftText = messageInput.value;
        }

        let newContacts = snapshot.docs.map(doc => {
            const contact = { id: doc.id, ...doc.data() };
            const lastTimestamp = contact.lastMessageTimestamp;
            if (!lastTimestamp) { contact.isWithin24HourWindow = false; }
            else { const diffHours = (new Date().getTime() - lastTimestamp.toDate().getTime()) / 3600000; contact.isWithin24HourWindow = diffHours <= 24; }
            return contact;
        });
        newContacts.sort((a, b) => (b.lastMessageTimestamp?.toMillis() || 0) - (a.lastMessageTimestamp?.toMillis() || 0));
        state.contacts = newContacts;
        
        if (state.activeView === 'chats') {
            handleSearchContacts();
        } else if (state.activeView === 'contacts') {
            renderContactsView();
        } else if (state.activeView === 'pipeline') {
            renderPipelineView();
        } else if (state.activeView === 'ajustes-ia') {
            renderAjustesIAView();
        }

        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none';
        
        if (state.selectedContactId) {
            const updatedContact = newContacts.find(c => c.id === state.selectedContactId);
            if (updatedContact) {
                if (state.contactDetailsOpen) {
                     const contactDetailsPanelEl = document.getElementById('contact-details-panel');
                     if(contactDetailsPanelEl) contactDetailsPanelEl.innerHTML = ContactDetailsSidebarTemplate(updatedContact);
                }
                
                const newMessageInput = document.getElementById('message-input');
                if (newMessageInput && draftText) {
                    newMessageInput.value = draftText;
                }
            } else { 
                closeContactDetails(); 
            }
        }
    }, (error) => { 
        console.error(error); 
        showError("No se pudo conectar a los contactos."); 
        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none'; 
    });
}

function listenForQuickReplies() { 
    if (unsubscribeQuickRepliesListener) unsubscribeQuickRepliesListener(); 
    unsubscribeQuickRepliesListener = db.collection('quick_replies').orderBy('shortcut').onSnapshot((snapshot) => { 
        state.quickReplies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); 
        if (state.activeView === 'respuestas-rapidas') {
            renderQuickRepliesView();
        }
    }, (error) => { console.error("Error fetching quick replies:", error); showError("No se pudieron cargar las respuestas rápidas."); }); 
}

function handleQuickReplyInput(event) { 
    const input = event.target; 
    const text = input.value; 
    if (text.startsWith('/')) { 
        state.quickReplyPickerOpen = true; 
        state.templatePickerOpen = false;
        state.emojiPickerOpen = false;
        const searchTerm = text.substring(1); 
        renderQuickReplyPicker(searchTerm); 
    } else { 
        state.quickReplyPickerOpen = false; 
    }
    renderAllPickers();
}

function renderQuickReplyPicker(searchTerm) {
    const picker = document.getElementById('quick-reply-picker');
    if (!picker) return;
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    const filteredReplies = state.quickReplies.filter(reply => reply.shortcut.toLowerCase().includes(lowerCaseSearchTerm));
    
    let pickerHTML = '';
    if (filteredReplies.length > 0) {
        pickerHTML = filteredReplies.map(reply => {
            return `<button class="picker-item" onclick="selectQuickReply('${reply.id}')"><strong>/${reply.shortcut}</strong> - <span class="text-gray-500 truncate">${reply.message || 'Archivo adjunto'}</span></button>`;
        }).join('');
    } else if (searchTerm) {
        pickerHTML = `<button class="picker-add-btn" onclick="openQuickReplyModal('${searchTerm}')"><i class="fas fa-plus-circle mr-2"></i> Añadir respuesta rápida: /${searchTerm}</button>`;
    } else {
         pickerHTML = state.quickReplies.map(reply => {
            return `<button class="picker-item" onclick="selectQuickReply('${reply.id}')"><strong>/${reply.shortcut}</strong> - <span class="text-gray-500 truncate">${reply.message || 'Archivo adjunto'}</span></button>`;
        }).join('');
    }
    picker.innerHTML = pickerHTML;
}

function selectQuickReply(replyId) {
    const reply = state.quickReplies.find(r => r.id === replyId);
    if (!reply) return;

    const input = document.getElementById('message-input');
    if (input) {
        input.value = reply.message || '';
        input.focus();
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
    }
    
    state.stagedFile = null; 
    if (reply.fileUrl) {
        state.stagedRemoteFile = {
            url: reply.fileUrl,
            type: reply.fileType,
            name: 'Archivo de respuesta rápida'
        };
    } else {
        state.stagedRemoteFile = null;
    }
    renderFilePreview();

    state.quickReplyPickerOpen = false;
    renderAllPickers();
}

function openQuickReplyModal(param = null) {
    const modal = document.getElementById('quick-reply-modal');
    const form = document.getElementById('quick-reply-form');
    form.reset();
    document.getElementById('qr-media-preview').innerHTML = '';

    const isEditing = param && state.quickReplies.some(r => r.id === param);
    const reply = isEditing ? state.quickReplies.find(r => r.id === param) : null;
    const newShortcut = !isEditing && typeof param === 'string' ? param : '';

    document.getElementById('quick-reply-modal-title').textContent = isEditing ? 'Editar Respuesta Rápida' : 'Añadir Respuesta Rápida';
    document.getElementById('qr-doc-id').value = isEditing ? reply.id : '';
    document.getElementById('qr-shortcut').value = isEditing ? reply.shortcut : newShortcut;
    document.getElementById('qr-message').value = isEditing ? reply.message || '' : '';
    document.getElementById('qr-file-url').value = isEditing ? reply.fileUrl || '' : '';
    document.getElementById('qr-file-type').value = isEditing ? reply.fileType || '' : '';
    
    updateQuickReplyPreview();

    modal.classList.remove('hidden');
    document.getElementById('qr-shortcut').focus();
    
    document.getElementById('qr-file-input').onchange = (e) => handleModalFileUpload(e, 'qr');
    form.onsubmit = (event) => {
        event.preventDefault();
        handleSaveQuickReply();
    };
}
function updateQuickReplyPreview() {
    const mediaPreviewEl = document.getElementById('qr-media-preview');
    const fileUrl  = document.getElementById('qr-file-url').value;
    const fileType = document.getElementById('qr-file-type').value;

    mediaPreviewEl.innerHTML = '';

    if (!fileUrl) return;

    let inner = '';
    if (fileType && fileType.startsWith('image/')) {
        inner = `<img src="${fileUrl}" class="media-preview"/>`;
    } else if (fileType && fileType.startsWith('video/')) {
        inner = `<video src="${fileUrl}" class="media-preview" controls></video>`;
    } else {
        inner = `<a href="${fileUrl}" target="_blank" class="text-blue-600 underline">Ver archivo</a>`;
    }

    mediaPreviewEl.innerHTML = `
      <div class="relative inline-block p-2 border rounded-md bg-gray-100">
        ${inner}
        <button type="button" onclick="removeQuickReplyFile()"
          class="absolute top-0 right-0 -mt-2 -mr-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold cursor-pointer"
          title="Eliminar archivo">&times;</button>
      </div>`;
}

function removeQuickReplyFile() {
    document.getElementById('qr-file-url').value  = '';
    document.getElementById('qr-file-type').value = '';
    const f = document.getElementById('qr-file-input');
    if (f) f.value = '';
    updateQuickReplyPreview();
}


function closeQuickReplyModal() { document.getElementById('quick-reply-modal').classList.add('hidden'); }

async function handleSaveQuickReply() {
    const id = document.getElementById('qr-doc-id').value;
    const shortcut = document.getElementById('qr-shortcut').value.trim();
    const message = document.getElementById('qr-message').value.trim();
    const fileUrl = document.getElementById('qr-file-url').value.trim();
    const fileType = document.getElementById('qr-file-type').value.trim();

    if (!shortcut || (!message && !fileUrl)) {
        showError("El atajo y un mensaje o archivo son obligatorios.");
        return;
    }

    const data = { shortcut, message, fileUrl, fileType };
    const url = id ? `${API_BASE_URL}/api/quick-replies/${id}` : `${API_BASE_URL}/api/quick-replies`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar.');
        }
        closeQuickReplyModal();
    } catch (error) {
        console.error("Error saving quick reply:", error);
        showError(error.message);
    }
}

async function handleDeleteQuickReply(replyId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta respuesta rápida?')) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/quick-replies/${replyId}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la respuesta rápida.');
        }
    } catch (error) {
        console.error("Error deleting quick reply:", error);
        showError(error.message);
    }
}

async function fetchTemplates() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/whatsapp-templates`);
        const data = await response.json();
        if (data.success) {
            state.templates = data.templates;
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error("Error al cargar las plantillas:", error);
        showError("No se pudieron cargar las plantillas de WhatsApp.");
    }
}

function toggleTemplatePicker() {
    state.templatePickerOpen = !state.templatePickerOpen;
    state.quickReplyPickerOpen = false;
    state.emojiPickerOpen = false;
    if (state.templatePickerOpen) {
        renderTemplatePicker();
    }
    renderAllPickers();
}

function renderTemplatePicker() {
    const picker = document.getElementById('template-picker');
    if (!picker) return;

    if (state.templates.length === 0) {
        picker.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No hay plantillas disponibles.</div>`;
        return;
    }

    picker.innerHTML = state.templates.map(template => {
        const templateString = JSON.stringify(template).replace(/'/g, "&apos;");
        return `<button class="picker-item template-item" onclick='handleSendTemplate(${templateString})'>
                            <div class="flex justify-between items-center">
                                <strong>${template.name}</strong>
                                <span class="template-category">${template.category}</span>
                            </div>
                        </button>`;
    }).join('');
}

function toggleEmojiPicker() {
    state.emojiPickerOpen = !state.emojiPickerOpen;
    state.quickReplyPickerOpen = false;
    state.templatePickerOpen = false;
    if (state.emojiPickerOpen) {
        renderEmojiPicker();
    }
    renderAllPickers();
}

function renderEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    if (!picker || picker.innerHTML !== '') return;

    const emojis = {
        'Smileys & Emotion': ['😀', '😂', '😍', '🤔', '😢', '😡', '👍', '👎', '❤️', '🔥', '🎉'],
        'People & Body': ['👋', '🙏', '💪', '👀', '🧠', '💼', '🧑‍💻', '🚀'],
        'Objects': ['📞', '💡', '💰', '📈', '📌', '📎', '📅', '✅']
    };

    let html = '<div class="picker-content">';
    for (const category in emojis) {
        html += `<div class="emoji-category">${category}</div>`;
        html += emojis[category].map(emoji => `<span class="emoji" onclick="selectEmoji('${emoji}')">${emoji}</span>`).join('');
    }
    html += '</div>';
    picker.innerHTML = html;
}

function selectEmoji(emoji) {
    const input = document.getElementById('message-input');
    input.value += emoji;
    input.focus();
}

function renderAllPickers() {
    const emojiPicker = document.getElementById('emoji-picker');
    const quickReplyPicker = document.getElementById('quick-reply-picker');
    const templatePicker = document.getElementById('template-picker');

    if(emojiPicker) emojiPicker.classList.toggle('hidden', !state.emojiPickerOpen);
    if(quickReplyPicker) quickReplyPicker.classList.toggle('hidden', !state.quickReplyPickerOpen);
    if(templatePicker) templatePicker.classList.toggle('hidden', !state.templatePickerOpen);
}

function openContactDetails() { 
    const contactDetailsPanelEl = document.getElementById('contact-details-panel');
    if (!state.selectedContactId || !contactDetailsPanelEl) return; 
    const contact = state.contacts.find(c => c.id === state.selectedContactId); 
    if (!contact) return; 
    contactDetailsPanelEl.innerHTML = ContactDetailsSidebarTemplate(contact); 
    contactDetailsPanelEl.classList.add('open'); 
    state.contactDetailsOpen = true; 
}
function closeContactDetails() { 
    const contactDetailsPanelEl = document.getElementById('contact-details-panel');
    if(contactDetailsPanelEl) {
        contactDetailsPanelEl.classList.remove('open'); 
        contactDetailsPanelEl.innerHTML = ''; 
    }
    state.contactDetailsOpen = false; 
}
function openEditContactModal(contactId = null) {
    const modal = document.getElementById('edit-contact-modal');
    const form = document.getElementById('edit-contact-form');
    form.reset();
    document.getElementById('edit-contact-modal-title').textContent = contactId ? 'Editar Contacto' : 'Agregar Contacto';
    document.getElementById('edit-contact-id').value = contactId || '';

    if (contactId) {
        const contact = state.contacts.find(c => c.id === contactId);
        if (contact) {
            document.getElementById('edit-contact-name').value = contact.name || '';
            document.getElementById('edit-contact-nickname').value = contact.nickname || '';
            document.getElementById('edit-contact-email').value = contact.email || '';
        }
    }
    
    modal.classList.remove('hidden');
    document.getElementById('edit-contact-name').focus();
    form.onsubmit = handleUpdateContact;
}
function closeEditContactModal() { document.getElementById('edit-contact-modal').classList.add('hidden'); }
async function handleUpdateContact(event) { 
    event.preventDefault(); 
    const id = document.getElementById('edit-contact-id').value;
    const name = document.getElementById('edit-contact-name').value.trim(); 
    const nickname = document.getElementById('edit-contact-nickname').value.trim(); 
    const email = document.getElementById('edit-contact-email').value.trim(); 
    if (!name) { showError("El nombre no puede estar vacío."); return; } 
    
    const contactId = id || state.selectedContactId;
    if (!contactId) { showError("No se ha seleccionado un contacto."); return; }

    const button = event.target.querySelector('button[type="submit"]'); 
    button.disabled = true; 
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; 
    try { 
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, nickname, email }) }); 
        if (!response.ok) { 
            const errorData = await response.json(); 
            throw new Error(errorData.message || 'Error al actualizar'); 
        } 
        closeEditContactModal(); 
    } catch (error) { 
        showError(error.message); 
    } finally { 
        button.disabled = false; 
        button.textContent = 'Guardar'; 
    } 
}

async function handleDeleteContact(contactId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este contacto?')) return;
    console.log("Eliminar contacto:", contactId);
}

async function handleGenerateReply() { 
    if (!state.selectedContactId) return; 
    const button = document.getElementById('generate-reply-btn'); 
    button.disabled = true; 
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; 
    try { 
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/generate-reply`, { method: 'POST' }); 
        const result = await response.json();
        if (!response.ok) { 
            throw new Error(result.message || 'Error al generar respuesta.'); 
        }
        document.getElementById('message-input').value = result.suggestion;
    } catch (error) { 
        showError(error.message); 
    } finally { 
        button.disabled = false; 
        button.innerHTML = '<i class="fas fa-magic"></i>'; 
    } 
}

function handleStartReply(event, messageDocId) {
    event.stopPropagation();
    const message = state.messages.find(m => m.docId === messageDocId);
    if (message) {
        state.replyingToMessage = message;
        renderChatWindow();
        document.getElementById('message-input')?.focus();
    }
}

function cancelReply() {
    if (state.replyingToMessage) {
        state.replyingToMessage = null;
        renderChatWindow();
    }
}

async function handleSelectReaction(event, messageDocId, emoji) {
    event.stopPropagation();
    if (!state.selectedContactId) return;

    const message = state.messages.find(m => m.docId === messageDocId);
    if (!message) return;

    const newReaction = message.reaction === emoji ? null : emoji;

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/messages/${messageDocId}/react`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reaction: newReaction })
        });
        if (!response.ok) {
            throw new Error('No se pudo guardar la reacción.');
        }
    } catch (error) {
        console.error("Error al reaccionar:", error);
        showError(error.message);
    }
}

async function handleMarkAsPurchase() {
    if (!state.selectedContactId) return;
    const value = prompt("Ingresa el valor de la compra (ej. 150.50):");
    if (value === null || value.trim() === '' || isNaN(parseFloat(value))) {
        showError("Debes ingresar un valor numérico válido.");
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/mark-as-purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: parseFloat(value) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        showError(result.message);
    } catch (error) {
        showError(error.message);
    }
}

async function handleMarkAsRegistration() {
    if (!state.selectedContactId) return;
    
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    if (contact && contact.registrationStatus === 'completed') {
        showError("Este pedido ya ha sido registrado.");
        return;
    }

    if (!confirm("¿Confirmas que quieres registrar esta línea?")) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/mark-as-registration`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        showError(result.message); 
    } catch (error) {
        showError(error.message);
    }
}

async function handleSendViewContent() {
    if (!state.selectedContactId) return;
    if (!confirm("¿Confirmas que quieres enviar el evento 'Contenido Visto' para este contacto?")) return;
     try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/send-view-content`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        showError(result.message);
    } catch (error) {
        showError(error.message);
    }
}

async function handleSendCampaign() {
    const tagSelect = document.getElementById('campaign-tag-select');
    const templateSelect = document.getElementById('campaign-template-select');
    const button = document.getElementById('send-campaign-btn');

    const selectedTagKey = tagSelect.value;
    const templateString = templateSelect.value;
    
    if (!templateString) { showError("Por favor, selecciona una plantilla para enviar."); return; }

    let recipients = [];
    if (selectedTagKey === 'all') {
        recipients = state.contacts;
    } else {
        recipients = state.contacts.filter(c => c.status === selectedTagKey);
    }
    
    if (recipients.length === 0) { showError("No hay contactos en la etiqueta seleccionada para enviar la campaña."); return; }

    const contactIds = recipients.map(c => c.id);
    const template = JSON.parse(templateString);

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...`;

    try {
        const response = await fetch(`${API_BASE_URL}/api/campaigns/send-template`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactIds, template })
        });

        const result = await response.json();
        if (!response.ok || !result.success) { throw new Error(result.message || "Ocurrió un error en el servidor."); }

        alert(`Campaña enviada.\n\nÉxitos: ${result.results.successful.length}\nFallos: ${result.results.failed.length}`);
        
    } catch (error) {
        console.error("Error al enviar la campaña:", error);
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane mr-2"></i> Enviar Campaña`;
    }
}

// --- INICIO: Nueva función para enviar campañas con imagen ---
async function handleSendCampaignWithImage() {
    const tagSelect = document.getElementById('campaign-image-tag-select');
    const templateSelect = document.getElementById('campaign-image-template-select');
    const imageUrlInput = document.getElementById('campaign-image-url-input');
    const phoneInput = document.getElementById('campaign-image-phone-input');
    const button = document.getElementById('send-campaign-image-btn');

    const templateName = templateSelect.value;
    const imageUrl = imageUrlInput.value.trim();
    const phoneNumber = phoneInput.value.trim();
    const selectedTagKey = tagSelect.value;

    // BUSCA EL OBJETO COMPLETO DE LA PLANTILLA EN EL ESTADO
    const templateObject = state.templates.find(t => t.name === templateName);

    if (!templateObject) { showError("Por favor, selecciona una plantilla válida."); return; }
    if (!imageUrl) { showError("Por favor, ingresa la URL de la imagen."); return; }

    let recipients = [];
    if (selectedTagKey === 'all') {
        recipients = state.contacts;
    } else {
        recipients = state.contacts.filter(c => c.status === selectedTagKey);
    }
    
    // Valida que haya al menos un destinatario
    if (recipients.length === 0 && !phoneNumber) {
        showError("No hay contactos en la etiqueta seleccionada y no se especificó un número de teléfono.");
        return;
    }

    const contactIds = phoneNumber ? [] : recipients.map(c => c.id);

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...`;

    try {
        // CONSTRUYE EL PAYLOAD CORRECTO
        const payload = {
            contactIds,
            templateObject, // Envía el objeto completo
            imageUrl,
            phoneNumber     // Envía el número de teléfono
        };

        const response = await fetch(`${API_BASE_URL}/api/campaigns/send-template-with-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || !result.success) { throw new Error(result.message || "Ocurrió un error en el servidor."); }

        alert(`Campaña con imagen enviada.\n\nÉxitos: ${result.results.successful.length}\nFallos: ${result.results.failed.length}`);
        
    } catch (error) {
        console.error("Error al enviar la campaña con imagen:", error);
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane mr-2"></i> Enviar Campaña con Imagen`;
    }
}
// --- FIN: Nueva función ---

function toggleTagSidebar() {
    state.isTagSidebarOpen = !state.isTagSidebarOpen;
    document.getElementById('main-sidebar').classList.toggle('collapsed', !state.isTagSidebarOpen);
}

function listenForTags() {
    if(unsubscribeTagsListener) unsubscribeTagsListener();
    unsubscribeTagsListener = db.collection('crm_tags').orderBy('order').onSnapshot(snapshot => {
        state.tags = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(state.activeView === 'chats') {
            renderTagFilters();
            handleSearchContacts(); 
        }
        if(state.activeView === 'etiquetas') {
            renderTagsView();
        }
        if(state.activeView === 'campanas') {
            renderCampaignsView();
        }
         if(state.activeView === 'pipeline') {
            renderPipelineView();
        }
    }, error => {
        console.error("Error al escuchar las etiquetas:", error);
        showError("No se pudieron cargar las etiquetas.");
    });
}

function renderTagFilters() {
    const container = document.getElementById('tag-filters-container');
    if(!container) return;
    let filtersHTML = `<button id="filter-all" class="filter-btn ${state.activeFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Todos</button>`;
    filtersHTML += state.tags.map(tag => `
        <button id="filter-${tag.key}" class="filter-btn ${state.activeFilter === tag.key ? 'active' : ''}" onclick="setFilter('${tag.key}')">${tag.label}</button>
    `).join('');
    container.innerHTML = filtersHTML;
}

function openTagModal(tag = null) {
    const modal = document.getElementById('tag-modal');
    const form = document.getElementById('tag-form');
    form.reset();
    
    if (tag) {
        document.getElementById('tag-modal-title').textContent = 'Editar Etiqueta';
        document.getElementById('tag-id').value = tag.id;
        document.getElementById('tag-label').value = tag.label;
        document.getElementById('tag-color-input').value = tag.color;
    } else {
        document.getElementById('tag-modal-title').textContent = 'Nueva Etiqueta';
        document.getElementById('tag-id').value = '';
        document.getElementById('tag-color-input').value = '#3182ce';
    }
    
    const colorInput = document.getElementById('tag-color-input');
    document.getElementById('tag-color-preview').style.backgroundColor = colorInput.value;
    document.getElementById('tag-color-hex').textContent = colorInput.value;

    modal.classList.remove('hidden');
    document.getElementById('tag-label').focus();
    form.onsubmit = handleSaveTag;
}

function closeTagModal() {
    document.getElementById('tag-modal').classList.add('hidden');
}

async function handleSaveTag(event) {
    event.preventDefault();
    const id = document.getElementById('tag-id').value;
    const label = document.getElementById('tag-label').value.trim();
    const color = document.getElementById('tag-color-input').value;

    if (!label || !color) {
        showError("El nombre y el color de la etiqueta son obligatorios.");
        return;
    }
    
    const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const tagData = { label, color, key };
    if (!id) {
        tagData.order = state.tags.length;
    }

    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
        let response;
        if (id) {
            response = await fetch(`${API_BASE_URL}/api/tags/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tagData)
            });
        } else {
            response = await fetch(`${API_BASE_URL}/api/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tagData)
            });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar la etiqueta.');
        }
        closeTagModal();
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = false;
    }
}

async function handleDeleteTag(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta etiqueta? Esto no se puede deshacer.')) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/tags/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la etiqueta.');
        }
    } catch (error) {
        showError(error.message);
    }
}

async function handleDeleteAllTags() {
    if (!window.confirm('¿Estás SEGURO de que quieres eliminar TODAS las etiquetas? Esta acción es irreversible.')) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/tags`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar las etiquetas.');
        }
    } catch (error) {
        showError(error.message);
    }
}

function initTagsSortable() {
    const tableBody = document.getElementById('tags-table-body');
    if (tableBody && !tagsSortable) {
        tagsSortable = new Sortable(tableBody, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: async (evt) => {
                const rows = Array.from(evt.target.children);
                const orderedIds = rows.map(row => row.dataset.id);
                
                state.tags.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
                
                try {
                    const response = await fetch(`${API_BASE_URL}/api/tags/order`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orderedIds })
                    });
                    if (!response.ok) {
                        throw new Error('Failed to save the new order.');
                    }
                } catch (error) {
                    console.error("Error updating tag order:", error);
                    showError("No se pudo guardar el nuevo orden. Intenta de nuevo.");
                    listenForTags();
                }
            },
        });
    }
}

function listenForAdResponses() {
    if (unsubscribeAdResponsesListener) unsubscribeAdResponsesListener();
    unsubscribeAdResponsesListener = db.collection('ad_responses').orderBy('adName').onSnapshot(snapshot => {
        state.adResponses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeView === 'mensajes-ads') {
            renderAdResponsesView();
        }
    }, error => {
        console.error("Error al escuchar los mensajes de anuncios:", error);
        showError("No se pudieron cargar los mensajes de anuncios.");
    });
}

function openAdResponseModal(responseId = null) {
    const modal = document.getElementById('ad-response-modal');
    const form = document.getElementById('ad-response-form');
    form.reset();
    document.getElementById('ar-media-preview').innerHTML = '';
    document.getElementById('ar-file-input').value = ''; 

    const isEditing = responseId && state.adResponses.some(r => r.id === responseId);
    const response = isEditing ? state.adResponses.find(r => r.id === responseId) : null;

    document.getElementById('ad-response-modal-title').textContent = isEditing ? 'Editar Mensaje de Anuncio' : 'Añadir Mensaje de Anuncio';
    document.getElementById('ar-doc-id').value = isEditing ? response.id : '';
    document.getElementById('ar-name').value = isEditing ? response.adName : '';
    document.getElementById('ar-ad-id').value = isEditing ? response.adId : '';
    document.getElementById('ar-message').value = isEditing ? response.message || '' : '';
    document.getElementById('ar-file-url').value = isEditing ? response.fileUrl || '' : '';
    document.getElementById('ar-file-type').value = isEditing ? response.fileType || '' : '';
    
    updateAdResponsePreview();

    modal.classList.remove('hidden');
    document.getElementById('ar-name').focus();
    
    document.getElementById('ar-file-input').onchange = (e) => handleModalFileUpload(e, 'ar');
    form.onsubmit = (event) => {
        event.preventDefault();
        handleSaveAdResponse();
    };
}

function updateAdResponsePreview() {
    const mediaPreviewEl = document.getElementById('ar-media-preview');
    const attachButtonTextEl = document.getElementById('ar-attach-button-text');
    const fileUrl = document.getElementById('ar-file-url').value;

    mediaPreviewEl.innerHTML = '';

    if (fileUrl) {
        let previewHTML = `
            <div class="relative inline-block p-2 border rounded-md bg-gray-100">
                <img src="${fileUrl}" class="media-preview"/>
                <button type="button" onclick="removeAdResponseFile()" class="absolute top-0 right-0 -mt-2 -mr-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold cursor-pointer" title="Eliminar archivo">&times;</button>
            </div>`;
        mediaPreviewEl.innerHTML = previewHTML;
        attachButtonTextEl.textContent = 'Cambiar Archivo';
    } else {
        attachButtonTextEl.textContent = 'Adjuntar Archivo';
    }
}

function removeAdResponseFile() {
    document.getElementById('ar-file-url').value = '';
    document.getElementById('ar-file-type').value = '';
    document.getElementById('ar-file-input').value = ''; 
    updateAdResponsePreview();
}

function closeAdResponseModal() {
    document.getElementById('ad-response-modal').classList.add('hidden');
}

async function handleSaveAdResponse() {
    const id = document.getElementById('ar-doc-id').value;
    const adName = document.getElementById('ar-name').value.trim();
    const adId = document.getElementById('ar-ad-id').value.trim();
    const message = document.getElementById('ar-message').value.trim();
    const fileUrl = document.getElementById('ar-file-url').value.trim();
    const fileType = document.getElementById('ar-file-type').value.trim();

    if (!adName || !adId || (!message && !fileUrl)) {
        showError("Nombre, ID de anuncio y un mensaje o archivo son obligatorios.");
        return;
    }

    const data = { adName, adId, message, fileUrl, fileType };
    const url = id ? `${API_BASE_URL}/api/ad-responses/${id}` : `${API_BASE_URL}/api/ad-responses`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar el mensaje.');
        }
        closeAdResponseModal();
    } catch (error) {
        console.error("Error saving ad response:", error);
        showError(error.message);
    }
}

async function handleDeleteAdResponse(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este mensaje de anuncio?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/ad-responses/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar el mensaje.');
        }
    } catch (error) {
        showError(error.message);
    }
}

function listenForAIAdPrompts() {
    if (unsubscribeAIAdPromptsListener) unsubscribeAIAdPromptsListener();
    unsubscribeAIAdPromptsListener = db.collection('ai_ad_prompts').orderBy('adName').onSnapshot(snapshot => {
        state.aiAdPrompts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeView === 'prompts-ia') {
            renderAIAdPromptsView();
        }
    }, error => {
        console.error("Error al escuchar los prompts de IA:", error);
        showError("No se pudieron cargar los prompts de IA.");
    });
}

function openAIAdPromptModal(promptId = null) {
    const modal = document.getElementById('ai-ad-prompt-modal');
    const form = document.getElementById('ai-ad-prompt-form');
    form.reset();

    const isEditing = promptId && state.aiAdPrompts.some(p => p.id === promptId);
    const prompt = isEditing ? state.aiAdPrompts.find(p => p.id === promptId) : null;

    document.getElementById('ai-ad-prompt-modal-title').textContent = isEditing ? 'Editar Prompt de IA' : 'Añadir Prompt de IA';
    document.getElementById('aip-doc-id').value = isEditing ? prompt.id : '';
    document.getElementById('aip-name').value = isEditing ? prompt.adName : '';
    document.getElementById('aip-ad-id').value = isEditing ? prompt.adId : '';
    document.getElementById('aip-prompt').value = isEditing ? prompt.prompt : '';

    modal.classList.remove('hidden');
    document.getElementById('aip-name').focus();

    form.onsubmit = (event) => {
        event.preventDefault();
        handleSaveAIAdPrompt();
    };
}

function closeAIAdPromptModal() {
    document.getElementById('ai-ad-prompt-modal').classList.add('hidden');
}

async function handleSaveAIAdPrompt() {
    const id = document.getElementById('aip-doc-id').value;
    const adName = document.getElementById('aip-name').value.trim();
    const adId = document.getElementById('aip-ad-id').value.trim();
    const prompt = document.getElementById('aip-prompt').value.trim();

    if (!adName || !adId || !prompt) {
        showError("Todos los campos son obligatorios.");
        return;
    }

    const data = { adName, adId, prompt };
    const url = id ? `${API_BASE_URL}/api/ai-ad-prompts/${id}` : `${API_BASE_URL}/api/ai-ad-prompts`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar el prompt.');
        }
        closeAIAdPromptModal();
    } catch (error) {
        console.error("Error saving AI ad prompt:", error);
        showError(error.message);
    }
}

async function handleDeleteAIAdPrompt(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este prompt?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/ai-ad-prompts/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar el prompt.');
        }
    } catch (error) {
        showError(error.message);
    }
}

// --- START: FUNCIONES DEL MENÚ DE IA ---
function toggleIAMenu() {
    const submenu = document.getElementById('ia-submenu');
    const chevron = document.getElementById('ia-menu-chevron');
    submenu.classList.toggle('hidden');
    chevron.classList.toggle('rotate-180');
}
// --- END: FUNCIONES DEL MENÚ DE IA ---

async function handleModalFileUpload(event, prefix) {
    const file = event.target.files[0];
    if (!file) return;

    const previewEl = document.getElementById(`${prefix}-media-preview`);
    const urlInput = document.getElementById(`${prefix}-file-url`);
    const typeInput = document.getElementById(`${prefix}-file-type`);
                const submitButton = event.target.form.querySelector('button[type="submit"]');

    previewEl.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Subiendo...`;
    submitButton.disabled = true;

    const userIdentifier = auth.currentUser ? auth.currentUser.uid : 'anonymous_uploads';
    const filePath = `shared_media/${userIdentifier}/${Date.now()}_${file.name}`;
    const fileRef = storage.ref(filePath);
    
    try {
        const uploadTask = await fileRef.put(file);
        const downloadURL = await uploadTask.ref.getDownloadURL();
        
        urlInput.value = downloadURL;
        typeInput.value = file.type;
        
        if (prefix === 'ar') {
            updateAdResponsePreview();
        } else if (prefix === 'qr') {
            updateQuickReplyPreview();
        } else if (file.type.startsWith('image/')) {
            previewEl.innerHTML = `<img src="${downloadURL}" class="media-preview"/>`;
        } else {
            previewEl.innerHTML = `<p class="text-sm text-gray-600"><i class="fas fa-check-circle text-green-500 mr-2"></i>Archivo subido: ${file.name}</p>`;
        }

    } catch (error) {
        console.error("Error subiendo archivo:", error);
        showError("No se pudo subir el archivo.");
        previewEl.innerHTML = `<p class="text-sm text-red-500">Error al subir.</p>`;
    } finally {
        submitButton.disabled = false;
    }
}

        function openBotSettingsModal() {
    const modal = document.getElementById('bot-settings-modal');
    const form = document.getElementById('bot-settings-form');
    document.getElementById('bot-instructions').value = state.botSettings.instructions || '';
    modal.classList.remove('hidden');
    form.onsubmit = handleSaveBotSettings;
}

function closeBotSettingsModal() {
    document.getElementById('bot-settings-modal').classList.add('hidden');
}

async function fetchBotSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/bot/settings`);
        const data = await response.json();
        if (data.success) {
            state.botSettings = data.settings;
        }
    } catch (error) {
        console.error("Error fetching bot settings:", error);
    }
}

async function handleSaveBotSettings(event) {
    event.preventDefault();
    const instructions = document.getElementById('bot-instructions').value;
    try {
        const response = await fetch(`${API_BASE_URL}/api/bot/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instructions })
        });
        if (!response.ok) throw new Error('Failed to save settings.');
        state.botSettings.instructions = instructions;
        closeBotSettingsModal();
    } catch (error) {
        showError("No se pudieron guardar los ajustes del bot.");
    }
}

async function handleBotToggle(contactId, isActive) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/bot/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId, isActive })
        });
        if (!response.ok) throw new Error('Failed to update bot status.');
    } catch (error) {
        showError("No se pudo cambiar el estado del bot.");
        const toggle = document.querySelector(`input[onchange="handleBotToggle('${contactId}', this.checked)"]`);
        if(toggle) toggle.checked = !isActive;
    }
}

function listenForKnowledgeBase() {
    if (unsubscribeKnowledgeBaseListener) unsubscribeKnowledgeBaseListener();
    unsubscribeKnowledgeBaseListener = db.collection('ai_knowledge_base').orderBy('topic').onSnapshot(snapshot => {
        state.knowledgeBase = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeView === 'respuestas-ia') {
            renderKnowledgeBaseView();
        }
    }, error => {
        console.error("Error fetching knowledge base:", error);
        showError("No se pudo cargar la base de conocimiento.");
    });
}

function openKnowledgeBaseModal(entryId = null) {
    const modal = document.getElementById('knowledge-base-modal');
    const form = document.getElementById('kb-form');
    form.reset();
    document.getElementById('kb-media-preview').innerHTML = '';

    const isEditing = entryId && state.knowledgeBase.some(e => e.id === entryId);
    const entry = isEditing ? state.knowledgeBase.find(e => e.id === entryId) : null;

    document.getElementById('kb-modal-title').textContent = isEditing ? 'Editar Entrada' : 'Añadir Respuesta a la Base de Conocimiento';
    document.getElementById('kb-doc-id').value = isEditing ? entry.id : '';
    document.getElementById('kb-topic').value = isEditing ? entry.topic : '';
    document.getElementById('kb-answer').value = isEditing ? entry.answer : '';
    document.getElementById('kb-file-url').value = isEditing ? entry.fileUrl || '' : '';
    document.getElementById('kb-file-type').value = isEditing ? entry.fileType || '' : '';
    
    if (isEditing && entry.fileUrl) {
        document.getElementById('kb-media-preview').innerHTML = `<img src="${entry.fileUrl}" class="media-preview"/>`;
    }

    modal.classList.remove('hidden');
    document.getElementById('kb-topic').focus();
    
    document.getElementById('kb-file-input').onchange = (e) => handleModalFileUpload(e, 'kb');
    form.onsubmit = (event) => {
        event.preventDefault();
        handleSaveKnowledgeBaseEntry();
    };
}

function closeKnowledgeBaseModal() {
    document.getElementById('knowledge-base-modal').classList.add('hidden');
}

async function handleSaveKnowledgeBaseEntry() {
    const id = document.getElementById('kb-doc-id').value;
    const topic = document.getElementById('kb-topic').value.trim();
    const answer = document.getElementById('kb-answer').value.trim();
    const fileUrl = document.getElementById('kb-file-url').value.trim();
    const fileType = document.getElementById('kb-file-type').value.trim();

    if (!topic || !answer) {
        showError("El tema y la respuesta base son obligatorios.");
        return;
    }

    const data = { topic, answer, fileUrl, fileType };
    const url = id ? `${API_BASE_URL}/api/knowledge-base/${id}` : `${API_BASE_URL}/api/knowledge-base`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar.');
        }
        closeKnowledgeBaseModal();
    } catch (error) {
        console.error("Error saving knowledge base entry:", error);
        showError(error.message);
    }
}

async function handleDeleteKnowledgeBaseEntry(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta entrada de la base de conocimiento?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/knowledge-base/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la entrada.');
        }
    } catch (error) {
        console.error("Error deleting knowledge base entry:", error);
        showError(error.message);
    }
}

async function fetchAwayMessageSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/away-message`);
        const data = await response.json();
        if (data.success) {
            state.awayMessageSettings.isActive = data.settings.isActive;
        }
    } catch (error) {
        console.error("Error fetching away message settings:", error);
        showError("No se pudo cargar la configuración del mensaje de ausencia.");
    }
}

async function handleAwayMessageToggle(isActive) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/away-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive })
        });
        if (!response.ok) throw new Error('No se pudo guardar el ajuste.');
        state.awayMessageSettings.isActive = isActive;
    } catch (error) {
        showError(error.message);
        const toggle = document.getElementById('away-message-toggle');
        if (toggle) toggle.checked = !isActive;
    }
}

async function fetchGlobalBotSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/global-bot`);
        const data = await response.json();
        if (data.success) {
            state.globalBotSettings.isActive = data.settings.isActive;
        }
    } catch (error) {
        console.error("Error fetching global bot settings:", error);
        showError("No se pudo cargar la configuración del bot global.");
    }
}

async function handleGlobalBotToggle(isActive) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/global-bot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive })
        });
        if (!response.ok) throw new Error('No se pudo guardar el ajuste del bot global.');
        state.globalBotSettings.isActive = isActive;
    } catch (error) {
        showError(error.message);
        const toggle = document.getElementById('global-bot-toggle');
        if (toggle) toggle.checked = !isActive;
    }
}

async function fetchGoogleSheetSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/google-sheet`);
        const data = await response.json();
        if (data.success) {
            state.googleSheetSettings.googleSheetId = data.settings.googleSheetId;
        }
    } catch (error) {
        console.error("Error fetching Google Sheet settings:", error);
        showError("No se pudo cargar la configuración de Google Sheet.");
    }
}

async function handleSaveGoogleSheetId() {
    const input = document.getElementById('google-sheet-id-input');
    const button = document.getElementById('save-google-sheet-id-btn');
    const googleSheetId = input.value.trim();

    if (!googleSheetId) {
        showError("El ID de Google Sheet no puede estar vacío.");
        return;
    }

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/google-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ googleSheetId })
        });
        if (!response.ok) throw new Error('No se pudo guardar el ID de Google Sheet.');
        state.googleSheetSettings.googleSheetId = googleSheetId;
        showError("¡ID de Google Sheet guardado con éxito!"); 
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Guardar';
    }
}

async function handleSimulateAdMessage(event) {
    event.preventDefault();
    const button = document.getElementById('simulate-ad-btn');
    const phoneNumber = document.getElementById('sim-phone-number').value.trim();
    const adId = document.getElementById('sim-ad-id').value.trim();
    const text = document.getElementById('sim-message-text').value.trim();

    if (!phoneNumber || !adId || !text) {
        showError("Todos los campos de simulación son obligatorios.");
        return;
    }

    if (!/^\d{12,13}$/.test(phoneNumber)) {
         showError("El número de teléfono debe tener 12 o 13 dígitos (ej. 5216181234567).");
        return;
    }

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/test/simulate-ad-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: phoneNumber, adId: adId, text: text })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Error en la simulación.');
        }

        alert('¡Simulación enviada! Revisa la lista de chats para ver el nuevo mensaje.');
        document.getElementById('simulate-ad-form').reset();

    } catch (error) {
        console.error("Error en la simulación:", error);
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Enviar Simulación';
    }
}
