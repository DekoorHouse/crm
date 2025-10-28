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

// --- START: New Order Logic ---
async function handleSaveOrder(event) {
    event.preventDefault();
    const form = document.getElementById('new-order-form');
    const saveButton = document.getElementById('order-save-btn');
    const errorMessageEl = document.getElementById('order-error-message');

    if (!state.selectedContactId) {
        showError("No se ha seleccionado un contacto.");
        return;
    }

    // --- 1. Collect form data ---
    let productoFinal = document.getElementById('order-product-select').value;
    if (productoFinal === 'Otro') {
        productoFinal = document.getElementById('order-product-other').value.trim();
        if (!productoFinal) {
            errorMessageEl.textContent = 'El nombre del producto (Otro) es obligatorio.';
            return;
        }
    }
    const telefono = document.getElementById('order-phone').value.trim();
    if (!telefono) {
        errorMessageEl.textContent = 'El número de teléfono es obligatorio.';
        return;
    }

    const orderData = {
        contactId: state.selectedContactId,
        producto: productoFinal,
        telefono: telefono,
        precio: Number(document.getElementById('order-price').value) || 0,
        datosProducto: document.getElementById('order-product-details').value.trim(),
        datosPromocion: document.getElementById('order-promo-details').value.trim(),
        comentarios: document.getElementById('order-comments').value.trim(),
    };

    // --- 2. Disable form and show loading state ---
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
    errorMessageEl.textContent = '';

    try {
        // --- 3. Handle photo uploads ---
        async function uploadPhotos(photoManager, storagePath) {
            const uploadPromises = photoManager.map(photo => {
                if (photo.isNew) {
                    const filePath = `${storagePath}/${Date.now()}_${photo.file.name}`;
                    const storageRef = storage.ref(filePath);
                    return storageRef.put(photo.file).then(snapshot => snapshot.ref.getDownloadURL());
                }
                return Promise.resolve(photo.url); // Return existing URL
            });
            return await Promise.all(uploadPromises);
        }

        saveButton.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i> Subiendo fotos...';

        // These managers are global in ui-manager.js
        const finalOrderPhotoUrls = await uploadPhotos(orderPhotosManager, 'pedidos');
        const finalPromoPhotoUrls = await uploadPhotos(promoPhotosManager, 'promociones');

        orderData.fotoUrls = finalOrderPhotoUrls;
        orderData.fotoPromocionUrls = finalPromoPhotoUrls;

        // --- 4. Send data to backend ---
        saveButton.innerHTML = '<i class="fas fa-database mr-2"></i> Creando registro...';
        const response = await fetch(`${API_BASE_URL}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.message || "Ocurrió un error en el servidor.");
        }

        // --- 5. Handle success ---
        closeNewOrderModal();
        showError(`Pedido ${result.orderNumber} registrado con éxito.`, 'success');

    } catch (error) {
        console.error("Error al guardar el pedido:", error);
        errorMessageEl.textContent = error.message;
    } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save mr-2"></i> Guardar Pedido';
    }
}
// --- END: New Order Logic ---

async function handleUpdateExistingOrder(event, orderId) {
    event.preventDefault();
    const saveButton = document.getElementById('order-update-btn');
    const errorMessageEl = document.getElementById('edit-order-error-message');

    let productoFinal = document.getElementById('edit-order-product-select').value;
    if (productoFinal === 'Otro') {
        productoFinal = document.getElementById('edit-order-product-other').value.trim();
        if (!productoFinal) {
            errorMessageEl.textContent = 'El nombre del producto (Otro) es obligatorio.';
            return;
        }
    }

    const updateData = {
        producto: productoFinal,
        telefono: document.getElementById('edit-order-phone').value.trim(),
        precio: Number(document.getElementById('edit-order-price').value) || 0,
        datosProducto: document.getElementById('edit-order-product-details').value.trim(),
        datosPromocion: document.getElementById('edit-order-promo-details').value.trim(),
        comentarios: document.getElementById('edit-order-comments').value.trim(),
    };

    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
    errorMessageEl.textContent = '';

    try {
        async function uploadPhotos(photoManager, storagePath) {
            const uploadPromises = photoManager.map(async photo => {
                if (photo.isNew) {
                    const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fileName: photo.file.name, contentType: photo.file.type, pathPrefix: storagePath })
                    });
                    if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida de archivo.');
                    const { signedUrl, publicUrl } = await signedUrlResponse.json();

                    await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': photo.file.type }, body: photo.file });
                    return publicUrl;
                }
                return Promise.resolve(photo.url);
            });
            return await Promise.all(uploadPromises);
        }

        saveButton.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i> Subiendo fotos...';

        updateData.fotoUrls = await uploadPhotos(editOrderPhotosManager, 'pedidos');
        updateData.fotoPromocionUrls = await uploadPhotos(editPromoPhotosManager, 'promociones');

        saveButton.innerHTML = '<i class="fas fa-database mr-2"></i> Actualizando...';
        const response = await fetch(`${API_BASE_URL}/api/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.message || "Ocurrió un error en el servidor.");
        }

        closeOrderEditModal();
        showError('Pedido actualizado con éxito.', 'success');

    } catch (error) {
        console.error("Error al actualizar el pedido:", error);
        errorMessageEl.textContent = error.message;
    } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save mr-2"></i> Guardar Cambios';
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

