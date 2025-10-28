// --- START: Event Handlers for the Chat View ---

// --- Importaciones (Asegúrate de que las rutas sean correctas) ---
// Asumimos que estas funciones existen o se crearán en api-service.js
import { searchContactsAPI, uploadAndSendFileViaAPI, sendMessageViaAPI, sendTemplateViaAPI, reactToMessageViaAPI, sendWebMessage } from './api-service.js';
// Asumimos que hay una forma de obtener el estado de la conexión web
import { getWebConnectionStatus } from './web-utils.js'; // Necesitarás crear este archivo/función

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


// CORREGIDO: Ahora también se encarga de ocultar el mensaje de "Cargando..."
function handleSearchContacts() {
    const contactsToRender = state.contacts;
    const contactsListEl = document.getElementById('contacts-list');
    const contactsLoadingEl = document.getElementById('contacts-loading'); // Obtener el elemento de carga

    if (contactsListEl) {
        contactsListEl.innerHTML = contactsToRender.map(c => ContactItemTemplate(c, c.id === state.selectedContactId)).join('');
    }

    // Ocultar el mensaje de "Cargando..." después de que la lista de contactos ha sido renderizada.
    if (contactsLoadingEl) {
        contactsLoadingEl.style.display = 'none';
    }
}

// Nueva función que configura el scroll infinito y el drag & drop
function setupChatListEventListeners() {
    const contactsList = document.getElementById('contacts-list');
    if (!contactsList) return;

    // Lógica de Scroll Infinito
    contactsList.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = contactsList;
        // Si el scroll está cerca del final (a menos de 200px), carga más
        if (scrollHeight - scrollTop - clientHeight < 200) {
            fetchMoreContacts();
        }
    });

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
        if (files.length > 0) {
            stageFile(files[0]);
        }
    });
}


// --- LÓGICA DE CHAT EXISTENTE (CON MODIFICACIONES PARA WEB/API) ---

