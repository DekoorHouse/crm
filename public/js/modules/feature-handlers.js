// --- START: Event Handlers for Other App Features ---
// Este archivo agrupa los manejadores de eventos para las funcionalidades
// que no son el chat principal, como campañas, etiquetas, ajustes, etc.


function handleSelectContactFromPipeline(contactId) {
    navigateTo('chats');
    setTimeout(() => {
        handleSelectContact(contactId);
    }, 100);
}

// --- Contact Details & General Actions ---
async function handleUpdateContact(event) { 
    event.preventDefault(); 
    const id = document.getElementById('edit-contact-id').value;
    const name = document.getElementById('edit-contact-name').value.trim(); 
    const nickname = document.getElementById('edit-contact-nickname').value.trim(); 
    const email = document.getElementById('edit-contact-email').value.trim(); 
    if (!name) { showError("El nombre no puede estar vacío."); return; } 
    
    const contactId = id || state.selectedContactId;
    if (!contactId) { showError("No se ha seleccionado un contacto."); return; }

    const button = event.target.querySelector('button[type="submit"]'); 
    button.disabled = true; 
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; 
    try { 
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, nickname, email }) }); 
        if (!response.ok) { 
            const errorData = await response.json(); 
            throw new Error(errorData.message || 'Error al actualizar'); 
        } 
        closeEditContactModal(); 
    } catch (error) { 
        showError(error.message); 
    } finally { 
        button.disabled = false; 
        button.textContent = 'Guardar'; 
    } 
}

async function handleDeleteContact(contactId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este contacto? Esto también eliminará todos sus mensajes.')) return;
    showError("Funcionalidad de borrado no implementada aún.");
    console.log("Borrado de contacto solicitado para:", contactId);
}

// --- IA & Conversion Actions ---
async function handleGenerateReply() { 
    if (!state.selectedContactId) return; 
    const button = document.getElementById('generate-reply-btn'); 
    button.disabled = true; 
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; 
    try { 
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/generate-reply`, { method: 'POST' }); 
        const result = await response.json();
        if (!response.ok) { 
            throw new Error(result.message || 'Error al generar respuesta.'); 
        }
        document.getElementById('message-input').value = result.suggestion;
    } catch (error) { 
        showError(error.message); 
    } finally { 
        button.disabled = false; 
        button.innerHTML = '<i class="fas fa-magic"></i>'; 
    } 
}

async function handleMarkAsPurchase() {
    if (!state.selectedContactId) return;
    const value = prompt("Ingresa el valor de la compra (ej. 150.50):");
    if (value === null || value.trim() === '' || isNaN(parseFloat(value))) {
        showError("Debes ingresar un valor numérico válido.");
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/mark-as-purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: parseFloat(value) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        showError(result.message);
    } catch (error) {
        showError(error.message);
    }
}

async function handleMarkAsRegistration() {
    if (!state.selectedContactId) return;
    
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    if (contact && contact.registrationStatus === 'completed') {
        showError("Este pedido ya ha sido registrado.");
        return;
    }

    if (!confirm("¿Confirmas que quieres registrar esta línea?")) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/mark-as-registration`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        showError(result.message); 
    } catch (error) {
        showError(error.message);
    }
}

async function handleSendViewContent() {
    if (!state.selectedContactId) return;
    if (!confirm("¿Confirmas que quieres enviar el evento 'Contenido Visto' para este contacto?")) return;
     try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/send-view-content`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        showError(result.message);
    } catch (error) {
        showError(error.message);
    }
}

// --- Campaigns Handlers ---
async function handleSendCampaign() {
    const tagSelect = document.getElementById('campaign-tag-select');
    const templateSelect = document.getElementById('campaign-template-select');
    const button = document.getElementById('send-campaign-btn');

    const selectedTagKey = tagSelect.value;
    const templateString = templateSelect.value;
    
    if (!templateString) { showError("Por favor, selecciona una plantilla para enviar."); return; }

    let recipients = [];
    if (selectedTagKey === 'all') {
        recipients = state.contacts;
    } else {
        recipients = state.contacts.filter(c => c.status === selectedTagKey);
    }
    
    if (recipients.length === 0) { showError("No hay contactos en la etiqueta seleccionada para enviar la campaña."); return; }

    const contactIds = recipients.map(c => c.id);
    const template = JSON.parse(templateString);

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...`;

    try {
        const response = await fetch(`${API_BASE_URL}/api/campaigns/send-template`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactIds, template })
        });

        const result = await response.json();
        if (!response.ok || !result.success) { throw new Error(result.message || "Ocurrió un error en el servidor."); }

        alert(`Campaña enviada.\n\nÉxitos: ${result.results.successful.length}\nFallos: ${result.results.failed.length}`);
        
    } catch (error) {
        console.error("Error al enviar la campaña:", error);
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane mr-2"></i> Enviar Campaña`;
    }
}