async function handleSaveQuickReply(event) {
    event.preventDefault(); // <-- AÑADIDO: Previene la recarga de la página
    const id = document.getElementById('qr-doc-id').value;
    const shortcut = document.getElementById('qr-shortcut').value.trim();
    const message = document.getElementById('qr-message').value.trim();
    const fileUrlInput = document.getElementById('qr-file-url');
    let fileUrl = fileUrlInput.value.trim();
    const fileTypeInput = document.getElementById('qr-file-type');
    let fileType = fileTypeInput.value.trim();
    const fileInput = document.getElementById('qr-file-input');

    // --- INICIO DE LA SOLUCIÓN: Lógica de subida de archivo para Respuestas Rápidas ---
    if (fileInput.files[0]) {
        const file = fileInput.files[0];
        try {
            showError('Subiendo archivo...', 'info');

            // 1. Obtener URL firmada del backend
            const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    contentType: file.type,
                    pathPrefix: 'quick_replies' // Carpeta diferente
                })
            });
            if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida del archivo.');
            const { signedUrl, publicUrl } = await signedUrlResponse.json();

            // 2. Subir el archivo a la URL firmada
            await fetch(signedUrl, {
                method: 'PUT',
                headers: { 'Content-Type': file.type },
                body: file
            });

            // 3. Usar la URL pública para guardar en Firestore
            fileUrl = publicUrl;
            fileType = file.type;

            hideError();
        } catch (error) {
            console.error("Error al subir archivo para Quick Reply:", error);
            showError("Error al subir el archivo. Inténtalo de nuevo.");
            return;
        }
    }
    // --- FIN DE LA SOLUCIÓN ---

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

async function handleSaveAdResponse(event) {
    event.preventDefault(); // Previene la recarga de la página
    const id = document.getElementById('ar-doc-id').value;
    const adName = document.getElementById('ar-name').value.trim();
    // --- INICIO MODIFICACIÓN: Leer IDs separados por comas ---
    const adIdsInput = document.getElementById('ar-ad-id').value.trim();
    const adIds = adIdsInput.split(',').map(id => id.trim()).filter(id => id); // Crea un array de IDs limpios
    // --- FIN MODIFICACIÓN ---
    const message = document.getElementById('ar-message').value.trim();
    const fileUrlInput = document.getElementById('ar-file-url');
    let fileUrl = fileUrlInput.value.trim();
    const fileTypeInput = document.getElementById('ar-file-type');
    let fileType = fileTypeInput.value.trim();
    const fileInput = document.getElementById('ar-file-input');

    // Lógica de subida de archivo (sin cambios respecto a la versión anterior)
    if (fileInput.files[0]) {
        const file = fileInput.files[0];
        try {
            showError('Subiendo archivo...', 'info');
            const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    contentType: file.type,
                    pathPrefix: 'ad_responses'
                })
            });
            if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida del archivo.');
            const { signedUrl, publicUrl } = await signedUrlResponse.json();
            await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            fileUrl = publicUrl;
            fileType = file.type;
            hideError();
        } catch (error) {
            console.error("Error al subir archivo para Ad Response:", error);
            showError("Error al subir el archivo. Inténtalo de nuevo.");
            return;
        }
    }

    // --- INICIO MODIFICACIÓN: Validación y preparación de datos ---
    if (!adName || adIds.length === 0 || (!message && !fileUrl)) { // Validar que haya al menos un ID
        showError("Nombre, al menos un ID de anuncio y un mensaje o archivo son obligatorios.");
        return;
    }
    // Enviar 'adIds' como array al backend
    const data = { adName, adIds, message, fileUrl, fileType };
    // --- FIN MODIFICACIÓN ---

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

