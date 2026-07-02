// --- START: Event Handlers for the Chat View ---

// --- NUEVA LÓGICA DE BÚSQUEDA Y SCROLL ---

// Variable y función "debounce" para no sobrecargar el servidor con búsquedas
let searchTimeout;
function debounceSearch(query) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        searchContactsAPI(query);
    }, 300); // Espera 300ms después de que el usuario deja de escribir
}

// Nuevo manejador para el input de búsqueda que llama al debounce
function handleSearchInput(event) {
    const searchTerm = event.target.value;
    const clearButton = document.getElementById('clear-search-btn');
    if (clearButton) {
        clearButton.classList.toggle('hidden', searchTerm.length === 0);
    }
    debounceSearch(searchTerm.trim());
}


// --- Coalescencia de renders: múltiples mutaciones en el mismo tick = 1 solo render ---
let _renderScheduled = false;
function scheduleContactListRender() {
    if (_renderScheduled) return;
    _renderScheduled = true;
    queueMicrotask(() => {
        _renderScheduled = false;
        handleSearchContacts();
    });
}
window.scheduleContactListRender = scheduleContactListRender;

// CORREGIDO: Ahora aplica filtros de departamento y oculta el mensaje de "Cargando..."
function handleSearchContacts() {
    // --- INICIO DE LA MODIFICACIÓN: Filtro por Departamentos del Usuario ---
    let contactsToRender = state.contacts;
    
    const user = state.currentUserProfile; // Obtenido en auth.js al iniciar sesión
    
    // Aplicar filtro de seguridad si el usuario ya cargó y NO es admin
    if (user && user.role !== 'admin') {
        const userDepts = user.assignedDepartments || [];
        
        contactsToRender = contactsToRender.filter(contact => {
            const deptId = contact.assignedDepartmentId;

            // Regla 1: Si NO tiene ID de departamento, es visible para todos (es "Gris" nativo)
            if (!deptId) {
                return true;
            }

            // Regla 2: Si tiene ID, pero ese departamento YA NO EXISTE en el sistema,
            // se considera huérfano ("Gris" visualmente) y debe ser visible para todos.
            const deptExists = state._deptColorMap ? state._deptColorMap.has(deptId) : state.departments.some(d => d.id === deptId);
            if (!deptExists) {
                return true;
            }
            
            // Regla 3: Si tiene un departamento válido y existente, el usuario debe pertenecer a él
            return userDepts.includes(deptId);
        });
    }
    // --- FIN DE LA MODIFICACIÓN ---

    // --- NUEVO: Filtro de Departamento activo (selección en la UI) ---
    // Se aplica en CADA render para que los chats que llegan en tiempo real desde
    // OTRO departamento no se cuelen en la lista mientras hay un filtro activo.
    // Coincide con la semántica del filtro del servidor: where('assignedDepartmentId', '==', filtro).
    if (state.activeDepartmentFilter && state.activeDepartmentFilter !== 'all') {
        contactsToRender = contactsToRender.filter(c => c.assignedDepartmentId === state.activeDepartmentFilter);
    }

    // --- NUEVO: Filtros de Etiqueta y No Leídos (Reactividad Frontend) ---
    if (state.activeFilter && state.activeFilter !== 'all') {
        contactsToRender = contactsToRender.filter(c => c.status === state.activeFilter);
    }
    if (state.unreadOnly) {
        contactsToRender = contactsToRender.filter(c => c.unreadCount > 0);
    }
    if (state.purchaseFilter) {
        if (state.purchaseFilter === 'both') {
            contactsToRender = contactsToRender.filter(c => c.purchaseStatus === 'registered' || c.purchaseStatus === 'completed');
        } else {
            contactsToRender = contactsToRender.filter(c => c.purchaseStatus === state.purchaseFilter);
        }
    }
    if (state.designReviewFilter) {
        contactsToRender = contactsToRender.filter(c => c.inDesignReview === true);
    }
    if (Array.isArray(state.adIdFilters) && state.adIdFilters.length) {
        const selAds = new Set(state.adIdFilters);
        contactsToRender = contactsToRender.filter(c => Array.isArray(c.adSourceIds) && c.adSourceIds.some(id => selAds.has(id)));
    }
    // Siempre ordenar por fecha descendente antes de renderizar
    contactsToRender.sort((a, b) => (b.lastMessageTimestamp?.getTime() || 0) - (a.lastMessageTimestamp?.getTime() || 0));
    // --------------------------------------------------------------------

    const contactsLoadingEl = document.getElementById('contacts-loading'); // Obtener el elemento de carga
    const spacer = document.getElementById('contacts-scroll-spacer');

    if (spacer) {
        // Si no hay contactos para mostrar (después del filtro), mostrar mensaje vacío
        if (contactsToRender.length === 0 && state.contacts.length > 0) {
             spacer.style.height = '0px';
             spacer.innerHTML = `<div class="p-8 text-center text-gray-400 italic text-sm flex flex-col items-center">
                <i class="fas fa-inbox text-2xl mb-2 opacity-50"></i>
                <span>No tienes chats asignados en tus departamentos.</span>
             </div>`;
        } else {
             updateVirtualList(contactsToRender);
        }
    }

    // Ocultar el mensaje de "Cargando..." después de que la lista de contactos ha sido renderizada.
    if (contactsLoadingEl) {
        contactsLoadingEl.style.display = 'none'; if (typeof actualizarContadorPendientesIA === 'function') actualizarContadorPendientesIA();
    }
}

// Nueva función que configura el scroll infinito y el drag & drop
function setupChatListEventListeners() {
    const contactsList = document.getElementById('contacts-list');
    if (!contactsList) return;

    // Virtual Scroll (incluye infinite scroll internamente)
    initVirtualScroll();
    
    // Lógica de Drag & Drop para archivos en el pie de página del chat
    const chatFooter = document.querySelector('.chat-footer');
    const footerOverlay = document.getElementById('drag-drop-overlay-footer');
    
    const searchInput = document.getElementById('search-contacts-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');

    if (searchInput && clearSearchBtn) {
        searchInput.addEventListener('input', handleSearchInput);
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input')); 
            searchInput.focus();
        });

        clearSearchBtn.classList.toggle('hidden', searchInput.value.length === 0);
    }

    if (!chatFooter || !footerOverlay) return;

    const showOverlay = () => footerOverlay.classList.remove('hidden');
    const hideOverlay = () => footerOverlay.classList.add('hidden');

    // Usar un contador para manejar dragenter/dragleave sobre elementos hijos
    let dragCounter = 0;

    chatFooter.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            dragCounter++;
            showOverlay();
        }
    });

    chatFooter.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    chatFooter.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) {
            hideOverlay();
        }
    });

    chatFooter.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        hideOverlay();
        const files = e.dataTransfer.files;
        for (let i = 0; i < files.length; i++) {
            stageFile(files[i]);
        }
    });
}


// --- LÓGICA DE CHAT EXISTENTE (CON LIGEROS CAMBIOS) ---

// MODIFICADO: Aceptar opciones (como preserveScroll) para pasarlas a renderMessages
function renderChatWindow(options = {}) { 
    if (state.activeView !== 'chats') return;
    
    const chatPanelEl = document.getElementById('chat-panel');
    if (!chatPanelEl) return;

    const contact = state.contacts.find(c => c.id === state.selectedContactId); 
    chatPanelEl.innerHTML = ChatWindowTemplate(contact); 

    const searchInput = document.getElementById('search-contacts-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
    }
    
    if (contact) { 
        const statusWrapper = document.getElementById('contact-status-wrapper');
        if (statusWrapper) { statusWrapper.innerHTML = StatusButtonsTemplate(contact); }
        if (state.activeTab === 'chat') {
            // MODIFICADO: Pasar las opciones a renderMessages para que maneje el scroll correctamente
            renderMessages(options);
            
            const messagesContainer = document.getElementById('messages-container'); 
            if (messagesContainer) { 
                messagesContainer.addEventListener('scroll', () => { 
                    if (!ticking) { 
                        window.requestAnimationFrame(() => { 
                            handleScroll(); 
                            
                            // Lógica de Scroll Infinito para Mensajes
                            if (messagesContainer.scrollTop < 50) {
                                loadMoreMessages();
                            }
                            
                            ticking = false; 
                        }); 
                        ticking = true; 
                    } 
                }); 
            }
            
            // --- INICIO DE LA MODIFICACIÓN: Doble clic en el área del mensaje para responder ---
            const messagesContent = document.getElementById('messages-content');
            if (messagesContent) {
                messagesContent.addEventListener('dblclick', (e) => { // Cambiado a 'dblclick'
                    // Buscamos si el clic fue dentro de un grupo de mensajes (la fila entera)
                    const group = e.target.closest('.message-group');
                    if (!group) return;

                    // Si el clic fue DENTRO de la burbuja del mensaje o sus acciones, no hacemos nada
                    // (dejamos que sus propios eventos actúen, ej: copiar texto, ver imagen, etc.)
                    if (e.target.closest('.message-bubble')) return;

                    // Si llegamos aquí, el clic fue en el espacio vacío al lado de la burbuja
                    const messageDocId = group.dataset.docId;
                    if (messageDocId) {
                        // --- Corrección para evitar selección de texto ---
                        e.preventDefault();
                        if (window.getSelection) {
                            window.getSelection().removeAllRanges();
                        } else if (document.selection) {
                            document.selection.empty();
                        }
                        // -----------------------------------------------

                        handleStartReply(e, messageDocId);
                    }
                });

                // Click en la pre-vista de "respondiendo a..." → saltar al mensaje original
                messagesContent.addEventListener('click', (e) => {
                    const replyPreview = e.target.closest('.reply-preview');
                    if (!replyPreview) return;
                    const targetId = replyPreview.dataset.targetId;
                    if (!targetId) return;
                    e.stopPropagation();
                    const targetGroup = messagesContent.querySelector(`.message-group[data-msg-id="${CSS.escape(targetId)}"]`);
                    if (!targetGroup) return;
                    targetGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    const targetBubble = targetGroup.querySelector('.message-bubble');
                    if (!targetBubble) return;
                    // Esperar a que termine el scroll suave para que el highlight no se pierda en el movimiento
                    targetBubble.classList.remove('message-highlight');
                    setTimeout(() => {
                        // forzar reflow para reiniciar la animación si se clickea varias veces
                        void targetBubble.offsetWidth;
                        targetBubble.classList.add('message-highlight');
                        setTimeout(() => targetBubble.classList.remove('message-highlight'), 3800);
                    }, 450);
                });
            }
            // --- FIN DE LA MODIFICACIÓN ---

            const messageForm = document.getElementById('message-form');
            const messageInput = document.getElementById('message-input'); 
            if (messageForm) messageForm.addEventListener('submit', handleSendMessage); 
            if (messageInput) { 
                messageInput.addEventListener('paste', handlePaste);
                messageInput.addEventListener('input', handleQuickReplyInput);
                messageInput.addEventListener('keydown', handleMessageInputKeyDown);
                messageInput.addEventListener('input', handleSpellcheckInput); // autocorrector IA
                messageInput.addEventListener('contextmenu', handleSpellcheckContextMenu); // clic derecho: diccionario
                initSpellcheckDictionary(); // carga y sincroniza el diccionario compartido
                
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
        setupDragAndDropForChatArea(); // Llamada a la nueva función
        
        // --- NUEVO: Asegurar que el indicator de IA se evalúe tras cada render ---
        if (window.checkAiTimer) window.checkAiTimer();
    } 
}

/**
 * Configura los listeners de drag and drop para toda el área del chat.
 */
function setupDragAndDropForChatArea() {
    const chatPanel = document.getElementById('chat-panel');
    const chatOverlay = document.getElementById('drag-drop-overlay-chat');

    if (!chatPanel || !chatOverlay) return;
    
    let dragCounter = 0;

    const showOverlay = () => chatOverlay.classList.remove('hidden');
    const hideOverlay = () => chatOverlay.classList.add('hidden');

    chatPanel.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Solo mostrar overlay si se arrastran archivos
        if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            dragCounter++;
            showOverlay();
        }
    });

    chatPanel.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    chatPanel.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) {
            hideOverlay();
        }
    });

    chatPanel.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        hideOverlay();
        
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const messageInput = document.getElementById('message-input');
            if (messageInput && !messageInput.disabled) {
                for (let i = 0; i < files.length; i++) {
                    stageFile(files[i]);
                }
            }
        }
    });
}

