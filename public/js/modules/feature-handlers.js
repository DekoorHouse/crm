// --- START: Event Handlers for Other App Features ---
// Este archivo agrupa los manejadores de eventos para las funcionalidades
// que no son el chat principal, como campañas, etiquetas, ajustes, etc.

/**
 * Modal de confirmación que reemplaza confirm() nativo.
 * Retorna una Promise<boolean>.
 */
function showConfirmModal(message, { icon = 'help', confirmText = 'Aceptar', cancelText = 'Cancelar' } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);';
        const card = document.createElement('div');
        card.style.cssText = 'background:var(--color-surface-container-lowest,#fff);border-radius:16px;padding:24px;width:340px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.25);text-align:center;font-family:Manrope,sans-serif;';
        card.innerHTML = `
            <div style="width:44px;height:44px;border-radius:50%;background:var(--color-primary-container,#81b29a);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
                <span class="material-symbols-outlined" style="font-size:24px;color:var(--color-on-primary-container,#134532)">${icon}</span>
            </div>
            <p style="font-size:14px;color:var(--color-on-surface,#1b1b1f);margin:0 0 20px;line-height:1.5">${message}</p>
            <div style="display:flex;gap:8px">
                <button id="_cm_cancel" style="flex:1;padding:10px;border-radius:12px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:var(--color-surface-container-low,#f6f2f8);color:var(--color-on-surface-variant,#414944);transition:background .15s">${cancelText}</button>
                <button id="_cm_ok" style="flex:1;padding:10px;border-radius:12px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:var(--color-primary,#386753);color:var(--color-on-primary,#fff);box-shadow:0 1px 3px rgba(0,0,0,.15);transition:opacity .15s">${confirmText}</button>
            </div>`;
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        function close(val) { overlay.remove(); resolve(val); }
        card.querySelector('#_cm_ok').addEventListener('click', () => close(true));
        card.querySelector('#_cm_cancel').addEventListener('click', () => close(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    });
}


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
        scrollToContact(contactId); // Scroll al contacto en la lista virtual
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

/**
 * Envía la respuesta rápida "Pedir Datos de Envío" al cliente (J&T).
 */
async function handlePedirDatosEnvio() {
    if (!state.selectedContactId) return;
    const ok = await showConfirmModal("¿Enviar al cliente la solicitud de datos de envío para su último pedido?", { icon: 'local_shipping', confirmText: 'Enviar' });
    if (!ok) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/jt-guias/pedir-datos/${state.selectedContactId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shortcut: "Datos J&T" })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Error al enviar solicitud');
        showError(`Solicitud enviada para pedido ${result.orderNumber || ''}`.trim(), 'success');
    } catch (error) {
        showError(error.message);
    }
}

/**
 * Cancela la guía J&T activa del último pedido del contacto seleccionado.
 */
async function handleCancelarGuiaEnvio() {
    if (!state.selectedContactId) return;
    const ok = await showConfirmModal("¿Confirmas que quieres cancelar la guía de envío del último pedido de este contacto?", { icon: 'cancel', confirmText: 'Cancelar guía' });
    if (!ok) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/jt-guias/cancelar-por-contacto/${state.selectedContactId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Error al cancelar la guía');
        showError(result.message || 'Guía cancelada.', 'success');
    } catch (error) {
        showError(error.message);
    }
}

// --- START: New Order Logic ---
/**
 * Maneja el envío del formulario para crear un nuevo pedido.
 * @param {Event} event El evento de envío del formulario.
 */
