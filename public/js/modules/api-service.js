// --- START: DATA LISTENERS & API FETCHERS ---
// Este archivo maneja toda la comunicación con Firebase (listeners en tiempo real)
// y con el backend (peticiones fetch a la API).

// --- Helper function to convert Firestore timestamp from API ---
function processContacts(contacts) {
    return contacts.map(contact => {
        // Correctly convert from Firestore's serialized format to a JS Date object
        if (contact.lastMessageTimestamp && typeof contact.lastMessageTimestamp === 'object' && contact.lastMessageTimestamp._seconds) {
            contact.lastMessageTimestamp = new Date(contact.lastMessageTimestamp._seconds * 1000);
        }
        return contact;
    });
}


// --- NUEVAS FUNCIONES DE CARGA PAGINADA ---

async function fetchInitialContacts() {
    try {
        const contactsLoadingEl = document.getElementById('contacts-loading');
        if (contactsLoadingEl) contactsLoadingEl.style.display = 'block';

        // Reseteamos el estado de paginación para una carga limpia
        state.pagination.lastVisibleId = null;
        state.pagination.hasMore = true;

        const response = await fetch(`${API_BASE_URL}/api/contacts?limit=30`);
        if (!response.ok) throw new Error('Error al cargar contactos iniciales.');
        
        const data = await response.json();
        
        state.contacts = processContacts(data.contacts);

        // CORRECCIÓN 1: Usar la variable correcta 'lastVisibleId' de la respuesta de la API.
        state.pagination.lastVisibleId = data.lastVisibleId;
        state.pagination.hasMore = data.contacts.length > 0;

        handleSearchContacts();

        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none';
    } catch (error) {
        console.error(error);
        showError(error.message);
    }
}


async function fetchMoreContacts() {
    // CORRECCIÓN: Usar las variables de estado correctas para la paginación
    if (state.pagination.isLoadingMore || !state.pagination.hasMore || !state.pagination.lastVisibleId) return;
    state.pagination.isLoadingMore = true;

    try {
        // CORRECCIÓN 2: Usar el nombre de parámetro correcto 'startAfterId' que el backend espera.
        const response = await fetch(`${API_BASE_URL}/api/contacts?limit=30&startAfterId=${state.pagination.lastVisibleId}`);
        if (!response.ok) throw new Error('Error al cargar más contactos.');

        const data = await response.json();
        
        const newContacts = processContacts(data.contacts);

        if (newContacts.length > 0) {
            // Añadir nuevos contactos a la lista existente
            const existingIds = new Set(state.contacts.map(c => c.id));
            const filteredNewContacts = newContacts.filter(c => !existingIds.has(c.id));
            state.contacts.push(...filteredNewContacts);

            // CORRECCIÓN 3: Actualizar el ID del último documento visible.
            state.pagination.lastVisibleId = data.lastVisibleId;
        } else {
            state.pagination.hasMore = false;
        }

        handleSearchContacts();
    } catch (error) {
        console.error(error);
        showError(error.message);
    } finally {
        state.pagination.isLoadingMore = false;
    }
}


async function searchContactsAPI(query) {
    if (!query) {
        fetchInitialContacts(); // Si la búsqueda está vacía, vuelve a la lista normal paginada
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/search?query=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Error en la búsqueda.');

        const data = await response.json();
        
        state.contacts = processContacts(data.contacts);
        
        // En modo búsqueda, no hay paginación, así que reseteamos estos valores
        state.pagination.hasMore = false; 
        state.pagination.lastVisibleId = null;

        handleSearchContacts();
    } catch (error) {
        console.error(error);
        showError(error.message);
    }
}

// --- LISTENERS EN TIEMPO REAL (PARA DATOS MÁS PEQUEÑOS) ---

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
