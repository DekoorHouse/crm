// --- START: UI Management & View Rendering ---
// Este archivo se encarga de la navegación, renderizado de vistas,
// y la manipulación de componentes de UI como modales, pickers, etc.

let ticking = false; // For scroll event throttling
let tagsSortable = null;
let adMetricsPicker = null; // Variable para la instancia del datepicker de métricas de Ad ID
let aiCountdownInterval = null; // Intervalo para la cuenta regresiva de la IA (declarado arriba para evitar TDZ)

// --- Navigation & Main View Rendering ---
function navigateTo(viewName, force = false) {
    if (state.activeView === viewName && !force) {
        return;
    }

    // Cerramos el sidebar en móvil al navegar
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('main-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
    }

    state.activeView = viewName;



    // Actualiza la barra lateral
    document.querySelectorAll('#main-sidebar .nav-item').forEach(item => {
        const isDirectMatch = item.dataset.view === viewName;
        item.classList.toggle('active', isDirectMatch);
    });



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
        // --- NUEVAS VISTAS ---
        case 'departments':
            mainViewContainer.innerHTML = DepartmentsViewTemplate();
            renderDepartmentsView(); // Dibuja la tabla de departamentos
            break;
        case 'ad-routing':
            mainViewContainer.innerHTML = AdRoutingViewTemplate();
            renderAdRoutingView(); // Dibuja la tabla de reglas
            break;
        // ---------------------
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

        case 'respuestas-rapidas':
            mainViewContainer.innerHTML = QuickRepliesViewTemplate();
            renderQuickRepliesView(); // Dibuja la tabla de respuestas rápidas
            break;

        case 'metricas':
            mainViewContainer.innerHTML = MetricsViewTemplate();
            renderMetricsView(); // Dibuja la vista de métricas (incluyendo la nueva sección)
            break;
        case 'entrenamiento-ia':
            mainViewContainer.innerHTML = AITrainingViewTemplate();
            renderAITrainingView();
            break;
        case 'simulador-ia':
            mainViewContainer.innerHTML = AIChatSimulatorViewTemplate();
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
    const overlay = document.getElementById('sidebar-overlay');
    
    if (sidebar) {
        // En móviles y tablets (menor a 768px), usamos el modo drawer lateral
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('mobile-open');
            if (overlay) overlay.classList.toggle('active');
            
            // Si abrimos la barra lateral en móvil, aseguramos que pierda el modo colapsado de escritorio
            sidebar.classList.remove('collapsed');
        } else {
            // En escritorio mantemos la lógica actual de expandir/colapsar
            sidebar.classList.toggle('collapsed');
            state.isTagSidebarOpen = !sidebar.classList.contains('collapsed');
        }
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

    // Verificar si algún filtro del dropdown está activo
    const dropdownFilters = ['unread', ...state.tags.map(t => t.key)];
    const activeDropdownFilter = dropdownFilters.includes(state.activeFilter) || state.unreadOnly;
    const activeDropdownLabel = state.unreadOnly
        ? 'No leídos'
        : state.tags.find(t => t.key === state.activeFilter)?.label || null;

    // Botón "Todos"
    let buttonsHtml = `<button id="filter-all" class="filter-btn ${state.activeFilter === 'all' && !state.unreadOnly ? 'active' : ''}" onclick="setFilter('all')">Todos</button>`;

    // Botón "Pendientes IA"
    buttonsHtml += `<button id="filter-pendientes_ia" class="filter-btn ${state.activeFilter === 'pendientes_ia' ? 'active text-purple-600 border-purple-600 bg-purple-50' : ''}" onclick="setFilter('pendientes_ia')"><i class="fas fa-robot text-xs mr-1"></i> Pendientes IA</button>`;

    // Menú desplegable de tres puntos con los demás filtros
    let dropdownItems = '';
    dropdownItems += `<button id="filter-unread" class="tag-dropdown-item ${state.unreadOnly ? 'active' : ''}" onclick="toggleUnreadFilter(); closeTagDropdown();"><i class="fas fa-envelope text-xs mr-2"></i>No leídos</button>`;
    state.tags.forEach(tag => {
        dropdownItems += `<button id="filter-${tag.key}" class="tag-dropdown-item ${state.activeFilter === tag.key ? 'active' : ''}" onclick="setFilter('${tag.key}'); closeTagDropdown();">${tag.label}</button>`;
    });

    buttonsHtml += `<div class="tag-dropdown-wrapper">
        <button class="filter-btn tag-dropdown-toggle ${activeDropdownFilter ? 'active' : ''}" onclick="toggleTagDropdown(event)">
            ${activeDropdownLabel ? activeDropdownLabel : '<i class="fas fa-ellipsis-h"></i>'}
        </button>
        <div id="tag-dropdown-menu" class="tag-dropdown-menu hidden">
            ${dropdownItems}
        </div>
    </div>`;

    container.innerHTML = buttonsHtml;
    // Actualizar el contador después de renderizar los filtros
    actualizarContadorPendientesIA();
}

function toggleTagDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById('tag-dropdown-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');

    // Cerrar al hacer clic fuera
    if (!menu.classList.contains('hidden')) {
        setTimeout(() => {
            document.addEventListener('click', closeTagDropdownOnOutside, { once: true });
        }, 0);
    }
}

function closeTagDropdown() {
    const menu = document.getElementById('tag-dropdown-menu');
    if (menu) menu.classList.add('hidden');
}

function closeTagDropdownOnOutside(e) {
    const wrapper = document.querySelector('.tag-dropdown-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        closeTagDropdown();
    }
}

function toggleStatusDropdown(event) {
    event.stopPropagation();
    const wrapper = event.target.closest('.status-dropdown-wrapper');
    const menu = wrapper?.querySelector('.status-dropdown-menu');
    if (!menu) return;
    // Cerrar otros dropdowns de status abiertos
    document.querySelectorAll('.status-dropdown-menu').forEach(m => {
        if (m !== menu) m.classList.add('hidden');
    });
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
        setTimeout(() => {
            document.addEventListener('click', function closeOnOutside(e) {
                if (!wrapper.contains(e.target)) {
                    menu.classList.add('hidden');
                    document.removeEventListener('click', closeOnOutside);
                }
            });
        }, 0);
    }
}

function closeStatusDropdown() {
    document.querySelectorAll('.status-dropdown-menu').forEach(m => m.classList.add('hidden'));
}

/**
 * Actualiza el contador visual de chats pendientes de IA.
 * Puede recibir un conteo pre-calculado (desde un listener en tiempo real) o consultarlo al servidor.
 * @param {number|null} precomputedCount El conteo actual, si ya se conoce.
 */
async function actualizarContadorPendientesIA(precomputedCount = null) {
    const filterBtn = document.getElementById('filter-pendientes_ia');
    if (!filterBtn) return;

    // 1. Obtener el total (usar el valor del listener si existe, sino consultar API)
    let totalPendientes;
    if (precomputedCount !== null) {
        totalPendientes = precomputedCount;
    } else {
        totalPendientes = await fetchPendingAiCount();
    }

    // 2. Buscar o crear el badge del contador
    let badge = document.getElementById('pending-ai-counter');
    
    if (!badge) {
        // Si no existe, lo insertamos al final del botón
        badge = document.createElement('span');
        badge.id = 'pending-ai-counter';
        badge.className = 'ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500 text-white shadow-sm transition-all duration-300';
        filterBtn.appendChild(badge);
    }

    // 3. Actualizar el valor y la visibilidad
    if (totalPendientes > 0) {
        badge.textContent = totalPendientes;
        badge.classList.remove('hidden');
        badge.style.display = 'inline-block';
    } else {
        badge.classList.add('hidden');
        badge.style.display = 'none';
    }
}