async function handleSaveOrder(event) {
    event.preventDefault(); // Evita recarga
    const form = document.getElementById('formularioNuevoPedido');
    const saveButton = document.getElementById('btnGuardarPedido');
    const errorMessageEl = document.getElementById('mensajeErrorPedido');

    // Validación: debe haber un contacto seleccionado
    if (!state.selectedContactId) {
        showError("No se ha seleccionado un contacto.");
        return;
    }

    // --- 1. Recolectar datos del formulario ---
    const telefono = document.getElementById('pedidoTelefono').value.trim();
    if (!telefono) { // Validar teléfono
        errorMessageEl.textContent = 'El número de teléfono es obligatorio.';
        return;
    }

    // Recolectar items (multi-producto)
    const itemRows = document.querySelectorAll('#order-items-container .order-item-row');
    const items = Array.from(itemRows).map(row => ({
        producto: row.querySelector('.order-item-product').value,
        precio: Number(row.querySelector('.order-item-price').value) || 0,
        datosProducto: row.querySelector('.order-item-details').value.trim()
    }));

    if (items.length === 0) {
        errorMessageEl.textContent = 'Debe haber al menos un producto.';
        return;
    }

    // Crear objeto con los datos del pedido (compat: el primer producto también se expone como producto/precio/datosProducto para backend legacy)
    const orderData = {
        contactId: state.selectedContactId, // ID del contacto actual
        items: items,
        producto: items[0].producto,
        telefono: telefono,
        precio: items[0].precio,
        datosProducto: items[0].datosProducto,
        datosPromocion: document.getElementById('pedidoDatosPromocion').value.trim(),
        comentarios: document.getElementById('pedidoComentarios').value.trim(),
        // Los arrays de fotos se manejarán después
    };

    // --- 2. Deshabilitar formulario y mostrar estado de carga ---
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
    errorMessageEl.textContent = ''; // Limpiar errores previos

    try {
        // --- 3. Manejar subida de fotos ---
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
        const finalOrderPhotoUrls = await uploadPhotos(orderPhotosManager, 'pedidos');
        const finalPromoPhotoUrls = await uploadPhotos(promoPhotosManager, 'promociones');

        orderData.fotoUrls = finalOrderPhotoUrls;
        orderData.fotoPromocionUrls = finalPromoPhotoUrls;

        // --- 4. Enviar datos al backend para crear el pedido ---
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

        // --- 5. Manejar éxito ---
        cerrarModalPedido(); // Cierra el modal de entrada

        // Renderiza el modal de confirmación unificado (un solo número de pedido)
        const confirmationContainer = document.getElementById('order-confirmation-modal-container');
        if (confirmationContainer) {
            confirmationContainer.innerHTML = OrderConfirmationModalTemplate(result.orderNumber);
        }

    } catch (error) {
        console.error("Error al guardar el pedido:", error);
        errorMessageEl.textContent = error.message;
    } finally {
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

    // Recolectar items (multi-producto) del modal de edición
    const itemRows = document.querySelectorAll('#edit-order-items-container .order-item-row');
    const items = Array.from(itemRows).map(row => ({
        producto: row.querySelector('.edit-order-item-product').value,
        precio: Number(row.querySelector('.edit-order-item-price').value) || 0,
        datosProducto: row.querySelector('.edit-order-item-details').value.trim()
    }));

    if (items.length === 0) {
        errorMessageEl.textContent = 'Debe haber al menos un producto.';
        return;
    }

    // Objeto con los datos a actualizar. El backend normaliza items y re-deriva producto/precio/datosProducto.
    const updateData = {
        items: items,
        telefono: document.getElementById('edit-order-phone').value.trim(),
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

async function handleMigrateOrphans() {
    if (!window.confirm("¿Estás seguro de que quieres migrar todos los chats sin departamento al departamento 'General'? Esta acción no se puede deshacer.")) {
        return;
    }

    try {
        showError('Migrando chats huérfanos... Por favor, espera.', 'info');

        const response = await fetch(`${API_BASE_URL}/api/maintenance/migrate-orphans`, {
            method: 'POST',
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Ocurrió un error en el servidor durante la migración.');
        }

        // Usar la función global para mostrar errores/éxitos
        showError(result.message, 'success');

        // Opcional: Si estás en la vista de chats, recargar la lista para ver los cambios
        if (state.activeView === 'chats') {
            fetchInitialContacts();
        }

    } catch (error) {
        console.error('Error al migrar chats huérfanos:', error);
        showError(error.message, 'error');
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


/**
 * Maneja el cambio de estatus de un contacto (usado en el pipeline).
 * @param {string} contactId - El ID del contacto a actualizar.
 * @param {string} newStatus - El nuevo estatus (key de la etiqueta).
 */
async function handleStatusChange(contactId, newStatusKey) {
    const id = contactId || state.selectedContactId;
    if (!id) return;

    const contact = state.contacts.find(c => c.id === id);
    if (!contact) return;

    // Determinar el estado final: si es el mismo, se desactiva (null), si no, se activa el nuevo
    const finalStatus = contact.status === newStatusKey ? null : newStatusKey;

    // --- Optimistic UI Update ---
    const originalStatus = contact.status; // Guardar estado original para revertir si falla
    contact.status = finalStatus; // Actualizar estado localmente
    scheduleContactListRender(); // Re-renderizar la lista de contactos
    if (state.selectedContactId === id) {
        renderChatWindow(); // Re-renderizar la ventana de chat si es el contacto activo
        if (state.contactDetailsOpen) {
            openContactDetails(); // Re-renderizar detalles si están abiertos
        }
    }
    // --- End Optimistic UI Update ---

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: finalStatus })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al actualizar el estatus del contacto.');
        }

        showError(`Estatus del contacto actualizado a "${finalStatus || 'Sin etiqueta'}".`, 'success');
        // No es necesario re-renderizar aquí, ya se hizo de forma optimista.
        // El listener de Firestore eventualmente confirmará el cambio.

    } catch (error) {
        console.error("Error al actualizar el estatus del contacto: ", error);
        showError("Error al actualizar el estatus del contacto. Revisa la consola.", 'error');
        // --- Revertir UI si la API falla ---
        contact.status = originalStatus;
        scheduleContactListRender();
        if (state.selectedContactId === id) {
            renderChatWindow();
            if (state.contactDetailsOpen) {
                openContactDetails();
            }
        }
        // --- Fin Revertir UI ---
    }
}

/**
 * Maneja la eliminación de una etiqueta.
 * @param {string} tagId - El ID de la etiqueta a eliminar.
 */
async function handleDeleteTag(tagId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta etiqueta? Esto también afectará a los contactos que la tengan asignada.')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/tags/${tagId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la etiqueta.');
        }

        showError('Etiqueta eliminada con éxito.', 'success');
        // La UI se actualizará automáticamente gracias al listener de etiquetas.

    } catch (error) {
        console.error("Error al eliminar la etiqueta: ", error);
        showError("Error al eliminar la etiqueta. Revisa la consola.", 'error');
    }
}


