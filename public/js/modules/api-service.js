// --- START: DATA LISTENERS & API FETCHERS ---
// Este archivo maneja toda la comunicación con Firebase (listeners en tiempo real)
// y con el backend (peticiones fetch a la API).

// --- INICIO DE LA CORRECCIÓN: Función robusta para procesar timestamps ---
/**
 * Procesa un array de contactos para convertir los timestamps de Firebase
 * (ya sea del listener en tiempo real o serializados de la API) a objetos Date de JavaScript.
 * @param {Array<object>} contacts Array de objetos de contacto.
 * @returns {Array<object>} El mismo array con los timestamps procesados.
 */
function processContacts(contacts) {
    return contacts.map(contact => {
        const ts = contact.lastMessageTimestamp;
        if (ts) {
            // Caso 1: Maneja el Timestamp en tiempo real de Firestore (tiene el método toDate)
            if (typeof ts.toDate === 'function') {
                contact.lastMessageTimestamp = ts.toDate();
            }
            // Caso 2: Maneja el timestamp serializado que viene de la API ({_seconds: ..., _nanoseconds: ...})
            else if (typeof ts === 'object' && typeof ts._seconds === 'number') {
                contact.lastMessageTimestamp = new Date(ts._seconds * 1000 + (ts._nanoseconds || 0) / 1e6); // Incluir nanosegundos
            }
            // Caso 3: Podría ser ya un string ISO 8601 si viene de otra fuente
            else if (typeof ts === 'string' && !isNaN(Date.parse(ts))) {
                 contact.lastMessageTimestamp = new Date(ts);
            }
            // Si ya es un objeto Date de JS, no hace nada.
        }
        return contact;
    });
}
// --- FIN DE LA CORRECCIÓN ---


// --- NUEVO LISTENER PARA PEDIDOS EN TIEMPO REAL ---
/**
 * Establece un listener en tiempo real para los pedidos asociados a un contactId específico.
 * Llama al callback con la lista de pedidos ordenada cada vez que hay cambios.
 * @param {string} contactId El ID del contacto (número de teléfono).
 * @param {Function} callback Función a ejecutar con la lista de pedidos actualizada.
 */
function listenForContactOrders(contactId, callback) {
    // Cancela el listener anterior si existe, para evitar duplicados
    if (unsubscribeOrdersListener) unsubscribeOrdersListener();

    // Crea la consulta: pedidos donde el campo 'telefono' sea igual al contactId
    const q = db.collection('pedidos').where('telefono', '==', contactId);

    // Establece el listener onSnapshot
    unsubscribeOrdersListener = q.onSnapshot(snapshot => {
        // Mapea los documentos a un formato más simple
        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id, // ID del documento
                consecutiveOrderNumber: data.consecutiveOrderNumber, // Número DHxxxx
                producto: data.producto, // Nombre del producto
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null, // Fecha a ISO string
                estatus: data.estatus || 'Sin estatus' // Estatus o default
            };
        });
        // Ordena los pedidos por fecha descendente (más recientes primero)
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        // Llama al callback con la lista ordenada
        callback(orders);
    }, error => {
        // Manejo de errores del listener
        console.error(`Error escuchando pedidos para ${contactId}:`, error);
        showError("Error al actualizar el historial de pedidos en tiempo real.");
        callback([]); // Enviar array vacío en caso de error
    });
}
// --- FIN DEL NUEVO LISTENER ---


// --- NUEVAS FUNCIONES DE CARGA PAGINADA ---

/**
 * Carga la primera página de contactos desde la API, aplicando el filtro de etiqueta activo.
 * Actualiza el estado global de contactos y paginación.
 */
async function fetchInitialContacts() {
    try {
        const contactsLoadingEl = document.getElementById('contacts-loading');
        if (contactsLoadingEl) contactsLoadingEl.style.display = 'block'; // Mostrar carga

        // Reseteamos el estado de paginación para una carga limpia
        state.pagination.lastVisibleId = null;
        state.pagination.hasMore = true;

        // Determina si hay un filtro de etiqueta activo
        const tag = (state.activeFilter && state.activeFilter !== 'all') ? state.activeFilter : null;
        // Construye la URL base con límite
        let url = `${API_BASE_URL}/api/contacts?limit=30`;
        // Añade el parámetro 'tag' si hay un filtro
        if (tag) {
            url += `&tag=${tag}`;
        }

        // Realiza la petición a la API
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error al cargar contactos iniciales.');

        const data = await response.json();

        // Procesa los timestamps y actualiza el estado
        state.contacts = processContacts(data.contacts);

        // Actualiza el estado de paginación
        state.pagination.lastVisibleId = data.lastVisibleId; // ID del último contacto para la siguiente página
        state.pagination.hasMore = data.contacts.length > 0 && data.lastVisibleId !== null; // Hay más si se devolvieron contactos y hay un ID para seguir

        // Renderiza la lista de contactos en la UI
        handleSearchContacts(); // Asegúrate de que esta función esté definida globalmente o importada

        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none'; // Ocultar carga
    } catch (error) {
        console.error(error);
        showError(error.message); // Asegúrate de que showError esté definida globalmente o importada
    }
}