// Renderiza la ventana principal de chat (cabecera, mensajes/notas, footer)
function renderChatWindow(options = {}) { 
    if (state.activeView !== 'chats') return;

    const chatPanelEl = document.getElementById('chat-panel');
    if (!chatPanelEl) return;

    // Capturamos el scroll ANTES de borrar el contenido
    const messagesContainer = document.getElementById('messages-container');
    const savedScrollTop = messagesContainer ? messagesContainer.scrollTop : null;

    // Busca el contacto seleccionado actualmente en el estado global
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    
    // Renderiza la plantilla de la ventana de chat
    chatPanelEl.innerHTML = ChatWindowTemplate(contact);

    // Añade listener al input de búsqueda de contactos
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
            // Configurar opciones de renderizado
            const renderMsgOptions = {};
            
            // Si se pide preservar el scroll, desactivamos explicitamente scrollToBottom
            // y restauramos la posición si la tenemos
            if (options.preserveScroll) {
                renderMsgOptions.scrollToBottom = false;
                if (savedScrollTop !== null) {
                    renderMsgOptions.scrollTop = savedScrollTop;
                }
            }
            
            renderMessages(renderMsgOptions);

            // Añade listener de scroll para la cabecera de fecha flotante
            const messagesContainerNew = document.getElementById('messages-container');
            if (messagesContainerNew) { 
                messagesContainerNew.addEventListener('scroll', () => { 
                    if (!ticking) { 
                        window.requestAnimationFrame(() => { handleScroll(); ticking = false; }); 
                        ticking = true; 
                    } 
                }); 
            }

            // Añade listeners al formulario de envío de mensajes
            const messageForm = document.getElementById('message-form');
            const messageInput = document.getElementById('message-input');
            if (messageForm) messageForm.addEventListener('submit', handleSendMessage);
            if (messageInput) {
                messageInput.addEventListener('paste', handlePaste); 
                messageInput.addEventListener('input', handleQuickReplyInput);
                messageInput.addEventListener('keydown', handleMessageInputKeyDown);

                // Ajustar altura del textarea dinámicamente
                messageInput.addEventListener('input', () => {
                    messageInput.style.height = 'auto';
                    let newHeight = messageInput.scrollHeight;
                    if (newHeight > 120) {
                        newHeight = 120;
                    }
                    messageInput.style.height = newHeight + 'px';
                });

                messageInput.focus();
            }

        } else if (state.activeTab === 'notes') {
            renderNotes(); 
            document.getElementById('note-form').addEventListener('submit', handleSaveNote);
        }
    }
}

// --- NUEVO: Renderiza la tabla de departamentos ---
function renderDepartmentsView() {
    if (state.activeView !== 'departments') return;
    const tableBody = document.getElementById('departments-table-body');
    if (!tableBody) return;

    if (state.departments.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-gray-500 py-4">No hay departamentos creados.</td></tr>`;
        return;
    }

    tableBody.innerHTML = state.departments.map(dept => `
        <tr>
            <td class="font-semibold">${dept.name}</td>
            <td>
                <div class="tag-color-cell">
                    <span class="tag-color-swatch" style="background-color: ${dept.color || '#6c757d'};"></span>
                    <span>${dept.color || '#6c757d'}</span>
                </div>
            </td>
            <td class="actions-cell">
                <button onclick="openDepartmentModal(state.departments.find(d => d.id === '${dept.id}'))" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteDepartment('${dept.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

// --- NUEVO: Renderiza la tabla de reglas de enrutamiento ---
function renderAdRoutingView() {
    if (state.activeView !== 'ad-routing') return;
    const tableBody = document.getElementById('ad-routing-table-body');
    if (!tableBody) return;

    if (state.adRoutingRules.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-4">No hay reglas de enrutamiento.</td></tr>`;
        return;
    }

    tableBody.innerHTML = state.adRoutingRules.map(rule => {
        const dept = state.departments.find(d => d.id === rule.targetDepartmentId);
        const deptName = dept ? dept.name : 'Departamento desconocido';
        const adIdsText = Array.isArray(rule.adIds) ? rule.adIds.join(', ') : rule.adId || '';

        return `
            <tr>
                <td class="font-semibold">${rule.ruleName}</td>
                <td class="font-mono text-sm max-w-xs truncate" title="${adIdsText}">${adIdsText}</td>
                <td><span class="px-2 py-1 rounded text-xs font-bold text-white" style="background-color: ${dept?.color || '#6c757d'}">${deptName}</span></td>
                <td class="text-center font-bold">
                    ${rule.enableAi 
                        ? '<span class="text-green-500" title="IA Activada"><i class="fas fa-robot animate-pulse mr-1"></i>Sí</span>' 
                        : '<span class="text-gray-400">No</span>'}
                </td>
                <td class="actions-cell">
                    <button onclick="openAdRoutingModal(state.adRoutingRules.find(r => r.id === '${rule.id}'))" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                    <button onclick="handleDeleteAdRoutingRule('${rule.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>
        `;
    }).join('');
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

// --- INICIO: Renderizado de Entrenamiento de IA ---
async function renderAITrainingView() {
    if (state.activeView !== 'entrenamiento-ia') return;

    // 1. Cargar instrucciones del bot desde Firestore
    try {
        const botDoc = await db.collection('crm_settings').doc('bot').get();
        if (botDoc.exists) {
            state.aiBotInstructions = botDoc.data().instructions || '';
            const textarea = document.getElementById('ai-bot-instructions');
            if (textarea) textarea.value = state.aiBotInstructions;
        }
    } catch (error) {
        console.error('Error al cargar instrucciones del bot:', error);
    }

    // 2. Listener de botón guardar instrucciones
    const saveBtn = document.getElementById('save-bot-instructions-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', handleSaveBotInstructions);
    }

    // 3. Listener de formulario de conocimiento
    const knowledgeForm = document.getElementById('knowledge-form');
    if (knowledgeForm) {
        knowledgeForm.removeEventListener('submit', handleSaveKnowledge);
        knowledgeForm.addEventListener('submit', handleSaveKnowledge);
    }

    // 4. Cargar base de conocimiento desde Firestore
    loadKnowledgeBase();

    // 5. Cargar estadísticas de uso de tokens
    loadAIUsageStats();
}

async function handleSaveBotInstructions() {
    const textarea = document.getElementById('ai-bot-instructions');
    const btn = document.getElementById('save-bot-instructions-btn');
    if (!textarea || !btn) return;

    const instructions = textarea.value.trim();
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Guardando...';

    try {
        await db.collection('crm_settings').doc('bot').set({ instructions }, { merge: true });
        state.aiBotInstructions = instructions;
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>¡Guardado!';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-save mr-2"></i>Guardar Instrucciones';
            btn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('Error al guardar instrucciones:', error);
        showError('No se pudieron guardar las instrucciones.');
        btn.innerHTML = '<i class="fas fa-save mr-2"></i>Guardar Instrucciones';
        btn.disabled = false;
    }
}

async function loadKnowledgeBase() {
    try {
        const snapshot = await db.collection('ai_knowledge_base').get();
        state.aiKnowledgeBase = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderKnowledgeBaseTable();
    } catch (error) {
        console.error('Error al cargar base de conocimiento:', error);
    }
}