/**
 * Maneja la eliminación de TODAS las etiquetas.
 */
async function handleDeleteAllTags() {
    if (!window.confirm('ADVERTENCIA: ¿Estás absolutamente seguro de que quieres eliminar TODAS las etiquetas? Esta acción es irreversible y desasignará la etiqueta de todos los contactos.')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/tags`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar las etiquetas.');
        }

        showError('Todas las etiquetas han sido eliminadas.', 'success');
        // La UI se actualizará a través de los listeners de Firestore.
    } catch (error) {
        console.error("Error deleting all tags:", error);
        showError(error.message);
    }
}


/**
 * Alterna la visibilidad del campo de entrada para nuevas notas en el sidebar.
 */
function toggleSidebarNoteInput() {
    const container = document.getElementById('sidebar-note-input-container');
    if (!container) return;
    container.classList.toggle('hidden');
    if (!container.classList.contains('hidden')) {
        const input = document.getElementById('sidebar-note-input');
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

/**
 * Guarda una nueva nota desde el sidebar.
 */
async function handleSaveSidebarNote() {
    const input = document.getElementById('sidebar-note-input');
    const text = input.value.trim();
    if (!text) {
        showError("La nota no puede estar vacía.");
        return;
    }

    const contactId = state.selectedContactId;
    if (!contactId) {
        showError("No hay un contacto seleccionado.");
        return;
    }

    const button = document.querySelector('[onclick="handleSaveSidebarNote()"]');
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error del servidor');
        }

        // Limpiar y ocultar
        input.value = '';
        toggleSidebarNoteInput();
        showError("Nota guardada.", "success");
        // La UI se actualizará automáticamente gracias al listener de Firestore.
    } catch (error) {
        console.error('Error al guardar la nota desde el sidebar:', error);
        showError(error.message);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Guardar';
        }
    }
}


/**
 * Maneja la actualización del contenido de una nota existente.
 * @param {string} noteId El ID de la nota a actualizar.
 */
async function handleUpdateNote(noteId) {
    const input = document.getElementById(`edit-note-input-${noteId}`);
    if (!input) {
        console.error(`No se encontró el input para la nota ${noteId}`);
        return;
    }
    const newContent = input.value.trim();

    if (!newContent) {
        showError("La nota no puede estar vacía.");
        return;
    }

    try {
        const contactId = state.selectedContactId;
        if (!contactId) throw new Error("No hay un contacto seleccionado.");

        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newContent })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al actualizar la nota.');
        }

        // La UI se actualizará automáticamente gracias al listener de Firestore.
        // Simplemente volvemos a la vista de solo lectura.
        toggleEditNote(null);

    } catch (error) {
        console.error("Error updating note:", error);
        showError(error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Guardar';
    }
}

/**
 * Maneja la eliminación de una nota.
 * @param {string} noteId El ID de la nota a eliminar.
 */
async function handleDeleteNote(noteId) {
    if (!window.confirm('¿Estás seguro de que quieres eliminar esta nota?')) return;

    try {
        const contactId = state.selectedContactId;
        if (!contactId) throw new Error("No hay un contacto seleccionado.");

        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/notes/${noteId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error al eliminar la nota.');
        }
        // La UI se actualizará automáticamente gracias al listener de Firestore.
        showError('Nota eliminada.', 'success');

    } catch (error) {
        console.error("Error deleting note:", error);
        showError(error.message);
    }
}

// --- NUEVO: Manejadores para Departamentos y Reglas de Enrutamiento ---

// --- DEPARTAMENTOS ---
async function handleSaveDepartment(event) {
    event.preventDefault();
    // No need to re-declare API_BASE_URL, it's global
    const id = document.getElementById('dept-id').value;
    const name = document.getElementById('dept-name').value.trim();
    const color = document.getElementById('dept-color-input').value;

    if (!name) {
        showError("El nombre del departamento es obligatorio.");
        return;
    }

    // Obtener los emails de los usuarios seleccionados
    const selectedUsers = Array.from(document.querySelectorAll('#department-users-container input[type="checkbox"]:checked'))
                                .map(cb => cb.value);

    const data = { name, color, users: selectedUsers };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE_URL}/api/departments/${id}` : `${API_BASE_URL}/api/departments`;

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
             const errorData = await response.json();
             throw new Error(errorData.message || "Error al guardar departamento.");
        }
        
        closeDepartmentModal();
        showError("Departamento guardado correctamente.", "success");
    } catch (error) {
        showError(error.message);
    }
}