async function handleSelectContact(contactId) { 
    if (state.campaignMode) return;
    
    cancelStagedFile(); 
    cancelReply();

    // Desuscribirse de los listeners del contacto anterior
    if (unsubscribeMessagesListener) unsubscribeMessagesListener(); 
    if (unsubscribeNotesListener) unsubscribeNotesListener();
    if (unsubscribeOrdersListener) {
        unsubscribeOrdersListener();
        unsubscribeOrdersListener = null;
    }

    // Actualizamos el contador de no leídos localmente para una respuesta de UI más rápida
    const contactIdx = state.contacts.findIndex(c => c.id === contactId);
    if (contactIdx > -1) {
        const contact = state.contacts[contactIdx];
        if (state.designReviewFilter) {
            // La diseñadora abre desde filtro de diseño → limpiar solo designUnreadCount
            contact.designUnreadCount = 0;
            db.collection('contacts_whatsapp').doc(contactId).update({ designUnreadCount: 0 }).catch(err => console.error("Error al resetear designUnreadCount:", err));
        } else {
            // Vista normal → limpiar solo unreadCount (designUnreadCount se mantiene para la diseñadora)
            contact.unreadCount = 0;
            db.collection('contacts_whatsapp').doc(contactId).update({ unreadCount: 0 }).catch(err => console.error("Error al resetear contador:", err));
        }
    } else {
        db.collection('contacts_whatsapp').doc(contactId).update({ unreadCount: 0 }).catch(err => console.error("Error al resetear contador:", err));
    }
    
    state.selectedContactId = contactId;
    state.loadingMessages = true;
    state.activeTab = 'chat';

    // Badge "pendiente" del seguimiento IA (no bloquea; pinta cuando llega)
    if (typeof fetchOrderPending === 'function') fetchOrderPending(contactId);
    // Badge de recordatorio programado a fecha futura (no bloquea; pinta cuando llega)
    if (typeof fetchReminder === 'function') fetchReminder(contactId);
    state.isEditingNote = null;
    state.notes = []; // LIMPIAR NOTAS al cambiar de contacto
    state.isSessionExpired = false; // Resetear al cambiar de contacto
    
    // Re-renderizamos la lista para que el contacto seleccionado se marque visualmente
    scheduleContactListRender();
    
    // En móviles, activamos la clase para mostrar el panel de mensajes
    const chatView = document.getElementById('chat-view');
    if (chatView) {
        chatView.classList.add('contact-selected');
    }
    // En mobile, escondemos el app-header global (WhatsApp-style)
    if (window.innerWidth <= 768) {
        document.body.classList.add('chat-open');
    }
    
    let isInitialMessageLoad = true;
    
    // Reset pagination state when selecting a new contact
    state.messagePagination.limit = 30;
    state.messagePagination.hasMore = true;
    state.messagePagination.isLoadingMore = false;

    // --- MODIFICADO: Query invertido con límite para paginación ---
    unsubscribeMessagesListener = db.collection('contacts_whatsapp')
        .doc(contactId)
        .collection('messages')
        .orderBy('timestamp', 'desc') // Ordenar del más nuevo al más viejo
        .limit(state.messagePagination.limit) // Limitar la cantidad inicial
        .onSnapshot((snapshot) => {
            hideError();
            
            // Si la cantidad de documentos que llegó es MÁS CHICA que el límite actual, significa que ya no hay más mensajes históricos en Firebase
            if (snapshot.docs.length < state.messagePagination.limit) {
                state.messagePagination.hasMore = false;
            }

            // Mapear y revertir para que cronológicamente el más viejo cargado quede arriba y el más nuevo quede abajo
            const newMessages = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() })).reverse();

            if (isInitialMessageLoad) {
                state.messages = newMessages;
            } else {
                snapshot.docChanges().forEach((change) => {
                    const changedMessage = { docId: change.doc.id, ...change.doc.data() };
                    const existingIndex = state.messages.findIndex(m => m.docId === change.doc.id);

                    if (change.type === "added") {
                        if (existingIndex === -1) {
                            // --- INICIO CORRECCIÓN: EVITAR DUPLICADOS VISUALES ---
                            if (changedMessage.from !== contactId) {
                                const tempIndex = state.messages.findIndex(m => 
                                    m.docId.startsWith('temp_') && 
                                    m.text === changedMessage.text
                                );
                                if (tempIndex > -1) {
                                    state.messages.splice(tempIndex, 1);
                                }
                            }
                            // --- FIN CORRECCIÓN ---
                            
                            // MODIFICACIÓN DE PAGINACIÓN:
                            // Insertar de manera que se mantenga el orden cronológico.
                            // findIndex busca el primer mensaje cuyo timestamp sea MAYOR al nuevo mensaje.
                            const insertIndex = state.messages.findIndex(m => {
                                if (!m.timestamp || !changedMessage.timestamp) return false;
                                return m.timestamp.seconds > changedMessage.timestamp.seconds;
                            });

                            if (insertIndex === -1) {
                                // Si no se encuentra ninguno mayor, es el mensaje más nuevo, va al final.
                                state.messages.push(changedMessage);
                            } else {
                                // De lo contrario, lo insertamos justo antes del mensaje mayor (antiguo cargado)
                                state.messages.splice(insertIndex, 0, changedMessage);
                            }
                        }
                    } else if (change.type === "modified") {
                        if (existingIndex > -1) {
                            state.messages[existingIndex] = changedMessage;
                        }
                    } else if (change.type === "removed") {
                        if (existingIndex > -1) {
                            state.messages.splice(existingIndex, 1);
                        }
                    }
                });
            }

            // Guardar estado previo para detectar cambios y decidir qué renderizar
            const wasExpired = state.isSessionExpired;

            // Messenger e Instagram no tienen ventana de 24h, nunca expira
            const selectedContact = state.contacts.find(c => c.id === contactId);
            if (selectedContact && (selectedContact.channel === 'messenger' || selectedContact.channel === 'instagram')) {
                state.isSessionExpired = false;
            } else {
                // Recalcular el estado de la sesión cada vez que llegan mensajes
                const lastUserMessage = state.messages.slice().reverse().find(m => m.from === contactId);
                if (lastUserMessage && lastUserMessage.timestamp) {
                    const hoursDiff = (new Date().getTime() - (lastUserMessage.timestamp.seconds * 1000)) / 3600000;
                    state.isSessionExpired = hoursDiff > 24;
                } else {
                    state.isSessionExpired = true;
                }
            }

            if (state.activeTab === 'chat') {
                // Si el estado de expiración cambió (o es la primera carga), re-renderizamos la ventana entera para actualizar el footer/banner
                if (isInitialMessageLoad || wasExpired !== state.isSessionExpired) {
                    renderChatWindow({ preserveScroll: !isInitialMessageLoad });
                } else {
                    renderMessages({ preserveScrollHeight: state.messagePagination.isLoadingMore });
                }
            }

            if (isInitialMessageLoad) {
                state.loadingMessages = false;
                isInitialMessageLoad = false;
            }

        }, (error) => {
            console.error(error);
            showError(`Error al cargar mensajes.`);
            state.loadingMessages = false;
            state.messages = [];
            if (state.activeTab === 'chat') renderMessages();
        });
    
    unsubscribeNotesListener = db.collection('contacts_whatsapp').doc(contactId).collection('notes').orderBy('timestamp', 'desc').onSnapshot( (snapshot) => { 
        state.notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); 
        if(state.selectedContactId === contactId && state.contactDetailsOpen) {
            renderSidebarNotes(); // Solo actualizar el sidebar ya que el tab de notas no existe
        }
    }, (error) => { 
        console.error(error); 
        showError('Error al cargar notas.'); 
        state.notes = []; 
        if(state.contactDetailsOpen) renderSidebarNotes();
    });
    
    // --- NUEVO: Listener para el documento del contacto seleccionado ---
    if (unsubscribeContactListener) unsubscribeContactListener();
    unsubscribeContactListener = db.collection('contacts_whatsapp').doc(contactId).onSnapshot((doc) => {
        if (doc.exists) {
            const updatedContact = processContacts([{ id: doc.id, ...doc.data() }])[0];
            const idx = state.contacts.findIndex(c => c.id === contactId);
            const wasMissing = idx === -1;
            if (idx > -1) {
                state.contacts[idx] = updatedContact;
            } else {
                state.contacts.unshift(updatedContact);
            }
            // Re-renderizar la lista para reflejar cambios (ej. corona plateada→zafiro)
            scheduleContactListRender();
            // Si el contacto NO estaba en la lista (ej. cliente viejo abierto desde la
            // vista Clientes), la ventana se pintó sin sus datos y se quedó en "Selecciona
            // un chat". Ahora que ya tenemos el contacto, re-renderizamos la ventana para
            // que abra la conversación correctamente.
            if (wasMissing && state.selectedContactId === contactId) {
                renderChatWindow();
            }
            // Si el timer cambió o se activó, actualizarlo en la UI
            if (window.checkAiTimer) window.checkAiTimer();
        }
    });

    renderChatWindow();
    
    // Solo abrir detalles automáticamente en escritorio
    if (window.innerWidth > 768) {
        openContactDetails();
    }
    
    // Nueva llamada para verificar si hay un timer de IA activo
    if (window.checkAiTimer) window.checkAiTimer();
}

/**
 * Carga más mensajes antiguos utilizando la función handleSelectContact actualizando el límite.
 */
function loadMoreMessages() {
    if (!state.messagePagination.hasMore || state.messagePagination.isLoadingMore || !state.selectedContactId) return;

    state.messagePagination.isLoadingMore = true;
    
    // Mostramos un breve indicador de carga arriba en la vista del chat
    const messagesContent = document.getElementById('messages-content');
    if (messagesContent) {
        const loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'pagination-loading';
        loadingIndicator.className = 'text-center py-2 text-sm text-gray-500';
        loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Cargando mensajes anteriores...';
        messagesContent.insertAdjacentElement('afterbegin', loadingIndicator);
    }
    
    // Aumentamos el límite de mensajes que solicitamos
    state.messagePagination.limit += 30;

    // Al reemplazar el listener, Firestore inteligentemente reutilizará la caché local, 
    // e irá a buscar solo los documentos antiguos adicionales de acuerdo al nuevo límite.
    if (unsubscribeMessagesListener) {
        unsubscribeMessagesListener();
    }

    const contactId = state.selectedContactId;
    let isInitialLoad = true;
    unsubscribeMessagesListener = db.collection('contacts_whatsapp')
        .doc(contactId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(state.messagePagination.limit)
        .onSnapshot((snapshot) => {
            hideError();
            
            // Evaluar si realmente hay más historial disponible
            if (snapshot.docs.length < state.messagePagination.limit) {
                state.messagePagination.hasMore = false;
            }

            const newMessages = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() })).reverse();
            
            // Si es la primera vez que responde este nuevo limite
            if (isInitialLoad) {
                state.messages = newMessages; 
                state.messagePagination.isLoadingMore = false;
                
                // Mantenemos la posición para que no salte el scroll
                if (state.activeTab === 'chat') {
                    renderMessages({ preserveScrollHeight: true });
                }
                isInitialLoad = false;
            } else {
                // Manejar cambios que ocurran en adelante con el mismo bloque de onSnapshot docChanges anterior
                snapshot.docChanges().forEach((change) => {
                    const changedMessage = { docId: change.doc.id, ...change.doc.data() };
                    const existingIndex = state.messages.findIndex(m => m.docId === change.doc.id);

                    if (change.type === "added") {
                        if (existingIndex === -1) {
                            if (changedMessage.from !== contactId) {
                                const tempIndex = state.messages.findIndex(m => 
                                    m.docId.startsWith('temp_') && 
                                    m.text === changedMessage.text
                                );
                                if (tempIndex > -1) {
                                    state.messages.splice(tempIndex, 1);
                                }
                            }
                            
                            const insertIndex = state.messages.findIndex(m => {
                                if (!m.timestamp || !changedMessage.timestamp) return false;
                                return m.timestamp.seconds > changedMessage.timestamp.seconds;
                            });

                            if (insertIndex === -1) {
                                state.messages.push(changedMessage);
                            } else {
                                state.messages.splice(insertIndex, 0, changedMessage);
                            }
                        }
                    } else if (change.type === "modified") {
                        if (existingIndex > -1) {
                            state.messages[existingIndex] = changedMessage;
                        }
                    } else if (change.type === "removed") {
                        if (existingIndex > -1) {
                            state.messages.splice(existingIndex, 1);
                        }
                    }
                });
                
                if (state.activeTab === 'chat') {
                    // Si entraron mensajes en vivo mientras paginabamos, no forzamos scroll hasta el bottom 
                    // a menos que ya estuvieramos ahí (lo decide UI-manager)
                    renderMessages({ preserveScrollHeight: state.messagePagination.isLoadingMore });
                }
            }
            
            const wasExpired = state.isSessionExpired;
            const selectedContactPag = state.contacts.find(c => c.id === contactId);
            if (selectedContactPag && (selectedContactPag.channel === 'messenger' || selectedContactPag.channel === 'instagram')) {
                state.isSessionExpired = false;
            } else {
                const lastUserMessage = state.messages.slice().reverse().find(m => m.from === contactId);
                if (lastUserMessage && lastUserMessage.timestamp) {
                    const hoursDiff = (new Date().getTime() - (lastUserMessage.timestamp.seconds * 1000)) / 3600000;
                    state.isSessionExpired = hoursDiff > 24;
                } else {
                    state.isSessionExpired = true;
                }
            }

            // Si al cargar más mensajes descubrimos que la sesión cambió de estado (poco probable pero posible), re-renderizamos
            if (state.activeTab === 'chat' && wasExpired !== state.isSessionExpired) {
                renderChatWindow({ preserveScroll: true });
            }

        }, (error) => {
            console.error(error);
            showError(`Error al cargar mensajes históricos.`);
            state.messagePagination.isLoadingMore = false;
             // Quitar el indicador de carga si falló
            const indicator = document.getElementById('pagination-loading');
            if (indicator) indicator.remove();
        });
}

// --- NUEVA LÓGICA DE COLA DE MENSAJES ---

/**
 * Procesa la cola de mensajes secuencialmente (FIFO).
 */
