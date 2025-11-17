// --- START: Event Handlers for Other App Features ---
// Este archivo agrupa los manejadores de eventos para las funcionalidades
// que no son el chat principal, como campañas, etiquetas, ajustes, etc.

// --- INICIO DE MODIFICACIÓN ---
// Importar funciones de ui-manager si es necesario (o hacerlas globales)
// import { loadAdIdMetrics, clearAdIdMetricsFilter } from './ui-manager.js';
// --- FIN DE MODIFICACIÓN ---


/**
 * Navega a la vista de chats y selecciona un contacto específico.
 * Usado al hacer clic en una tarjeta del pipeline.
 * @param {string} contactId El ID del contacto a seleccionar.
 */
function handleSelectContactFromPipeline(contactId) {
    navigateTo('chats'); // Cambia a la vista de chats
    // Espera un breve momento para que la vista se renderice antes de seleccionar
    setTimeout(() => {
        handleSelectContact(contactId); // Llama a la función que selecciona el contacto
    }, 100); // 100ms de espera
}

// --- Contact Details & General Actions ---

/**
 * Maneja el envío del formulario para editar/añadir un contacto.
 * @param {Event} event El evento de envío del formulario.
 */
async function handleUpdateContact(event) {
    event.preventDefault(); // Evita la recarga de la página
    // Obtiene los datos del formulario
    const id = document.getElementById('edit-contact-id').value;
    const name = document.getElementById('edit-contact-name').value.trim();
    const nickname = document.getElementById('edit-contact-nickname').value.trim();
    const email = document.getElementById('edit-contact-email').value.trim();
    // Validación simple
    if (!name) { showError("El nombre no puede estar vacío."); return; }

    // Determina el ID del contacto a actualizar
    const contactId = id || state.selectedContactId;
    if (!contactId) { showError("No se ha seleccionado un contacto."); return; }

    // Deshabilita el botón y muestra spinner
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        // Llama a la API para actualizar el contacto
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, nickname, email }) // Envía los datos
        });
        if (!response.ok) { // Manejo de error de la API
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al actualizar');
        }
        closeEditContactModal(); // Cierra el modal si la actualización fue exitosa
    } catch (error) {
        showError(error.message); // Muestra error al usuario
    } finally {
        // Rehabilita el botón
        button.disabled = false;
        button.textContent = 'Guardar';
    }
}

/**
 * Maneja la eliminación de un contacto (actualmente muestra un mensaje).
 * @param {string} contactId El ID del contacto a eliminar.
 */
async function handleDeleteContact(contactId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este contacto? Esto también eliminará todos sus mensajes.')) return;
    showError("Funcionalidad de borrado no implementada aún."); // Placeholder
    console.log("Borrado de contacto solicitado para:", contactId);
    // TODO: Implementar llamada a la API para borrar contacto y mensajes
}

// --- IA & Conversion Actions ---

/**
 * Solicita a la API generar una sugerencia de respuesta basada en el historial del chat.
 */
async function handleGenerateReply() {
    if (!state.selectedContactId) return; // No hacer nada si no hay chat seleccionado
    const button = document.getElementById('generate-reply-btn');
    button.disabled = true; // Deshabilitar botón
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; // Mostrar spinner

    try {
        // Llama a la API para generar la respuesta
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/generate-reply`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) { // Manejo de error
            throw new Error(result.message || 'Error al generar respuesta.');
        }
        // Rellena el input de mensaje con la sugerencia
        document.getElementById('message-input').value = result.suggestion;
    } catch (error) {
        showError(error.message); // Muestra error
    } finally {
        // Rehabilita el botón
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-magic"></i>';
    }
}

/**
 * Marca un contacto como que realizó una compra y envía el evento a Meta.
 */
async function handleMarkAsPurchase() {
    if (!state.selectedContactId) return;
    // Pide al usuario el valor de la compra
    const value = prompt("Ingresa el valor de la compra (ej. 150.50):");
    // Validación
    if (value === null || value.trim() === '' || isNaN(parseFloat(value))) {
        showError("Debes ingresar un valor numérico válido.");
        return;
    }
    try {
        // Llama a la API para registrar la compra
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/mark-as-purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: parseFloat(value) }) // Envía el valor
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message); // Manejo de error
        showError(result.message, 'success'); // Muestra mensaje de éxito
    } catch (error) {
        showError(error.message); // Muestra error
    }
}

/**
 * Marca un contacto como que completó el registro (deprecado/cambiado a Purchase?).
 */
async function handleMarkAsRegistration() {
    if (!state.selectedContactId) return;

    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    // Evita registrar dos veces
    if (contact && contact.registrationStatus === 'completed') {
        showError("Este pedido ya ha sido registrado.");
        return;
    }

    if (!confirm("¿Confirmas que quieres registrar esta línea?")) return;
    try {
        // Llama a la API
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/mark-as-registration`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        showError(result.message, 'success'); // Muestra éxito
    } catch (error) {
        showError(error.message); // Muestra error
    }
}