function renderChatWindow() {
    if (state.activeView !== 'chats') return;

    const chatPanelEl = document.getElementById('chat-panel');
    if (!chatPanelEl) return;

    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    chatPanelEl.innerHTML = ChatWindowTemplate(contact);

    const searchInputEl = document.getElementById('search-contacts-input');
    if (searchInputEl) {
        searchInputEl.addEventListener('input', handleSearchInput);
        // Add clear button listener if it exists within the template
        const clearBtn = document.getElementById('clear-search-btn');
        if (clearBtn) {
             clearBtn.addEventListener('click', () => {
                searchInputEl.value = '';
                searchInputEl.dispatchEvent(new Event('input'));
                searchInputEl.focus();
            });
            clearBtn.classList.toggle('hidden', searchInputEl.value.length === 0);
        }
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
            if (messageForm) messageForm.addEventListener('submit', handleSendMessage); // Modificado para elegir método
            if (messageInput) {
                messageInput.addEventListener('paste', handlePaste);
                messageInput.addEventListener('input', handleQuickReplyInput);
                messageInput.addEventListener('keydown', handleMessageInputKeyDown);

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
            const noteForm = document.getElementById('note-form');
            if (noteForm) noteForm.addEventListener('submit', handleSaveNote);
        }
        setupDragAndDropForChatArea();
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
            // Solo adjuntar si el input no está deshabilitado (sesión de chat activa)
            const messageInput = document.getElementById('message-input');
            if (messageInput && !messageInput.disabled) {
                stageFile(files[0]); // Usar la función existente para manejar el archivo
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
        state.contacts[contactIdx].unreadCount = 0;
    }

    // La actualización en la base de datos sigue siendo importante
    db.collection('contacts_whatsapp').doc(contactId).update({ unreadCount: 0 }).catch(err => console.error("Error al resetear contador:", err));

    state.selectedContactId = contactId;
    state.loadingMessages = true;
    state.activeTab = 'chat';
    state.isEditingNote = null;

    // Re-renderizamos la lista para que el contacto seleccionado se marque visualmente
    handleSearchContacts();

    let isInitialMessageLoad = true;
    unsubscribeMessagesListener = db.collection('contacts_whatsapp').doc(contactId).collection('messages').orderBy('timestamp', 'asc')
        .onSnapshot((snapshot) => {
            hideError();
            const newMessages = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));

            if (isInitialMessageLoad) {
                state.messages = newMessages;
                state.loadingMessages = false;
                isInitialMessageLoad = false;
            } else {
                snapshot.docChanges().forEach((change) => {
                    const changedMessage = { docId: change.doc.id, ...change.doc.data() };
                    const existingIndex = state.messages.findIndex(m => m.docId === change.doc.id);

                    if (change.type === "added") {
                        if (existingIndex === -1) {
                            state.messages.push(changedMessage);
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

            // Recalcular el estado de la sesión cada vez que llegan mensajes
            const lastUserMessage = newMessages.slice().reverse().find(m => m.from === contactId);
            if (lastUserMessage && lastUserMessage.timestamp) {
                const hoursDiff = (new Date().getTime() - (lastUserMessage.timestamp.seconds * 1000)) / 3600000;
                state.isSessionExpired = hoursDiff > 24;
            } else {
                state.isSessionExpired = newMessages.length > 0; // Si hay mensajes pero ninguno del usuario, la sesión está expirada
            }

            if (state.activeTab === 'chat') {
                renderMessages();
            }

        }, (error) => {
            console.error(error);
            showError(`Error al cargar mensajes.`);
            state.loadingMessages = false;
            state.messages = [];
            if (state.activeTab === 'chat') renderMessages();
        });

    unsubscribeNotesListener = db.collection('contacts_whatsapp').doc(contactId).collection('notes').orderBy('timestamp', 'desc').onSnapshot( (snapshot) => { state.notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if(state.selectedContactId === contactId) renderChatWindow(); }, (error) => { console.error(error); showError('Error al cargar notas.'); state.notes = []; if(state.activeTab === 'notes') renderNotes(); });

    renderChatWindow();

    openContactDetails();
}

/**
 * --- MODIFICADO: Maneja el envío de mensajes, eligiendo entre API o Web ---
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSendMessage(event) {
    event.preventDefault();
    const input = document.getElementById('message-input');
    let text = input.value.trim();
    const contactId = state.selectedContactId; // Usa el ID del estado
    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact || state.isUploading) return;

    const fileToSend = state.stagedFile;
    const remoteFileToSend = state.stagedRemoteFile;

    if (!text && !fileToSend && !remoteFileToSend) return;

    // --- Inicio: Lógica para elegir el método ---
    let connectionMethod = 'api'; // Por defecto, usar la API oficial
    try {
        // Llama a una función (que deberás crear en otro módulo, ej: web-utils.js)
        // para obtener el estado actual de la conexión web.
        const webStatus = await getWebConnectionStatus(); // Ej: retorna { status: 'connected' | 'disconnected' | ... }
        if (webStatus && webStatus.status === 'connected') {
            connectionMethod = 'web';
            console.log("Usando método de envío: WhatsApp Web");
        } else {
            console.log("Usando método de envío: WhatsApp API Oficial");
        }
    } catch (statusError) {
        console.warn("No se pudo verificar el estado de WhatsApp Web, usando API Oficial por defecto.", statusError);
        connectionMethod = 'api'; // Volver a API si hay error al verificar estado
    }
    // --- Fin: Lógica para elegir el método ---

    const isApiMethod = connectionMethod === 'api';
    const isExpired = state.isSessionExpired; // Solo relevante para la API oficial
    // Determina si se debe encolar (solo para API y si expiró)
    const shouldQueue = isApiMethod && isExpired;

    // UI optimista: Muestra el mensaje como pendiente o encolado
    const tempId = `temp_${Date.now()}`;
    const pendingMessage = {
        docId: tempId,
        from: 'me', // Identificador para mensajes salientes en la UI
        status: shouldQueue ? 'queued' : 'pending',
        timestamp: { seconds: Math.floor(Date.now() / 1000) },
        text: text || (fileToSend ? '📷 Adjunto' : (remoteFileToSend ? '📎 Archivo Rápido' : '📄 Adjunto')),
    };
    if (remoteFileToSend) { // Añadir detalles del archivo remoto para la UI
        pendingMessage.fileUrl = remoteFileToSend.url;
        pendingMessage.fileType = remoteFileToSend.type;
    }
    if (state.replyingToMessage) { // Añadir contexto para la UI
        pendingMessage.context = { id: state.replyingToMessage.docId }; // Usar docId para referencia interna
    }

    state.messages.push(pendingMessage);
    appendMessage(pendingMessage); // Añade visualmente a la lista

    // Limpia input y archivo preparado
    input.value = '';
    input.style.height = 'auto';
    cancelStagedFile(); // Limpia archivos locales y remotos preparados

    try {
        // --- Lógica de envío ---
        if (fileToSend) {
            // Si hay un archivo local, primero subirlo a GCS
            const publicUrl = await uploadFileToGCS(fileToSend); // Necesitas crear esta función en api-service.js

            // Luego, enviar usando el método elegido
            if (isApiMethod) {
                // Llama a la función de API (existente o modificada)
                await sendMessageViaAPI(contactId, { text, fileUrl: publicUrl, fileType: fileToSend.type, reply_to_wamid: state.replyingToMessage?.id, shouldQueue });
            } else {
                // Llama a la nueva función para Web
                await sendWebMessage(contactId, { text, fileUrl: publicUrl, fileType: fileToSend.type, reply_to_wamid: state.replyingToMessage?.id });
            }
        } else {
            // Si no hay archivo local (puede ser texto solo o archivo remoto de QR)
            const messageData = {
                text: text,
                fileUrl: remoteFileToSend?.url || null,
                fileType: remoteFileToSend?.type || null,
                reply_to_wamid: state.replyingToMessage?.id || null, // ID del mensaje original de WA
                tempId: tempId // ID temporal para posible actualización si falla
            };

            if (isApiMethod) {
                // Llama a la función de API (existente o modificada)
                await sendMessageViaAPI(contactId, { ...messageData, shouldQueue });
                // Resetear contador de no leídos solo si NO se encola
                if (!shouldQueue) {
                    await db.collection('contacts_whatsapp').doc(contactId).update({ unreadCount: 0 });
                }
            } else {
                // Llama a la nueva función para Web
                await sendWebMessage(contactId, messageData);
                // Resetear contador inmediatamente para Web
                await db.collection('contacts_whatsapp').doc(contactId).update({ unreadCount: 0 });
            }
        }
        cancelReply(); // Limpia el contexto de respuesta si el envío fue exitoso
    } catch (error) {
        console.error("Error en el proceso de envío:", error);
        showError(error.message || 'Error desconocido al enviar.'); // Muestra error al usuario

        // Actualiza el mensaje temporal a 'failed' en la UI
        const failedMessageIndex = state.messages.findIndex(m => m.docId === tempId);
        if (failedMessageIndex > -1) {
            state.messages[failedMessageIndex].status = 'failed';
            // Vuelve a renderizar mensajes para mostrar el estado fallido
            // Podrías optimizar esto para solo actualizar el mensaje específico
            renderMessages();
        }
        // Restaurar texto en el input si era solo texto y falló
        if (text && !fileToSend && !remoteFileToSend) {
            input.value = text;
        }
        // No limpiar el archivo preparado si falló el envío con archivo
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
    if (!confirm('¿Estás seguro de que quieres eliminar esta nota?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/notes/${noteId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('No se pudo eliminar la nota.');
    } catch (error) { showError(error.message); }
}

/**
 * --- MODIFICADO: Sube archivo a GCS y luego envía usando el método activo ---
 * @param {File} file El archivo a subir y enviar.
 * @param {string} textCaption El texto que acompaña al archivo.
 * @returns {Promise<Response>} La respuesta del fetch al endpoint de envío (API o Web).
 */
async function uploadAndSendFile(file, textCaption) {
    if (!file || !state.selectedContactId || state.isUploading) {
        throw new Error("No se puede enviar el archivo ahora.");
    }
    const progressEl = document.getElementById('upload-progress');
    const submitButton = document.querySelector('#message-form button[type="submit"]');

    state.isUploading = true;
    if (progressEl) {
        progressEl.textContent = 'Subiendo 0%...';
        progressEl.classList.remove('hidden');
    }
    if (submitButton) submitButton.disabled = true;

    try {
        // --- 1. Subir a GCS (Usando la función que ya existe o crearás en api-service.js) ---
        const publicUrl = await uploadFileToGCS(file, (progress) => {
            if (progressEl) progressEl.textContent = `Subiendo ${Math.round(progress)}%...`;
        });

        // --- 2. Determinar método de envío ---
        let connectionMethod = 'api';
        try {
            const webStatus = await getWebConnectionStatus();
            if (webStatus && webStatus.status === 'connected') {
                connectionMethod = 'web';
            }
        } catch (statusError) {
            console.warn("Error al verificar estado Web, usando API por defecto.", statusError);
        }

        // --- 3. Enviar usando el método determinado ---
        const isApiMethod = connectionMethod === 'api';
        const isExpired = state.isSessionExpired;
        const shouldQueue = isApiMethod && isExpired;

        const messageData = {
            text: textCaption,
            fileUrl: publicUrl,
            fileType: file.type,
            reply_to_wamid: state.replyingToMessage?.id || null, // ID del mensaje original
        };

        let response;
        if (isApiMethod) {
            // Llama a la función de API (existente o modificada)
            response = await sendMessageViaAPI(state.selectedContactId, { ...messageData, shouldQueue });
        } else {
            // Llama a la nueva función para Web
            response = await sendWebMessage(state.selectedContactId, messageData);
        }

        return response; // Devuelve la respuesta del fetch

    } catch (error) {
        // El manejo de errores ya está fuera de esta función en handleSendMessage
        throw error; // Re-lanza el error para que handleSendMessage lo capture
    } finally {
        state.isUploading = false;
        if (progressEl) progressEl.classList.add('hidden');
        if (submitButton) submitButton.disabled = false;
    }
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

function stageFile(file) { if (!file || state.isUploading) return; if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/') && !file.type.startsWith('application/pdf') ) { showError('Solo se pueden adjuntar imágenes, videos, audios y PDF.'); return; } state.stagedFile = file; state.stagedRemoteFile = null; renderFilePreview(); }

function cancelStagedFile() {
    if (state.stagedFile && typeof URL.revokeObjectURL === 'function') {
         // Check if revokeObjectURL exists before calling
         try {
            URL.revokeObjectURL(state.stagedFile); // Clean up object URL
         } catch(e) { console.warn("Could not revoke object URL", e); }
    }
    state.stagedFile = null;
    state.stagedRemoteFile = null;
    const fileInput = document.getElementById('file-input');
    if(fileInput) fileInput.value = null; // Reset file input
    renderFilePreview();
}

function handleFileInputChange(event) { const file = event.target.files[0]; if (file) stageFile(file); }

function handlePaste(event) { const items = (event.clipboardData || event.originalEvent.clipboardData).items; for (let i = 0; i < items.length; i++) { if (items[i].kind === 'file') { const file = items[i].getAsFile(); if(file) { event.preventDefault(); stageFile(file); break; } } } }

function setFilter(filter) {
    state.activeFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const filterBtn = document.getElementById(`filter-${filter}`);
    if(filterBtn) filterBtn.classList.add('active');

    // Clear current contacts and trigger a new fetch from the server with the filter
    state.contacts = [];
    fetchInitialContacts();
}

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

function selectEmoji(emoji) {
    const input = document.getElementById('message-input');
    input.value += emoji;
    input.focus();
    // Disparar evento input para actualizar altura si es necesario
    const event = new Event('input', { bubbles: true });
    input.dispatchEvent(event);
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

/**
 * --- MODIFICADO: Llama a la función de API para reacciones ---
 * @param {Event} event Evento del clic.
 * @param {string} messageDocId ID del documento del mensaje en Firestore.
 * @param {string} emoji El emoji seleccionado o null para quitar.
 */
async function handleSelectReaction(event, messageDocId, emoji) {
    event.stopPropagation();
    if (!state.selectedContactId) return;

    const message = state.messages.find(m => m.docId === messageDocId);
    if (!message) return;

    // Determina la nueva reacción (si es la misma, se quita -> null)
    const newReaction = message.reaction === emoji ? null : emoji;

    try {
        // Llama a la función en api-service.js (necesitas crearla)
        await reactToMessageViaAPI(state.selectedContactId, messageDocId, newReaction);
        // La UI se actualizará automáticamente por el listener de mensajes
    } catch (error) {
        console.error("Error al reaccionar:", error);
        showError(error.message || "No se pudo guardar la reacción.");
    }
}


window.toggleReactionMenu = toggleReactionMenu;
window.handleSelectReaction = handleSelectReaction;
window.openConversationPreview = openConversationPreview;
window.handleSelectContact = handleSelectContact;
window.setFilter = setFilter;
window.setActiveTab = setActiveTab;
window.toggleEmojiPicker = toggleEmojiPicker;
window.toggleTemplatePicker = toggleTemplatePicker;
window.handleStartReply = handleStartReply;
window.cancelReply = cancelReply;
window.handleStatusChange = handleStatusChange;
window.selectQuickReply = selectQuickReply;
window.selectEmoji = selectEmoji;
window.handleSendTemplate = handleSendTemplate;
window.cancelStagedFile = cancelStagedFile;
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
            // Trigger form submission
            const messageForm = document.getElementById('message-form');
            if (messageForm) {
                // Create a temporary submit button if none exists, click it, then remove it
                let tempSubmit = messageForm.querySelector('button[type="submit"]');
                let addedTempSubmit = false;
                if (!tempSubmit) {
                    tempSubmit = document.createElement('button');
                    tempSubmit.type = 'submit';
                    tempSubmit.style.display = 'none';
                    messageForm.appendChild(tempSubmit);
                    addedTempSubmit = true;
                }
                tempSubmit.click(); // Click the actual or temporary submit button
                if (addedTempSubmit) {
                    messageForm.removeChild(tempSubmit);
                }
            }
        }
        return;
    }

    if (e.key === 'Escape') {
        if (isPickerOpen) {
            e.preventDefault();
            state.quickReplyPickerOpen = false;
            state.templatePickerOpen = false;
            renderAllPickers();
        } else if (state.replyingToMessage) {
            e.preventDefault();
            cancelReply();
        } else if (state.stagedFile || state.stagedRemoteFile) {
             e.preventDefault();
             cancelStagedFile();
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
                <strong>/${reply.shortcut}</strong> - <span class="text-gray-500">${(reply.message || '').substring(0, 50)}...</span> ${reply.fileUrl ? '<i class="fas fa-paperclip text-gray-400 ml-1"></i>': ''}
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

    state.pickerItems = state.templates || [];
    state.pickerSelectedIndex = state.pickerItems.length > 0 ? 0 : -1;

    if (state.templates && state.templates.length > 0) {
        picker.innerHTML = state.templates.map(template => {
            const templateString = JSON.stringify(template).replace(/"/g, '&quot;');
            return `
                <div class="picker-item template-item" data-template-name="${template.name}" onclick="handleSendTemplate(${templateString})">
                    <div class="flex justify-between items-center">
                        <span class="font-semibold">${template.name}</span>
                        <span class="template-category">${template.category}</span>
                    </div>
                     ${template.components.find(c=>c.type === 'BODY')?.text ? `<p class="text-xs text-gray-500 mt-1 truncate">${template.components.find(c=>c.type === 'BODY').text}</p>` : ''}
                </div>
            `;
        }).join('');
    } else {
        picker.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No hay plantillas de WhatsApp disponibles.</div>`;
    }

    updatePickerSelection();
}

function renderEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    if (!picker || picker.innerHTML.includes('emoji-category')) return; // Evita re-renderizado innecesario

    const emojis = {
        'Frecuentes': ['👍', '❤️', '😂', '🎉', '🙏', '😊', '✅', '✨', '👀', '🤔'],
        'Caritas': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😭', '😍', '🥰', '😘', '🥳', '😎', '😢', '🥺'],
        'Gestos': ['👋', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '🤝', '🙌'],
        'Objetos': ['💼', '💻', '📱', '💰', '📦', '📄', '📅', '⏰', '✏️', '📌', '📎', '⚙️', '💡'],
    };

    let pickerHTML = '<div class="picker-content">';
    for (const category in emojis) {
        pickerHTML += `<div class="emoji-category">${category}</div>`;
        pickerHTML += emojis[category].map(emoji => `<span class="emoji" onclick="selectEmoji('${emoji}')">${emoji}</span>`).join('');
    }
    pickerHTML += '</div>';
    picker.innerHTML = pickerHTML;
}

/**
 * --- MODIFICADO: Llama a la función de API para enviar plantillas ---
 * @param {object} templateObject El objeto completo de la plantilla.
 */
async function handleSendTemplate(templateObject) {
    if (!state.selectedContactId) return;

    try {
        // Llama a la función en api-service.js (necesitas crearla)
        await sendTemplateViaAPI(state.selectedContactId, templateObject);
        toggleTemplatePicker(); // Cierra el selector
    } catch (error) {
        console.error("Error al enviar la plantilla:", error);
        showError(error.message || 'Error del servidor al enviar plantilla.');
    }
}
// --- END: Picker Management ---

// --- START: Conversation Preview Logic ---

// Estado local para el modal de previsualización
let previewState = {
    contactId: null,
    messages: [],
    lastMessageTimestamp: null,
    hasMore: true,
    isLoading: false
};

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
    if(!modalContainer) {
        console.error("Error: Container 'conversation-preview-modal-container' not found.");
        return;
    }
    modalContainer.innerHTML = ConversationPreviewModalTemplate(contact);
    document.body.classList.add('modal-open');

    const messagesContainer = document.getElementById('preview-messages-container');
    if (messagesContainer) {
        messagesContainer.addEventListener('scroll', handlePreviewScroll);
        await loadMorePreviewMessages();
    } else {
         console.error("Error: Container 'preview-messages-container' not found in modal template.");
         closeConversationPreviewModal(); // Close if template failed
    }
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
            // Pide mensajes *anteriores* al último que ya tenemos (timestamp en segundos)
            url += `&before=${previewState.lastMessageTimestamp}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('No se pudieron cargar los mensajes.');

        const data = await response.json();

        if (spinner) spinner.style.display = 'none';

        if (data.messages.length > 0) {
            // Convertir timestamps de la API al formato {seconds: ..., nanoseconds: ...}
            const processedMessages = data.messages.map(msg => {
                if (msg.timestamp && typeof msg.timestamp === 'object' && typeof msg.timestamp._seconds === 'number') {
                    // Convertir de {_seconds, _nanoseconds} a {seconds, nanoseconds}
                     return { ...msg, timestamp: { seconds: msg.timestamp._seconds, nanoseconds: msg.timestamp._nanoseconds } };
                } else if (msg.timestamp && typeof msg.timestamp.toDate === 'function'){
                    // Si ya es un Timestamp de Firestore (del listener), convertirlo
                     const date = msg.timestamp.toDate();
                     return { ...msg, timestamp: { seconds: Math.floor(date.getTime() / 1000), nanoseconds: (date.getTime() % 1000) * 1e6 } };
                } else if (typeof msg.timestamp === 'string') {
                    // Si es un string (ISO 8601), convertirlo
                    const date = new Date(msg.timestamp);
                     return { ...msg, timestamp: { seconds: Math.floor(date.getTime() / 1000), nanoseconds: (date.getTime() % 1000) * 1e6 } };
                }
                // Si no se puede convertir, dejar como está (puede causar error en MessageBubbleTemplate)
                console.warn("Timestamp in unexpected format:", msg.timestamp);
                return msg;
            });


            // La API devuelve [nuevo..viejo], lo invertimos para tener [viejo..nuevo]
            const chronologicalMessages = processedMessages.reverse();

            // Guardar ID original antes de cambiarlo temporalmente
            const originalSelectedId = state.selectedContactId;
            state.selectedContactId = previewState.contactId; // Set temporal para MessageBubbleTemplate

            // Generar HTML para los nuevos mensajes
            const newMessagesHtml = chronologicalMessages.map(MessageBubbleTemplate).join('');

            state.selectedContactId = originalSelectedId; // Restaurar ID original

            const contentDiv = document.getElementById('preview-messages-content');
            const container = document.getElementById('preview-messages-container');
            const isFirstLoad = previewState.messages.length === 0;

            // Guardamos la altura del scroll antes de añadir contenido nuevo
            const oldScrollHeight = container.scrollHeight;
            const oldScrollTop = container.scrollTop; // Guardar posición actual

            if (isFirstLoad) {
                contentDiv.innerHTML = newMessagesHtml;
            } else {
                contentDiv.insertAdjacentHTML('afterbegin', newMessagesHtml);
            }

            // Añadir mensajes al inicio del array local
            previewState.messages.unshift(...chronologicalMessages);

            // El timestamp para la siguiente página es el del mensaje MÁS ANTIGUO que acabamos de recibir
            const oldestNewMsg = chronologicalMessages[0];
            if (oldestNewMsg && oldestNewMsg.timestamp) {
                previewState.lastMessageTimestamp = oldestNewMsg.timestamp.seconds;
            } else {
                 console.warn("Oldest message has no timestamp, stopping pagination.");
                 previewState.hasMore = false; // Detener si falta timestamp
            }


            if (isFirstLoad) {
                // Si es la primera carga, hacemos scroll hasta el final
                container.scrollTop = container.scrollHeight;
            } else {
                // Si no, mantenemos la posición relativa al contenido anterior
                container.scrollTop = oldScrollTop + (container.scrollHeight - oldScrollHeight);
            }
        }

        // Si la API devuelve menos mensajes que el límite, asumimos que no hay más
        if (data.messages.length < 30) {
            previewState.hasMore = false;
            const contentDiv = document.getElementById('preview-messages-content');
            if (contentDiv && previewState.messages.length > 0) { // Solo añadir si ya hay mensajes
                contentDiv.insertAdjacentHTML('afterbegin', `<div class="date-separator">Inicio de la conversación</div>`);
            }
        }

    } catch (error) {
        console.error("Error cargando mensajes de previsualización:", error);
        const contentDiv = document.getElementById('preview-messages-content');
        if (contentDiv && previewState.messages.length === 0) { // Mostrar error solo si está vacío
            if(spinner) spinner.style.display = 'none';
            contentDiv.innerHTML = `<p class="p-4 text-red-500 text-center">${error.message}</p>`;
        }
    } finally {
        previewState.isLoading = false;
    }
}


function handlePreviewScroll() {
    const container = document.getElementById('preview-messages-container');
    if (!container) return;
    // Cargar más cuando el usuario llega cerca de la parte superior (ej: 50px)
    if (container.scrollTop < 50 && previewState.hasMore && !previewState.isLoading) {
        loadMorePreviewMessages();
    }
}
// --- END: Conversation Preview Logic ---

// --- Helper: Función para subir archivo a GCS (debe estar en api-service.js) ---
/**
 * Sube un archivo a Google Cloud Storage usando una URL firmada.
 * @param {File} file El archivo a subir.
 * @param {function(number)} onProgress Callback para reportar el progreso (0-100).
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
                pathPrefix: 'chat_uploads' // Carpeta para archivos de chat
            })
        });
        if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida del archivo.');
        const { signedUrl, publicUrl } = await signedUrlResponse.json();

        // 2. Subir a GCS usando XHR para monitorear progreso
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', signedUrl, true);
            xhr.setRequestHeader('Content-Type', file.type);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    if (onProgress) onProgress(percentComplete);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200 || xhr.status === 201) {
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

// --- Necesitarás crear este archivo y función ---
// Ejemplo de contenido para public/js/modules/web-utils.js
/*
export async function getWebConnectionStatus() {
    try {
        const response = await fetch('/api/web/status'); // Asume ruta relativa
        if (!response.ok) {
            console.warn("Could not fetch web status, assuming disconnected.");
            return { status: 'disconnected' };
        }
        return await response.json(); // { status: 'connected' | 'disconnected' | 'requires_scan' | 'connecting' }
    } catch (error) {
        console.error("Network error fetching web status:", error);
        return { status: 'disconnected' }; // Assume disconnected on network error
    }
}
*/