async function handleSaveKnowledgeBaseEntry(event) {
    event.preventDefault();

    const id = document.getElementById('kb-doc-id').value;
    const topic = document.getElementById('kb-topic').value.trim();
    const answer = document.getElementById('kb-answer').value.trim();
    const fileUrlInput = document.getElementById('kb-file-url');
    let fileUrl = fileUrlInput.value.trim();
    const fileTypeInput = document.getElementById('kb-file-type');
    let fileType = fileTypeInput.value.trim();
    const fileInput = document.getElementById('kb-file-input');

    if (fileInput.files[0]) {
        const file = fileInput.files[0];
        try {
            showError('Subiendo archivo...', 'info');

            const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    contentType: file.type,
                    pathPrefix: 'knowledge_base'
                })
            });
            if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida del archivo.');
            const { signedUrl, publicUrl } = await signedUrlResponse.json();

            await fetch(signedUrl, {
                method: 'PUT',
                headers: { 'Content-Type': file.type },
                body: file
            });

            fileUrl = publicUrl;
            fileType = file.type;

            hideError();
        } catch (error) {
            console.error("Error al subir archivo para Knowledge Base:", error);
            showError("Error al subir el archivo. Inténtalo de nuevo.");
            return;
        }
    }

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

// --- INICIO DE MODIFICACIÓN: Nueva función para manejar el interruptor de IA por contacto ---
/**
 * Activa o desactiva el bot de IA para un contacto específico.
 * @param {string} contactId - El ID del contacto a modificar.
 * @param {boolean} isActive - El nuevo estado del bot (true para activado, false para desactivado).
 */
async function handleBotToggle(contactId, isActive) {
    if (!contactId) return;

    // --- 1. Actualización optimista de la UI ---
    // Actualiza el estado local primero para una respuesta instantánea.
    const contactIndex = state.contacts.findIndex(c => c.id === contactId);
    let originalState = null;
    if (contactIndex > -1) {
        originalState = state.contacts[contactIndex].botActive;
        state.contacts[contactIndex].botActive = isActive;

        // Si el chat de este contacto está abierto, vuelve a dibujarlo para mostrar el cambio.
        if(state.selectedContactId === contactId) {
            renderChatWindow();
        }
    }

    // --- 2. Llamada a la API ---
    try {
        const response = await fetch(`${API_BASE_URL}/api/bot/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId, isActive })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al actualizar el estado del bot.');
        }
        // El listener de Firestore se encargará de sincronizar el estado real,
        // por lo que no es necesario hacer más nada si la llamada es exitosa.
    } catch (error) {
        console.error("Error al cambiar el estado del bot:", error);
        showError(error.message);

        // --- 3. Revertir la UI en caso de fallo ---
        if (contactIndex > -1 && originalState !== null) {
            state.contacts[contactIndex].botActive = originalState;
            if(state.selectedContactId === contactId) {
                renderChatWindow();
            }
        }
    }
}
// --- FIN DE MODIFICACIÓN ---


// --- AÑADIDO: Handlers for AI Ad Prompts ---
async function handleSaveAIAdPrompt(event) {
    event.preventDefault();
    const id = document.getElementById('aip-doc-id').value;
    const adName = document.getElementById('aip-name').value.trim();
    const adId = document.getElementById('aip-ad-id').value.trim();
    const prompt = document.getElementById('aip-prompt').value.trim();

    if (!adName || !adId || !prompt) {
        showError("Nombre, ID de anuncio y el prompt son obligatorios.");
        return;
    }

    const data = { adName, adId, prompt };
    const url = id ? `${API_BASE_URL}/api/ai-ad-prompts/${id}` : `${API_BASE_URL}/api/ai-ad-prompts`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar el prompt.');
        }
        closeAIAdPromptModal();
    } catch (error) {
        console.error("Error saving AI ad prompt:", error);
        showError(error.message);
    }
}

async function handleDeleteAIAdPrompt(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este prompt de IA?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/ai-ad-prompts/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar el prompt.');
        }
    } catch (error) {
        showError(error.message);
    }
}

// --- AÑADIDO: Handler for Bot Settings ---
async function handleSaveBotSettings(event) {
    event.preventDefault();
    const instructions = document.getElementById('bot-instructions').value.trim();

    try {
        const response = await fetch(`${API_BASE_URL}/api/bot/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instructions })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar los ajustes.');
        }
        state.botSettings.instructions = instructions; // Update local state
        closeBotSettingsModal();
        showError('Instrucciones del bot guardadas con éxito.', 'success');
    } catch (error) {
        console.error("Error saving bot settings:", error);
        showError(error.message);
    }
}