function renderKnowledgeBaseTable() {
    const tableBody = document.getElementById('knowledge-base-table-body');
    if (!tableBody) return;

    if (state.aiKnowledgeBase.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-gray-500 py-4">No hay conocimiento agregado aún. ¡Agrega el primero!</td></tr>`;
        return;
    }

    tableBody.innerHTML = state.aiKnowledgeBase.map(item => `
        <tr>
            <td class="font-semibold">${item.topic || ''}</td>
            <td class="text-gray-600 max-w-sm truncate" title="${(item.answer || '').replace(/"/g, '&quot;')}">${item.answer || ''}</td>
            <td class="actions-cell">
                <button onclick="openKnowledgeModal('${item.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteKnowledge('${item.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

function openKnowledgeModal(docId) {
    const modal = document.getElementById('knowledge-modal');
    const title = document.getElementById('knowledge-modal-title');
    const idInput = document.getElementById('kb-doc-id');
    const topicInput = document.getElementById('kb-topic');
    const answerInput = document.getElementById('kb-answer');

    if (!modal) return;

    if (docId) {
        // Editar
        const item = state.aiKnowledgeBase.find(k => k.id === docId);
        if (!item) return;
        title.textContent = 'Editar Conocimiento';
        idInput.value = docId;
        topicInput.value = item.topic || '';
        answerInput.value = item.answer || '';
    } else {
        // Nuevo
        title.textContent = 'Agregar Conocimiento';
        idInput.value = '';
        topicInput.value = '';
        answerInput.value = '';
    }

    modal.classList.remove('hidden');
}

function closeKnowledgeModal() {
    const modal = document.getElementById('knowledge-modal');
    if (modal) modal.classList.add('hidden');
}

async function handleSaveKnowledge(event) {
    event.preventDefault();
    const docId = document.getElementById('kb-doc-id').value;
    const topic = document.getElementById('kb-topic').value.trim();
    const answer = document.getElementById('kb-answer').value.trim();

    if (!topic || !answer) return;

    try {
        if (docId) {
            await db.collection('ai_knowledge_base').doc(docId).update({ topic, answer });
        } else {
            await db.collection('ai_knowledge_base').add({ topic, answer });
        }
        closeKnowledgeModal();
        loadKnowledgeBase(); // Recargar tabla
    } catch (error) {
        console.error('Error al guardar conocimiento:', error);
        showError('No se pudo guardar el conocimiento.');
    }
}

async function handleDeleteKnowledge(docId) {
    if (!confirm('¿Estás seguro de que quieres eliminar este conocimiento?')) return;
    try {
        await db.collection('ai_knowledge_base').doc(docId).delete();
        loadKnowledgeBase(); // Recargar tabla
    } catch (error) {
        console.error('Error al eliminar conocimiento:', error);
        showError('No se pudo eliminar el conocimiento.');
    }
}

async function loadAIUsageStats() {
    // Precios por millón de tokens (USD)
    const INPUT_PRICE_PER_M = 0.10;
    const OUTPUT_PRICE_PER_M = 0.40;

    function calculateCost(inputTokens, outputTokens) {
        return ((inputTokens / 1_000_000) * INPUT_PRICE_PER_M) + ((outputTokens / 1_000_000) * OUTPUT_PRICE_PER_M);
    }

    function formatNumber(num) {
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
        return num.toString();
    }

    try {
        // --- Datos de HOY ---
        const today = new Date().toISOString().split('T')[0];
        const todayDoc = await db.collection('ai_usage_logs').doc(today).get();
        const todayData = todayDoc.exists ? todayDoc.data() : { inputTokens: 0, outputTokens: 0, requestCount: 0 };

        const todayCost = calculateCost(todayData.inputTokens || 0, todayData.outputTokens || 0);

        const todayReqEl = document.getElementById('usage-today-requests');
        const todayInEl = document.getElementById('usage-today-input');
        const todayOutEl = document.getElementById('usage-today-output');
        const todayCostEl = document.getElementById('usage-today-cost');

        if (todayReqEl) todayReqEl.textContent = todayData.requestCount || 0;
        if (todayInEl) todayInEl.textContent = formatNumber(todayData.inputTokens || 0);
        if (todayOutEl) todayOutEl.textContent = formatNumber(todayData.outputTokens || 0);
        if (todayCostEl) todayCostEl.textContent = '$' + todayCost.toFixed(4);

        // --- Datos del MES ---
        const yearMonth = today.substring(0, 7); // YYYY-MM
        const monthStart = yearMonth + '-01';
        const monthEnd = yearMonth + '-31';

        const monthSnapshot = await db.collection('ai_usage_logs')
            .where('date', '>=', monthStart)
            .where('date', '<=', monthEnd)
            .get();

        let monthInput = 0, monthOutput = 0, monthRequests = 0;
        monthSnapshot.docs.forEach(doc => {
            const data = doc.data();
            monthInput += data.inputTokens || 0;
            monthOutput += data.outputTokens || 0;
            monthRequests += data.requestCount || 0;
        });

        const monthCost = calculateCost(monthInput, monthOutput);

        const monthReqEl = document.getElementById('usage-month-requests');
        const monthInEl = document.getElementById('usage-month-input');
        const monthOutEl = document.getElementById('usage-month-output');
        const monthCostEl = document.getElementById('usage-month-cost');

        if (monthReqEl) monthReqEl.textContent = monthRequests;
        if (monthInEl) monthInEl.textContent = formatNumber(monthInput);
        if (monthOutEl) monthOutEl.textContent = formatNumber(monthOutput);
        if (monthCostEl) monthCostEl.textContent = '$' + monthCost.toFixed(4);

    } catch (error) {
        console.error('Error al cargar estadísticas de uso de IA:', error);
    }
}

// Exportar funciones globalmente
window.openKnowledgeModal = openKnowledgeModal;
window.closeKnowledgeModal = closeKnowledgeModal;
window.handleDeleteKnowledge = handleDeleteKnowledge;
// --- FIN: Renderizado de Entrenamiento de IA ---

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
function renderMessages(options = {}) {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    let lastMessageDate = null; 
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

    // --- INICIO MODIFICACIÓN: Lógica de scroll condicional y paginación ---
    const messagesContainer = document.getElementById('messages-container');
    
    // Calculamos si el usuario está en el fondo ANTES de actualizar el contenido
    const isAtBottom = messagesContainer ? (messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 150) : true;
    const isInitialLoad = messagesContainer && messagesContainer.scrollHeight === 0;

    // Guardamos la altura del scroll ANTES de insertar los mensajes viejos
    const previousScrollHeight = messagesContainer ? messagesContainer.scrollHeight : 0;
    const previousScrollTop = messagesContainer ? messagesContainer.scrollTop : 0;

    contentContainer.innerHTML = messagesHtml; // Actualiza el DOM
    
    if (messagesContainer) {
        if (options.preserveScrollHeight) {
            // Calculamos cuánto creció el contenedor hacia arriba 
            const heightDifference = messagesContainer.scrollHeight - previousScrollHeight;
            // Ajustamos el scroll por esa diferencia para que el usuario se quede "donde estaba" visualmente
            messagesContainer.scrollTop = previousScrollTop + heightDifference;
        } else if (options.scrollTop !== undefined) {
            // Restaurar posición específica si se proporciona
            messagesContainer.scrollTop = options.scrollTop;
        } else if (options.scrollToBottom !== false) {
            // Comportamiento de scroll condicional:
            // Scroll al final solo si ya estaba en el fondo o si es la carga inicial
            if (isAtBottom || isInitialLoad) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }
    }
    // --- FIN MODIFICACIÓN ---

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

    // Scroll condicional hasta el final
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) {
        const isAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 150;
        if (isAtBottom) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
}



/**
 * Renderiza las notas en la barra lateral de detalles del contacto
 * y aplica la animación de glow si hay notas.
 */
function renderSidebarNotes() {
    const sidebarNotesList = document.getElementById('sidebar-notes-list');
    const mainContainer = document.getElementById('sidebar-notes-container');

    if (!sidebarNotesList || !mainContainer) return;

    if (state.notes && state.notes.length > 0) {
        sidebarNotesList.innerHTML = state.notes.map(note => {
            const isEditing = state.isEditingNote === note.id;
            const time = note.timestamp 
                ? new Date(note.timestamp.seconds * 1000).toLocaleDateString('es-ES', {day:'2-digit', month:'short'}) 
                : 'Reciente';

            if (isEditing) {
                return `
                    <div class="note-item editing !p-2 !mb-2 !text-xs bg-gray-50 rounded border-l-2 border-primary">
                        <textarea id="edit-note-input-${note.id}" class="w-full p-2 text-xs border rounded mb-2 focus:ring-1 focus:ring-blue-400 outline-none" rows="3">${note.text}</textarea>
                        <div class="flex justify-end gap-2">
                             <button onclick="toggleEditNote(null)" class="text-[10px] text-gray-400 hover:text-gray-600">Cancelar</button>
                             <button onclick="handleUpdateNote('${note.id}')" class="btn btn-primary !py-1 !px-2 !text-[10px] rounded">Guardar</button>
                        </div>
                    </div>`;
            }

            return `
                <div class="note-item sidebar-note group relative !p-2 !mb-2 !text-xs !bg-transparent border-l-2 border-accent !shadow-none hover:bg-gray-50 rounded transition-colors" data-id="${note.id}">
                    <div class="flex justify-between items-start">
                        <p class="flex-grow pr-4">${note.text}</p>
                        <div class="note-actions-visible items-center gap-1 flex-shrink-0">
                            <button onclick="toggleEditNote('${note.id}')" class="text-gray-400 hover:text-blue-500 p-0.5" title="Editar"><i class="fas fa-pencil-alt text-[10px]"></i></button>
                            <button onclick="handleDeleteNote('${note.id}')" class="text-gray-400 hover:text-red-500 p-0.5" title="Eliminar"><i class="fas fa-trash-alt text-[10px]"></i></button>
                        </div>
                    </div>
                    <div class="text-[10px] text-gray-400 mt-1">
                        ${time}
                    </div>
                </div>
            `;
        }).join('');
        
        // Aplicar animación de glow
        mainContainer.classList.add('notes-glow');
    } else {
        sidebarNotesList.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-2">Sin notas internas.</p>`;
        mainContainer.classList.remove('notes-glow');
    }
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

    // Renderizar notas iniciales si existen
    renderSidebarNotes();

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

    if (state.stagedFiles.length > 0) { // Si hay archivos locales seleccionados
        container.innerHTML = LocalFilePreviewTemplate(state.stagedFiles);
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
let editOrderPhotosManager = []; // Array para fotos del pedido en edición
let editPromoPhotosManager = []; // Array para fotos de la promoción en edición
/**
 * Abre el modal para registrar un nuevo pedido, pre-rellenando datos si es posible.
 * Unificado con la lgica de Lista de Pedidos (pedidos.html / logica.js).
 */
function abrirModalPedido(contactData = null) {
    // Si viene de un evento, ignoramos el primer argumento
    if (contactData instanceof Event) contactData = null;
    const contact = contactData || state.contacts.find(c => c.id === state.selectedContactId);
    if (!contact) {
        showError("Por favor, selecciona un contacto para registrar un pedido.");
        return;
    }

    const modalContainer = document.getElementById('new-order-modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = NewOrderModalTemplate();
    
    const phoneInput = document.getElementById('pedidoTelefono');
    if (phoneInput && contact) {
        phoneInput.value = contact.phone || contact.id || '';
    }

    orderPhotosManager = [];
    promoPhotosManager = [];

    // Configura listeners para el modal recin creado
    document.getElementById('formularioNuevoPedido').addEventListener('submit', handleSaveOrder);

    // Lgica para mostrar/ocultar input "Otro producto"
    const productSelect = document.getElementById('pedidoProductoSelect');
    const productOtherInput = document.getElementById('pedidoProductoOtro');
    if(productSelect && productOtherInput) {
        productSelect.addEventListener('change', () => {
            const isOther = productSelect.value === 'Otro';
            productOtherInput.style.display = isOther ? 'block' : 'none';
            productOtherInput.required = isOther;
            if(isOther) productOtherInput.focus();
        });
    }

    // Configura drag & drop y vista previa para fotos del pedido
    const orderPhotoContainer = document.getElementById('fileInputContainerProducto');
    const orderPhotoInput = document.getElementById('pedidoFotoFile');
    const orderPreviewContainer = document.getElementById('fotosPreviewContainer');
    setupPhotoManager(orderPhotoContainer, orderPhotoInput, orderPreviewContainer, orderPhotosManager, 'order');

    // Configura drag & drop y vista previa para fotos de promocin
    const promoPhotoContainer = document.getElementById('fileInputContainerPromocion');
    const promoPhotoInput = document.getElementById('pedidoFotoPromocionFile');
    const promoPreviewContainer = document.getElementById('promoFotosPreviewContainer');
    setupPhotoManager(promoPhotoContainer, promoPhotoInput, promoPreviewContainer, promoPhotosManager, 'promo');

    // Lgica del checkbox "Usar misma foto"
    const samePhotoCheckbox = document.getElementById('mismaFotoCheckbox');
    const samePhotoContainer = document.getElementById('mismaFotoContainer'); // Contenedor del checkbox
    const promoFileInputContainer = document.getElementById('fileInputContainerPromocion'); // Contenedor de subida de promo

    if(samePhotoCheckbox && samePhotoContainer && promoFileInputContainer) {
        samePhotoCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Copia las fotos del pedido a la promocin
                promoPhotosManager = [...orderPhotosManager];
                renderPhotoPreviews(promoPreviewContainer, promoPhotosManager, 'promo');
                promoFileInputContainer.classList.add('hidden');
            } else {
                promoPhotosManager = [];
                renderPhotoPreviews(promoPreviewContainer, promoPhotosManager, 'promo');
                promoFileInputContainer.classList.remove('hidden');
            }
        });
    }
}