/**
 * Carga la siguiente página de contactos desde la API (scroll infinito).
 */
async function fetchMoreContacts() {
    // Evita cargas múltiples si ya está cargando, no hay más páginas o falta el ID de referencia
    if (state.pagination.isLoadingMore || !state.pagination.hasMore || !state.pagination.lastVisibleId) return;

    state.pagination.isLoadingMore = true; // Marcar como cargando
    console.log("Fetching more contacts after:", state.pagination.lastVisibleId);

    try {
        // Aplicar filtro de etiqueta si está activo
        const tag = (state.activeFilter && state.activeFilter !== 'all') ? state.activeFilter : null;
        // Construir URL con límite y 'startAfterId'
        let url = `${API_BASE_URL}/api/contacts?limit=30&startAfterId=${state.pagination.lastVisibleId}`;
        if (tag) {
            url += `&tag=${tag}`;
        }

        // Realizar petición
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error al cargar más contactos.');

        const data = await response.json();
        console.log("Received more contacts:", data.contacts.length, "lastVisibleId:", data.lastVisibleId);


        // Procesar timestamps
        const newContacts = processContacts(data.contacts);

        if (newContacts.length > 0) {
            // Añadir solo los contactos que no estén ya en la lista (evitar duplicados por si acaso)
            const existingIds = new Set(state.contacts.map(c => c.id));
            const filteredNewContacts = newContacts.filter(c => !existingIds.has(c.id));
            state.contacts.push(...filteredNewContacts);

            // Actualizar el ID del último contacto visible
            state.pagination.lastVisibleId = data.lastVisibleId;
            state.pagination.hasMore = !!data.lastVisibleId; // Hay más si la API devuelve un ID
        } else {
            // Si no vienen más contactos, marcar que ya no hay más páginas
            state.pagination.hasMore = false;
             console.log("No more contacts to load.");
        }

        // Re-renderizar la lista de contactos
        handleSearchContacts(); // Asegúrate de que esta función esté definida globalmente o importada
    } catch (error) {
        console.error(error);
        showError(error.message); // Asegúrate de que showError esté definida globalmente o importada
    } finally {
        state.pagination.isLoadingMore = false; // Desmarcar como cargando
    }
}


/**
 * Busca contactos en la API según un término de búsqueda.
 * Reemplaza la lista actual de contactos con los resultados.
 * @param {string} query El término de búsqueda.
 */
