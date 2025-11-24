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
                contact.lastMessageTimestamp = new Date(ts._seconds * 1000);
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

        // --- INICIO MODIFICACIÓN: Filtro de Departamento ---
        const departmentId = (state.activeDepartmentFilter && state.activeDepartmentFilter !== 'all') ? state.activeDepartmentFilter : null;
        // --- FIN MODIFICACIÓN ---

        // Construye la URL base con límite
        let url = `${API_BASE_URL}/api/contacts?limit=30`;
        // Añade el parámetro 'tag' si hay un filtro
        if (tag) {
            url += `&tag=${tag}`;
        }
        // --- INICIO MODIFICACIÓN: Añadir parámetro departmentId ---
        if (departmentId) {
            url += `&departmentId=${departmentId}`;
        }
        // --- FIN MODIFICACIÓN ---

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
        handleSearchContacts();

        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none'; // Ocultar carga
    } catch (error) {
        console.error(error);
        showError(error.message);
    }
}


/**
 * Carga la siguiente página de contactos desde la API (scroll infinito).
 */
async function fetchMoreContacts() {
    // Evita cargas múltiples si ya está cargando, no hay más páginas o falta el ID de referencia
    if (state.pagination.isLoadingMore || !state.pagination.hasMore || !state.pagination.lastVisibleId) return;

    state.pagination.isLoadingMore = true; // Marcar como cargando

    try {
        // Aplicar filtro de etiqueta si está activo
        const tag = (state.activeFilter && state.activeFilter !== 'all') ? state.activeFilter : null;

        // --- INICIO MODIFICACIÓN: Filtro de Departamento ---
        const departmentId = (state.activeDepartmentFilter && state.activeDepartmentFilter !== 'all') ? state.activeDepartmentFilter : null;
        // --- FIN MODIFICACIÓN ---

        // Construir URL con límite y 'startAfterId'
        let url = `${API_BASE_URL}/api/contacts?limit=30&startAfterId=${state.pagination.lastVisibleId}`;
        if (tag) {
            url += `&tag=${tag}`;
        }
        // --- INICIO MODIFICACIÓN: Añadir parámetro departmentId ---
        if (departmentId) {
            url += `&departmentId=${departmentId}`;
        }
        // --- FIN MODIFICACIÓN ---

        // Realizar petición
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error al cargar más contactos.');

        const data = await response.json();

        // Procesar timestamps
        const newContacts = processContacts(data.contacts);

        if (newContacts.length > 0) {
            // Añadir solo los contactos que no estén ya en la lista (evitar duplicados por si acaso)
            const existingIds = new Set(state.contacts.map(c => c.id));
            const filteredNewContacts = newContacts.filter(c => !existingIds.has(c.id));
            state.contacts.push(...filteredNewContacts);

            // Actualizar el ID del último contacto visible
            state.pagination.lastVisibleId = data.lastVisibleId;
        } else {
            // Si no vienen más contactos, marcar que ya no hay más páginas
            state.pagination.hasMore = false;
        }

        // Re-renderizar la lista de contactos
        handleSearchContacts();
    } catch (error) {
        console.error(error);
        showError(error.message);
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
        handleSearchContacts();
    } catch (error) {
        console.error(error);
        showError(error.message);
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

        // Procesar cada cambio detectado
        snapshot.docChanges().forEach(change => {
            // Procesar timestamp del contacto modificado
            const updatedContactData = processContacts([{ id: change.doc.id, ...change.doc.data() }])[0];

            // --- INICIO MODIFICACIÓN: Verificar filtro de departamento ---
            // Si hay un filtro de departamento activo y el contacto no pertenece, lo ignoramos (o removemos)
            if (state.activeDepartmentFilter !== 'all' && updatedContactData.assignedDepartmentId !== state.activeDepartmentFilter) {
                // Si existe en la lista local, lo removemos
                const idx = state.contacts.findIndex(c => c.id === updatedContactData.id);
                if (idx > -1) {
                    state.contacts.splice(idx, 1);
                }
                return; // No añadir/actualizar
            }
            // --- FIN MODIFICACIÓN ---

            // Buscar si el contacto ya existe en la lista local
            const existingContactIndex = state.contacts.findIndex(c => c.id === updatedContactData.id);

            if (existingContactIndex > -1) {
                // Si existe, reemplazarlo con los datos actualizados
                state.contacts[existingContactIndex] = updatedContactData;
            } else {
                // Si es un contacto nuevo (o no estaba en la página actual), añadirlo al INICIO de la lista
                state.contacts.unshift(updatedContactData);
            }
        });

        // Reordenar toda la lista por fecha del último mensaje (más reciente primero)
        state.contacts.sort((a, b) => (b.lastMessageTimestamp?.getTime() || 0) - (a.lastMessageTimestamp?.getTime() || 0));

        // Re-renderizar la lista de contactos
        handleSearchContacts();

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
            renderQuickRepliesView();
        }
    }, (error) => { console.error("Error fetching quick replies:", error); showError("No se pudieron cargar las respuestas rápidas."); });
}

