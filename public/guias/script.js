document.addEventListener('DOMContentLoaded', () => {
    const API = window.API_BASE_URL || '';
    const form = document.getElementById('guiaForm');
    const alert = document.getElementById('formAlert');
    const btnSubmit = document.getElementById('btnSubmit');
    const btnAutofill = document.getElementById('btnAutofill');
    const autofillInput = document.getElementById('autofillPedido');
    const cuerpoTabla = document.getElementById('cuerpoTablaGuias');
    const contadorGuias = document.getElementById('contadorGuias');
    const statusBadge = document.getElementById('statusBadge');
    const loadingOverlay = document.getElementById('loading-overlay');

    // Verificar configuración J&T
    async function checkStatus() {
        try {
            const res = await fetch(`${API}/api/jt-guias/status`);
            const data = await res.json();
            if (data.configured) {
                statusBadge.className = 'status-badge ok';
                statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> API Conectada';
            } else {
                statusBadge.className = 'status-badge warn';
                statusBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Sin configurar';
            }
        } catch (e) {
            statusBadge.className = 'status-badge warn';
            statusBadge.innerHTML = '<i class="fas fa-times-circle"></i> Error';
        }
    }

    // Mostrar alerta
    function showAlert(type, message) {
        alert.className = `alert ${type}`;
        alert.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${message}`;
        alert.style.display = 'flex';
        if (type === 'success') {
            setTimeout(() => { alert.style.display = 'none'; }, 8000);
        }
    }

    function hideAlert() {
        alert.style.display = 'none';
    }

    // Auto-fill desde pedido
    btnAutofill.addEventListener('click', async () => {
        const pedido = autofillInput.value.trim();
        if (!pedido) return;

        btnAutofill.disabled = true;
        btnAutofill.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            // Buscar en datos_envio
            const res = await fetch(`${API}/api/datos-envio`);
            const data = await res.json();

            if (data.success && data.data.length > 0) {
                const envio = data.data.find(e => e.numeroPedido === pedido);
                if (envio) {
                    document.getElementById('orderNumber').value = envio.numeroPedido;
                    document.getElementById('receiverName').value = envio.nombreCompleto || '';
                    document.getElementById('receiverPhone').value = envio.telefono || '';
                    document.getElementById('street').value = envio.direccion || '';
                    document.getElementById('colonia').value = envio.colonia || '';
                    document.getElementById('city').value = envio.ciudad || '';
                    document.getElementById('state').value = envio.estado || '';
                    document.getElementById('zip').value = envio.codigoPostal || '';
                    document.getElementById('reference').value = envio.referencia || '';
                    showAlert('success', `Datos cargados del pedido ${pedido}`);
                } else {
                    showAlert('error', `No se encontraron datos de envío para ${pedido}`);
                }
            }
        } catch (e) {
            showAlert('error', 'Error al buscar datos del pedido');
        } finally {
            btnAutofill.disabled = false;
            btnAutofill.innerHTML = '<i class="fas fa-search"></i>';
        }
    });

    // Enter en autofill input
    autofillInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            btnAutofill.click();
        }
    });

    // Crear guía
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const payload = {
            orderNumber: document.getElementById('orderNumber').value.trim(),
            receiverName: document.getElementById('receiverName').value.trim(),
            receiverPhone: document.getElementById('receiverPhone').value.trim(),
            street: document.getElementById('street').value.trim(),
            colonia: document.getElementById('colonia').value.trim(),
            city: document.getElementById('city').value.trim(),
            state: document.getElementById('state').value.trim(),
            zip: document.getElementById('zip').value.trim(),
            reference: document.getElementById('reference').value.trim(),
            productName: document.getElementById('productName').value.trim() || 'Lámpara 3D Personalizada',
            weight: parseFloat(document.getElementById('weight').value) || 1,
        };

        // Validaciones frontend
        if (!payload.orderNumber || !payload.receiverName || !payload.receiverPhone ||
            !payload.street || !payload.colonia || !payload.city || !payload.state || !payload.zip) {
            showAlert('error', 'Completa todos los campos obligatorios.');
            return;
        }

        if (!/^\d{10}$/.test(payload.receiverPhone)) {
            showAlert('error', 'El teléfono debe tener 10 dígitos.');
            return;
        }

        if (!/^\d{5}$/.test(payload.zip)) {
            showAlert('error', 'El código postal debe tener 5 dígitos.');
            return;
        }

        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando guía...';

        try {
            const res = await fetch(`${API}/api/jt-guias/crear`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await res.json();

            if (result.success) {
                showAlert('success', `Guía creada: <strong>${result.waybillNo}</strong> para pedido ${result.orderId}`);
                form.reset();
                document.getElementById('weight').value = '1';
                cargarGuias();
            } else {
                const detail = result.error || result.code ? ` (código: ${result.code || 'N/A'})` : '';
                const fullMsg = `${result.message || 'Error al crear la guía.'}${detail}${result.error ? '<br><small>' + result.error + '</small>' : ''}`;
                showAlert('error', fullMsg);
                console.error('[Guías] Error completo:', result);
            }
        } catch (error) {
            showAlert('error', 'Error de conexión al servidor.');
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i class="fas fa-shipping-fast"></i> Crear Guía J&T';
        }
    });

    // Cargar guías existentes
    async function cargarGuias() {
        cuerpoTabla.innerHTML = '<tr><td colspan="8" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Cargando guías...</td></tr>';

        try {
            const res = await fetch(`${API}/api/jt-guias`);
            const data = await res.json();

            if (!data.success) throw new Error(data.message);

            const guias = data.data;
            contadorGuias.textContent = `${guias.length} guías`;

            if (guias.length === 0) {
                cuerpoTabla.innerHTML = '<tr><td colspan="8" class="loading-cell">No hay guías creadas aún.</td></tr>';
                return;
            }

            cuerpoTabla.innerHTML = guias.map(g => {
                const date = g.createdAt?._seconds
                    ? new Date(g.createdAt._seconds * 1000)
                    : g.createdAt ? new Date(g.createdAt) : null;
                const dateStr = date
                    ? date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '-';

                return `<tr>
                    <td>${dateStr}</td>
                    <td><strong>${g.orderNumber || '-'}</strong></td>
                    <td>${g.waybillNo ? `<span class="waybill-badge">${g.waybillNo}</span>` : '-'}</td>
                    <td>${g.receiverName || '-'}</td>
                    <td>${g.receiverPhone || '-'}</td>
                    <td>${g.address || '-'}</td>
                    <td><span class="status-tag ${g.status || 'created'}">${g.status === 'cancelled' ? 'Cancelada' : 'Creada'}</span></td>
                    <td>
                        <div class="table-actions">
                            ${g.waybillNo ? `<button class="btn-icon track" title="Rastrear" onclick="window.open('/jt-rastreo/?waybill=${g.waybillNo}','_blank')"><i class="fas fa-search-location"></i></button>` : ''}
                            ${g.waybillNo ? `<button class="btn-icon copy" title="Copiar guía" onclick="copyWaybill('${g.waybillNo}')"><i class="fas fa-copy"></i></button>` : ''}
                            ${g.status !== 'cancelled' ? `<button class="btn-icon cancel" title="Cancelar" onclick="cancelarGuia('${g.id}','${g.orderNumber}')"><i class="fas fa-times-circle"></i></button>` : ''}
                        </div>
                    </td>
                </tr>`;
            }).join('');

        } catch (error) {
            cuerpoTabla.innerHTML = `<tr><td colspan="8" class="loading-cell" style="color:var(--color-danger)"><i class="fas fa-exclamation-triangle"></i> ${error.message}</td></tr>`;
        } finally {
            if (loadingOverlay) {
                loadingOverlay.style.opacity = '0';
                setTimeout(() => loadingOverlay.style.display = 'none', 500);
            }
        }
    }

    // Copiar número de guía
    window.copyWaybill = function(waybill) {
        navigator.clipboard.writeText(waybill).then(() => {
            showAlert('success', `Guía ${waybill} copiada al portapapeles`);
        });
    };

    // Cancelar guía
    window.cancelarGuia = async function(id, orderNumber) {
        if (!confirm(`¿Cancelar la guía del pedido ${orderNumber}?`)) return;
        try {
            const res = await fetch(`${API}/api/jt-guias/${id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                showAlert('success', 'Guía cancelada.');
                cargarGuias();
            } else {
                showAlert('error', result.message || 'Error al cancelar.');
            }
        } catch (e) {
            showAlert('error', 'Error de conexión.');
        }
    };

    // Recargar
    document.getElementById('btnRecargar').addEventListener('click', cargarGuias);

    // Init
    checkStatus();
    cargarGuias();
});