window.openOrderEditModal = openOrderEditModal;

/**
 * Maneja el cambio de estatus de un pedido desde la barra lateral de detalles.
 * @param {string} orderId - El ID del documento del pedido en Firestore.
 * @param {string} newStatus - La nueva clave de estatus.
 * @param {HTMLElement} selectElement - El elemento select que fue cambiado.
 */
async function handleOrderStatusChange(orderId, newStatus, selectElement) {
    if (!orderId || !newStatus) return;

    const orderIndex = state.selectedContactOrders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return;
    const originalStatus = state.selectedContactOrders[orderIndex].estatus;

    // Actualización optimista del color
    const newTag = state.orderStatuses.find(t => t.key === newStatus); // Use orderStatuses from state.js
    if (newTag) {
        selectElement.style.backgroundColor = `${newTag.color}20`;
        selectElement.style.color = newTag.color;
        selectElement.style.borderColor = `${newTag.color}50`;
    }

    selectElement.disabled = true;

    try {
        const orderRef = db.collection('pedidos').doc(orderId);
        await orderRef.update({ estatus: newStatus });
        // El listener onSnapshot se encargará de la actualización final del estado y la UI.
    } catch (error) {
        console.error("Error al actualizar el estatus del pedido:", error);
        showError("No se pudo actualizar el estatus del pedido.");

        // Revertir la UI en caso de fallo
        selectElement.value = originalStatus;
        const oldTag = state.orderStatuses.find(t => t.key === originalStatus); // Use orderStatuses from state.js
        if (oldTag) {
            selectElement.style.backgroundColor = `${oldTag.color}20`;
            selectElement.style.color = oldTag.color;
            selectElement.style.borderColor = `${oldTag.color}50`;
        }
    } finally {
        selectElement.disabled = false;
    }
}
window.handleOrderStatusChange = handleOrderStatusChange;


// --- START: ADDED FUNCTIONS TO FIX ERRORS ---

/**
 * Initializes the drag-and-drop sorting functionality for the tags table.
 */
function initTagsSortable() {
    const tableBody = document.getElementById('tags-table-body');
    if (tableBody && !tagsSortable) { // Use global `tagsSortable` from state.js
        tagsSortable = new Sortable(tableBody, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: async (evt) => {
                const orderedIds = Array.from(tableBody.querySelectorAll('tr')).map(row => row.dataset.id);
                try {
                    const response = await fetch(`${API_BASE_URL}/api/tags/order`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orderedIds })
                    });
                    if (!response.ok) throw new Error('No se pudo guardar el nuevo orden.');
                } catch (error) {
                    showError(error.message);
                    renderTagsView(); // Re-render to revert visual change on failure
                }
            }
        });
    }
}

/**
 * Updates the recipient count display on the campaign pages based on selections.
 * @param {string} type - 'text' or 'image' to distinguish between campaign views.
 */
function updateCampaignRecipientCount(type = 'text') {
    const suffix = type === 'image' ? '-image' : '';
    const tagSelect = document.getElementById(`campaign${suffix}-tag-select`);
    const phoneInput = document.getElementById(`campaign-image-phone-input`);
    const countDisplay = document.getElementById(`recipient-count-display${suffix}`);

    if (!tagSelect || !countDisplay) return;

    let count = 0;
    const selectedTagKey = tagSelect.value;

    // For the image campaign, a phone number overrides the tag selection
    if (type === 'image' && phoneInput && phoneInput.value.trim()) {
        count = 1;
        // Check if tagSelect exists before attempting to reset its value
        if (tagSelect) {
            tagSelect.value = 'all'; // Reset tag selection if phone is entered
        }
    } else if (selectedTagKey === 'all') {
        count = state.contacts.length;
    } else {
        count = state.contacts.filter(c => c.status === selectedTagKey).length;
    }

    countDisplay.textContent = `Se enviará a ${count} contacto(s).`;
}


/**
 * Toggles the visibility of the IA submenu in the sidebar.
 */
function toggleIAMenu() {
    const submenu = document.getElementById('ia-submenu');
    const chevron = document.getElementById('ia-menu-chevron');
    if (submenu && chevron) {
        submenu.classList.toggle('hidden');
        chevron.classList.toggle('rotate-180');
    }
}

/**
 * Handles saving the Google Sheet ID from the settings page.
 */