async function handleDeleteDepartment(id) {
    if (!confirm("¿Estás seguro de eliminar este departamento?")) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/departments/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error("Error al eliminar departamento.");
        showError("Departamento eliminado.", "success");
    } catch (error) {
        showError(error.message);
    }
}

// --- REGLAS DE ENRUTAMIENTO ---
async function handleSaveAdRoutingRule(event) {
    event.preventDefault();
    const id = document.getElementById('rule-id').value;
    const ruleName = document.getElementById('rule-name').value.trim();
    const adIds = document.getElementById('rule-ad-ids').value.trim();
    const targetDepartmentId = document.getElementById('rule-target-dept').value;
    const enableAi = document.getElementById('rule-enable-ai').checked; // Nuevo

    if (!ruleName || !adIds || !targetDepartmentId) {
        showError("Nombre, Ad IDs y Departamento son obligatorios.");
        return;
    }

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE_URL}/api/ad-routing-rules/${id}` : `${API_BASE_URL}/api/ad-routing-rules`;

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ruleName, adIds, targetDepartmentId, enableAi })
        });
        if (!response.ok) throw new Error("Error al guardar regla.");
        
        closeAdRoutingModal();
        showError("Regla guardada correctamente.", "success");
    } catch (error) {
        showError(error.message);
    }
}

async function handleDeleteAdRoutingRule(id) {
    if (!confirm("¿Estás seguro de eliminar esta regla?")) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/ad-routing-rules/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error("Error al eliminar regla.");
        showError("Regla eliminada.", "success");
    } catch (error) {
        showError(error.message);
    }
}

// --- TRANSFERENCIA DE CHAT ---
async function handleTransferChat(event) {
    event.preventDefault(); // Evita la recarga de la página por el submit del formulario

    const contactId = document.getElementById('transfer-contact-id').value;
    const targetDepartmentId = document.getElementById('transfer-dept-hidden-input').value;
    const button = event.target.querySelector('button[type="submit"]'); // Selecciona el botón de submit dentro del formulario

    if (!targetDepartmentId) {
        showError("Debes seleccionar un departamento destino.");
        return;
    }

    // Deshabilita el botón y muestra spinner
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transfiriendo...';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/transfer`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetDepartmentId })
        });

        if (!response.ok) throw new Error("Error al transferir el chat.");

        closeTransferModal();
        showError("Chat transferido con éxito.", "success");
        
        // Opcional: Si el usuario actual no tiene acceso al nuevo departamento,
        // podrías redirigirlo o limpiar la vista, pero el listener de Firestore
        // debería encargarse de quitar el chat de la lista eventualmente.

    } catch (error) {
        showError(error.message);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Transferir';
        }
    }
}

