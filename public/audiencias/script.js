import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {

    const firebaseConfig = {
        apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
        authDomain: "pedidos-con-gemini.firebaseapp.com",
        projectId: "pedidos-con-gemini",
        storageBucket: "pedidos-con-gemini.firebasestorage.app",
        messagingSenderId: "300825194175",
        appId: "1:300825194175:web:972fa7b8af195a83e6e00a"
    };
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    const loadingOverlay = document.getElementById('loading-overlay');
    const seccionLogin = document.getElementById('seccionLogin');
    const seccionAudiencias = document.getElementById('seccionAudiencias');
    const formularioLogin = document.getElementById('formularioLogin');
    const mensajeError = document.getElementById('mensajeError');
    const usuarioLogueado = document.getElementById('usuarioLogueado');
    const audienciasGrid = document.getElementById('audienciasGrid');
    const audienciasFooter = document.getElementById('audienciasFooter');
    const cacheInfo = document.getElementById('cacheInfo');

    formularioLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        mensajeError.textContent = '';
        try {
            await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value);
        } catch (err) {
            mensajeError.textContent = 'Credenciales incorrectas.';
        }
    });

    onAuthStateChanged(auth, async (user) => {
        loadingOverlay.style.display = 'none';
        if (user) {
            seccionLogin.style.display = 'none';
            seccionAudiencias.style.display = 'block';
            usuarioLogueado.textContent = user.email;
            cargarAudiencias(false);
            cargarCenso();
            cargarMensajesChart();
        } else {
            seccionLogin.style.display = 'block';
            seccionAudiencias.style.display = 'none';
        }
    });

    window.cerrarSesion = () => signOut(auth);

    const fmtMoney = (n) => {
        if (!n) return '$0';
        return '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 });
    };

    const fmtRel = (ms) => {
        const diff = Date.now() - ms;
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'hace unos segundos';
        if (m < 60) return `hace ${m} min`;
        const h = Math.floor(m / 60);
        if (h < 24) return `hace ${h} h`;
        return `hace ${Math.floor(h / 24)} d`;
    };

    // --- Filtro de fechas ---
    let filtroFrom = null;
    let filtroTo = null;

    function presetToRange(preset) {
        const now = new Date();
        const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
        switch (preset) {
            case 'hoy':       return { from: day(now), to: endOfDay(now) };
            case 'ayer':      { const y = new Date(now); y.setDate(y.getDate() - 1); return { from: day(y), to: endOfDay(y) }; }
            case 'semana':    return { from: now.getTime() - 7 * 24 * 60 * 60 * 1000, to: now.getTime() };
            case 'mes':       return { from: now.getTime() - 30 * 24 * 60 * 60 * 1000, to: now.getTime() };
            case 'trimestre': return { from: now.getTime() - 90 * 24 * 60 * 60 * 1000, to: now.getTime() };
            case 'anio':      return { from: now.getTime() - 365 * 24 * 60 * 60 * 1000, to: now.getTime() };
            case 'all':
            default:          return { from: null, to: null };
        }
    }

    window.onFiltroPresetChange = () => {
        const preset = document.getElementById('filtroPreset').value;
        const customBox = document.getElementById('filtroCustom');
        if (preset === 'custom') {
            customBox.style.display = 'inline-flex';
            return;
        }
        customBox.style.display = 'none';
        const r = presetToRange(preset);
        filtroFrom = r.from;
        filtroTo = r.to;
        cargarAudiencias(false);
    };

    window.aplicarFiltroCustom = () => {
        const fromStr = document.getElementById('filtroFrom').value;
        const toStr = document.getElementById('filtroTo').value;
        filtroFrom = fromStr ? new Date(fromStr + 'T00:00:00').getTime() : null;
        filtroTo = toStr ? new Date(toStr + 'T23:59:59.999').getTime() : null;
        cargarAudiencias(false);
    };

    function actualizarFiltroResumen() {
        const el = document.getElementById('filtroResumen');
        if (!el) return;
        if (!filtroFrom && !filtroTo) {
            el.textContent = '';
            return;
        }
        const fmt = (ms) => ms ? new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) : '...';
        el.textContent = ` · ${fmt(filtroFrom)} → ${fmt(filtroTo)}`;
    }

    window.cargarAudiencias = async (forceRefresh) => {
        audienciasGrid.innerHTML = '<div class="audiencias-loading"><i class="fas fa-spinner fa-spin"></i> Cargando audiencias...</div>';
        actualizarFiltroResumen();
        try {
            const token = await auth.currentUser.getIdToken();
            const params = new URLSearchParams();
            if (forceRefresh) params.set('fresh', '1');
            if (filtroFrom) params.set('from', String(filtroFrom));
            if (filtroTo) params.set('to', String(filtroTo));
            const url = '/api/audiencias/conteos' + (params.toString() ? '?' + params.toString() : '');
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error al cargar audiencias');
            renderAudiencias(data);
        } catch (e) {
            audienciasGrid.innerHTML = `<div class="audiencias-error"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
        }
    };

    function renderAudiencias(data) {
        const g = data.grupos;
        cacheInfo.textContent = data.fromCache
            ? `Caché de ${Math.round(data.cacheAgeMs / 1000)}s · calculado ${fmtRel(new Date(data.calculadoEn).getTime())}`
            : `Actualizado ahora (${new Date(data.calculadoEn).toLocaleTimeString('es-MX')})`;

        const html = [
            cardSimple({
                clase: 'sin-pagar',
                grupoKey: 'sinPagar',
                icono: 'fa-credit-card',
                titulo: 'Sin Pagar',
                hint: 'Tienen pedido pero no han pagado',
                grupo: g.sinPagar,
                extra: g.sinPagar.montoTotal > 0 ? `💰 <strong>${fmtMoney(g.sinPagar.montoTotal)}</strong> por cobrar` : null
            }),
            cardSimple({
                clase: 'sin-datos',
                grupoKey: 'sinDatos',
                icono: 'fa-box',
                titulo: 'Sin Datos de Envío',
                hint: 'Pagaron pero no tenemos su dirección',
                grupo: g.sinDatos
            }),
            cardSimple({
                clase: 'en-visto',
                grupoKey: 'enVisto',
                icono: 'fa-eye',
                titulo: 'En Visto',
                hint: 'Leyeron nuestro mensaje, no contestaron y no tienen pedido',
                grupo: g.enVisto
            }),
            cardSubgrupos({
                clase: 'recompra',
                grupoKey: 'recompra',
                icono: 'fa-redo',
                titulo: 'Recompra',
                hint: 'Ya compraron — ventana de recompra natural (30-180 días)',
                grupo: g.recompra,
                subgrupos: [
                    { key: 'caliente', clase: 'sub-caliente', icono: 'fa-fire', titulo: 'Caliente', desc: '30-60 días desde su compra' },
                    { key: 'optima',   clase: 'sub-optima',   icono: 'fa-bullseye', titulo: 'Óptima',   desc: '60-120 días — fechas especiales' },
                    { key: 'ultima',   clase: 'sub-ultima',   icono: 'fa-hourglass-end', titulo: 'Última',   desc: '120-180 días — último empujón' }
                ]
            }),
            cardSubgrupos({
                clase: 'inactivos',
                grupoKey: 'inactivos',
                icono: 'fa-snowflake',
                titulo: 'Inactivos',
                hint: 'Llevan más de 180 días sin volver a comprar',
                grupo: g.inactivos,
                extra: g.inactivos.montoTotalLTV > 0 ? `💎 LTV histórico de este grupo: <strong>${fmtMoney(g.inactivos.montoTotalLTV)}</strong>` : null,
                subgrupos: [
                    { key: 'tibio',     clase: 'sub-tibio',     icono: 'fa-cloud',     titulo: 'Tibio',     desc: '180-365 días — recordatorio suave' },
                    { key: 'frio',      clase: 'sub-frio',      icono: 'fa-icicles',   titulo: 'Frío',      desc: '1-2 años — 15% descuento' },
                    { key: 'hibernado', clase: 'sub-hibernado', icono: 'fa-igloo',     titulo: 'Hibernado', desc: '+2 años — 25% descuento, última bala' }
                ]
            })
        ].join('');

        audienciasGrid.innerHTML = html;

        // Footer
        document.getElementById('footerNoMolestar').textContent = data.noMolestar || 0;
        document.getElementById('footerCooldown').textContent = data.enCooldownGlobal || 0;
        audienciasFooter.style.display = 'flex';

        // Total de contactos en el CRM
        const totalEl = document.getElementById('totalContactos');
        if (totalEl) totalEl.textContent = (data.totalContactos || 0).toLocaleString('es-MX');
    }

    function cardSimple({ clase, icono, titulo, hint, grupo, grupoKey, extra }) {
        const cell = (estado, num, emoji, lbl, hintTxt) => {
            const clickable = num > 0;
            return `<div class="estado-cell estado-${estado} ${clickable ? 'clickable' : ''}"
                        ${clickable ? `onclick="verDetalle('${grupoKey}', null, '${estado}', '${titulo.replace(/'/g, '')}')"` : ''}>
                        <div class="estado-num">${num}</div>
                        <div class="estado-lbl">${emoji} ${lbl}</div>
                        <div class="estado-hint">${clickable ? '👁 ver lista' : hintTxt}</div>
                    </div>`;
        };
        return `
            <div class="audiencia-card audiencia-card-${clase}">
                <div class="audiencia-header">
                    <div class="audiencia-icon"><i class="fas ${icono}"></i></div>
                    <div class="audiencia-titulo">
                        <h2>${titulo}</h2>
                        <p>${hint}</p>
                    </div>
                    <div class="audiencia-total">
                        <div class="num">${grupo.total || 0}</div>
                        <div class="lbl">personas</div>
                    </div>
                </div>
                <div class="estados-grid">
                    ${cell('limbo', grupo.limbo || 0, '⏳', 'Limbo', 'en cuarentena')}
                    ${cell('listos', grupo.listos || 0, '🎯', 'Listos', 'para contactar')}
                    ${cell('contactados', grupo.contactados || 0, '✉', 'Contactados', 'esperando respuesta')}
                </div>
                ${extra ? `<div class="audiencia-extra">${extra}</div>` : ''}
            </div>
        `;
    }

    function cardSubgrupos({ clase, icono, titulo, hint, grupo, grupoKey, subgrupos, extra }) {
        return `
            <div class="audiencia-card audiencia-card-${clase} has-subgrupos">
                <div class="audiencia-header">
                    <div class="audiencia-icon"><i class="fas ${icono}"></i></div>
                    <div class="audiencia-titulo">
                        <h2>${titulo}</h2>
                        <p>${hint}</p>
                    </div>
                    <div class="audiencia-total">
                        <div class="num">${grupo.total || 0}</div>
                        <div class="lbl">personas</div>
                    </div>
                </div>
                <div class="subgrupos-row">
                    ${subgrupos.map(s => {
                        const sg = grupo[s.key] || { total: 0, listos: 0, contactados: 0 };
                        const listosClick = sg.listos > 0 ? `onclick="verDetalle('${grupoKey}', '${s.key}', 'listos', '${(titulo + ' · ' + s.titulo).replace(/'/g, '')}')"` : '';
                        const contClick = sg.contactados > 0 ? `onclick="verDetalle('${grupoKey}', '${s.key}', 'contactados', '${(titulo + ' · ' + s.titulo).replace(/'/g, '')}')"` : '';
                        return `
                            <div class="subgrupo-cell ${s.clase}">
                                <h3><i class="fas ${s.icono}"></i> ${s.titulo}</h3>
                                <div class="sub-total">${sg.total}</div>
                                <div class="sub-desc">${s.desc}</div>
                                <div class="sub-states">
                                    <span class="sub-state-listos ${sg.listos > 0 ? 'clickable' : ''}" ${listosClick}>🎯 ${sg.listos} listos</span>
                                    <span class="sub-state-contactados ${sg.contactados > 0 ? 'clickable' : ''}" ${contClick}>✉ ${sg.contactados} contactados</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                ${extra ? `<div class="audiencia-extra">${extra}</div>` : ''}
            </div>
        `;
    }

    // --- Modal de detalle (lista de personas) ---
    let detallePersonasActual = [];

    window.verDetalle = async (grupo, sub, estado, tituloLegible) => {
        const modal = document.getElementById('modalDetalle');
        const body = document.getElementById('modalDetalleBody');
        const titulo = document.getElementById('modalDetalleTitulo');
        const estadoLabel = { limbo: '⏳ Limbo', listos: '🎯 Listos', contactados: '✉ Contactados' }[estado] || estado;
        titulo.innerHTML = `<i class="fas fa-list"></i> ${tituloLegible} — ${estadoLabel}`;
        document.getElementById('detalleBuscar').value = '';
        modal.style.display = 'flex';
        body.innerHTML = '<div class="detalle-loading"><i class="fas fa-spinner fa-spin"></i> Cargando lista...</div>';

        try {
            const token = await auth.currentUser.getIdToken();
            const params = new URLSearchParams({ grupo, estado });
            if (sub) params.set('sub', sub);
            if (filtroFrom) params.set('from', String(filtroFrom));
            if (filtroTo) params.set('to', String(filtroTo));
            const res = await fetch(`/api/audiencias/detalle?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error');
            detallePersonasActual = data.personas || [];
            renderDetalle(detallePersonasActual);
        } catch (e) {
            body.innerHTML = `<div class="detalle-error"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
        }
    };

    function renderDetalle(personas) {
        const body = document.getElementById('modalDetalleBody');
        if (!personas.length) {
            body.innerHTML = '<div class="detalle-vacio">Sin resultados.</div>';
            return;
        }
        const fmtFecha = (ms) => ms ? new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
        const tieneOrden = personas.some(p => p.orderNumber);
        const rows = personas.map((p, i) => `
            <tr>
                <td class="td-idx">${i + 1}</td>
                ${tieneOrden ? `<td class="td-orden">${p.orderNumber || '—'}</td>` : ''}
                <td class="td-tel">${p.phone || '—'}</td>
                ${p.name !== undefined ? `<td class="td-nombre">${p.name || '<span class="muted">sin nombre</span>'}</td>` : ''}
                ${p.compras !== undefined ? `<td class="td-compras">${p.compras}</td>` : ''}
                ${p.producto !== undefined ? `<td class="td-prod">${p.producto || '—'}</td>` : ''}
                ${p.amount !== undefined ? `<td class="td-monto">${p.amount ? '$' + Number(p.amount).toLocaleString('es-MX', {maximumFractionDigits:0}) : '—'}</td>` : ''}
                <td class="td-fecha">${fmtFecha(p.dateMs)}${p.diasDesdeCompra ? ` <span class="muted">(${p.diasDesdeCompra}d)</span>` : ''}</td>
            </tr>
        `).join('');
        body.innerHTML = `
            <div class="detalle-resumen">${personas.length} persona(s)</div>
            <table class="detalle-tabla">
                <thead>
                    <tr>
                        <th>#</th>
                        ${tieneOrden ? '<th>Pedido</th>' : ''}
                        <th>Teléfono</th>
                        ${personas[0].name !== undefined ? '<th>Nombre</th>' : ''}
                        ${personas[0].compras !== undefined ? '<th>Compras</th>' : ''}
                        ${personas[0].producto !== undefined ? '<th>Producto</th>' : ''}
                        ${personas[0].amount !== undefined ? '<th>Monto</th>' : ''}
                        <th>Fecha</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    window.filtrarDetalle = () => {
        const q = document.getElementById('detalleBuscar').value.toLowerCase().trim();
        if (!q) { renderDetalle(detallePersonasActual); return; }
        const filtradas = detallePersonasActual.filter(p =>
            (p.orderNumber && p.orderNumber.toLowerCase().includes(q)) ||
            (p.phone && p.phone.includes(q)) ||
            (p.name && p.name.toLowerCase().includes(q))
        );
        renderDetalle(filtradas);
    };

    window.copiarTelefonos = () => {
        const tels = detallePersonasActual.map(p => p.phone).filter(Boolean).join('\n');
        navigator.clipboard.writeText(tels).then(() => {
            const btn = document.querySelector('.btn-copiar');
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> ¡Copiado!';
            setTimeout(() => { btn.innerHTML = orig; }, 1500);
        });
    };

    window.cerrarDetalle = (event) => {
        if (event && event.target !== event.currentTarget) return;
        document.getElementById('modalDetalle').style.display = 'none';
    };

    // --- Censo: Resumen de tu base (parte TODOS los contactos, la suma da el total) ---
    const CENSO_DEFS = {
        compraron1vez: { icon: 'fa-user-check', titulo: 'Compraron 1 vez', desc: 'Una sola compra — empujar la segunda', clase: 'censo-c1' },
        recurrentes:   { icon: 'fa-crown',      titulo: 'Recurrentes',      desc: '2+ compras — tus mejores clientes', clase: 'censo-rec' },
        nuncaActivos:  { icon: 'fa-comment-dots', titulo: 'Nunca compraron · activos', desc: 'Escribieron hace poco, sin comprar', clase: 'censo-act' },
        nuncaFrios:    { icon: 'fa-snowflake',  titulo: 'Nunca compraron · fríos', desc: 'Leads viejos sin compra — reactivar por lotes', clase: 'censo-frio' }
    };

    async function cargarCenso() {
        const cont = document.getElementById('censoCards');
        cont.innerHTML = '<div class="audiencias-loading"><i class="fas fa-spinner fa-spin"></i> Calculando tu base…</div>';
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/audiencias/censo', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error al calcular el censo');
            renderCenso(data);
        } catch (e) {
            cont.innerHTML = `<div class="audiencias-error"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
        }
    }

    function renderCenso(data) {
        const c = data.counts || {};
        const orden = ['compraron1vez', 'recurrentes', 'nuncaActivos', 'nuncaFrios'];
        document.getElementById('censoCards').innerHTML = orden.map(key => {
            const def = CENSO_DEFS[key];
            const num = c[key] || 0;
            return `
                <div class="censo-card ${def.clase}" onclick="verCensoDetalle('${key}', '${def.titulo.replace(/'/g, '')}')">
                    <div class="censo-card-icon"><i class="fas ${def.icon}"></i></div>
                    <div class="censo-card-num">${num.toLocaleString('es-MX')}</div>
                    <div class="censo-card-titulo">${def.titulo}</div>
                    <div class="censo-card-desc">${def.desc}</div>
                    <div class="censo-card-ver">👁 ver lista</div>
                </div>`;
        }).join('');
        const footer = document.getElementById('censoFooter');
        footer.style.display = 'block';
        footer.innerHTML = `<i class="fas fa-equals"></i> Suman <strong>${(data.total || 0).toLocaleString('es-MX')}</strong> contactos &middot; <i class="fas fa-ban"></i> ${(data.noMolestar || 0).toLocaleString('es-MX')} en No Molestar &middot; activo = mensaje en los últimos ${data.activoDias || 30} días`;
    }

    window.verCensoDetalle = async (bucket, tituloLegible) => {
        const modal = document.getElementById('modalDetalle');
        const body = document.getElementById('modalDetalleBody');
        const titulo = document.getElementById('modalDetalleTitulo');
        titulo.innerHTML = `<i class="fas fa-list"></i> ${tituloLegible}`;
        document.getElementById('detalleBuscar').value = '';
        modal.style.display = 'flex';
        body.innerHTML = '<div class="detalle-loading"><i class="fas fa-spinner fa-spin"></i> Cargando lista…</div>';
        try {
            const token = await auth.currentUser.getIdToken();
            const params = new URLSearchParams({ bucket });
            if (filtroFrom) params.set('from', String(filtroFrom));
            if (filtroTo) params.set('to', String(filtroTo));
            const res = await fetch(`/api/audiencias/censo/detalle?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error');
            detallePersonasActual = data.personas || [];
            renderDetalle(detallePersonasActual);
        } catch (e) {
            body.innerHTML = `<div class="detalle-error"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
        }
    };

    // --- Gráfica de mensajes recibidos por día / mes / año ---
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    let seriesRaw = [];
    let granularidadActual = 'day';
    let mensajesChartInstance = null;

    const fmtDiaLabel = (s) => { const p = s.split('-'); return `${parseInt(p[2])} ${MESES[parseInt(p[1]) - 1]}`; };
    const fmtMesLabel = (s) => { const p = s.split('-'); return `${MESES[parseInt(p[1]) - 1]} ${p[0].slice(2)}`; };

    function bucketSeries(raw, gran) {
        if (gran === 'day') {
            const recientes = raw.slice(-60);
            return { labels: recientes.map(d => fmtDiaLabel(d.date)), values: recientes.map(d => d.total) };
        }
        const map = new Map();
        for (const d of raw) {
            const key = gran === 'month' ? d.date.slice(0, 7) : d.date.slice(0, 4);
            map.set(key, (map.get(key) || 0) + d.total);
        }
        let entries = [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
        if (gran === 'month') entries = entries.slice(-18);
        return {
            labels: entries.map(([k]) => gran === 'month' ? fmtMesLabel(k) : k),
            values: entries.map(([, v]) => v)
        };
    }

    async function cargarMensajesChart() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/metrics/series', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) return;
            seriesRaw = data.data || [];
            document.getElementById('chartSection').style.display = 'block';
            renderMensajesChart();
        } catch (e) {
            console.error('No se pudo cargar la gráfica de mensajes:', e.message);
        }
    }

    window.setGranularidad = (g) => {
        granularidadActual = g;
        document.querySelectorAll('#chartToggle button').forEach(b => b.classList.toggle('activo', b.dataset.gran === g));
        renderMensajesChart();
    };

    function renderMensajesChart() {
        const canvas = document.getElementById('mensajesChart');
        const vacio = document.getElementById('chartVacio');
        if (!seriesRaw.length || !seriesRaw.some(d => d.total > 0)) {
            canvas.style.display = 'none';
            vacio.style.display = 'block';
            return;
        }
        canvas.style.display = 'block';
        vacio.style.display = 'none';
        const { labels, values } = bucketSeries(seriesRaw, granularidadActual);
        const esLinea = granularidadActual === 'day';
        if (mensajesChartInstance) mensajesChartInstance.destroy();
        mensajesChartInstance = new Chart(canvas.getContext('2d'), {
            type: esLinea ? 'line' : 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Mensajes recibidos',
                    data: values,
                    backgroundColor: esLinea ? 'rgba(22,163,74,0.12)' : 'rgba(22,163,74,0.75)',
                    borderColor: '#16a34a',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: esLinea,
                    pointRadius: esLinea ? 0 : undefined,
                    pointHoverRadius: 4,
                    borderRadius: 6,
                    maxBarThickness: 48
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (c) => `${c.parsed.y.toLocaleString('es-MX')} mensajes` } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 11 } } },
                    y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 } }, grid: { color: '#f3f4f6' } }
                }
            }
        });
    }

    // Cerrar modal con tecla Esc
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('modalDetalle');
            if (modal && modal.style.display === 'flex') {
                modal.style.display = 'none';
            }
        }
    });
});