async function handleSendCampaignWithImage() {
    const tagSelect = document.getElementById('campaign-image-tag-select');
    const templateSelect = document.getElementById('campaign-image-template-select');
    const imageUrlInput = document.getElementById('campaign-image-url-input');
    const phoneInput = document.getElementById('campaign-image-phone-input');
    const button = document.getElementById('send-campaign-image-btn');

    const templateName = templateSelect.value;
    const imageUrl = imageUrlInput.value.trim();
    const phoneNumber = phoneInput.value.trim();
    const selectedTagKey = tagSelect.value;

    const templateObject = state.templates.find(t => t.name === templateName);

    if (!templateObject) { showError("Por favor, selecciona una plantilla válida."); return; }
    if (!imageUrl) { showError("Por favor, ingresa la URL de la imagen."); return; }

    let recipients = [];
    if (selectedTagKey === 'all') {
        recipients = state.contacts;
    } else {
        recipients = state.contacts.filter(c => c.status === selectedTagKey);
    }
    
    if (recipients.length === 0 && !phoneNumber) {
        showError("No hay contactos en la etiqueta seleccionada y no se especificó un número de teléfono.");
        return;
    }

    const contactIds = phoneNumber ? [] : recipients.map(c => c.id);

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...`;

    try {
        const payload = {
            contactIds,
            templateObject, 
            imageUrl,
            phoneNumber
        };

        const response = await fetch(`${API_BASE_URL}/api/campaigns/send-template-with-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || !result.success) { throw new Error(result.message || "Ocurrió un error en el servidor."); }

        alert(`Campaña con imagen enviada.\n\nÉxitos: ${result.results.successful.length}\nFallos: ${result.results.failed.length}`);
        
    } catch (error) {
        console.error("Error al enviar la campaña con imagen:", error);
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane mr-2"></i> Enviar Campaña con Imagen`;
    }
}


// --- All other handlers (Tags, Quick Replies, Ad Responses, Settings etc.) ---

async function handleSaveQuickReply() {
    const id = document.getElementById('qr-doc-id').value;
    const shortcut = document.getElementById('qr-shortcut').value.trim();
    const message = document.getElementById('qr-message').value.trim();
    const fileUrl = document.getElementById('qr-file-url').value.trim();
    const fileType = document.getElementById('qr-file-type').value.trim();

    if (!shortcut || (!message && !fileUrl)) {
        showError("El atajo y un mensaje o archivo son obligatorios.");
        return;
    }

    const data = { shortcut, message, fileUrl, fileType };
    const url = id ? `${API_BASE_URL}/api/quick-replies/${id}` : `${API_BASE_URL}/api/quick-replies`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar.');
        }
        closeQuickReplyModal();
    } catch (error) {
        console.error("Error saving quick reply:", error);
        showError(error.message);
    }
}

async function handleDeleteQuickReply(replyId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta respuesta rápida?')) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/quick-replies/${replyId}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la respuesta rápida.');
        }
    } catch (error) {
        console.error("Error deleting quick reply:", error);
        showError(error.message);
    }
}

async function handleSaveAdResponse() {
    const id = document.getElementById('ar-doc-id').value;
    const adName = document.getElementById('ar-name').value.trim();
    const adId = document.getElementById('ar-ad-id').value.trim();
    const message = document.getElementById('ar-message').value.trim();
    const fileUrl = document.getElementById('ar-file-url').value.trim();
    const fileType = document.getElementById('ar-file-type').value.trim();

    if (!adName || !adId || (!message && !fileUrl)) {
        showError("Nombre, ID de anuncio y un mensaje o archivo son obligatorios.");
        return;
    }

    const data = { adName, adId, message, fileUrl, fileType };
    const url = id ? `${API_BASE_URL}/api/ad-responses/${id}` : `${API_BASE_URL}/api/ad-responses`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar el mensaje.');
        }
        closeAdResponseModal();
    } catch (error) {
        console.error("Error saving ad response:", error);
        showError(error.message);
    }
}

async function handleDeleteAdResponse(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este mensaje de anuncio?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/ad-responses/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar el mensaje.');
        }
    } catch (error) {
        showError(error.message);
    }
}

async function handleSaveKnowledgeBaseEntry() {
    const id = document.getElementById('kb-doc-id').value;
    const topic = document.getElementById('kb-topic').value.trim();
    const answer = document.getElementById('kb-answer').value.trim();
    const fileUrl = document.getElementById('kb-file-url').value.trim();
    const fileType = document.getElementById('kb-file-type').value.trim();

    if (!topic || !answer) {
        showError("El tema y la respuesta base son obligatorios.");
        return;
    }

    const data = { topic, answer, fileUrl, fileType };
    const url = id ? `${API_BASE_URL}/api/knowledge-base/${id}` : `${API_BASE_URL}/api/knowledge-base`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar.');
        }
        closeKnowledgeBaseModal();
    } catch (error) {
        console.error("Error saving knowledge base entry:", error);
        showError(error.message);
    }
}

async function handleDeleteKnowledgeBaseEntry(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta entrada de la base de conocimiento?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/knowledge-base/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la entrada.');
        }
    } catch (error) {
        console.error("Error deleting knowledge base entry:", error);
        showError(error.message);
    }
}

async function handleAwayMessageToggle(isActive) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/away-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive })
        });
        if (!response.ok) throw new Error('No se pudo guardar el ajuste.');
        state.awayMessageSettings.isActive = isActive;
    } catch (error) {
        showError(error.message);
        const toggle = document.getElementById('away-message-toggle');
        if (toggle) toggle.checked = !isActive;
    }
}

async function handleGlobalBotToggle(isActive) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/global-bot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive })
        });
        if (!response.ok) throw new Error('No se pudo guardar el ajuste del bot global.');
        state.globalBotSettings.isActive = isActive;
    } catch (error) {
        showError(error.message);
        const toggle = document.getElementById('global-bot-toggle');
        if (toggle) toggle.checked = !isActive;
    }
}