async function handleSaveGoogleSheetId() {
    const input = document.getElementById('google-sheet-id-input');
    const button = document.getElementById('save-google-sheet-id-btn');
    if (!input || !button) return;

    const googleSheetId = input.value.trim();
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/google-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ googleSheetId })
        });
        if (!response.ok) throw new Error('No se pudo guardar el ID.');
        state.googleSheetSettings.googleSheetId = googleSheetId;
        showError("ID de Google Sheet guardado con éxito.", 'success'); // Using showError for feedback
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Guardar';
    }
}

/**
 * Handles the submission of the ad simulation form from the settings page.
 * @param {Event} event The form submission event.
 */
async function handleSimulateAdMessage(event) {
    event.preventDefault();
    const phoneInput = document.getElementById('sim-phone-number');
    const adIdInput = document.getElementById('sim-ad-id');
    const textInput = document.getElementById('sim-message-text');
    const button = document.getElementById('simulate-ad-btn');

    const from = phoneInput.value.trim();
    const adId = adIdInput.value.trim();
    const text = textInput.value.trim();

    if (!from || !adId || !text) {
        showError("Por favor, completa todos los campos de simulación.");
        return;
    }

    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/test/simulate-ad-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, adId, text })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || 'Error en la simulación.');
        }
        alert('Simulación enviada con éxito. Revisa la lista de chats para ver el nuevo contacto/mensaje.');
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Enviar Simulación';
    }
}

// Exportar funciones para que sean accesibles globalmente si es necesario
window.handleSaveTag = handleSaveTag;
window.handleDeleteTag = handleDeleteTag;
window.handleDeleteAllTags = handleDeleteAllTags;
window.handleSaveQuickReply = handleSaveQuickReply;
window.handleDeleteQuickReply = handleDeleteQuickReply;
window.handleSaveAdResponse = handleSaveAdResponse;
window.handleDeleteAdResponse = handleDeleteAdResponse;
window.handleSaveKnowledgeBaseEntry = handleSaveKnowledgeBaseEntry;
window.handleDeleteKnowledgeBaseEntry = handleDeleteKnowledgeBaseEntry;
window.handleAwayMessageToggle = handleAwayMessageToggle;
window.handleGlobalBotToggle = handleGlobalBotToggle;
window.handleBotToggle = handleBotToggle;
window.handleSaveAIAdPrompt = handleSaveAIAdPrompt;
window.handleDeleteAIAdPrompt = handleDeleteAIAdPrompt;
window.handleSaveBotSettings = handleSaveBotSettings;
window.handleUpdateContact = handleUpdateContact;
window.handleDeleteContact = handleDeleteContact;
window.handleGenerateReply = handleGenerateReply;
window.handleMarkAsPurchase = handleMarkAsPurchase;
window.handleMarkAsRegistration = handleMarkAsRegistration;
window.handleSendViewContent = handleSendViewContent;
window.handleSaveOrder = handleSaveOrder; // Make sure this is globally accessible
window.handleUpdateExistingOrder = handleUpdateExistingOrder;
window.handleSendCampaign = handleSendCampaign;
window.handleSendCampaignWithImage = handleSendCampaignWithImage;
window.toggleIAMenu = toggleIAMenu;
window.handleSaveGoogleSheetId = handleSaveGoogleSheetId;
window.handleSimulateAdMessage = handleSimulateAdMessage;
window.handleSelectContactFromPipeline = handleSelectContactFromPipeline;

// Funciones de modal que necesitan ser globales
window.openEditContactModal = openEditContactModal;
window.closeEditContactModal = closeEditContactModal;
window.openTagModal = openTagModal;
window.closeTagModal = closeTagModal;
window.openQuickReplyModal = openQuickReplyModal;
window.closeQuickReplyModal = closeQuickReplyModal;
window.openAdResponseModal = openAdResponseModal;
window.closeAdResponseModal = closeAdResponseModal;
window.openKnowledgeBaseModal = openKnowledgeBaseModal;
window.closeKnowledgeBaseModal = closeKnowledgeBaseModal;
window.openAIAdPromptModal = openAIAdPromptModal;
window.closeAIAdPromptModal = closeAIAdPromptModal;
window.openBotSettingsModal = openBotSettingsModal;
window.closeBotSettingsModal = closeBotSettingsModal;
window.openNewOrderModal = openNewOrderModal; // Make sure this is globally accessible
window.closeNewOrderModal = closeNewOrderModal; // Make sure this is globally accessible
// --- END: ADDED FUNCTIONS TO FIX ERRORS ---



}
