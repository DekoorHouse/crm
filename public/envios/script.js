document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = window.API_BASE_URL || '';
    const cuerpoTabla = document.getElementById('cuerpoTablaEnvios');
    const contadorEnvios = document.getElementById('contadorEnvios');
    const btnExportCSV = document.getElementById('btnExportCSV');
    const btnRecargar = document.getElementById('btnRecargar');
    const loadingOverlay = document.getElementById('loading-overlay');

    let enviosData = [];

    async function cargarEnvios() {
        cuerpoTabla.innerHTML = '<tr><td colspan="13" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Cargando datos...</td></tr>';
        try {
            const response = await fetch(`${API_BASE_URL}/api/datos-envio`);
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Error al obtener los datos.');
            }

            enviosData = result.data;
            renderTabla(enviosData);
            contadorEnvios.textContent = `${enviosData.length} registros`;

        } catch (error) {
            console.error('Error cargando envíos:', error);
            cuerpoTabla.innerHTML = `<tr><td colspan="13" class="loading-cell" style="color:var(--color-danger)"><i class="fas fa-exclamation-triangle"></i> ${error.message}</td></tr>`;
        } finally {
            if (loadingOverlay) {
                loadingOverlay.style.opacity = '0';
                setTimeout(() => loadingOverlay.style.display = 'none', 500);
            }
        }
    }

    function formatDate(timestamp) {
        if (!timestamp) return '-';
        const date = new Date(timestamp._seconds ? timestamp._seconds * 1000 : timestamp);
        return date.toLocaleDateString('es-MX', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function renderTabla(data) {
        if (data.length === 0) {
            cuerpoTabla.innerHTML = '<tr><td colspan="13" class="loading-cell">No hay datos de envío registrados.</td></tr>';
            return;
        }
        cuerpoTabla.innerHTML = data.map((envio, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${formatDate(envio.createdAt)}</td>
                <td><strong>${envio.numeroPedido || '-'}</strong></td>
                <td>${envio.nombreCompleto || '-'}</td>
                <td>${envio.telefono || '-'}</td>
                <td>${envio.direccion || '-'}</td>
                <td>${envio.numInterior || '-'}</td>
                <td>${envio.colonia || '-'}</td>
                <td>${envio.ciudad || '-'}</td>
                <td>${envio.codigoPostal || '-'}</td>
                <td>${envio.estado || '-'}</td>
                <td>${envio.referencia || '-'}</td>
                <td><button class="btn-delete" title="Eliminar" onclick="eliminarEnvio('${envio.id}')"><i class="fas fa-trash-alt"></i></button></td>
            </tr>
        `).join('');
    }

    window.eliminarEnvio = async function(id) {
        if (!confirm('¿Estás seguro de eliminar este registro?')) return;
        try {
            const response = await fetch(`${API_BASE_URL}/api/datos-envio/${id}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message);
            cargarEnvios();
        } catch (error) {
            alert('Error al eliminar: ' + error.message);
        }
    };

    function exportCSV() {
        if (enviosData.length === 0) return alert('No hay datos para exportar.');
        const headers = ['Fecha', 'No. Pedido', 'Nombre Completo', 'Teléfono', 'Dirección', 'Num. Interior', 'Colonia', 'Ciudad', 'C.P.', 'Estado', 'Referencia'];
        const rows = enviosData.map(e => [
            formatDate(e.createdAt),
            e.numeroPedido || '',
            e.nombreCompleto || '',
            e.telefono || '',
            e.direccion || '',
            e.numInterior || '',
            e.colonia || '',
            e.ciudad || '',
            e.codigoPostal || '',
            e.estado || '',
            e.referencia || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `envios_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    }

    btnExportCSV.addEventListener('click', exportCSV);
    btnRecargar.addEventListener('click', cargarEnvios);

    cargarEnvios();
});