/**
 * Envía el evento 'ViewContent' a Meta para el contacto seleccionado.
 */
async function handleSendViewContent() {
    if (!state.selectedContactId) return;
    if (!confirm("¿Confirmas que quieres enviar el evento 'Contenido Visto' para este contacto?")) return;
     try {
        // Llama a la API
        const response = await fetch(`${API_BASE_URL}/api/contacts/${state.selectedContactId}/send-view-content`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        showError(result.message, 'success'); // Muestra éxito
    } catch (error) {
        showError(error.message); // Muestra error
    }
}

// --- START: New Order Logic ---
/**
 * Maneja el envío del formulario para crear un nuevo pedido.
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSaveOrder(event) {
    event.preventDefault(); // Evita recarga
    const form = document.getElementById('new-order-form');
    const saveButton = document.getElementById('order-save-btn');
    const errorMessageEl = document.getElementById('order-error-message');

    // Validación: debe haber un contacto seleccionado
    if (!state.selectedContactId) {
        showError("No se ha seleccionado un contacto.");
        return;
    }

    // --- 1. Recolectar datos del formulario ---
    let productoFinal = document.getElementById('order-product-select').value;
    if (productoFinal === 'Otro') { // Si eligió "Otro"
        productoFinal = document.getElementById('order-product-other').value.trim();
        if (!productoFinal) { // Validar que no esté vacío
            errorMessageEl.textContent = 'El nombre del producto (Otro) es obligatorio.';
            return;
        }
    }
    const telefono = document.getElementById('order-phone').value.trim();
    if (!telefono) { // Validar teléfono
        errorMessageEl.textContent = 'El número de teléfono es obligatorio.';
        return;
    }

    // Crear objeto con los datos del pedido
    const orderData = {
        contactId: state.selectedContactId, // ID del contacto actual
        producto: productoFinal,
        telefono: telefono,
        precio: Number(document.getElementById('order-price').value) || 0,
        datosProducto: document.getElementById('order-product-details').value.trim(),
        datosPromocion: document.getElementById('order-promo-details').value.trim(),
        comentarios: document.getElementById('order-comments').value.trim(),
        // Los arrays de fotos se manejarán después
    };

    // --- 2. Deshabilitar formulario y mostrar estado de carga ---
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
    errorMessageEl.textContent = ''; // Limpiar errores previos

    try {
        // --- 3. Manejar subida de fotos ---
        /**
         * Sube las fotos de un array (manager) a GCS usando URLs firmadas.
         * @param {Array<object>} photoManager Array de objetos de foto ({file, url, isNew}).
         * @param {string} storagePath Prefijo de la ruta en GCS (ej. 'pedidos').
         * @returns {Promise<string[]>} Promesa que resuelve con las URLs públicas de las fotos subidas/existentes.
         */
        async function uploadPhotos(photoManager, storagePath) {
            // Mapea cada foto a una promesa de subida/resolución
            const uploadPromises = photoManager.map(async photo => {
                if (photo.isNew) { // Si es una foto nueva (recién seleccionada)
                    // a. Pide una URL firmada al backend
                    const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fileName: photo.file.name, contentType: photo.file.type, pathPrefix: storagePath })
                    });
                    if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida de archivo.');
                    const { signedUrl, publicUrl } = await signedUrlResponse.json();

                    // b. Sube el archivo a GCS usando la URL firmada
                    await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': photo.file.type }, body: photo.file });
                    return publicUrl; // Devuelve la URL pública
                }
                return Promise.resolve(photo.url); // Si no es nueva, devuelve la URL existente
            });
            return await Promise.all(uploadPromises); // Espera a que todas las subidas terminen
        }

        saveButton.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i> Subiendo fotos...';

        // Sube las fotos del pedido y de la promoción
        const finalOrderPhotoUrls = await uploadPhotos(orderPhotosManager, 'pedidos');
        const finalPromoPhotoUrls = await uploadPhotos(promoPhotosManager, 'promociones');

        // Añade las URLs al objeto de datos del pedido
        orderData.fotoUrls = finalOrderPhotoUrls;
        orderData.fotoPromocionUrls = finalPromoPhotoUrls;

        // --- 4. Enviar datos al backend para crear el pedido ---
        saveButton.innerHTML = '<i class="fas fa-database mr-2"></i> Creando registro...';
        const response = await fetch(`${API_BASE_URL}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData) // Envía todos los datos
        });

        const result = await response.json();
        if (!response.ok || !result.success) { // Manejo de error del backend
            throw new Error(result.message || "Ocurrió un error en el servidor.");
        }

        // --- 5. Manejar éxito ---
        closeNewOrderModal(); // Cierra el modal
        showError(`Pedido ${result.orderNumber} registrado con éxito.`, 'success'); // Muestra mensaje
        // Nota: El listener de pedidos actualizará la barra lateral automáticamente

    } catch (error) {
        // --- Manejo de errores (subida o creación) ---
        console.error("Error al guardar el pedido:", error);
        errorMessageEl.textContent = error.message; // Muestra error en el modal
    } finally {
        // --- Rehabilita el botón ---
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save mr-2"></i> Guardar Pedido';
    }
}
// --- END: New Order Logic ---

/**
 * Maneja el envío del formulario para actualizar un pedido existente.
 * @param {Event} event El evento de envío del formulario.
 * @param {string} orderId El ID del pedido a actualizar.
 */
async function handleUpdateExistingOrder(event, orderId) {
    event.preventDefault(); // Evita recarga
    const saveButton = document.getElementById('order-update-btn');
    const errorMessageEl = document.getElementById('edit-order-error-message');

    // Recolecta datos del formulario (similar a handleSaveOrder)
    let productoFinal = document.getElementById('edit-order-product-select').value;
    if (productoFinal === 'Otro') {
        productoFinal = document.getElementById('edit-order-product-other').value.trim();
        if (!productoFinal) {
            errorMessageEl.textContent = 'El nombre del producto (Otro) es obligatorio.';
            return;
        }
    }

    // Objeto con los datos a actualizar
    const updateData = {
        producto: productoFinal,
        telefono: document.getElementById('edit-order-phone').value.trim(),
        precio: Number(document.getElementById('edit-order-price').value) || 0,
        datosProducto: document.getElementById('edit-order-product-details').value.trim(),
        datosPromocion: document.getElementById('edit-order-promo-details').value.trim(),
        comentarios: document.getElementById('edit-order-comments').value.trim(),
        // Los arrays de fotos se manejan después
    };

    // Deshabilita botón y muestra carga
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
    errorMessageEl.textContent = ''; // Limpia errores

    try {
        // --- Lógica de subida de fotos (igual que en handleSaveOrder) ---
        /**
         * Sube las fotos NUEVAS de un array (manager) a GCS.
         * Devuelve las URLs finales (nuevas y existentes).
         */
        async function uploadPhotos(photoManager, storagePath) {
            const uploadPromises = photoManager.map(async photo => {
                if (photo.isNew) { // Solo sube las nuevas
                    // Pide URL firmada
                    const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fileName: photo.file.name, contentType: photo.file.type, pathPrefix: storagePath })
                    });
                    if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida de archivo.');
                    const { signedUrl, publicUrl } = await signedUrlResponse.json();

                    // Sube a GCS
                    await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': photo.file.type }, body: photo.file });
                    return publicUrl; // Devuelve URL pública
                }
                return Promise.resolve(photo.url); // Devuelve URL existente
            });
            return await Promise.all(uploadPromises);
        }

        saveButton.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i> Subiendo fotos...';

        // Sube fotos (solo las nuevas) y obtiene las URLs finales
        updateData.fotoUrls = await uploadPhotos(editOrderPhotosManager, 'pedidos');
        updateData.fotoPromocionUrls = await uploadPhotos(editPromoPhotosManager, 'promociones');

        // --- Llama a la API para actualizar el pedido ---
        saveButton.innerHTML = '<i class="fas fa-database mr-2"></i> Actualizando...';
        const response = await fetch(`${API_BASE_URL}/api/orders/${orderId}`, {
            method: 'PUT', // Método PUT para actualizar
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData) // Envía datos actualizados
        });

        const result = await response.json();
        if (!response.ok || !result.success) { // Manejo de error
            throw new Error(result.message || "Ocurrió un error en el servidor.");
        }

        // --- Éxito ---
        closeOrderEditModal(); // Cierra modal
        showError('Pedido actualizado con éxito.', 'success'); // Muestra mensaje
        // El listener de pedidos actualizará la barra lateral

    } catch (error) {
        // --- Manejo de Errores ---
        console.error("Error al actualizar el pedido:", error);
        errorMessageEl.textContent = error.message; // Muestra error en modal
    } finally {
        // --- Rehabilita botón ---
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save mr-2"></i> Guardar Cambios';
    }
}


// --- Campaigns Handlers ---

/**
 * Maneja el envío de una campaña de texto simple.
 */
async function handleSendCampaign() {
    const tagSelect = document.getElementById('campaign-tag-select');
    const templateSelect = document.getElementById('campaign-template-select');
    const button = document.getElementById('send-campaign-btn');

    const selectedTagKey = tagSelect.value;
    const templateString = templateSelect.value; // El valor es el JSON stringified

    // Validaciones
    if (!templateString) { showError("Por favor, selecciona una plantilla para enviar."); return; }

    // Determina los destinatarios
    let recipients = [];
    if (selectedTagKey === 'all') { // Todos los contactos
        recipients = state.contacts;
    } else { // Contactos con la etiqueta seleccionada
        recipients = state.contacts.filter(c => c.status === selectedTagKey);
    }

    if (recipients.length === 0) { showError("No hay contactos en la etiqueta seleccionada para enviar la campaña."); return; }

    const contactIds = recipients.map(c => c.id); // Array de IDs
    const template = JSON.parse(templateString); // Parsea el objeto de plantilla

    // Deshabilita botón y muestra carga
    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...`;

    try {
        // Llama a la API para enviar la campaña
        const response = await fetch(`${API_BASE_URL}/api/campaigns/send-template`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactIds, template }) // Envía IDs y plantilla
        });

        const result = await response.json();
        if (!response.ok || !result.success) { throw new Error(result.message || "Ocurrió un error en el servidor."); }

        // Muestra resumen de resultados
        alert(`Campaña enviada.\n\nÉxitos: ${result.results.successful.length}\nFallos: ${result.results.failed.length}`);

    } catch (error) {
        console.error("Error al enviar la campaña:", error);
        showError(error.message); // Muestra error
    } finally {
        // Rehabilita botón
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane mr-2"></i> Enviar Campaña`;
    }
}