/**
 * Cierra el modal de nuevo pedido.
 */
function cerrarModalPedido() {
    const modalContainer = document.getElementById('new-order-modal-container');
    if (modalContainer) modalContainer.innerHTML = '';
    orderPhotosManager = [];
    promoPhotosManager = [];
}

// Los alias globales se definen al final del archivo para mayor claridad

/**
 * Cierra el modal de confirmacin de pedido.
 */
function closeOrderConfirmationModal() {
    const modalContainer = document.getElementById('order-confirmation-modal-container');
    if (modalContainer) modalContainer.innerHTML = '';
}
window.closeOrderConfirmationModal = closeOrderConfirmationModal;

/**
 * Copia el nmero de pedido al portapapeles y da feedback visual.
 */
window.copyOrderNumber = (text, btn) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalContent = btn.innerHTML;
        btn.classList.add('bg-green-100', 'text-green-600');
        btn.innerHTML = `
            <span class="text-3xl font-black tracking-wider">${text}</span>
            <div class="w-10 h-10 bg-green-500 text-white rounded-xl shadow-sm flex items-center justify-center">
                <i class="fas fa-check"></i>
            </div>
        `;
        showError("Nmero de pedido copiado al portapapeles.", "success");
        setTimeout(() => {
            btn.classList.remove('bg-green-100', 'text-green-600');
            btn.innerHTML = originalContent;
        }, 2000);
    });
};