async function processMessageQueue() {
    if (state.isProcessingQueue) return; // Si ya se está procesando, no hacer nada
    state.isProcessingQueue = true;

    while (state.messageQueue.length > 0) {
        const task = state.messageQueue[0]; // Obtener el primer mensaje de la cola (sin sacarlo aún)
        
        try {
            if (task.type === 'file') {
                // Enviar archivo
                await uploadAndSendFile(task.file, task.text, task.isExpired, task.contactId, task.replyTo, task.scheduleAt, task.tempId);
            } else {
                // Enviar texto o archivo remoto (o programarlo si el modo está activo)
                if (!task.isExpired && !task.scheduleAt) {
                    await db.collection('contacts_whatsapp').doc(task.contactId).update({ unreadCount: 0 });
                }

                const endpoint = task.scheduleAt ? 'schedule-message' : (task.isExpired ? 'queue-message' : 'messages');
                const messageData = { text: task.text, tempId: task.tempId };
                if (task.scheduleAt) messageData.scheduledAt = task.scheduleAt;

                if (task.remoteFile) {
                    messageData.fileUrl = task.remoteFile.url;
                    messageData.fileType = task.remoteFile.type;
                }
                if (task.replyTo) {
                    messageData.reply_to_wamid = task.replyTo.id;
                }

                const response = await fetch(`${API_BASE_URL}/api/contacts/${task.contactId}/${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(messageData)
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Error del servidor.');
                }
            }
        } catch (error) {
            console.error("Error al procesar mensaje de la cola:", error);
            showError(error.message);
            // Marcar mensaje como fallido en la UI
            if (state.selectedContactId === task.contactId) {
                const failedMessageIndex = state.messages.findIndex(m => m.docId === task.tempId);
                if (failedMessageIndex > -1) {
                    state.messages[failedMessageIndex].status = 'failed';
                    renderMessages();
                }
            }
        } finally {
            state.messageQueue.shift(); // Eliminar el mensaje procesado de la cola
        }
    }
    
    state.isProcessingQueue = false;
}

// --- FIN NUEVA LÓGICA ---

// =====================================================================
// === PROGRAMAR ENVÍO DE MENSAJES (modo programado por conversación) ===
// =====================================================================

let scheduleFp = null; // instancia de flatpickr del modal de programación

// Inicializa (una sola vez) el selector de fecha/hora flatpickr en formato 24h.
function ensureScheduleFlatpickr() {
    if (scheduleFp || typeof flatpickr === 'undefined') return;
    const input = document.getElementById('schedule-datetime');
    const container = document.getElementById('schedule-cal');
    if (!input || !container) return;
    const esLocale = (flatpickr.l10ns && flatpickr.l10ns.es) ? flatpickr.l10ns.es : undefined;
    scheduleFp = flatpickr(input, {
        inline: true,
        appendTo: container,
        enableTime: true,
        time_24hr: true,
        minuteIncrement: 1,
        minDate: 'today',
        dateFormat: 'Y-m-d H:i',
        locale: esLocale,
        defaultDate: new Date(),
        onChange: function () { updateScheduleSummary(); }
    });
}

// Re-renderiza el chat preservando lo que el operador tenga escrito en el input.
function rerenderChatPreservingInput() {
    const input = document.getElementById('message-input');
    const val = input ? input.value : '';
    renderChatWindow({ preserveScroll: true });
    const newInput = document.getElementById('message-input');
    if (newInput && val) {
        newInput.value = val;
        newInput.style.height = 'auto';
        newInput.style.height = newInput.scrollHeight + 'px';
    }
}

// Clic en el botón ⏰: si el modo ya está activo lo desactiva; si no, abre el modal.
function toggleScheduleMode() {
    const contactId = state.selectedContactId;
    if (!contactId) return;
    const info = state.scheduleByContact[contactId];
    const active = info && info.scheduledAt && info.scheduledAt > Date.now();
    if (active) {
        cancelScheduleMode();
    } else {
        openScheduleModal();
    }
}

function openScheduleModal() {
    const contactId = state.selectedContactId;
    if (!contactId) return;
    const modal = document.getElementById('schedule-modal');
    if (!modal) return;
    const idInput = document.getElementById('schedule-contact-id');
    if (idInput) idInput.value = contactId;

    // Valor inicial: la hora ya configurada (si sigue futura) o la hora ACTUAL.
    const info = state.scheduleByContact[contactId];
    const base = (info && info.scheduledAt && info.scheduledAt > Date.now()) ? new Date(info.scheduledAt) : new Date();

    document.querySelectorAll('#schedule-presets .schedule-preset-btn.active').forEach(b => b.classList.remove('active'));
    modal.classList.remove('hidden'); // mostrar antes de inicializar para que el calendario tenga dimensiones
    ensureScheduleFlatpickr();
    if (scheduleFp) {
        scheduleFp.setDate(base, false);
        scheduleFp.redraw();
    }
    updateScheduleSummary();
}

function closeScheduleModal() {
    const modal = document.getElementById('schedule-modal');
    if (modal) modal.classList.add('hidden');
}

// Presets de cuenta atrás: calculan la hora objetivo y llenan el datetime-local.
function applySchedulePreset(kind, btn) {
    let target;
    if (kind === 'tomorrow9') {
        target = new Date();
        target.setDate(target.getDate() + 1);
        target.setHours(9, 0, 0, 0);
    } else {
        target = new Date(Date.now() + Number(kind) * 60000);
    }
    ensureScheduleFlatpickr();
    if (scheduleFp) scheduleFp.setDate(target, false);
    document.querySelectorAll('#schedule-presets .schedule-preset-btn').forEach(b => b.classList.remove('active'));
    if (btn && btn.classList) btn.classList.add('active');
    updateScheduleSummary();
}

function updateScheduleSummary() {
    const summary = document.getElementById('schedule-summary');
    const confirmBtn = document.getElementById('schedule-confirm-btn');
    if (!summary) return;
    const date = scheduleFp && scheduleFp.selectedDates && scheduleFp.selectedDates[0];
    if (!date) {
        summary.classList.add('hidden');
        if (confirmBtn) confirmBtn.disabled = false;
        return;
    }
    const ms = date.getTime();
    summary.classList.remove('hidden');
    if (!ms || ms <= Date.now()) {
        summary.classList.add('error');
        summary.textContent = 'Elige una hora futura.';
        if (confirmBtn) confirmBtn.disabled = true;
        return;
    }
    summary.classList.remove('error');
    const diffMin = Math.round((ms - Date.now()) / 60000);
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    const rel = h > 0 ? `${h} h${m ? ' ' + m + ' min' : ''}` : `${m} min`;
    summary.textContent = `Se enviarán ${formatScheduleLabel(ms)} (en ${rel}).`;
    if (confirmBtn) confirmBtn.disabled = false;
}

function confirmSchedule() {
    const contactId = (document.getElementById('schedule-contact-id') || {}).value || state.selectedContactId;
    const date = scheduleFp && scheduleFp.selectedDates && scheduleFp.selectedDates[0];
    if (!contactId || !date) { showError('Elige una fecha y hora.'); return; }
    const ms = date.getTime();
    if (!ms || ms <= Date.now()) { showError('La hora programada debe ser futura.'); return; }
    state.scheduleByContact[contactId] = { scheduledAt: ms };
    closeScheduleModal();
    if (state.selectedContactId === contactId) rerenderChatPreservingInput();
}

// Desactiva el modo programado para el chat actual (los mensajes ya programados siguen en cola).
function cancelScheduleMode() {
    const contactId = state.selectedContactId;
    if (!contactId) return;
    delete state.scheduleByContact[contactId];
    rerenderChatPreservingInput();
}

// Cancela un mensaje individual ya programado (borra el doc de Firestore).
async function cancelScheduledMessage(messageId) {
    const contactId = state.selectedContactId;
    if (!contactId || !messageId) return;
    if (!window.confirm('¿Cancelar este mensaje programado?')) return;
    try {
        await db.collection('contacts_whatsapp').doc(contactId).collection('messages').doc(messageId).delete();
        const idx = state.messages.findIndex(m => m.docId === messageId);
        if (idx > -1) {
            state.messages.splice(idx, 1);
            renderMessages();
        }
    } catch (e) {
        console.error('Error al cancelar mensaje programado:', e);
        if (window.showError) showError('No se pudo cancelar el mensaje programado.');
    }
}

window.toggleScheduleMode = toggleScheduleMode;
window.openScheduleModal = openScheduleModal;
window.closeScheduleModal = closeScheduleModal;
window.applySchedulePreset = applySchedulePreset;
window.updateScheduleSummary = updateScheduleSummary;
window.confirmSchedule = confirmSchedule;
window.cancelScheduleMode = cancelScheduleMode;
window.cancelScheduledMessage = cancelScheduledMessage;

// =================================================================
// AUTOCORRECTOR ORTOGRÁFICO CON CONTEXTO (IA) — dos capas para que sea INSTANTÁNEO
//   1) LOCAL (sin red): al escribir un espacio/puntuación se corrige al momento la
//      palabra que acabas de terminar, usando un diccionario de errores y acentos
//      comunes 100% seguros. Cero espera -> se siente "en cuanto escribes la palabra".
//   2) IA (con contexto): en segundo plano, con debounce corto, pule lo que el
//      diccionario no cubre (acentos ambiguos por contexto, etc.).
// Ambas capas preservan el historial de deshacer (Ctrl+Z) y solo reemplazan el
// fragmento que realmente cambió, sin mover el cursor de donde estás escribiendo.
// =================================================================
const _spellcheck = { timer: null, abort: null, lastText: '', applying: false, toastTimer: null,
    custom: { corrections: {}, ignores: {} }, dictReady: false, menuEl: null };
const SPELLCHECK_DEBOUNCE_MS = 300; // antes 1000: la sensación de "lento" venía de aquí

// Diccionario LOCAL de correcciones seguras (clave siempre en minúsculas, sin ambigüedad
// de contexto). Los acentos que dependen del contexto (mas/más, esta/está, el/él, si/sí,
// tu/tú, se/sé, aun/aún, solo/sólo...) NO van aquí: los resuelve la capa de IA.
const SPELLCHECK_LOCAL = {
    // --- typos de dedo / abreviaturas / fonéticos ---
    'qeu': 'que', 'euq': 'que', 'quee': 'que', 'qe': 'que', 'ke': 'que',
    'porqe': 'porque', 'porke': 'porque', 'xq': 'porque', 'xk': 'porque', 'pq': 'porque',
    'kiero': 'quiero', 'kieres': 'quieres', 'kiere': 'quiere', 'keria': 'quería', 'kisiera': 'quisiera',
    'ase': 'hace', 'asen': 'hacen', 'aser': 'hacer', 'aciendo': 'haciendo', 'aria': 'haría',
    'iso': 'hizo', 'izo': 'hizo', 'ise': 'hice', 'isimos': 'hicimos',
    'boi': 'voy', 'voi': 'voy', 'bamos': 'vamos', 'balla': 'vaya',
    'aki': 'aquí', 'aqi': 'aquí', 'akí': 'aquí',
    'tmb': 'también', 'tb': 'también', 'tambn': 'también', 'tambien': 'también',
    'xfa': 'por favor', 'xfavor': 'por favor', 'porfa': 'por favor', 'porfavor': 'por favor',
    'pofavor': 'por favor', 'porfabor': 'por favor', 'porfvor': 'por favor',
    'grasias': 'gracias', 'grax': 'gracias', 'gracas': 'gracias', 'graciad': 'gracias',
    'aora': 'ahora', 'aorita': 'ahorita', 'orita': 'ahorita', 'ahi': 'ahí',
    'dnd': 'dónde', 'cmo': 'cómo', 'komo': 'como', 'muxo': 'mucho', 'muxos': 'muchos', 'muxa': 'mucha',
    'nesesito': 'necesito', 'nececito': 'necesito', 'nesecito': 'necesito',
    // --- acentos inequívocos frecuentes en atención a clientes ---
    'informacion': 'información', 'direccion': 'dirección', 'atencion': 'atención',
    'opcion': 'opción', 'promocion': 'promoción', 'confirmacion': 'confirmación',
    'aplicacion': 'aplicación', 'ubicacion': 'ubicación', 'devolucion': 'devolución',
    'telefono': 'teléfono', 'numero': 'número', 'codigo': 'código', 'articulo': 'artículo',
    'pagina': 'página', 'categoria': 'categoría', 'garantia': 'garantía', 'envio': 'envío',
    'credito': 'crédito', 'rapido': 'rápido', 'rapida': 'rápida', 'economico': 'económico',
    'minimo': 'mínimo', 'maximo': 'máximo', 'proximo': 'próximo', 'proxima': 'próxima',
    'ultimo': 'último', 'ultima': 'última', 'unico': 'único', 'unica': 'única',
    'facil': 'fácil', 'dificil': 'difícil', 'dolar': 'dólar', 'dolares': 'dólares',
    'metodo': 'método', 'tambien': 'también', 'despues': 'después', 'ademas': 'además',
    'adios': 'adiós', 'quiza': 'quizá', 'jamas': 'jamás', 'atras': 'atrás', 'detras': 'detrás',
    'alli': 'allí', 'alla': 'allá', 'aca': 'acá', 'asi': 'así',
    'estan': 'están', 'tenia': 'tenía', 'tenias': 'tenías', 'tenian': 'tenían',
    'habia': 'había', 'habian': 'habían', 'queria': 'quería', 'querias': 'querías',
    'podria': 'podría', 'podrian': 'podrían', 'gustaria': 'gustaría', 'encantaria': 'encantaría',
    'haria': 'haría', 'deberia': 'debería', 'tendria': 'tendría', 'estaria': 'estaría',
    'dia': 'día', 'dias': 'días', 'ningun': 'ningún', 'algun': 'algún', 'pense': 'pensé',
    // --- palabras juntas -> separadas ---
    'aveces': 'a veces', 'osea': 'o sea', 'enserio': 'en serio', 'porcierto': 'por cierto',
    'talvez': 'tal vez', 'almenos': 'al menos', 'deacuerdo': 'de acuerdo',
    'porsupuesto': 'por supuesto', 'asique': 'así que', 'sinembargo': 'sin embargo',
    'apartir': 'a partir', 'atravez': 'a través', 'através': 'a través', 'encuanto': 'en cuanto'
};

function isSpellcheckEnabled() {
    return localStorage.getItem('crm_spellcheck_enabled') !== '0'; // ON por defecto
}

function toggleSpellcheck() {
    const nowEnabled = !isSpellcheckEnabled();
    localStorage.setItem('crm_spellcheck_enabled', nowEnabled ? '1' : '0');
    const btn = document.getElementById('spellcheck-toggle-btn');
    if (btn) btn.classList.toggle('spellcheck-active', nowEnabled);
    if (!nowEnabled && _spellcheck.timer) { clearTimeout(_spellcheck.timer); _spellcheck.timer = null; }
    showSpellcheckToast(nowEnabled ? 'Autocorrector activado' : 'Autocorrector desactivado');
}
window.toggleSpellcheck = toggleSpellcheck;

// Un carácter separa palabras (espacios, saltos y signos de puntuación/apertura).
function _isSpellSep(c) { return c === undefined || /[\s.,;:!?()\[\]{}"'«»¡¿…]/.test(c); }

// ¿El input que acaba de ocurrir "cerró" una palabra? (escribió espacio/puntuación/enter)
function _closedWord(event) {
    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') return true;
    const d = event.data;
    return typeof d === 'string' && d.length === 1 && _isSpellSep(d);
}
// ¿Terminó una frase? (para pedirle a la IA de inmediato, sin esperar el debounce)
function _endedSentence(event) {
    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') return true;
    return event.data === '.' || event.data === '?' || event.data === '!';
}

// Ajusta may/minúsculas de la corrección para que coincida con cómo escribió el usuario.
function _matchCase(original, corrected) {
    if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) {
        return corrected.toUpperCase();
    }
    if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
        return corrected.charAt(0).toUpperCase() + corrected.slice(1);
    }
    return corrected;
}

// Busca una palabra en el diccionario; devuelve la corrección o null.
// Prioridad: 1) palabras marcadas como válidas (no corregir) -> null
//            2) correcciones personalizadas del diccionario compartido
//            3) diccionario base local
function _lookupLocal(word) {
    if (!word || word.length < 2) return null;
    if (/[0-9@#/\\_·]/.test(word)) return null;          // códigos, @menciones, links: no tocar
    const lower = word.toLowerCase();
    const custom = _spellcheck.custom || { corrections: {}, ignores: {} };
    if (custom.ignores && custom.ignores[lower]) return null; // marcada como válida por un agente
    const fix = (custom.corrections && custom.corrections[lower]) || SPELLCHECK_LOCAL[lower];
    if (!fix) return null;
    const cased = _matchCase(word, fix);
    return cased === word ? null : cased;
}

// Reemplaza input.value[start..end) por `replacement` preservando el deshacer (Ctrl+Z)
// y dejando el cursor en `newCursorPos`. Solo toca ese fragmento, no todo el texto.
function _replaceRangeUndoable(input, start, end, replacement, newCursorPos) {
    _spellcheck.applying = true;
    try {
        input.focus();
        input.setSelectionRange(start, end);
        let ok = false;
        try { ok = document.execCommand && document.execCommand('insertText', false, replacement); } catch (_) { ok = false; }
        if (!ok) input.value = input.value.slice(0, start) + replacement + input.value.slice(end);
        if (typeof newCursorPos === 'number') {
            const p = Math.max(0, Math.min(newCursorPos, input.value.length));
            input.setSelectionRange(p, p);
        }
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    } finally {
        setTimeout(() => { _spellcheck.applying = false; }, 0);
    }
}

// CAPA 1 (instantánea): corrige la palabra que quedó justo antes del separador recién escrito.
function applyLocalSpellcheck(input) {
    if (input.selectionStart !== input.selectionEnd) return;
    const pos = input.selectionStart;          // el separador recién escrito está en pos-1
    const value = input.value;
    const wordEnd = pos - 1;                    // la palabra termina aquí (exclusivo)
    if (wordEnd < 1) return;
    if (!_isSpellSep(value[wordEnd])) return;   // por seguridad: el char en pos-1 debe ser separador
    let start = wordEnd;
    while (start > 0 && !_isSpellSep(value[start - 1])) start--;
    if (start >= wordEnd) return;               // no había palabra
    const word = value.slice(start, wordEnd);
    const fix = _lookupLocal(word);
    if (!fix) return;
    _replaceRangeUndoable(input, start, wordEnd, fix, pos + (fix.length - word.length));
}

function handleSpellcheckInput(event) {
    if (!isSpellcheckEnabled()) return;
    if (_spellcheck.applying) return; // ignorar el input que generamos nosotros al aplicar
    const input = event.target;
    // 1) Corrección local instantánea al cerrar una palabra (sin red)
    if (_closedWord(event)) applyLocalSpellcheck(input);
    // 2) Revisión con IA (contexto) en segundo plano, con debounce corto
    if (_spellcheck.timer) clearTimeout(_spellcheck.timer);
    if (_spellcheck.abort) { _spellcheck.abort.abort(); _spellcheck.abort = null; }
    const delay = _endedSentence(event) ? 0 : SPELLCHECK_DEBOUNCE_MS;
    _spellcheck.timer = setTimeout(() => runSpellcheck(input), delay);
}

async function runSpellcheck(input) {
    _spellcheck.timer = null;
    if (!isSpellcheckEnabled() || !input || input.disabled) return;
    if (document.activeElement !== input) return; // solo mientras el cuadro tiene foco
    const cursorAtEnd = () => input.selectionStart === input.value.length && input.selectionStart === input.selectionEnd;
    if (!cursorAtEnd()) return; // estás editando en medio: no tocar

    const text = input.value;
    const trimmed = text.trim();
    if (trimmed.length < 6 || !/\s/.test(trimmed)) return; // muy corto / una sola palabra
    if (text === _spellcheck.lastText) return;             // ya revisado este texto

    // Palabras marcadas como válidas que aparecen en el texto: la IA no debe tocarlas.
    const lowerText = text.toLowerCase();
    const protect = Object.keys((_spellcheck.custom && _spellcheck.custom.ignores) || {})
        .filter(w => lowerText.includes(w));

    _spellcheck.abort = new AbortController();
    let corrected;
    try {
        const res = await fetch(`${API_BASE_URL}/api/spellcheck`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, protect }),
            signal: _spellcheck.abort.signal
        });
        if (!res.ok) return;
        const data = await res.json();
        corrected = data && data.corrected;
    } catch (err) {
        return; // abortado o error de red: silencioso, nunca estorbar al usuario
    } finally {
        _spellcheck.abort = null;
    }

    _spellcheck.lastText = text; // marcado como revisado pase lo que pase
    if (typeof corrected !== 'string' || corrected === text) return;
    if (input.value !== text || !cursorAtEnd()) return; // el usuario siguió escribiendo: descartar

    applySpellcheckCorrection(input, corrected);
}

// CAPA 2 (IA): aplica solo el fragmento que difiere (prefijo/sufijo común) para que
// el cambio sea mínimo, el cursor no salte y Ctrl+Z revierta solo lo corregido.
function applySpellcheckCorrection(input, corrected) {
    const before = input.value;
    if (before === corrected) return;
    let s = 0;
    const minLen = Math.min(before.length, corrected.length);
    while (s < minLen && before[s] === corrected[s]) s++;
    let e1 = before.length, e2 = corrected.length;
    while (e1 > s && e2 > s && before[e1 - 1] === corrected[e2 - 1]) { e1--; e2--; }
    const replacement = corrected.slice(s, e2);
    const cursor = input.selectionStart;
    let newCursor;
    if (cursor <= s) newCursor = cursor;
    else if (cursor >= e1) newCursor = cursor + (e2 - e1); // desplazar por el delta de longitud
    else newCursor = s + replacement.length;
    _spellcheck.lastText = corrected; // no volver a corregir lo ya corregido
    _replaceRangeUndoable(input, s, e1, replacement, newCursor);
}

// Aviso discreto (solo se usa al prender/apagar el autocorrector; las correcciones
// automáticas no muestran aviso para no estorbar el ritmo de escritura).
function showSpellcheckToast(message) {
    let toast = document.getElementById('spellcheck-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'spellcheck-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fas fa-spell-check"></i><span></span>`;
    toast.querySelector('span').textContent = message;
    toast.classList.add('show');
    if (_spellcheck.toastTimer) clearTimeout(_spellcheck.toastTimer);
    _spellcheck.toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 2500);
}

// =================================================================
// DICCIONARIO COMPARTIDO (clic derecho para enseñarle al autocorrector)
// Se guarda en crm_settings/spellcheck_dictionary y se sincroniza en vivo entre
// todos los agentes. Clic derecho sobre una palabra del cuadro de mensaje permite:
//   • Agregar al diccionario  -> marcarla como válida (el corrector no la toca)
//   • Crear corrección X→Y     -> reemplazo personalizado de la marca
// =================================================================

// Carga el diccionario compartido y lo mantiene sincronizado (tiempo real vía Firestore,
// con respaldo por HTTP si onSnapshot no está disponible).
function initSpellcheckDictionary() {
    if (_spellcheck.dictReady) return;
    _spellcheck.dictReady = true;
    const apply = (data) => {
        _spellcheck.custom = {
            corrections: (data && data.corrections) || {},
            ignores: (data && data.ignores) || {}
        };
    };
    const httpFallback = () => {
        fetch(`${API_BASE_URL}/api/spellcheck/dictionary`)
            .then(r => r.json()).then(d => { if (d && d.success) apply(d); })
            .catch(() => {});
    };
    try {
        if (typeof db === 'undefined' || !db.collection) return httpFallback();
        db.collection('crm_settings').doc('spellcheck_dictionary').onSnapshot(
            (doc) => apply(doc.exists ? doc.data() : {}),
            (err) => { console.warn('[spellcheck] onSnapshot falló, uso HTTP:', err && err.message); httpFallback(); }
        );
    } catch (e) {
        httpFallback();
    }
}

// Extrae la palabra bajo el cursor/selección del textarea.
function _wordAtCursor(input) {
    const v = input.value;
    let s = input.selectionStart, e = input.selectionEnd;
    if (typeof s !== 'number') return null;
    if (s !== e) {
        const sel = v.slice(s, e).trim();
        return sel ? { word: sel } : null;
    }
    let start = s, end = s;
    while (start > 0 && !_isSpellSep(v[start - 1])) start--;
    while (end < v.length && !_isSpellSep(v[end])) end++;
    const word = v.slice(start, end).trim();
    return word ? { word } : null;
}

function _closeSpellMenu() {
    if (_spellcheck.menuEl) { _spellcheck.menuEl.remove(); _spellcheck.menuEl = null; }
    document.removeEventListener('mousedown', _onSpellMenuOutside, true);
    document.removeEventListener('keydown', _onSpellMenuKey, true);
}
function _onSpellMenuOutside(e) { if (_spellcheck.menuEl && !_spellcheck.menuEl.contains(e.target)) _closeSpellMenu(); }
function _onSpellMenuKey(e) { if (e.key === 'Escape') _closeSpellMenu(); }

// Clic derecho sobre el cuadro de mensaje: menú para gestionar el diccionario.
function handleSpellcheckContextMenu(event) {
    if (!isSpellcheckEnabled()) return;                 // apagado: dejar el menú nativo del navegador
    // En táctil (móvil/tablet) el long-press debe conservar el menú nativo (copiar/pegar/seleccionar).
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    const input = event.target;
    const info = _wordAtCursor(input);
    if (!info || info.word.length < 2 || /[0-9@#/\\]/.test(info.word)) return; // sin palabra útil: menú nativo
    event.preventDefault();
    _closeSpellMenu();

    const word = info.word;
    const lower = word.toLowerCase();
    const custom = _spellcheck.custom || { corrections: {}, ignores: {} };
    const isIgnored = !!(custom.ignores && custom.ignores[lower]);
    const existing = custom.corrections && custom.corrections[lower];

    const menu = document.createElement('div');
    menu.className = 'spellcheck-context-menu';

    const header = document.createElement('div');
    header.className = 'sc-menu-header';
    header.textContent = `“${word}”`;
    menu.appendChild(header);

    const addItem = (icon, label, onClick, danger) => {
        const it = document.createElement('button');
        it.type = 'button';
        it.className = 'sc-menu-item' + (danger ? ' sc-danger' : '');
        it.innerHTML = `<i class="fas ${icon}"></i><span></span>`;
        it.querySelector('span').textContent = label;
        it.addEventListener('click', onClick);
        menu.appendChild(it);
    };

    if (isIgnored) {
        addItem('fa-rotate-left', 'Quitar del diccionario (volver a corregir)', () => {
            _saveDictionaryEntry({ action: 'remove-ignore', word: lower });
            _closeSpellMenu();
        });
    } else {
        addItem('fa-circle-check', 'Agregar al diccionario (no corregir)', () => {
            _saveDictionaryEntry({ action: 'add-ignore', word: lower });
            _closeSpellMenu();
        });
    }

    addItem('fa-wand-magic-sparkles', existing ? `Editar corrección (→ “${existing}”)` : 'Crear corrección…', () => {
        _showCorrectionForm(menu, word, existing || '');
    });

    if (existing) {
        addItem('fa-trash', 'Quitar corrección', () => {
            _saveDictionaryEntry({ action: 'remove-correction', from: lower });
            _closeSpellMenu();
        }, true);
    }

    document.body.appendChild(menu);
    _spellcheck.menuEl = menu;
    _positionSpellMenu(menu, event.clientX, event.clientY);
    setTimeout(() => {
        document.addEventListener('mousedown', _onSpellMenuOutside, true);
        document.addEventListener('keydown', _onSpellMenuKey, true);
    }, 0);
}

// Mini-formulario inline: "Reemplazar «word» por: [____]".
function _showCorrectionForm(menu, word, current) {
    menu.querySelectorAll('.sc-menu-item').forEach(el => el.remove());
    const form = document.createElement('form');
    form.className = 'sc-menu-form';
    const label = document.createElement('label');
    label.textContent = `Reemplazar “${word}” por:`;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'sc-input'; inp.maxLength = 60;
    inp.placeholder = 'texto correcto'; inp.value = current || '';
    const actions = document.createElement('div');
    actions.className = 'sc-form-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'sc-btn sc-cancel'; cancel.textContent = 'Cancelar';
    const save = document.createElement('button');
    save.type = 'submit'; save.className = 'sc-btn sc-save'; save.textContent = 'Guardar';
    actions.appendChild(cancel); actions.appendChild(save);
    form.appendChild(label); form.appendChild(inp); form.appendChild(actions);
    cancel.addEventListener('click', () => _closeSpellMenu());
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const to = inp.value.trim();
        if (!to || to.toLowerCase() === word.toLowerCase()) { _closeSpellMenu(); return; }
        _saveDictionaryEntry({ action: 'add-correction', from: word.toLowerCase(), to });
        _closeSpellMenu();
    });
    menu.appendChild(form);
    inp.focus(); inp.select();
}

// Posiciona el menú evitando que se salga de la ventana.
function _positionSpellMenu(menu, x, y) {
    const r = menu.getBoundingClientRect();
    let left = x, top = y;
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
    if (top + r.height > window.innerHeight - 8) top = window.innerHeight - r.height - 8;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
}

// Guarda una entrada: actualiza el estado local al instante (optimista) y persiste en
// el servidor; el onSnapshot reconcilia con lo que quede guardado para todos.
async function _saveDictionaryEntry(payload) {
    const custom = _spellcheck.custom || { corrections: {}, ignores: {} };
    const corrections = Object.assign({}, custom.corrections);
    const ignores = Object.assign({}, custom.ignores);
    if (payload.action === 'add-correction') corrections[payload.from] = payload.to;
    else if (payload.action === 'remove-correction') delete corrections[payload.from];
    else if (payload.action === 'add-ignore') ignores[payload.word] = true;
    else if (payload.action === 'remove-ignore') delete ignores[payload.word];
    _spellcheck.custom = { corrections, ignores };

    showSpellcheckToast({
        'add-correction': 'Corrección guardada para todos',
        'remove-correction': 'Corrección eliminada',
        'add-ignore': 'Palabra agregada al diccionario',
        'remove-ignore': 'Palabra quitada del diccionario'
    }[payload.action] || 'Diccionario actualizado');

    try {
        const res = await fetch(`${API_BASE_URL}/api/spellcheck/dictionary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) showSpellcheckToast('No se pudo guardar en el servidor');
    } catch (e) {
        showSpellcheckToast('Sin conexión: no se guardó');
    }
}

async function handleSendMessage(event) {
    event.preventDefault();
    const input = document.getElementById('message-input');
    let text = input.value.trim();
    
    const currentContactId = state.selectedContactId;
    const currentReplyingTo = state.replyingToMessage;
    
    const contact = state.contacts.find(c => c.id === currentContactId);
    // REMOVIDO: state.isUploading check. Ahora permitimos enviar mientras se sube.
    if (!contact) return; 

    const filesToSend = [...state.stagedFiles];
    const remoteFileToSend = state.stagedRemoteFile;

    if (!text && filesToSend.length === 0 && !remoteFileToSend) return;

    // Instagram y Messenger no tienen ventana de 24h
    const selectedContact = state.contacts.find(c => c.id === state.selectedContactId);
    const isExpired = (selectedContact && (selectedContact.channel === 'messenger' || selectedContact.channel === 'instagram')) ? false : state.isSessionExpired;

    // Modo programado por conversación: si está activo (con hora futura), el mensaje
    // no se envía ahora; se guarda como "programado" y el scheduler lo manda a su hora.
    const scheduleInfo = state.scheduleByContact && state.scheduleByContact[currentContactId];
    const scheduleAt = (scheduleInfo && scheduleInfo.scheduledAt && scheduleInfo.scheduledAt > Date.now()) ? scheduleInfo.scheduledAt : null;
    if (scheduleInfo && scheduleInfo.scheduledAt && scheduleInfo.scheduledAt <= Date.now()) {
        delete state.scheduleByContact[currentContactId]; // la hora ya pasó: enviar normal
    }

    const tempId = `temp_${Date.now()}`;

    // --- Definir el texto del mensaje temporal ---
    let messageText = text;
    if (!messageText) {
        if (filesToSend.length > 0) {
             const type = filesToSend[0].type;
             if (type.startsWith('image/')) messageText = '📷 Imagen';
             else if (type.startsWith('video/')) messageText = '🎥 Video';
             else if (type.startsWith('audio/')) messageText = '🎵 Audio';
             else messageText = '📄 Documento';
             if (filesToSend.length > 1) messageText += ` (+${filesToSend.length - 1} más)`;
        } else if (remoteFileToSend) {
             const type = remoteFileToSend.type;
             if (type.startsWith('image/')) messageText = '📷 Imagen';
             else if (type.startsWith('video/')) messageText = '🎥 Video';
             else if (type.startsWith('audio/')) messageText = '🎵 Audio';
             else messageText = '📄 Documento';
        }
    }

    const pendingMessage = {
        docId: tempId,
        from: 'me',
        status: scheduleAt ? 'scheduled' : (isExpired ? 'queued' : 'pending'),
        timestamp: { seconds: Math.floor((scheduleAt || Date.now()) / 1000) },
        text: messageText,
    };
    if (scheduleAt) pendingMessage.scheduledAt = { seconds: Math.floor(scheduleAt / 1000) };

    if (filesToSend.length > 0) {
        pendingMessage.fileUrl = URL.createObjectURL(filesToSend[0]);
        pendingMessage.fileType = filesToSend[0].type;
    } else if (remoteFileToSend) {
        pendingMessage.fileUrl = remoteFileToSend.url;
        pendingMessage.fileType = remoteFileToSend.type;
    }

    // Agregar a la UI inmediatamente (Optimistic UI)
    if (state.selectedContactId === currentContactId) {
        state.messages.push(pendingMessage);
        appendMessage(pendingMessage);
    }

    input.value = '';
    input.style.height = 'auto';
    cancelStagedFile(); // Limpia el archivo del estado, pero ya lo capturamos en fileToSend

    // --- ENCOLAR MENSAJES ---
    if (filesToSend.length > 0) {
        // Primer archivo lleva el texto como caption
        state.messageQueue.push({
            type: 'file',
            file: filesToSend[0],
            text: text,
            contactId: currentContactId,
            replyTo: currentReplyingTo,
            isExpired: isExpired,
            tempId: tempId,
            scheduleAt: scheduleAt
        });
        // Archivos adicionales van sin texto
        for (let i = 1; i < filesToSend.length; i++) {
            state.messageQueue.push({
                type: 'file',
                file: filesToSend[i],
                text: '',
                contactId: currentContactId,
                replyTo: null,
                isExpired: isExpired,
                tempId: `temp_${Date.now()}_${i}`,
                scheduleAt: scheduleAt
            });
        }
    } else {
        state.messageQueue.push({
            type: 'text',
            remoteFile: remoteFileToSend,
            text: text,
            contactId: currentContactId,
            replyTo: currentReplyingTo,
            isExpired: isExpired,
            tempId: tempId,
            scheduleAt: scheduleAt
        });
    }

    // Iniciar procesamiento de la cola (si no está ya corriendo)
    processMessageQueue();

    // Cancelar respuesta solo si seguimos en el mismo chat
    if (state.selectedContactId === currentContactId) {
        cancelReply();
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

async function uploadAndSendFile(file, textCaption, isExpired, contactId, replyingToMessage, scheduleAt, tempId) {
    // Usar el contactId pasado o fallback al state (para compatibilidad), pero preferir el pasado
    const targetContactId = contactId || state.selectedContactId;
    if (!file || !targetContactId) return; // Removido state.isUploading check para permitir llamadas desde la cola
    
    const progressEl = document.getElementById('upload-progress');
    const submitButton = document.querySelector('#message-form button[type="submit"]');
    state.isUploading = true;
    
    if (progressEl) {
        progressEl.textContent = 'Subiendo 0%...';
        progressEl.classList.remove('hidden');
    }
    // No deshabilitamos el botón de enviar para permitir encolar más mensajes
    
    const userIdentifier = auth.currentUser ? auth.currentUser.uid : 'anonymous_uploads';
    const filePath = `uploads/${userIdentifier}/${Date.now()}_${file.name}`;
    
    const fileRef = storage.ref(filePath);
    
    // FIX: Agregar metadatos explícitos para evitar error 412 (Precondition Failed) en Firebase Storage
    const metadata = {
        contentType: file.type
    };
    
    const uploadTask = fileRef.put(file, metadata);
    
    return new Promise((resolve, reject) => {
        uploadTask.on('state_changed', 
            (snapshot) => { 
                if (progressEl) {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100; 
                    progressEl.textContent = `Subiendo ${Math.round(progress)}%...`; 
                }
            }, 
            (error) => { 
                state.isUploading = false; 
                if (progressEl) progressEl.classList.add('hidden'); 
                if(submitButton) submitButton.disabled = false; 
                console.error("Error detallado de subida:", error);
                reject(new Error("Falló la subida del archivo: " + error.message)); 
            }, 
            async () => {
                try {
                    const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
                    const messageData = { 
                        fileUrl: downloadURL, 
                        fileType: file.type,
                        text: textCaption 
                    };
                    
                    // Usar el contexto capturado si existe, si no, el del estado (riesgoso si cambió chat)
                    const contextMsg = replyingToMessage !== undefined ? replyingToMessage : state.replyingToMessage;
                    
                    if (contextMsg) {
                        messageData.reply_to_wamid = contextMsg.id;
                    }

                    if (scheduleAt) {
                        messageData.scheduledAt = scheduleAt;
                        messageData.tempId = tempId;
                    }

                    const endpoint = scheduleAt ? 'schedule-message' : (isExpired ? 'queue-message' : 'messages');
                    const response = await fetch(`${API_BASE_URL}/api/contacts/${targetContactId}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messageData) });
                    resolve(response);
                } catch (error) { 
                    reject(error); 
                } finally { 
                    state.isUploading = false; 
                    if (progressEl) progressEl.classList.add('hidden'); 
                    if(submitButton) submitButton.disabled = false; 
                }
            }
        );
    });
}