/**
 * Maneja el envío de una campaña con imagen.
 */
async function handleSendCampaignWithImage() {
    // Obtiene referencias a elementos del form
    const tagSelect = document.getElementById('campaign-image-tag-select');
    const templateSelect = document.getElementById('campaign-image-template-select');
    const imageUrlInput = document.getElementById('campaign-image-url-input');
    const phoneInput = document.getElementById('campaign-image-phone-input');
    const button = document.getElementById('send-campaign-image-btn');

    // Obtiene valores
    const templateName = templateSelect.value; // El valor es solo el nombre de la plantilla
    const imageUrl = imageUrlInput.value.trim();
    const phoneNumber = phoneInput.value.trim(); // Número específico (opcional)
    const selectedTagKey = tagSelect.value; // Etiqueta seleccionada (opcional)

    // Busca el objeto completo de la plantilla por su nombre
    const templateObject = state.templates.find(t => t.name === templateName);

    // Validaciones
    if (!templateObject) { showError("Por favor, selecciona una plantilla válida."); return; }
    if (!imageUrl) { showError("Por favor, ingresa la URL de la imagen."); return; }

    // Determina destinatarios
    let recipients = [];
    if (selectedTagKey === 'all' && !phoneNumber) { // Todos (si no hay teléfono)
        recipients = state.contacts;
    } else if (!phoneNumber) { // Por etiqueta (si no hay teléfono)
        recipients = state.contacts.filter(c => c.status === selectedTagKey);
    }
    // Si hay `phoneNumber`, `recipients` queda vacío y se usa `phoneNumber` en el backend

    if (recipients.length === 0 && !phoneNumber) {
        showError("No hay contactos en la etiqueta seleccionada y no se especificó un número de teléfono.");
        return;
    }

    const contactIds = phoneNumber ? [] : recipients.map(c => c.id); // Array de IDs (vacío si es por teléfono)

    // Deshabilita botón y muestra carga
    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...`;

    try {
        // Prepara payload para la API
        const payload = {
            contactIds, // Array de IDs (puede estar vacío)
            templateObject, // Objeto completo de la plantilla
            imageUrl, // URL de la imagen
            phoneNumber // Número específico (puede ser null/vacío)
        };

        // Llama a la API
        const response = await fetch(`${API_BASE_URL}/api/campaigns/send-template-with-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || !result.success) { throw new Error(result.message || "Ocurrió un error en el servidor."); }

        // Muestra resumen
        alert(`Campaña con imagen enviada.\n\nÉxitos: ${result.results.successful.length}\nFallos: ${result.results.failed.length}`);

    } catch (error) {
        console.error("Error al enviar la campaña con imagen:", error);
        showError(error.message); // Muestra error
    } finally {
        // Rehabilita botón
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane mr-2"></i> Enviar Campaña con Imagen`;
    }
}