function renderPhotoPreviews(container, managerArray, type) {
    container.innerHTML = '';
    managerArray.forEach((photoObj, index) => {
        const previewUrl = photoObj.isNew ? URL.createObjectURL(photoObj.file) : photoObj.url;
        const div = document.createElement('div');
        div.className = 'preview-thumbnail relative';
        div.innerHTML = `
            <img src="${previewUrl}" class="w-full h-full object-cover">
            <button type="button" class="delete-photo-btn" onclick="removePhoto(${index}, '${type}')"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(div);
    });

    // Update checkbox visibility if managing promo
    const samePhotoContainer = document.getElementById('order-same-photo-container');
    if (samePhotoContainer && type === 'order') {
        samePhotoContainer.style.display = managerArray.length > 0 ? 'flex' : 'none';
    }
}

// Function to handle global deletion specifically
window.removePhoto = function(index, type) {
    if (type === 'order') {
        orderPhotosManager.splice(index, 1);
        renderPhotoPreviews(document.getElementById('order-photos-preview-container'), orderPhotosManager, 'order');
    } else if (type === 'promo') {
        promoPhotosManager.splice(index, 1);
        renderPhotoPreviews(document.getElementById('order-promo-photos-preview-container'), promoPhotosManager, 'promo');
    } else if (type === 'edit-order') {
        editOrderPhotosManager.splice(index, 1);
        renderPhotoPreviews(document.getElementById('edit-order-photos-preview-container'), editOrderPhotosManager, 'edit-order');
    } else if (type === 'edit-promo') {
        editPromoPhotosManager.splice(index, 1);
        renderPhotoPreviews(document.getElementById('edit-order-promo-photos-preview-container'), editPromoPhotosManager, 'edit-promo');
    }
};

function setupPhotoManager(dropContainer, fileInput, previewContainer, managerArray, type) {
    if (!dropContainer || !fileInput || !previewContainer) return;

    const handleFiles = (files) => {
        Array.from(files).forEach(file => {
            if (file.type.startsWith('image/')) {
                managerArray.push({ file: file, isNew: true });
            }
        });
        renderPhotoPreviews(previewContainer, managerArray, type);
    };

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = ''; // Reset
    });

    dropContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropContainer.classList.add('drag-over', 'bg-green-50');
    });

    dropContainer.addEventListener('dragleave', () => {
        dropContainer.classList.remove('drag-over', 'bg-green-50');
    });

    dropContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        dropContainer.classList.remove('drag-over', 'bg-green-50');
        if (e.dataTransfer.files) {
            handleFiles(e.dataTransfer.files);
        }
    });

    // Support paste events
    dropContainer.addEventListener('paste', (e) => {
        e.preventDefault();
        if (e.clipboardData.files) {
            handleFiles(e.clipboardData.files);
        }
    });
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



// --- NUEVAS FUNCIONES PARA MODALES DE DEPARTAMENTOS Y REGLAS ---

// --- Modal de Departamentos ---
function openDepartmentModal(dept = null) {
    const modal = document.getElementById('department-modal');
    const form = document.getElementById('department-form');
    const title = document.getElementById('department-modal-title');
    const idInput = document.getElementById('dept-id');
    const nameInput = document.getElementById('dept-name');
    const colorInput = document.getElementById('dept-color-input');
    const colorPreview = document.getElementById('dept-color-preview');
    const colorHex = document.getElementById('dept-color-hex');
    const usersContainer = document.getElementById('department-users-container');

    if (!modal || !usersContainer) return;

    form.reset();
    idInput.value = '';
    usersContainer.innerHTML = '<p class="text-gray-400">Cargando usuarios...</p>';
    const defaultColor = '#6c757d';

    // Rellenar lista de usuarios
    if (state.allUsers && state.allUsers.length > 0) {
        usersContainer.innerHTML = state.allUsers.map(user => `
            <div class="flex items-center">
                <input type="checkbox" id="user-${user.uid}" name="department-users" value="${user.email}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <label for="user-${user.uid}" class="ml-3 block text-sm font-medium text-gray-700">
                    ${user.name || user.email}
                </label>
            </div>
        `).join('');
    } else {
        usersContainer.innerHTML = '<p class="text-gray-400">No se encontraron usuarios o aún no se han cargado.</p>';
    }

    if (dept) { // Modo Edición
        title.textContent = "Editar Departamento";
        idInput.value = dept.id;
        nameInput.value = dept.name || '';
        colorInput.value = dept.color || defaultColor;
        colorPreview.style.backgroundColor = dept.color || defaultColor;
        colorHex.textContent = dept.color || defaultColor;

        // Marcar los checkboxes de los usuarios asignados
        // Se buscan los usuarios cuyo array 'assignedDepartments' incluye el ID de este departamento.
        if (state.allUsers.length > 0) {
             state.allUsers.forEach(user => {
                if (user.assignedDepartments && user.assignedDepartments.includes(dept.id)) {
                    const checkbox = usersContainer.querySelector(`input[value="${user.email}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                    }
                }
            });
        }

    } else { // Modo Añadir
        title.textContent = "Nuevo Departamento";
        colorInput.value = defaultColor;
        colorPreview.style.backgroundColor = defaultColor;
        colorHex.textContent = defaultColor;
    }

    // Listener para color preview
    colorInput.oninput = () => {
        colorPreview.style.backgroundColor = colorInput.value;
        colorHex.textContent = colorInput.value;
    };

    modal.classList.remove('hidden');
    nameInput.focus();
}

function closeDepartmentModal() {
    const modal = document.getElementById('department-modal');
    if (modal) modal.classList.add('hidden');
}

// --- Modal de Reglas de Enrutamiento ---
function openAdRoutingModal(rule = null) {
    const modal = document.getElementById('ad-routing-modal');
    const form = document.getElementById('ad-routing-form');
    const title = document.getElementById('ad-routing-modal-title');
    const idInput = document.getElementById('rule-id');
    const nameInput = document.getElementById('rule-name');
    const adIdsInput = document.getElementById('rule-ad-ids');
    const deptSelect = document.getElementById('rule-target-dept');

    if (!modal) return;

    // Poblar el select de departamentos
    deptSelect.innerHTML = '<option value="">-- Seleccionar Departamento --</option>' + 
        state.departments.map(dept => `<option value="${dept.id}">${dept.name}</option>`).join('');

    form.reset();
    idInput.value = '';

    if (rule) { // Modo Edición
        title.textContent = "Editar Regla";
        idInput.value = rule.id;
        nameInput.value = rule.ruleName || '';
        adIdsInput.value = Array.isArray(rule.adIds) ? rule.adIds.join(', ') : '';
        deptSelect.value = rule.targetDepartmentId || '';
        document.getElementById('rule-enable-ai').checked = rule.enableAi || false;
    } else { // Modo Añadir
        title.textContent = "Nueva Regla de Enrutamiento";
        document.getElementById('rule-enable-ai').checked = false;
    }

    modal.classList.remove('hidden');
    nameInput.focus();
}

function closeAdRoutingModal() {
    const modal = document.getElementById('ad-routing-modal');
    if (modal) modal.classList.add('hidden');
}

// --- Modal de Transferencia de Chat ---
function openTransferModal(contactId) {
    const modal = document.getElementById('transfer-modal');
    if (!modal) return;

    // Set the hidden input for the contact ID
    const contactIdInput = document.getElementById('transfer-contact-id');
    contactIdInput.value = contactId;

    const wrapper = document.getElementById('custom-dept-select-wrapper');
    const button = document.getElementById('transfer-dept-button');
    const buttonText = document.getElementById('transfer-dept-button-text');
    const optionsContainer = document.getElementById('transfer-dept-options');
    const hiddenInput = document.getElementById('transfer-dept-hidden-input');

    // Clear previous options and reset state
    optionsContainer.innerHTML = '';
    hiddenInput.value = '';
    buttonText.textContent = '-- Seleccionar Departamento --';
    button.classList.remove('open');
    optionsContainer.classList.add('hidden');


    // Populate options
    state.departments.forEach(dept => {
        const option = document.createElement('div');
        option.className = 'custom-select-option';
        option.dataset.value = dept.id;
        
        option.innerHTML = `
            <span class="color-circle" style="background-color: ${dept.color || '#d1d5db'}"></span>
            <span>${dept.name}</span>
        `;
        
        // Add click listener to each option
        option.addEventListener('click', () => {
            hiddenInput.value = dept.id;
            buttonText.textContent = dept.name;
            optionsContainer.classList.add('hidden');
            button.classList.remove('open');
        });
        
        optionsContainer.appendChild(option);
    });

    // Toggle options visibility
    const toggleDropdown = (e) => {
        e.stopPropagation();
        const isHidden = optionsContainer.classList.contains('hidden');
        if (isHidden) {
            optionsContainer.classList.remove('hidden');
            button.classList.add('open');
            // Attach listener to close dropdown when clicking outside
            // Use timeout to avoid it firing from the same click that opened it
            setTimeout(() => {
                document.addEventListener('click', closeDropdown, { once: true });
            }, 0);
        } else {
            optionsContainer.classList.add('hidden');
            button.classList.remove('open');
        }
    };
    
    // Assign the toggle function to the button click
    button.onclick = toggleDropdown;

    // Global click listener to close dropdown
    const closeDropdown = (e) => {
        if (!wrapper.contains(e.target)) {
            optionsContainer.classList.add('hidden');
            button.classList.remove('open');
        } else {
             // If the click was inside the wrapper (e.g. on the button again), re-add the listener
             // because the 'once' option will have removed it. The toggle function will handle closing.
             setTimeout(() => {
                document.addEventListener('click', closeDropdown, { once: true });
            }, 0);
        }
    };

    modal.classList.remove('hidden');
}

