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
    const listaContactos = document.getElementById('listaContactos');
    const totalContactosSpan = document.getElementById('totalContactos');
    const btnEnviar = document.getElementById('btnEnviarRetargeting');
    const btnBuscar = document.getElementById('btnBuscarContactos');
    const btnActualizar = document.getElementById('btnActualizar');
    const cacheInfo = document.getElementById('cacheInfo');
    const progresoBox = document.getElementById('progresoBox');
    const progressBar = document.getElementById('progressBar');
    const progresoTexto = document.getElementById('progresoTexto');
    const logRetargeting = document.getElementById('logRetargeting');
    const departamentoSelect = document.getElementById('departamentoSelect');

    let contactosEncontrados = [];
    let contactosSeleccionados = new Set();
    let sortOrder = 'fecha-desc'; // 'fecha-desc' | 'fecha-asc' | 'nombre-asc'
    let ocultarYaEnviados = false;
    let purchaseFilter = ''; // '' | 'con' | 'sin' | 'registered' | 'completed'
    let visiblesActuales = []; // Snapshot del listado filtrado+ordenado actualmente en pantalla
    let lastCheckedIdx = null; // Índice del último checkbox clickeado (para shift+click)
    let modoEnvio = 'ia'; // 'ia' | 'plantilla'
    let plantillasDisponibles = [];
    let plantillaSeleccionada = null;
    let plantillaMediaUrl = null;
    let plantillaMediaSubiendo = false;
    let departamentosDisponibles = [];

    const MEDIA_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT'];
    const MEDIA_ICONS = { IMAGE: 'image', VIDEO: 'video', DOCUMENT: 'file-pdf' };
    const MEDIA_LABELS = { IMAGE: 'imagen', VIDEO: 'video', DOCUMENT: 'documento (PDF)' };
    const MEDIA_ACCEPT = { IMAGE: 'image/*', VIDEO: 'video/mp4,video/3gp,video/quicktime', DOCUMENT: 'application/pdf' };

    function plantillaMediaFormat(t) {
        const header = t?.components?.find(c => c.type === 'HEADER');
        return MEDIA_FORMATS.includes(header?.format) ? header.format : null;
    }

    function getContactDateMs(c) {
        // Usa enteredAt (fecha real de ingreso al depto). Fallback a lastMessageTimestamp
        // por compatibilidad con cache vieja.
        const t = c.enteredAt || c.lastMessageTimestamp;
        return t ? new Date(t).getTime() : 0;
    }

    function yaRecibioRetargeting(c) {
        return !!c.lastRetargetingDate;
    }

    function tienePedido(c) {
        return c.purchaseStatus === 'registered' || c.purchaseStatus === 'completed';
    }

    function contactoCoincideFiltro(c) {
        if (ocultarYaEnviados && yaRecibioRetargeting(c)) return false;
        if (purchaseFilter === 'con' && !tienePedido(c)) return false;
        if (purchaseFilter === 'sin' && tienePedido(c)) return false;
        if (purchaseFilter === 'registered' && c.purchaseStatus !== 'registered') return false;
        if (purchaseFilter === 'completed' && c.purchaseStatus !== 'completed') return false;
        return true;
    }

    function aplicarOrden(arr) {
        const copy = arr.slice();
        switch (sortOrder) {
            case 'fecha-asc':
                copy.sort((a, b) => getContactDateMs(a) - getContactDateMs(b));
                break;
            case 'nombre-asc':
                copy.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
                break;
            case 'fecha-desc':
            default:
                copy.sort((a, b) => getContactDateMs(b) - getContactDateMs(a));
                break;
        }
        return copy;
    }

    window.setSortOrder = (value) => {
        sortOrder = value || 'fecha-desc';
        renderContactos();
    };

    window.toggleOcultarYaEnviados = (checked) => {
        ocultarYaEnviados = !!checked;
        renderContactos();
    };

    window.setPurchaseFilter = (value) => {
        purchaseFilter = value || '';
        document.querySelectorAll('.filtros-chips .chip').forEach(c => {
            c.classList.toggle('chip-active', (c.getAttribute('data-pedido') || '') === purchaseFilter);
        });
        renderContactos();
    };

    function actualizarContadoresPedido() {
        const counts = { all: contactosEncontrados.length, con: 0, sin: 0, registered: 0, completed: 0 };
        for (const c of contactosEncontrados) {
            if (c.purchaseStatus === 'registered') { counts.registered++; counts.con++; }
            else if (c.purchaseStatus === 'completed') { counts.completed++; counts.con++; }
            else counts.sin++;
        }
        const ids = { all: 'cntPedAll', con: 'cntPedCon', sin: 'cntPedSin', registered: 'cntPedReg', completed: 'cntPedComp' };
        for (const k of Object.keys(counts)) {
            const el = document.getElementById(ids[k]);
            if (el) el.textContent = counts[k];
        }
    }

    // --- Cache local por (depto + rango) ---
    // v2: data shape cambió (ahora trae enteredAt), invalidamos caches viejas.
    const CACHE_KEY = 'retargeting:nuevos:v2';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

    function loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed.fetchedAt || !Array.isArray(parsed.contacts)) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function saveCache(contacts, departmentId, inicio, fin) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                fetchedAt: Date.now(),
                departmentId, inicio, fin, contacts
            }));
        } catch (e) {
            console.warn('No se pudo guardar cache:', e);
        }
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
        const deptName = (departamentosDisponibles.find(d => d.id === cache.departmentId) || {}).name || '?';
        cacheInfo.textContent = `Última carga: ${formatRelativeTime(cache.fetchedAt)} (${deptName}: ${cache.inicio} → ${cache.fin})${fresh ? '' : ' · expirada'}${originText}`;
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
            await Promise.all([
                cargarInstrucciones(),
                cargarDepartamentos()
            ]);
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

    // --- Departamentos ---
    async function cargarDepartamentos() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/departments', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error al cargar departamentos');
            departamentosDisponibles = data.departments || [];
            renderDepartamentosSelect();
        } catch (e) {
            console.error('Error cargando departamentos:', e);
            departamentoSelect.innerHTML = `<option value="">Error: ${e.message}</option>`;
        }
    }

    function renderDepartamentosSelect() {
        if (!departamentosDisponibles.length) {
            departamentoSelect.innerHTML = '<option value="">No hay departamentos</option>';
            return;
        }
        departamentoSelect.innerHTML = '<option value="">Selecciona un departamento...</option>' +
            departamentosDisponibles.map(d => `<option value="${d.id}">${d.name || '(sin nombre)'}</option>`).join('');
    }

    // --- Plantillas de Meta ---
    const PLANTILLAS_CACHE_KEY = 'retargeting:plantillas:v3';
    const PLANTILLAS_TTL_MS = 60 * 60 * 1000;

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
        plantillaMediaUrl = null;
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

    // --- Acción masiva: quitar IA a todos los contactos del depto ---
    window.quitarIAATodosDelDepto = async () => {
        const departmentId = departamentoSelect.value;
        const btn = document.getElementById('btnQuitarIA');
        const statusEl = document.getElementById('quitarIAStatus');

        if (!departmentId) {
            alert('Primero selecciona un departamento en el filtro de arriba.');
            return;
        }

        const dept = departamentosDisponibles.find(d => d.id === departmentId);
        const deptName = dept ? dept.name : '(sin nombre)';

        // 1ra confirmación
        if (!confirm(`¿Quitar la IA a TODOS los contactos del departamento "${deptName}" que la tengan activa?\n\n(Esto NO depende del rango de fecha — afecta a TODOS los contactos del depto.)`)) {
            return;
        }

        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Contando...';
        statusEl.textContent = '';
        statusEl.className = 'danger-zone-status';

        try {
            const token = await auth.currentUser.getIdToken();

            // Cuenta primero para confirmar con número exacto
            const countRes = await fetch(`/api/contacts/ia-active-count?departmentId=${encodeURIComponent(departmentId)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const countData = await countRes.json();
            if (!countRes.ok || !countData.success) {
                throw new Error(countData.message || 'Error al contar contactos con IA activa');
            }
            const total = countData.count;

            if (total === 0) {
                statusEl.textContent = `No hay contactos con IA activa en "${deptName}".`;
                statusEl.className = 'danger-zone-status success';
                btn.innerHTML = originalHtml;
                btn.disabled = false;
                return;
            }

            // 2da confirmación con número exacto
            if (!confirm(`Se va a desactivar la IA para ${total} contacto(s) en "${deptName}".\n\n¿Confirmar?`)) {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
                statusEl.textContent = 'Cancelado.';
                return;
            }

            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Desactivando...';

            const res = await fetch('/api/contacts/disable-ia-bulk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ departmentId })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Error al desactivar IA');
            }

            statusEl.innerHTML = `<i class="fas fa-check-circle"></i> IA desactivada para ${data.disabled} contacto(s) de "${deptName}".`;
            statusEl.className = 'danger-zone-status success';
        } catch (e) {
            console.error('Error quitando IA masivo:', e);
            statusEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> Error: ${e.message}`;
            statusEl.className = 'danger-zone-status error';
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    };

    // --- Instrucciones (independientes de la página de Pagados) ---
    async function cargarInstrucciones() {
        try {
            const docSnap = await getDoc(doc(db, 'crm_settings', 'bot_retargeting_nuevos'));
            if (docSnap.exists() && docSnap.data().instructions) {
                instruccionesTA.value = docSnap.data().instructions;
            }
        } catch (e) {
            console.error('Error cargando instrucciones:', e);
        }
    }

    window.guardarInstrucciones = async () => {
        try {
            await setDoc(doc(db, 'crm_settings', 'bot_retargeting_nuevos'), {
                instructions: instruccionesTA.value
            }, { merge: true });
            alert('Instrucciones guardadas.');
        } catch (e) {
            console.error('Error guardando instrucciones:', e);
            alert('Error al guardar.');
        }
    };

    // --- Date pickers (default: últimos 7 días) ---
    const hoy = new Date();
    const hace7 = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);
    const ymd = (d) => d.toISOString().slice(0, 10);

    flatpickr('#fechaInicio', { locale: 'es', dateFormat: 'Y-m-d', defaultDate: ymd(hace7) });
    flatpickr('#fechaFin', { locale: 'es', dateFormat: 'Y-m-d', defaultDate: ymd(hoy) });

    // --- Restaurar desde cache si existe ---
    function restaurarDesdeCache() {
        const cache = loadCache();
        if (!cache) return;
        if (cache.departmentId && departamentosDisponibles.some(d => d.id === cache.departmentId)) {
            departamentoSelect.value = cache.departmentId;
        }
        document.getElementById('fechaInicio')._flatpickr.setDate(cache.inicio);
        document.getElementById('fechaFin')._flatpickr.setDate(cache.fin);
        contactosEncontrados = cache.contacts;
        renderContactos();
        updateCacheInfoUI(cache);
    }

    // --- Buscar contactos nuevos ---
    window.buscarContactos = async (forceRefresh) => {
        const departmentId = departamentoSelect.value;
        const inicio = document.getElementById('fechaInicio').value;
        const fin = document.getElementById('fechaFin').value;
        if (!departmentId) { alert('Selecciona un departamento.'); return; }
        if (!inicio || !fin) { alert('Selecciona ambas fechas.'); return; }

        // Si hay cache válida y mismos parámetros y NO se forzó refresh, usar cache
        if (!forceRefresh) {
            const cache = loadCache();
            const ageOk = cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS;
            if (cache && ageOk && cache.departmentId === departmentId && cache.inicio === inicio && cache.fin === fin) {
                contactosEncontrados = cache.contacts;
                renderContactos();
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
            const url = `/api/retargeting/buscar-nuevos?departmentId=${encodeURIComponent(departmentId)}&startDate=${startDate.getTime()}&endDate=${endDate.getTime()}${forceRefresh ? '&fresh=1' : ''}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error al buscar contactos');

            contactosEncontrados = data.contacts || [];
            saveCache(contactosEncontrados, departmentId, inicio, fin);
            renderContactos();
            updateCacheInfoUI(loadCache(), { fromServerCache: data.fromCache, serverCacheAgeMs: data.cacheAgeMs });
        } catch (e) {
            alert('Error buscando contactos: ' + e.message);
        } finally {
            btnBuscar.disabled = false;
            btnActualizar.disabled = false;
            btnBuscar.innerHTML = originalBuscarText;
        }
    };

    function renderContactos() {
        resultadosBox.style.display = 'block';
        totalContactosSpan.textContent = contactosEncontrados.length;
        actualizarContadoresPedido();

        if (contactosEncontrados.length === 0) {
            listaContactos.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">No hay contactos nuevos provenientes de anuncios en este rango y departamento.</div>';
            contactosSeleccionados.clear();
            actualizarBotonEnviar();
            return;
        }

        const visibles = aplicarOrden(contactosEncontrados.filter(contactoCoincideFiltro));
        visiblesActuales = visibles; // snapshot accesible para el shift+click delegado
        lastCheckedIdx = null; // se reinicia cuando el set visible cambia (filtros/orden)

        // Limpiar selección de contactos que ya no son visibles
        const idsVisibles = new Set(visibles.map(c => c.id));
        for (const id of [...contactosSeleccionados]) {
            if (!idsVisibles.has(id)) contactosSeleccionados.delete(id);
        }

        // Auto-seleccionar visibles no retargetados hoy
        for (const c of visibles) {
            if (!c.retargetadoHoy) contactosSeleccionados.add(c.id);
        }

        if (visibles.length === 0) {
            const PED_LABELS = { con: 'Con pedido', sin: 'Sin pedido', registered: 'Solo registrados', completed: 'Pagados / Fabricar' };
            const motivo = purchaseFilter
                ? `Ningún contacto coincide con el filtro <strong>${PED_LABELS[purchaseFilter] || purchaseFilter}</strong>${ocultarYaEnviados ? ' (y pendientes de retargeting)' : ''}.`
                : (ocultarYaEnviados ? 'Ningún contacto pendiente de retargeting en este rango.' : 'Ningún contacto coincide con los filtros actuales.');
            listaContactos.innerHTML = `<div style="padding:20px;text-align:center;color:#999;">${motivo}</div>`;
            actualizarBotonEnviar();
            return;
        }

        const seleccionablesVisibles = visibles.filter(c => !c.retargetadoHoy).length;
        const seleccionadosVisibles = visibles.filter(c => contactosSeleccionados.has(c.id)).length;
        const allChecked = seleccionablesVisibles > 0 && seleccionadosVisibles === seleccionablesVisibles;

        listaContactos.innerHTML = `
            <div class="select-all-row">
                <label>
                    <input type="checkbox" id="selectAll" ${allChecked ? 'checked' : ''} onchange="toggleSelectAll(this.checked)">
                    <strong>Seleccionar todos (${visibles.length}${ocultarYaEnviados ? ' del filtro' : ''})</strong>
                </label>
                <span class="shift-hint" title="Haz clic en un checkbox y luego Shift+clic en otro para seleccionar/deseleccionar todos los que est&aacute;n en medio."><i class="fas fa-keyboard"></i> Tip: Shift+clic para rango</span>
                <span id="contadorSeleccionados">${contactosSeleccionados.size} seleccionados</span>
            </div>
            <div class="pedido-header nuevos">
                <span class="col-check"></span>
                <span class="col-indice">#</span>
                <span class="col-nombre">Nombre</span>
                <span class="col-anuncio">Anuncio</span>
                <span class="col-mensaje">&Uacute;ltimo mensaje</span>
                <span class="col-fecha" title="Fecha en que el contacto entr&oacute; al departamento (primer mensaje del anuncio)">Entr&oacute; el</span>
                <span class="col-retargeting">Retargeting</span>
                <span class="col-telefono">Tel&eacute;fono</span>
            </div>
        ` + visibles.map((c, idx) => {
            const isChecked = contactosSeleccionados.has(c.id) && !c.retargetadoHoy;
            const yaEnviado = yaRecibioRetargeting(c);
            const retargetingCell = c.retargetadoHoy
                ? '<span class="badge-enviado">Enviado Hoy</span>'
                : (yaEnviado
                    ? `<span class="badge-ya-enviado" title="Última vez: ${c.lastRetargetingDate}"><i class="fas fa-history"></i> ${c.lastRetargetingDate}</span>`
                    : '<span class="muted">—</span>');
            // Fecha de ingreso al departamento (primer mensaje desde el anuncio).
            // Fallback a lastMessageTimestamp solo si cache viejo no trae enteredAt.
            const fechaIngreso = c.enteredAt || c.lastMessageTimestamp;
            const fechaTxt = fechaIngreso
                ? new Date(fechaIngreso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })
                : '';
            const fechaTitle = c.enteredAt
                ? `Entró al depto el ${new Date(c.enteredAt).toLocaleString('es-MX')}`
                : (c.lastMessageTimestamp ? `Último mensaje: ${new Date(c.lastMessageTimestamp).toLocaleString('es-MX')}` : '');
            const escAd = (c.adName || 'Anuncio').replace(/"/g, '&quot;');
            const escMsg = (c.lastMessage || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            // Badge de pedido (estilo corona del CRM)
            let pedidoBadge = '';
            if (c.purchaseStatus === 'completed') {
                const ord = c.lastOrderNumber ? `DH${c.lastOrderNumber}` : 'Pagado / Fabricar';
                const val = c.purchaseValue ? ` · $${Number(c.purchaseValue).toLocaleString('es-MX', { maximumFractionDigits: 0 })}` : '';
                pedidoBadge = `<span class="badge-pedido badge-pedido-completed" title="Pedido ${ord}${val}"><i class="fas fa-crown"></i></span>`;
            } else if (c.purchaseStatus === 'registered') {
                const ord = c.lastOrderNumber ? `DH${c.lastOrderNumber}` : 'Registrado (sin pagar)';
                pedidoBadge = `<span class="badge-pedido badge-pedido-registered" title="Pedido ${ord}"><i class="fas fa-clipboard-list"></i></span>`;
            }

            return `
            <div class="pedido-row nuevos ${c.retargetadoHoy ? 'enviado' : ''} ${yaEnviado && !c.retargetadoHoy ? 'historico' : ''}">
                <input type="checkbox" class="col-check pedido-check" data-id="${c.id}" ${c.retargetadoHoy ? 'disabled' : (isChecked ? 'checked' : '')} onchange="toggleContacto('${c.id}', this.checked)">
                <span class="col-indice">#${idx + 1}</span>
                <span class="col-nombre pedido-producto" title="${(c.name || '').replace(/"/g, '&quot;')}">${pedidoBadge}${c.name || 'Sin nombre'}</span>
                <span class="col-anuncio pedido-anuncio" title="${escAd}"><span class="badge-ad">${escAd}</span></span>
                <span class="col-mensaje pedido-mensaje" title="${escMsg}">${escMsg || '<span class="muted">—</span>'}</span>
                <span class="col-fecha pedido-fecha" title="${fechaTitle}">${fechaTxt}</span>
                <span class="col-retargeting">${retargetingCell}</span>
                <span class="col-telefono pedido-telefono">${c.telefono || 'Sin tel'}</span>
            </div>`;
        }).join('');

        actualizarBotonEnviar();
    }

    window.toggleContacto = (id, checked) => {
        if (checked) contactosSeleccionados.add(id);
        else contactosSeleccionados.delete(id);
        const selectAll = document.getElementById('selectAll');
        const visibles = contactosEncontrados.filter(contactoCoincideFiltro);
        const seleccionablesVisibles = visibles.filter(c => !c.retargetadoHoy).length;
        const seleccionadosVisibles = visibles.filter(c => contactosSeleccionados.has(c.id)).length;
        if (selectAll) selectAll.checked = seleccionablesVisibles > 0 && seleccionadosVisibles === seleccionablesVisibles;
        actualizarBotonEnviar();
    };

    window.toggleSelectAll = (checked) => {
        const visibles = contactosEncontrados.filter(contactoCoincideFiltro);
        if (checked) {
            visibles.filter(c => !c.retargetadoHoy).forEach(c => contactosSeleccionados.add(c.id));
        } else {
            visibles.forEach(c => contactosSeleccionados.delete(c.id));
        }
        document.querySelectorAll('.pedido-check:not(:disabled)').forEach(cb => cb.checked = checked);
        actualizarBotonEnviar();
    };

    // --- Shift+click para seleccionar/deseleccionar un rango (estilo Gmail) ---
    // Listener delegado en listaContactos. Funciona aunque el HTML interno se
    // re-renderee porque el listener vive en el parent.
    listaContactos.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.type !== 'checkbox') return;
        if (!target.classList.contains('pedido-check')) return;
        if (target.disabled) return;

        const id = target.dataset.id;
        if (!id) return;
        const currentIdx = visiblesActuales.findIndex(c => c.id === id);
        if (currentIdx < 0) return;

        // Shift+clic: aplica el estado del checkbox actual a todo el rango
        // entre el último clickeado y este.
        if (e.shiftKey && lastCheckedIdx !== null && lastCheckedIdx !== currentIdx) {
            const min = Math.min(lastCheckedIdx, currentIdx);
            const max = Math.max(lastCheckedIdx, currentIdx);
            const newState = target.checked; // estado YA aplicado al clickeado
            for (let i = min; i <= max; i++) {
                const c = visiblesActuales[i];
                if (!c || c.retargetadoHoy) continue;
                if (newState) contactosSeleccionados.add(c.id);
                else contactosSeleccionados.delete(c.id);
            }
            // Sincroniza el estado visual de TODOS los checkboxes visibles
            document.querySelectorAll('.pedido-check:not(:disabled)').forEach(cb => {
                const cbId = cb.dataset.id;
                cb.checked = contactosSeleccionados.has(cbId);
            });
            // Actualiza el checkbox de "seleccionar todos"
            const selectAll = document.getElementById('selectAll');
            if (selectAll) {
                const seleccionablesVisibles = visiblesActuales.filter(c => !c.retargetadoHoy).length;
                const seleccionadosVisibles = visiblesActuales.filter(c => contactosSeleccionados.has(c.id)).length;
                selectAll.checked = seleccionablesVisibles > 0 && seleccionadosVisibles === seleccionablesVisibles;
            }
            actualizarBotonEnviar();
        }

        // Siempre actualiza el ancla al último clickeado (haya sido shift o no)
        lastCheckedIdx = currentIdx;
    });

    function actualizarBotonEnviar() {
        const count = contactosSeleccionados.size;
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

    function addLog(text, type) {
        const el = document.createElement('div');
        el.className = `log-line ${type || ''}`;
        el.textContent = text;
        logRetargeting.appendChild(el);
        logRetargeting.scrollTop = logRetargeting.scrollHeight;
    }

    // --- Enviar retargeting ---
    window.enviarRetargeting = async () => {
        if (contactosSeleccionados.size === 0) return;

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

        const contactosAEnviar = contactosEncontrados.filter(c => contactosSeleccionados.has(c.id));
        const confirmMsg = esPlantilla
            ? `Se enviará la plantilla "${plantillaSeleccionada.name}" a ${contactosAEnviar.length} contacto(s). ¿Continuar?`
            : `Se enviarán mensajes de retargeting a ${contactosAEnviar.length} contacto(s). ¿Continuar?`;
        if (!confirm(confirmMsg)) return;

        progresoBox.style.display = 'block';
        btnEnviar.disabled = true;
        logRetargeting.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';

        const total = contactosAEnviar.length;
        let processed = 0;

        const batchId = esPlantilla
            ? (window.crypto?.randomUUID?.() || `retn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
            : null;
        const sentBy = auth.currentUser?.email || null;

        try {
            const token = await auth.currentUser.getIdToken();

            for (const contacto of contactosAEnviar) {
                const telefono = contacto.telefono;
                const etiqueta = `${contacto.name || 'sin nombre'} (${telefono})`;
                try {
                    const endpoint = esPlantilla ? '/api/retargeting/enviar-plantilla' : '/api/retargeting/enviar';
                    const body = esPlantilla
                        ? { contactId: telefono, template: plantillaSeleccionada, mediaUrl: plantillaMediaUrl, batchId, batchTotal: total, sentBy }
                        : { contactId: telefono, instructions: instrucciones };
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
                        addLog(`${etiqueta}: Enviado`, 'success');
                        contacto.retargetadoHoy = true;
                        contactosSeleccionados.delete(contacto.id);
                    } else if (result.skipped) {
                        addLog(`${etiqueta}: ${result.reason}`, 'skip');
                    } else {
                        addLog(`${etiqueta}: Error - ${result.message}`, 'error');
                    }
                } catch (err) {
                    addLog(`${etiqueta}: Error de red - ${err.message}`, 'error');
                }

                processed++;
                const pct = Math.round((processed / total) * 100);
                progressBar.style.width = pct + '%';
                progressBar.textContent = pct + '%';
                progresoTexto.textContent = `${processed} / ${total} contactos procesados`;
            }

            progresoTexto.textContent = `Completado: ${processed} / ${total} contactos procesados`;
            document.querySelector('#progresoBox h2').innerHTML = '<i class="fas fa-check-circle" style="color:#16a34a;"></i> Retargeting completado';

            // Actualizar cache con los flags de retargetadoHoy
            const departmentId = departamentoSelect.value;
            const fechaIni = document.getElementById('fechaInicio').value;
            const fechaFin = document.getElementById('fechaFin').value;
            saveCache(contactosEncontrados, departmentId, fechaIni, fechaFin);
            updateCacheInfoUI(loadCache());
            renderContactos();

        } catch (e) {
            alert('Error general: ' + e.message);
        } finally {
            actualizarBotonEnviar();
        }
    };
});