// --- All other handlers (Tags, Quick Replies, Ad Responses, Settings etc.) ---

/**
 * Maneja el envío del formulario para guardar/actualizar una respuesta rápida.
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSaveQuickReply(event) {
    event.preventDefault(); // Evita recarga

    // Obtiene datos del form
    const id = document.getElementById('qr-doc-id').value;
    const shortcut = document.getElementById('qr-shortcut').value.trim();
    const message = document.getElementById('qr-message').value.trim();
    const fileUrlInput = document.getElementById('qr-file-url');
    let fileUrl = fileUrlInput.value.trim(); // Puede ser URL existente
    const fileTypeInput = document.getElementById('qr-file-type');
    let fileType = fileTypeInput.value.trim(); // Puede ser tipo existente
    const fileInput = document.getElementById('qr-file-input'); // Input para archivo nuevo

    // --- Lógica de subida si se selecciona un archivo NUEVO ---
    if (fileInput.files[0]) {
        const file = fileInput.files[0];
        try {
            showError('Subiendo archivo...', 'info'); // Muestra mensaje de subida

            // 1. Pide URL firmada al backend
            const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    contentType: file.type,
                    pathPrefix: 'quick_replies' // Carpeta específica en GCS
                })
            });
            if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida del archivo.');
            const { signedUrl, publicUrl } = await signedUrlResponse.json();

            // 2. Sube el archivo a GCS usando la URL firmada
            await fetch(signedUrl, {
                method: 'PUT',
                headers: { 'Content-Type': file.type },
                body: file
            });

            // 3. Actualiza fileUrl y fileType con los datos del archivo subido
            fileUrl = publicUrl;
            fileType = file.type;

            hideError(); // Oculta mensaje de subida
        } catch (error) {
            console.error("Error al subir archivo para Quick Reply:", error);
            showError("Error al subir el archivo. Inténtalo de nuevo.");
            return; // Detiene el guardado si falla la subida
        }
    }
    // --- Fin lógica de subida ---

    // Validación: atajo y (mensaje o archivo) son obligatorios
    if (!shortcut || (!message && !fileUrl)) {
        showError("El atajo y un mensaje o archivo son obligatorios.");
        return;
    }

    // Prepara datos para enviar a la API
    const data = { shortcut, message, fileUrl, fileType };
    // Determina URL y método (Crear o Actualizar)
    const url = id ? `${API_BASE_URL}/api/quick-replies/${id}` : `${API_BASE_URL}/api/quick-replies`;
    const method = id ? 'PUT' : 'POST';

    try {
        // Llama a la API
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) { // Manejo de error de API
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar.');
        }
        closeQuickReplyModal(); // Cierra modal si éxito
    } catch (error) {
        console.error("Error saving quick reply:", error);
        showError(error.message); // Muestra error
    }
}

/**
 * Maneja la eliminación de una respuesta rápida.
 * @param {string} replyId El ID de la respuesta a eliminar.
 */
