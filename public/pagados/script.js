document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = window.API_BASE_URL || '';

    const cuerpoTabla = document.getElementById('cuerpoTabla');
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

    // De aquí para abajo las fechas se manejan como strings YYYY-MM-DD y la aritmética
    // se hace en UTC: son días de calendario, así que el huso no debe entrar a jugar.
    const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
    const keyOf = d => d.toISOString().slice(0, 10);
    const restaDias = (k, n) => keyOf(new Date(parseKey(k).getTime() - n * 86400000));
    const primerDiaMes = k => { const d = parseKey(k); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };
    const sumaMeses = (f, n) => new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + n, 1));
    const fmtDia = k => parseKey(k).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

    let rango = { desde: restaDias(HOY, 29), hasta: HOY };
    let pedidos = [];
    let filtroEvento = 'todos';
    let orden = { campo: 'registradoAt', dir: -1 };

    const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const money = n => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
    const pct = (a, b, sufijo) => b ? `${(a / b * 100).toFixed(1)}% ${sufijo}` : ' ';

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

    // =====================================================================
    // Calendario propio: el <input type="date"> nativo no se puede tematizar
    // ni hacer selección de rango, así que se arma a mano.
    // =====================================================================
    const MESES_VISIBLES = 2;   // dos meses a la vista para elegir rangos sin navegar

    const dp = {
        panel: document.getElementById('dpPanel'),
        trigger: document.getElementById('dpTrigger'),
        label: document.getElementById('dpLabel'),
        grids: document.getElementById('dpGrids'),
        hint: document.getElementById('dpHint'),
        prev: document.getElementById('dpPrev'),
        next: document.getElementById('dpNext'),
        base: primerDiaMes(HOY),    // mes de la derecha
        sel: { desde: null, hasta: null },
        hover: null,
        abierto: false
    };

    function pintarEtiqueta() {
        dp.label.textContent = rango.desde === rango.hasta
            ? fmtDia(rango.desde)
            : `${fmtDia(rango.desde)} → ${fmtDia(rango.hasta)}`;
    }

    function calendarioDeMes(mes) {
        const y = mes.getUTCFullYear(), m = mes.getUTCMonth();
        const celdas = [];
        const offset = (mes.getUTCDay() + 6) % 7;   // la semana arranca en lunes
        for (let i = 0; i < offset; i++) celdas.push('<span class="dp-day vacio"></span>');
        const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        for (let d = 1; d <= ultimo; d++) {
            const key = keyOf(new Date(Date.UTC(y, m, d)));
            // No hay pedidos en el futuro: esos días no se pueden elegir.
            const futuro = key > HOY;
            celdas.push(`<button type="button" class="dp-day" data-key="${key}"${futuro ? ' disabled' : ''}>${d}</button>`);
        }
        const cal = document.createElement('div');
        cal.className = 'dp-cal';
        cal.innerHTML = `
            <div class="dp-caption">${mes.toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
            <div class="dp-week"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
            <div class="dp-days">${celdas.join('')}</div>`;
        return cal;
    }

    function construirGrids() {
        dp.grids.innerHTML = '';
        for (let i = MESES_VISIBLES - 1; i >= 0; i--) dp.grids.appendChild(calendarioDeMes(sumaMeses(dp.base, -i)));
        dp.next.disabled = dp.base.getTime() >= primerDiaMes(HOY).getTime();
        pintarDias();
    }

    // Solo cambia clases sobre los botones ya pintados (se llama en cada hover).
    function pintarDias() {
        let a = dp.sel.desde, b = dp.sel.hasta;
        if (a && !b && dp.hover) [a, b] = [a, dp.hover].sort();
        dp.grids.querySelectorAll('.dp-day[data-key]').forEach(btn => {
            const k = btn.dataset.key;
            btn.classList.toggle('hoy', k === HOY);
            btn.classList.toggle('inicio', k === a);
            btn.classList.toggle('fin', !!b && k === b);
            btn.classList.toggle('rango', !!a && !!b && k > a && k < b);
        });
    }

    function abrirPanel() {
        // Se arranca mostrando el rango vigente; el primer clic empieza una selección nueva.
        dp.sel = { desde: rango.desde, hasta: rango.hasta };
        dp.hover = null;
        dp.base = primerDiaMes(rango.hasta);
        dp.abierto = true;
        dp.panel.hidden = false;
        dp.trigger.setAttribute('aria-expanded', 'true');
        dp.hint.textContent = 'Elige el primer día del rango';
        construirGrids();
    }

    function cerrarPanel() {
        dp.abierto = false;
        dp.panel.hidden = true;
        dp.trigger.setAttribute('aria-expanded', 'false');
    }

    function elegirDia(key) {
        if (dp.sel.desde && !dp.sel.hasta) {
            // Segundo clic: cierra el rango. Ordenar los dos strings alcanza (YYYY-MM-DD).
            const [a, b] = [dp.sel.desde, key].sort();
            dp.sel = { desde: a, hasta: b };
            rango = { desde: a, hasta: b };
            dp.hover = null;
            pintarEtiqueta();
            chipsFecha.querySelectorAll('button').forEach(x => x.classList.remove('active'));
            cerrarPanel();
            cargar();
        } else {
            dp.sel = { desde: key, hasta: null };
            dp.hint.textContent = 'Ahora elige el último día (el mismo para ver un solo día)';
            pintarDias();
        }
    }

    dp.trigger.addEventListener('click', () => dp.abierto ? cerrarPanel() : abrirPanel());
    dp.prev.addEventListener('click', () => { dp.base = sumaMeses(dp.base, -1); construirGrids(); });
    dp.next.addEventListener('click', () => { dp.base = sumaMeses(dp.base, 1); construirGrids(); });

    dp.grids.addEventListener('click', e => {
        const btn = e.target.closest('.dp-day[data-key]');
        if (btn && !btn.disabled) elegirDia(btn.dataset.key);
    });

    dp.grids.addEventListener('mouseover', e => {
        const btn = e.target.closest('.dp-day[data-key]');
        if (!btn || btn.disabled || !dp.sel.desde || dp.sel.hasta) return;
        dp.hover = btn.dataset.key;
        pintarDias();
    });

    document.addEventListener('click', e => {
        if (dp.abierto && !e.target.closest('#datePicker')) cerrarPanel();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && dp.abierto) cerrarPanel();
    });

    // --- Carga (el rango de fechas es lo único que se consulta al servidor) ---
    async function cargar() {
        cuerpoTabla.innerHTML = '<tr><td colspan="7" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Cargando datos...</td></tr>';
        try {
            const qs = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
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
        const conEvento = filas.filter(p => p.metaPurchaseSentAt);
        const monto = filas.reduce((s, p) => s + p.precio, 0);
        const montoEvento = conEvento.reduce((s, p) => s + p.precio, 0);

        document.getElementById('statTotal').textContent = filas.length.toLocaleString('es-MX');
        document.getElementById('statRango').textContent = `${rango.desde} → ${rango.hasta}`;
        document.getElementById('statConEvento').textContent = conEvento.length.toLocaleString('es-MX');
        document.getElementById('statConEventoPct').textContent = pct(conEvento.length, filas.length, 'del total');
        document.getElementById('statSinEvento').textContent = (filas.length - conEvento.length).toLocaleString('es-MX');
        document.getElementById('statSinEventoPct').textContent = pct(filas.length - conEvento.length, filas.length, 'del total');
        document.getElementById('statMontoEvento').textContent = money(montoEvento);
        document.getElementById('statMontoEventoPct').textContent = pct(montoEvento, monto, 'del monto');
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

    // --- Atajos de fecha (cambiar el rango vuelve a consultar) ---
    function aplicarPreset(preset) {
        if (preset === 'hoy') rango = { desde: HOY, hasta: HOY };
        else if (preset === 'ayer') { const a = restaDias(HOY, 1); rango = { desde: a, hasta: a }; }
        else rango = { desde: restaDias(HOY, Number(preset) - 1), hasta: HOY };
        pintarEtiqueta();
    }

    chipsFecha.addEventListener('click', e => {
        const btn = e.target.closest('button[data-preset]');
        if (!btn) return;
        chipsFecha.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        aplicarPreset(btn.dataset.preset);
        cargar();
    });

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
        link.download = `pedidos_${rango.desde}_${rango.hasta}.csv`;
        link.click();
    });

    aplicarPreset('30');
    cargar();
});
