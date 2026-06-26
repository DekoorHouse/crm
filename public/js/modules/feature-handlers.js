// --- START: Event Handlers for Other App Features ---
// Este archivo agrupa los manejadores de eventos para las funcionalidades
// que no son el chat principal, como campañas, etiquetas, ajustes, etc.

/**
 * Modal de confirmación que reemplaza confirm() nativo.
 * Retorna una Promise<boolean>.
 */
function showConfirmModal(message, { icon = 'help', confirmText = 'Aceptar', cancelText = 'Cancelar', danger } = {}) {
    return new Promise((resolve) => {
        // El CRM usa Font Awesome (no Material Symbols): mapeamos las palabras clave
        // de icono a sus clases FA. Si ya viene una clase "fa-...", se usa tal cual.
        const FA_ICONS = {
            delete: 'fa-trash-alt', help: 'fa-circle-question', warning: 'fa-triangle-exclamation',
            info: 'fa-circle-info', cancel: 'fa-ban', local_shipping: 'fa-truck',
            pin_drop: 'fa-location-dot', two_wheeler: 'fa-motorcycle'
        };
        const faClass = (icon && icon.indexOf('fa-') !== -1) ? icon : (FA_ICONS[icon] || 'fa-circle-question');
        // Acciones destructivas en rojo; el resto en el acento primario de la marca.
        const isDanger = (danger !== undefined) ? danger : (icon === 'delete');
        const accent = isDanger ? 'var(--color-danger, #e24b4a)' : 'var(--color-primary, #ea580c)';

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);';
        const card = document.createElement('div');
        card.style.cssText = 'background:var(--color-container-bg,#fff);border:1px solid var(--color-border,rgba(0,0,0,.08));border-radius:16px;padding:24px;width:340px;max-width:90vw;box-shadow:0 12px 40px rgba(0,0,0,.22);text-align:center;font-family:var(--font-body,Inter,sans-serif);';
        card.innerHTML = `
            <div style="width:48px;height:48px;border-radius:50%;background:color-mix(in srgb, ${accent} 14%, transparent);display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
                <i class="fas ${faClass}" style="font-size:20px;color:${accent}"></i>
            </div>
            <p style="font-size:14px;color:var(--color-text,#1c1c1a);margin:0 0 20px;line-height:1.5">${message}</p>
            <div style="display:flex;gap:8px">
                <button id="_cm_cancel" style="flex:1;padding:10px 12px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:var(--color-subtle-bg,#f4f4f2);color:var(--color-text,#1c1c1a);transition:background .15s">${cancelText}</button>
                <button id="_cm_ok" style="flex:1;padding:10px 12px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:${accent};color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15);transition:opacity .15s">${confirmText}</button>
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
        } else if (tab === 'crear-ad') {
            activePane.dataset.loaded = '1';
            if (typeof initCreateAdForm === 'function') initCreateAdForm();
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


// =====================================================================
// --- Creador de anuncios click-to-WhatsApp (sub-pestaña "Crear Ad") ---
// =====================================================================

let adImageFile = null;             // File de la imagen O video del anuncio (se sube al publicar)
let adMediaKind = 'image';          // 'image' | 'video'
let adThumbBlob = null;             // miniatura capturada del video (opcional)
let adInterests = [];               // [{ id, name }] intereses seleccionados
let adInterestResults = [];         // últimos resultados del buscador
let adInterestSearchTimer = null;   // debounce
let adPlaces = [];                  // [{ id, key, type, name, ... }] lugares (ciudades/estados/país)
let adPlaceResults = [];            // últimos resultados del buscador de lugares
let adPlaceSearchTimer = null;      // debounce
let adCtwaDefaults = { pageId: null, whatsappNumber: '5216181333519' };

// Inicializa el formulario la primera vez que se abre la pestaña.
async function initCreateAdForm() {
    // Defaults (página + número de WhatsApp del negocio).
    try {
        const r = await fetch(`${API_BASE_URL}/api/meta-ads/ctwa-defaults`);
        if (r.ok) adCtwaDefaults = await r.json();
    } catch (_) { /* usa defaults locales */ }

    const waInput = document.getElementById('ad-wa-number');
    if (waInput && !waInput.value && adCtwaDefaults.whatsappNumber) waInput.value = adCtwaDefaults.whatsappNumber;

    seedAdFaqs();
    await loadAdAccounts();
    updateAdPreview();
    updateAdWelcomePreview();
}

// Carga las cuentas publicitarias y selecciona la activa por default.
async function loadAdAccounts() {
    const sel = document.getElementById('ad-account-select');
    if (!sel) return;
    try {
        const [accRes, activeRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/meta-ads/accounts`),
            fetch(`${API_BASE_URL}/api/meta-ads/accounts/active`).catch(() => null)
        ]);
        const accData = await accRes.json();
        if (!accRes.ok) throw new Error(accData.error || 'No se pudieron cargar las cuentas publicitarias.');
        const accounts = accData.data || [];
        if (!accounts.length) { sel.innerHTML = '<option value="">No hay cuentas (configura el token de Meta)</option>'; return; }

        let activeId = null;
        try { const a = activeRes && activeRes.ok ? await activeRes.json() : null; activeId = a && a.activeAccountId ? String(a.activeAccountId).replace('act_', '') : null; } catch (_) {}

        sel.innerHTML = accounts.map(a => {
            const id = a.account_id || String(a.id || '').replace('act_', '');
            return `<option value="${id}">${a.name || id}</option>`;
        }).join('');
        if (activeId && accounts.some(a => (a.account_id || '') === activeId)) sel.value = activeId;

        await onAdAccountChange();
    } catch (error) {
        console.error('[CrearAd] Error cargando cuentas:', error);
        sel.innerHTML = '<option value="">Error al cargar cuentas</option>';
        showError(error.message);
    }
}

