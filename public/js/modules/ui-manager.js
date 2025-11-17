// --- START: UI Management & View Rendering ---
// Este archivo se encarga de la navegación, renderizado de vistas,
// y la manipulación de componentes de UI como modales, pickers, etc.

// --- INICIO DE MODIFICACIÓN ---
// Importar la nueva función de api-service (asegúrate de crearla allí)
// import { fetchMessagesByAdIdMetrics } from './api-service.js';
// Necesitamos acceso a state y showError
// import { state, showError } from './state.js'; // Ajusta la ruta si es necesario
// Importar Litepicker si aún no está global
// import Litepicker from 'https://cdn.jsdelivr.net/npm/litepicker/dist/litepicker.js'; // O desde donde lo cargues
// --- FIN DE MODIFICACIÓN ---


let ticking = false; // For scroll event throttling
let tagsSortable = null;
let adMetricsPicker = null; // Variable para la instancia del datepicker de métricas de Ad ID

// --- Navigation & Main View Rendering ---
function navigateTo(viewName, force = false) {
    if (state.activeView === viewName && !force) {
        return;
    }

    state.activeView = viewName;

    const iaSubmenuViews = ['prompts-ia', 'respuestas-ia', 'ajustes-ia'];

    // Actualiza la barra lateral
    document.querySelectorAll('#main-sidebar .nav-item').forEach(item => {
        const isDirectMatch = item.dataset.view === viewName;
        item.classList.toggle('active', isDirectMatch);
    });

    // Maneja el submenú de IA
    const iaMenu = document.getElementById('ia-menu')?.querySelector('.nav-item');
    if (iaMenu) {
        const isIAViewActive = iaSubmenuViews.includes(viewName);
        iaMenu.classList.toggle('active', isIAViewActive);
        const iaSubmenu = document.getElementById('ia-submenu');
        const iaChevron = document.getElementById('ia-menu-chevron');
        if (iaSubmenu && iaChevron) {
            iaSubmenu.classList.toggle('hidden', !isIAViewActive);
            iaChevron.classList.toggle('rotate-180', isIAViewActive);
        }
    }

    // Renderiza la vista principal
    const mainViewContainer = document.getElementById('main-view-container');
    switch (viewName) {
        case 'chats':
            mainViewContainer.innerHTML = ChatViewTemplate();
            renderChatWindow(); // Renderiza la ventana de chat vacía o con el contacto seleccionado
            renderTagFilters(); // Dibuja los filtros de etiqueta
            setupChatListEventListeners(); // Añade scroll infinito, etc.
            handleSearchContacts(); // Renderiza la lista de contactos inicial
            break;
        case 'pipeline':
            mainViewContainer.innerHTML = PipelineViewTemplate();
            renderPipelineView(); // Dibuja el pipeline
            break;
        case 'contacts':
            mainViewContainer.innerHTML = ContactsViewTemplate();
            renderContactsView(); // Dibuja la tabla de contactos
            break;
        case 'etiquetas':
            mainViewContainer.innerHTML = TagsViewTemplate();
            renderTagsView(); // Dibuja la tabla de etiquetas
            break;
        case 'campanas':
            mainViewContainer.innerHTML = CampaignsViewTemplate();
            renderCampaignsView(); // Prepara el formulario de campañas de texto
            break;
        case 'campanas-imagen':
            mainViewContainer.innerHTML = CampaignsWithImageViewTemplate();
            renderCampaignsWithImageView(); // Prepara el formulario de campañas con imagen
            break;
        case 'difusion':
            mainViewContainer.innerHTML = DifusionViewTemplate();
            renderDifusionView(); // Prepara la vista de difusión masiva
            break;
        case 'mensajes-ads':
            mainViewContainer.innerHTML = MensajesAdsViewTemplate();
            renderAdResponsesView(); // Dibuja la tabla de mensajes por Ad
            break;
        case 'prompts-ia':
            mainViewContainer.innerHTML = AIAdPromptsViewTemplate();
            renderAIAdPromptsView(); // Dibuja la tabla de prompts de IA
            break;
        case 'respuestas-rapidas':
            mainViewContainer.innerHTML = QuickRepliesViewTemplate();
            renderQuickRepliesView(); // Dibuja la tabla de respuestas rápidas
            break;
        case 'respuestas-ia':
            mainViewContainer.innerHTML = KnowledgeBaseViewTemplate();
            renderKnowledgeBaseView(); // Dibuja la tabla de base de conocimiento
            break;
        case 'ajustes-ia':
            mainViewContainer.innerHTML = AjustesIAViewTemplate();
            renderAjustesIAView(); // Dibuja la vista de ajustes de IA
            break;
        case 'metricas':
            mainViewContainer.innerHTML = MetricsViewTemplate();
            renderMetricsView(); // Dibuja la vista de métricas (incluyendo la nueva sección)
            break;
        case 'ajustes':
            mainViewContainer.innerHTML = SettingsViewTemplate();
            renderAjustesView(); // Dibuja la vista de ajustes generales
            break;
        default:
            mainViewContainer.innerHTML = `<div class="p-8"><h1 class="text-2xl font-bold">En construcción</h1><p class="mt-4 text-gray-600">Esta sección estará disponible próximamente.</p></div>`;
    }
}

/**
 * Muestra u oculta la barra lateral principal.
 */
function toggleTagSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        state.isTagSidebarOpen = !sidebar.classList.contains('collapsed');
    }
}

// --- Component & Specific View Renderers ---

/**
 * Dibuja los botones de filtro por etiquetas en la vista de chats.
 */
function renderTagFilters() {
    if (state.activeView !== 'chats') return;
    const container = document.getElementById('tag-filters-container');
    if (!container) return;

    // Botón "Todos"
    let buttonsHtml = `<button id="filter-all" class="filter-btn ${state.activeFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Todos</button>`;

    // Botones para cada etiqueta
    state.tags.forEach(tag => {
        buttonsHtml += `<button
                            id="filter-${tag.key}"
                            class="filter-btn ${state.activeFilter === tag.key ? 'active' : ''}"
                            onclick="setFilter('${tag.key}')"
                        >
                            ${tag.label}
                        </button>`;
    });

    container.innerHTML = buttonsHtml;
}

// Renderiza la ventana principal de chat (cabecera, mensajes/notas, footer)
function renderChatWindow() {
    if (state.activeView !== 'chats') return; // Solo ejecutar en la vista de chats

    const chatPanelEl = document.getElementById('chat-panel');
    if (!chatPanelEl) return;

    // Busca el contacto seleccionado actualmente en el estado global
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    // Renderiza la plantilla de la ventana de chat (puede ser el estado vacío si no hay contacto)
    chatPanelEl.innerHTML = ChatWindowTemplate(contact);

    // Añade listener al input de búsqueda de contactos (si existe)
    const searchInput = document.getElementById('search-contacts-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
    }

    // Si hay un contacto seleccionado, renderiza sus componentes específicos
    if (contact) {
        // Renderiza los botones de estado/etiqueta
        const statusWrapper = document.getElementById('contact-status-wrapper');
        if (statusWrapper) { statusWrapper.innerHTML = StatusButtonsTemplate(contact); }

        // Si la pestaña activa es 'chat'
        if (state.activeTab === 'chat') {
            renderMessages(); // Dibuja los mensajes
            // Añade listener de scroll para la cabecera de fecha flotante
            const messagesContainer = document.getElementById('messages-container');
            if (messagesContainer) { messagesContainer.addEventListener('scroll', () => { if (!ticking) { window.requestAnimationFrame(() => { handleScroll(); ticking = false; }); ticking = true; } }); }

            // Añade listeners al formulario de envío de mensajes
            const messageForm = document.getElementById('message-form');
            const messageInput = document.getElementById('message-input');
            if (messageForm) messageForm.addEventListener('submit', handleSendMessage);
            if (messageInput) {
                messageInput.addEventListener('paste', handlePaste); // Para pegar imágenes
                messageInput.addEventListener('input', handleQuickReplyInput); // Para '/shortcut'
                messageInput.addEventListener('keydown', handleMessageInputKeyDown); // Para Enter, Flechas, Esc

                // Ajustar altura del textarea dinámicamente
                messageInput.addEventListener('input', () => {
                    messageInput.style.height = 'auto';
                    let newHeight = messageInput.scrollHeight;
                    if (newHeight > 120) { // Limitar altura máxima
                        newHeight = 120;
                    }
                    messageInput.style.height = newHeight + 'px';
                });

                messageInput.focus(); // Poner foco en el input
            }

        } else if (state.activeTab === 'notes') {
            // Si la pestaña activa es 'notas'
            renderNotes(); // Dibuja las notas
            // Añade listener al formulario de guardar nota
            document.getElementById('note-form').addEventListener('submit', handleSaveNote);
        }
    }
}

