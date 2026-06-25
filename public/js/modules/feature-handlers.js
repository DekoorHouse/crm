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
 * Envía al cliente el enlace del formulario de entrega local en Monterrey (MTY).
 */
async function handlePedirDatosMty() {
    if (!state.selectedContactId) return;
    const ok = await showConfirmModal("¿Enviar al cliente el enlace del formulario de entrega local en Monterrey (MTY)? No necesita tener un pedido registrado.", { icon: 'pin_drop', confirmText: 'Enviar' });
    if (!ok) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/repartos-mty/pedir-datos/${state.selectedContactId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Error al enviar solicitud');
        showError(result.orderNumber ? `Enlace MTY enviado para pedido ${result.orderNumber}` : 'Enlace MTY enviado al cliente ✓', 'success');
    } catch (error) {
        showError(error.message);
    }
}

/**
 * Envía al cliente el enlace del formulario de entrega local en Durango (DGO).
 * El registro cae directo en la app del repartidor (colección entregas_repartidor).
 */
async function handlePedirDatosDgo() {
    if (!state.selectedContactId) return;
    const ok = await showConfirmModal("¿Enviar al cliente el enlace del formulario de entrega local en Durango (DGO)? No necesita tener un pedido registrado.", { icon: 'two_wheeler', confirmText: 'Enviar' });
    if (!ok) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/repartos-dgo/pedir-datos/${state.selectedContactId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Error al enviar solicitud');
        showError(result.orderNumber ? `Enlace DGO enviado para pedido ${result.orderNumber}` : 'Enlace DGO enviado al cliente ✓', 'success');
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
        cantidad: Math.max(1, parseInt(row.querySelector('.order-item-quantity')?.value, 10) || 1),
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

    // Tracking de campaña (opcional)
    const vieneCampanaCb = document.getElementById('pedidoVieneDeCampana');
    if (vieneCampanaCb && vieneCampanaCb.checked) {
        const campId = document.getElementById('pedidoCampanaId')?.value || '';
        const plantilla = document.getElementById('pedidoPlantillaOrigen')?.value || '';
        if (!campId || !plantilla) {
            errorMessageEl.textContent = 'Si marcaste que viene de campaña, selecciona campaña y plantilla.';
            return;
        }
        orderData.campana_id = campId;
        orderData.plantilla_origen = plantilla;
    }

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
        cantidad: Math.max(1, parseInt(row.querySelector('.edit-order-item-quantity')?.value, 10) || 1),
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

    // Tracking de campaña (opcional). El PUT del backend acepta cualquier campo del body.
    // Si se desmarca el checkbox, los campos se setean a null (limpia tag retroactivamente).
    const vieneCampanaCb = document.getElementById('editPedidoVieneDeCampana');
    if (vieneCampanaCb) {
        if (vieneCampanaCb.checked) {
            const campId = document.getElementById('editPedidoCampanaId')?.value || '';
            const plantilla = document.getElementById('editPedidoPlantillaOrigen')?.value || '';
            if (!campId || !plantilla) {
                errorMessageEl.textContent = 'Si marcaste que viene de campaña, selecciona campaña y plantilla.';
                return;
            }
            updateData.campana_id = campId;
            updateData.plantilla_origen = plantilla;
        } else {
            updateData.campana_id = null;
            updateData.plantilla_origen = null;
        }
    }

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


// =====================================================================
// === CAMPAÑAS UNIFICADAS (enviar) + CONSTRUCTOR DE PLANTILLAS META ===
// =====================================================================

// Cambia entre las sub-pestañas "Enviar campaña" y "Crear plantilla".
function switchCampaignTab(tab) {
    document.querySelectorAll('.campaign-tab').forEach(t => t.classList.toggle('active', t.dataset.ctab === tab));
    let activePane = null;
    document.querySelectorAll('.campaign-pane').forEach(p => {
        const on = p.dataset.cpane === tab;
        p.classList.toggle('active', on);
        if (on) activePane = p;
    });
    if (typeof state !== 'undefined') state.campaignTab = tab;

    // Carga diferida de los paneles pesados (solo la primera vez que se abren).
    // El flag vive en el DOM del panel, que se recrea al volver a entrar al hub.
    if (activePane && !activePane.dataset.loaded) {
        if (tab === 'difusion') {
            activePane.dataset.loaded = '1';
            if (typeof renderDifusionView === 'function') renderDifusionView();
        } else if (tab === 'resultados') {
            activePane.dataset.loaded = '1';
            if (typeof listenForPedidosConCampana === 'function') listenForPedidosConCampana();
            if (typeof renderConversionCampanasView === 'function') renderConversionCampanasView();
            if (typeof renderAutoTemplateResults === 'function') renderAutoTemplateResults();
        }
    }
}

/**
 * Resultados automáticos por plantilla: lee /api/template-metrics/batches?aggregate=template
 * (envíos reales + compras atribuidas por teléfono dentro de la ventana posterior al envío).
 * No requiere crear campañas ni taguear pedidos a mano.
 */
async function renderAutoTemplateResults(force) {
    const container = document.getElementById('auto-template-results');
    if (!container) return;
    const fromInput = document.getElementById('auto-results-from');
    const toInput = document.getElementById('auto-results-to');
    const meta = document.getElementById('auto-results-meta');

    // Defaults: últimos 30 días
    if (fromInput && !fromInput.value) {
        fromInput.value = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
    if (toInput && !toInput.value) {
        toInput.value = new Date().toISOString().slice(0, 10);
    }

    const params = new URLSearchParams();
    params.set('aggregate', 'template');
    if (fromInput?.value) params.set('from', new Date(fromInput.value + 'T00:00:00').getTime());
    if (toInput?.value) params.set('to', new Date(toInput.value + 'T23:59:59.999').getTime());
    if (force) params.set('fresh', '1');

    container.innerHTML = '<div class="auto-results-empty"><i class="fas fa-spinner fa-spin"></i> Cargando resultados…</div>';
    try {
        const res = await fetch(`${API_BASE_URL}/api/template-metrics/batches?${params}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Error al cargar resultados');

        const rows = (data.aggregated || []).slice().sort((a, b) => (b.sent || 0) - (a.sent || 0));
        if (rows.length === 0) {
            container.innerHTML = '<div class="auto-results-empty">Aún no hay envíos de plantillas en este rango. Cuando envíes una plantilla (por ejemplo <strong>foto_lista</strong>) aparecerá aquí automáticamente.</div>';
            if (meta) meta.textContent = '';
            return;
        }

        const fmtMoney = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
        const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) + '%' : '—';
        const sub = txt => `<span style="color:var(--color-text-light);font-size:0.7rem;"> ${txt}</span>`;

        let tSent = 0, tDeliv = 0, tRead = 0, tComp = 0, tIng = 0;
        const bodyRows = rows.map(r => {
            const sent = r.sent || 0;
            tSent += sent; tDeliv += r.delivered || 0; tRead += r.read || 0;
            tComp += r.purchasesCount || 0; tIng += r.purchaseValue || 0;
            return `<tr>
                <td>${escapeHtml(r.templateName || '(sin nombre)')}</td>
                <td class="arz-strong">${sent}</td>
                <td>${r.delivered || 0}${sub(pct(r.delivered, sent))}</td>
                <td>${r.read || 0}${sub(pct(r.read, sent))}</td>
                <td class="arz-strong">${r.purchasesCount || 0}</td>
                <td class="arz-strong">${fmtMoney(r.purchaseValue)}</td>
                <td class="arz-rate">${pct(r.purchasesCount, sent)}</td>
            </tr>`;
        }).join('');

        const totalRow = `<tr style="background:var(--color-subtle-bg);">
            <td class="arz-strong">TOTAL</td>
            <td class="arz-strong">${tSent}</td>
            <td>${tDeliv}${sub(pct(tDeliv, tSent))}</td>
            <td>${tRead}${sub(pct(tRead, tSent))}</td>
            <td class="arz-strong">${tComp}</td>
            <td class="arz-strong">${fmtMoney(tIng)}</td>
            <td class="arz-rate">${pct(tComp, tSent)}</td>
        </tr>`;

        container.innerHTML = `<table class="auto-results-table">
            <thead><tr>
                <th>Plantilla</th><th>Enviados</th><th>Entregados</th><th>Leídos</th>
                <th>Compras</th><th>Ingreso</th><th>Conversión</th>
            </tr></thead>
            <tbody>${bodyRows}${totalRow}</tbody>
        </table>`;
        if (meta) meta.textContent = data.fromCache ? `caché ${Math.round((data.cacheAgeMs || 0) / 1000)}s` : 'actualizado ahora';
    } catch (e) {
        console.error('Error en renderAutoTemplateResults:', e);
        container.innerHTML = `<div class="auto-results-empty" style="color:var(--color-danger);"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(e.message || 'Error al cargar')}</div>`;
    }
}
window.renderAutoTemplateResults = renderAutoTemplateResults;

/** Muestra/oculta el bloque de campañas manuales en la pestaña Resultados. */
function toggleManualCampaigns() {
    const body = document.getElementById('manual-campaigns-body');
    const chev = document.getElementById('manual-campaigns-chev');
    if (!body) return;
    const isOpen = !body.classList.toggle('hidden');
    if (chev) chev.style.transform = isOpen ? 'rotate(90deg)' : '';
}
window.toggleManualCampaigns = toggleManualCampaigns;

// Muestra/oculta el campo de URL de imagen según la plantilla seleccionada.
function onCampaignTemplateChange() {
    const templateSelect = document.getElementById('campaign-template-select');
    const imgSection = document.getElementById('campaign-image-url-section');
    if (!templateSelect || !imgSection) return;
    const tpl = state.templates.find(t => t.name === templateSelect.value);
    const hasImageHeader = tpl && (tpl.components || []).some(c => c.type === 'HEADER' && c.format === 'IMAGE');
    imgSection.classList.toggle('hidden', !hasImageHeader);
}

// Envío unificado: decide entre endpoint de texto o de imagen según la plantilla,
// y soporta destinatarios por etiqueta o por un teléfono específico.
async function handleSendUnifiedCampaign() {
    const tagSelect = document.getElementById('campaign-tag-select');
    const templateSelect = document.getElementById('campaign-template-select');
    const phoneInput = document.getElementById('campaign-phone-input');
    const imageUrlInput = document.getElementById('campaign-image-url-input');
    const button = document.getElementById('send-campaign-btn');

    const templateName = templateSelect.value;
    if (!templateName) { showError('Selecciona una plantilla.'); return; }
    const template = state.templates.find(t => t.name === templateName);
    if (!template) { showError('Plantilla no válida.'); return; }

    const phoneNumber = (phoneInput.value || '').trim();
    const selectedTagKey = tagSelect.value;

    // Destinatarios
    let recipients = [];
    if (!phoneNumber) {
        recipients = (selectedTagKey === 'all') ? state.contacts : state.contacts.filter(c => c.status === selectedTagKey);
        if (recipients.length === 0) {
            showError('No hay contactos en esa etiqueta y no diste un teléfono específico.');
            return;
        }
    }
    const contactIds = phoneNumber ? [] : recipients.map(c => c.id);

    const hasImageHeader = (template.components || []).some(c => c.type === 'HEADER' && c.format === 'IMAGE');
    const imageUrl = imageUrlInput ? (imageUrlInput.value || '').trim() : '';
    if (hasImageHeader && !imageUrl) {
        showError('Esta plantilla lleva imagen en la cabecera: ingresa la URL de la imagen.');
        return;
    }

    const total = phoneNumber ? 1 : recipients.length;
    if (!confirm(`Se enviará la plantilla "${templateName}" a ${total} destinatario(s). ¿Continuar?`)) return;

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...`;

    try {
        let result;
        if (hasImageHeader) {
            const response = await fetch(`${API_BASE_URL}/api/campaigns/send-template-with-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contactIds, templateObject: template, imageUrl, phoneNumber })
            });
            result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Error del servidor.');
        } else {
            const response = await fetch(`${API_BASE_URL}/api/campaigns/send-template`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contactIds, template, phoneNumber })
            });
            result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Error del servidor.');
        }
        alert(`Campaña enviada.\n\nÉxitos: ${result.results.successful}\nFallos: ${result.results.failed}`);
    } catch (error) {
        console.error('Error al enviar la campaña:', error);
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane mr-2"></i> Enviar Campaña`;
    }
}

// --- Constructor de plantillas de Meta ---

// Foto adjunta para el asistente de IA (comprimida en el cliente).
let aiTemplatePhoto = null;

// Lee la foto, la reduce (máx 1024px, JPEG) y la guarda como base64 para enviarla a la IA.
function onAiTemplatePhotoChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const maxDim = 1024;
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                const scale = maxDim / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            aiTemplatePhoto = { base64: dataUrl, mimeType: 'image/jpeg' };

            const prev = document.getElementById('ai-tpl-photo-preview');
            if (prev) { prev.src = dataUrl; prev.classList.remove('hidden'); }
            const label = document.getElementById('ai-tpl-photo-label');
            if (label) label.textContent = file.name;
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

// Llama a la IA con la descripción (+ foto) y precarga todos los campos del formulario.
async function handleGenerateTemplateWithAI() {
    const desc = (document.getElementById('ai-tpl-desc').value || '').trim();
    if (!desc) { showError('Describe para qué es la plantilla.'); return; }

    const btn = document.getElementById('ai-tpl-generate-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Generando...';

    try {
        const payload = { description: desc, category: document.getElementById('tpl-category').value };
        if (aiTemplatePhoto) { payload.imageBase64 = aiTemplatePhoto.base64; payload.imageMimeType = aiTemplatePhoto.mimeType; }

        const response = await fetch(`${API_BASE_URL}/api/whatsapp-templates/ai-generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'No se pudo generar con IA.');

        applyAiTemplateSuggestion(result.suggestion);
        showError('La IA llenó los campos. Revísalos y ajústalos antes de crear.', 'success');
    } catch (error) {
        console.error('Error al generar plantilla con IA:', error);
        showError(error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-1"></i> Generar';
    }
}

// Precarga el formulario con la sugerencia devuelta por la IA.
function applyAiTemplateSuggestion(s) {
    if (!s) return;

    if (s.name) document.getElementById('tpl-name').value = String(s.name).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (s.category && ['MARKETING', 'UTILITY'].includes(s.category)) document.getElementById('tpl-category').value = s.category;

    // Cabecera
    const headerSel = document.getElementById('tpl-header-type');
    const htype = (s.header && s.header.type) || 'NONE';
    headerSel.value = ['NONE', 'TEXT', 'IMAGE'].includes(htype) ? htype : 'NONE';
    onTemplateHeaderTypeChange();
    if (htype === 'TEXT' && s.header && s.header.text) document.getElementById('tpl-header-text').value = s.header.text;

    // Cuerpo + ejemplos de variables
    if (s.body) document.getElementById('tpl-body').value = s.body;
    onTemplateBodyChange(); // genera los inputs de variables según {{n}}
    if (Array.isArray(s.bodyExamples)) {
        const inputs = document.querySelectorAll('#tpl-body-vars input[data-var]');
        inputs.forEach((inp, i) => { if (s.bodyExamples[i] != null) inp.value = s.bodyExamples[i]; });
    }

    // Pie
    if (s.footer != null) document.getElementById('tpl-footer').value = s.footer;

    // Botones
    const list = document.getElementById('tpl-buttons-list');
    list.innerHTML = '';
    if (Array.isArray(s.buttons)) {
        s.buttons.slice(0, 3).forEach(b => {
            if (!b || !b.text) return;
            addTemplateButton();
            const row = list.lastElementChild;
            const typeSel = row.querySelector('.tpl-btn-type');
            const t = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(b.type) ? b.type : 'QUICK_REPLY';
            typeSel.value = t;
            onTemplateButtonTypeChange(typeSel);
            row.querySelector('.tpl-btn-text').value = b.text || '';
            if (t === 'URL') row.querySelector('.tpl-btn-extra').value = b.url || '';
            else if (t === 'PHONE_NUMBER') row.querySelector('.tpl-btn-extra').value = b.phone_number || '';
        });
    }

    updateTemplatePreview();
}

// Muestra el campo correcto según el tipo de cabecera elegido.
function onTemplateHeaderTypeChange() {
    const type = (document.getElementById('tpl-header-type') || {}).value || 'NONE';
    const textInput = document.getElementById('tpl-header-text');
    const imageInput = document.getElementById('tpl-header-image');
    if (textInput) textInput.classList.toggle('hidden', type !== 'TEXT');
    if (imageInput) imageInput.classList.toggle('hidden', type !== 'IMAGE');
    updateTemplatePreview();
}

// Escapa HTML para la vista previa.
function escapeTemplatePreview(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Aplica formato estilo WhatsApp (*negrita* _cursiva_ ~tachado~) + saltos de línea.
function waFormatPreview(text) {
    let t = escapeTemplatePreview(text);
    t = t.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
    t = t.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    t = t.replace(/~([^~\n]+)~/g, '<del>$1</del>');
    t = t.replace(/\n/g, '<br>');
    return t;
}

// Refresca la vista previa estilo WhatsApp con el contenido actual del formulario.
function updateTemplatePreview() {
    const bubble = document.getElementById('tpl-preview-bubble');
    if (!bubble) return;

    const headerEl = document.getElementById('tpl-preview-header');
    const bodyEl = document.getElementById('tpl-preview-body');
    const footerEl = document.getElementById('tpl-preview-footer');
    const buttonsEl = document.getElementById('tpl-preview-buttons');

    // --- Cabecera ---
    const headerType = (document.getElementById('tpl-header-type') || {}).value || 'NONE';
    if (headerType === 'TEXT') {
        const txt = (document.getElementById('tpl-header-text') || {}).value || '';
        headerEl.innerHTML = txt ? `<div class="wa-preview-htext">${waFormatPreview(txt)}</div>` : '';
    } else if (headerType === 'IMAGE') {
        const url = (document.getElementById('tpl-header-image') || {}).value || '';
        headerEl.innerHTML = url
            ? `<div class="wa-preview-himg"><img src="${escapeTemplatePreview(url)}" onerror="this.style.display='none'"></div>`
            : `<div class="wa-preview-himg wa-preview-himg-empty"><i class="fas fa-image"></i></div>`;
    } else {
        headerEl.innerHTML = '';
    }

    // --- Cuerpo (sustituye {{n}} por el ejemplo si existe) ---
    const body = (document.getElementById('tpl-body') || {}).value || '';
    const examples = {};
    document.querySelectorAll('#tpl-body-vars input[data-var]').forEach(inp => { examples[inp.dataset.var] = inp.value; });
    const bodyFilled = body.replace(/\{\{(\d+)\}\}/g, (m, n) => (examples[n] && examples[n].trim()) ? examples[n] : `{{${n}}}`);
    bodyEl.innerHTML = body
        ? waFormatPreview(bodyFilled)
        : '<span class="wa-preview-placeholder">El cuerpo del mensaje aparecerá aquí…</span>';

    // --- Pie ---
    const footer = (document.getElementById('tpl-footer') || {}).value || '';
    footerEl.innerHTML = footer ? `<div class="wa-preview-footer-text">${escapeTemplatePreview(footer)}</div>` : '';

    // --- Botones ---
    let btnHtml = '';
    document.querySelectorAll('#tpl-buttons-list .tpl-button-row').forEach(row => {
        const type = row.querySelector('.tpl-btn-type').value;
        const text = (row.querySelector('.tpl-btn-text').value || '').trim();
        if (!text) return;
        let icon = 'fa-reply';
        if (type === 'URL') icon = 'fa-external-link-alt';
        else if (type === 'PHONE_NUMBER') icon = 'fa-phone';
        btnHtml += `<div class="wa-preview-btn"><i class="fas ${icon}"></i>${escapeTemplatePreview(text)}</div>`;
    });
    buttonsEl.innerHTML = btnHtml;
}

// Detecta variables {{n}} en el cuerpo y genera un input de ejemplo por cada una.
function onTemplateBodyChange() {
    const body = (document.getElementById('tpl-body') || {}).value || '';
    const container = document.getElementById('tpl-body-vars');
    if (!container) return;

    const nums = (body.match(/\{\{(\d+)\}\}/g) || []).map(m => parseInt(m.replace(/[^\d]/g, ''), 10));
    const maxVar = nums.length ? Math.max(...nums) : 0;

    if (maxVar === 0) { container.innerHTML = ''; return; }

    // Preserva valores ya escritos
    const prev = {};
    container.querySelectorAll('input[data-var]').forEach(inp => { prev[inp.dataset.var] = inp.value; });

    let html = '<p class="text-xs font-semibold text-gray-500">Ejemplos de variables (Meta los exige):</p>';
    for (let i = 1; i <= maxVar; i++) {
        html += `<input type="text" data-var="${i}" placeholder="Ejemplo para {{${i}}}" value="${(prev[i] || '').replace(/"/g, '&quot;')}" oninput="updateTemplatePreview()" class="!mb-0">`;
    }
    container.innerHTML = html;
    updateTemplatePreview();
}

// Agrega una fila de botón (máx. 3).
function addTemplateButton() {
    const list = document.getElementById('tpl-buttons-list');
    if (!list) return;
    if (list.querySelectorAll('.tpl-button-row').length >= 3) { showError('Máximo 3 botones.'); return; }

    const row = document.createElement('div');
    row.className = 'tpl-button-row flex items-center gap-2 p-2 border rounded bg-gray-50';
    row.innerHTML = `
        <select class="tpl-btn-type !mb-0" style="max-width:130px" onchange="onTemplateButtonTypeChange(this)">
            <option value="QUICK_REPLY">Respuesta rápida</option>
            <option value="URL">Enlace (URL)</option>
            <option value="PHONE_NUMBER">Llamar</option>
        </select>
        <input type="text" class="tpl-btn-text !mb-0" placeholder="Texto del botón" maxlength="25" oninput="updateTemplatePreview()">
        <input type="text" class="tpl-btn-extra !mb-0 hidden" placeholder="https://..." oninput="updateTemplatePreview()">
        <button type="button" onclick="this.closest('.tpl-button-row').remove(); updateTemplatePreview();" class="text-red-500 hover:text-red-700 px-2" title="Quitar"><i class="fas fa-times"></i></button>
    `;
    list.appendChild(row);
    updateTemplatePreview();
}

// Muestra el campo extra (URL/teléfono) según el tipo de botón.
function onTemplateButtonTypeChange(select) {
    const row = select.closest('.tpl-button-row');
    const extra = row.querySelector('.tpl-btn-extra');
    if (select.value === 'URL') { extra.classList.remove('hidden'); extra.placeholder = 'https://...'; }
    else if (select.value === 'PHONE_NUMBER') { extra.classList.remove('hidden'); extra.placeholder = '+5218112345678'; }
    else { extra.classList.add('hidden'); extra.value = ''; }
    updateTemplatePreview();
}

// Recopila el formulario y crea la plantilla en Meta vía el backend.
async function handleCreateWhatsappTemplate() {
    const name = (document.getElementById('tpl-name').value || '').trim();
    const language = document.getElementById('tpl-language').value;
    const category = document.getElementById('tpl-category').value;
    const headerType = document.getElementById('tpl-header-type').value;
    const body = (document.getElementById('tpl-body').value || '').trim();
    const footer = (document.getElementById('tpl-footer').value || '').trim();
    const button = document.getElementById('create-template-btn');

    if (!name || !/^[a-z0-9_]+$/.test(name)) { showError('El nombre solo admite minúsculas, números y guion bajo.'); return; }
    if (!body) { showError('El cuerpo del mensaje es obligatorio.'); return; }

    // Cabecera
    let header = null;
    if (headerType === 'TEXT') {
        const text = (document.getElementById('tpl-header-text').value || '').trim();
        if (text) header = { type: 'TEXT', text };
    } else if (headerType === 'IMAGE') {
        const imageUrl = (document.getElementById('tpl-header-image').value || '').trim();
        if (!imageUrl) { showError('Ingresa la URL de una imagen de muestra para la cabecera.'); return; }
        header = { type: 'IMAGE', imageUrl };
    }

    // Ejemplos de variables del cuerpo (en orden)
    const bodyExamples = Array.from(document.querySelectorAll('#tpl-body-vars input[data-var]'))
        .sort((a, b) => parseInt(a.dataset.var, 10) - parseInt(b.dataset.var, 10))
        .map(inp => inp.value.trim());

    // Botones
    const buttons = Array.from(document.querySelectorAll('#tpl-buttons-list .tpl-button-row')).map(row => {
        const type = row.querySelector('.tpl-btn-type').value;
        const text = (row.querySelector('.tpl-btn-text').value || '').trim();
        const extra = (row.querySelector('.tpl-btn-extra').value || '').trim();
        if (!text) return null;
        if (type === 'URL') return { type, text, url: extra };
        if (type === 'PHONE_NUMBER') return { type, text, phone_number: extra };
        return { type: 'QUICK_REPLY', text };
    }).filter(Boolean);

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Creando...`;

    try {
        const response = await fetch(`${API_BASE_URL}/api/whatsapp-templates/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, language, category, header, body, footer, buttons, bodyExamples })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'No se pudo crear la plantilla.');

        const status = result.data && result.data.status ? ` (${result.data.status})` : '';
        alert(`Plantilla "${name}" creada y enviada a revisión de Meta${status}.\n\nAparecerá en la lista de plantillas cuando Meta la APRUEBE.`);

        // Refrescar la lista de plantillas para cuando se apruebe
        if (typeof fetchTemplates === 'function') fetchTemplates();
    } catch (error) {
        console.error('Error al crear la plantilla:', error);
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane mr-2"></i> Crear y enviar a revisión`;
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

// --- Reactivación de Leads (Ajustes Generales) ---
// Config en crm_settings/lead_reactivation vía /api/leads/reactivacion.
// El scheduler del backend envía los mensajes; aquí solo se administra.

let leadReactConfig = null;
let leadReactPendingCount = null;

function updateLeadReactSubtitle() {
    const el = document.getElementById('lead-react-subtitle');
    if (!el) return;
    const base = 'Mensajes automáticos para clientes que escriben y no registran pedido.';
    el.textContent = (leadReactConfig && leadReactConfig.enabled && typeof leadReactPendingCount === 'number')
        ? `${base} · ${leadReactPendingCount} en seguimiento ahora`
        : base;
}

// Crea el elemento DOM de una fila (delay + unidad + texto) de la secuencia
function leadReactRowElement(followup, index) {
    const wrap = document.createElement('div');
    wrap.className = 'lead-react-row border border-gray-200 rounded-lg p-3';

    const head = document.createElement('div');
    head.className = 'flex items-center gap-2 flex-wrap mb-2 text-sm text-gray-500';
    head.innerHTML = `
        <span class="lr-num text-xs font-bold text-gray-600">MENSAJE ${index + 1}</span>
        <span>· enviar a los</span>
        <input type="number" min="1" class="lr-delay !mb-0 text-center" style="width: 80px;">
        <select class="lr-unit !mb-0" style="width: auto;">
            <option value="min">minutos</option>
            <option value="h">horas</option>
        </select>
        <span>del último mensaje del cliente</span>
        <button type="button" class="lr-remove ml-auto text-red-500" title="Quitar mensaje"><i class="fas fa-trash"></i></button>
    `;
    // Mostrar en horas cuando el delay es un número exacto de horas
    const isHours = followup.delayMinutes >= 60 && followup.delayMinutes % 60 === 0;
    head.querySelector('.lr-delay').value = isHours ? followup.delayMinutes / 60 : followup.delayMinutes;
    head.querySelector('.lr-unit').value = isHours ? 'h' : 'min';
    head.querySelector('.lr-remove').addEventListener('click', () => removeLeadReactRow(wrap));

    const textarea = document.createElement('textarea');
    textarea.className = 'lr-text w-full p-2 border border-gray-300 rounded-lg text-sm';
    textarea.rows = 2;
    textarea.placeholder = 'Texto del mensaje...';
    textarea.value = followup.text || ''; // .value evita inyección de HTML
    wrap.appendChild(head);
    wrap.appendChild(textarea);
    return wrap;
}

function renderLeadReactRows(followups) {
    const rowsEl = document.getElementById('lead-react-rows');
    if (!rowsEl) return;
    rowsEl.innerHTML = '';
    followups.forEach((f, i) => rowsEl.appendChild(leadReactRowElement(f, i)));
}

function addLeadReactRow() {
    const rowsEl = document.getElementById('lead-react-rows');
    if (!rowsEl) return;
    rowsEl.appendChild(leadReactRowElement({ delayMinutes: 60, text: '' }, rowsEl.querySelectorAll('.lead-react-row').length));
}

function removeLeadReactRow(rowEl) {
    const rowsEl = document.getElementById('lead-react-rows');
    if (!rowsEl) return;
    if (rowsEl.querySelectorAll('.lead-react-row').length <= 1) {
        showError('Debe haber al menos un mensaje en la secuencia.');
        return;
    }
    rowEl.remove();
    // Renumerar los mensajes restantes
    rowsEl.querySelectorAll('.lead-react-row .lr-num').forEach((el, i) => { el.textContent = `MENSAJE ${i + 1}`; });
}

// Lee las filas tal como están en el DOM (la fuente de verdad al guardar)
function readLeadReactRows() {
    return Array.from(document.querySelectorAll('#lead-react-rows .lead-react-row')).map(row => ({
        delay: Number(row.querySelector('.lr-delay').value),
        unit: row.querySelector('.lr-unit').value,
        text: row.querySelector('.lr-text').value.trim()
    }));
}

// Carga config + conteo de pendientes al abrir Ajustes
async function loadLeadReactSettings() {
    const rowsEl = document.getElementById('lead-react-rows');
    if (!rowsEl) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/leads/reactivacion/config`);
        if (!response.ok) throw new Error('No se pudo cargar la configuración.');
        leadReactConfig = await response.json();

        const toggle = document.getElementById('lead-react-toggle');
        if (toggle) toggle.checked = !!leadReactConfig.enabled;
        const minDays = document.getElementById('lead-react-mindays');
        if (minDays) minDays.value = leadReactConfig.minDaysSinceLastOrder;
        const cooldown = document.getElementById('lead-react-cooldown');
        if (cooldown) cooldown.value = leadReactConfig.cooldownHours;

        renderLeadReactRows(leadReactConfig.followups);
        updateLeadReactSubtitle();
    } catch (error) {
        rowsEl.innerHTML = '<div class="text-sm text-red-500">No se pudo cargar la configuración de reactivación.</div>';
        return;
    }

    // Conteo de leads en seguimiento (no bloquea la carga si falla)
    try {
        const res = await fetch(`${API_BASE_URL}/api/leads/reactivacion/seguimientos?status=pending&limit=500`);
        if (res.ok) {
            const data = await res.json();
            leadReactPendingCount = data.count || 0;
            updateLeadReactSubtitle();
        }
    } catch (e) { /* silencioso */ }
}

// Botón de encendido/apagado: guarda al instante
async function handleLeadReactToggle(isActive) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/leads/reactivacion/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: isActive })
        });
        if (!response.ok) throw new Error('No se pudo guardar el ajuste.');
        leadReactConfig = await response.json();
        updateLeadReactSubtitle();
        showError(isActive ? 'Reactivación de leads encendida.' : 'Reactivación de leads apagada.', 'success');
    } catch (error) {
        showError(error.message);
        // Revierte el interruptor en la UI si falla la API
        const toggle = document.getElementById('lead-react-toggle');
        if (toggle) toggle.checked = !isActive;
    }
}

async function handleSaveLeadReact() {
    const followups = [];
    for (const row of readLeadReactRows()) {
        if (!Number.isFinite(row.delay) || row.delay < 1 || !row.text) {
            showError('Cada mensaje necesita un tiempo válido y un texto.');
            return;
        }
        const delayMinutes = row.unit === 'h' ? Math.round(row.delay * 60) : Math.round(row.delay);
        if (delayMinutes > 23 * 60) {
            showError('Los mensajes deben enviarse dentro de las primeras 23 horas (ventana de WhatsApp).');
            return;
        }
        followups.push({ delayMinutes, text: row.text });
    }
    if (followups.length === 0) {
        showError('Agrega al menos un mensaje.');
        return;
    }

    const btn = document.getElementById('lead-react-save-btn');
    if (btn) btn.disabled = true;
    try {
        const response = await fetch(`${API_BASE_URL}/api/leads/reactivacion/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                followups,
                minDaysSinceLastOrder: Math.max(0, Number(document.getElementById('lead-react-mindays')?.value) || 0),
                cooldownHours: Math.max(0, Number(document.getElementById('lead-react-cooldown')?.value) || 0)
            })
        });
        if (!response.ok) throw new Error('No se pudo guardar la configuración.');
        leadReactConfig = await response.json();
        renderLeadReactRows(leadReactConfig.followups);
        updateLeadReactSubtitle();
        showError('Mensajes de reactivación guardados.', 'success');
    } catch (error) {
        showError(error.message);
    } finally {
        if (btn) btn.disabled = false;
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

// --- USUARIOS / OPERADORES ---
async function handleSaveUser(event) {
    event.preventDefault();
    const email = document.getElementById('user-id').value;
    const name = document.getElementById('user-name').value.trim();
    const role = document.getElementById('user-role').value;
    const photoURL = document.getElementById('user-photo-url').value || '';

    if (!email) {
        showError('No se identificó al usuario a editar.');
        return;
    }

    // Departamentos seleccionados (solo aplican a agentes)
    const assignedDepartments = Array.from(
        document.querySelectorAll('#user-departments-container input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    const data = {
        name,
        role,
        photoURL,
        // Un admin ve todo, así que no necesita departamentos asignados.
        assignedDepartments: role === 'admin' ? [] : assignedDepartments
    };

    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Guardando...'; }

    try {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(email)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error al guardar el usuario.');
        }

        closeUserModal();
        showError('Usuario actualizado correctamente.', 'success');
        // El listener de Firestore (listenForUsers) refrescará state.allUsers y
        // re-renderizará la lista automáticamente; forzamos un fetch por si acaso.
        if (typeof fetchAllUsers === 'function') fetchAllUsers();
    } catch (error) {
        showError(error.message);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Guardar'; }
    }
}
window.handleSaveUser = handleSaveUser;

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
                <div style="font-size:0.78rem;color:#666;margin-top:3px;">Te llegará alerta cuando se acredite (hasta 48h).</div>
            </div>
            <div id="oxxoTicketImageWrap" style="text-align:center;margin-bottom:14px;display:none;">
                <img id="oxxoTicketImage" src="" alt="Ticket OXXO" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb;">
            </div>
            <div id="oxxoResultBox" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px;"></div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <button id="oxxoSendImageBtn" style="background:#128c7e;color:#fff;padding:14px;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;font-size:1rem;">
                    <i class="fab fa-whatsapp"></i> Enviar imagen al cliente
                </button>
                <a id="oxxoTicketDownload" href="#" download="ticket-oxxo.png" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#f3f4f6;color:#374151;padding:10px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.85rem;">
                    <i class="fas fa-download"></i> Descargar imagen
                </a>
                <a id="oxxoVoucherLink" href="#" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:transparent;color:#e2231a;padding:8px;text-decoration:none;font-weight:600;font-size:0.85rem;">
                    <i class="fas fa-external-link-alt"></i> Ver ficha oficial OXXO
                </a>
            </div>
            <div style="margin-top:12px;text-align:center;">
                <button id="oxxoCloseBtn" style="background:#f3f4f6;color:#374151;padding:10px 20px;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-family:inherit;">Cerrar</button>
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

        // Mostrar imagen del ticket si esta disponible
        const imgWrap = card.querySelector('#oxxoTicketImageWrap');
        const imgEl = card.querySelector('#oxxoTicketImage');
        const dlLink = card.querySelector('#oxxoTicketDownload');
        if (data.ticketImageUrl) {
            imgEl.src = data.ticketImageUrl;
            dlLink.href = data.ticketImageUrl;
            imgWrap.style.display = '';
        } else {
            imgWrap.style.display = 'none';
            dlLink.style.display = 'none';
        }

        card.querySelector('#oxxoResultBox').innerHTML = `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee;font-size:0.85rem;">
                <span style="color:#888;">Monto</span>
                <strong style="color:#e2231a;">$${Number(monto).toLocaleString('es-MX')} MXN</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee;font-size:0.85rem;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="color:#888;">Referencia</span>
                <span style="font-family:'Courier New',monospace;font-weight:700;word-break:break-all;text-align:right;font-size:0.78rem;">${data.barcodeContent || '-'}</span>
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

        // BOTON PRINCIPAL: enviar imagen al cliente directo via WhatsApp API
        const btnSendImage = card.querySelector('#oxxoSendImageBtn');
        btnSendImage.addEventListener('click', async () => {
            if (!data.ticketImageUrl) {
                showError('No hay imagen del ticket. Vuelve a generar.');
                return;
            }
            const original = btnSendImage.innerHTML;
            btnSendImage.disabled = true;
            btnSendImage.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
            try {
                const res = await fetch(`${API_BASE_URL}/api/mercadopago/oxxo/send-to-customer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        externalReference: data.externalReference,
                        customerPhone: contactId
                    })
                });
                const j = await res.json();
                if (!res.ok || !j.success) throw new Error(j.error || 'Error al enviar');
                btnSendImage.innerHTML = '<i class="fas fa-check"></i> ¡Imagen enviada!';
                btnSendImage.style.background = '#10b981';
                showError('Imagen enviada al cliente por WhatsApp.', 'success');
                setTimeout(close, 1500);
            } catch (err) {
                btnSendImage.disabled = false;
                btnSendImage.innerHTML = original;
                showError('Error: ' + err.message);
            }
        });

        card.querySelector('#oxxoCloseBtn').addEventListener('click', close);
    }
}


