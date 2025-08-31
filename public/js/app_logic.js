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

// --- START: HELPER FUNCTIONS ---
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
// --- END: HELPER FUNCTIONS ---


// --- START: APP INITIALIZATION ---
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
// --- END: APP INITIALIZATION ---


// --- START: NAVIGATION & VIEW RENDERING ---
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

    if (phoneInput && phoneInput.value.trim()) {
        if (tagSelect) {
            tagSelect.value = 'all'; 
            tagSelect.disabled = true;
        }
        display.textContent = `Se enviará a 1 número.`;
        return;
    }

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
// --- END: NAVIGATION & VIEW RENDERING ---


// --- START: DATA LISTENERS (REAL-TIME) ---
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
// --- END: DATA LISTENERS ---


// --- START: EVENT HANDLERS & USER ACTIONS ---

function appendMessage(message) {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    const lastMessage = state.messages[state.messages.length - 2];
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

    const templateObject = state.templates.find(t => t.name === templateName);

    if (!templateObject) { showError("Por favor, selecciona una plantilla válida."); return; }
    if (!imageUrl) { showError("Por favor, ingresa la URL de la imagen."); return; }

    let recipients = [];
    if (selectedTagKey === 'all') {
        recipients = state.contacts;
    } else {
        recipients = state.contacts.filter(c => c.status === selectedTagKey);
    }
    
    if (recipients.length === 0 && !phoneNumber) {
        showError("No hay contactos en la etiqueta seleccionada y no se especificó un número de teléfono.");
        return;
    }

    const contactIds = phoneNumber ? [] : recipients.map(c => c.id);

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...`;

    try {
        const payload = {
            contactIds,
            templateObject, 
            imageUrl,
            phoneNumber
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

function toggleTagSidebar() {
    state.isTagSidebarOpen = !state.isTagSidebarOpen;
    document.getElementById('main-sidebar').classList.toggle('collapsed', !state.isTagSidebarOpen);
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

function toggleIAMenu() {
    const submenu = document.getElementById('ia-submenu');
    const chevron = document.getElementById('ia-menu-chevron');
    submenu.classList.toggle('hidden');
    chevron.classList.toggle('rotate-180');
}

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