async function handleDeleteQuickReply(replyId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta respuesta rápida?')) return;

    try {
        // Llama a la API para eliminar
        const response = await fetch(`${API_BASE_URL}/api/quick-replies/${replyId}`, { method: 'DELETE' });
        if (!response.ok) { // Manejo de error
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la respuesta rápida.');
        }
        // No necesita cerrar modal, la tabla se actualizará por el listener
    } catch (error) {
        console.error("Error deleting quick reply:", error);
        showError(error.message); // Muestra error
    }
}

/**
 * Maneja el envío del formulario para guardar/actualizar un mensaje de anuncio.
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSaveAdResponse(event) {
    event.preventDefault(); // Evita recarga

    // Obtiene datos del form
    const id = document.getElementById('ar-doc-id').value;
    const adName = document.getElementById('ar-name').value.trim();
    const adIdInput = document.getElementById('ar-ad-id'); // Textarea
    const adIdsRaw = adIdInput.value.trim(); // String con IDs separados por coma
    const message = document.getElementById('ar-message').value.trim();
    const fileUrlInput = document.getElementById('ar-file-url');
    let fileUrl = fileUrlInput.value.trim(); // URL existente
    const fileTypeInput = document.getElementById('ar-file-type');
    let fileType = fileTypeInput.value.trim(); // Tipo existente
    const fileInput = document.getElementById('ar-file-input'); // Input para archivo nuevo

    // --- INICIO DE MODIFICACIÓN: Procesar múltiples IDs ---
    const adIds = adIdsRaw.split(',') // Divide por comas
                         .map(id => id.trim()) // Quita espacios
                         .filter(id => id); // Elimina strings vacíos si hay comas extra
    // --- FIN DE MODIFICACIÓN ---

    // --- Lógica de subida si se selecciona un archivo NUEVO (igual que en QR) ---
    if (fileInput.files[0]) {
        const file = fileInput.files[0];
        try {
            showError('Subiendo archivo...', 'info');
            // Pide URL firmada
            const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: file.name, contentType: file.type, pathPrefix: 'ad_responses' }) // Carpeta específica
            });
            if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida del archivo.');
            const { signedUrl, publicUrl } = await signedUrlResponse.json();
            // Sube a GCS
            await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            // Actualiza fileUrl y fileType
            fileUrl = publicUrl;
            fileType = file.type;
            hideError();
        } catch (error) {
            console.error("Error al subir archivo para Ad Response:", error);
            showError("Error al subir el archivo. Inténtalo de nuevo.");
            return; // Detiene si falla subida
        }
    }
    // --- Fin lógica de subida ---

    // --- INICIO DE MODIFICACIÓN: Validación y envío de 'adIds' ---
    // Valida que haya nombre, al menos un Ad ID válido, y (mensaje o archivo)
    if (!adName || adIds.length === 0 || (!message && !fileUrl)) {
        showError("Nombre, al menos un ID de anuncio válido y un mensaje o archivo son obligatorios.");
        return;
    }
    // Prepara datos para enviar (incluye el array adIds)
    const data = { adName, adIds, message, fileUrl, fileType };
    // --- FIN DE MODIFICACIÓN ---

    // Determina URL y método (Crear o Actualizar)
    const url = id ? `${API_BASE_URL}/api/ad-responses/${id}` : `${API_BASE_URL}/api/ad-responses`;
    const method = id ? 'PUT' : 'POST';

    try {
        // Llama a la API
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) { // Manejo de error de API
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar el mensaje.');
        }
        closeAdResponseModal(); // Cierra modal si éxito
    } catch (error) {
        console.error("Error saving ad response:", error);
        showError(error.message); // Muestra error
    }
}

/**
 * Maneja la eliminación de un mensaje de anuncio.
 * @param {string} id El ID del mensaje a eliminar.
 */