// --- Make functions globally accessible ---
// Funciones que se llaman directamente desde el HTML (onclick)
window.handleUpdateContact = handleUpdateContact;
window.handleDeleteContact = handleDeleteContact;
window.handleMarkAsPurchase = handleMarkAsPurchase;
window.handleMarkAsRegistration = handleMarkAsRegistration; // Mantener si aún se usa
window.handleSendViewContent = handleSendViewContent;
window.handlePedirDatosEnvio = handlePedirDatosEnvio;
window.handlePedirDatosDgo = handlePedirDatosDgo;
window.handleCancelarGuiaEnvio = handleCancelarGuiaEnvio;
window.handleGenerarOxxo = handleGenerarOxxo;
window.handleSaveOrder = handleSaveOrder;
window.handleUpdateExistingOrder = handleUpdateExistingOrder;
window.handleSendCampaign = handleSendCampaign;
window.handleSendCampaignWithImage = handleSendCampaignWithImage;
window.switchCampaignTab = switchCampaignTab;
window.onCampaignTemplateChange = onCampaignTemplateChange;
window.handleSendUnifiedCampaign = handleSendUnifiedCampaign;
window.onTemplateHeaderTypeChange = onTemplateHeaderTypeChange;
window.onTemplateBodyChange = onTemplateBodyChange;
window.addTemplateButton = addTemplateButton;
window.onTemplateButtonTypeChange = onTemplateButtonTypeChange;
window.updateTemplatePreview = updateTemplatePreview;
window.onAiTemplatePhotoChange = onAiTemplatePhotoChange;
window.handleGenerateTemplateWithAI = handleGenerateTemplateWithAI;
window.handleCreateWhatsappTemplate = handleCreateWhatsappTemplate;
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