function stageFile(file) {
    if (!file || state.isUploading) return;
    // WhatsApp tiene límite de 100MB para documentos, 16MB para media.
    const MAX_SIZE_MB = 100;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        showError(`El archivo excede el límite de ${MAX_SIZE_MB}MB.`);
        return;
    }
    const isSupported = file.type.startsWith('image/')
        || file.type.startsWith('video/')
        || file.type.startsWith('audio/')
        || file.type.startsWith('application/')
        || file.type.startsWith('text/');
    if (!isSupported) {
        showError('Tipo de archivo no soportado.');
        return;
    }
    // Evitar duplicados (mismo archivo adjuntado dos veces)
    const isDuplicate = state.stagedFiles.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
    if (isDuplicate) return;
    state.stagedFiles.push(file);
    state.stagedRemoteFile = null;
    renderFilePreview();
}

function cancelStagedFile() { 
    state.stagedFiles.forEach(f => URL.revokeObjectURL(f)); 
    state.stagedFiles = []; 
    state.stagedRemoteFile = null;
    const fileInput = document.getElementById('file-input'); 
    if(fileInput) fileInput.value = null; 
    renderFilePreview(); 
}

function removeStagedFile(index) {
    if (index >= 0 && index < state.stagedFiles.length) {
        URL.revokeObjectURL(state.stagedFiles[index]);
        state.stagedFiles.splice(index, 1);
        renderFilePreview();
    }
}

