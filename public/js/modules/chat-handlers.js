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


// --- LÓGICA DE CHAT EXISTENTE (CON LIGEROS CAMBIOS) ---

function renderChatWindow() { 
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
            renderMessages();
            const messagesContainer = document.getElementById('messages-container'); 
            if (messagesContainer) { messagesContainer.addEventListener('scroll', () => { if (!ticking) { window.requestAnimationFrame(() => { handleScroll(); ticking = false; }); ticking = true; } }); }
            
            const messageForm = document.getElementById('message-form');
            const messageInput = document.getElementById('message-input'); 
            if (messageForm) messageForm.addEventListener('submit', handleSendMessage); 
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
            document.getElementById('note-form').addEventListener('submit', handleSaveNote);
        }
        setupDragAndDropForChatArea(); // Llamada a la nueva función
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

async function handleSendMessage(event) {
    event.preventDefault();
    const input = document.getElementById('message-input');
    let text = input.value.trim();
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    if (!contact || state.isUploading) return;

    const fileToSend = state.stagedFile;
    const remoteFileToSend = state.stagedRemoteFile;

    if (!text && !fileToSend && !remoteFileToSend) return;

    const isExpired = state.isSessionExpired;
    const endpoint = isExpired ? 'queue-message' : 'messages';
    
    const tempId = `temp_${Date.now()}`;
    const pendingMessage = {
        docId: tempId,
        from: 'me',
        status: isExpired ? 'queued' : 'pending',
        timestamp: { seconds: Math.floor(Date.now() / 1000) },
        text: text || (fileToSend ? '📷 Adjunto' : '📄 Adjunto'),
    };

    state.messages.push(pendingMessage);
    appendMessage(pendingMessage);

    input.value = '';
    input.style.height = 'auto';
    cancelStagedFile();

    try {
        if (fileToSend) {
            const response = await uploadAndSendFile(fileToSend, text, isExpired);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error del servidor.');
            }
        } else {
            if (!isExpired) {
                await db.collection('contacts_whatsapp').doc(state.selectedContactId).update({ unreadCount: 0 });
            }
            const messageData = { text, tempId };
            if (remoteFileToSend) {
                messageData.fileUrl = remoteFileToSend.url;
                messageData.fileType = remoteFileToSend.type;
            }
            if (state.replyingToMessage) {
                messageData.reply_to_wamid = state.replyingToMessage.id;
            }
            const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/${endpoint}`, {
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
        const failedMessageIndex = state.messages.findIndex(m => m.docId === tempId);
        if (failedMessageIndex > -1) {
            state.messages[failedMessageIndex].status = 'failed';
            renderMessages();
        }
        if (text && !fileToSend && !remoteFileToSend) { input.value = text; } 
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

async function uploadAndSendFile(file, textCaption, isExpired) { 
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

                    const endpoint = isExpired ? 'queue-message' : 'messages';
                    const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messageData) });
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

function stageFile(file) { if (!file || state.isUploading) return; if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) { showError('Solo se pueden adjuntar imágenes, videos y audios.'); return; } state.stagedFile = file; state.stagedRemoteFile = null; renderFilePreview(); }

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

function setFilter(filter) { 
    state.activeFilter = filter; 
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active')); 
    document.getElementById(`filter-${filter}`).classList.add('active'); 
    
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


function toggleReactionMenu(event) {
    event.stopPropagation();
    const targetButton = event.currentTarget;
    const popoverContainer = targetButton.closest('.reaction-popover-container');
    const popover = popoverContainer.querySelector('.reaction-popover');
    
    if (!popoverContainer || !popover) return;

    const wasActive = popoverContainer.classList.contains('active');

    // Close all popovers first
    document.querySelectorAll('.reaction-popover-container.active').forEach(container => {
        container.classList.remove('active');
        const p = container.querySelector('.reaction-popover');
        if (p) {
            p.classList.remove('fixed');
            p.style.top = '';
            p.style.left = '';
            p.style.transform = ''; // Also reset transform on close
        }
    });

    // If the clicked one was not active, open it.
    if (!wasActive) {
        popoverContainer.classList.add('active');
        popover.classList.add('fixed');
        popover.style.transform = 'none'; // --- INICIO DE LA CORRECCIÓN: Asegura que no haya transformaciones CSS que interfieran ---
        
        const rect = targetButton.getBoundingClientRect();
        const popoverHeight = popover.offsetHeight;
        const popoverWidth = popover.offsetWidth;
        
        let top = rect.top - popoverHeight - 8;
        let left = rect.left + (rect.width / 2) - (popoverWidth / 2);

        if (top < 5) top = rect.bottom + 8;
        if (left < 5) left = 5;
        if (left + popoverWidth > window.innerWidth) left = window.innerWidth - popoverWidth - 5;

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
    }
}

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
    if (!picker) return;

    const emojis = {
        'Smileys & People': ['😀', '😂', '😍', '👍', '🙏', '🎉', '❤️', '😊', '🤔', '😢'],
        'Objects': ['💼', '💻', '📱', '💰', '📦', '📄', '📅', '⏰'],
    };

    let pickerHTML = '<div class="picker-content">';
    for (const category in emojis) {
        pickerHTML += `<div class="emoji-category">${category}</div>`;
        pickerHTML += emojis[category].map(emoji => `<span class="emoji" onclick="selectEmoji('${emoji}')">${emoji}</span>`).join('');
    }
    pickerHTML += '</div>';
    picker.innerHTML = pickerHTML;
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