async function searchContactsAPI(query) {
    // Si la búsqueda está vacía, cargar la lista inicial paginada
    if (!query) {
        fetchInitialContacts();
        return;
    }

    const contactsLoadingEl = document.getElementById('contacts-loading');
    if (contactsLoadingEl) contactsLoadingEl.style.display = 'block'; // Mostrar carga durante búsqueda

    try {
        // Realizar petición a la API de búsqueda
        const response = await fetch(`${API_BASE_URL}/api/contacts/search?query=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Error en la búsqueda.');

        const data = await response.json();

        // Procesar timestamps y actualizar estado con los resultados
        state.contacts = processContacts(data.contacts);

        // Desactivar paginación durante la búsqueda
        state.pagination.hasMore = false;
        state.pagination.lastVisibleId = null;

        // Re-renderizar la lista
        handleSearchContacts(); // Asegúrate de que esta función esté definida globalmente o importada
    } catch (error) {
        console.error(error);
        showError(error.message); // Asegúrate de que showError esté definida globalmente o importada
    } finally {
        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none'; // Ocultar carga
    }
}

// --- LISTENER PARA ACTUALIZACIONES EN TIEMPO REAL ---
/**
 * Establece un listener en Firestore para detectar cambios (mensajes nuevos/actualizados)
 * en los contactos desde que se cargó la app. Actualiza la lista de contactos en la UI.
 */
function listenForContactUpdates() {
    if (unsubscribeContactUpdatesListener) unsubscribeContactUpdatesListener(); // Detener listener anterior

    // Crear consulta: busca contactos cuyo último mensaje sea MÁS RECIENTE que el momento en que se cargó la app
    const q = db.collection('contacts_whatsapp')
        .where('lastMessageTimestamp', '>', state.appLoadTimestamp); // `appLoadTimestamp` se define en main.js

    // Iniciar listener
    unsubscribeContactUpdatesListener = q.onSnapshot(snapshot => {
        // Si no hay cambios, no hacer nada
        if (snapshot.empty) {
            return;
        }

        console.log(`[Real-time] Se detectaron ${snapshot.docChanges().length} cambios en los contactos.`);
        let needsReRender = false;

        // Procesar cada cambio detectado
        snapshot.docChanges().forEach(change => {
            // Procesar timestamp del contacto modificado
            const updatedContactData = processContacts([{ id: change.doc.id, ...change.doc.data() }])[0];
            // Buscar si el contacto ya existe en la lista local
            const existingContactIndex = state.contacts.findIndex(c => c.id === updatedContactData.id);

            if (change.type === "added") {
                if (existingContactIndex === -1) {
                    // Añadir nuevo contacto al INICIO
                    state.contacts.unshift(updatedContactData);
                    needsReRender = true;
                }
            } else if (change.type === "modified") {
                if (existingContactIndex > -1) {
                    // Si existe, reemplazarlo con los datos actualizados
                    state.contacts[existingContactIndex] = updatedContactData;
                    needsReRender = true;
                } else {
                    // Si se modifica pero no estaba en la lista (posiblemente por paginación), añadirlo al inicio
                     state.contacts.unshift(updatedContactData);
                     needsReRender = true;
                }
            } else if (change.type === "removed") {
                if (existingContactIndex > -1) {
                    // Si se elimina, quitarlo de la lista
                    state.contacts.splice(existingContactIndex, 1);
                    needsReRender = true;
                }
            }
        });

        // Solo reordenar y re-renderizar si hubo cambios relevantes
        if (needsReRender) {
             // Reordenar toda la lista por fecha del último mensaje (más reciente primero)
            state.contacts.sort((a, b) => (b.lastMessageTimestamp?.getTime() || 0) - (a.lastMessageTimestamp?.getTime() || 0));

            // Re-renderizar la lista de contactos
            handleSearchContacts(); // Asegúrate de que esta función esté definida globalmente o importada
        }

    }, error => {
        // Manejo de errores del listener
        console.error("Error en el listener de actualizaciones de contactos:", error);
        showError("Se perdió la conexión en tiempo real. Recarga la página.");
    });
}


// --- LISTENERS EN TIEMPO REAL (PARA DATOS MÁS PEQUEÑOS) ---

// Escucha cambios en las respuestas rápidas
function listenForQuickReplies() {
    if (unsubscribeQuickRepliesListener) unsubscribeQuickRepliesListener();
    unsubscribeQuickRepliesListener = db.collection('quick_replies').orderBy('shortcut').onSnapshot((snapshot) => {
        // Actualiza el estado global
        state.quickReplies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Si la vista activa es la de respuestas rápidas, re-renderizarla
        if (state.activeView === 'respuestas-rapidas') {
            renderQuickRepliesView(); // Asegúrate de que esta función esté definida globalmente o importada
        }
    }, (error) => { console.error("Error fetching quick replies:", error); showError("No se pudieron cargar las respuestas rápidas."); });
}

// Escucha cambios en las etiquetas
function listenForTags() {
    if(unsubscribeTagsListener) unsubscribeTagsListener();
    unsubscribeTagsListener = db.collection('crm_tags').orderBy('order').onSnapshot(snapshot => {
        // Actualiza el estado global
        state.tags = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Re-renderiza componentes que dependen de las etiquetas si están activos
        if(state.activeView === 'chats') {
            renderTagFilters(); // Actualiza filtros en vista de chats
            handleSearchContacts(); // Re-renderiza lista de contactos (para colores de icono)
        }
        if(state.activeView === 'etiquetas') {
            renderTagsView(); // Actualiza tabla de etiquetas
        }
        if(state.activeView === 'campanas') {
            renderCampaignsView(); // Actualiza select de etiquetas en campañas
        }
         if(state.activeView === 'pipeline') {
            renderPipelineView(); // Re-dibuja el pipeline
        }
         // --- INICIO MODIFICACIÓN: Actualizar select de estatus de pedidos ---
        // Actualizar el select de estatus de pedidos en la barra lateral si está abierta
        if (state.contactDetailsOpen && state.selectedContactId) {
            const ordersListEl = document.getElementById('contact-orders-list');
             if (ordersListEl) {
                // Volver a renderizar los items de pedido para actualizar los selects
                // Asume que OrderHistoryItemTemplate usa state.orderStatuses que ahora se obtiene de state.tags
                state.orderStatuses = state.tags.map(t => ({key: t.key, label: t.label, color: t.color})); // Mapea tags a la estructura de orderStatuses
                ordersListEl.innerHTML = state.selectedContactOrders.map(OrderHistoryItemTemplate).join('');
             }
        }
        // --- FIN MODIFICACIÓN ---
    }, error => {
        console.error("Error al escuchar las etiquetas:", error);
        showError("No se pudieron cargar las etiquetas.");
    });
}

// Escucha cambios en los mensajes automáticos por anuncio
function listenForAdResponses() {
    if (unsubscribeAdResponsesListener) unsubscribeAdResponsesListener();
    unsubscribeAdResponsesListener = db.collection('ad_responses').orderBy('adName').onSnapshot(snapshot => {
        // Actualiza estado global
        state.adResponses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Re-renderiza la tabla si está activa
        if (state.activeView === 'mensajes-ads') {
            renderAdResponsesView();
        }
    }, error => {
        console.error("Error al escuchar los mensajes de anuncios:", error);
        showError("No se pudieron cargar los mensajes de anuncios.");
    });
}

// Escucha cambios en los prompts de IA por anuncio
function listenForAIAdPrompts() {
    if (unsubscribeAIAdPromptsListener) unsubscribeAIAdPromptsListener();
    unsubscribeAIAdPromptsListener = db.collection('ai_ad_prompts').orderBy('adName').onSnapshot(snapshot => {
        // Actualiza estado global
        state.aiAdPrompts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Re-renderiza la tabla si está activa
        if (state.activeView === 'prompts-ia') {
            renderAIAdPromptsView();
        }
    }, error => {
        console.error("Error al escuchar los prompts de IA:", error);
        showError("No se pudieron cargar los prompts de IA.");
    });
}

// Escucha cambios en la base de conocimiento de IA
function listenForKnowledgeBase() {
    if (unsubscribeKnowledgeBaseListener) unsubscribeKnowledgeBaseListener();
    unsubscribeKnowledgeBaseListener = db.collection('ai_knowledge_base').orderBy('topic').onSnapshot(snapshot => {
        // Actualiza estado global
        state.knowledgeBase = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Re-renderiza la tabla si está activa
        if (state.activeView === 'respuestas-ia') {
            renderKnowledgeBaseView();
        }
    }, error => {
        console.error("Error fetching knowledge base:", error);
        showError("No se pudo cargar la base de conocimiento.");
    });
}

// --- API Fetchers (Llamadas únicas al cargar la app) ---

// Obtiene las plantillas de WhatsApp desde el backend
async function fetchTemplates() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/whatsapp-templates`);
        const data = await response.json();
        if (data.success) {
            state.templates = data.templates; // Guarda en estado global
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error("Error al cargar las plantillas:", error);
        showError("No se pudieron cargar las plantillas de WhatsApp.");
    }
}

// Obtiene las instrucciones generales del bot
async function fetchBotSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/bot/settings`);
        const data = await response.json();
        if (data.success) {
            state.botSettings = data.settings; // Guarda en estado global
        }
    } catch (error) {
        console.error("Error fetching bot settings:", error);
    }
}

// Obtiene el estado del mensaje de ausencia
async function fetchAwayMessageSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/away-message`);
        const data = await response.json();
        if (data.success) {
            state.awayMessageSettings.isActive = data.settings.isActive; // Guarda en estado global
        }
    } catch (error) {
        console.error("Error fetching away message settings:", error);
        showError("No se pudo cargar la configuración del mensaje de ausencia.");
    }
}