function handleFileInputChange(event) { const files = event.target.files; if (files) { for (let i = 0; i < files.length; i++) { stageFile(files[i]); } } }

function handlePaste(event) { const items = (event.clipboardData || event.originalEvent.clipboardData).items; for (let i = 0; i < items.length; i++) { if (items[i].kind === 'file') { const file = items[i].getAsFile(); if(file) { event.preventDefault(); stageFile(file); } } } }

function setFilter(filter) {
    state.activeFilter = filter;
    state.purchaseFilter = null;
    state.unreadOnly = false;
    state.designReviewFilter = false;
    state.adIdFilters = [];
    if (filter === 'all') state.channelFilter = null; // "Todos" = reset total (incluye canal)
    renderTagFilters();

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active')); 
    if (document.getElementById(`filter-${filter}`)) {
        document.getElementById(`filter-${filter}`).classList.add('active'); 
    }
    
    // Clear current contacts and trigger a new fetch from the server with the filter
    state.contacts = [];
    fetchInitialContacts();
}

/**
 * Alterna el filtro de mensajes no leídos.
 */
function toggleUnreadFilter() {
    state.unreadOnly = !state.unreadOnly;
    state.purchaseFilter = null;
    state.designReviewFilter = false;
    state.activeFilter = 'all';
    state.adIdFilters = [];
    renderTagFilters();
    state.contacts = [];
    fetchInitialContacts();
}

function setPurchaseFilter(filter) {
    state.designReviewFilter = false;
    const current = state.purchaseFilter;
    if (!current) {
        state.purchaseFilter = filter;
    } else if (current === filter) {
        // Desactivar el mismo que ya estaba
        state.purchaseFilter = null;
    } else if (current === 'both') {
        // Ambos activos → desactivar el clickeado, dejar el otro
        state.purchaseFilter = filter === 'registered' ? 'completed' : 'registered';
    } else {
        // Uno activo, click en el otro → activar ambos
        state.purchaseFilter = 'both';
    }
    state.unreadOnly = false;
    state.activeFilter = 'all';
    state.adIdFilters = [];
    renderTagFilters();
    state.contacts = [];
    fetchInitialContacts();
}
window.setPurchaseFilter = setPurchaseFilter;

function toggleDesignFilter() {
    state.designReviewFilter = !state.designReviewFilter;
    state.unreadOnly = false;
    state.purchaseFilter = null;
    state.activeFilter = 'all';
    state.adIdFilters = [];
    renderTagFilters();
    state.contacts = [];
    fetchInitialContacts();
}
window.toggleDesignFilter = toggleDesignFilter;

function toggleChannelFilter(channel) {
    // Si ya está activo, desactivar (volver a "todos los canales")
    state.channelFilter = state.channelFilter === channel ? null : channel;
    state.adIdFilters = [];
    renderTagFilters();
    state.contacts = [];
    fetchInitialContacts();
}
window.toggleChannelFilter = toggleChannelFilter;

/**
 * Aplica el filtro por anuncio(s) de origen. Recibe un array de source_id.
 * Muestra las conversaciones que tuvieron CUALQUIERA de esos anuncios como origen en algún
 * momento (aunque también vinieran de otros). Es un filtro exclusivo: limpia los demás para
 * mantener la lista clara, igual que el resto de filtros entre sí.
 */
function applyAdFilters(ids) {
    state.adIdFilters = Array.isArray(ids) ? [...new Set(ids.filter(Boolean).map(String))] : [];
    // Limpiar los demás filtros (exclusividad, igual que ocurre entre los otros filtros).
    state.activeFilter = 'all';
    state.purchaseFilter = null;
    state.unreadOnly = false;
    state.designReviewFilter = false;
    state.channelFilter = null;
    renderTagFilters();
    state.contacts = [];
    fetchInitialContacts();
}
window.applyAdFilters = applyAdFilters;

/** Quita el filtro de anuncios y recarga la lista completa. */
function clearAdFilters() {
    applyAdFilters([]);
}
window.clearAdFilters = clearAdFilters;

function setDepartmentFilter(deptId) {
    // Si se vuelve a elegir el mismo departamento, regresar a "todos"
    state.activeDepartmentFilter = (state.activeDepartmentFilter === deptId) ? 'all' : (deptId || 'all');
    renderTagFilters();
    state.contacts = [];
    fetchInitialContacts();
}
window.setDepartmentFilter = setDepartmentFilter;

async function handleDesignToggle(contactId, inDesign) {
    try {
        const contactIndex = state.contacts.findIndex(c => c.id === contactId);
        if (contactIndex > -1) {
            state.contacts[contactIndex].inDesignReview = inDesign;
            scheduleContactListRender();
            if (state.selectedContactId === contactId) renderChatWindow();
        }
        await db.collection("contacts_whatsapp").doc(contactId).update({
            inDesignReview: inDesign
        });
    } catch (error) {
        console.error("Error al cambiar estado de diseño:", error);
        showError("No se pudo cambiar el estado de diseño.");
        const contactIndex = state.contacts.findIndex(c => c.id === contactId);
        if (contactIndex > -1) {
            state.contacts[contactIndex].inDesignReview = !inDesign;
            if (state.selectedContactId === contactId) renderChatWindow();
        }
    }
}
window.handleDesignToggle = handleDesignToggle;

function setActiveTab(tab) { state.activeTab = tab; renderChatWindow(); }

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

function selectQuickReply(replyId) {
    const reply = state.quickReplies.find(r => r.id === replyId);
    if (!reply) return;

    const input = document.getElementById('message-input');
    if (input) {
        let text = reply.message || '';
        // Si el atajo es 'final', añadimos la marca para que el backend desactive el bot e identifique el comando
        if (reply.shortcut && reply.shortcut.toLowerCase() === 'final') {
            text += ' /final';
        }
        input.value = text;
        input.focus();
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
    }
    
    state.stagedFiles = []; 
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

function selectEmoji(emoji) {
    const input = document.getElementById('message-input');
    if (input) { input.value += emoji; input.focus(); }
    pushEmojiRecent(emoji);
    refreshEmojiRecentsInPlace();
}

// --- Emojis recientes (persistidos en localStorage, estilo WhatsApp) ---
const EMOJI_RECENTS_KEY = 'crm_emoji_recents';
const EMOJI_RECENTS_MAX = 32;

function getEmojiRecents() {
    try {
        const r = JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEY) || '[]');
        return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
}

function pushEmojiRecent(emoji) {
    try {
        let r = getEmojiRecents().filter(e => e !== emoji); // quita duplicado
        r.unshift(emoji);                                    // el más reciente primero
        if (r.length > EMOJI_RECENTS_MAX) r = r.slice(0, EMOJI_RECENTS_MAX);
        localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(r));
    } catch (e) { /* localStorage no disponible: ignorar */ }
}

// Actualiza la sección "Recientes" sin re-renderizar todo el picker (evita saltos
// de scroll). Si aún no existe la sección (primer emoji), hace un render completo.
function refreshEmojiRecentsInPlace() {
    const picker = document.getElementById('emoji-picker');
    if (!picker || picker.classList.contains('hidden')) return;
    const recents = getEmojiRecents();
    const grid = picker.querySelector('.emoji-section[data-cat="recents"] .emoji-grid');
    if (grid) {
        grid.innerHTML = recents.map(e => `<button type="button" class="emoji" onclick="selectEmoji('${e}')">${e}</button>`).join('');
    } else if (recents.length) {
        renderEmojiPicker();
    }
}

function handleStartReply(event, messageDocId) {
    event.stopPropagation();
    const message = state.messages.find(m => m.docId === messageDocId);
    if (message) {
        state.replyingToMessage = message;
        // MODIFICADO: Pasar opción preserveScroll: true
        renderChatWindow({ preserveScroll: true });
        
        // CORRECCIÓN MAYOR: Usar setTimeout para asegurar que el DOM esté listo y
        // el scroll restaurado antes de enfocar el input.
        setTimeout(() => {
            const input = document.getElementById('message-input');
            if (input) {
                input.focus({ preventScroll: true });
            }
        }, 0);
    }
}

function cancelReply() {
    if (state.replyingToMessage) {
        state.replyingToMessage = null;
        // MODIFICADO: Pasar opción preserveScroll: true también al cancelar
        renderChatWindow({ preserveScroll: true });
    }
}