// Escucha cambios en las etiquetas
function listenForTags() {
    if (unsubscribeTagsListener) unsubscribeTagsListener();
    unsubscribeTagsListener = db.collection('crm_tags').orderBy('order').onSnapshot(snapshot => {
        // Actualiza el estado global
        state.tags = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Re-renderiza componentes que dependen de las etiquetas si están activos
        if (state.activeView === 'chats') {
            renderTagFilters(); // Actualiza filtros en vista de chats
            handleSearchContacts(); // Re-renderiza lista de contactos (para colores de icono)
        }
        if (state.activeView === 'etiquetas') {
            renderTagsView(); // Actualiza tabla de etiquetas
        }
        if (state.activeView === 'campanas') {
            renderCampaignsView(); // Actualiza select de etiquetas en campañas
        }
        if (state.activeView === 'pipeline') {
            renderPipelineView(); // Re-dibuja el pipeline
        }
        // --- INICIO MODIFICACIÓN: Actualizar select de estatus de pedidos ---
        // Actualizar el select de estatus de pedidos en la barra lateral si está abierta
        if (state.contactDetailsOpen && state.selectedContactId) {
            const ordersListEl = document.getElementById('contact-orders-list');
            if (ordersListEl) {
                // Volver a renderizar los items de pedido para actualizar los selects
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

// --- NUEVO LISTENER: Escucha cambios en los Departamentos ---
function listenForDepartments() {
    if (unsubscribeDepartmentsListener) unsubscribeDepartmentsListener();
    unsubscribeDepartmentsListener = db.collection('departments').orderBy('createdAt').onSnapshot(snapshot => {
        // Actualiza estado global
        state.departments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Re-renderizar vista si es la activa
        if (state.activeView === 'departments') {
            renderDepartmentsView();
        }
        // Si el modal de transferencia está abierto, actualizar el select
        const transferSelect = document.getElementById('transfer-dept-select');
        if (transferSelect && !transferSelect.closest('.hidden')) {
            // Simple re-population logic
            transferSelect.innerHTML = '<option value="">-- Seleccionar Departamento --</option>' +
                state.departments.map(dept => `<option value="${dept.id}">${dept.name}</option>`).join('');
        }
    }, error => {
        console.error("Error al escuchar departamentos:", error);
        showError("No se pudieron cargar los departamentos.");
    });
}

// --- NUEVO LISTENER: Escucha cambios en las Reglas de Enrutamiento ---
function listenForAdRoutingRules() {
    if (unsubscribeAdRoutingRulesListener) unsubscribeAdRoutingRulesListener();
    unsubscribeAdRoutingRulesListener = db.collection('ad_routing_rules').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        // Actualiza estado global
        state.adRoutingRules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Re-renderizar vista si es la activa
        if (state.activeView === 'ad-routing') {
            renderAdRoutingView();
        }
    }, error => {
        console.error("Error al escuchar reglas de enrutamiento:", error);
        showError("No se pudieron cargar las reglas de enrutamiento.");
    });
}

// --- NUEVO: Listeners y fetchers para USUARIOS ---
let unsubscribeUsersListener = null;

/**
 * Obtiene la lista completa de usuarios una vez.
 */
async function fetchAllUsers() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/users`);
        const data = await response.json();
        if (data.success) {
            state.allUsers = data.users;
            console.log("All users loaded:", state.allUsers);
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error("Error fetching all users:", error);
        showError("No se pudieron cargar los usuarios del sistema.");
    }
}

/**
 * Escucha cambios en la colección de usuarios de Firestore.
 * Esto es útil para actualizar la UI si los roles o departamentos de un usuario cambian en otro lugar.
 */
function listenForUsers() {
    if (unsubscribeUsersListener) unsubscribeUsersListener();
    
    // Este listener es más simple, solo escucha la colección `users` de Firestore,
    // ya que los cambios en Firebase Auth (crear/borrar usuario) no disparan eventos aquí.
    // La lista principal se carga con fetchAllUsers que sí consulta Auth.
    unsubscribeUsersListener = db.collection('users').onSnapshot(snapshot => {
        const firestoreUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Actualizar la información de los usuarios en el estado `allUsers`
        if (state.allUsers.length > 0) {
            state.allUsers = state.allUsers.map(user => {
                const firestoreUser = firestoreUsers.find(fsUser => fsUser.email.toLowerCase() === user.email.toLowerCase());
                return { ...user, ...firestoreUser }; // Sobrescribe con los datos más recientes de Firestore
            });
        }
        
        // Si una vista que depende de los usuarios está activa, se podría re-renderizar.
        // Por ejemplo, si el modal de departamentos está abierto.
    }, error => {
        console.error("Error escuchando cambios de usuarios:", error);
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

// --- INICIO DE MODIFICACIÓN ---

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

/**
 * Obtiene el conteo de mensajes entrantes por Ad ID para un rango de fechas específico.
 * Llama al nuevo endpoint del backend.
 * @param {string} startDate Fecha de inicio en formato YYYY-MM-DD.
 * @param {string} endDate Fecha de fin en formato YYYY-MM-DD.
 * @returns {Promise<object>} Una promesa que resuelve con un objeto { adId1: count1, adId2: count2, ... }.
 */
async function fetchMessagesByAdIdMetrics(startDate, endDate) {
    try {
        // Construye la URL con los parámetros de fecha
        const url = `${API_BASE_URL}/api/metrics/messages-by-ad?startDate=${startDate}&endDate=${endDate}`;
        const response = await fetch(url);

        if (!response.ok) {
            // Si la respuesta no es OK, intenta obtener el mensaje de error del cuerpo
            let errorMessage = `Error del servidor (${response.status})`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.message || errorMessage;
            } catch (jsonError) {
                // Si el cuerpo no es JSON válido, usa el mensaje de estado
                console.error("No se pudo parsear el error JSON:", jsonError);
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();

        // Verifica si la respuesta del backend fue exitosa y devuelve los conteos
        if (data.success && typeof data.counts === 'object') {
            return data.counts;
        } else {
            // Si el backend devolvió success: false o falta 'counts'
            throw new Error(data.message || 'Respuesta inválida del servidor al obtener métricas por Ad ID.');
        }
    } catch (error) {
        // Captura errores de red o errores lanzados explícitamente
        console.error("Error fetching messages by Ad ID metrics:", error);
        // Lanza el error para que la función que llama (en ui-manager.js) pueda manejarlo
        throw error;
    }
}
// --- FIN DE MODIFICACIÓN ---

// --- START: Mark as Unread Logic ---
async function handleMarkAsUnread(event, contactId) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
        // Also try stopping immediate propagation if multiple listeners exist (unlikely here but safe)
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }

    try {
        // 1. Actualización optimista de la UI
        const contactIndex = state.contacts.findIndex(c => c.id === contactId);
        if (contactIndex > -1) {
            state.contacts[contactIndex].unreadCount = 1; // Forzar contador a 1 para mostrar badge
            // Actualizar timestamp localmente para reflejar el cambio de orden inmediato
            state.contacts[contactIndex].lastMessageTimestamp = new Date();
            handleSearchContacts(); // Re-renderizar la lista para mostrar el cambio
        }

        // 2. Actualizar en Firestore
        // IMPORTANTE: Actualizamos lastMessageTimestamp para que el listener en otros dispositivos
        // (que filtra por fecha > carga) detecte este cambio y actualice la UI.
        await db.collection('contacts_whatsapp').doc(contactId).update({
            unreadCount: 1,
            lastMessageTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Nota: Si el chat está actualmente abierto (seleccionado), permanecerá abierto pero la lista mostrará el badge.
        // Al hacer clic de nuevo en el chat de la lista o enviar un mensaje, se volverá a marcar como leído.

    } catch (error) {
        console.error("Error al marcar como no leído:", error);
        showError("No se pudo marcar como no leído.");
        // Revertir cambio optimista si falla
        const contactIndex = state.contacts.findIndex(c => c.id === contactId);
        if (contactIndex > -1) {
            state.contacts[contactIndex].unreadCount = 0;
            handleSearchContacts();
        }
    }
}
// --- END: Mark as Unread Logic ---
// --- NUEVO: Obtener perfil de usuario ---
async function fetchUserProfile(email) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/users/profile/${email}`);
        if (!response.ok) {
            if (response.status === 404) return null; // Usuario no encontrado
            throw new Error('Error al obtener perfil de usuario');
        }
        const result = await response.json();
        return result.user;
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return null;
    }
}

// Exportar la nueva función globalmente
window.handleMarkAsUnread = handleMarkAsUnread;
window.fetchUserProfile = fetchUserProfile;