async function handleDeleteAdResponse(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este mensaje de anuncio?')) return;
    try {
        // Llama a la API para eliminar
        const response = await fetch(`${API_BASE_URL}/api/ad-responses/${id}`, { method: 'DELETE' });
        if (!response.ok) { // Manejo de error
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar el mensaje.');
        }
        // La tabla se actualiza por el listener
    } catch (error) {
        showError(error.message); // Muestra error
    }
}

/**
 * Maneja el envío del formulario para guardar/actualizar una entrada en la base de conocimiento.
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSaveKnowledgeBaseEntry(event) {
    event.preventDefault(); // Evita recarga

    // Obtiene datos del form
    const id = document.getElementById('kb-doc-id').value;
    const topic = document.getElementById('kb-topic').value.trim();
    const answer = document.getElementById('kb-answer').value.trim();
    const fileUrlInput = document.getElementById('kb-file-url');
    let fileUrl = fileUrlInput.value.trim(); // URL existente
    const fileTypeInput = document.getElementById('kb-file-type');
    let fileType = fileTypeInput.value.trim(); // Tipo existente
    const fileInput = document.getElementById('kb-file-input'); // Input para archivo nuevo

    // --- Lógica de subida si se selecciona un archivo NUEVO (igual que en QR) ---
    if (fileInput.files[0]) {
        const file = fileInput.files[0];
        try {
            showError('Subiendo archivo...', 'info');
            // Pide URL firmada
            const signedUrlResponse = await fetch(`${API_BASE_URL}/api/storage/generate-signed-url`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: file.name, contentType: file.type, pathPrefix: 'knowledge_base' }) // Carpeta específica
            });
            if (!signedUrlResponse.ok) throw new Error('No se pudo preparar la subida del archivo.');
            const { signedUrl, publicUrl } = await signedUrlResponse.json();
            // Sube a GCS
            await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            // Actualiza fileUrl y fileType
            fileUrl = publicUrl;
            fileType = file.type;
            hideError();
        } catch (error) {
            console.error("Error al subir archivo para Knowledge Base:", error);
            showError("Error al subir el archivo. Inténtalo de nuevo.");
            return; // Detiene si falla subida
        }
    }
    // --- Fin lógica de subida ---

    // Validación: tema y respuesta son obligatorios
    if (!topic || !answer) {
        showError("El tema y la respuesta base son obligatorios.");
        return;
    }

    // Prepara datos para API
    const data = { topic, answer, fileUrl, fileType };
    // Determina URL y método (Crear o Actualizar)
    const url = id ? `${API_BASE_URL}/api/knowledge-base/${id}` : `${API_BASE_URL}/api/knowledge-base`;
    const method = id ? 'PUT' : 'POST';

    try {
        // Llama a la API
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) { // Manejo de error
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar.');
        }
        closeKnowledgeBaseModal(); // Cierra modal si éxito
    } catch (error) {
        console.error("Error saving knowledge base entry:", error);
        showError(error.message); // Muestra error
    }
}

/**
 * Maneja la eliminación de una entrada de la base de conocimiento.
 * @param {string} id El ID de la entrada a eliminar.
 */
async function handleDeleteKnowledgeBaseEntry(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta entrada de la base de conocimiento?')) return;
    try {
        // Llama a la API para eliminar
        const response = await fetch(`${API_BASE_URL}/api/knowledge-base/${id}`, { method: 'DELETE' });
        if (!response.ok) { // Manejo de error
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la entrada.');
        }
        // La tabla se actualiza por el listener
    } catch (error) {
        console.error("Error deleting knowledge base entry:", error);
        showError(error.message); // Muestra error
    }
}

/**
 * Maneja el cambio del interruptor del mensaje de ausencia.
 * @param {boolean} isActive El nuevo estado del interruptor.
 */