// =====================================================================
// === HANDLERS TRACKING DE CAMPAÑAS                                  ===
// =====================================================================

async function handleSaveCampana(event) {
    event.preventDefault();
    const form = document.getElementById('campana-form');
    const errorEl = document.getElementById('campana-form-error');
    const saveBtn = document.getElementById('campana-save-btn');
    if (!form || !errorEl) return;
    errorEl.textContent = '';

    const campanaId = form.dataset.campanaId || '';
    const nombre = document.getElementById('campana-nombre').value.trim();
    const fechaIni = document.getElementById('campana-fecha-inicio').value;
    const fechaFin = document.getElementById('campana-fecha-fin').value;
    const estatus = document.getElementById('campana-estatus').value;
    const notas = document.getElementById('campana-notas').value.trim();

    if (!nombre) { errorEl.textContent = 'El nombre es obligatorio'; return; }
    if (!fechaIni) { errorEl.textContent = 'Selecciona la fecha de inicio'; return; }
    const [yi, mi, di] = fechaIni.split('-').map(Number);
    const ini = new Date(yi, mi - 1, di, 0, 0, 0, 0);
    let fin = null;
    if (fechaFin) {
        const [yf, mf, df] = fechaFin.split('-').map(Number);
        fin = new Date(yf, mf - 1, df, 23, 59, 59, 999);
        if (fin < ini) { errorEl.textContent = 'La fecha fin debe ser posterior a la fecha inicio'; return; }
    }

    // Recolectar plantillas
    const plantillas = {};
    const rows = document.querySelectorAll('#campana-plantillas-container .campana-plantilla-row');
    for (const row of rows) {
        const key = row.querySelector('.campana-plantilla-nombre').value.trim();
        if (!key) continue;
        if (plantillas[key]) { errorEl.textContent = `Plantilla repetida: "${key}". Usa nombres únicos.`; return; }
        plantillas[key] = {
            contactados: Math.max(0, parseInt(row.querySelector('.campana-plantilla-contactados').value, 10) || 0),
            notas: row.querySelector('.campana-plantilla-notas').value.trim()
        };
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';
    }

    try {
        const Timestamp = firebase.firestore.Timestamp;
        const payload = {
            nombre,
            fecha_inicio: Timestamp.fromDate(ini),
            fecha_fin: fin ? Timestamp.fromDate(fin) : null, // null = en curso sin fecha de cierre
            estatus,
            plantillas,
            notas,
            actualizada_en: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (campanaId) {
            await db.collection('campanas').doc(campanaId).update(payload);
            showError('Campaña actualizada', 'success');
        } else {
            payload.creada_por = auth.currentUser?.email || auth.currentUser?.uid || 'unknown';
            payload.creada_en = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('campanas').add(payload);
            showError('Campaña creada', 'success');
        }
        closeCampanaFormModal();
    } catch (err) {
        console.error('Error guardando campaña:', err);
        errorEl.textContent = err.message || 'Error al guardar';
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fas fa-save mr-2"></i> ${campanaId ? 'Guardar cambios' : 'Crear campaña'}`;
        }
    }
}