// --- INICIO DE LA SOLUCIÓN MEJORADA ---
// Esta versión coloca el menú al lado del mensaje, eligiendo el lado con más espacio.
function toggleReactionMenu(event) {
    event.stopPropagation();
    const targetButton = event.currentTarget;
    const popoverContainer = targetButton.closest('.reaction-popover-container');
    const popover = popoverContainer.querySelector('.reaction-popover');
    const messageBubble = targetButton.closest('.message-bubble');
    
    if (!popoverContainer || !popover || !messageBubble) return;

    const wasActive = popoverContainer.classList.contains('active');

    // Cierra todos los otros menús que puedan estar abiertos.
    document.querySelectorAll('.reaction-popover-container.active').forEach(container => {
        container.classList.remove('active');
        const p = container.querySelector('.reaction-popover');
        if (p) {
            p.classList.remove('fixed');
            p.style.top = '';
            p.style.left = '';
            p.style.transform = '';
        }
    });

    // Si no estaba activo, lo abrimos y calculamos la nueva posición.
    if (!wasActive) {
        popoverContainer.classList.add('active');
        popover.classList.add('fixed');
        popover.style.transform = 'none';
        
        const bubbleRect = messageBubble.getBoundingClientRect();
        const popoverHeight = popover.offsetHeight;
        const popoverWidth = popover.offsetWidth;
        const margin = 8; // Espacio de 8px desde la burbuja

        // Calcula el espacio disponible a cada lado.
        const spaceRight = window.innerWidth - bubbleRect.right - margin;
        const spaceLeft = bubbleRect.left - margin;
        
        let top = bubbleRect.top + (bubbleRect.height / 2) - (popoverHeight / 2);
        let left;

        // Decide dónde colocarlo horizontalmente.
        if (spaceRight >= popoverWidth) {
            // Colocar a la derecha.
            left = bubbleRect.right + margin;
        } else if (spaceLeft >= popoverWidth) {
            // Colocar a la izquierda.
            left = bubbleRect.left - popoverWidth - margin;
        } else {
            // Fallback: Si no hay espacio a los lados, colocarlo arriba.
            const buttonRect = targetButton.getBoundingClientRect();
            left = buttonRect.left + (buttonRect.width / 2) - (popoverWidth / 2);
            top = bubbleRect.top - popoverHeight - margin;
        }

        // Se asegura de que no se salga de la pantalla verticalmente.
        if (top < margin) {
            top = margin;
        }
        if (top + popoverHeight > window.innerHeight - margin) {
            top = window.innerHeight - popoverHeight - margin;
        }

        // Se asegura de que no se salga de la pantalla horizontalmente (importante para el fallback).
        if (left < margin) {
            left = margin;
        }
        if (left + popoverWidth > window.innerWidth - margin) {
            left = window.innerWidth - popoverWidth - margin;
        }

        // Aplica la posición final.
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
    }
}
// --- FIN DE LA SOLUCIÓN MEJORADA ---


// Add a global listener to close the menu when clicking outside
document.addEventListener('click', (event) => {
    if (state.activeView !== 'chats') return;

    const openPopover = document.querySelector('.reaction-popover.fixed');
    
    if (openPopover && !openPopover.closest('.reaction-popover-container').contains(event.target)) {
        const container = openPopover.closest('.reaction-popover-container');
        openPopover.classList.remove('fixed');
        openPopover.style.top = '';
        openPopover.style.left = '';
        if (container) {
            container.classList.remove('active');
        }
    }
});

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
            body: JSON.stringify({ emoji: newReaction })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || 'No se pudo guardar la reacción.');
        }
    } catch (error) {
        console.error("Error al reaccionar:", error);
        showError(error.message);
    }
}
// Estado local para el modal de previsualización
let previewState = {
    contactId: null,
    messages: [],
    lastMessageTimestamp: null,
    hasMore: true,
    isLoading: false
};

window.toggleReactionMenu = toggleReactionMenu;
window.handleSelectReaction = handleSelectReaction;
window.openConversationPreview = openConversationPreview;
window.handleSelectContact = handleSelectContact;
window.setFilter = setFilter;
window.toggleUnreadFilter = toggleUnreadFilter;
window.setActiveTab = setActiveTab;
window.toggleEmojiPicker = toggleEmojiPicker;
window.toggleTemplatePicker = toggleTemplatePicker;
window.handleStartReply = handleStartReply;
window.cancelReply = cancelReply;
window.selectQuickReply = selectQuickReply;
window.selectEmoji = selectEmoji;
window.scrollToEmojiCategory = scrollToEmojiCategory;
window.handleSendTemplate = handleSendTemplate;
window.handleSendMediaTemplate = handleSendMediaTemplate;
window.cancelStagedFile = cancelStagedFile;
window.removeStagedFile = removeStagedFile;
window.handleFileInputChange = handleFileInputChange;


// --- START: Picker Management (ADDED CODE) ---

