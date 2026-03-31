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
        const aiTs = contact.aiNextRun;
        if (aiTs) {
            if (typeof aiTs.toDate === 'function') {
                contact.aiNextRun = aiTs.toDate();
            } else if (typeof aiTs === 'object' && typeof aiTs._seconds === 'number') {
                contact.aiNextRun = new Date(aiTs._seconds * 1000);
            } else if (typeof aiTs === 'string' && !isNaN(Date.parse(aiTs))) {
                contact.aiNextRun = new Date(aiTs);
            }
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
        
        if (state.unreadOnly) {
            url += `&unreadOnly=true`;
        }
        
        // --- INICIO: Lógica de filtrado de departamento por perfil de usuario ---
        let departmentIdParam = null;
        const profile = state.currentUserProfile;

        // Si hay un filtro de departamento activo en la UI, este tiene prioridad.
        if (state.activeDepartmentFilter && state.activeDepartmentFilter !== 'all') {
            departmentIdParam = state.activeDepartmentFilter;
        }
        // Si no hay filtro activo, y el usuario NO es admin, se filtra por sus departamentos.
        else if (profile && profile.role !== 'admin') {
            if (profile.assignedDepartments && profile.assignedDepartments.length > 0) {
                // Unir los IDs de departamento del usuario en un string para la API.
                departmentIdParam = profile.assignedDepartments.join(',');
            } else {
                // Si el agente no tiene departamentos, no debe ver ningún chat departamental.
                // Se pasa un ID imposible de encontrar.
                departmentIdParam = 'none';
            }
        }
        // Nota: Para un admin sin filtro activo, departmentIdParam será null y verá todos los chats.

        // Añadir el parámetro de departamento a la URL si corresponde.
        if (departmentIdParam) {
            url += `&departmentId=${departmentIdParam}`;
        }
        // --- FIN: Lógica de filtrado de departamento ---

        // Realiza la petición a la API
        const response = await fetch(url);
        let data;
        try {
             data = await response.json();
        } catch (e) {
             throw new Error('Error de red o de servidor.');
        }

        if (!response.ok) {
            let errorMsg = data.message || 'Error al cargar contactos iniciales.';
            if (data.errorDetails) {
                 errorMsg += `\nDetalles: ${data.errorDetails}`;
                 console.error("Detalles del servidor:", data.errorDetails);
                 if (data.errorDetails.includes('requires an index')) {
                     alert("Se requiere crear un índice en Firebase para el filtro de No leídos.\nRevisa el enlace en la consola del navegador para crearlo con un clic.");
                     console.error("➡️ Enlace para crear el índice: ", data.errorDetails);
                 }
            }
            throw new Error(errorMsg);
        }

        // Procesa los timestamps y actualiza el estado
        state.contacts = processContacts(data.contacts);

        // Actualiza el estado de paginación
        state.pagination.lastVisibleId = data.lastVisibleId; // ID del último contacto para la siguiente página
        state.pagination.hasMore = data.contacts.length > 0 && data.lastVisibleId !== null; // Hay más si se devolvieron contactos y hay un ID para seguir

        // Renderiza la lista de contactos en la UI
        scheduleContactListRender();

        if (contactsLoadingEl) contactsLoadingEl.style.display = 'none'; // Ocultar carga
    } catch (error) {
        console.error(error);
        showError(error.message);
    }
}

/**
 * Obtiene el conteo total de chats pendientes de IA desde el servidor.
 * Respeta el perfil del usuario (departamentos asignados) para que el número sea veraz.
 */
