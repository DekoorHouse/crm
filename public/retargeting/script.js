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
    const PLANTILLAS_CACHE_KEY = 'retargeting:plantillas:v1';
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
});