function updatePickerSelection() {
    const picker = document.querySelector('.picker-container:not(.hidden)');
    if (!picker) return;

    const items = picker.querySelectorAll('.picker-item');
    items.forEach((item, index) => {
        if (index === state.pickerSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function navigatePicker(direction) {
    if (!state.pickerItems || state.pickerItems.length === 0) return;

    if (direction === 'down') {
        state.pickerSelectedIndex = (state.pickerSelectedIndex + 1) % state.pickerItems.length;
    } else if (direction === 'up') {
        state.pickerSelectedIndex = (state.pickerSelectedIndex - 1 + state.pickerItems.length) % state.pickerItems.length;
    }
    updatePickerSelection();
}

function handleMessageInputKeyDown(e) {
    const isPickerOpen = state.quickReplyPickerOpen || state.templatePickerOpen;

    if (isPickerOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        navigatePicker(e.key === 'ArrowUp' ? 'up' : 'down');
        return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isPickerOpen && state.pickerSelectedIndex > -1) {
            const selectedItem = state.pickerItems[state.pickerSelectedIndex];
            if (selectedItem) {
                if (state.quickReplyPickerOpen) {
                    selectQuickReply(selectedItem.id);
                } else if (state.templatePickerOpen) {
                    handleSendTemplate(selectedItem);
                }
            }
        } else {
            document.getElementById('message-form').requestSubmit();
        }
        return;
    }
    
    if (e.key === 'Escape') {
        if (isPickerOpen) {
            e.preventDefault();
            state.quickReplyPickerOpen = false;
            state.templatePickerOpen = false;
            renderAllPickers();
        }
    }
}

function toggleEmojiPicker() {
    state.emojiPickerOpen = !state.emojiPickerOpen;
    if (state.emojiPickerOpen) {
        state.templatePickerOpen = false;
        state.quickReplyPickerOpen = false;
    }
    renderAllPickers();
}

function toggleTemplatePicker() {
    state.templatePickerOpen = !state.templatePickerOpen;
    if (state.templatePickerOpen) {
        state.emojiPickerOpen = false;
        state.quickReplyPickerOpen = false;
        renderTemplatePicker(); // Re-render to set state
    }
    renderAllPickers();
}

function renderAllPickers() {
    const qrPicker = document.getElementById('quick-reply-picker');
    const templatePicker = document.getElementById('template-picker');
    const emojiPicker = document.getElementById('emoji-picker');

    if (qrPicker) qrPicker.classList.toggle('hidden', !state.quickReplyPickerOpen);
    if (templatePicker) templatePicker.classList.toggle('hidden', !state.templatePickerOpen);
    if (emojiPicker) emojiPicker.classList.toggle('hidden', !state.emojiPickerOpen);

    if (state.emojiPickerOpen) renderEmojiPicker();
}

function renderQuickReplyPicker(searchTerm = '') {
    const picker = document.getElementById('quick-reply-picker');
    if (!picker) return;

    const filteredReplies = state.quickReplies.filter(r => r.shortcut.toLowerCase().includes(searchTerm.toLowerCase()));

    state.pickerItems = filteredReplies;
    state.pickerSelectedIndex = filteredReplies.length > 0 ? 0 : -1;

    if (filteredReplies.length > 0) {
        picker.innerHTML = filteredReplies.map(reply => `
            <div class="picker-item" data-reply-id="${reply.id}" onclick="selectQuickReply('${reply.id}')">
                <strong>/${reply.shortcut}</strong> - <span class="text-gray-500">${(reply.message || '').substring(0, 50)}...</span>
            </div>
        `).join('');
    } else {
        picker.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No hay respuestas rápidas que coincidan.</div>`;
    }
     picker.innerHTML += `<div class="picker-add-btn" onclick="navigateTo('respuestas-rapidas')"><i class="fas fa-plus-circle mr-2"></i>Añadir nueva respuesta</div>`;
    
    updatePickerSelection();
}

function renderTemplatePicker() {
    const picker = document.getElementById('template-picker');
    if (!picker) return;

    const allTemplates = state.templates || [];
    state.pickerItems = allTemplates;
    state.pickerSelectedIndex = allTemplates.length > 0 ? 0 : -1;

    if (allTemplates.length === 0) {
        picker.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No hay plantillas de WhatsApp disponibles.</div>`;
        updatePickerSelection();
        return;
    }

    const MEDIA_ICONS = { IMAGE: 'fa-image', VIDEO: 'fa-video', DOCUMENT: 'fa-file-pdf' };
    const MEDIA_LABELS = { IMAGE: 'imagen', VIDEO: 'video', DOCUMENT: 'documento' };

    picker.innerHTML = allTemplates.map(template => {
        const templateString = JSON.stringify(template).replace(/"/g, '&quot;');
        const header = template.components?.find(c => c.type === 'HEADER');
        const mediaFmt = header?.format;
        const requiresMedia = mediaFmt === 'IMAGE' || mediaFmt === 'VIDEO' || mediaFmt === 'DOCUMENT';
        const mediaIcon = requiresMedia ? `<i class="fas ${MEDIA_ICONS[mediaFmt]} ml-2" title="Requiere ${MEDIA_LABELS[mediaFmt]}" style="color:#16a34a;"></i>` : '';
        const handler = requiresMedia
            ? `handleSendMediaTemplate(${templateString})`
            : `handleSendTemplate(${templateString})`;
        return `
            <div class="picker-item template-item" data-template-name="${template.name}" onclick="${handler}">
                <div class="flex justify-between items-center">
                    <span class="font-semibold">${template.name}${mediaIcon}</span>
                    <span class="template-category">${template.category}</span>
                </div>
            </div>
        `;
    }).join('');

    updatePickerSelection();
}

// Para plantillas con HEADER de IMAGE/VIDEO/DOCUMENT: abre file picker, sube a Storage, envia.
async function handleSendMediaTemplate(templateObject) {
    if (!state.selectedContactId) return;
    const header = templateObject.components?.find(c => c.type === 'HEADER');
    const fmt = header?.format;
    const acceptByFmt = { IMAGE: 'image/*', VIDEO: 'video/mp4,video/3gp,video/quicktime', DOCUMENT: 'application/pdf' };
    const labelByFmt = { IMAGE: 'una imagen', VIDEO: 'un video', DOCUMENT: 'un documento (PDF)' };

    // Crear input file invisible
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptByFmt[fmt] || '*/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async (ev) => {
        const file = ev.target.files?.[0];
        document.body.removeChild(input);
        if (!file) return;

        const currentContactId = state.selectedContactId;
        const tempId = `temp_${Date.now()}`;
        const previewText = `📤 Subiendo ${labelByFmt[fmt]}... (${templateObject.name})`;
        const pendingMessage = {
            docId: tempId,
            from: 'me',
            status: 'pending',
            timestamp: { seconds: Math.floor(Date.now() / 1000) },
            text: previewText
        };
        if (state.selectedContactId === currentContactId) {
            state.messages.push(pendingMessage);
            appendMessage(pendingMessage);
        }
        toggleTemplatePicker();

        try {
            // Subir archivo a Firebase Storage
            const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
            const filePath = `template-media/${Date.now()}_${safeName}`;
            const fileRef = storage.ref(filePath);
            const uploadTask = await fileRef.put(file, { contentType: file.type });
            const mediaUrl = await uploadTask.ref.getDownloadURL();

            // Enviar al backend con templateMediaUrl
            const response = await fetch(`${API_BASE_URL}/api/contacts/${currentContactId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ template: templateObject, templateMediaUrl: mediaUrl, tempId })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || 'Error del servidor al enviar plantilla con media.');
            }
        } catch (error) {
            console.error("Error al enviar la plantilla con media:", error);
            showError(error.message);
            const idx = state.messages.findIndex(m => m.docId === tempId);
            if (idx > -1) {
                state.messages.splice(idx, 1);
                renderMessages();
            }
        }
    };

    input.click();
}

// Biblioteca completa de emojis estilo WhatsApp, agrupada por categorías
const EMOJI_CATEGORIES = [
    { id: 'smileys', icon: '😀', name: 'Caritas y emociones', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'] },
    { id: 'people', icon: '👋', name: 'Personas y gestos', emojis: ['👋','🤚','✋','🖐️','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','🦻','👃','🧠','🦷','🦴','👀','👁️','👅','👄','💋','🩸','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂','👷','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','💆','💇','🚶','🏃','💃','🕺','🧖','👫','👬','👭','💏','💑','👪'] },
    { id: 'nature', icon: '🐶', name: 'Animales y naturaleza', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦂','🐢','🐍','🦎','🐙','🦑','🦐','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🐘','🦏','🐪','🐫','🦒','🐃','🐄','🐎','🐖','🐏','🐑','🐐','🦌','🐕','🐩','🐈','🐓','🦃','🕊️','🐇','🐁','🐀','🐿️','🦔','🐉','🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🎍','🍃','🍂','🍁','🌷','🌹','🌺','🌸','🌼','🌻','🌞','🌝','🌚','🌎','⭐','🌟','✨','⚡','🔥','🌈','☀️','⛅','☁️','🌧️','⛈️','❄️','⛄','🌊','💧'] },
    { id: 'food', icon: '🍔', name: 'Comida y bebida', emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🌮','🌯','🥗','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾'] },
    { id: 'activities', icon: '⚽', name: 'Actividades', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩'] },
    { id: 'travel', icon: '✈️', name: 'Viajes y lugares', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🛴','🚲','🛵','🏍️','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🚁','🚀','🛸','🚢','⛵','🚤','🛥️','🛳️','⛴️','🚧','⛽','🚦','🚥','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🏠','🏡','🏘️','🏚️','🏗️','🏭','🏢','🏬','🏣','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛️','⛪','🕌','🕍','🛕','🕋','⛩️','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','🎑'] },
    { id: 'objects', icon: '💡', name: 'Objetos', emojis: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🕹️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','💰','💳','🧾','💎','⚖️','🧰','🔧','🔨','⚒️','🛠️','⛏️','🔩','⚙️','🧱','⛓️','🧲','🔫','💣','🧨','🔪','🗡️','⚔️','🛡️','🚬','⚰️','⚱️','🏺','🔮','📿','🧿','💈','⚗️','🔭','🔬','🕳️','💊','💉','🩸','🩹','🩺','🌡️','🧹','🧺','🧻','🚽','🚿','🛁','🛀','🧼','🪒','🧽','🧴','🛎️','🔑','🗝️','🚪','🛋️','🛏️','🛌','🧸','🖼️','🛍️','🛒','🎁','🎈','🎏','🎀','🎊','🎉','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','📪','📫','📬','📭','📮','📜','📃','📄','📑','📊','📈','📉','🗒️','🗓️','📆','📅','📇','🗃️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️','📐','📏','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'] },
    { id: 'symbols', icon: '❤️', name: 'Símbolos', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↩️','↪️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','♾️','💲','💱','™️','©️','®️','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','⚪','⚫','🔴','🔵','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','⬛','⬜','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛'] },
];

function scrollToEmojiCategory(catId) {
    const section = document.querySelector(`.emoji-section[data-cat="${catId}"]`);
    const scroll = document.getElementById('emoji-scroll');
    if (!section || !scroll) return;
    scroll.scrollTo({ top: section.offsetTop - scroll.offsetTop, behavior: 'smooth' });
    document.querySelectorAll('.emoji-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === catId));
}

function renderEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    if (!picker) return;

    // Si hay emojis recientes, se antepone una categoría "Recientes" (estilo WhatsApp).
    const recents = getEmojiRecents();
    const cats = recents.length
        ? [{ id: 'recents', faIcon: 'far fa-clock', name: 'Recientes', emojis: recents }, ...EMOJI_CATEGORIES]
        : EMOJI_CATEGORIES;

    const tabsHTML = cats.map((cat, i) => {
        const iconHTML = cat.faIcon ? `<i class="${cat.faIcon}"></i>` : cat.icon;
        return `<button type="button" class="emoji-tab${i === 0 ? ' active' : ''}" data-cat="${cat.id}" title="${cat.name}" onclick="scrollToEmojiCategory('${cat.id}')">${iconHTML}</button>`;
    }).join('');

    const sectionsHTML = cats.map(cat => {
        const grid = cat.emojis.map(e =>
            `<button type="button" class="emoji" onclick="selectEmoji('${e}')">${e}</button>`
        ).join('');
        return `<div class="emoji-section" data-cat="${cat.id}">
                    <div class="emoji-section-title">${cat.name}</div>
                    <div class="emoji-grid">${grid}</div>
                </div>`;
    }).join('');

    picker.innerHTML = `
        <div class="emoji-tabs">${tabsHTML}</div>
        <div class="emoji-scroll" id="emoji-scroll">${sectionsHTML}</div>`;
}

async function handleSendTemplate(templateObject) {
    if (!state.selectedContactId) return;

    const currentContactId = state.selectedContactId;
    const tempId = `temp_${Date.now()}`;

    // Construir texto preview de la plantilla para UI optimista
    const bodyDef = templateObject.components?.find(c => c.type === 'BODY');
    const templatePreviewText = bodyDef?.text || `📄 Plantilla: ${templateObject.name}`;

    const pendingMessage = {
        docId: tempId,
        from: 'me',
        status: 'pending',
        timestamp: { seconds: Math.floor(Date.now() / 1000) },
        text: templatePreviewText,
    };

    // UI optimista: mostrar mensaje inmediatamente
    if (state.selectedContactId === currentContactId) {
        state.messages.push(pendingMessage);
        appendMessage(pendingMessage);
    }

    toggleTemplatePicker();

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${currentContactId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template: templateObject, tempId })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error del servidor al enviar plantilla.');
        }
    } catch (error) {
        console.error("Error al enviar la plantilla:", error);
        showError(error.message);
        // Quitar el mensaje optimista si falló
        const idx = state.messages.findIndex(m => m.docId === tempId);
        if (idx > -1) {
            state.messages.splice(idx, 1);
            renderMessages();
        }
    }
}
// --- END: Picker Management ---

// --- START: Conversation Preview Logic ---

async function openConversationPreview(event, contactId) {
    event.stopPropagation(); // Evita que se seleccione el chat al hacer clic en el ojo

    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Resetear el estado de la previsualización
    previewState = {
        contactId: contactId,
        messages: [],
        lastMessageTimestamp: null,
        hasMore: true,
        isLoading: false
    };

    const modalContainer = document.getElementById('conversation-preview-modal-container');
    modalContainer.innerHTML = ConversationPreviewModalTemplate(contact);
    document.body.classList.add('modal-open');

    const messagesContainer = document.getElementById('preview-messages-container');
    messagesContainer.addEventListener('scroll', handlePreviewScroll);

    await loadMorePreviewMessages();
}

async function loadMorePreviewMessages() {
    if (previewState.isLoading || !previewState.hasMore) return;

    previewState.isLoading = true;

    const spinner = document.getElementById('preview-loading-spinner');
    if (spinner) spinner.style.display = 'flex';
    
    try {
        // La URL del endpoint que crearemos más adelante
        let url = `${API_BASE_URL}/api/contacts/${previewState.contactId}/messages-paginated?limit=30`;
        if (previewState.lastMessageTimestamp) {
            // Pide mensajes *anteriores* al último que ya tenemos
            url += `&before=${previewState.lastMessageTimestamp}`;
        }
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('No se pudieron cargar los mensajes.');
        
        const data = await response.json();

        if (spinner) spinner.style.display = 'none';

        if (data.messages.length > 0) {
            // CORRECCIÓN: Convertir timestamps de la API al formato que espera la plantilla
            const processedMessages = data.messages.map(msg => {
                if (msg.timestamp && typeof msg.timestamp._seconds === 'number') {
                    return { ...msg, timestamp: { seconds: msg.timestamp._seconds, nanoseconds: msg.timestamp._nanoseconds } };
                }
                return msg;
            });

            // La API devuelve [nuevo..viejo], lo invertimos para tener [viejo..nuevo]
            const chronologicalMessages = processedMessages.reverse();

            // El `state.selectedContactId` se usa globalmente en MessageBubbleTemplate, 
            // así que lo seteamos temporalmente para que renderice correctamente
            const originalSelectedId = state.selectedContactId;
            state.selectedContactId = previewState.contactId;

            const newMessagesHtml = chronologicalMessages.map(MessageBubbleTemplate).join('');
            
            state.selectedContactId = originalSelectedId; // Lo restauramos

            const contentDiv = document.getElementById('preview-messages-content');
            const container = document.getElementById('preview-messages-container');
            const isFirstLoad = previewState.messages.length === 0;
            
            // Guardamos la altura del scroll antes de añadir contenido nuevo
            const oldScrollHeight = container.scrollHeight;
            
            if (isFirstLoad) {
                contentDiv.innerHTML = newMessagesHtml;
            } else {
                contentDiv.insertAdjacentHTML('afterbegin', newMessagesHtml);
            }

            previewState.messages.unshift(...chronologicalMessages);
            
            // El timestamp para la siguiente página es el del mensaje MÁS ANTIGUO que acabamos de recibir
            const oldestNewMsg = chronologicalMessages[0];
            previewState.lastMessageTimestamp = oldestNewMsg.timestamp.seconds;

            if (isFirstLoad) {
                // Si es la primera carga, hacemos scroll hasta el final para ver los mensajes más recientes
                container.scrollTop = container.scrollHeight;
            } else {
                // Si no, mantenemos la posición del scroll relativa al contenido que había antes
                container.scrollTop = container.scrollHeight - oldScrollHeight;
            }
        }

        if (data.messages.length < 30) {
            previewState.hasMore = false;
            const contentDiv = document.getElementById('preview-messages-content');
            if (contentDiv) {
                contentDiv.insertAdjacentHTML('afterbegin', `<div class="date-separator">Inicio de la conversación</div>`);
            }
        }

    } catch (error) {
        console.error("Error cargando mensajes de previsualización:", error);
        const contentDiv = document.getElementById('preview-messages-content');
        if (contentDiv && previewState.messages.length === 0) {
            if(spinner) spinner.style.display = 'none';
            contentDiv.innerHTML = `<p class="p-4 text-red-500 text-center">${error.message}</p>`;
        }
    } finally {
        previewState.isLoading = false;
    }
}


function handlePreviewScroll() {
    const container = document.getElementById('preview-messages-container');
    // Cargar más cuando el usuario llega a la parte superior del scroll
    if (container.scrollTop === 0 && previewState.hasMore && !previewState.isLoading) {
        loadMorePreviewMessages();
    }
}
// --- END: Conversation Preview Logic ---

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


// --- START: Bot Toggle Logic ---
async function handleBotToggle(contactId, isActive) {
    try {
        // 1. Actualización optimista de la UI
        const contactIndex = state.contacts.findIndex(c => c.id === contactId);
        if (contactIndex > -1) {
            state.contacts[contactIndex].botActive = isActive;
            
            // Refrescar lista de contactos para ver el aro pulsante/icono
            scheduleContactListRender();
            
            // Si el chat está abierto, refrescar cabecera
            if (state.selectedContactId === contactId) {
                renderChatWindow();
            }
        }

        // 2. Persistir
        if (isActive) {
            // Encender: vía backend, que además contesta el mensaje del cliente sin responder
            // (si lo hay), igual que el botón de post-venta. No toca la etapa del contacto.
            const resp = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/activate-ai`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            await resp.json().catch(() => ({}));
        } else {
            // Apagar: solo escribir Firestore (no hay nada que disparar)
            await db.collection("contacts_whatsapp").doc(contactId).update({ botActive: false });
        }

    } catch (error) {
        console.error("Error al cambiar estado de la IA:", error);
        if (window.showError) showError("No se pudo cambiar el estado de la IA.");
        // Revertir cambio optimista si falla
        const contactIndex = state.contacts.findIndex(c => c.id === contactId);
        if (contactIndex > -1) {
            state.contacts[contactIndex].botActive = !isActive;
            if (state.selectedContactId === contactId) {
                renderChatWindow();
            }
        }
    }
}
// --- END: Bot Toggle Logic ---

// --- START: Stage Reset Logic (post-venta -> venta para nuevo pedido) ---
async function handleStageReset(contactId) {
    const contact = state.contacts.find(c => c.id === contactId);
    const name = (contact && contact.name) || 'este contacto';
    if (!window.confirm(`¿Regresar a ${name} a la etapa de VENTA para un nuevo pedido? La IA volverá a atender como en una venta normal (deja de estar en post-venta).`)) return;

    const contactIndex = state.contacts.findIndex(c => c.id === contactId);
    try {
        // 1. Actualización optimista de la UI
        if (contactIndex > -1) {
            state.contacts[contactIndex].aiStage = 'venta';
            scheduleContactListRender();
            if (state.selectedContactId === contactId) renderChatWindow();
        }
        // 2. Persistir en Firestore (el bot sigue activo; el próximo turno lo atiende ventas)
        await db.collection('contacts_whatsapp').doc(contactId).update({ aiStage: 'venta' });
    } catch (error) {
        console.error('Error al regresar el chat a la etapa de venta:', error);
        if (window.showError) showError('No se pudo regresar el chat a la etapa de venta.');
        // Revertir cambio optimista
        if (contactIndex > -1) {
            state.contacts[contactIndex].aiStage = 'postventa';
            if (state.selectedContactId === contactId) renderChatWindow();
        }
    }
}
// --- END: Stage Reset Logic ---

// --- START: Activar Post-venta a mano (venta -> post-venta, sin enviar /final) ---
async function handleActivatePostventa(contactId) {
    const contact = state.contacts.find(c => c.id === contactId);
    const name = (contact && contact.name) || 'este contacto';
    if (!window.confirm(`¿Activar la IA de POST-VENTA para ${name}? Empezará a atender cobro, validación de comprobante y entrega, y se ENCENDERÁ la IA del chat. NO se le envía ningún mensaje al cliente (a diferencia de /final).`)) return;

    const contactIndex = state.contacts.findIndex(c => c.id === contactId);
    const prev = contactIndex > -1
        ? { aiStage: state.contacts[contactIndex].aiStage, botActive: state.contacts[contactIndex].botActive }
        : null;
    try {
        // 1. Actualización optimista de la UI
        if (contactIndex > -1) {
            state.contacts[contactIndex].aiStage = 'postventa';
            state.contacts[contactIndex].botActive = true;
            scheduleContactListRender();
            if (state.selectedContactId === contactId) renderChatWindow();
        }
        // 2. Endpoint backend: pasa a etapa 2, enciende la IA y, si hay un mensaje del cliente
        //    sin contestar, dispara la IA para que lo revise y responda (sin mandar /final).
        const resp = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/activate-postventa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        await resp.json().catch(() => ({}));
        // Si había un mensaje sin contestar, el backend ya disparó la IA; la UI muestra el
        // estado "generando" en el chat. El robot ámbar + badge confirman la activación.
    } catch (error) {
        console.error('Error al activar la post-venta:', error);
        if (window.showError) showError('No se pudo activar la post-venta.');
        // Revertir cambio optimista (el listener de Firestore corrige igual)
        if (contactIndex > -1 && prev) {
            state.contacts[contactIndex].aiStage = prev.aiStage;
            state.contacts[contactIndex].botActive = prev.botActive;
            if (state.selectedContactId === contactId) renderChatWindow();
        }
    }
}
// --- END: Activar Post-venta a mano ---

// --- START: Recordatorio programado a fecha futura (plantilla + IA) ---

// Trae el estado del recordatorio del contacto y pinta el badge en el chat.
async function fetchReminder(contactId) {
    if (!contactId) return;
    if (!state.reminderByContact) state.reminderByContact = {};
    try {
        const res = await fetch(`${API_BASE_URL}/api/reminders/contact/${encodeURIComponent(contactId)}`);
        state.reminderByContact[contactId] = (await res.json()) || { exists: false };
    } catch (e) {
        state.reminderByContact[contactId] = { exists: false };
    }
    if (state.selectedContactId === contactId) {
        const host = document.getElementById('reminder-host');
        if (host && typeof ReminderBadge === 'function') {
            const contact = (state.contacts || []).find(c => c.id === contactId) || { id: contactId };
            host.innerHTML = ReminderBadge(contact);
        }
    }
}

function reminderEscapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function closeReminderModal() {
    const el = document.getElementById('reminder-modal-overlay');
    if (el) el.remove();
}

// Modal autocontenido: fijar/editar fecha + mensaje, pedir sugerencia a la IA, guardar o cancelar.
async function openReminderModal(contactId) {
    closeReminderModal();
    const contact = (state.contacts || []).find(c => c.id === contactId) || { id: contactId };
    const name = reminderEscapeHtml(contact.name || 'este contacto');
    const minDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10); // mañana

    const overlay = document.createElement('div');
    overlay.id = 'reminder-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
        <div style="background:var(--color-surface,#fff);color:var(--color-text,#111827);width:100%;max-width:460px;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.3);overflow:hidden;">
            <div style="padding:16px 18px;border-bottom:1px solid rgba(0,0,0,.08);display:flex;align-items:center;gap:8px;">
                <i class="fas fa-calendar-plus" style="color:#4f46e5;"></i>
                <strong style="font-size:15px;">Recordatorio programado</strong>
                <span style="margin-left:auto;font-size:12px;color:#888;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
            </div>
            <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
                <div id="reminder-status-line" style="font-size:12px;color:#6b7280;min-height:16px;"></div>
                <label style="font-size:12px;font-weight:600;">Fecha de envío
                    <input id="reminder-date" type="date" min="${minDate}" style="width:100%;margin-top:4px;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;background:#fff;color:#111;">
                </label>
                <label style="font-size:12px;font-weight:600;">Mensaje (la IA lo redacta; puedes editarlo)
                    <textarea id="reminder-message" rows="3" placeholder="Ej. ¿Ya supiste si tu bebé es niño o niña? Retomamos tus 2 lámparas con la promo 🎉" style="width:100%;margin-top:4px;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;resize:vertical;background:#fff;color:#111;"></textarea>
                </label>
                <button id="reminder-suggest" type="button" style="align-self:flex-start;font-size:13px;color:#4f46e5;background:none;border:none;cursor:pointer;padding:0;font-weight:600;"><i class="fas fa-wand-magic-sparkles"></i> IA sugiere fecha y mensaje</button>
                <p style="font-size:11px;color:#9ca3af;line-height:1.4;margin:0;">Se enviará ese día con una plantilla aprobada de WhatsApp (la ventana de 24h ya estará cerrada). El texto se inserta en “<strong>¡Hola! 👋 …</strong>” (sin nombre, a propósito).</p>
            </div>
            <div style="padding:12px 18px;border-top:1px solid rgba(0,0,0,.08);display:flex;gap:8px;align-items:center;">
                <button id="reminder-delete" type="button" style="display:none;font-size:13px;color:#dc2626;background:none;border:none;cursor:pointer;"><i class="fas fa-trash"></i> Cancelar recordatorio</button>
                <div style="margin-left:auto;display:flex;gap:8px;">
                    <button id="reminder-close" type="button" style="padding:8px 14px;border:1px solid #d1d5db;background:#fff;color:#111;border-radius:8px;cursor:pointer;font-size:14px;">Cerrar</button>
                    <button id="reminder-save" type="button" style="padding:8px 14px;border:none;background:#4f46e5;color:#fff;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">Guardar</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const $ = id => overlay.querySelector('#' + id);
    const dateEl = $('reminder-date'), msgEl = $('reminder-message'), statusEl = $('reminder-status-line');
    const suggestBtn = $('reminder-suggest'), saveBtn = $('reminder-save'), delBtn = $('reminder-delete');

    overlay.addEventListener('click', e => { if (e.target === overlay) closeReminderModal(); });
    $('reminder-close').addEventListener('click', closeReminderModal);

    // Prefill: si ya hay un recordatorio agendado, cargarlo.
    try {
        const res = await fetch(`${API_BASE_URL}/api/reminders/contact/${encodeURIComponent(contactId)}`);
        const info = await res.json();
        if (info && info.exists && info.status === 'scheduled') {
            if (info.remindDate) dateEl.value = info.remindDate;
            if (info.message) msgEl.value = info.message;
            statusEl.textContent = `Programado para ${info.remindDate || '—'}${info.source === 'ai' ? ' (lo detectó la IA)' : ''}.`;
            delBtn.style.display = 'inline-block';
        } else {
            statusEl.textContent = 'Sin recordatorio. Pon una fecha o pídele una sugerencia a la IA.';
        }
    } catch (e) { statusEl.textContent = ''; }

    suggestBtn.addEventListener('click', async () => {
        suggestBtn.disabled = true;
        const orig = suggestBtn.innerHTML;
        suggestBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pensando…';
        try {
            const res = await fetch(`${API_BASE_URL}/api/reminders/suggest/${encodeURIComponent(contactId)}`, { method: 'POST' });
            const s = await res.json();
            if (s && s.remindDate) dateEl.value = s.remindDate;
            if (s && s.message) msgEl.value = s.message;
            statusEl.textContent = s && s.defer
                ? `IA: el cliente pidió esperar (${s.reason || 'fecha futura'}).`
                : 'IA: no detectó un aplazamiento claro; propuse un default editable.';
        } catch (e) {
            if (window.showError) showError('No se pudo generar la sugerencia.');
        } finally {
            suggestBtn.disabled = false;
            suggestBtn.innerHTML = orig;
        }
    });

    saveBtn.addEventListener('click', async () => {
        const remindAt = dateEl.value;
        if (!remindAt) { if (window.showError) showError('Elige una fecha.'); return; }
        saveBtn.disabled = true;
        const orig = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            const res = await fetch(`${API_BASE_URL}/api/reminders/contact/${encodeURIComponent(contactId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ remindAt, message: msgEl.value || '' })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (window.showSuccess) showSuccess('Recordatorio programado.');
            closeReminderModal();
            fetchReminder(contactId);
        } catch (e) {
            if (window.showError) showError('No se pudo guardar el recordatorio.');
            saveBtn.disabled = false;
            saveBtn.innerHTML = orig;
        }
    });

    delBtn.addEventListener('click', async () => {
        if (!window.confirm('¿Cancelar este recordatorio programado?')) return;
        try {
            await fetch(`${API_BASE_URL}/api/reminders/contact/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
            if (window.showSuccess) showSuccess('Recordatorio cancelado.');
            closeReminderModal();
            fetchReminder(contactId);
        } catch (e) {
            if (window.showError) showError('No se pudo cancelar.');
        }
    });
}
// --- END: Recordatorio programado ---

// --- START: Reenviar mensaje a otro contacto (+ recientes) ---
const FORWARD_RECENTS_KEY = 'crm_forward_recents';

function getForwardRecents() {
    try { return JSON.parse(localStorage.getItem(FORWARD_RECENTS_KEY) || '[]'); }
    catch (e) { return []; }
}

function pushForwardRecent(contact) {
    try {
        let recents = getForwardRecents().filter(c => c && c.id && c.id !== contact.id);
        recents.unshift({ id: contact.id, name: contact.name || contact.id });
        localStorage.setItem(FORWARD_RECENTS_KEY, JSON.stringify(recents.slice(0, 8)));
    } catch (e) { /* localStorage no disponible: recientes opcional */ }
}

function escapeForwardHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Abre el selector de contacto para reenviar el mensaje (texto y/o multimedia).
function handleForwardMessage(event, docId) {
    if (event) event.stopPropagation();
    const msg = (state.messages || []).find(m => m.docId === docId);
    if (!msg) { if (window.showError) showError('No se encontró el mensaje a reenviar.'); return; }
    if (!msg.text && !msg.fileUrl) { if (window.showError) showError('Este mensaje no se puede reenviar.'); return; }
    state.forwardingMessage = msg;
    openForwardModal();
}

function closeForwardModal() {
    const o = document.getElementById('forward-modal-overlay');
    if (o) o.remove();
}

function openForwardModal() {
    closeForwardModal();
    const msg = state.forwardingMessage;
    let preview = '';
    if (msg) {
        if (msg.fileUrl) {
            const kind = msg.type === 'audio' ? 'Audio' : msg.type === 'image' ? 'Imagen' : msg.type === 'video' ? 'Video' : 'Archivo';
            preview = `📎 ${kind}${msg.text ? ': ' + msg.text : ''}`;
        } else {
            preview = msg.text || '';
        }
    }
    const overlay = document.createElement('div');
    overlay.id = 'forward-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:8vh;background:rgba(0,0,0,.45);';
    overlay.innerHTML = `
        <div style="background:var(--color-container-bg,#fff);border:1px solid var(--color-border,rgba(0,0,0,.08));border-radius:16px;width:380px;max-width:92vw;max-height:78vh;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.22);font-family:var(--font-body,Inter,sans-serif);overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--color-border,rgba(0,0,0,.08));">
                <span style="font-weight:700;font-size:15px;color:var(--color-text,#1c1c1a);">Reenviar a…</span>
                <button onclick="closeForwardModal()" style="border:none;background:transparent;cursor:pointer;color:var(--color-text-light,#888);font-size:16px;"><i class="fas fa-times"></i></button>
            </div>
            ${preview ? `<div style="padding:8px 18px;font-size:12px;color:var(--color-text-light,#888);border-bottom:1px solid var(--color-border,rgba(0,0,0,.06));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Reenviando: ${escapeForwardHtml(preview).slice(0, 90)}</div>` : ''}
            <div style="padding:12px 14px;">
                <input type="text" id="forward-search-input" placeholder="Buscar por nombre o número…" autocomplete="off" style="width:100%;padding:9px 12px;border:1px solid var(--color-border,#ddd);border-radius:10px;font-size:13px;background:var(--color-subtle-bg,#f7f7f5);color:var(--color-text,#1c1c1a);outline:none;box-sizing:border-box;">
            </div>
            <div id="forward-results" style="overflow-y:auto;padding:0 8px 10px;"></div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeForwardModal(); });
    const input = document.getElementById('forward-search-input');
    let t;
    input.addEventListener('input', () => { clearTimeout(t); const q = input.value.trim(); t = setTimeout(() => renderForwardResults(q), 250); });
    renderForwardResults('');
    setTimeout(() => input.focus(), 50);
}

function forwardRowHTML(c) {
    const name = escapeForwardHtml(c.name || c.id);
    const idAttr = escapeForwardHtml(c.id);
    return `<button class="forward-row" data-id="${idAttr}" data-name="${name}" style="display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:none;background:transparent;cursor:pointer;border-radius:10px;text-align:left;color:var(--color-text,#1c1c1a);">
        <span style="width:32px;height:32px;border-radius:50%;background:var(--color-subtle-bg,#eee);display:flex;align-items:center;justify-content:center;color:var(--color-text-light,#888);flex-shrink:0;"><i class="fas fa-user"></i></span>
        <span style="flex:1;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
        <i class="fas fa-share" style="color:var(--color-primary,#ea580c);font-size:13px;"></i>
    </button>`;
}

function bindForwardRows(box) {
    box.querySelectorAll('.forward-row').forEach(btn => {
        btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--color-subtle-bg,#f4f4f2)'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        btn.addEventListener('click', () => doForward(btn.dataset.id, btn.dataset.name));
    });
}

async function renderForwardResults(query) {
    const box = document.getElementById('forward-results');
    if (!box) return;
    const emptyStyle = 'padding:18px;text-align:center;font-size:12px;color:var(--color-text-light,#999);';
    if (!query) {
        const recents = getForwardRecents();
        box.innerHTML = recents.length
            ? `<div style="padding:8px 12px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-light,#999);">Recientes</div>` + recents.map(forwardRowHTML).join('')
            : `<div style="${emptyStyle}">Escribe para buscar un contacto.</div>`;
        bindForwardRows(box);
        return;
    }
    box.innerHTML = `<div style="${emptyStyle}">Buscando…</div>`;
    try {
        const resp = await fetch(`${API_BASE_URL}/api/contacts/search?query=${encodeURIComponent(query)}`);
        const data = await resp.json();
        const contacts = (data.contacts || []).slice(0, 25).map(c => ({ id: c.id, name: c.name || c.profileName || c.id }));
        box.innerHTML = contacts.length ? contacts.map(forwardRowHTML).join('') : `<div style="${emptyStyle}">Sin resultados.</div>`;
    } catch (e) {
        box.innerHTML = `<div style="${emptyStyle}">Error al buscar.</div>`;
    }
    bindForwardRows(box);
}

async function doForward(targetId, targetName) {
    const msg = state.forwardingMessage;
    if (!msg || !targetId) { closeForwardModal(); return; }
    // Fuera de la ventana de 24h Meta acepta el mensaje pero luego lo marca como
    // fallido (131047) y nunca llega: avisar antes de reenviar.
    try {
        const wResp = await fetch(`${API_BASE_URL}/api/contacts/${targetId}/window-state`);
        const w = await wResp.json();
        if (wResp.ok && w && w.windowOpen === false) {
            const ok = confirm(`⚠️ ${targetName} lleva más de 24h sin escribir.\nWhatsApp probablemente NO entregue este reenvío (fuera de la ventana de 24h; solo llegan plantillas).\n\n¿Reenviar de todos modos?`);
            if (!ok) return;
        }
    } catch (e) { /* si el check falla, continuar con el reenvío normal */ }
    const payload = { forwarded: true };
    if (msg.text) payload.text = msg.text;
    if (msg.fileUrl) { payload.fileUrl = msg.fileUrl; payload.fileType = msg.fileType || ''; }
    closeForwardModal();
    try {
        const resp = await fetch(`${API_BASE_URL}/api/contacts/${targetId}/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.message || ('HTTP ' + resp.status));
        pushForwardRecent({ id: targetId, name: targetName });
        showForwardToast(`Reenviado a ${targetName} ✅`);
    } catch (e) {
        if (window.showError) showError('No se pudo reenviar: ' + (e.message || ''));
    }
    state.forwardingMessage = null;
}

function showForwardToast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:10000;background:var(--color-text,#1c1c1a);color:#fff;padding:10px 18px;border-radius:24px;font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.25);font-family:var(--font-body,Inter,sans-serif);';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
}

window.handleForwardMessage = handleForwardMessage;
window.closeForwardModal = closeForwardModal;
// --- END: Reenviar mensaje a otro contacto ---

// --- START: Read Receipt (hora de visto) ---
/**
 * Muestra un tooltip con la hora (y la fecha si fue otro día) en que el
 * destinatario vio el mensaje. Se dispara al hacer click en la palomita azul.
 * @param {Event} event Evento de click (para posicionar y evitar propagación).
 * @param {number} readSeconds Epoch en segundos del momento de lectura.
 */
function showReadReceipt(event, readSeconds) {
    if (event) event.stopPropagation();
    if (!readSeconds) return;

    const date = new Date(readSeconds * 1000);
    const hora = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    let texto;
    if (typeof isSameDay === 'function' && isSameDay(date, new Date())) {
        texto = `Visto hoy a las ${hora}`;
    } else {
        const fecha = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
        texto = `Visto el ${fecha} a las ${hora}`;
    }

    let tip = document.getElementById('read-receipt-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'read-receipt-tooltip';
        tip.className = 'read-receipt-tooltip';
        document.body.appendChild(tip);
    }
    tip.innerHTML = `<i class="fas fa-check-double" style="color:#53bdeb;"></i> ${texto}`;
    tip.style.display = 'block';
    tip.style.visibility = 'hidden';

    // Posicionar arriba del punto del click, sin salirse de la pantalla
    const x = event ? event.clientX : window.innerWidth / 2;
    const y = event ? event.clientY : window.innerHeight / 2;
    requestAnimationFrame(() => {
        const rect = tip.getBoundingClientRect();
        let left = x - rect.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
        let top = y - rect.height - 10;
        if (top < 8) top = y + 16; // si no cabe arriba, mostrar debajo
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
        tip.style.visibility = 'visible';
    });

    // Cerrar al hacer click en cualquier lado o tras unos segundos
    clearTimeout(tip._hideTimer);
    tip._hideTimer = setTimeout(hideReadReceipt, 4000);
    setTimeout(() => document.addEventListener('click', hideReadReceipt, { once: true }), 0);
}

function hideReadReceipt() {
    const tip = document.getElementById('read-receipt-tooltip');
    if (tip) tip.style.display = 'none';
}
// --- END: Read Receipt ---

// Exportar las funciones globalmente
window.handleMarkAsUnread = handleMarkAsUnread;
window.handleBotToggle = handleBotToggle;
window.handleStageReset = handleStageReset;
window.handleActivatePostventa = handleActivatePostventa;
window.openReminderModal = openReminderModal;
window.fetchReminder = fetchReminder;
window.showReadReceipt = showReadReceipt;


/**
 * Maneja el borrado del historial de chat después de la confirmación del usuario.
 * @param {string} contactId ID del contacto.
 */
async function handleClearChatHistory(contactId) {
    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact) return;

    const confirmed = confirm(`¿Estás seguro de que deseas borrar TODO el historial de chat con ${contact.name || contactId}? Esta acción NO se puede deshacer.`);
    
    if (confirmed) {
        try {
            if (window.showError) showError("Iniciando borrado de historial...", "info");
            
            await deleteContactMessagesAPI(contactId);
            
            // Si el contacto borrado es el actual, limpiar los mensajes en el estado y UI
            if (state.selectedContactId === contactId) {
                state.messages = [];
                renderChatWindow({ preserveScroll: false });
            }
            
            if (window.showError) showError("Historial borrado con éxito.", "success");
        } catch (error) {
            console.error("Error al borrar historial:", error);
            if (window.showError) showError("No se pudo borrar el historial: " + error.message);
            else alert("No se pudo borrar el historial: " + error.message);
        }
    }
}

window.handleClearChatHistory = handleClearChatHistory;