// Obtiene el estado del bot global
async function fetchGlobalBotSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/global-bot`);
        const data = await response.json();
        if (data.success) {
            state.globalBotSettings.isActive = data.settings.isActive; // Guarda en estado global
        }
    } catch (error) {
        console.error("Error fetching global bot settings:", error);
        showError("No se pudo cargar la configuración del bot global.");
    }
}

// Obtiene el ID de la Google Sheet de cobertura
async function fetchGoogleSheetSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/google-sheet`);
        const data = await response.json();
        if (data.success) {
            state.googleSheetSettings.googleSheetId = data.settings.googleSheetId; // Guarda en estado global
        }
    } catch (error) {
        console.error("Error fetching Google Sheet settings:", error);
        showError("No se pudo cargar la configuración de Google Sheet.");
    }
}

// --- INICIO DE MODIFICACIÓN: API Functions ---

/**
 * --- MODIFICADO: Envía un mensaje usando la API oficial, manejando encolado ---
 * @param {string} contactId El ID del contacto.
 * @param {object} messageData Datos del mensaje { text, fileUrl, fileType, reply_to_wamid, tempId, shouldQueue }
 * @returns {Promise<Response>} La respuesta del fetch.
 */
async function sendMessageViaAPI(contactId, { text, fileUrl, fileType, reply_to_wamid, tempId, shouldQueue }) {
    // Determina el endpoint correcto basado en shouldQueue
    const endpoint = shouldQueue ? 'queue-message' : 'messages';
    const url = `${API_BASE_URL}/api/contacts/${contactId}/${endpoint}`;

    const payload = { text, fileUrl, fileType, reply_to_wamid, tempId };
    // Limpia propiedades nulas o indefinidas del payload
    Object.keys(payload).forEach(key => payload[key] == null && delete payload[key]);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let errorMsg = 'Error del servidor al enviar mensaje.';
        try {
            const errorData = await response.json();
            errorMsg = errorData.message || errorMsg;
        } catch(e) { /* Ignora error de parseo */ }
        throw new Error(errorMsg);
    }
    return response; // Devuelve la respuesta completa para que chat-handlers la procese
}