async function handleAwayMessageToggle(isActive) {
    try {
        // Llama a la API para guardar el nuevo estado
        const response = await fetch(`${API_BASE_URL}/api/settings/away-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive }) // Envía el estado
        });
        if (!response.ok) throw new Error('No se pudo guardar el ajuste.');
        state.awayMessageSettings.isActive = isActive; // Actualiza estado local
    } catch (error) {
        showError(error.message); // Muestra error
        // Revierte el interruptor en la UI si falla la API
        const toggle = document.getElementById('away-message-toggle');
        if (toggle) toggle.checked = !isActive;
    }
}

/**
 * Maneja el cambio del interruptor del bot global.
 * @param {boolean} isActive El nuevo estado del interruptor.
 */
async function handleGlobalBotToggle(isActive) {
    try {
        // Llama a la API para guardar el estado
        const response = await fetch(`${API_BASE_URL}/api/settings/global-bot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive }) // Envía el estado
        });
        if (!response.ok) throw new Error('No se pudo guardar el ajuste del bot global.');
        state.globalBotSettings.isActive = isActive; // Actualiza estado local
    } catch (error) {
        showError(error.message); // Muestra error
        // Revierte el interruptor si falla
        const toggle = document.getElementById('global-bot-toggle');
        if (toggle) toggle.checked = !isActive;
    }
}

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

        // Si el chat de este contacto está abierto, vuelve a dibujarlo para mostrar el cambio
        // en la cabecera (icono del bot).
        if(state.selectedContactId === contactId) {
            renderChatWindow();
        }
        // Actualiza también la tabla de anulaciones si está visible
        if(state.activeView === 'ajustes-ia') {
            const input = document.querySelector(`input[onchange="handleBotToggle('${contactId}', this.checked)"]`);
            if (input) input.checked = isActive;
        }
    }

    // --- 2. Llamada a la API ---
    try {
        const response = await fetch(`${API_BASE_URL}/api/bot/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId, isActive }) // Envía ID y nuevo estado
        });
        if (!response.ok) { // Manejo de error de API
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al actualizar el estado del bot.');
        }
        // El listener de Firestore ('listenForContactUpdates') debería encargarse de sincronizar
        // el estado real si la llamada fue exitosa, pero la UI ya está actualizada.
    } catch (error) {
        console.error("Error al cambiar el estado del bot:", error);
        showError(error.message); // Muestra error

        // --- 3. Revertir la UI en caso de fallo de la API ---
        if (contactIndex > -1 && originalState !== null) {
            state.contacts[contactIndex].botActive = originalState; // Restaura estado local
            // Vuelve a renderizar si es necesario
            if(state.selectedContactId === contactId) {
                renderChatWindow();
            }
             if(state.activeView === 'ajustes-ia') {
                 const input = document.querySelector(`input[onchange="handleBotToggle('${contactId}', this.checked)"]`);
                 if (input) input.checked = originalState !== false; // Restaura checkbox
             }
        }
    }
}


/**
 * Maneja el envío del formulario para guardar/actualizar un prompt de IA por anuncio.
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSaveAIAdPrompt(event) {
    event.preventDefault(); // Evita recarga

    // Obtiene datos del form
    const id = document.getElementById('aip-doc-id').value;
    const adName = document.getElementById('aip-name').value.trim();
    const adId = document.getElementById('aip-ad-id').value.trim();
    const prompt = document.getElementById('aip-prompt').value.trim();

    // Validación
    if (!adName || !adId || !prompt) {
        showError("Nombre, ID de anuncio y el prompt son obligatorios.");
        return;
    }

    // Prepara datos y determina URL/método (Crear o Actualizar)
    const data = { adName, adId, prompt };
    const url = id ? `${API_BASE_URL}/api/ai-ad-prompts/${id}` : `${API_BASE_URL}/api/ai-ad-prompts`;
    const method = id ? 'PUT' : 'POST';

    try {
        // Llama a la API
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) { // Manejo de error
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar el prompt.');
        }
        closeAIAdPromptModal(); // Cierra modal si éxito
    } catch (error) {
        console.error("Error saving AI ad prompt:", error);
        showError(error.message); // Muestra error
    }
}

/**
 * Maneja la eliminación de un prompt de IA por anuncio.
 * @param {string} id El ID del prompt a eliminar.
 */
async function handleDeleteAIAdPrompt(id) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este prompt de IA?')) return;
    try {
        // Llama a la API para eliminar
        const response = await fetch(`${API_BASE_URL}/api/ai-ad-prompts/${id}`, { method: 'DELETE' });
        if (!response.ok) { // Manejo de error
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar el prompt.');
        }
        // La tabla se actualiza por el listener
    } catch (error) {
        showError(error.message); // Muestra error
    }
}

/**
 * Maneja el envío del formulario para guardar las instrucciones generales del bot.
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSaveBotSettings(event) {
    event.preventDefault(); // Evita recarga
    const instructions = document.getElementById('bot-instructions').value.trim(); // Obtiene instrucciones

    try {
        // Llama a la API para guardar
        const response = await fetch(`${API_BASE_URL}/api/bot/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instructions }) // Envía las instrucciones
        });
        if (!response.ok) { // Manejo de error
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar los ajustes.');
        }
        state.botSettings.instructions = instructions; // Actualiza estado local
        closeBotSettingsModal(); // Cierra modal
        showError('Instrucciones del bot guardadas con éxito.', 'success'); // Muestra éxito
    } catch (error) {
        console.error("Error saving bot settings:", error);
        showError(error.message); // Muestra error
    }
}

