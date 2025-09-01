// --- START: DATA LISTENERS & API FETCHERS ---
// Este archivo maneja toda la comunicación con Firebase (listeners en tiempo real)
// y con el backend (peticiones fetch a la API).

// --- LÓGICA DE CARGA DE CONTACTOS (MODIFICADA PARA PAGINACIÓN) ---
async function fetchInitialContacts() {
    state.pagination.isLoadingMore = true;
    const contactsLoadingEl = document.getElementById('contacts-loading');
    if (contactsLoadingEl) contactsLoadingEl.style.display = 'block';

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts?limit=30`);
        const data = await response.json();
        if (data.success) {
            state.contacts = data.contacts;
            state.pagination.lastVisibleId = data.lastVisibleId;
            state.pagination.hasMore = !!data.lastVisibleId;
            handleSearchContacts(); // Renderiza la lista inicial
        }
    } catch (error) {
        console.error(error);
        showError("No se pudo conectar a los contactos.");
    } finally {
        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none';
        state.pagination.isLoadingMore = false;
    }
}

async function fetchMoreContacts() {
    if (state.pagination.isLoadingMore || !state.pagination.hasMore) return;
    state.pagination.isLoadingMore = true;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts?limit=30&startAfterId=${state.pagination.lastVisibleId}`);
        const data = await response.json();

        if (data.success && data.contacts.length > 0) {
            state.contacts = [...state.contacts, ...data.contacts];
            state.pagination.lastVisibleId = data.lastVisibleId;
            state.pagination.hasMore = !!data.lastVisibleId;
            handleSearchContacts(); // Vuelve a renderizar la lista con los nuevos contactos
        } else {
            state.pagination.hasMore = false;
        }
    } catch (error) {
        console.error(error);
        showError("Error al cargar más contactos.");
    } finally {
        state.pagination.isLoadingMore = false;
    }
}

async function searchContactsAPI(query) {
    // Si la búsqueda está vacía, resetea el estado y carga la lista inicial paginada
    if (!query) {
        state.pagination.lastVisibleId = null;
        state.pagination.hasMore = true;
        fetchInitialContacts();
        return;
    }
    
    const contactsLoadingEl = document.getElementById('contacts-loading');
    if (contactsLoadingEl) contactsLoadingEl.style.display = 'block';

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/search?query=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (data.success) {
            state.contacts = data.contacts;
            state.pagination.hasMore = false; // Desactivamos el scroll infinito durante una búsqueda
            handleSearchContacts(); // Renderiza los resultados de la búsqueda
        }
    } catch (error) {
        console.error(error);
        showError("Error al realizar la búsqueda.");
    } finally {
        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none';
    }
}


// --- OTROS LISTENERS (SIN CAMBIOS POR AHORA) ---

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
            // Ya no llamamos a handleSearchContacts aquí para evitar re-renderizados innecesarios
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

// --- API Fetchers ---

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