/**
 * --- NUEVO: Envía un mensaje usando la conexión de WhatsApp Web ---
 * @param {string} contactId El ID del contacto (número de teléfono).
 * @param {object} messageData Datos del mensaje { text, fileUrl, fileType, reply_to_wamid, tempId }
 * @returns {Promise<Response>} La respuesta del fetch al endpoint /api/web/send.
 */
async function sendWebMessage(contactId, { text, fileUrl, fileType, reply_to_wamid, tempId }) {
    const url = `${API_BASE_URL}/api/web/send`;
    const payload = {
        to: contactId,
        text: text,
        fileUrl: fileUrl,
        fileType: fileType,
        // Nota: El backend de /api/web/send necesitará adaptar reply_to_wamid al formato de Baileys si es necesario
        // reply_to_wamid: reply_to_wamid, // Podrías enviarlo si tu backend lo maneja
        tempId: tempId
    };
    // Limpia propiedades nulas o indefinidas
    Object.keys(payload).forEach(key => payload[key] == null && delete payload[key]);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
         let errorMsg = 'Error del servidor al enviar por WhatsApp Web.';
        try {
            const errorData = await response.json();
            errorMsg = errorData.message || errorMsg;
        } catch(e) { /* Ignora */ }
        throw new Error(errorMsg);
    }
    return response;
}

/**
 * --- NUEVO: Sube un archivo a Google Cloud Storage usando URL firmada ---
 * @param {File} file El archivo a subir.
 * @param {function(number)} onProgress Callback para reportar progreso (0-100).
 * @returns {Promise<string>} La URL pública del archivo subido.
 */
async function uploadFileToGCS(file, onProgress) {
    try {
        // 1. Obtener URL firmada del backend
        const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileName: file.name,
                contentType: file.type,
                pathPrefix: 'chat_uploads' // Carpeta específica
            })
        });
        if (!signedUrlResponse.ok) {
            const errorData = await signedUrlResponse.json();
            throw new Error(errorData.message || 'No se pudo preparar la subida del archivo.');
        }
        const { signedUrl, publicUrl } = await signedUrlResponse.json();

        // 2. Subir a GCS usando XHR para monitorear progreso
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', signedUrl, true);
            xhr.setRequestHeader('Content-Type', file.type);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && onProgress) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    onProgress(percentComplete);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(publicUrl); // Resuelve con la URL pública
                } else {
                    reject(new Error(`Error al subir ${xhr.status}: ${xhr.statusText}`));
                }
            };

            xhr.onerror = () => {
                reject(new Error('Error de red durante la subida.'));
            };

            xhr.send(file);
        });

    } catch (error) {
        console.error("Error en uploadFileToGCS:", error);
        throw error; // Re-lanza para que la función que llama maneje el error
    }
}

