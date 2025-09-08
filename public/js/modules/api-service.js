// --- START: DATA LISTENERS & API FETCHERS ---
// Este archivo maneja toda la comunicación con Firebase (listeners en tiempo real)
// y con el backend (peticiones fetch a la API).

// --- INICIO DE LA CORRECCIÓN: Función robusta para procesar timestamps ---
function processContacts(contacts) {
    return contacts.map(contact => {
        const ts = contact.lastMessageTimestamp;
        if (ts) {
            // Caso 1: Maneja el Timestamp en tiempo real de Firestore (tiene el método toDate)
            if (typeof ts.toDate === 'function') {
                contact.lastMessageTimestamp = ts.toDate();
            } 
            // Caso 2: Maneja el timestamp serializado que viene de la API
            else if (typeof ts === 'object' && ts._seconds) {
                contact.lastMessageTimestamp = new Date(ts._seconds * 1000);
            }
            // Si ya es un objeto Date de JS, no hace nada.
        }
        return contact;
    });
}
// --- FIN DE LA CORRECCIÓN ---


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
    if (state.pagination.isLoadingMore || !state.pagination.hasMore || !state.pagination.lastVisibleId) return;
    state.pagination.isLoadingMore = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts?limit=30&startAfterId=${state.pagination.lastVisibleId}`);
        if (!response.ok) throw new Error('Error al cargar más contactos.');

        const data = await response.json();
        
        const newContacts = processContacts(data.contacts);

        if (newContacts.length > 0) {
            const existingIds = new Set(state.contacts.map(c => c.id));
            const filteredNewContacts = newContacts.filter(c => !existingIds.has(c.id));
            state.contacts.push(...filteredNewContacts);

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
        
        state.pagination.hasMore = false; 
        state.pagination.lastVisibleId = null;

        handleSearchContacts();
    } catch (error) {
        console.error(error);
        showError(error.message);
    }
}

// --- LISTENER PARA ACTUALIZACIONES EN TIEMPO REAL ---
function listenForContactUpdates() {
    if (unsubscribeContactUpdatesListener) unsubscribeContactUpdatesListener();

    const q = db.collection('contacts_whatsapp')
        .where('lastMessageTimestamp', '>', state.appLoadTimestamp);

    unsubscribeContactUpdatesListener = q.onSnapshot(snapshot => {
        if (snapshot.empty) {
            return;
        }

        console.log(`[Real-time] Se detectaron ${snapshot.docChanges().length} cambios en los contactos.`);

        snapshot.docChanges().forEach(change => {
            const updatedContactData = processContacts([{ id: change.doc.id, ...change.doc.data() }])[0];
            const existingContactIndex = state.contacts.findIndex(c => c.id === updatedContactData.id);

            if (existingContactIndex > -1) {
                state.contacts[existingContactIndex] = updatedContactData;
            } else {
                state.contacts.unshift(updatedContactData);
            }
        });

        state.contacts.sort((a, b) => (b.lastMessageTimestamp?.getTime() || 0) - (a.lastMessageTimestamp?.getTime() || 0));

        handleSearchContacts();

    }, error => {
        console.error("Error en el listener de actualizaciones de contactos:", error);
        showError("Se perdió la conexión en tiempo real. Recarga la página.");
    });
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


async function fetchContactOrders(contactId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/orders`);
        if (!response.ok) {
            throw new Error('Error al cargar el historial de pedidos.');
        }
        const data = await response.json();
        return data.orders || [];
    } catch (error) {
        console.error(error);
        showError(error.message);
        return [];
    }
}