// Renderiza la tabla de etiquetas y configura el drag-and-drop
function renderTagsView() {
    if (state.activeView !== 'etiquetas') return;
    const tableBody = document.getElementById('tags-table-body');
    if (!tableBody) return;

    // Genera el HTML para cada fila de la tabla
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

    // Inicializa SortableJS para permitir reordenar las etiquetas arrastrando
    initTagsSortable();
}

// Renderiza la tabla de contactos (vista 'contacts')
function renderContactsView() {
    if (state.activeView !== 'contacts') return;
    const tableBody = document.getElementById('contacts-table-body');
    if (!tableBody) return;

    // Genera el HTML para cada fila
    tableBody.innerHTML = state.contacts.map(contact => {
         // Busca la información de la etiqueta del contacto
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

// Prepara el formulario para campañas de texto
function renderCampaignsView() {
    if (state.activeView !== 'campanas') return;
    const tagSelect = document.getElementById('campaign-tag-select');
    const templateSelect = document.getElementById('campaign-template-select');

    // Poblar select de etiquetas
    if (tagSelect) {
        tagSelect.innerHTML = '<option value="all">Todos los contactos</option>' + state.tags.map(tag => `<option value="${tag.key}">${tag.label}</option>`).join('');
    }
    // Poblar select de plantillas
    if (templateSelect) {
        templateSelect.innerHTML = '<option value="">-- Selecciona una plantilla --</option>' + state.templates.map(t => `<option value='${JSON.stringify(t)}'>${t.name} (${t.language})</option>`).join('');
    }
    // Actualizar contador inicial de destinatarios
    updateCampaignRecipientCount();
}

// Prepara el formulario para campañas con imagen
function renderCampaignsWithImageView() {
    if (state.activeView !== 'campanas-imagen') return;
    const tagSelect = document.getElementById('campaign-image-tag-select');
    const templateSelect = document.getElementById('campaign-image-template-select');

    // Poblar select de etiquetas
    if (tagSelect) {
        tagSelect.innerHTML = '<option value="all">Todos los contactos</option>' + state.tags.map(tag => `<option value="${tag.key}">${tag.label}</option>`).join('');
    }
    // Poblar select de plantillas (solo las que aceptan imagen en cabecera)
    if (templateSelect) {
        const imageTemplates = state.templates.filter(t => t.components.some(c => c.type === 'HEADER' && c.format === 'IMAGE'));
        templateSelect.innerHTML = '<option value="">-- Selecciona una plantilla --</option>' + imageTemplates.map(t => `<option value='${t.name}'>${t.name} (${t.language})</option>`).join('');
    }
    // Actualizar contador inicial de destinatarios
    updateCampaignRecipientCount('image');
}

// Prepara la vista de difusión masiva
function renderDifusionView() {
    if (state.activeView !== 'difusion') return;

    // Poblar dropdown de respuestas rápidas para la secuencia
    const quickReplyDropdown = document.getElementById('quick-reply-dropdown');
    if (quickReplyDropdown) {
        quickReplyDropdown.innerHTML = state.quickReplies.map(qr =>
            `<a href="#" data-id="${qr.id}" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 quick-reply-item"><strong>/${qr.shortcut}</strong>: ${qr.message || 'Adjunto'}</a>`
        ).join('');
    }

    // Poblar select de plantillas para la contingencia
    const contingencyTemplateSelect = document.getElementById('contingency-template-select');
    if (contingencyTemplateSelect) {
        contingencyTemplateSelect.innerHTML = '<option value="">-- Seleccionar plantilla --</option>' + state.templates
            .map(t => `<option value='${JSON.stringify(t)}'>${t.name} (${t.category})</option>`)
            .join('');
    }

    // Llama a la función (definida en difusion-handlers.js) para configurar listeners
    initializeDifusionHandlers();
}

// Renderiza la tabla de respuestas rápidas
function renderQuickRepliesView() {
    if (state.activeView !== 'respuestas-rapidas') return;
    const tableBody = document.getElementById('quick-replies-table-body');
    if (!tableBody) return;

    // Genera HTML para cada fila
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

// Renderiza la tabla de mensajes automáticos por anuncio
function renderAdResponsesView() {
    if (state.activeView !== 'mensajes-ads') return;
    const tableBody = document.getElementById('ad-responses-table-body');
    if (!tableBody) return;

    // Mensaje si no hay respuestas configuradas
    if (state.adResponses.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-4">No has agregado ningún mensaje de anuncio todavía.</td></tr>`;
        return;
    }

    // Genera HTML para cada fila
    tableBody.innerHTML = state.adResponses.map(response => {
        // Muestra los Ad IDs como string separado por comas
        const adIdsText = Array.isArray(response.adIds) ? response.adIds.join(', ') : (response.adId || ''); // Incluye fallback por si hay datos viejos
        return `
            <tr>
                <td class="font-semibold">${response.adName}</td>
                <td class="font-mono text-sm">${adIdsText}</td>
                <td class="text-gray-600 max-w-sm truncate" title="${response.message}">${response.message || ''} ${response.fileUrl ? '<i class="fas fa-paperclip text-gray-400 ml-2"></i>' : ''}</td>
                <td class="actions-cell">
                    <button onclick="openAdResponseModal('${response.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                    <button onclick="handleDeleteAdResponse('${response.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}


// Renderiza la tabla de prompts de IA por anuncio
function renderAIAdPromptsView() {
    if (state.activeView !== 'prompts-ia') return;
    const tableBody = document.getElementById('ai-ad-prompts-table-body');
    if (!tableBody) return;

    // Mensaje si no hay prompts configurados
    if (state.aiAdPrompts.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-4">No has agregado ningún prompt de IA todavía.</td></tr>`;
        return;
    }

    // Genera HTML para cada fila
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

// Renderiza la vista del pipeline de ventas
function renderPipelineView() {
    if (state.activeView !== 'pipeline') return;
    const container = document.getElementById('pipeline-container');
    if (!container) return;

    // Genera HTML para cada columna (etiqueta)
    container.innerHTML = state.tags.map(tag => {
        // Filtra contactos que pertenecen a esta etiqueta
        const contactsInStage = state.contacts.filter(c => c.status === tag.key);
        // Calcula no leídos para la cabecera
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
                    ${contactsInStage.map(contact => { // Genera una tarjeta para cada contacto
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

    // Inicializa SortableJS para permitir arrastrar tarjetas entre columnas
    document.querySelectorAll('.pipeline-cards').forEach(column => {
        new Sortable(column, {
            group: 'pipeline', // Permite arrastrar entre columnas del mismo grupo
            animation: 150,
            ghostClass: 'sortable-ghost', // Clase CSS para el placeholder
            onEnd: (evt) => { // Cuando se suelta una tarjeta
                const contactId = evt.item.dataset.contactId; // ID del contacto movido
                const newTagKey = evt.to.dataset.tagKey; // Key de la etiqueta destino
                handleStatusChange(contactId, newTagKey); // Llama a la función para actualizar el estado
            }
        });
    });
}

// Renderiza la tabla de la base de conocimiento
function renderKnowledgeBaseView() {
    if (state.activeView !== 'respuestas-ia') return;
    const kbTableBody = document.getElementById('kb-table-body');
    if (!kbTableBody) return;

    // Genera HTML para cada fila
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

// Renderiza la vista de ajustes de IA
function renderAjustesIAView() {
    if (state.activeView !== 'ajustes-ia') return;

    // Actualiza el estado del interruptor global
    const botToggle = document.getElementById('global-bot-toggle');
    if (botToggle) {
        botToggle.checked = state.globalBotSettings.isActive;
    }

    // Añade listener al input de búsqueda de contactos para anulaciones
    const searchInput = document.getElementById('bot-contact-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderBotContactsTable(e.target.value); // Filtra la tabla al escribir
        });
    }

    // Renderiza la tabla inicial de anulaciones
    renderBotContactsTable();
}

// Renderiza la tabla de anulaciones de IA por contacto (filtrada)
function renderBotContactsTable(searchTerm = '') {
    const botContactsTableBody = document.getElementById('bot-contacts-table-body');
    if(!botContactsTableBody) return;

    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    // Filtra contactos por nombre o ID
    const filteredContacts = state.contacts.filter(contact =>
        (contact.name && contact.name.toLowerCase().includes(lowerCaseSearchTerm)) ||
        (contact.id && contact.id.includes(lowerCaseSearchTerm))
    );

    // Genera HTML para cada fila
    botContactsTableBody.innerHTML = filteredContacts.map(contact => `
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

// Renderiza la vista de ajustes generales
function renderAjustesView() {
    if (state.activeView !== 'ajustes') return;
    // Actualiza el estado del interruptor de mensaje de ausencia
    const awayToggle = document.getElementById('away-message-toggle');
    if (awayToggle) {
        awayToggle.checked = state.awayMessageSettings.isActive;
    }

    // Rellena el input del ID de Google Sheet
    const sheetIdInput = document.getElementById('google-sheet-id-input');
    if (sheetIdInput) {
        sheetIdInput.value = state.googleSheetSettings.googleSheetId || '';
    }
    // Añade listener al botón de guardar ID de Google Sheet
    const saveSheetIdBtn = document.getElementById('save-google-sheet-id-btn');
    if (saveSheetIdBtn) {
        // Evita añadir múltiples listeners
        saveSheetIdBtn.removeEventListener('click', handleSaveGoogleSheetId);
        saveSheetIdBtn.addEventListener('click', handleSaveGoogleSheetId);
    }
    // Añade listener al formulario de simulación de mensaje de Ad
    const simulateAdForm = document.getElementById('simulate-ad-form');
    if (simulateAdForm) {
         // Evita añadir múltiples listeners
        simulateAdForm.removeEventListener('submit', handleSimulateAdMessage);
        simulateAdForm.addEventListener('submit', handleSimulateAdMessage);
    }
}

// --- INICIO DE MODIFICACIÓN: Renderizado de Métricas ---
// Renderiza la vista de métricas, incluyendo gráficas y la nueva sección de Ad IDs
async function renderMetricsView() {
    if (state.activeView !== 'metricas') return;

    const loadingEl = document.getElementById('metrics-loading');
    const contentEl = document.getElementById('metrics-content');
    const adMetricsLoadingEl = document.getElementById('ad-metrics-loading');
    const adMetricsNoDataEl = document.getElementById('ad-metrics-no-data');
    const adMetricsTableContainer = document.getElementById('ad-metrics-table-container');

    // Inicializar Litepicker para el rango de fechas de Ad Metrics
    const dateRangeInput = document.getElementById('ad-metrics-date-range');
    if (dateRangeInput && !adMetricsPicker) { // Inicializar solo una vez
        adMetricsPicker = new Litepicker({
            element: dateRangeInput,
            singleMode: false,
            format: 'YYYY-MM-DD', // Formato requerido por la API
            plugins: ['ranges'],
            setup: (picker) => {
                // No hacer nada al seleccionar, esperar al botón "Cargar Datos"
            }
        });
    }

    // Añadir listeners a los botones de la sección Ad Metrics
    const loadBtn = document.getElementById('load-ad-metrics-btn');
    const clearBtn = document.getElementById('clear-ad-metrics-filter-btn');

    if (loadBtn) {
        loadBtn.removeEventListener('click', loadAdIdMetrics); // Evitar duplicados
        loadBtn.addEventListener('click', loadAdIdMetrics);
    }
    if (clearBtn) {
        clearBtn.removeEventListener('click', clearAdIdMetricsFilter); // Evitar duplicados
        clearBtn.addEventListener('click', clearAdIdMetricsFilter);
    }

    // Cargar las métricas generales (gráficas)
    try {
        const response = await fetch(`${API_BASE_URL}/api/metrics`);
        if (!response.ok) {
            throw new Error('No se pudieron cargar los datos de métricas generales.');
        }
        const result = await response.json();
        const metricsData = result.data;

        loadingEl.classList.add('hidden'); // Ocultar carga general
        contentEl.classList.remove('hidden'); // Mostrar contenido

        renderDailyMessagesChart(metricsData); // Renderizar gráfica diaria
        renderTagsDistributionChart(metricsData); // Renderizar gráfica de etiquetas

    } catch (error) {
        console.error("Error fetching general metrics:", error);
        showError(error.message);
        loadingEl.innerHTML = `<p class="text-red-500">${error.message}</p>`; // Mostrar error en carga general
    }
}

// Función para cargar y renderizar los datos de mensajes por Ad ID
async function loadAdIdMetrics() {
    const loadingEl = document.getElementById('ad-metrics-loading');
    const noDataEl = document.getElementById('ad-metrics-no-data');
    const tableContainer = document.getElementById('ad-metrics-table-container');
    const tableBody = document.getElementById('ad-metrics-table-body');

    if (!adMetricsPicker || !loadingEl || !noDataEl || !tableContainer || !tableBody) return;

    const startDate = adMetricsPicker.getStartDate() ? adMetricsPicker.getStartDate().format('YYYY-MM-DD') : null;
    const endDate = adMetricsPicker.getEndDate() ? adMetricsPicker.getEndDate().format('YYYY-MM-DD') : null;

    if (!startDate || !endDate) {
        showError("Por favor, selecciona un rango de fechas.");
        return;
    }

    // Mostrar estado de carga y ocultar resultados anteriores
    loadingEl.classList.remove('hidden');
    noDataEl.classList.add('hidden');
    tableContainer.classList.add('hidden');
    tableBody.innerHTML = '';

    try {
        // Llamar a la función del api-service (DEBES CREARLA)
        const counts = await fetchMessagesByAdIdMetrics(startDate, endDate); // Asume que esta función existe en api-service.js

        if (Object.keys(counts).length === 0) {
            noDataEl.classList.remove('hidden'); // Mostrar mensaje de "sin datos"
        } else {
            renderAdIdMetricsTable(counts); // Renderizar la tabla con los datos
            tableContainer.classList.remove('hidden'); // Mostrar la tabla
        }
    } catch (error) {
        console.error("Error loading Ad ID metrics:", error);
        showError(error.message);
        noDataEl.textContent = `Error al cargar: ${error.message}`;
        noDataEl.classList.remove('hidden');
    } finally {
        loadingEl.classList.add('hidden'); // Ocultar spinner de carga
    }
}

// Función para limpiar el filtro de fechas de Ad Metrics
function clearAdIdMetricsFilter() {
    if (adMetricsPicker) {
        adMetricsPicker.clearSelection();
    }
    document.getElementById('ad-metrics-no-data')?.classList.add('hidden');
    document.getElementById('ad-metrics-table-container')?.classList.add('hidden');
    document.getElementById('ad-metrics-table-body').innerHTML = '';
}

// Función para renderizar la tabla de resultados de Ad ID Metrics
function renderAdIdMetricsTable(counts) {
    const tableBody = document.getElementById('ad-metrics-table-body');
    if (!tableBody) return;

    // Convertir el objeto a un array y ordenar por conteo descendente
    const sortedCounts = Object.entries(counts).sort(([, countA], [, countB]) => countB - countA);

    // Generar filas de la tabla
    tableBody.innerHTML = sortedCounts.map(([adId, count]) => `
        <tr>
            <td class="font-mono text-sm">${adId}</td>
            <td class="font-semibold text-center">${count}</td>
        </tr>
    `).join('');
}
// --- FIN DE MODIFICACIÓN ---

// Renderiza la gráfica de mensajes diarios
function renderDailyMessagesChart(data) {
    const ctx = document.getElementById('daily-messages-chart')?.getContext('2d');
    if (!ctx) return;

    // Destruir gráfica anterior si existe
    if (dailyMessagesChart) {
        dailyMessagesChart.destroy();
    }

    // Preparar datos para Chart.js
    const labels = data.map(d => new Date(d.date + 'T00:00:00Z').toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })); // Ajuste para UTC
    const totalMessages = data.map(d => d.totalMessages);

    // Crear nueva gráfica
    dailyMessagesChart = new Chart(ctx, {
        type: 'bar', // Tipo barra
        data: {
            labels: labels,
            datasets: [{
                label: 'Mensajes Recibidos',
                data: totalMessages,
                backgroundColor: 'rgba(129, 178, 154, 0.6)', // Color principal suave
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
                    beginAtZero: true, // Empezar eje Y en 0
                    ticks: {
                        // stepSize: 1 // REMOVED: Let Chart.js calculate automatically
                    }
                }
            },
            plugins: {
                legend: {
                    display: false // Ocultar leyenda
                }
            }
        }
    });
}


// Renderiza la gráfica de distribución por etiquetas
function renderTagsDistributionChart(data) {
    const ctx = document.getElementById('tags-distribution-chart')?.getContext('2d');
    if (!ctx) return;

    // Destruir gráfica anterior si existe
    if (tagsDistributionChart) {
        tagsDistributionChart.destroy();
    }

    // Contar mensajes por etiqueta en todo el período
    const tagCounts = {};
    data.forEach(dailyData => {
        for (const tagKey in dailyData.tags) {
            if (!tagCounts[tagKey]) {
                tagCounts[tagKey] = 0;
            }
            tagCounts[tagKey] += dailyData.tags[tagKey];
        }
    });

    // Mapear keys de etiquetas a labels y colores
    const tagInfoMap = state.tags.reduce((acc, tag) => {
        acc[tag.key] = { label: tag.label, color: tag.color };
        return acc;
    }, {});
    tagInfoMap['sin_etiqueta'] = { label: 'Sin Etiqueta', color: '#a0aec0' }; // Añadir default

    // Preparar datos para Chart.js
    const labels = Object.keys(tagCounts).map(key => tagInfoMap[key]?.label || key);
    const counts = Object.values(tagCounts);
    const backgroundColors = Object.keys(tagCounts).map(key => tagInfoMap[key]?.color || '#a0aec0');

    // Crear nueva gráfica de dona
    tagsDistributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'Distribución por Etiqueta',
                data: counts,
                backgroundColor: backgroundColors,
                hoverOffset: 4 // Efecto al pasar el mouse
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top', // Posición de la leyenda
                },
                tooltip: { // Configuración de tooltips
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += context.parsed; // Muestra el valor numérico
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}


// Renderiza la lista de mensajes en el chat activo
function renderMessages() {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    let lastMessageDate = null; // Para agrupar por fecha
    let messagesHtml = '';

    // Genera HTML para cada mensaje, añadiendo separadores de fecha
    state.messages.forEach(message => {
        if (message.timestamp && typeof message.timestamp.seconds === 'number') {
            const currentMessageDate = new Date(message.timestamp.seconds * 1000);
            if (!isSameDay(currentMessageDate, lastMessageDate)) { // Si es un día diferente al anterior
                messagesHtml += DateSeparatorTemplate(formatDateSeparator(currentMessageDate)); // Añade separador
                lastMessageDate = currentMessageDate;
            }
        }
        messagesHtml += MessageBubbleTemplate(message); // Añade burbuja de mensaje
    });

    contentContainer.innerHTML = messagesHtml; // Actualiza el DOM
    // Scroll hasta el final
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    handleScroll(); // Actualiza la cabecera de fecha flotante
}

// Añade un nuevo mensaje al final de la lista (para UI optimista)
function appendMessage(message) {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    // Verifica si se necesita un separador de fecha comparando con el penúltimo mensaje
    const lastMessage = state.messages.length > 1 ? state.messages[state.messages.length - 2] : null;
    const lastMessageDate = lastMessage?.timestamp ? new Date(lastMessage.timestamp.seconds * 1000) : null;
    const currentMessageDate = message.timestamp ? new Date(message.timestamp.seconds * 1000) : null;

    if (currentMessageDate && !isSameDay(currentMessageDate, lastMessageDate)) {
        const separatorHtml = DateSeparatorTemplate(formatDateSeparator(currentMessageDate));
        contentContainer.insertAdjacentHTML('beforeend', separatorHtml); // Añade separador
    }

    // Añade la nueva burbuja de mensaje
    const messageHtml = MessageBubbleTemplate(message);
    contentContainer.insertAdjacentHTML('beforeend', messageHtml);

    // Scroll hasta el final
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


// Renderiza la lista de notas internas
function renderNotes() {
    const contentContainer = document.getElementById('notes-content');
    if (!contentContainer) return;
    contentContainer.innerHTML = state.notes.map(NoteItemTemplate).join(''); // Genera HTML para cada nota
}

/**
 * Muestra una cabecera de fecha flotante mientras el usuario se desplaza
 * por la lista de mensajes.
 */
function handleScroll() {
    const messagesContainer = document.getElementById('messages-container');
    const stickyHeader = document.getElementById('sticky-date-header');
    if (!messagesContainer || !stickyHeader) return;

    // Encuentra todos los separadores de fecha visibles
    const dateSeparators = messagesContainer.querySelectorAll('.date-separator-anchor');
    if (dateSeparators.length === 0) {
        stickyHeader.classList.remove('visible'); // Oculta si no hay separadores
        return;
    }

    let topVisibleSeparator = null;
    // Itera desde el último separador hacia arriba
    for (let i = dateSeparators.length - 1; i >= 0; i--) {
        const separator = dateSeparators[i];
        const rect = separator.getBoundingClientRect(); // Posición del separador
        const containerRect = messagesContainer.getBoundingClientRect(); // Posición del contenedor

        // Si el separador está por encima del borde superior visible del contenedor
        if (rect.top < containerRect.top) {
            topVisibleSeparator = separator; // Este es el que debe mostrarse en la cabecera
            break;
        }
    }

    // Actualiza o oculta la cabecera flotante
    if (topVisibleSeparator) {
        stickyHeader.textContent = topVisibleSeparator.textContent;
        stickyHeader.classList.add('visible');
    } else {
        stickyHeader.classList.remove('visible');
    }
}


// --- UI Helpers & Modals ---

// Muestra un mensaje de error/éxito temporal en la parte superior
function showError(message, type = 'error') {
    const container = document.getElementById('error-container');
    const messageEl = document.getElementById('error-message');
    if (!container || !messageEl) return;

    // Cambia el color de fondo y texto según el tipo
    container.classList.remove('bg-yellow-200', 'text-yellow-800', 'bg-green-200', 'text-green-800');
    if (type === 'success') {
        container.classList.add('bg-green-200', 'text-green-800');
        messageEl.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    } else { // 'error' o cualquier otro tipo
        container.classList.add('bg-yellow-200', 'text-yellow-800');
        messageEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${message}`;
    }

    container.classList.remove('hidden'); // Muestra el contenedor
    setTimeout(() => hideError(), 5000); // Oculta después de 5 segundos
}

// Oculta el mensaje de error/éxito
function hideError() {
    const errorContainerEl = document.getElementById('error-container');
    if(errorContainerEl) {
        errorContainerEl.classList.add('hidden');
    }
}

// Abre el modal para ver una imagen ampliada
function openImageModal(imageUrl) {
    const modal = document.getElementById('image-modal');
    const modalImage = document.getElementById('modal-image-content');
    modalImage.src = imageUrl; // Establece la imagen
    modal.classList.add('visible'); // Muestra el modal
}

// Cierra el modal de imagen ampliada
function closeImageModal() {
    const modal = document.getElementById('image-modal');
    modal.classList.remove('visible'); // Oculta el modal
    const modalImage = document.getElementById('modal-image-content');
    // Limpia la imagen después de la animación para evitar saltos visuales
    setTimeout(() => { modalImage.src = ''; }, 300);
}

// Abre la barra lateral de detalles del contacto
async function openContactDetails() {
    const contactDetailsPanelEl = document.getElementById('contact-details-panel');
    // Validaciones
    if (!state.selectedContactId || !contactDetailsPanelEl) return;
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    if (!contact) return;

    // Renderiza la plantilla de la barra lateral
    contactDetailsPanelEl.innerHTML = ContactDetailsSidebarTemplate(contact);
    contactDetailsPanelEl.classList.add('open'); // Muestra la barra lateral
    state.contactDetailsOpen = true;

    // Carga y muestra el historial de pedidos
    const ordersListEl = document.getElementById('contact-orders-list');
    if (ordersListEl) {
        ordersListEl.innerHTML = `<div class="order-history-item loading"><i class="fas fa-spinner fa-spin"></i> Cargando historial...</div>`;

        // Inicia el listener en tiempo real para los pedidos de este contacto
        listenForContactOrders(contact.id, (orders) => {
            state.selectedContactOrders = orders; // Guarda los pedidos en el estado
            // Asegura que la barra lateral siga abierta antes de actualizar
            if (ordersListEl.closest('.open')) {
                if (orders && orders.length > 0) {
                    // Renderiza la lista de pedidos
                    ordersListEl.innerHTML = orders.map(OrderHistoryItemTemplate).join('');
                } else {
                    ordersListEl.innerHTML = `<div class="order-history-item empty">No hay pedidos anteriores.</div>`;
                }
            }
        });

        // --- Listener para cambios en los <select> de estatus (delegación de eventos) ---
        // Se mueve aquí para asegurar que exista `ordersListEl`
        ordersListEl.addEventListener('change', (event) => {
            if (event.target.classList.contains('order-history-status-select')) {
                const orderId = event.target.dataset.orderId;
                const newStatus = event.target.value;
                handleOrderStatusChange(orderId, newStatus, event.target);
            }
        });
        // --- Fin Listener ---
    }
}


// Cierra la barra lateral de detalles del contacto
function closeContactDetails() {
    const contactDetailsPanelEl = document.getElementById('contact-details-panel');
    if(contactDetailsPanelEl) {
        contactDetailsPanelEl.classList.remove('open'); // Oculta la barra
        contactDetailsPanelEl.innerHTML = ''; // Limpia el contenido
    }
    state.contactDetailsOpen = false;
    // Detiene el listener de pedidos cuando se cierra
    if (unsubscribeOrdersListener) {
        unsubscribeOrdersListener();
        unsubscribeOrdersListener = null;
    }
}

/**
 * Renderiza la vista previa de un archivo adjunto (local o remoto).
 */
function renderFilePreview() {
    const container = document.getElementById('file-preview-container');
    if (!container) return;

    if (state.stagedFile) { // Si hay un archivo local seleccionado
        container.innerHTML = LocalFilePreviewTemplate(state.stagedFile);
        container.classList.remove('hidden');
    } else if (state.stagedRemoteFile) { // Si hay un archivo remoto (de respuesta rápida)
        container.innerHTML = RemoteFilePreviewTemplate(state.stagedRemoteFile);
        container.classList.remove('hidden');
    } else { // Si no hay archivo adjunto
        container.innerHTML = '';
        container.classList.add('hidden');
    }
}

// --- START: New Order Modal ---
// Functions to manage the new order modal, including photo previews and drag & drop.
let orderPhotosManager = []; // Array para fotos del pedido
let promoPhotosManager = []; // Array para fotos de la promoción

// Abre el modal para registrar un nuevo pedido
function openNewOrderModal() {
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    if (!contact) {
        showError("Por favor, selecciona un contacto para registrar un pedido.");
        return;
    }

    const modalContainer = document.getElementById('new-order-modal-container');
    if (!modalContainer) return;

    // Renderiza la plantilla del modal
    modalContainer.innerHTML = NewOrderModalTemplate();

    // Rellena el teléfono del contacto seleccionado
    const phoneInput = document.getElementById('order-phone');
    if (phoneInput) {
        phoneInput.value = contact.id;
    }

    // Resetea los arrays de fotos
    orderPhotosManager = [];
    promoPhotosManager = [];

    // Configura listeners para el modal recién creado
    document.getElementById('new-order-form').addEventListener('submit', handleSaveOrder);

    // Lógica para mostrar/ocultar input "Otro producto"
    const productSelect = document.getElementById('order-product-select');
    const productOtherInput = document.getElementById('order-product-other');
    if(productSelect && productOtherInput) {
        productSelect.addEventListener('change', () => {
            const isOther = productSelect.value === 'Otro';
            productOtherInput.style.display = isOther ? 'block' : 'none';
            productOtherInput.required = isOther;
            if(isOther) productOtherInput.focus();
        });
    }

    // Configura drag & drop y vista previa para fotos del pedido
    const orderPhotoContainer = document.getElementById('order-file-input-container-product');
    const orderPhotoInput = document.getElementById('order-photo-file');
    const orderPreviewContainer = document.getElementById('order-photos-preview-container');
    setupPhotoManager(orderPhotoContainer, orderPhotoInput, orderPreviewContainer, orderPhotosManager, 'order');

    // Configura drag & drop y vista previa para fotos de promoción
    const promoPhotoContainer = document.getElementById('order-file-input-container-promo');
    const promoPhotoInput = document.getElementById('order-promo-photo-file');
    const promoPreviewContainer = document.getElementById('order-promo-photos-preview-container');
    setupPhotoManager(promoPhotoContainer, promoPhotoInput, promoPreviewContainer, promoPhotosManager, 'promo');

    // Lógica del checkbox "Usar misma foto"
    const samePhotoCheckbox = document.getElementById('order-same-photo-checkbox');
    const samePhotoContainer = document.getElementById('order-same-photo-container'); // Contenedor del checkbox
    const promoFileInputContainer = document.getElementById('order-file-input-container-promo'); // Contenedor de subida de promo

    if(samePhotoCheckbox && samePhotoContainer && promoFileInputContainer) {
        samePhotoCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Copia las fotos del pedido a la promoción
                promoPhotosManager = [...orderPhotosManager];
                renderPhotoPreviews(promoPreviewContainer, promoPhotosManager, 'promo'); // Actualiza vista previa de promo
                promoFileInputContainer.classList.add('hidden'); // Oculta área de subida de promo
            } else {
                promoFileInputContainer.classList.remove('hidden'); // Muestra área de subida de promo
            }
        });

        // Mostrar/ocultar el checkbox basado en si hay fotos de pedido
        if(orderPhotosManager.length > 0) {
            samePhotoContainer.style.display = 'flex';
        } else {
             samePhotoContainer.style.display = 'none';
        }
    }
}


// Cierra el modal de nuevo pedido y limpia los arrays de fotos
function closeNewOrderModal() {
    const modalContainer = document.getElementById('new-order-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = ''; // Limpia el contenido del modal
    }
    // Limpia los arrays de fotos
    orderPhotosManager = [];
    promoPhotosManager = [];
}
// --- END: New Order Modal ---

// --- START: Conversation Preview Modal ---
// Cierra el modal de previsualización de conversación
function closeConversationPreviewModal() {
    const modalContainer = document.getElementById('conversation-preview-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = ''; // Limpia el contenido
    }
    document.body.classList.remove('modal-open'); // Permite scroll en el body
}
// --- END: Conversation Preview Modal ---

// --- INICIO DE MODIFICACIÓN: Funciones para el modal de detalles/edición de pedido ---


// Cierra el modal de edición de pedido y limpia los arrays de fotos
function closeOrderEditModal() {
    const modalContainer = document.getElementById('order-edit-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = ''; // Limpia el contenido
    }
    // Limpia los arrays de fotos de edición
    editOrderPhotosManager = [];
    editPromoPhotosManager = [];
}

/**
 * Abre el modal para editar un pedido existente.
 * @param {string} orderId - El ID del pedido a editar.
 */
function openOrderEditModal(orderId) {
    const order = state.selectedContactOrders.find(o => o.id === orderId);
    if (!order) {
        showError("No se pudo encontrar el pedido para editar.");
        return;
    }

    const modalContainer = document.getElementById('order-edit-modal-container');
    if (!modalContainer) {
        console.error("El contenedor del modal de edición de pedidos no existe.");
        return;
    }

    // Asumimos que existe una plantilla OrderEditModalTemplate similar a NewOrderModalTemplate
    // y que esta plantilla ya incluye los IDs correctos para los campos del formulario.
    modalContainer.innerHTML = OrderEditModalTemplate(order);

    // Configurar los manejadores de fotos para la edición
    // (Asumimos que estas variables globales existen y son usadas por el modal de edición)
    editOrderPhotosManager = order.fotoUrls ? order.fotoUrls.map(url => ({ file: null, url, isNew: false })) : [];
    editPromoPhotosManager = order.fotoPromocionUrls ? order.fotoPromocionUrls.map(url => ({ file: null, url, isNew: false })) : [];

    // Aquí iría la lógica para renderizar las vistas previas de las fotos,
    // similar a como se hace en openNewOrderModal, pero para los contenedores de edición.
    // Ejemplo:
    // const editOrderPreviewContainer = document.getElementById('edit-order-photos-preview-container');
    // renderPhotoPreviews(editOrderPreviewContainer, editOrderPhotosManager, 'edit-order');

    // Añadir el listener para el envío del formulario de edición
    const form = document.getElementById('edit-order-form');
    if (form) {
        form.addEventListener('submit', (event) => handleUpdateExistingOrder(event, orderId));
    } else {
        console.error("El formulario de edición de pedido ('edit-order-form') no se encontró en la plantilla.");
    }
}
// --- FIN DE MODIFICACIÓN ---

// --- Funciones para Modales (Ad Response, Quick Reply, Knowledge Base, etc.) ---

// Abre el modal para añadir/editar Mensajes de Anuncio
function openAdResponseModal(responseId = null) {
    const modal = document.getElementById('ad-response-modal');
    if (!modal) return;

    // Obtener referencias a elementos del formulario
    const form = document.getElementById('ad-response-form');
    const titleEl = document.getElementById('ad-response-modal-title');
    const docIdInput = document.getElementById('ar-doc-id');
    const nameInput = document.getElementById('ar-name');
    const adIdInput = document.getElementById('ar-ad-id'); // Este es el input que modificaremos
    const messageTextarea = document.getElementById('ar-message');
    const fileUrlInput = document.getElementById('ar-file-url');
    const fileTypeInput = document.getElementById('ar-file-type');
    const mediaPreview = document.getElementById('ar-media-preview');
    const attachButtonText = document.getElementById('ar-attach-button-text');
    const fileInput = document.getElementById('ar-file-input');

    // Resetear formulario
    form.reset();
    docIdInput.value = '';
    fileUrlInput.value = ''; // Limpiar URL oculta
    fileTypeInput.value = ''; // Limpiar tipo oculto
    mediaPreview.innerHTML = ''; // Limpiar vista previa
    attachButtonText.textContent = 'Adjuntar Archivo'; // Texto original del botón

    if (responseId) {
        // --- Modo Edición ---
        const adResponse = state.adResponses.find(r => r.id === responseId); // Busca la respuesta en el estado
        if (adResponse) {
            titleEl.textContent = 'Editar Mensaje de Anuncio';
            docIdInput.value = adResponse.id; // Guarda el ID para la actualización
            nameInput.value = adResponse.adName || '';
            // --- INICIO MODIFICACIÓN: Poblar con IDs separados por comas ---
            // Unir el array 'adIds' (o usar 'adId' como fallback) en un string
            adIdInput.value = Array.isArray(adResponse.adIds) ? adResponse.adIds.join(', ') : (adResponse.adId || '');
            // --- FIN MODIFICACIÓN ---
            messageTextarea.value = adResponse.message || '';
            fileUrlInput.value = adResponse.fileUrl || ''; // Guarda URL existente (oculta)
            fileTypeInput.value = adResponse.fileType || ''; // Guarda tipo existente (oculto)

            // Muestra enlace al archivo adjunto actual si existe
            if (adResponse.fileUrl) {
                mediaPreview.innerHTML = `<a href="${adResponse.fileUrl}" target="_blank" class="text-blue-600 hover:underline">Ver adjunto actual</a>`;
                attachButtonText.textContent = 'Reemplazar Archivo'; // Cambia texto del botón
            }
        }
    } else {
        // --- Modo Añadir ---
        titleEl.textContent = 'Añadir Mensaje de Anuncio';
        adIdInput.value = ''; // Asegurarse de que esté vacío al añadir uno nuevo
    }

    // Listener para el input de archivo (maneja la selección de un NUEVO archivo)
    fileInput.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            fileUrlInput.value = ''; // Limpia la URL existente si se selecciona uno nuevo
            fileTypeInput.value = file.type; // Guarda el tipo del nuevo archivo
            mediaPreview.innerHTML = `<span class="text-sm text-gray-600">Archivo seleccionado: <strong>${file.name}</strong></span>`;
            attachButtonText.textContent = 'Cambiar Archivo';
        }
    };

    modal.classList.remove('hidden'); // Muestra el modal
}


// Cierra el modal de Mensajes de Anuncio
function closeAdResponseModal() {
    const modal = document.getElementById('ad-response-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Abre el modal para añadir/editar Respuestas Rápidas
function openQuickReplyModal(replyId = null) {
    const modal = document.getElementById('quick-reply-modal');
    if (!modal) return;

    // Referencias a elementos del form
    const form = document.getElementById('quick-reply-form');
    const titleEl = document.getElementById('quick-reply-modal-title');
    const docIdInput = document.getElementById('qr-doc-id');
    const shortcutInput = document.getElementById('qr-shortcut');
    const messageTextarea = document.getElementById('qr-message');
    const fileUrlInput = document.getElementById('qr-file-url');
    const fileTypeInput = document.getElementById('qr-file-type');
    const mediaPreview = document.getElementById('qr-media-preview');
    const attachButtonText = document.getElementById('qr-attach-button-text');
    const fileInput = document.getElementById('qr-file-input');

    // Resetear form
    form.reset();
    docIdInput.value = '';
    fileUrlInput.value = '';
    fileTypeInput.value = '';
    mediaPreview.innerHTML = '';
    attachButtonText.textContent = 'Adjuntar Archivo';

    if (replyId) {
        // --- Modo Edición ---
        const reply = state.quickReplies.find(r => r.id === replyId); // Busca en estado
        if (reply) {
            titleEl.textContent = 'Editar Respuesta Rápida';
            docIdInput.value = reply.id;
            shortcutInput.value = reply.shortcut || '';
            messageTextarea.value = reply.message || '';
            fileUrlInput.value = reply.fileUrl || '';
            fileTypeInput.value = reply.fileType || '';

            // Muestra enlace al adjunto actual
            if (reply.fileUrl) {
                mediaPreview.innerHTML = `<a href="${reply.fileUrl}" target="_blank" class="text-blue-600 hover:underline">Ver adjunto actual</a>`;
                attachButtonText.textContent = 'Reemplazar Archivo';
            }
        }
    } else {
        // --- Modo Añadir ---
        titleEl.textContent = 'Añadir Respuesta Rápida';
    }

    // Listener para NUEVO archivo
    fileInput.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            fileUrlInput.value = ''; // Limpiar URL previa
            fileTypeInput.value = file.type;
            mediaPreview.innerHTML = `<span class="text-sm text-gray-600">Seleccionado: <strong>${file.name}</strong></span>`;
            attachButtonText.textContent = 'Cambiar Archivo';
        }
    };

    modal.classList.remove('hidden'); // Muestra modal
}

// Cierra el modal de Respuestas Rápidas
function closeQuickReplyModal() {
    const modal = document.getElementById('quick-reply-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Abre el modal para añadir/editar Base de Conocimiento
function openKnowledgeBaseModal(entryId = null) {
    const modal = document.getElementById('knowledge-base-modal');
    if (!modal) return;

    // Referencias a elementos del form
    const form = document.getElementById('kb-form');
    const titleEl = document.getElementById('kb-modal-title');
    const docIdInput = document.getElementById('kb-doc-id');
    const topicInput = document.getElementById('kb-topic');
    const answerTextarea = document.getElementById('kb-answer');
    const fileUrlInput = document.getElementById('kb-file-url');
    const fileTypeInput = document.getElementById('kb-file-type');
    const mediaPreview = document.getElementById('kb-media-preview');
    const fileInput = document.getElementById('kb-file-input');

    // Resetear form
    form.reset();
    docIdInput.value = '';
    fileUrlInput.value = '';
    fileTypeInput.value = '';
    mediaPreview.innerHTML = '';

    if (entryId) {
        // --- Modo Edición ---
        const entry = state.knowledgeBase.find(e => e.id === entryId); // Busca en estado
        if (entry) {
            titleEl.textContent = 'Editar Entrada de Conocimiento';
            docIdInput.value = entry.id;
            topicInput.value = entry.topic || '';
            answerTextarea.value = entry.answer || '';
            fileUrlInput.value = entry.fileUrl || '';
            fileTypeInput.value = entry.fileType || '';

            // Muestra enlace al adjunto actual
            if (entry.fileUrl) {
                mediaPreview.innerHTML = `<a href="${entry.fileUrl}" target="_blank" class="text-blue-600 hover:underline">Ver adjunto actual</a>`;
            }
        }
    } else {
        // --- Modo Añadir ---
        titleEl.textContent = 'Añadir Respuesta a la Base de Conocimiento';
    }

    // Listener para NUEVO archivo
    fileInput.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            fileUrlInput.value = ''; // Limpiar URL previa
            fileTypeInput.value = file.type;
            mediaPreview.innerHTML = `<span class="text-sm text-gray-600">Seleccionado: <strong>${file.name}</strong></span>`;
        }
    };

    modal.classList.remove('hidden'); // Muestra modal
}

// Cierra el modal de Base de Conocimiento
function closeKnowledgeBaseModal() {
    const modal = document.getElementById('knowledge-base-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Abre el modal para añadir/editar Prompts de IA por Anuncio
function openAIAdPromptModal(promptId = null) {
    const modal = document.getElementById('ai-ad-prompt-modal');
    if (!modal) return;

    // Referencias a elementos del form
    const form = document.getElementById('ai-ad-prompt-form');
    const titleEl = document.getElementById('ai-ad-prompt-modal-title');
    const docIdInput = document.getElementById('aip-doc-id');
    const nameInput = document.getElementById('aip-name');
    const adIdInput = document.getElementById('aip-ad-id');
    const promptTextarea = document.getElementById('aip-prompt');

    // Resetear form
    form.reset();
    docIdInput.value = '';

    if (promptId) {
        // --- Modo Edición ---
        const prompt = state.aiAdPrompts.find(p => p.id === promptId); // Busca en estado
        if (prompt) {
            titleEl.textContent = 'Editar Prompt de IA';
            docIdInput.value = prompt.id;
            nameInput.value = prompt.adName || '';
            adIdInput.value = prompt.adId || '';
            promptTextarea.value = prompt.prompt || '';
        }
    } else {
        // --- Modo Añadir ---
        titleEl.textContent = 'Añadir Prompt de IA';
    }

    modal.classList.remove('hidden'); // Muestra modal
}

// Cierra el modal de Prompts de IA
function closeAIAdPromptModal() {
    const modal = document.getElementById('ai-ad-prompt-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Abre el modal para editar las instrucciones generales del Bot
function openBotSettingsModal() {
    const modal = document.getElementById('bot-settings-modal');
    if (!modal) return;

    // Rellena el textarea con las instrucciones actuales del estado
    const instructionsTextarea = document.getElementById('bot-instructions');
    instructionsTextarea.value = state.botSettings.instructions || '';

    modal.classList.remove('hidden'); // Muestra modal
}

// Cierra el modal de ajustes del Bot
function closeBotSettingsModal() {
    const modal = document.getElementById('bot-settings-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Abre el modal para editar un contacto (desde barra lateral o vista de contactos)
function openEditContactModal(contactId = null) {
    const modal = document.getElementById('edit-contact-modal');
    const form = document.getElementById('edit-contact-form');
    const title = document.getElementById('edit-contact-modal-title');
    const idInput = document.getElementById('edit-contact-id');
    const nameInput = document.getElementById('edit-contact-name');
    const nicknameInput = document.getElementById('edit-contact-nickname');
    const emailInput = document.getElementById('edit-contact-email');

    form.reset();
    idInput.value = '';

    // Determina si se está editando desde la barra lateral o creando uno nuevo
    const idToEdit = contactId || state.selectedContactId;
    const contact = state.contacts.find(c => c.id === idToEdit);

    if (contact) { // Modo edición
        title.textContent = "Editar Contacto";
        idInput.value = contact.id;
        nameInput.value = contact.name || '';
        nicknameInput.value = contact.nickname || '';
        emailInput.value = contact.email || '';
    } else { // Modo añadir (actualmente no implementado botón directo, pero se deja la lógica)
        title.textContent = "Añadir Contacto";
        // Aquí podrías pedir el número de teléfono si fuera necesario añadir
    }

    modal.classList.remove('hidden');
    nameInput.focus();
}

// Cierra el modal de edición de contacto
function closeEditContactModal() {
    const modal = document.getElementById('edit-contact-modal');
    modal.classList.add('hidden');
}

// Abre el modal para añadir/editar etiquetas
function openTagModal(tag = null) {
    const modal = document.getElementById('tag-modal');
    const form = document.getElementById('tag-form');
    const title = document.getElementById('tag-modal-title');
    const idInput = document.getElementById('tag-id');
    const labelInput = document.getElementById('tag-label');
    const colorInput = document.getElementById('tag-color-input');
    const colorPreview = document.getElementById('tag-color-preview');
    const colorHex = document.getElementById('tag-color-hex');

    form.reset();
    idInput.value = '';
    const defaultColor = '#3182ce'; // Color azul por defecto

    if (tag) { // Modo edición
        title.textContent = "Editar Etiqueta";
        idInput.value = tag.id;
        labelInput.value = tag.label;
        colorInput.value = tag.color;
        colorPreview.style.backgroundColor = tag.color;
        colorHex.textContent = tag.color;
    } else { // Modo añadir
        title.textContent = "Nueva Etiqueta";
        colorInput.value = defaultColor;
        colorPreview.style.backgroundColor = defaultColor;
        colorHex.textContent = defaultColor;
    }

    // Listener para actualizar la vista previa del color en tiempo real
    colorInput.oninput = () => {
        colorPreview.style.backgroundColor = colorInput.value;
        colorHex.textContent = colorInput.value;
    };

    modal.classList.remove('hidden');
    labelInput.focus();
}

// Cierra el modal de etiquetas
function closeTagModal() {
    const modal = document.getElementById('tag-modal');
    modal.classList.add('hidden');
}


/**
 * Maneja el cambio de estatus de un pedido desde la barra lateral de detalles.
 * @param {string} orderId - El ID del documento del pedido en Firestore.
 * @param {string} newStatus - El nuevo valor del estatus.
 */
async function handleOrderStatusChange(orderId, newStatus) {
    if (!orderId || !newStatus) {
        console.error("Falta el ID del pedido o el nuevo estatus.");
        showError("Error interno: no se pudo identificar el pedido o el estatus.", 'error');
        return;
    }

    const originalStatus = state.selectedContactOrders.find(o => o.id === orderId)?.estatus;

    try {
        const orderRef = db.collection('pedidos').doc(orderId);
        await orderRef.update({ estatus: newStatus });

        showError(`Estatus del pedido actualizado.`, 'success');

    } catch (error) {
        console.error("Error al actualizar el estatus del pedido: ", error);
        showError("Error al guardar el cambio. Revisa la consola.", 'error');

        // Si falla, la UI se revertirá automáticamente gracias al listener de Firestore,
        // que traerá el valor antiguo de la base de datos.
    }
}



/**
 * Actualiza el contador de destinatarios para las vistas de campañas.
 * @param {string} type - El tipo de campaña ('text' o 'image'). Por defecto es 'text'.
 */
function updateCampaignRecipientCount(type = 'text') {
    const isImageCampaign = type === 'image';
    const tagSelectId = isImageCampaign ? 'campaign-image-tag-select' : 'campaign-tag-select';
    const countElId = isImageCampaign ? 'campaign-image-recipient-count' : 'campaign-recipient-count';

    const tagSelect = document.getElementById(tagSelectId);
    const countEl = document.getElementById(countElId);

    if (!tagSelect || !countEl) return; // Si los elementos no existen en la vista actual

    const selectedTagKey = tagSelect.value;
    let recipientCount = 0;

    if (selectedTagKey === 'all') {
        recipientCount = state.contacts.length;
    } else {
        recipientCount = state.contacts.filter(c => c.status === selectedTagKey).length;
    }

    countEl.textContent = `${recipientCount} destinatarios`;
}

/**
 * Muestra u oculta el submenú de IA en la barra lateral.
 */
function toggleIAMenu() {
    const iaSubmenu = document.getElementById('ia-submenu');
    const iaChevron = document.getElementById('ia-menu-chevron');
    if (iaSubmenu && iaChevron) {
        iaSubmenu.classList.toggle('hidden');
        iaChevron.classList.toggle('rotate-180');
    }
}


// --- Make functions globally accessible ---

// Esto permite llamar a las funciones desde los atributos onclick en el HTML
window.navigateTo = navigateTo;
window.toggleTagSidebar = toggleTagSidebar;
window.toggleIAMenu = toggleIAMenu;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.openContactDetails = openContactDetails;
window.closeContactDetails = closeContactDetails;
window.openEditContactModal = openEditContactModal;
window.closeEditContactModal = closeEditContactModal;
window.openTagModal = openTagModal;
window.closeTagModal = closeTagModal;
window.openQuickReplyModal = openQuickReplyModal;
window.closeQuickReplyModal = closeQuickReplyModal;
window.openAdResponseModal = openAdResponseModal;
window.closeAdResponseModal = closeAdResponseModal;
window.openAIAdPromptModal = openAIAdPromptModal;
window.closeAIAdPromptModal = closeAIAdPromptModal;
window.openKnowledgeBaseModal = openKnowledgeBaseModal;
window.closeKnowledgeBaseModal = closeKnowledgeBaseModal;
window.openBotSettingsModal = openBotSettingsModal;
window.closeBotSettingsModal = closeBotSettingsModal;
window.openNewOrderModal = openNewOrderModal; // Hacer global
window.closeNewOrderModal = closeNewOrderModal; // Hacer global
window.closeConversationPreviewModal = closeConversationPreviewModal; // Hacer global
window.openOrderEditModal = openOrderEditModal; // Hacer global
window.closeOrderEditModal = closeOrderEditModal; // Hacer global

// --- Funciones del template que necesitan acceso global ---
window.copyFormattedText = copyFormattedText;
window.copyToClipboard = copyToClipboard;
window.handleStatusChange = handleStatusChange;
window.handleDeleteTag = handleDeleteTag;
window.handleDeleteAllTags = handleDeleteAllTags;
window.handleSaveTag = handleSaveTag;
window.handleDeleteQuickReply = handleDeleteQuickReply;
window.handleDeleteAdResponse = handleDeleteAdResponse;
window.handleDeleteAIAdPrompt = handleDeleteAIAdPrompt;
window.handleDeleteKnowledgeBaseEntry = handleDeleteKnowledgeBaseEntry;
window.handleAwayMessageToggle = handleAwayMessageToggle;
window.handleGlobalBotToggle = handleGlobalBotToggle;
window.handleSaveGoogleSheetId = handleSaveGoogleSheetId;
window.handleSimulateAdMessage = handleSimulateAdMessage;
window.handleBotToggle = handleBotToggle;
window.setActiveTab = setActiveTab;
window.toggleEditNote = toggleEditNote;
window.handleUpdateNote = handleUpdateNote;
window.handleDeleteNote = handleDeleteNote;
window.handleSelectContactFromPipeline = handleSelectContactFromPipeline; // Hacer global
window.updateCampaignRecipientCount = updateCampaignRecipientCount; // Hacer global
window.handleSendCampaign = handleSendCampaign; // Hacer global
window.handleSendCampaignWithImage = handleSendCampaignWithImage; // Hacer global
window.initializeDifusionHandlers = initializeDifusionHandlers; // Hacer global
window.removeMessageFromSequence = removeMessageFromSequence; // Hacer global difusion
window.handleOrderStatusChange = handleOrderStatusChange; // Hacer global
// --- INICIO MODIFICACIÓN ---
window.loadAdIdMetrics = loadAdIdMetrics; // Hacer global
window.clearAdIdMetricsFilter = clearAdIdMetricsFilter; // Hacer global
// --- FIN MODIFICACIÓN ---