/**
 * --- NUEVO: Envía una reacción a un mensaje ---
 * @param {string} contactId ID del contacto.
 * @param {string} messageDocId ID del documento del mensaje en Firestore.
 * @param {string|null} reaction Emoji de la reacción o null para quitarla.
 * @returns {Promise<Response>} La respuesta del fetch.
 */
async function reactToMessageViaAPI(contactId, messageDocId, reaction) {
    const url = `${API_BASE_URL}/api/contacts/${contactId}/messages/${messageDocId}/react`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction: reaction }) // Envía el emoji o null
    });
    if (!response.ok) {
        let errorMsg = 'Error al enviar reacción.';
        try { const errorData = await response.json(); errorMsg = errorData.message || errorMsg; } catch(e) {}
        throw new Error(errorMsg);
    }
    return response;
}

/**
 * --- NUEVO: Envía una plantilla de mensaje ---
 * @param {string} contactId ID del contacto.
 * @param {object} templateObject El objeto completo de la plantilla.
 * @returns {Promise<Response>} La respuesta del fetch.
 */
async function sendTemplateViaAPI(contactId, templateObject) {
    const url = `${API_BASE_URL}/api/contacts/${contactId}/messages`;
    const payload = { template: templateObject }; // El backend espera el objeto completo
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
         let errorMsg = 'Error al enviar plantilla.';
        try { const errorData = await response.json(); errorMsg = errorData.message || errorMsg; } catch(e) {}
        throw new Error(errorMsg);
    }
    return response;
}

/**
 * --- NUEVO: Obtiene conteo de mensajes por Ad ID ---
 * @param {string} startDate Fecha de inicio (YYYY-MM-DD).
 * @param {string} endDate Fecha de fin (YYYY-MM-DD).
 * @returns {Promise<object>} Objeto con { adId: count }.
 */
async function fetchMessagesByAdIdMetrics(startDate, endDate) {
    try {
        const url = `${API_BASE_URL}/api/metrics/messages-by-ad?startDate=${startDate}&endDate=${endDate}`;
        const response = await fetch(url);
        if (!response.ok) {
            let errorMsg = `Error del servidor (${response.status})`;
            try { const errorData = await response.json(); errorMsg = errorData.message || errorMsg; } catch (e) {}
            throw new Error(errorMsg);
        }
        const data = await response.json();
        if (data.success && typeof data.counts === 'object') {
            return data.counts;
        } else {
            throw new Error(data.message || 'Respuesta inválida del servidor.');
        }
    } catch (error) {
        console.error("Error fetching messages by Ad ID metrics:", error);
        throw error;
    }
}
/**
 * Obtiene los datos completos de un único pedido desde Firestore por su ID de documento.
 * @param {string} orderId - El ID del documento del pedido en la colección 'pedidos'.
 * @returns {Promise<object>} Una promesa que resuelve con el objeto de datos del pedido.
 */
async function fetchSingleOrder(orderId) {
    try {
        const orderRef = db.collection('pedidos').doc(orderId);
        const doc = await orderRef.get();

        if (!doc.exists) {
            throw new Error('Pedido no encontrado.');
        }

        // Devuelve los datos del pedido junto con su ID
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error(`Error al obtener el pedido ${orderId}:`, error);
        throw error; // Lanza el error para que la función que llama lo maneje
    }
}
// --- FIN MODIFICACIÓN ---

// --- Exportaciones ---
// Asegúrate de exportar las nuevas funciones
export {
    listenForContactOrders,
    fetchInitialContacts,
    fetchMoreContacts,
    searchContactsAPI,
    listenForContactUpdates,
    listenForQuickReplies,
    listenForTags,
    listenForAdResponses,
    listenForAIAdPrompts,
    listenForKnowledgeBase,
    fetchTemplates,
    fetchBotSettings,
    fetchAwayMessageSettings,
    fetchGlobalBotSettings,
    fetchGoogleSheetSettings,
    sendMessageViaAPI, // Modificada
    sendWebMessage, // Nueva
    uploadFileToGCS, // Nueva
    reactToMessageViaAPI, // Nueva
    sendTemplateViaAPI, // Nueva
    fetchMessagesByAdIdMetrics, // Nueva
    fetchSingleOrder // Nueva
};