async function handleDeleteCampana(campanaId) {
    const camp = state.campanasList.find(c => c.id === campanaId);
    if (!camp) return;
    if (!confirm(`¿Eliminar la campaña "${camp.nombre}"? Los pedidos tagueados con ella conservan el tag pero ya no se podrán reportar.`)) return;
    try {
        await db.collection('campanas').doc(campanaId).delete();
        showError('Campaña eliminada', 'success');
    } catch (err) {
        console.error('Error eliminando campaña:', err);
        showError('Error al eliminar campaña', 'error');
    }
}

async function handleToggleCampanaEstatus(campanaId) {
    const camp = state.campanasList.find(c => c.id === campanaId);
    if (!camp) return;
    const isActiva = camp.estatus === 'activa';
    if (isActiva && !confirm(`¿Cerrar la campaña "${camp.nombre}"? Ya no aparecerá en el selector de pedidos nuevos.`)) return;
    try {
        await db.collection('campanas').doc(campanaId).update({
            estatus: isActiva ? 'cerrada' : 'activa',
            actualizada_en: firebase.firestore.FieldValue.serverTimestamp()
        });
        showError(isActiva ? 'Campaña cerrada' : 'Campaña reabierta', 'success');
    } catch (err) {
        console.error('Error cambiando estatus de campaña:', err);
        showError('Error al cambiar estatus', 'error');
    }
}