function closeTransferModal() {
    const modal = document.getElementById('transfer-modal');
    if (modal) modal.classList.add('hidden');
}

// --- FIN NUEVAS FUNCIONES ---

/**
 * Establece la pestaña activa (ej. 'chat' o 'notas') y vuelve a renderizar la vista.
 * @param {string} tabName - El nombre de la pestaña a activar.
 */
function setActiveTab(tabName) {
    if (state.activeTab === tabName) return; // No hacer nada si ya está activa

    state.activeTab = tabName;
    renderChatWindow(); // Volver a renderizar para mostrar el contenido correcto
}


/**
 * Alterna entre el modo de visualización y edición de una nota.
 * @param {string} noteId - El ID de la nota a editar.
 */
function toggleEditNote(noteId) {
    state.isEditingNote = noteId;
    renderSidebarNotes();
}

// --- NUEVO: Lógica de Tema Oscuro ---

/**
 * Alterna entre modo claro y oscuro, guardando la preferencia.
 */
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('crm_theme', isDark ? 'dark' : 'light');
    updateDarkModeIcon();
}

/**
 * Actualiza el icono del botón de tema oscuro según el estado actual.
 */
function updateDarkModeIcon() {
    const icon = document.getElementById('dark-mode-icon');
    if (icon) {
        const isDark = document.body.classList.contains('dark-mode');
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        // Opcional: Cambiar el título del botón padre si fuera necesario
    }
}

/**
 * Inicializa el tema al cargar la página.
 */
function initTheme() {
    const savedTheme = localStorage.getItem('crm_theme');
    // Si está guardado como 'dark', aplicar clase
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    } else {
        // Opcional: Respetar preferencia del sistema si no hay guardado
        // if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        //     document.body.classList.add('dark-mode');
        // }
    }
    updateDarkModeIcon();
}

// --- FIN NUEVO ---

// --- Make functions globally accessible ---

// Esto permite llamar a las funciones desde los atributos onclick en el HTML
window.navigateTo = navigateTo;
window.toggleTagSidebar = toggleTagSidebar;
window.toggleTagDropdown = toggleTagDropdown;
window.closeTagDropdown = closeTagDropdown;
window.toggleStatusDropdown = toggleStatusDropdown;
window.closeStatusDropdown = closeStatusDropdown;

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

window.openNewOrderModal = abrirModalPedido; 
window.closeNewOrderModal = cerrarModalPedido; 
window.cerrarModalPedido = cerrarModalPedido;
window.abrirModalPedido = abrirModalPedido;
window.closeConversationPreviewModal = closeConversationPreviewModal; 
window.openOrderEditModal = openOrderEditModal; 
window.closeOrderEditModal = closeOrderEditModal; 

// --- EXPORTAR NUEVAS FUNCIONES DE TEMA ---
window.toggleDarkMode = toggleDarkMode;
window.initTheme = initTheme;

// --- EXPORTAR NUEVAS FUNCIONES ---
window.openDepartmentModal = openDepartmentModal;
window.closeDepartmentModal = closeDepartmentModal;
window.openAdRoutingModal = openAdRoutingModal;
window.closeAdRoutingModal = closeAdRoutingModal;
window.openTransferModal = openTransferModal;
window.closeTransferModal = closeTransferModal;
// ---------------------------------

// --- Funciones del template que necesitan acceso global ---

window.copyFormattedText = copyFormattedText;
window.copyToClipboard = copyToClipboard;
window.setActiveTab = setActiveTab;
window.toggleEditNote = toggleEditNote;
window.updateCampaignRecipientCount = updateCampaignRecipientCount; // Definida en ui-manager
window.handleOrderStatusChange = handleOrderStatusChange; // Definida en ui-manager

// --- START SIMULADOR IA ---
let simulatorHistory = [];
let simulatorTokens = { input: 0, output: 0, cached: 0 };

function updateSimulatorTokenUI() {
    const inputEl = document.getElementById('simulator-input-tokens');
    const outputEl = document.getElementById('simulator-output-tokens');
    const cachedEl = document.getElementById('simulator-cached-tokens');
    const totalEl = document.getElementById('simulator-total-tokens');
    const costEl = document.getElementById('simulator-cost');
    const newInput = Math.max(0, simulatorTokens.input - simulatorTokens.cached);
    if (inputEl) inputEl.textContent = newInput.toLocaleString();
    if (outputEl) outputEl.textContent = simulatorTokens.output.toLocaleString();
    if (cachedEl) cachedEl.textContent = simulatorTokens.cached.toLocaleString();
    if (totalEl) totalEl.textContent = (simulatorTokens.input + simulatorTokens.output).toLocaleString();
    // Costos gemini-3-flash-preview (por 1M tokens)
    // Input: $0.50, Output: $3.00, Cached: $0.05 (90% descuento)
    const costInput = (newInput / 1_000_000) * 0.50;
    const costCached = (simulatorTokens.cached / 1_000_000) * 0.05;
    const costOutput = (simulatorTokens.output / 1_000_000) * 3.00;
    const totalCost = costInput + costCached + costOutput;
    if (costEl) costEl.textContent = '$' + totalCost.toFixed(6);
}

let simulatorAiTimer = null;
let simulatorCountdownInterval = null;
let simulatorCountdownValue = 20;

window.skipSimulatorTimer = function() {
    if (simulatorAiTimer) {
        clearTimeout(simulatorAiTimer);
        simulatorAiTimer = null;
    }
    if (simulatorCountdownInterval) {
        clearInterval(simulatorCountdownInterval);
        simulatorCountdownInterval = null;
    }
    const typingIndicator = document.getElementById('simulator-typing-indicator');
    if (typingIndicator) {
        const timerText = document.getElementById('simulator-timer-text');
        if (timerText) timerText.textContent = "Procesando...";
    }
    
    // Ejecutar inmediatamente
    processSimulatorAi();
};