// --- INICIO DE MODIFICACIÓN: Handlers para la sección de Métricas por Ad ID ---

/**
 * Manejador para el botón "Cargar Datos" de la sección Métricas por Ad ID.
 * Llama a la función `loadAdIdMetrics` en ui-manager.js.
 */
function handleLoadAdIdMetrics() {
    // La lógica de obtener fechas y llamar a la API está en loadAdIdMetrics (ui-manager)
    // Simplemente llamamos a esa función.
    if (typeof loadAdIdMetrics === 'function') {
        loadAdIdMetrics();
    } else {
        console.error("La función loadAdIdMetrics no está definida globalmente.");
        showError("Error interno: No se puede cargar la función de métricas.");
    }
}

/**
 * Manejador para el botón "Limpiar" de la sección Métricas por Ad ID.
 * Llama a la función `clearAdIdMetricsFilter` en ui-manager.js.
 */
function handleClearAdIdMetricsFilter() {
    if (typeof clearAdIdMetricsFilter === 'function') {
        clearAdIdMetricsFilter();
    } else {
        console.error("La función clearAdIdMetricsFilter no está definida globalmente.");
        showError("Error interno: No se puede limpiar el filtro de métricas.");
    }
}
// --- FIN DE MODIFICACIÓN ---



/**
 * Maneja el guardado de una etiqueta (crear o actualizar).
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSaveTag(event) {
    event.preventDefault();
    const id = document.getElementById('tag-id').value;
    const label = document.getElementById('tag-label').value.trim();
    const color = document.getElementById('tag-color-input').value;

    if (!label || !color) {
        showError("La etiqueta y el color son obligatorios.");
        return;
    }

    const data = { label, color };
    const url = id ? `${API_BASE_URL}/api/tags/${id}` : `${API_BASE_URL}/api/tags`;
    const method = id ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al guardar la etiqueta.');
        }
        closeTagModal();
    } catch (error) {
        console.error("Error saving tag:", error);
        showError(error.message);
    }
}

// --- Make functions globally accessible ---
// Funciones que se llaman directamente desde el HTML (onclick)
window.handleUpdateContact = handleUpdateContact;
window.handleDeleteContact = handleDeleteContact;
window.handleGenerateReply = handleGenerateReply;
window.handleMarkAsPurchase = handleMarkAsPurchase;
window.handleMarkAsRegistration = handleMarkAsRegistration; // Mantener si aún se usa
window.handleSendViewContent = handleSendViewContent;
window.handleSaveOrder = handleSaveOrder;
window.handleUpdateExistingOrder = handleUpdateExistingOrder;
window.handleSendCampaign = handleSendCampaign;
window.handleSendCampaignWithImage = handleSendCampaignWithImage;
window.handleSaveQuickReply = handleSaveQuickReply;
window.handleDeleteQuickReply = handleDeleteQuickReply;
window.handleSaveAdResponse = handleSaveAdResponse;
window.handleDeleteAdResponse = handleDeleteAdResponse;
window.handleSaveKnowledgeBaseEntry = handleSaveKnowledgeBaseEntry;
window.handleDeleteKnowledgeBaseEntry = handleDeleteKnowledgeBaseEntry;
window.handleAwayMessageToggle = handleAwayMessageToggle;
window.handleGlobalBotToggle = handleGlobalBotToggle;
window.handleBotToggle = handleBotToggle; // Hacer global
window.handleSaveAIAdPrompt = handleSaveAIAdPrompt;
window.handleDeleteAIAdPrompt = handleDeleteAIAdPrompt;
window.handleSaveBotSettings = handleSaveBotSettings;
window.handleSelectContactFromPipeline = handleSelectContactFromPipeline;
window.handleSaveTag = handleSaveTag; // Necesaria para el modal de etiquetas
window.handleDeleteTag = handleDeleteTag; // Necesaria para el modal de etiquetas
window.handleDeleteAllTags = handleDeleteAllTags; // Necesaria para el botón
// --- INICIO MODIFICACIÓN ---
window.handleLoadAdIdMetrics = handleLoadAdIdMetrics; // Hacer global
window.handleClearAdIdMetricsFilter = handleClearAdIdMetricsFilter; // Hacer global
// --- FIN MODIFICACIÓN ---