function handleExportCampanaCSV(campanaId) {
    const camp = state.campanasList.find(c => c.id === campanaId);
    if (!camp) return;
    const kpis = getKPIsForCampana(camp);
    const escapeCsv = s => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [];
    rows.push(['Plantilla', 'Contactados', 'Pedidos', 'Pagados', 'Conversion', 'Monto MXN', 'Ticket promedio'].join(','));
    for (const k of kpis.plantillas) {
        const conv = k.contactados > 0 ? ((k.pagados / k.contactados) * 100).toFixed(2) + '%' : '';
        const ticket = k.pagados > 0 ? (k.monto / k.pagados).toFixed(2) : '';
        rows.push([escapeCsv(k.plantilla), k.contactados, k.pedidos, k.pagados, conv, k.monto.toFixed(2), ticket].join(','));
    }
    rows.push('');
    rows.push([
        'TOTAL', kpis.totalContactados, kpis.totalPedidos, kpis.totalPagados,
        kpis.totalContactados > 0 ? ((kpis.totalPagados / kpis.totalContactados) * 100).toFixed(2) + '%' : '',
        kpis.totalMonto.toFixed(2), ''
    ].join(','));

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${camp.nombre.replace(/[^a-z0-9]+/gi, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

window.handleSaveCampana = handleSaveCampana;
window.handleDeleteCampana = handleDeleteCampana;
window.handleToggleCampanaEstatus = handleToggleCampanaEstatus;
window.handleExportCampanaCSV = handleExportCampanaCSV;

/**
 * Detecta automáticamente cuántos contactos recibieron la plantilla de esta fila
 * en el rango de fechas del modal (fecha_inicio → fecha_fin si existe).
 * Llamada por el botón "🔍 Detectar" en cada row del modal de campaña.
 */
async function detectContactadosForRow(button) {
    const row = button.closest('.campana-plantilla-row');
    if (!row) return;

    const nombreInput = row.querySelector('.campana-plantilla-nombre');
    const contactadosInput = row.querySelector('.campana-plantilla-contactados');
    const fechaIniInput = document.getElementById('campana-fecha-inicio');
    const fechaFinInput = document.getElementById('campana-fecha-fin');

    const template = (nombreInput?.value || '').trim();
    const fechaIni = fechaIniInput?.value || '';
    const fechaFin = fechaFinInput?.value || '';

    if (!template) {
        showError('Primero escribe el nombre de la plantilla');
        nombreInput?.focus();
        return;
    }
    if (!fechaIni) {
        showError('Primero selecciona la fecha de inicio de la campaña');
        fechaIniInput?.focus();
        return;
    }

    // UI loading state
    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';

    try {
        // ISO al inicio del día y final del día respectivamente
        const [yi, mi, di] = fechaIni.split('-').map(Number);
        const iniIso = new Date(yi, mi - 1, di, 0, 0, 0, 0).toISOString();
        let finIso = null;
        if (fechaFin) {
            const [yf, mf, df] = fechaFin.split('-').map(Number);
            finIso = new Date(yf, mf - 1, df, 23, 59, 59, 999).toISOString();
        }

        const response = await fetch(`${API_BASE_URL}/api/campanas/contar-envios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template, fechaInicio: iniIso, fechaFin: finIso }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.message || 'Error detectando contactados');
        }

        contactadosInput.value = result.count;

        if (result.count === 0) {
            // Diagnostico cuando no hay matches
            console.warn('[Detectar] Resultado 0. Diagnostico:', result);
            const samples = result.sampleTemplateNames || [];

            let msg = `0 envíos detectados para "${template}" en ${result.rango?.desde || fechaIni} → ${result.rango?.hasta || 'ahora'}.`;
            if (samples.length === 0) {
                msg += ` No hay registros de envío de plantillas en el rango. Revisa la fecha de inicio o verifica que se hayan enviado desde el CRM/retargeting.`;
            } else {
                const topList = samples.map(s => `${s.name} (${s.count})`).join(', ');
                msg += ` En el rango sí hubo envíos de OTRAS plantillas: ${topList}. Verifica el nombre exacto.`;
            }
            contactadosInput.style.background = '#fef3c7'; // amarillo de aviso
            setTimeout(() => { contactadosInput.style.background = ''; }, 3000);
            showError(msg, 'warning');
        } else {
            const srcInfo = result.bySource ? ` (${result.bySource.retargeting_plantilla} retargeting + ${result.bySource.chat} chat)` : '';
            contactadosInput.style.background = '#dcfce7'; // verde de confirmación
            setTimeout(() => { contactadosInput.style.background = ''; }, 1500);
            showError(`Detectados ${result.count} contactos únicos que recibieron "${template}"${srcInfo}`, 'success');
        }

        // Si hay más de un batch detectado, mostrar selector — la plantilla puede
        // usarse en retargeting automático recurrente y el usuario debe elegir solo
        // el batch correspondiente a su campaña piloto.
        renderBatchPicker(row, template, result.batches || []);
    } catch (err) {
        console.error('Error detectando contactados:', err);
        showError(err.message || 'No se pudo detectar', 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalHtml;
    }
}

window.detectContactadosForRow = detectContactadosForRow;

/**
 * Renderiza el panel "Por batch" debajo del campo Contactados.
 * Muestra cada batch detectado en el rango con su fecha y conteo de contactos únicos.
 * Click en un batch → ese conteo se usa como Contactados (la plantilla puede tener
 * múltiples batches en el rango porque retargeting la usa de forma recurrente).
 */
function renderBatchPicker(row, template, batches) {
    if (!row) return;
    // Quita el panel anterior si existía
    const prev = row.parentElement.querySelector(`.batch-picker[data-row-id="${row.dataset.rowIdx || ''}"]`);
    if (prev) prev.remove();

    // Si solo hay 0 ó 1 batch, no tiene caso mostrar el panel
    if (!Array.isArray(batches) || batches.length < 2) return;

    const contactadosInput = row.querySelector('.campana-plantilla-contactados');

    const panel = document.createElement('div');
    panel.className = 'batch-picker';
    panel.dataset.rowId = row.dataset.rowIdx || '';
    panel.style.cssText = 'margin:6px 0 10px 8px;padding:10px 12px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:6px;font-size:12px;';

    const fmt = iso => {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const header = `<div style="font-weight:600;color:#92400e;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
        <i class="fas fa-info-circle"></i> Se detectaron ${batches.length} tandas (batches) de "${escapeHtml(template)}" en este rango.
        Haz click en la que corresponde a tu campaña:
    </div>`;

    const list = batches.map(b => `
        <button type="button" class="batch-pick-item" data-count="${b.count}" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:8px 10px;background:white;border:1px solid #fde68a;border-radius:6px;margin-bottom:4px;cursor:pointer;text-align:left;transition:all 0.15s;" onmouseover="this.style.background='#fef3c7'" onmouseout="this.style.background='white'">
            <span style="display:flex;align-items:center;gap:8px;">
                <i class="fas fa-paper-plane" style="color:#81B29A;font-size:11px;"></i>
                <span>
                    <strong>${b.count} contactos</strong>
                    <span style="color:#6b7280;font-size:11px;"> · ${fmt(b.firstSent)} · <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:10px;">${escapeHtml(b.batchId.slice(0, 16))}…</code></span>
                </span>
            </span>
            <span style="color:#81B29A;font-weight:600;font-size:11px;">Usar este &rarr;</span>
        </button>
    `).join('');

    const footer = `<div style="margin-top:6px;font-size:11px;color:#92400e;">
        <strong>Total combinado:</strong> ${batches.reduce((s,b)=>s+b.count,0)} contactos (lo que está actualmente en el campo)
    </div>`;

    panel.innerHTML = header + list + footer;

    // Click handler para cada batch
    panel.querySelectorAll('.batch-pick-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const count = parseInt(btn.dataset.count, 10) || 0;
            contactadosInput.value = count;
            contactadosInput.style.background = '#dcfce7';
            setTimeout(() => { contactadosInput.style.background = ''; }, 1500);
            // Resalta el batch seleccionado
            panel.querySelectorAll('.batch-pick-item').forEach(b => {
                b.style.border = '1px solid #fde68a';
                b.style.background = 'white';
            });
            btn.style.border = '2px solid #81B29A';
            btn.style.background = '#dcfce7';
        });
    });

    // Inserta justo después de la fila
    row.parentElement.insertBefore(panel, row.nextSibling);
}

window.renderBatchPicker = renderBatchPicker;

// ===== Rescate IA: embudo de rescate + lista de contactados =====
window._rescate = window._rescate || { days: 7, status: '', sends: [] };

async function renderOrderFollowupView() {
    const r = window._rescate;
    document.querySelectorAll('.rescate-range-btn').forEach(b => {
        b.onclick = () => {
            r.days = Number(b.dataset.days) || 7;
            document.querySelectorAll('.rescate-range-btn').forEach(x => x.classList.toggle('active', x === b));
            loadRescateData();
        };
    });
    const refresh = document.getElementById('rescate-refresh');
    if (refresh) refresh.onclick = loadRescateData;
    document.querySelectorAll('.rescate-status-btn').forEach(b => {
        b.onclick = () => {
            r.status = b.dataset.status || '';
            document.querySelectorAll('.rescate-status-btn').forEach(x => x.classList.toggle('active', x === b));
            renderRescateTable();
        };
    });
    await loadRescateData();
}

async function loadRescateData() {
    const r = window._rescate;
    const loading = document.getElementById('rescate-loading');
    const content = document.getElementById('rescate-content');
    if (loading) loading.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    const to = Date.now();
    const from = to - r.days * 24 * 60 * 60 * 1000;
    try {
        const [mRes, sRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/order-followup/metrics?from=${from}&to=${to}`),
            fetch(`${API_BASE_URL}/api/order-followup/sends?from=${from}&to=${to}&limit=500`)
        ]);
        const m = await mRes.json();
        const s = await sRes.json();
        r.sends = (s && s.items) || [];
        fillRescateKpis(m || {});
        renderRescateTable();
        renderRescateChart();
    } catch (e) {
        console.error('[RESCATE] Error cargando datos:', e);
    } finally {
        if (loading) loading.classList.add('hidden');
        if (content) content.classList.remove('hidden');
    }
}

function fillRescateKpis(m) {
    const set = (id, val, sub) => {
        const el = document.getElementById('kpi-' + id);
        const se = document.getElementById('kpi-' + id + '-sub');
        if (el) el.textContent = val;
        if (se) se.innerHTML = sub || '&nbsp;';
    };
    set('contacted', m.contacted || 0, `${m.messages || 0} mensajes`);
    set('replied', m.replied || 0, `${m.replyRate || 0}% respondió`);
    set('converted', m.converted || 0, `${m.conversionRate || 0}% recuperado`);
    set('value', '$' + Number(m.valueRecovered || 0).toLocaleString('es-MX'), `ventana ${m.attributionDays || 7} días`);
}

const RESCATE_STATUS = {
    contacted: { label: 'Sin responder', color: 'var(--color-info)' },
    replied: { label: 'Respondió', color: 'var(--color-primary)' },
    converted: { label: 'Recuperado', color: 'var(--color-success)' }
};

function renderRescateTable() {
    const r = window._rescate;
    const body = document.getElementById('rescate-table-body');
    const empty = document.getElementById('rescate-empty');
    if (!body) return;
    let rows = r.sends || [];
    if (r.status) rows = rows.filter(x => x.status === r.status);
    if (rows.length === 0) {
        body.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');
    const esc = s => String(s || '').replace(/</g, '&lt;');
    body.innerHTML = rows.map(x => {
        const st = RESCATE_STATUS[x.status] || RESCATE_STATUS.contacted;
        const fecha = x.lastContactedAt
            ? new Date(x.lastContactedAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            : '—';
        const order = x.orderNumber ? ` <span style="color:var(--color-success);font-weight:600">(${esc(x.orderNumber)})</span>` : '';
        return `<tr style="cursor:pointer" onclick="openRescateChat('${esc(x.waId)}')">
            <td>${esc(x.name) || 'Sin nombre'}</td>
            <td>${esc(x.waId)}</td>
            <td>${esc(x.pendiente) || '—'}</td>
            <td>${x.messagesSent || 0}</td>
            <td><span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:${st.color}">${st.label}</span>${order}</td>
            <td>${fecha}</td>
        </tr>`;
    }).join('');
}

function openRescateChat(waId) {
    if (typeof navigateTo === 'function') navigateTo('chats');
    setTimeout(() => {
        if (typeof handleSelectContact === 'function') handleSelectContact(waId);
    }, 80);
}

function renderRescateChart() {
    const r = window._rescate;
    const canvas = document.getElementById('rescate-trend-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const dayMs = 24 * 60 * 60 * 1000;
    const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const labels = [], keys = [], contactedByDay = {}, convertedByDay = {};
    for (let i = r.days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * dayMs);
        const k = dayKey(d);
        keys.push(k);
        labels.push(d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }));
        contactedByDay[k] = 0;
        convertedByDay[k] = 0;
    }
    (r.sends || []).forEach(x => {
        if (x.firstContactedAt) { const k = dayKey(new Date(x.firstContactedAt)); if (k in contactedByDay) contactedByDay[k]++; }
        if (x.convertedAt) { const k = dayKey(new Date(x.convertedAt)); if (k in convertedByDay) convertedByDay[k]++; }
    });

    const styles = getComputedStyle(document.body);
    const primary = (styles.getPropertyValue('--color-primary').trim() || '#ea580c');
    const success = (styles.getPropertyValue('--color-success').trim() || '#1d9e75');

    if (window._rescateChart) window._rescateChart.destroy();
    window._rescateChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Contactados', data: keys.map(k => contactedByDay[k]), backgroundColor: primary, borderRadius: 6 },
                { label: 'Recuperados', data: keys.map(k => convertedByDay[k]), backgroundColor: success, borderRadius: 6 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

// Trae el estado de seguimiento del contacto y pinta el badge "pendiente" en el chat.
async function fetchOrderPending(contactId) {
    if (!contactId) return;
    if (!state.orderPendingByContact) state.orderPendingByContact = {};
    try {
        const res = await fetch(`${API_BASE_URL}/api/order-followup/contact/${encodeURIComponent(contactId)}`);
        state.orderPendingByContact[contactId] = (await res.json()) || { exists: false };
    } catch (e) {
        state.orderPendingByContact[contactId] = { exists: false };
    }
    if (state.selectedContactId === contactId) {
        const host = document.getElementById('order-pending-host');
        if (host && typeof OrderPendingBadge === 'function') {
            const contact = (state.contacts || []).find(c => c.id === contactId) || { id: contactId };
            host.innerHTML = OrderPendingBadge(contact);
        }
    }
}

window.renderOrderFollowupView = renderOrderFollowupView;
window.openRescateChat = openRescateChat;
window.renderRescateChart = renderRescateChart;
window.fetchOrderPending = fetchOrderPending;