async function processSimulatorAi() {
    const typingIndicator = document.getElementById('simulator-typing-indicator');
    
    // Clonar historial actual
    const historyCopy = [...simulatorHistory];
    
    // El último mensaje del usuario se pasa como "message" directo, no duplicarlo en "history"
    let lastUserIndex = -1;
    for (let i = historyCopy.length - 1; i >= 0; i--) {
        if (historyCopy[i].role === 'user') {
            lastUserIndex = i;
            break;
        }
    }
    
    if (lastUserIndex === -1) {
        if (typingIndicator) typingIndicator.classList.add('hidden');
        return;
    }

    const lastMessageObj = historyCopy[lastUserIndex];
    const lastMessageText = lastMessageObj.content;
    const lastMediaBase64 = lastMessageObj.mediaBase64;
    const lastMediaMimeType = lastMessageObj.mediaMimeType;
    historyCopy.splice(lastUserIndex, 1); // Quitar el último para que apiRoutes no lo duplique

    try {
        const response = await fetch(`${API_BASE_URL}/api/simulate-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: lastMessageText, mediaBase64: lastMediaBase64, mediaMimeType: lastMediaMimeType, history: historyCopy })
        });
        const data = await response.json();

        if (typingIndicator) typingIndicator.classList.add('hidden');

        if (data.success && data.response) {
            const messages = data.response.split('[SPLIT]').map(m => m.trim()).filter(m => m);
            
            // Acumular tokens
            simulatorTokens.input += (data.inputTokens || 0);
            simulatorTokens.output += (data.outputTokens || 0);
            simulatorTokens.cached += (data.cachedTokens || 0);
            updateSimulatorTokenUI();

            const assistId = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
            simulatorHistory.push({ id: assistId, role: 'assistant', content: data.response.replace(/\[SPLIT\]/g,"\\n") });

            // Renderizar cada parte con un pequeño retraso
            for (let i = 0; i < messages.length; i++) {
                if(i > 0) await new Promise(resolve => setTimeout(resolve, 800));
                const replyText = (data.shouldQuote && i === 0) ? lastMessageText : null;
                renderSimulatorMessage(messages[i], 'assistant', replyText, assistId);
            }
        } else {
            renderSimulatorMessage('Error: No se pudo obtener respuesta de la IA', 'error');
        }
    } catch (error) {
        console.error('Simulator error:', error);
        if (typingIndicator) typingIndicator.classList.add('hidden');
        renderSimulatorMessage(`Error: ${error.message || 'Error de conexión con el servidor'}`, 'error');
    }
}

let currentSimulatorMediaBase64 = null;
let currentSimulatorMediaMimeType = null;

window.handleSimulatorMediaUpload = function(event) {
    const file = event.target.files[0];
    if (file) processSimulatorMedia(file);
};

window.handleSimulatorDrop = function(event) {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        processSimulatorMedia(event.dataTransfer.files[0]);
    }
};

window.removeSimulatorMedia = function() {
    currentSimulatorMediaBase64 = null;
    currentSimulatorMediaMimeType = null;
    document.getElementById('simulator-media-preview-container').classList.add('hidden');
    document.getElementById('simulator-image-preview').src = '';
    document.getElementById('simulator-image-preview').classList.add('hidden');
    document.getElementById('simulator-audio-preview').src = '';
    document.getElementById('simulator-audio-preview').classList.add('hidden');
    document.getElementById('simulator-media-upload').value = '';
};

function processSimulatorMedia(file) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) {
        alert('Por favor selecciona un archivo de imagen o audio válido.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        currentSimulatorMediaBase64 = e.target.result;
        currentSimulatorMediaMimeType = file.type;
        
        if (file.type.startsWith('image/')) {
            document.getElementById('simulator-image-preview').src = currentSimulatorMediaBase64;
            document.getElementById('simulator-image-preview').classList.remove('hidden');
            document.getElementById('simulator-audio-preview').classList.add('hidden');
        } else if (file.type.startsWith('audio/')) {
            document.getElementById('simulator-audio-preview').src = currentSimulatorMediaBase64;
            document.getElementById('simulator-audio-preview').classList.remove('hidden');
            document.getElementById('simulator-image-preview').classList.add('hidden');
        }
        
        document.getElementById('simulator-media-preview-container').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

async function sendSimulatorMessage() {
    const input = document.getElementById('simulator-chat-input');
    const roleSelect = document.getElementById('simulator-role-select');
    const text = input.value.trim();
    // Allow ending message if there's text OR media
    if (!text && !currentSimulatorMediaBase64) return;

    const role = roleSelect ? roleSelect.value : 'user';
    const msgId = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

    // Save media before clearing
    const mediaToAttach = currentSimulatorMediaBase64;
    const mediaMimeType = currentSimulatorMediaMimeType;

    // Mostrar mensaje del usuario / agente inmediatamente
    renderSimulatorMessage(text, role, null, msgId, mediaToAttach, mediaMimeType);
    input.value = '';
    removeSimulatorMedia(); // Clear preview

    // Añadir al historial INMEDIATAMENTE
    let defaultContent = '📷 Imagen';
    if (mediaMimeType && mediaMimeType.startsWith('audio/')) {
        defaultContent = '🎵 Audio';
    }
    simulatorHistory.push({ id: msgId, role: role, content: text || defaultContent, mediaBase64: mediaToAttach, mediaMimeType: mediaMimeType });
    
    // Si el mensaje es del agente, no hacemos petición a la IA en su nombre
    if (role === 'assistant') {
        return;
    }

    // --- REPLICA EL DEBOUNCE DEL SERVIDOR (20 seg) ---
    if (simulatorAiTimer) {
        clearTimeout(simulatorAiTimer);
    }
    if (simulatorCountdownInterval) {
        clearInterval(simulatorCountdownInterval);
    }

    const typingIndicator = document.getElementById('simulator-typing-indicator');
    const timerText = document.getElementById('simulator-timer-text');
    
    if (typingIndicator) typingIndicator.classList.remove('hidden');
    
    simulatorCountdownValue = 20;
    if (timerText) timerText.textContent = `Esperando (${simulatorCountdownValue}s)`;

    simulatorCountdownInterval = setInterval(() => {
        simulatorCountdownValue--;
        if (simulatorCountdownValue > 0) {
            if (timerText) timerText.textContent = `Esperando (${simulatorCountdownValue}s)`;
        } else {
            clearInterval(simulatorCountdownInterval);
            if (timerText) timerText.textContent = "Procesando...";
        }
    }, 1000);

    simulatorAiTimer = setTimeout(async () => {
        simulatorAiTimer = null;
        clearInterval(simulatorCountdownInterval);
        await processSimulatorAi();
    }, 20000);
}

function formatSimulatorText(text) {
    return text
        .replace(/\\n/g, '<br>')
        .replace(/\n/g, '<br>')
        .replace(/```([\s\S]*?)```/g, '<code class="bg-gray-200 px-1 rounded text-sm">$1</code>')
        .replace(/\*([^*]+)\*/g, '<b>$1</b>')
        .replace(/_(.*?)_/g, '<i>$1</i>')
        .replace(/~(.*?)~/g, '<s>$1</s>');
}

function renderSimulatorMessage(text, sender, repliedToText = null, msgId = null, mediaBase64 = null, mediaMimeType = null) {
    const historyContainer = document.getElementById('simulator-chat-history');
    if (!historyContainer) return;

    let mediaHtml = '';
    if (mediaBase64) {
        if (mediaMimeType && mediaMimeType.startsWith('audio/')) {
            mediaHtml = `<audio controls src="${mediaBase64}" class="mb-1 w-full max-w-[200px] h-10 rounded-lg"></audio>`;
        } else {
            mediaHtml = `<img src="${mediaBase64}" class="rounded-lg mb-1 max-w-full cursor-pointer hover:opacity-90 transition-opacity" onclick="openImageModal('${mediaBase64}')">`;
        }
    }

    const msgDiv = document.createElement('div');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedText = formatSimulatorText(text);
    const deleteBtn = `<button class="sim-msg-delete" onclick="deleteSimulatorMessage(this)" title="Eliminar mensaje"><i class="fas fa-times"></i></button>`;
    if (sender === 'user') {
        msgDiv.className = 'flex justify-end sim-msg-wrapper';
        if (msgId) msgDiv.setAttribute('data-msg-id', msgId);
        msgDiv.innerHTML = `<div class="bg-[#d9fdd3] text-[#111b21] rounded-lg rounded-tr-sm px-3 py-2 max-w-[85%] shadow-sm relative sim-msg-bubble">${deleteBtn}${mediaHtml}<span class="break-words text-[15px]">${formattedText}</span><span class="text-[11px] text-gray-500 float-right ml-2 mt-1">${time} <i class="fas fa-check-double text-[#53bdeb]"></i></span></div>`;
    } else if (sender === 'assistant') {
        msgDiv.className = 'flex justify-start sim-msg-wrapper';
        if (msgId) msgDiv.setAttribute('data-msg-id', msgId);
        let replyHtml = '';
        if (repliedToText) {
            replyHtml = `<div class="bg-black/5 border-l-4 border-purple-500 rounded p-1 mb-1 text-xs text-gray-600 max-w-full overflow-hidden"><span class="text-purple-600 font-semibold block">Cliente</span><span class="truncate block">${repliedToText}</span></div>`;
        }
        msgDiv.innerHTML = `<div class="bg-white text-[#111b21] rounded-lg rounded-tl-sm px-3 py-2 max-w-[85%] shadow-sm relative sim-msg-bubble">${deleteBtn}${replyHtml}${mediaHtml}<span class="break-words text-[15px]">${formattedText}</span><span class="text-[11px] text-gray-500 float-right ml-2 mt-1">${time}</span></div>`;
    } else {
        msgDiv.className = 'flex justify-center';
        msgDiv.innerHTML = `<div class="bg-red-100 text-red-600 rounded-lg px-3 py-1 text-xs shadow-sm">${text}</div>`;
    }

    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
}

function deleteSimulatorMessage(btnElement) {
    const msgWrapper = btnElement.closest('.sim-msg-wrapper');
    if (!msgWrapper) return;
    
    const msgId = msgWrapper.getAttribute('data-msg-id');
    
    // Eliminar del historial de mensajes
    if (msgId) {
        const index = simulatorHistory.findIndex(m => m.id === msgId);
        if (index > -1) {
            simulatorHistory.splice(index, 1);
        }
    }
    
    // Eliminar del DOM (si hay varios mensajes con el mismo ID por culpa del [SPLIT], borramos todos)
    if (msgId) {
        document.querySelectorAll(`.sim-msg-wrapper[data-msg-id="${msgId}"]`).forEach(el => el.remove());
    } else {
        msgWrapper.remove();
    }
}
window.deleteSimulatorMessage = deleteSimulatorMessage;

function clearSimulatorChat() {
    simulatorHistory = [];
    simulatorTokens = { input: 0, output: 0, cached: 0 };
    updateSimulatorTokenUI();
    const historyContainer = document.getElementById('simulator-chat-history');
    if (historyContainer) {
        historyContainer.innerHTML = `
            <div class="text-center my-4">
                <span class="bg-[#e1f3fb] text-[#1f2937] text-xs px-3 py-1 rounded-lg inline-block shadow-sm">
                    <i class="fas fa-lock mr-1"></i> Los mensajes y llamadas están cifrados de extremo a extremo.
                </span>
            </div>
        `;
    }
}

window.sendSimulatorMessage = sendSimulatorMessage;
window.clearSimulatorChat = clearSimulatorChat;
// --- FIN SIMULADOR IA ---
window.loadAdIdMetrics = loadAdIdMetrics; // Definida en ui-manager
window.clearAdIdMetricsFilter = clearAdIdMetricsFilter; // Definida en ui-manager

// --- START: AI TIMER FOR NORMAL CHATS ---

window.skipAiWait = async function() {
    const contactId = state.selectedContactId;
    if (!contactId) return;

    const timerText = document.getElementById('ai-timer-text');
    if (timerText) timerText.textContent = "Saltando...";

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/skip-ai`, {
            method: 'POST'
        });
        const data = await response.json();
        if (data.success) {
            // Actualizar localmente para esconder el indicador de inmediato
            const contact = state.contacts.find(c => c.id === contactId);
            if (contact) delete contact.aiNextRun;
            checkAiTimer();
        } else {
            console.warn("[AI] No se pudo saltar el timer:", data.message);
            if (timerText) timerText.textContent = "Error";
            setTimeout(checkAiTimer, 2000);
        }
    } catch (error) {
        console.error("[AI] Error saltando el timer:", error);
    }
};

