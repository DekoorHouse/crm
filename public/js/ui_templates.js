// --- START: UI & VIEW TEMPLATES ---
// Este archivo contiene todas las funciones que generan el HTML para la aplicación.

// --- PLANTILLAS DE VISTAS PRINCIPALES ---

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
        const date = contact.lastMessageTimestamp;
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
        case 'pending': return `<i class="far fa-clock message-status-icon" style="color: ${sentColor};"></i>`;
        case 'read': return `<i class="fas fa-check-double" style="color: ${readColor};"></i>`;
        case 'delivered': return `<i class="fas fa-check-double" style="color: ${sentColor};"></i>`;
        case 'sent': return `<i class="fas fa-check" style="color: ${sentColor};"></i>`;
        default: return '';
    }
};

const RepliedMessagePreviewTemplate = (originalMessage) => {
    if (!originalMessage) return '';
    const authorName = originalMessage.from === state.selectedContactId ? state.contacts.find(c => c.id === state.selectedContactId)?.name || 'Cliente' : 'Tú';
    
    let textPreview = originalMessage.text || 'Mensaje';
    if (originalMessage.type === 'audio') {
        textPreview = '🎤 Mensaje de voz';
    } else if (originalMessage.type === 'image' || originalMessage.fileType?.startsWith('image/')) {
        textPreview = '📷 Imagen';
    } else if (originalMessage.type === 'video' || originalMessage.fileType?.startsWith('video/')) {
        textPreview = '🎥 Video';
    } else if (originalMessage.type === 'location') {
        textPreview = '📍 Ubicación';
    } else if (originalMessage.fileType) {
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

    if (message.type === 'audio' && (message.fileUrl || message.mediaProxyUrl)) {
        // --- INICIO DE LA CORRECCIÓN DE AUDIO ---
        const isPermanentLink = !!message.fileUrl;
        // Usa la URL permanente si existe, si no, usa el proxy como fallback para mensajes antiguos.
        const audioSrc = isPermanentLink ? message.fileUrl : `${API_BASE_URL}${message.mediaProxyUrl}`;
        let mimeType = message.fileType || 'audio/ogg'; // Usa el fileType guardado
        
        if (mimeType.includes(';')) {
            mimeType = mimeType.split(';')[0];
        }
        
        // console.log(`[AUDIO] Renderizando audio. Fuente: ${audioSrc}, Tipo: ${mimeType}, Permanente: ${isPermanentLink}`);

        const onErrorHandler = `console.error('[AUDIO] Error al cargar el audio. URL: ${audioSrc}', event.target.error)`;

        contentHTML += `<audio controls preload="metadata" class="chat-audio-player" onerror="${onErrorHandler.replace(/"/g, '&quot;')}">
                            <source src="${audioSrc}" type="${mimeType}">
                            Tu navegador no soporta la reproducción de audio.
                        </audio>`;
        // --- FIN DE LA CORRECCIÓN DE AUDIO ---
    } 
    else if (message.text && message.text.startsWith('🎤') && !message.mediaProxyUrl && !message.fileUrl) {
        contentHTML += `<div><p class="break-words italic text-gray-500">🎤 Mensaje de voz (no se pudo cargar)</p></div>`;
    } else if (message.fileUrl && message.fileType) {
        if (message.fileType.startsWith('image/')) {
            bubbleExtraClass = 'has-image';
            const sentBgClass = isSent ? `bg-[${'var(--color-bubble-sent-bg)'}]` : `bg-[${'var(--color-bubble-received-bg)'}]`;
            const fullImageUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`;
            contentHTML += `
                <div class="${sentBgClass} rounded-lg overflow-hidden">
                    <img src="${fullImageUrl}" alt="Imagen enviada" class="chat-image-preview" onclick="openImageModal('${fullImageUrl}')">
                    ${hasText ? `<div class="p-2 pt-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>` : ''}
                    <div class="time-overlay"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status) : ''}</div>
                </div>`;
            timeAndStatusHTML = '';
        } else if (message.fileType.startsWith('video/')) {
            const videoUrl = message.timestamp ? `${message.fileUrl}?v=${message.timestamp.seconds}` : message.fileUrl;
            const fullVideoUrl = videoUrl.startsWith('http') ? videoUrl : `${API_BASE_URL}${videoUrl}`;
            contentHTML += `<video controls class="message-bubble video rounded-lg mb-1"><source src="${fullVideoUrl}" type="${message.fileType}">Tu navegador no soporta videos.</video>`;
            if(hasText) contentHTML += `<div class="px-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
        } else if (message.type === 'document' || (message.fileType && message.fileType.startsWith('application/'))) { // Manejo de PDF y otros documentos
            const fullDocUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`;
            contentHTML += `
                <a href="${fullDocUrl}" target="_blank" rel="noopener noreferrer" class="document-link">
                    <i class="fas fa-file-alt document-icon"></i>
                    <span class="document-text">${message.document?.filename || message.text || 'Ver Documento'}</span>
                </a>`;
        } else if (message.type === 'sticker' && message.fileUrl) {
            const fullStickerUrl = message.fileUrl.startsWith('http') ? message.fileUrl : `${API_BASE_URL}${message.fileUrl}`;
            contentHTML += `<img src="${fullStickerUrl}" alt="Sticker" class="chat-sticker-preview">`;
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
    } else if (message.type === 'sticker' && !message.fileUrl) {
        contentHTML += `<div class="sticker-fallback"><i class="far fa-sticky-note"></i><span>Sticker</span></div>`;
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
        <div class="flex my-1 ${bubbleAlignment}" data-doc-id="${message.docId}">
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

    const lastUserMessage = state.messages.slice().reverse().find(m => m.from === contact.id);
    let isSessionExpired = false;

    if (lastUserMessage && lastUserMessage.timestamp) {
        const lastMessageTimestamp = lastUserMessage.timestamp.seconds * 1000;
        const now = new Date().getTime();
        const hoursDiff = (now - lastMessageTimestamp) / (1000 * 60 * 60);
        isSessionExpired = hoursDiff > 24;
    } else if (state.messages.length > 0) {
        isSessionExpired = true;
    }
    
    const sessionExpiredNotification = isSessionExpired
        ? `<div class="session-expired-banner">
             <i class="fas fa-lock mr-2"></i> Chat cerrado. Han pasado más de 24 horas.
           </div>`
        : '';
    
    const isInputDisabled = isSessionExpired ? 'disabled' : '';

    const footerContent = `
        <form id="message-form" class="flex items-center space-x-3">
             <label for="file-input" class="cursor-pointer p-2 chat-icon-btn ${isInputDisabled ? 'disabled-icon' : ''}"><i class="fas fa-paperclip text-xl"></i></label>
             <input type="file" id="file-input" onchange="handleFileInputChange(event)" accept="image/*,video/*" ${isInputDisabled}>
             <button type="button" id="emoji-toggle-btn" onclick="toggleEmojiPicker()" class="p-2 chat-icon-btn ${isInputDisabled ? 'disabled-icon' : ''}" ${isInputDisabled}><i class="far fa-smile text-xl"></i></button>
             <button type="button" id="template-toggle-btn" onclick="toggleTemplatePicker()" class="p-2 chat-icon-btn" title="Enviar plantilla"><i class="fas fa-scroll"></i></button>
             <button type="button" id="generate-reply-btn" onclick="handleGenerateReply()" class="p-2 chat-icon-btn ${isInputDisabled ? 'disabled-icon' : ''}" title="Contestar con IA" ${isInputDisabled}><i class="fas fa-magic"></i></button>
             <textarea id="message-input" placeholder="${isSessionExpired ? 'Solo puedes enviar plantillas' : 'Escribe un mensaje o usa / para respuestas rápidas...'}" class="flex-1 !p-0 !mb-0" rows="1" ${isInputDisabled}></textarea>
             <button type="submit" class="btn btn-primary rounded-full w-12 h-12 p-0" ${isInputDisabled}><i class="fas fa-paper-plane text-lg"></i></button>
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
                    ${UserIcon(contact, 'h-24 w-24')}
                    <h2 class="text-2xl font-bold mt-4">${contact.name || 'Desconocido'}</h2>
                    <p class="text-gray-500">+${contact.id}</p>
                     ${contact.lastOrderNumber ? `<p class="text-sm mt-2 text-blue-500 font-semibold">Último Pedido: #${contact.lastOrderNumber}</p>` : ''}
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

const DateSeparatorTemplate = (dateString) => {
    return `<div class="date-separator date-separator-anchor">${dateString}</div>`;
};

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