// Al cambiar de cuenta, recarga las páginas promocionables de esa cuenta.
async function onAdAccountChange() {
    const accountId = (document.getElementById('ad-account-select') || {}).value || '';
    const pageSel = document.getElementById('ad-page-select');
    if (!pageSel || !accountId) return;
    pageSel.innerHTML = '<option value="">Cargando páginas…</option>';
    try {
        const res = await fetch(`${API_BASE_URL}/api/meta-ads/pages?accountId=${encodeURIComponent(accountId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las páginas.');
        const pages = data.data || [];
        if (!pages.length) { pageSel.innerHTML = '<option value="">Esta cuenta no tiene páginas</option>'; updateAdPreview(); return; }
        pageSel.innerHTML = pages.map(p => `<option value="${p.id}">${p.name || p.id}</option>`).join('');
        // Default: la página configurada en el server (FB_PAGE_ID) si está disponible.
        if (adCtwaDefaults.pageId && pages.some(p => String(p.id) === String(adCtwaDefaults.pageId))) {
            pageSel.value = String(adCtwaDefaults.pageId);
        }
    } catch (error) {
        console.error('[CrearAd] Error cargando páginas:', error);
        pageSel.innerHTML = '<option value="">Error al cargar páginas</option>';
    }
    updateAdPreview();
}

// Selecciona el objetivo (Mensajes / Ventas).
function onAdObjectiveChange(card) {
    document.querySelectorAll('.ad-objective-card').forEach(c => c.classList.toggle('selected', c === card));
    const hidden = document.getElementById('ad-objective');
    if (hidden) hidden.value = card.dataset.objective || 'OUTCOME_ENGAGEMENT';
}

// Lee la imagen elegida, la muestra en el drop y en la vista previa.
function onAdMediaChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    adImageFile = file;
    adThumbBlob = null;
    adMediaKind = (file.type || '').startsWith('video') ? 'video' : 'image';

    const imgPrev = document.getElementById('ad-image-preview');
    const vidPrev = document.getElementById('ad-video-preview');
    const ph = document.getElementById('ad-image-placeholder');
    const box = document.getElementById('ad-preview-image');
    if (ph) ph.classList.add('hidden');

    if (adMediaKind === 'video') {
        const url = URL.createObjectURL(file);
        if (imgPrev) imgPrev.classList.add('hidden');
        if (vidPrev) { vidPrev.src = url; vidPrev.classList.remove('hidden'); }
        if (box) box.innerHTML = `<video src="${url}" muted autoplay loop playsinline style="width:100%;height:100%;object-fit:cover;"></video>`;
        // Captura la primera imagen del video como miniatura (best-effort).
        captureVideoThumb(file, (blob) => { adThumbBlob = blob; });
    } else {
        const reader = new FileReader();
        reader.onload = () => {
            if (vidPrev) vidPrev.classList.add('hidden');
            if (imgPrev) { imgPrev.src = reader.result; imgPrev.classList.remove('hidden'); }
            if (box) box.innerHTML = `<img src="${reader.result}" alt="">`;
        };
        reader.readAsDataURL(file);
    }
}

// Extrae el primer fotograma de un video como miniatura JPEG (para el creativo).
function captureVideoThumb(file, cb) {
    try {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;
        v.onloadeddata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch (_) { cb(null); } };
        v.onseeked = () => {
            try {
                const c = document.createElement('canvas');
                c.width = v.videoWidth || 720; c.height = v.videoHeight || 720;
                c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                c.toBlob((b) => { URL.revokeObjectURL(url); cb(b); }, 'image/jpeg', 0.85);
            } catch (_) { cb(null); }
        };
        v.onerror = () => { cb(null); };
    } catch (_) { cb(null); }
}

// Espera a que Meta termine de procesar el video antes de crear el anuncio.
async function waitVideoReady(videoId, accountId, btn) {
    for (let i = 0; i < 60; i++) { // ~3 min máx (60 × 3s)
        let st = 'processing';
        try {
            const r = await fetch(`${API_BASE_URL}/api/meta-ads/video-status?videoId=${encodeURIComponent(videoId)}&accountId=${encodeURIComponent(accountId)}`);
            const d = await r.json();
            st = (d && d.status && d.status.video_status) || 'processing';
        } catch (_) { /* reintenta */ }
        if (st === 'ready') return true;
        if (st === 'error') throw new Error('Meta no pudo procesar el video. Prueba con otro archivo.');
        if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Procesando video en Meta… (${i * 3 + 3}s)`;
        await new Promise((res) => setTimeout(res, 3000));
    }
    throw new Error('El video sigue procesando en Meta. Espera unos segundos y vuelve a dar Publicar.');
}

// Refresca la vista previa estilo feed de Facebook.
function updateAdPreview() {
    const primary = (document.getElementById('ad-primary-text') || {}).value || '';
    const headline = (document.getElementById('ad-headline') || {}).value || '';
    const desc = (document.getElementById('ad-description') || {}).value || '';
    const ctaSel = document.getElementById('ad-cta');
    const pageSel = document.getElementById('ad-page-select');
    const pageName = pageSel && pageSel.selectedIndex >= 0 && pageSel.value ? pageSel.options[pageSel.selectedIndex].text : 'Tu página';

    const elPrimary = document.getElementById('ad-preview-primary');
    if (elPrimary) {
        if (primary.trim()) elPrimary.textContent = primary;
        else elPrimary.innerHTML = '<span style="color:#90949c;">El texto principal aparecerá aquí…</span>';
    }
    const elHeadline = document.getElementById('ad-preview-headline');
    if (elHeadline) elHeadline.textContent = headline.trim() || 'Envíanos un mensaje';
    const elDesc = document.getElementById('ad-preview-desc');
    if (elDesc) elDesc.textContent = desc.trim();
    const elCta = document.getElementById('ad-preview-cta');
    if (elCta && ctaSel && ctaSel.selectedIndex >= 0) elCta.textContent = ctaSel.options[ctaSel.selectedIndex].text;
    const elName = document.getElementById('ad-preview-pagename');
    if (elName) elName.textContent = pageName;
    const elAvatar = document.getElementById('ad-preview-avatar');
    if (elAvatar) elAvatar.textContent = (pageName || 'D').trim().charAt(0).toUpperCase();
}

// Busca intereses en la API de targeting de Meta (con debounce).
function searchAdInterests(q) {
    clearTimeout(adInterestSearchTimer);
    const box = document.getElementById('ad-interest-results');
    if (!q || q.trim().length < 2) { if (box) { box.classList.add('hidden'); box.innerHTML = ''; } return; }
    adInterestSearchTimer = setTimeout(async () => {
        const accountId = (document.getElementById('ad-account-select') || {}).value || '';
        try {
            const url = `${API_BASE_URL}/api/meta-ads/audiences/targeting-search?q=${encodeURIComponent(q.trim())}&type=adinterest${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error en la búsqueda.');
            renderAdInterestResults(data.data || []);
        } catch (error) {
            console.warn('[CrearAd] búsqueda de intereses falló:', error.message);
            if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
        }
    }, 300);
}

function renderAdInterestResults(list) {
    adInterestResults = (list || []).slice(0, 15);
    const box = document.getElementById('ad-interest-results');
    if (!box) return;
    if (!adInterestResults.length) { box.classList.add('hidden'); box.innerHTML = '<div class="opt" style="cursor:default;color:#9ca3af;">Sin resultados</div>'; box.classList.remove('hidden'); return; }
    box.innerHTML = adInterestResults.map((it, i) => {
        const topic = it.topic ? ` <small>(${escapeTemplatePreview(it.topic)})</small>` : '';
        return `<div class="opt" onmousedown="addAdInterestByIndex(${i})">${escapeTemplatePreview(it.name || '')}${topic}</div>`;
    }).join('');
    box.classList.remove('hidden');
}

function addAdInterestByIndex(i) {
    const it = adInterestResults[i];
    if (it) addAdInterest(it.id, it.name);
}

function addAdInterest(id, name) {
    if (!id) return;
    if (!adInterests.some(x => String(x.id) === String(id))) adInterests.push({ id: String(id), name: name || String(id) });
    renderAdInterestChips();
    const input = document.getElementById('ad-interest-search');
    if (input) input.value = '';
    const box = document.getElementById('ad-interest-results');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

function removeAdInterest(id) {
    adInterests = adInterests.filter(x => String(x.id) !== String(id));
    renderAdInterestChips();
}

function renderAdInterestChips() {
    const box = document.getElementById('ad-interest-chips');
    if (!box) return;
    box.innerHTML = adInterests.map(it =>
        `<span class="ad-chip">${escapeTemplatePreview(it.name)} <i class="fas fa-times" onclick="removeAdInterest('${String(it.id).replace(/'/g, '')}')"></i></span>`
    ).join('');
}

function hideAdInterestResults() {
    // Pequeño delay para permitir el onmousedown de las opciones.
    setTimeout(() => { const box = document.getElementById('ad-interest-results'); if (box) box.classList.add('hidden'); }, 180);
}

// --- Lugares (ciudades / estados / país) ---

// Busca lugares en la API de geo de Meta (con debounce).
function searchAdPlaces(q) {
    clearTimeout(adPlaceSearchTimer);
    const box = document.getElementById('ad-place-results');
    if (!q || q.trim().length < 2) { if (box) { box.classList.add('hidden'); box.innerHTML = ''; } return; }
    adPlaceSearchTimer = setTimeout(async () => {
        const accountId = (document.getElementById('ad-account-select') || {}).value || '';
        try {
            const url = `${API_BASE_URL}/api/meta-ads/audiences/targeting-search?q=${encodeURIComponent(q.trim())}&type=adgeolocation&location_types=country,region,city${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error en la búsqueda.');
            renderAdPlaceResults(data.data || []);
        } catch (error) {
            console.warn('[CrearAd] búsqueda de lugares falló:', error.message);
            if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
        }
    }, 300);
}

// Etiqueta legible del tipo de lugar.
function adPlaceTypeLabel(t) {
    return ({ city: 'Ciudad', region: 'Estado', country: 'País', zip: 'CP' })[t] || t;
}

function renderAdPlaceResults(list) {
    adPlaceResults = (list || []).slice(0, 15);
    const box = document.getElementById('ad-place-results');
    if (!box) return;
    if (!adPlaceResults.length) { box.innerHTML = '<div class="opt" style="cursor:default;color:#9ca3af;">Sin resultados</div>'; box.classList.remove('hidden'); return; }
    box.innerHTML = adPlaceResults.map((it, i) => {
        const ctx = [it.region, it.country_name].filter(Boolean).join(', ');
        const ctxTxt = ctx ? ` <small>${escapeTemplatePreview(ctx)}</small>` : '';
        return `<div class="opt" onmousedown="addAdPlaceByIndex(${i})"><strong>${escapeTemplatePreview(it.name || '')}</strong> <small>· ${adPlaceTypeLabel(it.type)}</small>${ctxTxt}</div>`;
    }).join('');
    box.classList.remove('hidden');
}

function addAdPlaceByIndex(i) {
    const it = adPlaceResults[i];
    if (it) addAdPlace(it);
}

function addAdPlace(it) {
    if (!it || !it.key) return;
    const id = `${it.type}:${it.key}`;
    if (!adPlaces.some(p => p.id === id)) {
        adPlaces.push({ id, key: String(it.key), type: it.type, name: it.name, country_code: it.country_code, region: it.region });
    }
    renderAdPlaceChips();
    const input = document.getElementById('ad-place-search');
    if (input) input.value = '';
    const box = document.getElementById('ad-place-results');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

function removeAdPlace(id) {
    adPlaces = adPlaces.filter(p => p.id !== id);
    renderAdPlaceChips();
}

function renderAdPlaceChips() {
    const box = document.getElementById('ad-place-chips');
    if (!box) return;
    box.innerHTML = adPlaces.map(p => {
        const sub = p.type === 'city' ? 'Ciudad' : (p.type === 'region' ? 'Estado' : 'País');
        return `<span class="ad-chip">${escapeTemplatePreview(p.name)} <small style="opacity:.7;">${sub}</small> <i class="fas fa-times" onclick="removeAdPlace('${String(p.id).replace(/'/g, '')}')"></i></span>`;
    }).join('');
}

function hideAdPlaceResults() {
    setTimeout(() => { const box = document.getElementById('ad-place-results'); if (box) box.classList.add('hidden'); }, 180);
}

// --- Conversación: saludo + preguntas frecuentes (mensaje de bienvenida) ---

const AD_FAQ_DEFAULTS = ['¿Dónde están ubicados?', '¿Cuál es el precio?', '¿Cómo realizo una compra?'];

// Siembra preguntas por default la primera vez (no pisa lo que el usuario ya tenga).
function seedAdFaqs() {
    const box = document.getElementById('ad-faqs');
    if (!box || box.querySelector('.ad-faq-row')) return;
    AD_FAQ_DEFAULTS.forEach(q => addAdFaqRow(q));
}

// Agrega una fila de pregunta frecuente (máx. 4).
function addAdFaqRow(value = '') {
    const box = document.getElementById('ad-faqs');
    if (!box || box.querySelectorAll('.ad-faq-row').length >= 4) return;
    const row = document.createElement('div');
    row.className = 'ad-faq-row';
    row.style.cssText = 'display:flex;gap:8px;align-items:center;';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ad-faq-input !mb-0';
    input.maxLength = 80;
    input.placeholder = 'Pregunta frecuente';
    input.style.flex = '1';
    input.value = typeof value === 'string' ? value : '';
    input.addEventListener('input', updateAdWelcomePreview);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-red-500 px-2';
    btn.title = 'Quitar';
    btn.innerHTML = '<i class="fas fa-times"></i>';
    btn.addEventListener('click', () => { row.remove(); refreshAdFaqAddBtn(); updateAdWelcomePreview(); });
    row.appendChild(input);
    row.appendChild(btn);
    box.appendChild(row);
    refreshAdFaqAddBtn();
    updateAdWelcomePreview();
}

function refreshAdFaqAddBtn() {
    const box = document.getElementById('ad-faqs');
    const btn = document.getElementById('ad-faq-add');
    if (!box || !btn) return;
    const full = box.querySelectorAll('.ad-faq-row').length >= 4;
    btn.disabled = full;
    btn.style.opacity = full ? '0.5' : '';
}

function getAdFaqs() {
    return Array.from(document.querySelectorAll('#ad-faqs .ad-faq-input'))
        .map(i => i.value.trim()).filter(Boolean).slice(0, 4);
}

// Refresca la vista previa del chat de WhatsApp (saludo + preguntas).
function updateAdWelcomePreview() {
    const greeting = ((document.getElementById('ad-greeting') || {}).value || '').trim() || '¡Hola! 👋 ¿Cómo podemos ayudarte?';
    const gEl = document.getElementById('ad-welcome-greeting');
    if (gEl) gEl.textContent = greeting;
    const faqsEl = document.getElementById('ad-welcome-faqs');
    if (faqsEl) {
        faqsEl.innerHTML = getAdFaqs().map(q =>
            `<div style="background:#fff;border:1px solid #25D366;color:#075E54;border-radius:16px;padding:5px 12px;font-size:12px;max-width:90%;">${escapeTemplatePreview(q)}</div>`
        ).join('');
    }
}

// Construye el spec de targeting a partir de los controles de audiencia.
function buildAdTargeting() {
    const country = (document.getElementById('ad-geo-country') || {}).value || 'MX';
    let ageMin = parseInt((document.getElementById('ad-age-min') || {}).value, 10);
    let ageMax = parseInt((document.getElementById('ad-age-max') || {}).value, 10);
    if (isNaN(ageMin)) ageMin = 18;
    if (isNaN(ageMax)) ageMax = 65;
    ageMin = Math.min(Math.max(ageMin, 13), 65);
    ageMax = Math.min(Math.max(ageMax, 13), 65);
    if (ageMin > ageMax) { const t = ageMin; ageMin = ageMax; ageMax = t; }

    // Geo: si hay lugares específicos (ciudades/estados/país), se usan esos;
    // si no, todo el país seleccionado en el select.
    let geo;
    if (adPlaces.length) {
        geo = {};
        const cities = adPlaces.filter(p => p.type === 'city').map(p => ({ key: p.key }));
        const regions = adPlaces.filter(p => p.type === 'region').map(p => ({ key: p.key }));
        const countries = adPlaces.filter(p => p.type === 'country').map(p => p.country_code || p.key);
        if (cities.length) geo.cities = cities;
        if (regions.length) geo.regions = regions;
        if (countries.length) geo.countries = countries;
        if (!geo.cities && !geo.regions && !geo.countries) geo = { countries: [country] };
    } else {
        geo = { countries: [country] };
    }

    const targeting = {
        geo_locations: geo,
        age_min: ageMin,
        age_max: ageMax
    };
    const gender = (document.getElementById('ad-gender') || {}).value || 'all';
    if (gender === 'male') targeting.genders = [1];
    else if (gender === 'female') targeting.genders = [2];
    if (adInterests.length) {
        targeting.flexible_spec = [{ interests: adInterests.map(i => ({ id: i.id, name: i.name })) }];
    }
    return targeting;
}

// Valida, confirma, sube la imagen y publica el anuncio (EN VIVO).
async function handleCreateMetaAd() {
    const accountId = (document.getElementById('ad-account-select') || {}).value || '';
    const pageId = (document.getElementById('ad-page-select') || {}).value || '';
    const objective = (document.getElementById('ad-objective') || {}).value || 'OUTCOME_ENGAGEMENT';
    const name = ((document.getElementById('ad-name') || {}).value || '').trim();
    const waNumber = ((document.getElementById('ad-wa-number') || {}).value || '').replace(/[^0-9]/g, '');
    const budgetMxn = parseFloat((document.getElementById('ad-daily-budget') || {}).value);
    const primaryText = ((document.getElementById('ad-primary-text') || {}).value || '').trim();
    const headline = ((document.getElementById('ad-headline') || {}).value || '').trim();
    const description = ((document.getElementById('ad-description') || {}).value || '').trim();
    const ctaType = (document.getElementById('ad-cta') || {}).value || 'WHATSAPP_MESSAGE';

    if (!accountId) { showError('Selecciona una cuenta publicitaria.'); return; }
    if (!pageId) { showError('Selecciona una página de Facebook.'); return; }
    if (!name) { showError('Ponle un nombre al anuncio.'); return; }
    if (waNumber.length < 10) { showError('El número de WhatsApp no es válido (incluye código de país).'); return; }
    if (!budgetMxn || budgetMxn <= 0) { showError('Define un presupuesto diario válido.'); return; }
    if (!primaryText) { showError('Escribe el texto principal del anuncio.'); return; }
    if (!adImageFile) { showError('Sube una imagen o un video del anuncio.'); return; }

    const dailyBudgetCents = Math.round(budgetMxn * 100);
    const targeting = buildAdTargeting();
    const objLabel = objective === 'OUTCOME_SALES' ? 'Ventas' : 'Mensajes';
    const genderTxt = { all: 'todos', male: 'hombres', female: 'mujeres' }[(document.getElementById('ad-gender') || {}).value || 'all'];
    const interesesTxt = adInterests.length ? `${adInterests.length} interés(es)` : 'audiencia amplia';
    const formatoTxt = adMediaKind === 'video' ? 'Video' : 'Imagen';
    const geoTxt = adPlaces.length ? adPlaces.map(p => p.name).join(', ') : ((document.getElementById('ad-geo-country') || {}).value || 'MX');
    const greeting = ((document.getElementById('ad-greeting') || {}).value || '').trim();
    const faqs = getAdFaqs();
    const convoTxt = greeting ? `saludo + ${faqs.length} pregunta(s)` : 'mensaje por defecto de Meta';

    const resumen =
        `Vas a PUBLICAR un anuncio EN VIVO:\n\n` +
        `• Objetivo: ${objLabel} (a WhatsApp)\n` +
        `• Formato: ${formatoTxt}\n` +
        `• Presupuesto: $${budgetMxn.toLocaleString('es-MX')} MXN / día\n` +
        `• Audiencia: ${geoTxt}, ${targeting.age_min}-${targeting.age_max} años, ${genderTxt}, ${interesesTxt}\n` +
        `• Conversación: ${convoTxt}\n` +
        `• WhatsApp: ${waNumber}\n\n` +
        `Empezará a gastar tu presupuesto en cuanto Meta lo apruebe. ¿Continuar?`;
    if (!confirm(resumen)) return;

    const btn = document.getElementById('create-ad-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Subiendo…';

    try {
        let imageHash = null, videoId = null, thumbnailHash = null;

        if (adMediaKind === 'video') {
            // 1a. Miniatura del video (opcional, best-effort).
            if (adThumbBlob) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Subiendo miniatura…';
                try {
                    const tf = new FormData();
                    tf.append('image', adThumbBlob, 'thumb.jpg');
                    tf.append('accountId', accountId);
                    const tr = await fetch(`${API_BASE_URL}/api/meta-ads/creatives/upload-image`, { method: 'POST', body: tf });
                    const td = await tr.json();
                    if (tr.ok && td.images) { const o = Object.values(td.images)[0]; thumbnailHash = o && o.hash; }
                } catch (_) { /* miniatura opcional */ }
            }
            // 1b. Subir el video.
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Subiendo video…';
            const vf = new FormData();
            vf.append('video', adImageFile);
            vf.append('accountId', accountId);
            const vr = await fetch(`${API_BASE_URL}/api/meta-ads/creatives/upload-video`, { method: 'POST', body: vf });
            const vd = await vr.json();
            if (!vr.ok || !vd.id) throw new Error(vd.error || 'No se pudo subir el video.');
            videoId = vd.id;
            // 1c. Esperar a que Meta procese el video.
            await waitVideoReady(videoId, accountId, btn);
        } else {
            // 1. Subir la imagen a la cuenta publicitaria → image_hash.
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Subiendo imagen…';
            const fd = new FormData();
            fd.append('image', adImageFile);
            fd.append('accountId', accountId);
            const upRes = await fetch(`${API_BASE_URL}/api/meta-ads/creatives/upload-image`, { method: 'POST', body: fd });
            const upData = await upRes.json();
            if (!upRes.ok) throw new Error(upData.error || 'No se pudo subir la imagen.');
            const imgObj = upData.images ? Object.values(upData.images)[0] : null;
            imageHash = imgObj && imgObj.hash;
            if (!imageHash) throw new Error('La imagen se subió pero Meta no devolvió un hash.');
        }

        // 2. Crear campaña + conjunto + creativo + anuncio (EN VIVO).
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Publicando anuncio…';
        const res = await fetch(`${API_BASE_URL}/api/meta-ads/quick-create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountId, objective, name, pageId, whatsappNumber: waNumber,
                dailyBudgetCents, targeting, primaryText, headline, description,
                imageHash, videoId, thumbnailHash, greeting, faqs, ctaType, status: 'ACTIVE'
            })
        });
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.error || 'No se pudo crear el anuncio.');

        const adsManagerUrl = `https://www.facebook.com/adsmanager/manage/ads?act=${accountId}`;
        alert(`✅ ¡Anuncio publicado!\n\nSe creó la campaña y está EN REVISIÓN de Meta. Empezará a entregarse cuando la aprueben (suele tardar minutos).\n\nID del anuncio: ${result.adId}`);
        window.open(adsManagerUrl, '_blank');
        resetCreateAdForm();
    } catch (error) {
        console.error('[CrearAd] Error al publicar:', error);
        showError(error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket mr-2"></i> Publicar anuncio';
    }
}

// Limpia el formulario tras publicar con éxito.
function resetCreateAdForm() {
    ['ad-name', 'ad-primary-text', 'ad-headline', 'ad-description', 'ad-interest-search'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    adImageFile = null;
    adThumbBlob = null;
    adMediaKind = 'image';
    adInterests = [];
    adPlaces = [];
    renderAdInterestChips();
    renderAdPlaceChips();
    const greetingEl = document.getElementById('ad-greeting');
    if (greetingEl) greetingEl.value = '';
    const faqsBox = document.getElementById('ad-faqs');
    if (faqsBox) { faqsBox.innerHTML = ''; seedAdFaqs(); }
    updateAdWelcomePreview();
    const prev = document.getElementById('ad-image-preview');
    if (prev) { prev.src = ''; prev.classList.add('hidden'); }
    const vidPrev = document.getElementById('ad-video-preview');
    if (vidPrev) { vidPrev.src = ''; vidPrev.classList.add('hidden'); }
    const ph = document.getElementById('ad-image-placeholder');
    if (ph) ph.classList.remove('hidden');
    const fileInput = document.getElementById('ad-image');
    if (fileInput) fileInput.value = '';
    const box = document.getElementById('ad-preview-image');
    if (box) box.innerHTML = '';
    updateAdPreview();
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

// --- Respuesta automática de Facebook/Messenger ---
// Carga la respuesta rápida configurada como bienvenida de FB y la marca en el select.
async function loadMessengerWelcomeSetting() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/messenger-welcome`);
        const data = await response.json();
        if (data.success) {
            const sel = document.getElementById('messenger-welcome-select');
            messengerWelcomeSavedValue = data.settings.shortcut || '';
            if (sel) sel.value = messengerWelcomeSavedValue;
            if (typeof refreshMessengerWelcomeDisplay === 'function') refreshMessengerWelcomeDisplay();
        }
    } catch (error) {
        console.error('Error al cargar la bienvenida de Facebook:', error);
    }
}

// Guarda la respuesta rápida elegida como bienvenida de FB.
async function handleSaveMessengerWelcome() {
    const sel = document.getElementById('messenger-welcome-select');
    if (!sel) return;
    const btn = document.getElementById('save-messenger-welcome-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
    try {
        const response = await fetch(`${API_BASE_URL}/api/settings/messenger-welcome`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shortcut: sel.value })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'No se pudo guardar.');
        showError(sel.value ? `Bienvenida de Facebook: /${sel.value}` : 'Bienvenida de Facebook: predeterminada.', 'success');
        // Confirmado: registra el valor y vuelve al modo guardado (no editable).
        messengerWelcomeSavedValue = sel.value;
        if (typeof setMessengerWelcomeEditing === 'function') setMessengerWelcomeEditing(false);
    } catch (error) {
        showError(error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
}

// --- Integraciones: guardar el ID de la Google Sheet de cobertura ---
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
        showError("ID de Google Sheet guardado con éxito.", 'success');
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Guardar';
    }
}

// --- Herramientas de prueba: simular un mensaje entrante de un anuncio ---
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
        showError('Simulación enviada con éxito. Revisa la lista de chats para ver el nuevo contacto/mensaje.', 'success');
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Enviar Simulación';
    }
}

// --- Combobox buscable para la bienvenida de Facebook ---
// Dos modos dentro de #messenger-welcome-combo:
//  · "Guardado": muestra la selección actual como algo asentado (no editable)
//    con un botón "Cambiar". Así no parece un borrador sin guardar.
//  · "Edición": barra de texto que FILTRA las respuestas rápidas + Guardar/Cancelar.
// El valor real vive en el <select id="messenger-welcome-select"> (oculto), la
// fuente de verdad para guardar/cargar. El valor sólo cambia al elegir un ítem.
let messengerWelcomeHighlight = -1;
// Última opción confirmada (cargada del servidor o recién guardada): sirve para Cancelar.
let messengerWelcomeSavedValue = '';

// Lee las opciones actuales del select oculto: [{ value, label }]
function messengerWelcomeOptions() {
    const sel = document.getElementById('messenger-welcome-select');
    return sel ? Array.from(sel.options).map(o => ({ value: o.value, label: o.textContent })) : [];
}

// Refleja la opción seleccionada del select en la caja "Guardado" y en la barra
// de búsqueda del modo edición.
function refreshMessengerWelcomeDisplay() {
    const sel = document.getElementById('messenger-welcome-select');
    if (!sel) return;
    const opt = sel.options[sel.selectedIndex];
    const label = opt ? opt.textContent : 'Predeterminada (saludo genérico)';
    const display = document.getElementById('messenger-welcome-display-text');
    if (display) display.textContent = label;
    const input = document.getElementById('messenger-welcome-search');
    if (input) input.value = opt ? opt.textContent : '';
}

// Alterna entre el modo guardado (caja + "Cambiar") y el de edición (búsqueda).
function setMessengerWelcomeEditing(editing) {
    const display = document.getElementById('messenger-welcome-display');
    const edit = document.getElementById('messenger-welcome-edit');
    if (!display || !edit) return;
    display.classList.toggle('hidden', editing);
    display.classList.toggle('flex', !editing);
    edit.classList.toggle('hidden', !editing);
    edit.classList.toggle('flex', editing);
    hideMessengerWelcomeOptions();
    if (editing) {
        refreshMessengerWelcomeDisplay();
        const input = document.getElementById('messenger-welcome-search');
        if (input) input.focus();
    }
}

function hideMessengerWelcomeOptions() {
    const list = document.getElementById('messenger-welcome-options');
    if (list) list.classList.add('hidden');
}

// Dibuja la lista filtrada por el texto escrito.
function renderMessengerWelcomeOptions(filter) {
    const list = document.getElementById('messenger-welcome-options');
    if (!list) return;
    const q = (filter || '').trim().toLowerCase();
    const items = messengerWelcomeOptions().filter(o => !q || o.label.toLowerCase().includes(q));
    messengerWelcomeHighlight = -1;
    if (items.length === 0) {
        list.innerHTML = '<li class="px-3 py-2 text-gray-400">Sin coincidencias</li>';
    } else {
        list.innerHTML = items.map(o =>
            `<li class="messenger-welcome-option px-3 py-2 cursor-pointer hover:bg-blue-50" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</li>`
        ).join('');
    }
    list.classList.remove('hidden');
}

// Aplica la selección: fija el valor del select oculto y refleja el texto.
function chooseMessengerWelcome(value) {
    const sel = document.getElementById('messenger-welcome-select');
    if (!sel) return;
    sel.value = value;
    refreshMessengerWelcomeDisplay();
    hideMessengerWelcomeOptions();
}

// Mueve el resaltado con las flechas del teclado.
function moveMessengerWelcomeHighlight(delta) {
    const list = document.getElementById('messenger-welcome-options');
    if (!list || list.classList.contains('hidden')) return;
    const opts = Array.from(list.querySelectorAll('.messenger-welcome-option'));
    if (opts.length === 0) return;
    messengerWelcomeHighlight = (messengerWelcomeHighlight + delta + opts.length) % opts.length;
    opts.forEach((el, i) => el.classList.toggle('bg-blue-100', i === messengerWelcomeHighlight));
    opts[messengerWelcomeHighlight].scrollIntoView({ block: 'nearest' });
}

// Inicializa (una sola vez) los listeners del combobox. Idempotente: si ya está
// inicializado sólo refresca el texto mostrado.
function initMessengerWelcomeCombo() {
    const input = document.getElementById('messenger-welcome-search');
    const list = document.getElementById('messenger-welcome-options');
    const combo = document.getElementById('messenger-welcome-combo');
    if (!input || !list || !combo) return;
    if (input.dataset.comboInit === '1') { setMessengerWelcomeEditing(false); refreshMessengerWelcomeDisplay(); return; }
    input.dataset.comboInit = '1';

    // Botón "Cambiar": entra en modo edición.
    const editBtn = document.getElementById('messenger-welcome-edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => setMessengerWelcomeEditing(true));
    // Botón "Cancelar": descarta lo no guardado y vuelve al modo guardado.
    const cancelBtn = document.getElementById('messenger-welcome-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
        const sel = document.getElementById('messenger-welcome-select');
        if (sel) sel.value = messengerWelcomeSavedValue;
        refreshMessengerWelcomeDisplay();
        setMessengerWelcomeEditing(false);
    });

    // Al enfocar muestra todas; seleccionar el texto facilita reemplazarlo al buscar.
    input.addEventListener('focus', () => { input.select(); renderMessengerWelcomeOptions(''); });
    input.addEventListener('input', () => renderMessengerWelcomeOptions(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (list.classList.contains('hidden')) renderMessengerWelcomeOptions(input.value);
            else moveMessengerWelcomeHighlight(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveMessengerWelcomeHighlight(-1);
        } else if (e.key === 'Enter') {
            const hl = list.querySelector('.messenger-welcome-option.bg-blue-100');
            if (hl) { e.preventDefault(); chooseMessengerWelcome(hl.dataset.value); }
        } else if (e.key === 'Escape') {
            hideMessengerWelcomeOptions();
        }
    });
    // mousedown (no click) para que corra antes del blur del input.
    list.addEventListener('mousedown', (e) => {
        const li = e.target.closest('.messenger-welcome-option');
        if (!li) return;
        e.preventDefault();
        chooseMessengerWelcome(li.dataset.value);
    });
    // Al salir del campo: cerrar y revertir el texto a la opción seleccionada
    // (un timeout deja que corra primero la selección por mousedown).
    input.addEventListener('blur', () => setTimeout(() => {
        hideMessengerWelcomeOptions();
        refreshMessengerWelcomeDisplay();
    }, 150));

    setMessengerWelcomeEditing(false); // arranca en modo guardado
    refreshMessengerWelcomeDisplay();
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

// Elimina (de la colección de usuarios del CRM) al usuario abierto en el modal.
async function handleDeleteUser() {
    const email = document.getElementById('user-id').value;
    if (!email) {
        showError('No se identificó al usuario a eliminar.');
        return;
    }
    // No permitir que un usuario borre su propia cuenta.
    const myEmail = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.email : '';
    if (myEmail && myEmail.toLowerCase() === email.toLowerCase()) {
        showError('No puedes eliminar tu propia cuenta.');
        return;
    }

    const nameInput = document.getElementById('user-name');
    const displayName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : email;
    const ok = await showConfirmModal(`¿Eliminar a "${displayName}" del equipo? Perderá acceso al CRM. Esta acción no se puede deshacer.`, {
        icon: 'delete', confirmText: 'Eliminar', cancelText: 'Cancelar'
    });
    if (!ok) return;

    const btn = document.getElementById('user-delete-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Eliminando...'; }
    try {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error al eliminar el usuario.');
        }
        closeUserModal();
        showError('Usuario eliminado correctamente.', 'success');
        if (typeof fetchAllUsers === 'function') fetchAllUsers();
    } catch (error) {
        showError(error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt mr-2"></i>Eliminar'; }
    }
}
window.handleDeleteUser = handleDeleteUser;

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
// --- Creador de anuncios (Crear Ad) ---
window.initCreateAdForm = initCreateAdForm;
window.onAdAccountChange = onAdAccountChange;
window.onAdObjectiveChange = onAdObjectiveChange;
window.onAdMediaChange = onAdMediaChange;
window.updateAdPreview = updateAdPreview;
window.searchAdInterests = searchAdInterests;
window.addAdInterestByIndex = addAdInterestByIndex;
window.addAdInterest = addAdInterest;
window.removeAdInterest = removeAdInterest;
window.hideAdInterestResults = hideAdInterestResults;
window.searchAdPlaces = searchAdPlaces;
window.addAdPlaceByIndex = addAdPlaceByIndex;
window.removeAdPlace = removeAdPlace;
window.hideAdPlaceResults = hideAdPlaceResults;
window.addAdFaqRow = addAdFaqRow;
window.updateAdWelcomePreview = updateAdWelcomePreview;
window.handleCreateMetaAd = handleCreateMetaAd;
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