function checkAiTimer() {
    if (aiCountdownInterval) {
        clearInterval(aiCountdownInterval);
        aiCountdownInterval = null;
    }

    const contactId = state.selectedContactId;
    if (!contactId || state.activeView !== 'chats') {
        const indicator = document.getElementById('ai-typing-indicator');
        if (indicator) indicator.classList.add('hidden');
        return;
    }

    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact) return; 

    const indicator = document.getElementById('ai-typing-indicator');
    const timerText = document.getElementById('ai-timer-text');
    const spacer = document.getElementById('ai-typing-spacer');
    const skipBtn = document.getElementById('ai-skip-btn');
    const cancelBtn = document.getElementById('ai-cancel-btn');

    // 1. Caso: AI está generando realmente (procesando el mensaje)
    if (contact.aiStatus === 'generating') {
        if (indicator && timerText) {
            indicator.classList.remove('hidden');
            if (spacer) spacer.classList.remove('hidden');
            timerText.textContent = `Generando respuesta...`;
            if (skipBtn) skipBtn.classList.add('hidden');
            if (cancelBtn) cancelBtn.classList.remove('hidden');
        }
        return;
    }

    // 2. Caso: Cuenta regresiva (esperando a que el usuario termine de escribir)
    if (!contact.aiNextRun || !indicator || !timerText) {
        if (indicator) indicator.classList.add('hidden');
        if (spacer) spacer.classList.add('hidden');
        return;
    }

    if (skipBtn) skipBtn.classList.remove('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');

    const updateCountdown = () => {
        const now = new Date();
        const diff = Math.ceil((contact.aiNextRun - now) / 1000);

        if (diff <= 0) {
            if (contact.aiStatus !== 'generating') {
                indicator.classList.add('hidden');
                if (spacer) spacer.classList.add('hidden');
            }
            clearInterval(aiCountdownInterval);
            aiCountdownInterval = null;
        } else {
            const wasHidden = indicator.classList.contains('hidden');
            indicator.classList.remove('hidden');
            if (spacer) spacer.classList.remove('hidden');
            timerText.textContent = `Esperando (${diff}s)`;
            
            if (wasHidden) {
                const container = document.getElementById('messages-container');
                if (container) {
                    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
                    if (isNearBottom || container.scrollHeight < container.clientHeight * 2) {
                        container.scrollTop = container.scrollHeight;
                    }
                }
            }
        }
    };

    updateCountdown();
    aiCountdownInterval = setInterval(updateCountdown, 1000);
}

// Nueva función para cancelar la IA
async function cancelAiResponse() {
    const contactId = state.selectedContactId;
    if (!contactId) return;

    try {
        // Actualización optimista
        const indicator = document.getElementById('ai-typing-indicator');
        if (indicator) indicator.classList.add('hidden');
        
        const contact = state.contacts.find(c => c.id === contactId);
        if (contact) {
            delete contact.aiStatus;
            delete contact.aiNextRun;
        }

        await fetch(`/api/wa/contacts/${contactId}/cancel-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("Error al cancelar IA:", error);
    }
}
window.cancelAiResponse = cancelAiResponse;

// Escuchar cambios en la vista para detener/iniciar el timer
window.addEventListener('popstate', checkAiTimer);
// Envolver navigateTo para llamar a checkAiTimer
const originalNavigateTo = window.navigateTo;
window.navigateTo = function(...args) {
    const res = originalNavigateTo.apply(this, args);
    setTimeout(checkAiTimer, 100);
    return res;
};

// Exportar para que otros módulos puedan lanzarlo
window.checkAiTimer = checkAiTimer;
// --- END: AI TIMER FOR NORMAL CHATS ---

/**
 * Actualiza el contenido del badge de pedidos diarios en el header.
 * Si el conteo es 0, oculta el badge.
 * @param {number} count El número de pedidos registrados hoy.
 */
function actualizarBadgePedidosHoy(count) {
    const badge = document.getElementById('header-daily-orders-badge');
    if (!badge) return;

    badge.textContent = count;
    
    // Si hay pedidos, mostrar el badge; si no, ocultarlo
    if (count > 0) {
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }

    // Efecto de animación jumpy cuando cambia el número (opcional, ya tiene la animación de pop por CSS al aparecer)
}

/**
 * Cierra la ventana de chat en móviles para volver a la lista de contactos.
 */
function closeChatOnMobile() {
    state.selectedContactId = null;
    const chatView = document.getElementById('chat-view');
    if (chatView) {
        chatView.classList.remove('contact-selected');
    }
    // Opcional: Re-renderizar para limpiar el estado visual si es necesario
    // renderChatWindow(); 
}

window.actualizarBadgePedidosHoy = actualizarBadgePedidosHoy;
window.closeChatOnMobile = closeChatOnMobile;
window.toggleTagSidebar = toggleTagSidebar;
