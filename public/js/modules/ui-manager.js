// --- START: UI Management & View Rendering ---
// Este archivo se encarga de la navegación, renderizado de vistas,
// y la manipulación de componentes de UI como modales, pickers, etc.

let ticking = false; // For scroll event throttling
let tagsSortable = null;

// --- Navigation & Main View Rendering ---
function navigateTo(viewName, force = false) { // AÑADIDO: Parámetro 'force'
    // AÑADIDO: La comprobación ahora respeta el parámetro 'force'.
    if (state.activeView === viewName && !force) {
        return;
    }
    
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

    const mainViewContainer = document.getElementById('main-view-container');
    switch (viewName) {
        case 'chats':
            mainViewContainer.innerHTML = ChatViewTemplate();
            renderChatWindow();
            renderTagFilters(); 
            setupChatListEventListeners();
            // AÑADIDO: Vuelve a dibujar la lista de contactos usando los datos del estado actual.
            // Esta es la corrección para el problema de navegación.
            handleSearchContacts();
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
        case 'campanas-imagen':
            mainViewContainer.innerHTML = CampaignsWithImageViewTemplate();
            renderCampaignsWithImageView();
            break;
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

    let buttonsHtml = `<button id="filter-all" class="filter-btn ${state.activeFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Todos</button>`;
    
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

function renderChatWindow() { 
    if (state.activeView !== 'chats') return;
    
    const chatPanelEl = document.getElementById('chat-panel');
    if (!chatPanelEl) return;

    const contact = state.contacts.find(c => c.id === state.selectedContactId); 
    chatPanelEl.innerHTML = ChatWindowTemplate(contact); 

    // AÑADIDO: Conectar el manejador de búsqueda con debounce al input
    const searchInput = document.getElementById('search-contacts-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
    }
    
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

function renderCampaignsWithImageView() {
    if (state.activeView !== 'campanas-imagen') return;
    const tagSelect = document.getElementById('campaign-image-tag-select');
    const templateSelect = document.getElementById('campaign-image-template-select');

    if (tagSelect) {
        tagSelect.innerHTML = '<option value="all">Todos los contactos</option>' + state.tags.map(tag => `<option value="${tag.key}">${tag.label}</option>`).join('');
    }
    if (templateSelect) {
        const imageTemplates = state.templates.filter(t => t.components.some(c => c.type === 'HEADER' && c.format === 'IMAGE'));
        templateSelect.innerHTML = '<option value="">-- Selecciona una plantilla --</option>' + imageTemplates.map(t => `<option value='${t.name}'>${t.name} (${t.language})</option>`).join('');
    }
    updateCampaignRecipientCount('image');
}

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
        // Esta vista necesitaría ser paginada también en una implementación a gran escala
        const contactsToDisplay = state.contacts.slice(0, 100); // Mostramos solo los primeros 100
        botContactsTableBody.innerHTML = contactsToDisplay.map(contact => `
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

function appendMessage(message) {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    // Check if a date separator is needed by comparing with the second to last message
    const lastMessage = state.messages.length > 1 ? state.messages[state.messages.length - 2] : null;
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


function renderNotes() { 
    const contentContainer = document.getElementById('notes-content'); 
    if (!contentContainer) return; 
    contentContainer.innerHTML = state.notes.map(NoteItemTemplate).join(''); 
}

/**
 * Muestra una cabecera de fecha flotante mientras el usuario se desplaza
 * por la lista de mensajes.
 */
function handleScroll() {
    const messagesContainer = document.getElementById('messages-container');
    const stickyHeader = document.getElementById('sticky-date-header');
    if (!messagesContainer || !stickyHeader) return;

    const dateSeparators = messagesContainer.querySelectorAll('.date-separator-anchor');
    if (dateSeparators.length === 0) {
        stickyHeader.classList.remove('visible');
        return;
    }

    let topVisibleSeparator = null;
    for (let i = dateSeparators.length - 1; i >= 0; i--) {
        const separator = dateSeparators[i];
        const rect = separator.getBoundingClientRect();
        const containerRect = messagesContainer.getBoundingClientRect();

        // Check if the separator is above the top of the container view
        if (rect.top < containerRect.top) {
            topVisibleSeparator = separator;
            break;
        }
    }

    if (topVisibleSeparator) {
        stickyHeader.textContent = topVisibleSeparator.textContent;
        stickyHeader.classList.add('visible');
    } else {
        stickyHeader.classList.remove('visible');
    }
}


// --- UI Helpers & Modals ---

function showError(message) { 
    const errorMessageEl = document.getElementById('error-message');
    const errorContainerEl = document.getElementById('error-container');
    errorMessageEl.textContent = message; 
    errorContainerEl.classList.remove('hidden'); 
    setTimeout(() => hideError(), 5000); 
}

function hideError() { 
    const errorContainerEl = document.getElementById('error-container');
    errorContainerEl.classList.add('hidden'); 
}

function openImageModal(imageUrl) { 
    const modal = document.getElementById('image-modal'); 
    const modalImage = document.getElementById('modal-image-content'); 
    modalImage.src = imageUrl; 
    modal.classList.add('visible'); 
}

function closeImageModal() { 
    const modal = document.getElementById('image-modal'); 
    modal.classList.remove('visible'); 
    const modalImage = document.getElementById('modal-image-content'); 
    setTimeout(() => { modalImage.src = ''; }, 300); 
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

/**
 * Renderiza la vista previa de un archivo adjunto (local o remoto).
 */
function renderFilePreview() {
    const container = document.getElementById('file-preview-container');
    if (!container) return;

    if (state.stagedFile) {
        container.innerHTML = LocalFilePreviewTemplate(state.stagedFile);
        container.classList.remove('hidden');
    } else if (state.stagedRemoteFile) {
        container.innerHTML = RemoteFilePreviewTemplate(state.stagedRemoteFile);
        container.classList.remove('hidden');
    } else {
        container.innerHTML = '';
        container.classList.add('hidden');
    }
}

// --- START: NEW MODAL FUNCTIONS FOR REGISTERING ORDERS ---
function openRegisterOrderModal() {
    if (!state.selectedContactId) return;
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    if (!contact) return;

    const modalContainer = document.getElementById('register-order-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = RegisterOrderModalTemplate();

        document.getElementById('crm-pedidoTelefono').value = contact.id;

        document.getElementById('crm-btnCerrarModal').addEventListener('click', closeRegisterOrderModal);
        document.getElementById('crm-btnCancelarPedido').addEventListener('click', closeRegisterOrderModal);
        document.getElementById('crm-formularioNuevoPedido').addEventListener('submit', handleSaveNewOrderFromCRM);

        setupCrmOrderModalFunctionality();

        document.getElementById('crm-modalNuevoPedido').style.display = 'flex';
        document.getElementById('crm-pedidoProductoSelect').focus();
    }
}

function closeRegisterOrderModal() {
    const modalContainer = document.getElementById('register-order-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = '';
    }
    // Clear photo managers
    state.crmOrderPhotosManager = [];
    state.crmPromoPhotosManager = [];
}

function showCrmOrderConfirmationModal(numeroPedido) {
    const modalContainer = document.getElementById('register-order-confirmation-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = RegisterOrderConfirmationModalTemplate(numeroPedido);

        document.getElementById('crm-btnCerrarModalConfirmacionRegistro').addEventListener('click', closeCrmOrderConfirmationModal);
        document.getElementById('crm-btnCopiarNumeroPedidoConfirmacion').addEventListener('click', () => {
             navigator.clipboard.writeText(numeroPedido).then(() => {
                const btn = document.getElementById('crm-btnCopiarNumeroPedidoConfirmacion');
                btn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1500);
            });
        });
        
        if (typeof confetti === 'function') {
             confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 }, zIndex: 1001 });
        }
    }
}

function closeCrmOrderConfirmationModal() {
    const modalContainer = document.getElementById('register-order-confirmation-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = '';
    }
}

function setupCrmOrderModalFunctionality() {
    state.crmOrderPhotosManager = [];
    state.crmPromoPhotosManager = [];

    const createPhotoPreviewRenderer = (previewContainer, photoManager, onUpdateCallback) => {
        const renderPreviews = () => {
            previewContainer.innerHTML = '';
            photoManager.forEach((photo, index) => {
                const thumb = document.createElement('div');
                thumb.className = 'preview-thumbnail';
                thumb.dataset.index = index;
                
                const img = document.createElement('img');
                img.src = URL.createObjectURL(photo.file);
                img.onload = () => URL.revokeObjectURL(img.src);
                
                const delBtn = document.createElement('button');
                delBtn.className = 'delete-photo-btn';
                delBtn.innerHTML = '&times;';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    photoManager.splice(index, 1);
                    renderPreviews(); 
                };

                thumb.appendChild(img);
                thumb.appendChild(delBtn);
                previewContainer.appendChild(thumb);
            });

            if (onUpdateCallback) onUpdateCallback(photoManager);
        };
        return renderPreviews;
    };

    const onOrderPhotosUpdate = (manager) => {
        const mismaFotoContainer = document.getElementById('crm-mismaFotoContainer');
        const mismaFotoCheckbox = document.getElementById('crm-mismaFotoCheckbox');
        if (manager.length > 0) {
            mismaFotoContainer.style.display = 'flex';
        } else {
            mismaFotoContainer.style.display = 'none';
            if (mismaFotoCheckbox.checked) {
                mismaFotoCheckbox.checked = false;
                state.crmPromoPhotosManager.length = 0;
                renderPromoPhotoPreviews();
            }
        }
        if (mismaFotoCheckbox.checked) {
            state.crmPromoPhotosManager = manager.map(p => ({ ...p }));
            renderPromoPhotoPreviews();
        }
    };
    
    const renderOrderPhotoPreviews = createPhotoPreviewRenderer(document.getElementById('crm-fotosPreviewContainer'), state.crmOrderPhotosManager, onOrderPhotosUpdate);
    const renderPromoPhotoPreviews = createPhotoPreviewRenderer(document.getElementById('crm-promoFotosPreviewContainer'), state.crmPromoPhotosManager, null);
    
    const setupDragAndDrop = (dropZone, fileInput, manager, renderFunc) => {
        fileInput.addEventListener('change', (e) => {
            for (const file of e.target.files) manager.push({ file: file, isNew: true });
            renderFunc();
            e.target.value = '';
        });
        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', e => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            for (const file of e.dataTransfer.files) if (file.type.startsWith('image/')) manager.push({ file: file, isNew: true });
            renderFunc();
        });
    };

    setupDragAndDrop(document.getElementById('crm-fileInputContainerProducto'), document.getElementById('crm-pedidoFotoFile'), state.crmOrderPhotosManager, renderOrderPhotoPreviews);
    setupDragAndDrop(document.getElementById('crm-fileInputContainerPromocion'), document.getElementById('crm-pedidoFotoPromocionFile'), state.crmPromoPhotosManager, renderPromoPhotoPreviews);
    
    document.getElementById('crm-mismaFotoCheckbox').addEventListener('change', e => {
        if (e.target.checked) {
            state.crmPromoPhotosManager = state.crmOrderPhotosManager.map(p => ({ ...p }));
            renderPromoPhotoPreviews();
        }
    });

    const productoSelect = document.getElementById('crm-pedidoProductoSelect');
    const productoOtroInput = document.getElementById('crm-pedidoProductoOtro');
    productoSelect.addEventListener('change', () => {
        const esOtro = productoSelect.value === 'Otro';
        productoOtroInput.style.display = esOtro ? 'block' : 'none';
        productoOtroInput.required = esOtro;
        if (esOtro) productoOtroInput.focus();
    });
}
// --- END: NEW MODAL FUNCTIONS ---
