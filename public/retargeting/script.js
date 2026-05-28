import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

document.addEventListener('DOMContentLoaded', () => {

    const firebaseConfig = {
        apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
        authDomain: "pedidos-con-gemini.firebaseapp.com",
        projectId: "pedidos-con-gemini",
        storageBucket: "pedidos-con-gemini.firebasestorage.app",
        messagingSenderId: "300825194175",
        appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
        measurementId: "G-FTCDCMZB1S"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);

    // DOM
    const loadingOverlay = document.getElementById('loading-overlay');
    const seccionLogin = document.getElementById('seccionLogin');
    const seccionRetargeting = document.getElementById('seccionRetargeting');
    const formularioLogin = document.getElementById('formularioLogin');
    const mensajeError = document.getElementById('mensajeError');
    const usuarioLogueado = document.getElementById('usuarioLogueado');
    const instruccionesTA = document.getElementById('instruccionesIA');
    const resultadosBox = document.getElementById('resultadosBox');
    const listaPedidos = document.getElementById('listaPedidos');
    const totalPedidosSpan = document.getElementById('totalPedidos');
    const btnEnviar = document.getElementById('btnEnviarRetargeting');
    const btnBuscar = document.getElementById('btnBuscarPedidos');
    const btnActualizar = document.getElementById('btnActualizar');
    const cacheInfo = document.getElementById('cacheInfo');
    const progresoBox = document.getElementById('progresoBox');
    const progressBar = document.getElementById('progressBar');
    const progresoTexto = document.getElementById('progresoTexto');
    const logRetargeting = document.getElementById('logRetargeting');

    let pedidosEncontrados = [];
    let pedidosSeleccionados = new Set();
    let satisfactionFilter = ''; // '' | 'positivo' | 'neutral' | 'negativo' | 'sin_senal' | 'sin_clasificar'
    let sortOrder = 'fecha-desc'; // 'fecha-desc' | 'fecha-asc' | 'precio-desc' | 'precio-asc'
    let ocultarYaEnviados = false;
    let modoEnvio = 'ia'; // 'ia' | 'plantilla'
    let plantillasDisponibles = []; // [{ name, language, components }, ...]
    let plantillaSeleccionada = null;
    let plantillaMediaUrl = null; // URL de la imagen/video/documento subido para esta tanda
    let plantillaMediaSubiendo = false;

    const MEDIA_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT'];
    const MEDIA_ICONS = { IMAGE: 'image', VIDEO: 'video', DOCUMENT: 'file-pdf' };
    const MEDIA_LABELS = { IMAGE: 'imagen', VIDEO: 'video', DOCUMENT: 'documento (PDF)' };
    const MEDIA_ACCEPT = { IMAGE: 'image/*', VIDEO: 'video/mp4,video/3gp,video/quicktime', DOCUMENT: 'application/pdf' };

    function plantillaMediaFormat(t) {
        const header = t?.components?.find(c => c.type === 'HEADER');
        return MEDIA_FORMATS.includes(header?.format) ? header.format : null;
    }

    const SATISFACTION_LABELS = {
        positivo: 'Positivo',
        neutral: 'Neutral',
        negativo: 'Negativo',
        sin_senal: 'Sin señal',
        sin_clasificar: 'Sin clasificar'
    };

    function getOrderLevel(p) {
        return p.satisfactionLevel || 'sin_clasificar';
    }

    function getOrderPrice(p) {
        const n = parseFloat(p.precio);
        return isNaN(n) ? 0 : n;
    }

    function formatPrice(p) {
        const n = getOrderPrice(p);
        if (!n) return '—';
        return '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
    }

    function getOrderDateMs(p) {
        return p.createdAt ? new Date(p.createdAt).getTime() : 0;
    }

    function yaRecibioRetargeting(p) {
        return !!p.lastRetargetingDate;
    }

    function pedidoCoincideFiltro(p) {
        if (ocultarYaEnviados && yaRecibioRetargeting(p)) return false;
        if (!satisfactionFilter) return true;
        return getOrderLevel(p) === satisfactionFilter;
    }

    function aplicarOrden(arr) {
        const copy = arr.slice();
        switch (sortOrder) {
            case 'fecha-asc':
                copy.sort((a, b) => getOrderDateMs(a) - getOrderDateMs(b));
                break;
            case 'precio-desc':
                copy.sort((a, b) => getOrderPrice(b) - getOrderPrice(a));
                break;
            case 'precio-asc':
                copy.sort((a, b) => getOrderPrice(a) - getOrderPrice(b));
                break;
            case 'fecha-desc':
            default:
                copy.sort((a, b) => getOrderDateMs(b) - getOrderDateMs(a));
                break;
        }
        return copy;
    }

    window.setSortOrder = (value) => {
        sortOrder = value || 'fecha-desc';
        renderPedidos();
    };

    window.toggleOcultarYaEnviados = (checked) => {
        ocultarYaEnviados = !!checked;
        renderPedidos();
    };

    // --- Cache local (sin estarlos llamando cada vez) ---
    const CACHE_KEY = 'retargeting:pedidos:v2';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

    function loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed.fetchedAt || !Array.isArray(parsed.orders)) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function saveCache(orders, inicio, fin) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                fetchedAt: Date.now(),
                inicio, fin, orders
            }));
        } catch (e) {
            console.warn('No se pudo guardar cache:', e);
        }
    }

    function clearCache() {
        try { localStorage.removeItem(CACHE_KEY); } catch {}
    }

    function formatRelativeTime(ms) {
        const diff = Date.now() - ms;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'hace unos segundos';
        if (mins < 60) return `hace ${mins} min`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `hace ${hrs} h`;
        const days = Math.floor(hrs / 24);
        return `hace ${days} d`;
    }

    function updateCacheInfoUI(cache, serverInfo) {
        if (!cache) {
            cacheInfo.textContent = '';
            cacheInfo.className = 'cache-info';
            btnActualizar.style.display = 'none';
            return;
        }
        const age = Date.now() - cache.fetchedAt;
        const fresh = age < CACHE_TTL_MS;
        let originText = '';
        if (serverInfo && serverInfo.fromServerCache) {
            originText = ` · caché del servidor (${formatRelativeTime(Date.now() - serverInfo.serverCacheAgeMs)})`;
        }
        cacheInfo.textContent = `Última carga: ${formatRelativeTime(cache.fetchedAt)} (${cache.inicio} → ${cache.fin})${fresh ? '' : ' · expirada'}${originText}`;
        cacheInfo.className = 'cache-info ' + (fresh ? 'fresh' : 'stale');
        btnActualizar.style.display = 'inline-flex';
    }

    // --- Auth ---
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
            seccionRetargeting.style.display = 'block';
            usuarioLogueado.textContent = user.email;
            await cargarInstrucciones();
            cargarPlantillas(false);
            restaurarDesdeCache();
            cargarCampanas(false);
        } else {
            seccionLogin.style.display = 'block';
            seccionRetargeting.style.display = 'none';
        }
    });

    // --- Modo de envio ---
    window.setModoEnvio = (modo) => {
        modoEnvio = modo === 'plantilla' ? 'plantilla' : 'ia';
        document.getElementById('seccionInstrucciones').style.display = modoEnvio === 'ia' ? 'block' : 'none';
        document.getElementById('seccionPlantilla').style.display = modoEnvio === 'plantilla' ? 'block' : 'none';
        actualizarBotonEnviar();
    };

    // --- Plantillas de Meta ---
    const PLANTILLAS_CACHE_KEY = 'retargeting:plantillas:v3';
    const PLANTILLAS_TTL_MS = 60 * 60 * 1000; // 1h

    window.cargarPlantillas = async (forceRefresh) => {
        const select = document.getElementById('plantillaSelect');
        try {
            if (!forceRefresh) {
                const raw = localStorage.getItem(PLANTILLAS_CACHE_KEY);
                if (raw) {
                    const cached = JSON.parse(raw);
                    if (Date.now() - cached.cachedAt < PLANTILLAS_TTL_MS && Array.isArray(cached.templates)) {
                        plantillasDisponibles = cached.templates;
                        renderPlantillasSelect();
                        return;
                    }
                }
            }
            select.innerHTML = '<option value="">Cargando plantillas...</option>';
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/whatsapp-templates', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error al cargar plantillas');
            plantillasDisponibles = data.templates || [];
            localStorage.setItem(PLANTILLAS_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), templates: plantillasDisponibles }));
            renderPlantillasSelect();
        } catch (e) {
            console.error('Error cargando plantillas:', e);
            select.innerHTML = `<option value="">Error: ${e.message}</option>`;
        }
    };

    function renderPlantillasSelect() {
        const select = document.getElementById('plantillaSelect');
        if (!plantillasDisponibles.length) {
            select.innerHTML = '<option value="">No hay plantillas aprobadas (solo texto)</option>';
            return;
        }
        select.innerHTML = '<option value="">Selecciona una plantilla...</option>' +
            plantillasDisponibles.map(t => {
                const mediaFmt = plantillaMediaFormat(t);
                const tag = mediaFmt ? ` 📎${MEDIA_LABELS[mediaFmt]}` : '';
                return `<option value="${t.name}">${t.name} (${t.language})${tag}</option>`;
            }).join('');
    }

    window.onPlantillaChange = () => {
        const select = document.getElementById('plantillaSelect');
        const name = select.value;
        plantillaSeleccionada = plantillasDisponibles.find(t => t.name === name) || null;
        plantillaMediaUrl = null; // reset media al cambiar plantilla
        const previewBox = document.getElementById('plantillaPreview');
        if (!plantillaSeleccionada) {
            previewBox.style.display = 'none';
            previewBox.innerHTML = '';
            actualizarBotonEnviar();
            return;
        }
        const header = plantillaSeleccionada.components?.find(c => c.type === 'HEADER');
        const body = plantillaSeleccionada.components?.find(c => c.type === 'BODY');
        const footer = plantillaSeleccionada.components?.find(c => c.type === 'FOOTER');
        const buttons = plantillaSeleccionada.components?.find(c => c.type === 'BUTTONS');
        const mediaFmt = plantillaMediaFormat(plantillaSeleccionada);
        const parts = [];
        if (mediaFmt) {
            parts.push(`
                <div class="plantilla-media-block">
                    <label class="plantilla-media-label">
                        <i class="fas fa-${MEDIA_ICONS[mediaFmt]}"></i> Esta plantilla requiere ${MEDIA_LABELS[mediaFmt]}. Sube el archivo (se usará para todos los contactos seleccionados).
                    </label>
                    <input type="file" id="plantillaMediaFile" accept="${MEDIA_ACCEPT[mediaFmt]}" onchange="onPlantillaMediaSelected(event)">
                    <div id="plantillaMediaStatus" class="plantilla-media-status"></div>
                </div>
            `);
        }
        if (header?.text) parts.push(`<div class="plantilla-header">${header.text.replace(/\{\{1\}\}/g, '<em>[Nombre]</em>')}</div>`);
        if (body?.text) parts.push(`<div class="plantilla-body">${body.text.replace(/\{\{1\}\}/g, '<em>[Nombre]</em>').replace(/\{\{(\d+)\}\}/g, '<em>[var $1]</em>').replace(/\n/g, '<br>')}</div>`);
        if (footer?.text) parts.push(`<div class="plantilla-footer">${footer.text}</div>`);
        if (buttons?.buttons?.length) {
            parts.push('<div class="plantilla-buttons">' + buttons.buttons.map(b => `<span class="plantilla-button">${b.text || b.type}</span>`).join('') + '</div>');
        }
        previewBox.innerHTML = parts.join('') || '<em>(plantilla sin contenido)</em>';
        previewBox.style.display = 'block';
        actualizarBotonEnviar();
    };

    window.onPlantillaMediaSelected = async (event) => {
        const file = event.target.files?.[0];
        const statusEl = document.getElementById('plantillaMediaStatus');
        if (!file) {
            plantillaMediaUrl = null;
            if (statusEl) statusEl.innerHTML = '';
            actualizarBotonEnviar();
            return;
        }
        plantillaMediaSubiendo = true;
        plantillaMediaUrl = null;
        actualizarBotonEnviar();
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...';
        try {
            const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
            const path = `template-media/${Date.now()}_${safeName}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, file, { contentType: file.type });
            plantillaMediaUrl = await getDownloadURL(ref);
            if (statusEl) statusEl.innerHTML = `<i class="fas fa-check-circle" style="color:#16a34a;"></i> ${file.name} listo.`;
        } catch (e) {
            console.error('Error subiendo media:', e);
            if (statusEl) statusEl.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#dc2626;"></i> Error: ${e.message}`;
        } finally {
            plantillaMediaSubiendo = false;
            actualizarBotonEnviar();
        }
    };

    window.cerrarSesion = () => signOut(auth);

    // --- Instrucciones (persistidas en Firestore como en cobranza) ---
    async function cargarInstrucciones() {
        try {
            const docSnap = await getDoc(doc(db, 'crm_settings', 'bot_retargeting'));
            if (docSnap.exists() && docSnap.data().instructions) {
                instruccionesTA.value = docSnap.data().instructions;
            }
        } catch (e) {
            console.error('Error cargando instrucciones:', e);
        }
    }

    window.guardarInstrucciones = async () => {
        try {
            await setDoc(doc(db, 'crm_settings', 'bot_retargeting'), {
                instructions: instruccionesTA.value
            }, { merge: true });
            alert('Instrucciones guardadas.');
        } catch (e) {
            console.error('Error guardando instrucciones:', e);
            alert('Error al guardar.');
        }
    };

    // --- Date pickers (default: últimos 30 días) ---
    const hoy = new Date();
    const hace30 = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ymd = (d) => d.toISOString().slice(0, 10);

    flatpickr('#fechaInicio', { locale: 'es', dateFormat: 'Y-m-d', defaultDate: ymd(hace30) });
    flatpickr('#fechaFin', { locale: 'es', dateFormat: 'Y-m-d', defaultDate: ymd(hoy) });

    // --- Restaurar desde cache si existe ---
    function restaurarDesdeCache() {
        const cache = loadCache();
        if (!cache) return;
        // Restaurar también las fechas del último query
        document.getElementById('fechaInicio')._flatpickr.setDate(cache.inicio);
        document.getElementById('fechaFin')._flatpickr.setDate(cache.fin);
        pedidosEncontrados = cache.orders;
        renderPedidos();
        updateCacheInfoUI(cache);
    }

    // --- Buscar pedidos ---
    window.buscarPedidos = async (forceRefresh) => {
        const inicio = document.getElementById('fechaInicio').value;
        const fin = document.getElementById('fechaFin').value;
        if (!inicio || !fin) { alert('Selecciona ambas fechas.'); return; }

        // Si hay cache válida y mismas fechas y NO se forzó refresh, usar cache
        if (!forceRefresh) {
            const cache = loadCache();
            const ageOk = cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS;
            if (cache && ageOk && cache.inicio === inicio && cache.fin === fin) {
                pedidosEncontrados = cache.orders;
                renderPedidos();
                updateCacheInfoUI(cache);
                return;
            }
        }

        const startDate = new Date(inicio + 'T00:00:00');
        const endDate = new Date(fin + 'T23:59:59.999');

        btnBuscar.disabled = true;
        btnActualizar.disabled = true;
        const originalBuscarText = btnBuscar.innerHTML;
        btnBuscar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando...';

        try {
            const token = await auth.currentUser.getIdToken();
            const url = `/api/retargeting/buscar-pedidos?startDate=${startDate.getTime()}&endDate=${endDate.getTime()}${forceRefresh ? '&fresh=1' : ''}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error al buscar pedidos');

            pedidosEncontrados = data.orders || [];
            saveCache(pedidosEncontrados, inicio, fin);
            renderPedidos();
            updateCacheInfoUI(loadCache(), { fromServerCache: data.fromCache, serverCacheAgeMs: data.cacheAgeMs });
        } catch (e) {
            alert('Error buscando pedidos: ' + e.message);
        } finally {
            btnBuscar.disabled = false;
            btnActualizar.disabled = false;
            btnBuscar.innerHTML = originalBuscarText;
        }
    };

    function actualizarContadoresFiltro() {
        const counts = { all: pedidosEncontrados.length, positivo: 0, neutral: 0, negativo: 0, sin_senal: 0, sin_clasificar: 0 };
        for (const p of pedidosEncontrados) {
            const lv = getOrderLevel(p);
            if (counts[lv] !== undefined) counts[lv]++;
        }
        const elAll = document.getElementById('cntFilterAll');
        const elPos = document.getElementById('cntFilterPositivo');
        const elNeu = document.getElementById('cntFilterNeutral');
        const elNeg = document.getElementById('cntFilterNegativo');
        const elSS = document.getElementById('cntFilterSinSenal');
        const elSC = document.getElementById('cntFilterSinClasificar');
        if (elAll) elAll.textContent = counts.all;
        if (elPos) elPos.textContent = counts.positivo;
        if (elNeu) elNeu.textContent = counts.neutral;
        if (elNeg) elNeg.textContent = counts.negativo;
        if (elSS) elSS.textContent = counts.sin_senal;
        if (elSC) elSC.textContent = counts.sin_clasificar;
    }

    window.setSatisfactionFilter = (level) => {
        satisfactionFilter = level || '';
        document.querySelectorAll('.filtros-chips .chip').forEach(c => {
            c.classList.toggle('chip-active', (c.getAttribute('data-level') || '') === satisfactionFilter);
        });
        renderPedidos();
    };

    function renderPedidos() {
        resultadosBox.style.display = 'block';
        totalPedidosSpan.textContent = pedidosEncontrados.length;
        actualizarContadoresFiltro();

        if (pedidosEncontrados.length === 0) {
            listaPedidos.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">No hay pedidos con estatus Pagado en este rango.</div>';
            pedidosSeleccionados.clear();
            actualizarBotonEnviar();
            return;
        }

        const pedidosVisibles = aplicarOrden(pedidosEncontrados.filter(pedidoCoincideFiltro));

        // Limpiar seleccion de pedidos que ya no son visibles (cambio de filtro)
        const idsVisibles = new Set(pedidosVisibles.map(p => p.id));
        for (const id of [...pedidosSeleccionados]) {
            if (!idsVisibles.has(id)) pedidosSeleccionados.delete(id);
        }

        // Seleccionar por default los visibles no enviados hoy que aun no se hubieran tocado
        for (const p of pedidosVisibles) {
            if (!p.retargetadoHoy) pedidosSeleccionados.add(p.id);
        }

        if (pedidosVisibles.length === 0) {
            const motivo = ocultarYaEnviados && !satisfactionFilter
                ? 'Ningún pedido pendiente de retargeting en este rango.'
                : `Ningún pedido coincide con el filtro <strong>${SATISFACTION_LABELS[satisfactionFilter] || 'actual'}</strong>.`;
            listaPedidos.innerHTML = `<div style="padding:20px;text-align:center;color:#999;">${motivo}</div>`;
            actualizarBotonEnviar();
            return;
        }

        const seleccionablesVisibles = pedidosVisibles.filter(p => !p.retargetadoHoy).length;
        const seleccionadosVisibles = pedidosVisibles.filter(p => pedidosSeleccionados.has(p.id)).length;
        const allChecked = seleccionablesVisibles > 0 && seleccionadosVisibles === seleccionablesVisibles;

        const tieneFiltroVisible = !!satisfactionFilter || ocultarYaEnviados;

        listaPedidos.innerHTML = `
            <div class="select-all-row">
                <label>
                    <input type="checkbox" id="selectAll" ${allChecked ? 'checked' : ''} onchange="toggleSelectAll(this.checked)">
                    <strong>Seleccionar todos (${pedidosVisibles.length}${tieneFiltroVisible ? ' del filtro' : ''})</strong>
                </label>
                <span id="contadorSeleccionados">${pedidosSeleccionados.size} seleccionados</span>
            </div>
            <div class="pedido-header">
                <span class="col-check"></span>
                <span class="col-indice">#</span>
                <span class="col-pedido">Pedido</span>
                <span class="col-producto">Producto</span>
                <span class="col-fecha">Fecha</span>
                <span class="col-estatus">Estatus</span>
                <span class="col-precio">Precio</span>
                <span class="col-satisfaccion">Satisfacci&oacute;n</span>
                <span class="col-retargeting">Retargeting</span>
                <span class="col-telefono">Tel&eacute;fono</span>
            </div>
        ` + pedidosVisibles.map((p, idx) => {
            const lv = getOrderLevel(p);
            const lvLabel = SATISFACTION_LABELS[lv] || lv;
            const isChecked = pedidosSeleccionados.has(p.id) && !p.retargetadoHoy;
            const yaEnviado = yaRecibioRetargeting(p);
            const retargetingCell = p.retargetadoHoy
                ? '<span class="badge-enviado">Enviado Hoy</span>'
                : (yaEnviado
                    ? `<span class="badge-ya-enviado" title="Última vez: ${p.lastRetargetingDate}"><i class="fas fa-history"></i> ${p.lastRetargetingDate}</span>`
                    : '<span class="muted">—</span>');
            return `
            <div class="pedido-row ${p.retargetadoHoy ? 'enviado' : ''} ${yaEnviado && !p.retargetadoHoy ? 'historico' : ''}">
                <input type="checkbox" class="col-check pedido-check" data-id="${p.id}" ${p.retargetadoHoy ? 'disabled' : (isChecked ? 'checked' : '')} onchange="togglePedido('${p.id}', this.checked)">
                <span class="col-indice">#${idx + 1}</span>
                <span class="col-pedido pedido-numero">DH${p.consecutiveOrderNumber || '?'}</span>
                <span class="col-producto pedido-producto" title="${(p.producto || 'Sin producto').replace(/"/g, '&quot;')}">${p.producto || 'Sin producto'}</span>
                <span class="col-fecha pedido-fecha">${p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : ''}</span>
                <span class="col-estatus"><span class="pedido-estatus">${p.estatus || 'Pagado'}</span></span>
                <span class="col-precio pedido-precio">${formatPrice(p)}</span>
                <span class="col-satisfaccion"><span class="badge-nivel badge-${lv}">${lvLabel}</span></span>
                <span class="col-retargeting">${retargetingCell}</span>
                <span class="col-telefono pedido-telefono">${p.telefono || 'Sin tel'}</span>
            </div>`;
        }).join('');

        actualizarBotonEnviar();
    }

    window.togglePedido = (id, checked) => {
        if (checked) pedidosSeleccionados.add(id);
        else pedidosSeleccionados.delete(id);
        const selectAll = document.getElementById('selectAll');
        const visibles = pedidosEncontrados.filter(pedidoCoincideFiltro);
        const seleccionablesVisibles = visibles.filter(p => !p.retargetadoHoy).length;
        const seleccionadosVisibles = visibles.filter(p => pedidosSeleccionados.has(p.id)).length;
        if (selectAll) selectAll.checked = seleccionablesVisibles > 0 && seleccionadosVisibles === seleccionablesVisibles;
        actualizarBotonEnviar();
    };

    window.toggleSelectAll = (checked) => {
        const visibles = pedidosEncontrados.filter(pedidoCoincideFiltro);
        if (checked) {
            visibles.filter(p => !p.retargetadoHoy).forEach(p => pedidosSeleccionados.add(p.id));
        } else {
            visibles.forEach(p => pedidosSeleccionados.delete(p.id));
        }
        document.querySelectorAll('.pedido-check:not(:disabled)').forEach(cb => cb.checked = checked);
        actualizarBotonEnviar();
    };

    function actualizarBotonEnviar() {
        const count = pedidosSeleccionados.size;
        const requierePlantilla = modoEnvio === 'plantilla';
        const plantillaLista = !!plantillaSeleccionada;
        const mediaFmt = plantillaLista ? plantillaMediaFormat(plantillaSeleccionada) : null;
        const necesitaMedia = !!mediaFmt;
        const mediaLista = !necesitaMedia || !!plantillaMediaUrl;
        btnEnviar.disabled = count === 0
            || (requierePlantilla && !plantillaLista)
            || (requierePlantilla && necesitaMedia && !mediaLista)
            || plantillaMediaSubiendo;
        if (count === 0) {
            btnEnviar.innerHTML = `<i class="fas fa-paper-plane"></i> Enviar Retargeting Masivo`;
        } else if (requierePlantilla) {
            if (necesitaMedia && plantillaMediaSubiendo) {
                btnEnviar.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Subiendo ${MEDIA_LABELS[mediaFmt]}...`;
            } else if (necesitaMedia && !mediaLista) {
                btnEnviar.innerHTML = `<i class="fas fa-paper-plane"></i> Sube ${MEDIA_LABELS[mediaFmt]} para enviar`;
            } else {
                const tplLabel = plantillaLista ? `: ${plantillaSeleccionada.name}` : '';
                btnEnviar.innerHTML = `<i class="fas fa-paper-plane"></i> Enviar plantilla (${count})${tplLabel}`;
            }
        } else {
            btnEnviar.innerHTML = `<i class="fas fa-paper-plane"></i> Enviar Retargeting (${count})`;
        }
        const contador = document.getElementById('contadorSeleccionados');
        if (contador) contador.textContent = `${count} seleccionados`;
    }

    // --- Enviar retargeting ---
    window.enviarRetargeting = async () => {
        if (pedidosSeleccionados.size === 0) return;

        const esPlantilla = modoEnvio === 'plantilla';
        let instrucciones = '';
        if (esPlantilla) {
            if (!plantillaSeleccionada) { alert('Selecciona una plantilla primero.'); return; }
            const mediaFmt = plantillaMediaFormat(plantillaSeleccionada);
            if (mediaFmt && !plantillaMediaUrl) {
                alert(`Esta plantilla requiere ${MEDIA_LABELS[mediaFmt]}. Súbelo antes de enviar.`);
                return;
            }
        } else {
            instrucciones = instruccionesTA.value.trim();
            if (!instrucciones) { alert('Escribe las instrucciones de IA primero.'); return; }
        }

        const pedidosAEnviar = pedidosEncontrados.filter(p => pedidosSeleccionados.has(p.id));
        const contactosUnicos = new Set(pedidosAEnviar.map(p => p.telefono).filter(Boolean));
        const confirmMsg = esPlantilla
            ? `Se enviará la plantilla "${plantillaSeleccionada.name}" a ${contactosUnicos.size} contacto(s) (${pedidosAEnviar.length} pedidos). ¿Continuar?`
            : `Se enviarán mensajes de retargeting a ${contactosUnicos.size} contacto(s) (${pedidosAEnviar.length} pedidos). ¿Continuar?`;
        if (!confirm(confirmMsg)) return;

        progresoBox.style.display = 'block';
        btnEnviar.disabled = true;
        logRetargeting.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';

        const telefonos = [...contactosUnicos];
        const total = telefonos.length;
        let processed = 0;

        // BatchId compartido por toda la tanda (solo aplica en modo plantilla)
        const batchId = esPlantilla
            ? (window.crypto?.randomUUID?.() || `ret_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
            : null;
        const sentBy = auth.currentUser?.email || null;

        try {
            const token = await auth.currentUser.getIdToken();

            for (const telefono of telefonos) {
                const pedidosDeContacto = pedidosAEnviar.filter(p => p.telefono === telefono);
                const orderNumbers = pedidosDeContacto.map(p => `DH${p.consecutiveOrderNumber}`).join(', ');

                try {
                    const endpoint = esPlantilla ? '/api/retargeting/enviar-plantilla' : '/api/retargeting/enviar';
                    const body = esPlantilla
                        ? { contactId: telefono, template: plantillaSeleccionada, mediaUrl: plantillaMediaUrl, batchId, batchTotal: total, sentBy }
                        : { contactId: telefono, instructions: instrucciones, orderNumbers: pedidosDeContacto.map(p => p.consecutiveOrderNumber) };
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(body)
                    });
                    const result = await res.json();

                    if (result.success) {
                        addLog(`${orderNumbers} (${telefono}): Enviado`, 'success');
                        pedidosEncontrados.filter(p => p.telefono === telefono).forEach(p => {
                            p.retargetadoHoy = true;
                            pedidosSeleccionados.delete(p.id);
                        });
                    } else if (result.skipped) {
                        addLog(`${orderNumbers} (${telefono}): ${result.reason}`, 'skip');
                    } else {
                        addLog(`${orderNumbers} (${telefono}): Error - ${result.message}`, 'error');
                    }
                } catch (err) {
                    addLog(`${orderNumbers} (${telefono}): Error de red - ${err.message}`, 'error');
                }

                processed++;
                const pct = Math.round((processed / total) * 100);
                progressBar.style.width = pct + '%';
                progressBar.textContent = pct + '%';
                progresoTexto.textContent = `${processed} / ${total} contactos procesados`;
            }

            progresoTexto.textContent = `Completado: ${processed} / ${total} contactos procesados`;
            document.querySelector('#progresoBox h2').innerHTML = '<i class="fas fa-check-circle" style="color:#16a34a;"></i> Retargeting completado';

            // Actualizar cache con los nuevos flags retargetadoHoy
            const fechaIni = document.getElementById('fechaInicio').value;
            const fechaFin = document.getElementById('fechaFin').value;
            saveCache(pedidosEncontrados, fechaIni, fechaFin);
            updateCacheInfoUI(loadCache());
            renderPedidos();

            // Refrescar el panel de campañas para mostrar la nueva tanda
            if (esPlantilla) cargarCampanas(true);

        } catch (e) {
            alert('Error general: ' + e.message);
        }

        btnEnviar.disabled = false;
    };

    function addLog(message, type) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logRetargeting.appendChild(entry);
        logRetargeting.scrollTop = logRetargeting.scrollHeight;
    }

    // --- Campañas enviadas (historial con métricas oficiales de Meta + tandas internas) ---
    let campanasUltimoFrom = null;
    let campanasUltimoTo = null;

    window.cargarCampanas = async (forceRefresh) => {
        const container = document.getElementById('campanasContainer');
        if (!container) return;
        const dias = Number(document.getElementById('campanasRango')?.value) || 30;
        container.innerHTML = '<div class="campanas-empty"><i class="fas fa-spinner fa-spin"></i> Cargando campañas...</div>';

        try {
            const token = await auth.currentUser.getIdToken();
            const from = Date.now() - dias * 24 * 60 * 60 * 1000;
            const to = Date.now();
            campanasUltimoFrom = from;
            campanasUltimoTo = to;

            const params = new URLSearchParams({
                from: String(from),
                source: 'retargeting_plantilla'
            });
            if (forceRefresh) params.set('fresh', '1');

            const res = await fetch(`/api/template-metrics/batches?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error cargando campañas');

            const batches = data.batches || [];
            // Render inicial sin métricas Meta (instantáneo)
            renderCampanas(batches, null);

            // Disparar métricas oficiales de Meta en segundo plano y re-renderizar
            const templateNames = [...new Set(batches.map(b => b.templateName).filter(Boolean))];
            if (templateNames.length) {
                fetchMetaStats(templateNames, from, to, forceRefresh).then(metaStats => {
                    renderCampanas(batches, metaStats);
                }).catch(e => {
                    console.warn('No se pudieron cargar métricas Meta:', e.message);
                });
            }
        } catch (e) {
            container.innerHTML = `<div class="campanas-empty" style="color:#dc2626;"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
        }
    };

    let metaDebugLast = null;

    async function fetchMetaStats(templateNames, from, to, forceRefresh) {
        const token = await auth.currentUser.getIdToken();
        const params = new URLSearchParams({
            from: String(from),
            to: String(to),
            templates: templateNames.join(','),
            fresh: '1'  // mientras debuggeamos, siempre fresco
        });
        const res = await fetch(`/api/template-metrics/meta-stats?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Error');
        metaDebugLast = data.debug || null;
        if (metaDebugLast) {
            console.log('[meta-stats] debug:', metaDebugLast);
            if (metaDebugLast.sampleDataPointJson) {
                console.log('[meta-stats] sample con datos (json):', metaDebugLast.sampleDataPointJson);
            }
            if (metaDebugLast.sampleWithCostJson) {
                console.log('[meta-stats] sample con cost.value (json):', metaDebugLast.sampleWithCostJson);
            } else if (metaDebugLast.totalDataPoints) {
                console.warn('[meta-stats] NINGÚN datapoint trae cost.value — Meta no nos está devolviendo el gasto en este endpoint.');
            }
            if (metaDebugLast.byTemplateId) {
                console.table(metaDebugLast.byTemplateId);
            }
        }
        return data.stats || {};
    }

    function renderCampanas(batches, metaStats) {
        const container = document.getElementById('campanasContainer');
        if (!container) return;
        if (!batches.length) {
            container.innerHTML = '<div class="campanas-empty"><i class="fas fa-inbox"></i> Aún no hay campañas en este rango. Envía una plantilla para empezar a medir.</div>';
            return;
        }

        const fmtFecha = (iso) => {
            if (!iso) return '';
            const d = new Date(iso);
            return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) + ' ' +
                   d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        };
        const pct = (a, b) => b ? Math.round((a / b) * 100) + '%' : '—';
        const fmtMoney = (v, cur) => {
            if (!v) return '$0';
            const sym = cur === 'USD' ? 'US$' : (cur || '$');
            return `${sym}${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        // Agrupar tandas por plantilla
        const porPlantilla = new Map();
        for (const b of batches) {
            if (!porPlantilla.has(b.templateName)) porPlantilla.set(b.templateName, []);
            porPlantilla.get(b.templateName).push(b);
        }

        const plantillasOrdenadas = [...porPlantilla.entries()].sort((a, b) => {
            const lastA = Math.max(...a[1].map(x => new Date(x.createdAt).getTime() || 0));
            const lastB = Math.max(...b[1].map(x => new Date(x.createdAt).getTime() || 0));
            return lastB - lastA;
        });

        // --- Resumen global (estilo Meta: Importe gastado + Costo por mensaje entregado) ---
        // Si Meta no devuelve datos (Insights apagado o aún sin agregar), usamos
        // nuestro tracking interno (template_sends.status) como fallback.
        let resumenHTML = '';
        if (metaStats) {
            // Métricas Meta (oficiales)
            let metaCost = 0, metaDelivered = 0, metaSent = 0, metaRead = 0, metaClicked = 0, currency = null;
            for (const m of Object.values(metaStats)) {
                if (!m) continue;
                metaCost += Number(m.costValue || 0);
                metaDelivered += Number(m.delivered || 0);
                metaSent += Number(m.sent || 0);
                metaRead += Number(m.read || 0);
                metaClicked += Number(m.clicked || 0);
                if (m.costCurrency && !currency) currency = m.costCurrency;
            }
            // Métricas internas (tracking propio: template_sends.status del webhook)
            // "Enviados" = aceptados por Meta − fallidos − bloqueados, para coincidir
            // con el conteo del WhatsApp Manager (que descuenta failed/blocked).
            const intSentRaw = batches.reduce((s, b) => s + (b.sent || 0), 0);
            const intFailed = batches.reduce((s, b) => s + (b.failed || 0), 0);
            const intBlocked = batches.reduce((s, b) => s + (b.blocked || 0), 0);
            const intSent = intSentRaw - intFailed - intBlocked;
            const intDelivered = batches.reduce((s, b) => s + (b.delivered || 0), 0);
            const intRead = batches.reduce((s, b) => s + (b.read || 0), 0);
            const intReplied = batches.reduce((s, b) => s + (b.replied || 0), 0);

            // Tarifa estimada por mensaje (Meta WhatsApp Marketing México ~ $0.0344 USD)
            const TARIFA_DEFAULT_USD = 0.034;
            const tarifa = Number(localStorage.getItem('retargeting:tarifa') || TARIFA_DEFAULT_USD);

            // Origen de los datos: Meta si tiene sent>0, sino tracking interno
            const usarMeta = metaSent > 0;
            const totalSent = usarMeta ? metaSent : intSent;
            const totalDelivered = usarMeta ? metaDelivered : intDelivered;
            const totalRead = usarMeta ? metaRead : intRead;
            const totalClicked = usarMeta ? metaClicked : 0;
            const totalCost = usarMeta ? metaCost : (intDelivered * tarifa);
            const totalRepliedAll = intReplied; // siempre del tracking propio
            const cpd = totalDelivered ? (totalCost / totalDelivered) : 0;
            const curr = currency || 'USD';
            const sourceLabel = usarMeta
                ? '<span class="src-badge src-meta"><i class="fas fa-check-circle"></i> Meta oficial</span>'
                : `<span class="src-badge src-internal" title="Tracking propio: status de los webhooks de WhatsApp + tarifa estimada">⚙️ Tracking propio · costo estimado @ ${fmtMoney(tarifa, curr)}/msg</span>`;

            // Aviso cuando Meta devuelve solo ceros pero hay batches enviados (= is_enabled_for_insights apagado)
            if (metaSent === 0 && metaCost === 0 && intSent > 0) {
                resumenHTML += `
                    <div class="meta-aviso">
                        <div class="meta-aviso-icon"><i class="fas fa-exclamation-triangle"></i></div>
                        <div class="meta-aviso-body">
                            <div class="meta-aviso-title">Las métricas oficiales de Meta están desactivadas (o aún sin agregar)</div>
                            <div class="meta-aviso-desc">
                                Tu cuenta de WhatsApp Business no tiene activado el flag <code>is_enabled_for_insights</code>, por eso el Manager muestra el importe gastado pero la API devuelve ceros.
                                <strong>Mientras tanto los números de abajo se calculan con tu tracking interno</strong> (Entregados/Leídos vienen de los webhooks de WhatsApp; el costo se estima con la tarifa promedio).
                            </div>
                            <button class="meta-aviso-btn" onclick="activarMetaInsights(this)">
                                <i class="fas fa-bolt"></i> Activar Analytics oficiales de Meta
                            </button>
                            <div id="metaInsightsResult" class="meta-aviso-result"></div>
                        </div>
                    </div>
                `;
            }
            resumenHTML += `
                <div class="resumen-source">${sourceLabel}</div>
                <div class="resumen-meta">
                    <div class="resumen-kpi resumen-kpi-cost">
                        <div class="resumen-label"><i class="fas fa-dollar-sign"></i> Importe gastado ${usarMeta ? '' : '<span class="est-tag">est.</span>'}</div>
                        <div class="resumen-value">${fmtMoney(totalCost, curr)}</div>
                        <div class="resumen-sub">en ${plantillasOrdenadas.length} plantilla${plantillasOrdenadas.length === 1 ? '' : 's'}</div>
                    </div>
                    <div class="resumen-kpi resumen-kpi-cpd">
                        <div class="resumen-label"><i class="fas fa-receipt"></i> Costo por mensaje entregado ${usarMeta ? '' : '<span class="est-tag">est.</span>'}</div>
                        <div class="resumen-value">${fmtMoney(cpd, curr)}</div>
                        <div class="resumen-sub">${totalDelivered} entregados</div>
                    </div>
                    <div class="resumen-kpi">
                        <div class="resumen-label"><i class="fas fa-paper-plane"></i> Enviados</div>
                        <div class="resumen-value">${totalSent}</div>
                        <div class="resumen-sub">${totalDelivered} entregados (${pct(totalDelivered, totalSent)})${!usarMeta && (intFailed + intBlocked) ? ` · ${intFailed + intBlocked} fallidos/bloqueados restados` : ''}</div>
                    </div>
                    <div class="resumen-kpi">
                        <div class="resumen-label"><i class="fas fa-eye"></i> Leídos</div>
                        <div class="resumen-value">${totalRead}</div>
                        <div class="resumen-sub">${pct(totalRead, totalSent)} de enviados</div>
                    </div>
                    <div class="resumen-kpi">
                        <div class="resumen-label"><i class="fas fa-reply"></i> Respondieron</div>
                        <div class="resumen-value">${totalRepliedAll}</div>
                        <div class="resumen-sub">${pct(totalRepliedAll, totalSent)} tasa resp.</div>
                    </div>
                    <div class="resumen-kpi">
                        <div class="resumen-label"><i class="fas fa-hand-pointer"></i> Clics ${usarMeta ? '' : '<span class="est-tag" title="Sólo Meta puede medir clics; el tracking interno no los ve">n/d</span>'}</div>
                        <div class="resumen-value">${usarMeta ? totalClicked : '—'}</div>
                        <div class="resumen-sub">${usarMeta ? pct(totalClicked, totalSent) + ' de enviados' : 'requiere Meta Insights'}</div>
                    </div>
                </div>
            `;
        } else {
            resumenHTML = `<div class="resumen-meta-loading"><i class="fas fa-spinner fa-spin"></i> Cargando importe gastado y métricas Meta...</div>`;
        }

        container.innerHTML = resumenHTML + `<div class="campanas-list">` + plantillasOrdenadas.map(([nombre, tandas]) => {
            const m = metaStats?.[nombre];
            const tasaResp = m ? pct(tandas.reduce((s, b) => s + (b.replied || 0), 0), m.sent) : null;
            const tipoLabels = {
                quick_reply_button: 'Respuesta rápida',
                url_button: 'URL',
                phone_number_button: 'Teléfono',
                copy_code_button: 'Copiar código',
                catalog_button: 'Catálogo',
                flow_button: 'Flow',
                button: 'Botón'
            };
            const clicksHTML = (m && m.clickedBreakdown && m.clickedBreakdown.length)
                ? `
                <div class="meta-clicks">
                    <div class="meta-clicks-title"><i class="fas fa-hand-pointer"></i> Clics en el botón</div>
                    <table class="meta-clicks-table">
                        <thead><tr><th>Etiqueta</th><th>Tipo</th><th class="num">Total</th><th class="num">% clics</th></tr></thead>
                        <tbody>${m.clickedBreakdown.map(c => `
                            <tr>
                                <td>${c.label}</td>
                                <td><span class="meta-click-tipo">${tipoLabels[c.type] || c.type}</span></td>
                                <td class="num"><strong>${c.count}</strong></td>
                                <td class="num">${pct(c.count, m.sent)}</td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>
            ` : '';

            const respondieronTotal = tandas.reduce((s, b) => s + (b.replied || 0), 0);

            // Diagnóstico cuando Meta no devuelve datos
            let emptyMsg = 'Meta aún no reporta métricas para esta plantilla en el rango (suele tardar unas horas).';
            if (metaStats && m && !m.resolved) {
                emptyMsg = `No se encontró la plantilla "${nombre}" en tu cuenta de WhatsApp Business (¿fue borrada o renombrada en Meta?).`;
            } else if (metaStats && m && m.resolved && !m.sent) {
                emptyMsg = `Meta ya conoce la plantilla pero todavía no agregó métricas para este rango. Las stats oficiales pueden tardar 24-48h en aparecer.`;
            }

            const chartId = `chartTrend_${slug(nombre)}`;
            const funnelHTML = (m && m.sent)
                ? renderFunnel(m, respondieronTotal)
                : '';
            const trendHTML = (m && m.trend && m.trend.length > 1)
                ? `
                <div class="meta-chart-block">
                    <div class="meta-chart-title"><i class="fas fa-chart-line"></i> Tendencia diaria</div>
                    <div class="meta-chart-wrap"><canvas id="${chartId}"></canvas></div>
                </div>
            ` : '';

            const metaBlock = !metaStats
                ? `<div class="meta-stats meta-stats-loading"><i class="fas fa-spinner fa-spin"></i> Cargando métricas oficiales...</div>`
                : !m || !m.sent
                    ? `<div class="meta-stats meta-stats-empty"><i class="fas fa-info-circle"></i> ${emptyMsg}</div>`
                    : `
                <div class="meta-stats">
                    <div class="meta-stat"><div class="meta-stat-num">${m.sent}</div><div class="meta-stat-label">Enviados</div></div>
                    <div class="meta-stat"><div class="meta-stat-num">${m.delivered}</div><div class="meta-stat-label">Entregados</div><div class="meta-stat-sub">${pct(m.delivered, m.sent)}</div></div>
                    <div class="meta-stat"><div class="meta-stat-num">${m.read}</div><div class="meta-stat-label">Leídos</div><div class="meta-stat-sub">${pct(m.read, m.sent)}</div></div>
                    <div class="meta-stat"><div class="meta-stat-num">${respondieronTotal}</div><div class="meta-stat-label">Respondieron</div><div class="meta-stat-sub">${tasaResp || '—'}</div></div>
                    <div class="meta-stat"><div class="meta-stat-num">${m.clicked}</div><div class="meta-stat-label">Clics</div><div class="meta-stat-sub">${pct(m.clicked, m.sent)}</div></div>
                    <div class="meta-stat"><div class="meta-stat-num">${fmtMoney(m.costValue, m.costCurrency)}</div><div class="meta-stat-label">Costo</div><div class="meta-stat-sub">${m.delivered ? fmtMoney(m.costValue / m.delivered, m.costCurrency) + '/msg' : '—'}</div></div>
                </div>
                ${funnelHTML}
                ${trendHTML}
                ${clicksHTML}
            `;

            const tandasHTML = tandas
                .slice()
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .map(b => {
                    const respondieron = b.replied || 0;
                    // Mismo criterio que el resumen global: descontar failed/blocked
                    const enviadosBatch = (b.sent || 0) - (b.failed || 0) - (b.blocked || 0);
                    const meta = [
                        `<span><i class="fas fa-clock"></i>${fmtFecha(b.createdAt)}</span>`,
                        b.sentBy ? `<span><i class="fas fa-user"></i>${b.sentBy}</span>` : ''
                    ].filter(Boolean).join('');
                    return `
                        <div class="tanda-row">
                            <div class="tanda-meta">${meta}</div>
                            <div class="tanda-num"><strong>${enviadosBatch}</strong> enviados</div>
                            <div class="tanda-num"><strong>${respondieron}</strong> resp. <span class="tanda-pct">${pct(respondieron, enviadosBatch)}</span></div>
                        </div>
                    `;
                }).join('');

            return `
                <div class="campana-group">
                    <div class="campana-group-header">
                        <div class="campana-titulo"><i class="fas fa-bullhorn"></i>${nombre}</div>
                        <div class="campana-tandas-count">${tandas.length} tanda${tandas.length === 1 ? '' : 's'}</div>
                    </div>
                    ${metaBlock}
                    <div class="tandas-list">${tandasHTML}</div>
                </div>
            `;
        }).join('') + `</div>`;

        // Dibujar todas las gráficas tras insertar el DOM
        requestAnimationFrame(() => {
            for (const [nombre, _tandas] of plantillasOrdenadas) {
                const m = metaStats?.[nombre];
                if (!m || !m.trend || m.trend.length < 2) continue;
                const id = `chartTrend_${slug(nombre)}`;
                const canvas = document.getElementById(id);
                if (!canvas || !window.Chart) continue;
                // Destruir gráfica previa si existe
                const prev = Chart.getChart(canvas);
                if (prev) prev.destroy();
                new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: m.trend.map(t => t.date.slice(5)),
                        datasets: [
                            { label: 'Enviados', data: m.trend.map(t => t.sent), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.3, borderWidth: 2 },
                            { label: 'Entregados', data: m.trend.map(t => t.delivered), borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)', tension: 0.3, borderWidth: 2 },
                            { label: 'Leídos', data: m.trend.map(t => t.read), borderColor: '#0e7490', backgroundColor: 'rgba(14,116,144,0.1)', tension: 0.3, borderWidth: 2 },
                            { label: 'Clics', data: m.trend.map(t => t.clicked), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', tension: 0.3, borderWidth: 2 }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                            tooltip: { mode: 'index', intersect: false }
                        },
                        interaction: { mode: 'nearest', axis: 'x', intersect: false },
                        scales: {
                            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                            y: { beginAtZero: true, ticks: { font: { size: 10 } } }
                        }
                    }
                });
            }
        });
    }

    function slug(s) {
        return String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    }

    // Activar Analytics oficiales de Meta (is_enabled_for_insights=true en la WABA)
    window.activarMetaInsights = async (btn) => {
        const resultEl = document.getElementById('metaInsightsResult');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Activando...'; }
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/template-metrics/enable-meta-insights', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.detail || data.message || 'Error');
            if (resultEl) {
                resultEl.className = 'meta-aviso-result meta-aviso-result-ok';
                resultEl.innerHTML = '<i class="fas fa-check-circle"></i> ¡Activado! Meta empezará a registrar métricas desde hoy. Vuelve mañana para ver los primeros números (suele tardar 24-48h).';
            }
            if (btn) btn.innerHTML = '<i class="fas fa-check"></i> Activado';
        } catch (e) {
            if (resultEl) {
                resultEl.className = 'meta-aviso-result meta-aviso-result-err';
                resultEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> No se pudo activar: ${e.message}. Es posible que el token no tenga el permiso whatsapp_business_management — actívalo manualmente en Business Manager → WhatsApp Manager → Configuración.`;
            }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> Reintentar'; }
        }
    };

    function renderFunnel(m, respondieron) {
        const steps = [
            { label: 'Enviados', value: m.sent, color: '#ef4444' },
            { label: 'Entregados', value: m.delivered, color: '#7c3aed' },
            { label: 'Leídos', value: m.read, color: '#0e7490' },
            { label: 'Respondieron', value: respondieron, color: '#16a34a' }
        ];
        const max = Math.max(...steps.map(s => s.value), 1);
        return `
            <div class="meta-funnel">
                <div class="meta-funnel-title"><i class="fas fa-filter"></i> Embudo</div>
                <div class="meta-funnel-bars">
                    ${steps.map((s, i) => {
                        const pctMax = Math.round((s.value / max) * 100);
                        const pctPrev = i === 0 ? 100 : Math.round((s.value / (steps[i - 1].value || 1)) * 100);
                        return `
                            <div class="funnel-step">
                                <div class="funnel-label">${s.label}</div>
                                <div class="funnel-bar-wrap">
                                    <div class="funnel-bar" style="width:${Math.max(pctMax, 2)}%;background:${s.color};">
                                        <span class="funnel-bar-val">${s.value}</span>
                                    </div>
                                </div>
                                <div class="funnel-pct">${i === 0 ? '' : pctPrev + '%'}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // --- Calculadora manual de conversión ---
    const CALC_STORAGE_KEY = 'retargeting:calc:v1';

    function restaurarCalculadora() {
        try {
            const raw = localStorage.getItem(CALC_STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved.gasto != null) document.getElementById('calcGasto').value = saved.gasto;
            if (saved.enviados != null) document.getElementById('calcEnviados').value = saved.enviados;
            if (saved.conversiones != null) document.getElementById('calcConversiones').value = saved.conversiones;
            if (saved.ingreso != null) document.getElementById('calcIngreso').value = saved.ingreso;
            recalcularConversion();
        } catch {}
    }

    window.recalcularConversion = () => {
        const gasto = parseFloat(document.getElementById('calcGasto').value) || 0;
        const enviados = parseInt(document.getElementById('calcEnviados').value) || 0;
        const conversiones = parseInt(document.getElementById('calcConversiones').value) || 0;
        const ingreso = parseFloat(document.getElementById('calcIngreso').value) || 0;

        const fmtUsd = (v) => `US$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const fmt = (v) => `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Persistir últimos valores
        try {
            localStorage.setItem(CALC_STORAGE_KEY, JSON.stringify({ gasto, enviados, conversiones, ingreso }));
        } catch {}

        const cpc = conversiones > 0 ? (gasto / conversiones) : null;
        const tasa = enviados > 0 ? (conversiones / enviados * 100) : null;
        const roas = gasto > 0 ? (ingreso / gasto) : null;
        const ganancia = ingreso - gasto;
        const ingresoPorConv = conversiones > 0 ? (ingreso / conversiones) : null;

        const setOut = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        if (cpc != null) {
            setOut('calcCostoConversion', fmtUsd(cpc));
            setOut('calcCostoConversionSub', `${fmtUsd(gasto)} / ${conversiones} conv.`);
        } else {
            setOut('calcCostoConversion', '—');
            setOut('calcCostoConversionSub', 'agrega gasto y conversiones');
        }

        if (tasa != null) {
            setOut('calcTasaConversion', tasa.toFixed(2).replace(/\.00$/, '') + '%');
            setOut('calcTasaConversionSub', `${conversiones} de ${enviados} enviados`);
        } else {
            setOut('calcTasaConversion', '—');
            setOut('calcTasaConversionSub', 'agrega enviados y conversiones');
        }

        // ROAS — color cambia según rentabilidad
        const roasEl = document.getElementById('calcRoas');
        const roasSubEl = document.getElementById('calcRoasSub');
        const roasCard = document.querySelector('.calc-output-roas');
        if (roas != null) {
            roasEl.textContent = roas.toFixed(2) + 'x';
            roasSubEl.textContent = ingresoPorConv != null
                ? `${fmt(ingresoPorConv)} ingreso/conv.`
                : `${fmt(ingreso)} / ${fmtUsd(gasto)}`;
            if (roasCard) {
                roasCard.classList.toggle('roas-good', roas >= 2);
                roasCard.classList.toggle('roas-warn', roas >= 1 && roas < 2);
                roasCard.classList.toggle('roas-bad', roas < 1);
            }
        } else {
            roasEl.textContent = '—';
            roasSubEl.textContent = 'agrega gasto e ingreso';
            if (roasCard) roasCard.classList.remove('roas-good', 'roas-warn', 'roas-bad');
        }

        // Ganancia neta
        const gananciaEl = document.getElementById('calcGanancia');
        const gananciaSubEl = document.getElementById('calcGananciaSub');
        const gananciaCard = document.querySelector('.calc-output-ganancia');
        if (gasto > 0 || ingreso > 0) {
            gananciaEl.textContent = (ganancia >= 0 ? '+' : '−') + fmt(Math.abs(ganancia));
            const margen = ingreso > 0 ? (ganancia / ingreso * 100) : 0;
            gananciaSubEl.textContent = ingreso > 0
                ? `margen ${margen.toFixed(1)}% · ${conversiones > 0 ? fmt(ganancia / conversiones) + '/conv.' : ''}`.trim()
                : 'ingreso − gasto';
            if (gananciaCard) {
                gananciaCard.classList.toggle('gan-good', ganancia > 0);
                gananciaCard.classList.toggle('gan-bad', ganancia < 0);
            }
        } else {
            gananciaEl.textContent = '—';
            gananciaSubEl.textContent = 'ingreso − gasto';
            if (gananciaCard) gananciaCard.classList.remove('gan-good', 'gan-bad');
        }
    };

    window.prefillCalculadora = () => {
        // Tomamos los valores del último render del resumen global (DOM)
        const grabValue = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const txt = el.textContent.replace(/[^0-9.]/g, '');
            return txt ? Number(txt) : null;
        };
        // Importe gastado: primer .resumen-kpi-cost .resumen-value
        const gastoEl = document.querySelector('.resumen-kpi-cost .resumen-value');
        const enviadosEls = document.querySelectorAll('.resumen-kpi .resumen-value');
        // El KPI "Enviados" es el tercero (índice 2): cost, cpd, enviados...
        let gasto = 0, enviados = 0;
        if (gastoEl) {
            const txt = gastoEl.textContent.replace(/[^0-9.,]/g, '').replace(/,/g, '');
            gasto = parseFloat(txt) || 0;
        }
        if (enviadosEls.length >= 3) {
            const txt = enviadosEls[2].textContent.replace(/[^0-9]/g, '');
            enviados = parseInt(txt) || 0;
        }
        document.getElementById('calcGasto').value = gasto.toFixed(2);
        document.getElementById('calcEnviados').value = enviados;
        // Conversiones queda como el usuario las ponga
        recalcularConversion();
    };

    // Restaurar valores guardados al cargar (después de auth)
    onAuthStateChanged(auth, (user) => {
        if (user) restaurarCalculadora();
    });
});
