// --- START: Event Handlers for the Chat View ---
// Este archivo contiene toda la lógica y los manejadores de eventos
// específicos de la vista principal de chat.

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
                     if (change.type === "modified") {
                        const updatedMessageIndex = state.messages.findIndex(m => m.docId === change.doc.id);
                        if (updatedMessageIndex > -1) {
                            state.messages[updatedMessageIndex] = { docId: change.doc.id, ...change.doc.data() };
                            if (state.activeTab === 'chat') {
                                renderMessages(); 
                            }
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

// --- START: Picker Management (ADDED CODE) ---

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

    if (state.templatePickerOpen) renderTemplatePicker();
    if (state.emojiPickerOpen) renderEmojiPicker();
    // renderQuickReplyPicker es llamado desde handleQuickReplyInput con un término de búsqueda
}

function renderQuickReplyPicker(searchTerm = '') {
    const picker = document.getElementById('quick-reply-picker');
    if (!picker) return;

    const filteredReplies = state.quickReplies.filter(r => r.shortcut.toLowerCase().includes(searchTerm.toLowerCase()));

    if (filteredReplies.length > 0) {
        picker.innerHTML = filteredReplies.map(reply => `
            <div class="picker-item" onclick="selectQuickReply('${reply.id}')">
                <strong>/${reply.shortcut}</strong> - <span class="text-gray-500">${(reply.message || '').substring(0, 50)}...</span>
            </div>
        `).join('');
    } else {
        picker.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No hay respuestas rápidas que coincidan.</div>`;
    }
     picker.innerHTML += `<div class="picker-add-btn" onclick="navigateTo('respuestas-rapidas')"><i class="fas fa-plus-circle mr-2"></i>Añadir nueva respuesta</div>`;
}

function renderTemplatePicker() {
    const picker = document.getElementById('template-picker');
    if (!picker) return;

    if (state.templates && state.templates.length > 0) {
        picker.innerHTML = state.templates.map(template => {
            const templateString = JSON.stringify(template).replace(/"/g, '&quot;');
            return `
                <div class="picker-item template-item" onclick="handleSendTemplate(${templateString})">
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

// Movido desde feature-handlers.js y corregido
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
        
        toggleTemplatePicker(); // Esto ahora funcionará
    } catch (error) {
        console.error("Error al enviar la plantilla:", error);
        showError(error.message);
    }
}
// --- END: Picker Management ---