// --- END NUEVOS MANEJADORES ---


// =====================================================================
// OXXO: Genera referencia de pago para mandar por WhatsApp al cliente
// =====================================================================
async function handleGenerarOxxo() {
    if (!state.selectedContactId) {
        showError('Selecciona un contacto primero.');
        return;
    }
    const contactId = state.selectedContactId;
    const contact = state.contacts.find(c => c.id === contactId);
    const contactName = contact?.name || '';

    // Buscar ultimo pedido del contacto para detectar precio
    let latestOrder = null;
    try {
        const r = await fetch(`${API_BASE_URL}/api/mercadopago/contact-latest-order/${contactId}`);
        if (r.ok) {
            const data = await r.json();
            if (data.found) latestOrder = data;
        }
    } catch (e) {
        console.warn('[OXXO] No se pudo obtener ultimo pedido:', e.message);
    }

    showOxxoModal({ contactId, contactName, latestOrder });
}

function showOxxoModal({ contactId, contactName, latestOrder }) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font-family:Manrope,sans-serif;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:440px;max-width:92vw;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);';

    const orderInfoLine = latestOrder
        ? `<div style="background:#f5f5f5;padding:10px 14px;border-radius:8px;font-size:0.82rem;color:#444;margin-bottom:14px;"><strong>Último pedido:</strong> ${latestOrder.orderNumber} · <strong>${latestOrder.productName || 's/p'}</strong> · $${Number(latestOrder.precio).toLocaleString('es-MX')} MXN</div>`
        : `<div style="background:#fff8e1;padding:10px 14px;border-radius:8px;font-size:0.82rem;color:#92400e;margin-bottom:14px;"><i class="fas fa-info-circle"></i> Este contacto no tiene pedidos registrados. La referencia OXXO se generará sin vincular a un pedido.</div>`;

    const defaultAmount = latestOrder?.precio || '';

    card.innerHTML = `
        <h2 style="margin:0 0 14px;font-size:1.15rem;display:flex;align-items:center;gap:8px;">
            <i class="fas fa-store" style="color:#e2231a"></i> Generar Pago OXXO
        </h2>
        <div id="oxxoStep1">
            <p style="margin:0 0 12px;color:#555;font-size:0.9rem;">Confirma el monto a cobrar. La referencia se compartirá por WhatsApp.</p>
            ${orderInfoLine}
            <label style="display:block;font-weight:600;font-size:0.85rem;margin-bottom:6px;">Monto a cobrar (MXN) *</label>
            <input type="number" id="oxxoModalMonto" step="0.01" min="1" value="${defaultAmount}" placeholder="650.00"
                style="width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:8px;font-size:1rem;margin-bottom:12px;font-family:inherit;">
            <label style="display:block;font-weight:600;font-size:0.85rem;margin-bottom:6px;">Nombre del cliente</label>
            <input type="text" id="oxxoModalNombre" value="${contactName}" placeholder="Opcional"
                style="width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:8px;font-size:1rem;margin-bottom:12px;font-family:inherit;">
            <label style="display:block;font-weight:600;font-size:0.85rem;margin-bottom:6px;">Nota interna</label>
            <input type="text" id="oxxoModalNota" placeholder="Opcional"
                style="width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:8px;font-size:1rem;margin-bottom:12px;font-family:inherit;">
            <div id="oxxoModalError" style="display:none;background:#fee;color:#c00;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:0.85rem;"></div>
            <div style="display:flex;gap:8px;">
                <button id="oxxoModalCancel" style="flex:1;padding:12px;border-radius:10px;border:none;background:#f3f4f6;color:#374151;font-weight:700;cursor:pointer;font-family:inherit;">Cancelar</button>
                <button id="oxxoModalGenerar" style="flex:1;padding:12px;border-radius:10px;border:none;background:#e2231a;color:#fff;font-weight:700;cursor:pointer;font-family:inherit;">
                    <i class="fas fa-bolt"></i> Generar referencia
                </button>
            </div>
        </div>
        <div id="oxxoStep2" style="display:none;">
            <div style="background:#fff8e1;border-left:3px solid #f59e0b;padding:12px;border-radius:8px;margin-bottom:14px;">
                <div style="font-weight:700;color:#b45309;font-size:0.88rem;">✅ Referencia generada</div>
                <div style="font-size:0.78rem;color:#666;margin-top:3px;">Compártela por WhatsApp. Te llegará alerta al WhatsApp del admin cuando se acredite (hasta 48h).</div>
            </div>
            <div id="oxxoResultBox" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px;"></div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <a id="oxxoVoucherLink" href="#" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#e2231a;color:#fff;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;">
                    <i class="fas fa-external-link-alt"></i> Ver / imprimir ficha OXXO
                </a>
                <button id="oxxoCopyMsgBtn" style="background:#25d366;color:#fff;padding:12px;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;">
                    <i class="fab fa-whatsapp"></i> Copiar mensaje para WhatsApp
                </button>
                <button id="oxxoSendChatBtn" style="background:#128c7e;color:#fff;padding:12px;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;">
                    <i class="fas fa-paper-plane"></i> Enviar al chat actual
                </button>
            </div>
            <div style="margin-top:12px;text-align:center;">
                <button id="oxxoCloseBtn" style="background:#f3f4f6;color:#374151;padding:10px 20px;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-family:inherit;">Listo</button>
            </div>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    card.querySelector('#oxxoModalCancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    card.querySelector('#oxxoModalGenerar').addEventListener('click', async () => {
        const monto = parseFloat(card.querySelector('#oxxoModalMonto').value);
        const nombre = card.querySelector('#oxxoModalNombre').value.trim();
        const nota = card.querySelector('#oxxoModalNota').value.trim();
        const errEl = card.querySelector('#oxxoModalError');
        errEl.style.display = 'none';

        if (!monto || monto <= 0) {
            errEl.textContent = 'Ingresa un monto válido.';
            errEl.style.display = 'block';
            return;
        }

        const btn = card.querySelector('#oxxoModalGenerar');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';

        try {
            const orderNumber = latestOrder?.orderNumber || '';
            const productName = latestOrder?.productName
                ? `${latestOrder.productName}${orderNumber ? ' - ' + orderNumber : ''}`
                : (orderNumber ? `Pedido ${orderNumber}` : 'Pago Dekoor');

            const res = await fetch(`${API_BASE_URL}/api/mercadopago/oxxo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: monto,
                    customerName: nombre,
                    customerPhone: contactId,
                    orderNumber,
                    productName,
                    note: nota
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al generar referencia');

            renderOxxoResult({ data, monto, nombre, orderNumber, contactId });
        } catch (err) {
            console.error('[OXXO] Error:', err);
            errEl.textContent = 'Error: ' + err.message;
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-bolt"></i> Generar referencia';
        }
    });

    function renderOxxoResult({ data, monto, nombre, orderNumber, contactId }) {
        card.querySelector('#oxxoStep1').style.display = 'none';
        card.querySelector('#oxxoStep2').style.display = '';

        let venceTxt = '-';
        if (data.expirationDate) {
            try {
                venceTxt = new Date(data.expirationDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            } catch {}
        }

        card.querySelector('#oxxoResultBox').innerHTML = `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee;font-size:0.85rem;">
                <span style="color:#888;">Monto</span>
                <strong style="color:#e2231a;">$${Number(monto).toLocaleString('es-MX')} MXN</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee;font-size:0.85rem;">
                <span style="color:#888;">Cliente</span>
                <span style="font-weight:600;">${nombre || '-'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee;font-size:0.85rem;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="color:#888;">Referencia</span>
                <span style="font-family:'Courier New',monospace;font-weight:700;word-break:break-all;text-align:right;">${data.barcodeContent || 'Ver ficha'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:0.85rem;">
                <span style="color:#888;">Vence</span>
                <span style="font-weight:600;">${venceTxt}</span>
            </div>
        `;

        const voucherLink = card.querySelector('#oxxoVoucherLink');
        if (data.voucherUrl) {
            voucherLink.href = data.voucherUrl;
        } else {
            voucherLink.style.display = 'none';
        }

        // Mensaje pre-armado
        const firstName = nombre ? nombre.split(' ')[0] : '';
        const msg = [
            `Hola${firstName ? ' ' + firstName : ''}, te comparto los datos de pago${orderNumber ? ' para tu pedido ' + orderNumber : ''}:`,
            ``,
            `🏪 *Pago en OXXO*`,
            `💰 Monto: $${Number(monto).toLocaleString('es-MX')} MXN`,
            data.barcodeContent ? `🔢 Referencia: ${data.barcodeContent}` : '',
            venceTxt !== '-' ? `📅 Vence: ${venceTxt}` : '',
            data.voucherUrl ? `\n📄 Ficha de pago: ${data.voucherUrl}` : '',
            ``,
            `Acude a cualquier OXXO con la referencia. En cuanto se acredite el pago te aviso. ¡Gracias!`
        ].filter(Boolean).join('\n');

        const btnCopy = card.querySelector('#oxxoCopyMsgBtn');
        btnCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(msg).then(() => {
                btnCopy.innerHTML = '<i class="fas fa-check"></i> ¡Copiado!';
                setTimeout(() => { btnCopy.innerHTML = '<i class="fab fa-whatsapp"></i> Copiar mensaje para WhatsApp'; }, 2000);
            });
        });

        // Enviar al chat actual usando el input de mensaje
        const btnSendChat = card.querySelector('#oxxoSendChatBtn');
        btnSendChat.addEventListener('click', () => {
            const input = document.getElementById('message-input') || document.querySelector('textarea[placeholder*="mensaje" i]');
            if (input) {
                if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
                    input.value = msg;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    input.innerText = msg;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                input.focus();
                close();
                showError('Mensaje pegado en el chat. Revisa y envía.', 'success');
            } else {
                navigator.clipboard.writeText(msg).then(() => {
                    showError('No encontré el input. Mensaje copiado al portapapeles.', 'success');
                });
            }
        });

        card.querySelector('#oxxoCloseBtn').addEventListener('click', close);
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
window.handlePedirDatosEnvio = handlePedirDatosEnvio;
window.handleCancelarGuiaEnvio = handleCancelarGuiaEnvio;
window.handleGenerarOxxo = handleGenerarOxxo;
window.handleSaveOrder = handleSaveOrder;
window.handleUpdateExistingOrder = handleUpdateExistingOrder;
window.handleSendCampaign = handleSendCampaign;
window.handleSendCampaignWithImage = handleSendCampaignWithImage;
window.handleSaveQuickReply = handleSaveQuickReply;
window.handleDeleteQuickReply = handleDeleteQuickReply;
window.handleSaveAdResponse = handleSaveAdResponse;
window.handleDeleteAdResponse = handleDeleteAdResponse;

