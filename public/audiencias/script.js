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
                icono: 'fa-credit-card',
                titulo: 'Sin Pagar',
                hint: 'Tienen pedido pero no han pagado',
                grupo: g.sinPagar,
                extra: g.sinPagar.montoTotal > 0 ? `💰 <strong>${fmtMoney(g.sinPagar.montoTotal)}</strong> por cobrar` : null
            }),
            cardSimple({
                clase: 'sin-datos',
                icono: 'fa-box',
                titulo: 'Sin Datos de Envío',
                hint: 'Pagaron pero no tenemos su dirección',
                grupo: g.sinDatos
            }),
            cardSimple({
                clase: 'en-visto',
                icono: 'fa-eye',
                titulo: 'En Visto',
                hint: 'Leyeron nuestro mensaje, no contestaron y no tienen pedido',
                grupo: g.enVisto
            }),
            cardSubgrupos({
                clase: 'recompra',
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
    }

    function cardSimple({ clase, icono, titulo, hint, grupo, extra }) {
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
                    <div class="estado-cell estado-limbo">
                        <div class="estado-num">${grupo.limbo || 0}</div>
                        <div class="estado-lbl">⏳ Limbo</div>
                        <div class="estado-hint">en cuarentena</div>
                    </div>
                    <div class="estado-cell estado-listos">
                        <div class="estado-num">${grupo.listos || 0}</div>
                        <div class="estado-lbl">🎯 Listos</div>
                        <div class="estado-hint">para contactar</div>
                    </div>
                    <div class="estado-cell estado-contactados">
                        <div class="estado-num">${grupo.contactados || 0}</div>
                        <div class="estado-lbl">✉ Contactados</div>
                        <div class="estado-hint">esperando respuesta</div>
                    </div>
                </div>
                ${extra ? `<div class="audiencia-extra">${extra}</div>` : ''}
            </div>
        `;
    }

    function cardSubgrupos({ clase, icono, titulo, hint, grupo, subgrupos, extra }) {
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
                        return `
                            <div class="subgrupo-cell ${s.clase}">
                                <h3><i class="fas ${s.icono}"></i> ${s.titulo}</h3>
                                <div class="sub-total">${sg.total}</div>
                                <div class="sub-desc">${s.desc}</div>
                                <div class="sub-states">
                                    <span class="sub-state-listos">🎯 ${sg.listos} listos</span>
                                    <span class="sub-state-contactados">✉ ${sg.contactados} contactados</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                ${extra ? `<div class="audiencia-extra">${extra}</div>` : ''}
            </div>
        `;
    }
});
