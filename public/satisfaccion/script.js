import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

    // --- DOM ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const seccionLogin = document.getElementById('seccionLogin');
    const seccionSatisfaccion = document.getElementById('seccionSatisfaccion');
    const formularioLogin = document.getElementById('formularioLogin');
    const mensajeError = document.getElementById('mensajeError');
    const usuarioLogueado = document.getElementById('usuarioLogueado');
    const btnClasificar = document.getElementById('btnClasificar');
    const btnReclasificarRecientes = document.getElementById('btnReclasificarRecientes');
    const btnReclasificar = document.getElementById('btnReclasificar');
    const btnCancelar = document.getElementById('btnCancelar');
    const progresoBox = document.getElementById('progresoBox');
    const progressBar = document.getElementById('progressBar');
    const progresoTexto = document.getElementById('progresoTexto');
    const progresoExtra = document.getElementById('progresoExtra');
    const cntPositivo = document.getElementById('cntPositivo');
    const cntNeutral = document.getElementById('cntNeutral');
    const cntNegativo = document.getElementById('cntNegativo');
    const cntSinSenal = document.getElementById('cntSinSenal');
    const searchInput = document.getElementById('searchInput');
    const listaContainer = document.getElementById('listaContainer');
    const btnCargarMas = document.getElementById('btnCargarMas');
    const cacheInfo = document.getElementById('cacheInfo');

    // --- Estado ---
    let currentLevel = '';
    let currentSearch = '';
    let contacts = [];
    let nextCursor = null;
    let pollTimer = null;
    let searchDebounce = null;
    let currentJobId = null;

    // --- Cache local (24h) ---
    const CACHE_KEY = 'satisfaccion:listado:v1';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    function loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch { return null; }
    }
    function saveCache(payload) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...payload, fetchedAt: Date.now() })); } catch {}
    }
    function formatRelativeTime(ts) {
        const diff = Date.now() - ts;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'hace unos segundos';
        if (mins < 60) return `hace ${mins} min`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `hace ${hrs} h`;
        return `hace ${Math.floor(hrs / 24)} d`;
    }

    // --- Auth ---
    formularioLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        mensajeError.textContent = '';
        try {
            await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value);
        } catch {
            mensajeError.textContent = 'Credenciales incorrectas.';
        }
    });
    onAuthStateChanged(auth, async (user) => {
        loadingOverlay.style.display = 'none';
        if (user) {
            seccionLogin.style.display = 'none';
            seccionSatisfaccion.style.display = 'block';
            usuarioLogueado.textContent = user.email;
            // Restaurar cache local antes de pegarle al servidor
            const cache = loadCache();
            if (cache && cache.contacts) {
                contacts = cache.contacts;
                nextCursor = cache.nextCursor || null;
                if (cache.counts) updateCounts(cache.counts);
                renderLista();
                cacheInfo.textContent = `Cache local: ${formatRelativeTime(cache.fetchedAt)}`;
            }
            // Refrescar en background
            recargarLista(false);
        } else {
            seccionLogin.style.display = 'block';
            seccionSatisfaccion.style.display = 'none';
        }
    });
    window.cerrarSesion = () => signOut(auth);

    // --- Clasificar ---
    window.iniciarClasificacion = async (mode) => {
        const audience = document.querySelector('input[name="audience"]:checked')?.value || 'pagado';

        if (audience === 'all' && !confirm('OJO: vas a procesar TODA la base de contacts_whatsapp (80k+ contactos, incluyendo spam y leads sin compra). Costo estimado: ~$80 USD. Continuar?')) return;
        if (mode === 'all' && !confirm('Esto va a re-clasificar TODAS las conversaciones del alcance seleccionado (incluso las ya clasificadas). Continuar?')) return;
        if (mode === 'recent-activity' && !confirm('Esto va a re-clasificar solo contactos que recibieron mensajes despues de la ultima clasificacion. Continuar?')) return;

        setBotonesDisabled(true);
        progresoBox.style.display = 'block';
        progresoTexto.textContent = 'Iniciando job...';
        progresoExtra.textContent = `Alcance: ${audience === 'pagado' ? 'solo con pedido Pagado' : 'TODA la base'} · Modo: ${mode}`;
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
        if (btnCancelar) btnCancelar.style.display = 'inline-flex';
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/satisfaccion/clasificar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ mode, audience })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error iniciando');
            currentJobId = data.jobId;
            pollProgreso(data.jobId);
        } catch (e) {
            alert('Error: ' + e.message);
            setBotonesDisabled(false);
            if (btnCancelar) btnCancelar.style.display = 'none';
        }
    };

    window.cancelarJob = async () => {
        if (!currentJobId) return;
        if (!confirm('Cancelar el job? Los contactos ya procesados quedan clasificados; los que esten en vuelo a Gemini terminan, pero no se inician nuevos.')) return;
        btnCancelar.disabled = true;
        btnCancelar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelando...';
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/satisfaccion/cancelar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ jobId: currentJobId })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Error cancelando');
            progresoTexto.textContent = 'Cancelacion solicitada. Esperando a que terminen los workers en vuelo...';
        } catch (e) {
            alert('Error: ' + e.message);
            btnCancelar.disabled = false;
            btnCancelar.innerHTML = '<i class="fas fa-stop"></i> Cancelar';
        }
    };

    function setBotonesDisabled(disabled) {
        btnClasificar.disabled = disabled;
        if (btnReclasificarRecientes) btnReclasificarRecientes.disabled = disabled;
        btnReclasificar.disabled = disabled;
    }

    function pollProgreso(jobId) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(async () => {
            try {
                const token = await auth.currentUser.getIdToken();
                const res = await fetch(`/api/satisfaccion/progreso?jobId=${encodeURIComponent(jobId)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.message);
                const pct = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
                progressBar.style.width = pct + '%';
                progressBar.textContent = pct + '%';
                progresoTexto.textContent = `${data.processed} / ${data.total} procesados${data.errors > 0 ? ` · ${data.errors} errores` : ''}`;
                const etaTxt = data.etaSeconds != null ? ` · ETA ${Math.floor(data.etaSeconds/60)}m ${data.etaSeconds%60}s` : '';
                const tokTxt = data.tokens?.input ? ` · ~${(data.tokens.input/1000).toFixed(1)}K tokens entrada` : '';
                progresoExtra.textContent = `Llamadas IA: ${data.aiCalls || 0}${etaTxt}${tokTxt}`;
                if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
                    clearInterval(pollTimer);
                    pollTimer = null;
                    setBotonesDisabled(false);
                    if (btnCancelar) {
                        btnCancelar.style.display = 'none';
                        btnCancelar.disabled = false;
                        btnCancelar.innerHTML = '<i class="fas fa-stop"></i> Cancelar';
                    }
                    currentJobId = null;
                    if (data.status === 'error') {
                        progresoTexto.textContent = `Error: ${data.error || 'desconocido'}`;
                    } else if (data.status === 'cancelled') {
                        progresoTexto.textContent = `Cancelado: ${data.processed} de ${data.total} clasificados antes de detener.`;
                    } else {
                        progresoTexto.textContent = `Completado: ${data.processed} clasificados (${data.errors} errores)`;
                    }
                    // Refrescar el listado forzando bypass de cache
                    recargarLista(true);
                }
            } catch (e) {
                console.error('Error polling:', e);
            }
        }, 2500);
    }

    // --- Listado ---
    window.setLevelFilter = (level) => {
        currentLevel = level;
        document.querySelectorAll('.chip').forEach(c => c.classList.toggle('chip-active', c.dataset.level === level));
        recargarLista(false);
    };

    window.onSearchInput = () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            recargarLista(false);
        }, 300);
    };

    window.recargarLista = async (forceFresh) => {
        nextCursor = null;
        contacts = [];
        await fetchPagina(forceFresh);
    };

    window.cargarMas = async () => {
        if (!nextCursor) return;
        await fetchPagina(false, true);
    };

    async function fetchPagina(forceFresh, append = false) {
        try {
            const token = await auth.currentUser.getIdToken();
            const params = new URLSearchParams();
            if (currentLevel) params.set('level', currentLevel);
            if (currentSearch) params.set('search', currentSearch);
            params.set('limit', '200');
            if (append && nextCursor) params.set('cursor', nextCursor);
            if (forceFresh) params.set('fresh', '1');

            listaContainer.classList.add('cargando');
            const res = await fetch(`/api/satisfaccion/listado?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error');

            if (append) {
                contacts = contacts.concat(data.contacts);
            } else {
                contacts = data.contacts;
            }
            nextCursor = data.nextCursor || null;

            if (data.counts) updateCounts(data.counts);
            renderLista();

            if (!currentLevel && !currentSearch) {
                saveCache({ contacts, nextCursor, counts: data.counts });
            }

            const cacheOrigin = data.fromCache ? `caché del servidor (${formatRelativeTime(Date.now() - (data.cacheAgeMs||0))})` : 'recién leído';
            cacheInfo.textContent = `${contacts.length} cargados · ${cacheOrigin}`;
        } catch (e) {
            listaContainer.innerHTML = `<div class="empty-state" style="color:#dc2626;">Error: ${e.message}</div>`;
        } finally {
            listaContainer.classList.remove('cargando');
        }
    }

    function updateCounts(counts) {
        if (!counts) return;
        cntPositivo.textContent = counts.positivo ?? '-';
        cntNeutral.textContent = counts.neutral ?? '-';
        cntNegativo.textContent = counts.negativo ?? '-';
        cntSinSenal.textContent = counts.sin_senal ?? '-';
    }

    function renderLista() {
        btnCargarMas.style.display = nextCursor ? 'inline-flex' : 'none';
        if (!contacts.length) {
            listaContainer.innerHTML = `<div class="empty-state"><i class="fas fa-info-circle"></i> No hay contactos${currentLevel ? ` con nivel ${currentLevel}` : ''}.</div>`;
            return;
        }
        const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'2-digit' }) : '-';
        const rows = contacts.map(c => {
            const lvl = c.satisfaction?.level || 'sin_clasificar';
            const lvlText = lvl === 'sin_clasificar' ? 'Pendiente' : lvl.replace('_', ' ');
            const reason = c.satisfaction?.reason || (lvl === 'sin_clasificar' ? '(aun no clasificado)' : '');
            const safeName = (c.name || '').replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
            const safeReason = reason.replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
            return `<div class="lista-row">
                <span class="telefono">${c.id}</span>
                <span class="nombre">${safeName || '<i style="color:#9ca3af;">Sin nombre</i>'}</span>
                <span><span class="badge-nivel badge-${lvl}">${lvlText}</span></span>
                <span class="razon" title="${safeReason}">${safeReason}</span>
                <span class="fecha">${fmtDate(c.satisfaction?.classifiedAt || c.lastMessageTimestamp)}</span>
                <span class="acciones">
                    <button class="btn-secondary" onclick="abrirChat('${c.id}')" title="Abrir chat en CRM"><i class="fas fa-comment"></i></button>
                </span>
            </div>`;
        }).join('');
        listaContainer.innerHTML = `
            <div class="lista-header">
                <span>Telefono</span>
                <span>Nombre</span>
                <span>Nivel</span>
                <span>Razon</span>
                <span>Fecha</span>
                <span></span>
            </div>
            ${rows}
        `;
    }

    window.abrirChat = (phone) => {
        // Guardamos el contacto a abrir en localStorage; el CRM principal puede leerlo en el futuro.
        try { localStorage.setItem('crm:deeplinkContact', phone); } catch {}
        window.open('/', '_blank');
    };
});
