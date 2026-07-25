document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = window.API_BASE_URL || '';

    const cuerpoTabla = document.getElementById('cuerpoTabla');
    const fDesde = document.getElementById('fDesde');
    const fHasta = document.getElementById('fHasta');
    const fEstatus = document.getElementById('fEstatus');
    const fBusqueda = document.getElementById('fBusqueda');
    const chipsFecha = document.getElementById('chipsFecha');
    const segEvento = document.getElementById('segEvento');
    const noticeTruncado = document.getElementById('noticeTruncado');
    const loadingOverlay = document.getElementById('loading-overlay');

    // Mismo criterio que el backend: el día se corta a la medianoche de CDMX (-06:00),
    // no en UTC, para que un pedido de la noche no se vaya al día siguiente.
    const dayKey = d => new Date(d.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
    const HOY = dayKey(new Date());
    const restaDias = (key, n) => dayKey(new Date(new Date(`${key}T00:00:00.000-06:00`).getTime() - n * 86400000));

    let pedidos = [];
    let filtroEvento = 'todos';
    let orden = { campo: 'registradoAt', dir: -1 };

    const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const money = n => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
    const pct = (a, b) => b ? `${(a / b * 100).toFixed(1)}% del total` : ' ';

    function fmtFecha(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('es-MX', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City'
        });
    }

    // --- Estatus: verde = ya pagó, ámbar = en proceso, rojo = perdido ---
    const COLOR_ESTATUS = {
        'Pagado': ['#dcfce7', '#166534'],
        'Enviado': ['#dcfce7', '#166534'],
        'Entregado': ['#dcfce7', '#166534'],
        'Cancelado': ['#fee2e2', '#991b1b'],
        'Esperando pago': ['#fef3c7', '#92400e'],
        'Esperando anticipo': ['#fef3c7', '#92400e'],
        'Mns Amenazador': ['#fef3c7', '#92400e']
    };

    function badgeEstatus(estatus) {
        const [bg, color] = COLOR_ESTATUS[estatus] || ['#e0e7ff', '#3730a3'];
        return `<span class="badge" style="background:${bg};color:${color}">${escapeHtml(estatus)}</span>`;
    }

    // --- Carga (el rango de fechas es lo único que se consulta al servidor) ---
    async function cargar() {
        cuerpoTabla.innerHTML = '<tr><td colspan="7" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Cargando datos...</td></tr>';
        try {
            const qs = new URLSearchParams({ desde: fDesde.value, hasta: fHasta.value });
            const response = await fetch(`${API_BASE_URL}/api/pagados/pedidos?${qs}`);
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Error al obtener los datos.');

            pedidos = result.data;
            llenarEstatus();

            if (result.truncado) {
                document.getElementById('noticeTruncadoTexto').textContent =
                    `El rango tiene más de ${result.max.toLocaleString('es-MX')} pedidos: solo se muestran los ${result.max.toLocaleString('es-MX')} más recientes. Acorta el rango para ver el resto.`;
                noticeTruncado.style.display = 'block';
            } else {
                noticeTruncado.style.display = 'none';
            }
            render();
        } catch (error) {
            console.error('Error cargando pedidos:', error);
            cuerpoTabla.innerHTML = `<tr><td colspan="7" class="loading-cell" style="color:var(--color-danger)"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(error.message)}</td></tr>`;
        } finally {
            if (loadingOverlay) {
                loadingOverlay.style.opacity = '0';
                setTimeout(() => loadingOverlay.style.display = 'none', 500);
            }
        }
    }

    // El desplegable se arma con los estatus que de verdad aparecen en la ventana. El estatus
    // ya elegido se conserva aunque el rango nuevo no lo traiga: si se cayera solo, la tabla
    // pasaría a mostrar TODO y se leería como si el filtro siguiera puesto.
    function llenarEstatus() {
        const previo = fEstatus.value;
        const usados = [...new Set(pedidos.map(p => p.estatus))].sort((a, b) => a.localeCompare(b, 'es'));
        if (previo && !usados.includes(previo)) usados.push(previo);
        fEstatus.innerHTML = '<option value="">Todos</option>' +
            usados.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
        fEstatus.value = previo;
    }

    function filtrar() {
        const estatus = fEstatus.value;
        const q = fBusqueda.value.trim().toLowerCase();
        return pedidos.filter(p => {
            if (filtroEvento === 'si' && !p.metaPurchaseSentAt) return false;
            if (filtroEvento === 'no' && p.metaPurchaseSentAt) return false;
            if (estatus && p.estatus !== estatus) return false;
            if (q && !`${p.numero} ${p.producto}`.toLowerCase().includes(q)) return false;
            return true;
        });
    }

    function ordenar(filas) {
        const { campo, dir } = orden;
        return filas.slice().sort((a, b) => {
            let va, vb;
            if (campo === 'evento') {
                va = a.metaPurchaseSentAt ? 1 : 0;
                vb = b.metaPurchaseSentAt ? 1 : 0;
            } else {
                va = a[campo] ?? '';
                vb = b[campo] ?? '';
            }
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb), 'es') * dir;
        });
    }

    function render() {
        const filas = ordenar(filtrar());
        const conEvento = filas.filter(p => p.metaPurchaseSentAt).length;
        const monto = filas.reduce((s, p) => s + p.precio, 0);

        document.getElementById('statTotal').textContent = filas.length.toLocaleString('es-MX');
        document.getElementById('statRango').textContent = `${fDesde.value} → ${fHasta.value}`;
        document.getElementById('statConEvento').textContent = conEvento.toLocaleString('es-MX');
        document.getElementById('statConEventoPct').textContent = pct(conEvento, filas.length);
        document.getElementById('statSinEvento').textContent = (filas.length - conEvento).toLocaleString('es-MX');
        document.getElementById('statSinEventoPct').textContent = pct(filas.length - conEvento, filas.length);
        document.getElementById('statMonto').textContent = money(monto);

        document.querySelectorAll('#tablaPedidos thead th[data-sort]').forEach(th => {
            const activo = th.dataset.sort === orden.campo;
            th.classList.toggle('sorted', activo);
            th.querySelector('.arrow').textContent = activo ? (orden.dir === 1 ? '↑' : '↓') : '↕';
        });

        if (filas.length === 0) {
            cuerpoTabla.innerHTML = '<tr><td colspan="7" class="loading-cell">Ningún pedido cumple con los filtros.</td></tr>';
            return;
        }

        cuerpoTabla.innerHTML = filas.map(p => `
            <tr>
                <td><strong>${escapeHtml(p.numero)}</strong></td>
                <td class="num">${money(p.precio)}</td>
                <td class="producto">${escapeHtml(p.producto)}</td>
                <td>${badgeEstatus(p.estatus)}</td>
                <td>${fmtFecha(p.registradoAt)}</td>
                <td><span class="badge ${p.metaPurchaseSentAt ? 'badge-si' : 'badge-no'}">${p.metaPurchaseSentAt ? 'Sí' : 'No'}</span></td>
                <td>${fmtFecha(p.metaPurchaseSentAt)}</td>
            </tr>
        `).join('');
    }

    // --- Filtros de fecha (cambiar el rango vuelve a consultar) ---
    function aplicarPreset(preset) {
        if (preset === 'hoy') { fDesde.value = HOY; fHasta.value = HOY; }
        else if (preset === 'ayer') { const a = restaDias(HOY, 1); fDesde.value = a; fHasta.value = a; }
        else { fDesde.value = restaDias(HOY, Number(preset) - 1); fHasta.value = HOY; }
    }

    chipsFecha.addEventListener('click', e => {
        const btn = e.target.closest('button[data-preset]');
        if (!btn) return;
        chipsFecha.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        aplicarPreset(btn.dataset.preset);
        cargar();
    });

    [fDesde, fHasta].forEach(input => input.addEventListener('change', () => {
        if (!fDesde.value || !fHasta.value) return;
        if (fDesde.value > fHasta.value) {
            // Un rango invertido no devuelve nada: se empareja el otro extremo.
            if (input === fDesde) fHasta.value = fDesde.value; else fDesde.value = fHasta.value;
        }
        chipsFecha.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        cargar();
    }));

    // --- Filtros locales (instantáneos, sin volver al servidor) ---
    segEvento.addEventListener('click', e => {
        const btn = e.target.closest('button[data-evento]');
        if (!btn) return;
        segEvento.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        filtroEvento = btn.dataset.evento;
        render();
    });

    fEstatus.addEventListener('change', render);
    fBusqueda.addEventListener('input', render);

    document.querySelectorAll('#tablaPedidos thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const campo = th.dataset.sort;
            // Las columnas numéricas y de fecha arrancan en descendente (lo más grande/reciente primero).
            const descPorDefecto = ['consecutivo', 'precio', 'registradoAt', 'metaPurchaseSentAt', 'evento'].includes(campo);
            orden = orden.campo === campo
                ? { campo, dir: -orden.dir }
                : { campo, dir: descPorDefecto ? -1 : 1 };
            render();
        });
    });

    document.getElementById('btnRecargar').addEventListener('click', cargar);

    document.getElementById('btnExportCSV').addEventListener('click', () => {
        const filas = ordenar(filtrar());
        if (filas.length === 0) return alert('No hay datos para exportar.');
        const headers = ['No. Pedido', 'Monto a pagar', 'Producto', 'Estatus', 'Registrado', 'Evento Meta', 'Fecha del evento'];
        const rows = filas.map(p => [
            p.numero,
            p.precio,
            p.producto,
            p.estatus,
            fmtFecha(p.registradoAt),
            p.metaPurchaseSentAt ? 'Sí' : 'No',
            p.metaPurchaseSentAt ? fmtFecha(p.metaPurchaseSentAt) : ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `pedidos_${fDesde.value}_${fHasta.value}.csv`;
        link.click();
    });

    aplicarPreset('30');
    cargar();
});