window.handleSelectContactFromPipeline = handleSelectContactFromPipeline;
window.handleSaveTag = handleSaveTag; // Necesaria para el modal de etiquetas
window.handleDeleteTag = handleDeleteTag; // Necesaria para el modal de etiquetas
window.handleDeleteAllTags = handleDeleteAllTags; // Necesaria para el botón
// --- INICIO MODIFICACIÓN ---
window.handleLoadAdIdMetrics = handleLoadAdIdMetrics; // Hacer global
window.handleClearAdIdMetricsFilter = handleClearAdIdMetricsFilter; // Hacer global
window.handleUpdateNote = handleUpdateNote;
window.handleDeleteNote = handleDeleteNote;
window.toggleSidebarNoteInput = toggleSidebarNoteInput;
window.handleSaveSidebarNote = handleSaveSidebarNote;
window.handleMigrateOrphans = handleMigrateOrphans;
// --- FIN MODIFICACIÓN ---

// --- EXPORTAR NUEVOS MANEJADORES ---
window.handleSaveDepartment = handleSaveDepartment;
window.handleDeleteDepartment = handleDeleteDepartment;
window.handleSaveAdRoutingRule = handleSaveAdRoutingRule;
window.handleDeleteAdRoutingRule = handleDeleteAdRoutingRule;
// Nota: handleTransferChat se usa en el form submit, así que se debe adjuntar al evento en el HTML o aquí.
// En ui_templates.js usaste <form id="transfer-form"> ... <button onclick="..."> pero el botón es submit.
// Lo mejor es añadir el listener al formulario en runtime, pero como estamos usando onclicks en muchos sitios:
// Vamos a exponerlo para usarlo en el onsubmit del form o onclick del botón.
// En ui_templates.js, el botón tiene onclick="closeTransferModal()" (cancel) y el submit tiene type="submit".
// Vamos a añadir el listener al formulario dinámicamente cuando se abre el modal en ui-manager, 
// O, para seguir el patrón de este archivo, lo exponemos y cambiamos el template para usar onsubmit="handleTransferChat(event)"
window.handleTransferChat = handleTransferChat; 
window.handleStatusChange = handleStatusChange;

// IMPORTANTE: Asegúrate de actualizar ui_templates.js para que el formulario use onsubmit="handleTransferChat(event)"
// O asigna el listener aquí si prefieres. 
// En este proyecto se usa mucho onclick en el HTML generado, así que exponerlo es consistente.