async function fetchPendingAiCount() {
    try {
        let departmentIdParam = null;
        const profile = state.currentUserProfile;

        // Prioridad: 1. Filtro activo en UI. 2. Departamentos del usuario (si no es admin).
        if (state.activeDepartmentFilter && state.activeDepartmentFilter !== 'all') {
            departmentIdParam = state.activeDepartmentFilter;
        } else if (profile && profile.role !== 'admin') {
            if (profile.assignedDepartments && profile.assignedDepartments.length > 0) {
                departmentIdParam = profile.assignedDepartments.join(',');
            } else {
                departmentIdParam = 'none';
            }
        }

        let url = `${API_BASE_URL}/api/contacts/pending-ia-count`;
        if (departmentIdParam) {
            url += `?departmentId=${departmentIdParam}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await response.json();

        if (response.ok && data.success) {
            state.pendingAiCount = data.count; // Guardar en el estado global
            return data.count;
        }
        return 0;
    } catch (error) {
        console.error('Error fetching pending AI count:', error);
        return state.pendingAiCount || 0;
    }
}

/**
 * Inicia un listener en tiempo real para el conteo de chats pendientes de IA.
 * Esto permite que el badge se actualice automáticamente sin recargar, solucionando
 * la falta de reactividad.
 */
function listenForPendingAiCount() {
    if (unsubscribePendingAiCountListener) unsubscribePendingAiCountListener();
    
    const profile = state.currentUserProfile;
    // Consulta base: chats con estado 'pendientes_ia'
    let query = db.collection('contacts_whatsapp').where('status', '==', 'pendientes_ia');

    // Mantenemos la lógica de filtrado por departamentos para que el conteo sea veraz para el usuario
    if (state.activeDepartmentFilter && state.activeDepartmentFilter !== 'all') {
        query = query.where('assignedDepartmentId', '==', state.activeDepartmentFilter);
    } else if (profile && profile.role !== 'admin') {
        if (profile.assignedDepartments && profile.assignedDepartments.length > 0) {
            // Un agente solo ve el conteo de sus departamentos asignados (límite de 10 para Firestore 'in')
            query = query.where('assignedDepartmentId', 'in', profile.assignedDepartments.slice(0, 10));
        } else {
            // Si el agente no tiene departamentos asignados, el conteo debe ser 0
            query = query.where('assignedDepartmentId', '==', 'none');
        }
    }

    unsubscribePendingAiCountListener = query.onSnapshot(snapshot => {
        console.log(`[Real-time] Actualizando conteo de Pendientes IA: ${snapshot.size}`);
        state.pendingAiCount = snapshot.size;
        
        // Actualizar el contador en la UI cada vez que hay un cambio en Firestore
        if (typeof actualizarContadorPendientesIA === 'function') {
            actualizarContadorPendientesIA(snapshot.size);
        }
    }, error => {
        console.error("Error en real-time listener de conteo IA:", error);
    });
}


/**
 * Inicia un listener en tiempo real para el conteo de pedidos registrados HOY.
 * Esto permite que el badge del header se actualice automáticamente.
 */
function listenForDailyOrderCount() {
    if (unsubscribeDailyOrdersListener) unsubscribeDailyOrdersListener();

    // Obtener el inicio del día de hoy (medianoche)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Consulta: pedidos donde createdAt sea mayor o igual al inicio de hoy
    const q = db.collection('pedidos')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(todayStart));

    unsubscribeDailyOrdersListener = q.onSnapshot(snapshot => {
        const count = snapshot.size;
        console.log(`[Real-time] Actualizando conteo de Pedidos de Hoy: ${count}`);
        
        // Actualizar la UI
        if (typeof actualizarBadgePedidosHoy === 'function') {
            actualizarBadgePedidosHoy(count);
        }
    }, error => {
        console.error("Error en real-time listener de conteo de pedidos:", error);
    });
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

        // Construir URL con límite y 'startAfterId'
        let url = `${API_BASE_URL}/api/contacts?limit=30&startAfterId=${state.pagination.lastVisibleId}`;
        if (tag) {
            url += `&tag=${tag}`;
        }

        if (state.unreadOnly) {
            url += `&unreadOnly=true`;
        }
        
        // --- INICIO: Lógica de filtrado de departamento por perfil de usuario ---
        let departmentIdParam = null;
        const profile = state.currentUserProfile;

        // Si hay un filtro de departamento activo en la UI, este tiene prioridad.
        if (state.activeDepartmentFilter && state.activeDepartmentFilter !== 'all') {
            departmentIdParam = state.activeDepartmentFilter;
        }
        // Si no hay filtro activo, y el usuario NO es admin, se filtra por sus departamentos.
        else if (profile && profile.role !== 'admin') {
            if (profile.assignedDepartments && profile.assignedDepartments.length > 0) {
                // Unir los IDs de departamento del usuario en un string para la API.
                departmentIdParam = profile.assignedDepartments.join(',');
            } else {
                // Si el agente no tiene departamentos, no debe ver ningún chat departamental.
                // Se pasa un ID imposible de encontrar.
                departmentIdParam = 'none';
            }
        }
        // Nota: Para un admin sin filtro activo, departmentIdParam será null y verá todos los chats.

        // Añadir el parámetro de departamento a la URL si corresponde.
        if (departmentIdParam) {
            url += `&departmentId=${departmentIdParam}`;
        }
        // --- FIN: Lógica de filtrado de departamento ---

        // Realizar petición
        const response = await fetch(url);
        let data;
        try {
             data = await response.json();
        } catch (e) {
             throw new Error('Error de red al cargar más contactos.');
        }

        if (!response.ok) {
            let errorMsg = data.message || 'Error al cargar más contactos.';
            if (data.errorDetails) {
                 errorMsg += `\nDetalles: ${data.errorDetails}`;
                 console.error("Detalles del servidor:", data.errorDetails);
                 if (data.errorDetails.includes('requires an index')) {
                     alert("Se requiere crear un índice en Firebase para el filtro de No leídos.\nRevisa el enlace en la consola del navegador para crearlo.");
                     console.error("➡️ Enlace para crear el índice: ", data.errorDetails);
                 }
            }
            throw new Error(errorMsg);
        }

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
        scheduleContactListRender();
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
        scheduleContactListRender();
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

            // --- INICIO MODIFICACIÓN: Verificar filtro de departamento por perfil ---
            const profile = state.currentUserProfile;
            let isAllowed = false;

            // CORRECCIÓN CRÍTICA: Si el perfil aún no ha cargado (profile es null), asumimos que es permitido.
            // Esto evita que el contacto se borre de la lista mientras el perfil carga.
            if (!profile) {
                isAllowed = true; 
            } 
            // Si hay perfil y es admin, ve todo (o lo filtrado por UI)
            else if (profile.role === 'admin') {
                isAllowed = true;
                if (state.activeDepartmentFilter !== 'all' && updatedContactData.assignedDepartmentId !== state.activeDepartmentFilter) {
                    isAllowed = false;
                }
            } 
            // Si es agente normal
            else { 
                const userDepartments = new Set(profile.assignedDepartments || []);
                const chatDepartment = updatedContactData.assignedDepartmentId;
                // Es permitido si el chat no tiene departamento o si el usuario está asignado a ese departamento.
                if (!chatDepartment || userDepartments.has(chatDepartment)) {
                    isAllowed = true;
                }
            }

            // --- INICIO NUEVA VALIDACIÓN DE FILTROS (TAG Y NO LEÍDOS) ---
            if (isAllowed) {
                // Filtro de etiquetas (status)
                if (state.activeFilter !== 'all') {
                    if (updatedContactData.status !== state.activeFilter) {
                        isAllowed = false;
                    }
                }
                
                // Filtro de no leídos
                if (state.unreadOnly) {
                    if (!updatedContactData.unreadCount || updatedContactData.unreadCount <= 0) {
                        isAllowed = false;
                    }
                }
            }
            // --- FIN NUEVA VALIDACIÓN ---

            if (!isAllowed) {
                // Si no está permitido, lo eliminamos de la lista local y detenemos el procesamiento.
                const idx = state.contacts.findIndex(c => c.id === updatedContactData.id);
                if (idx > -1) {
                    state.contacts.splice(idx, 1);
                    scheduleContactListRender(); // Re-renderizar para que el cambio sea visible.
                }
                return; // No añadir ni actualizar este contacto.
            }
            // --- FIN MODIFICACIÓN ---

            // Buscar si el contacto ya existe en la lista local
            const existingContactIndex = state.contacts.findIndex(c => c.id === updatedContactData.id);

            // [NUEVO] Obtener el valor actual de la búsqueda
            const searchInput = document.getElementById('search-contacts-input');
            const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

            if (existingContactIndex > -1) {
                // Si existe, reemplazarlo con los datos actualizados
                state.contacts[existingContactIndex] = updatedContactData;
            } else {
                // Si es un contacto nuevo (o no estaba en la página actual)...
                
                let shouldAdd = true;

                // [NUEVO] Si hay una búsqueda activa, validamos si el contacto cumple el criterio
                if (searchTerm) {
                    const nameMatch = (updatedContactData.name || '').toLowerCase().includes(searchTerm);
                    const phoneMatch = (updatedContactData.id || '').includes(searchTerm);
                    const lowerNameMatch = (updatedContactData.name_lowercase || '').includes(searchTerm);
                    
                    // Si no coincide con nada, bloqueamos su adición
                    if (!nameMatch && !phoneMatch && !lowerNameMatch) {
                        shouldAdd = false;
                    }
                }

                // Solo añadimos si pasó el filtro (o si no hay filtro)
                if (shouldAdd) {
                    state.contacts.unshift(updatedContactData);
                }
            }
        });

        // Reordenar toda la lista por fecha del último mensaje (más reciente primero)
        state.contacts.sort((a, b) => (b.lastMessageTimestamp?.getTime() || 0) - (a.lastMessageTimestamp?.getTime() || 0));

        // Re-renderizar la lista de contactos
        scheduleContactListRender();

        // Si el contacto actualizado es el seleccionado, revisar si el timer de IA cambió
        if (snapshot.docChanges().some(change => change.doc.id === state.selectedContactId)) {
            if (window.checkAiTimer) window.checkAiTimer();
        }

    }, error => {
        // Manejo de errores del listener
        console.error("Error en el listener de actualizaciones de contactos:", error);
        // No mostrar error fatal, podría ser temporal
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
            scheduleContactListRender(); // Re-renderiza lista de contactos (para colores de icono)
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



// --- NUEVO LISTENER: Escucha cambios en los Departamentos ---
function listenForDepartments() {
    if (unsubscribeDepartmentsListener) unsubscribeDepartmentsListener();
    unsubscribeDepartmentsListener = db.collection('departments').orderBy('createdAt').onSnapshot(snapshot => {
        // Actualiza estado global
        state.departments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        state._deptColorMap = new Map(state.departments.map(d => [d.id, d.color]));
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

            // Mantener sincronizado el perfil actual para que ventanas ya abiertas
            // detecten instantáneamente si se les asignó/quitó un departamento.
            if (state.currentUserProfile && state.currentUserProfile.email) {
                const updatedProfile = state.allUsers.find(u => u.email === state.currentUserProfile.email);
                if (updatedProfile) {
                    const oldDepts = (state.currentUserProfile.assignedDepartments || []).sort().join(',');
                    const newDepts = (updatedProfile.assignedDepartments || []).sort().join(',');
                    
                    state.currentUserProfile = updatedProfile;
                    
                    if (oldDepts !== newDepts) {
                        console.log("Departamentos del usuario actualizados en tiempo real. Recargando contactos...");
                        // Si se agregó o quitó un departamento, necesitamos recargar los contactos iniciales
                        // para que se vean los mensajes antiguos del nuevo departamento.
                        if (state.activeView === 'chats' && typeof fetchInitialContacts === 'function') {
                            fetchInitialContacts();
                        }
                    }
                }
            }
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
    
    // Cuando se detecta un cambio en la colección de usuarios, simplemente volvemos a
    // cargar la lista completa. Es más simple y robusto que intentar parchear el estado.
    unsubscribeUsersListener = db.collection('users').onSnapshot(snapshot => {
        console.log("Firestore 'users' collection updated, refetching all users.");
        fetchAllUsers(); 
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
 * Borra todo el historial de mensajes de un contacto.
 * @param {string} contactId ID del contacto.
 * @returns {Promise<object>} El resultado de la operación.
 */
async function deleteContactMessagesAPI(contactId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/messages`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Error al borrar historial.');
        return data;
    } catch (error) {
        console.error('API Error (deleteContactMessages):', error);
        throw error;
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
            scheduleContactListRender(); // Re-renderizar la lista para mostrar el cambio
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
            scheduleContactListRender();
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
