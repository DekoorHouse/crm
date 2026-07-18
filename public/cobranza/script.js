import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

    // DOM
    const loadingOverlay = document.getElementById('loading-overlay');
    const seccionLogin = document.getElementById('seccionLogin');
    const seccionCobranza = document.getElementById('seccionCobranza');
    const formularioLogin = document.getElementById('formularioLogin');
    const mensajeError = document.getElementById('mensajeError');
    const usuarioLogueado = document.getElementById('usuarioLogueado');
    const instruccionesTA = document.getElementById('instruccionesIA');
    const resultadosBox = document.getElementById('resultadosBox');
    const listaPedidos = document.getElementById('listaPedidos');
    const totalPedidosSpan = document.getElementById('totalPedidos');
    const btnEnviar = document.getElementById('btnEnviarCobranza');
    const progresoBox = document.getElementById('progresoBox');
    const progressBar = document.getElementById('progressBar');
    const progresoTexto = document.getElementById('progresoTexto');
    const logCobranza = document.getElementById('logCobranza');

    let pedidosEncontrados = [];
    let pedidosSeleccionados = new Set();

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
            seccionCobranza.style.display = 'block';
            usuarioLogueado.textContent = user.email;
            await cargarInstrucciones();
            await cargarCobranzaAuto();
        } else {
            seccionLogin.style.display = 'block';
            seccionCobranza.style.display = 'none';
        }
    });

    window.cerrarSesion = () => signOut(auth);

    // --- Instrucciones ---
    async function cargarInstrucciones() {
        try {
            const docSnap = await getDoc(doc(db, 'crm_settings', 'bot_cobranza'));
            if (docSnap.exists() && docSnap.data().instructions) {
                instruccionesTA.value = docSnap.data().instructions;
            }
        } catch (e) {
            console.error('Error cargando instrucciones:', e);
        }
    }

    window.guardarInstrucciones = async () => {
        try {
            await setDoc(doc(db, 'crm_settings', 'bot_cobranza'), {
                instructions: instruccionesTA.value
            }, { merge: true });
            alert('Instrucciones guardadas.');
        } catch (e) {
            console.error('Error guardando instrucciones:', e);
            alert('Error al guardar.');
        }
    };

    // --- Cobranza automática (Andrea) ---
    // Config en crm_settings/cobranza_auto; el scheduler del servidor la lee cada 15 min.
    // Dos pases diarios: mañana (cobros 2..4, cancelaciones) y vespertino (cobro 1 del
    // mismo día de la foto). El reporte diario trae un campo por pase: {manana, tarde}.
    function llenarHoras(sel, desde, hasta) {
        if (!sel || sel.options.length) return;
        for (let h = desde; h <= hasta; h++) {
            const opt = document.createElement('option');
            opt.value = h;
            opt.textContent = `${h}:00`;
            sel.appendChild(opt);
        }
    }

    // El tope se guarda en maxPerRun; 0 = SIN tope (ilimitado). El checkbox "Sin tope"
    // deshabilita el campo numérico para que se vea claro cuál manda.
    function syncTopeUI() {
        const sinTope = document.getElementById('autoSinTope');
        const tope = document.getElementById('autoTope');
        if (sinTope && tope) tope.disabled = sinTope.checked;
    }

    async function cargarCobranzaAuto() {
        const selHora = document.getElementById('autoHora');
        const selHoraTarde = document.getElementById('autoHoraTarde');
        llenarHoras(selHora, 6, 22);
        llenarHoras(selHoraTarde, 14, 22);
        const sinTopeChk = document.getElementById('autoSinTope');
        if (sinTopeChk) sinTopeChk.onchange = syncTopeUI;
        try {
            const cfgSnap = await getDoc(doc(db, 'crm_settings', 'cobranza_auto'));
            const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
            document.getElementById('autoEnabled').checked = cfg.enabled === true;
            if (selHora) selHora.value = Number.isFinite(Number(cfg.hour)) ? Number(cfg.hour) : 11;
            if (selHoraTarde) selHoraTarde.value = Number.isFinite(Number(cfg.eveningHour)) ? Number(cfg.eveningHour) : 19;
            const sinTope = Number(cfg.maxPerRun) === 0; // 0 = ilimitado
            if (sinTopeChk) sinTopeChk.checked = sinTope;
            document.getElementById('autoTope').value = Number(cfg.maxPerRun) > 0 ? Number(cfg.maxPerRun) : 40;
            document.getElementById('autoVentana').value = Number(cfg.lookbackDays) > 0 ? Number(cfg.lookbackDays) : 30;
            syncTopeUI();
        } catch (e) {
            console.error('Error cargando config de cobranza automática:', e);
        }
        // Si al abrir la página hay una corrida EN MARCHA (disparada antes de cerrar, o un
        // pase automático), engancharse al seguimiento en vivo en vez de mostrarla congelada.
        const enCurso = await cargarUltimaCorrida();
        if (enCurso) iniciarLogsEnVivo();
    }

    // Pinta el resumen de la última corrida Y los logs por pase (detalle). Devuelve true si
    // algún pase sigue corriendo (enCurso), para que el refresco en vivo sepa cuándo parar.
    async function cargarUltimaCorrida() {
        const box = document.getElementById('autoUltimaCorrida');
        const logsBox = document.getElementById('autoDetalleLogs');
        if (!box) return false;
        let algunoEnCurso = false;
        try {
            const q = query(collection(db, 'cobranza_runs'), orderBy('date', 'desc'), limit(1));
            const snap = await getDocs(q);
            if (snap.empty) {
                box.innerHTML = '<i class="fas fa-info-circle"></i> A&uacute;n no hay corridas autom&aacute;ticas.';
                if (logsBox) logsBox.style.display = 'none';
                return false;
            }
            const r = snap.docs[0].data();
            // Estructura nueva: {date, manana:{...}, tarde:{...}}. Compat: docs viejos planos.
            const pases = [];
            if (r.manana) pases.push(['mañana', r.manana]);
            if (r.tarde) pases.push(['tarde', r.tarde]);
            if (!pases.length && (r.enviados != null || r.error)) pases.push(['corrida', r]);

            const tot = { enviados: 0, cancelados: 0, vencidos: 0, saltados: 0, esperando: 0, errores: 0 };
            const errs = [];
            const porPase = [];
            for (const [nombre, p] of pases) {
                for (const k of Object.keys(tot)) tot[k] += Number(p[k]) || 0;
                if (p.error) errs.push(`${nombre}: ${p.error}`);
                if (p.enCurso) algunoEnCurso = true;
                porPase.push(`${nombre}: ${p.enviados || 0} enviado(s)${p.enCurso ? ' ⏳ corriendo…' : ''}`);
            }
            const errHtml = errs.length ? ` &middot; <span style="color:#dc2626;">⚠ ${errs.map(esc).join(' | ')}</span>` : '';
            box.innerHTML = `<i class="fas fa-history"></i> <b>&Uacute;ltima corrida (${esc(r.date)}):</b> ` +
                `${tot.enviados} cobros enviados (${porPase.map(esc).join(' &middot; ') || 'sin pases'}) &middot; ` +
                `${tot.cancelados} cancelados &middot; ${tot.vencidos} vencidos (revisar manual) &middot; ` +
                `${tot.saltados} saltados &middot; ${tot.esperando} en espera de su d&iacute;a &middot; ${tot.errores} errores${errHtml}`;

            // Logs por pase (el detalle que el servidor va escribiendo en vivo)
            if (logsBox) {
                const parts = [];
                for (const [nombre, p] of pases) {
                    if (!Array.isArray(p.detalle) || !p.detalle.length) continue;
                    parts.push(`<div style="font-weight:700; margin-top:4px;">Pase ${esc(nombre)}${p.enCurso ? ' — ⏳ corriendo…' : ''} · ${p.enviados || 0} enviados de ${p.candidatos || 0} candidatos</div>`);
                    for (const d of p.detalle) {
                        parts.push(`<div>• <b>${esc(d.pedidos || '')}</b> ${esc(d.contactId || '')} — ${esc(d.resultado || '')}</div>`);
                    }
                }
                logsBox.innerHTML = parts.join('');
                logsBox.style.display = parts.length ? 'block' : 'none';
                if (algunoEnCurso) logsBox.scrollTop = logsBox.scrollHeight;
            }
        } catch (e) {
            console.error('Error cargando última corrida:', e);
            box.textContent = 'No se pudo cargar la última corrida.';
        }
        return algunoEnCurso;
    }

    // --- Corridas manuales: VISTA PREVIA → confirmar → logs en vivo ---
    // Al pulsar un botón de pase primero se pide la vista previa (/cobranza/auto/preview):
    // la lista de candidatos y qué les pasaría, SIN enviar nada. Solo al confirmar se
    // dispara la corrida real (/cobranza/auto/run) y abajo se van mostrando los logs
    // en vivo (el servidor escribe el avance en cobranza_runs mientras corre).
    let refreshTimer = null;
    let previewPass = null;
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nombrePase = (pass) => pass === 'tarde' ? 'vespertino' : 'de la mañana';

    window.cancelarPreview = () => {
        previewPass = null;
        const box = document.getElementById('autoPreviewBox');
        if (box) box.style.display = 'none';
    };

    window.correrPaseManual = async (pass) => {
        // La corrida usa la configuración GUARDADA en el servidor. Si los campos de la
        // página difieren de lo guardado (ej. palomeó "Sin tope" sin guardar), avisar y
        // no correr: evita corridas con un tope/ventana que el usuario cree ya cambiado.
        try {
            const cfgSnap = await getDoc(doc(db, 'crm_settings', 'cobranza_auto'));
            const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
            const savedSinTope = Number(cfg.maxPerRun) === 0;
            const savedTope = Number(cfg.maxPerRun) > 0 ? Number(cfg.maxPerRun) : 40;
            const savedVentana = Number(cfg.lookbackDays) > 0 ? Number(cfg.lookbackDays) : 30;
            const uiSinTope = document.getElementById('autoSinTope').checked;
            const uiTope = Math.max(1, Math.min(200, Number(document.getElementById('autoTope').value) || 40));
            const uiVentana = Math.max(5, Math.min(90, Number(document.getElementById('autoVentana').value) || 30));
            const difiere = (uiSinTope !== savedSinTope) || (!uiSinTope && uiTope !== savedTope) || (uiVentana !== savedVentana);
            if (difiere) {
                alert('Tienes cambios de configuración SIN GUARDAR (tope o ventana de días). La corrida usa la configuración GUARDADA.\n\nPresiona "Guardar configuración automática" primero y vuelve a intentar.');
                return;
            }
        } catch (_) { /* si no se pudo comparar, la vista previa mostrará la config efectiva */ }

        const box = document.getElementById('autoPreviewBox');
        const titulo = document.getElementById('autoPreviewTitulo');
        const lista = document.getElementById('autoPreviewLista');
        const btnConf = document.getElementById('btnConfirmarCorrida');
        const btnM = document.getElementById('btnCorrerManana');
        const btnT = document.getElementById('btnCorrerTarde');
        previewPass = null;
        box.style.display = 'block';
        titulo.textContent = `Vista previa — pase ${nombrePase(pass)}`;
        lista.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando candidatos (leyendo conversaciones)…';
        btnConf.disabled = true;
        try {
            btnM.disabled = true; btnT.disabled = true;
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/cobranza/auto/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ pass })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'No se pudo cargar la vista previa.');

            const r = data.resumen || {};
            const aCobrar = r.cobrar || 0;
            const topeTxt = (data.tope && aCobrar > data.tope) ? ` (por el tope de hoy se cobrará máximo a ${data.tope})` : '';
            titulo.textContent = `Vista previa — pase ${nombrePase(pass)} · ventana ${data.lookbackDays} días · ` +
                (data.tope ? `tope: ${data.tope}` : 'SIN tope') +
                (data.alreadyRanToday ? ' · ⚠ este pase YA corrió hoy' : '');

            const GRUPOS = [
                ['cobrar',   `✅ Se les cobrará (${r.cobrar || 0})${topeTxt}`],
                ['cancelar', `🛑 Se CANCELARÁN (${r.cancelar || 0})`],
                ['vencer',   `📤 Saldrán a revisión manual (${r.vencer || 0})`],
                ['saltar',   `⏸ Saltados (${r.saltar || 0})`],
                ['esperar',  `⏳ Esperando su día del ciclo (${r.esperar || 0})`]
            ];
            const parts = [];
            for (const [accion, encabezado] of GRUPOS) {
                const rows = (data.items || []).filter(i => i.accion === accion);
                if (!rows.length) continue;
                parts.push(`<div style="font-weight:700; margin-top:6px;">${encabezado}</div>`);
                for (const it of rows) {
                    parts.push(`<div>• <b>${esc(it.pedidos)}</b> · ${esc(it.contactId)} — ${esc(it.motivo || '')}</div>`);
                }
            }
            lista.innerHTML = parts.length ? parts.join('') : 'No hay candidatos para este pase ahora mismo.';

            const acciones = (r.cobrar || 0) + (r.cancelar || 0) + (r.vencer || 0);
            document.getElementById('btnConfirmarTxt').textContent = acciones > 0
                ? `Confirmar y ejecutar (${acciones} acción${acciones === 1 ? '' : 'es'})`
                : 'Nada que ejecutar';
            btnConf.disabled = acciones === 0;
            previewPass = pass;
        } catch (e) {
            console.error('Error en vista previa:', e);
            lista.innerHTML = `<span style="color:#dc2626;">Error: ${esc(e.message)}</span>`;
        } finally {
            btnM.disabled = false; btnT.disabled = false;
        }
    };

    window.confirmarCorridaManual = async () => {
        if (!previewPass) return;
        const pass = previewPass;
        const btnConf = document.getElementById('btnConfirmarCorrida');
        try {
            btnConf.disabled = true;
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/cobranza/auto/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ pass })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'No se pudo iniciar la corrida.');
            window.cancelarPreview();
            alert(`Corrida ${nombrePase(pass)} iniciada. Abajo verás el avance y los logs en vivo.`);
            iniciarLogsEnVivo();
        } catch (e) {
            console.error('Error al iniciar corrida manual:', e);
            alert('Error: ' + e.message);
        } finally {
            btnConf.disabled = false;
        }
    };

    // Refresca resumen + logs cada 6s mientras el servidor reporte enCurso (máx ~5 min).
    function iniciarLogsEnVivo() {
        if (refreshTimer) clearInterval(refreshTimer);
        let ticks = 0, quietas = 0;
        cargarUltimaCorrida();
        refreshTimer = setInterval(async () => {
            const enCurso = await cargarUltimaCorrida();
            quietas = enCurso ? 0 : quietas + 1;
            if (quietas >= 2 || ++ticks >= 50) { clearInterval(refreshTimer); refreshTimer = null; }
        }, 6000);
    }

    window.guardarCobranzaAuto = async () => {
        try {
            const enabled = document.getElementById('autoEnabled').checked;
            const hour = Number(document.getElementById('autoHora').value);
            const eveningHour = Number(document.getElementById('autoHoraTarde').value);
            const sinTope = document.getElementById('autoSinTope').checked;
            // 0 = sin tope (el scheduler lo interpreta como ilimitado)
            const maxPerRun = sinTope ? 0 : Math.max(1, Math.min(200, Number(document.getElementById('autoTope').value) || 40));
            // Ventana de búsqueda de pedidos (días desde su creación), acotada 5-90 igual que el servidor.
            const lookbackDays = Math.max(5, Math.min(90, Number(document.getElementById('autoVentana').value) || 30));
            if (enabled && !instruccionesTA.value.trim()) {
                alert('Escribe y guarda primero las instrucciones de la IA: la cobranza automática las necesita.');
                return;
            }
            if (enabled && sinTope && !confirm('Vas a dejar la cobranza SIN tope de envíos: cobrará a TODOS los pedidos que toquen ese día (la primera corrida puede ser un volumen alto de mensajes y plantillas). ¿Confirmas?')) {
                return;
            }
            await setDoc(doc(db, 'crm_settings', 'cobranza_auto'), { enabled, hour, eveningHour, maxPerRun, lookbackDays }, { merge: true });
            alert(enabled
                ? `Cobranza automática ENCENDIDA. Pase de la mañana a las ${hour}:00 y vespertino a las ${eveningHour}:00 (hora MX), ${sinTope ? 'SIN tope de envíos' : `máximo ${maxPerRun} cobros por día`}, cobrando pedidos de los últimos ${lookbackDays} días.`
                : 'Cobranza automática APAGADA.');
        } catch (e) {
            console.error('Error guardando config de cobranza automática:', e);
            alert('Error al guardar la configuración.');
        }
    };

    // --- Date pickers ---
    flatpickr('#fechaInicio', { locale: 'es', dateFormat: 'Y-m-d', defaultDate: 'today' });
    flatpickr('#fechaFin', { locale: 'es', dateFormat: 'Y-m-d', defaultDate: 'today' });

    // --- Buscar pedidos ---
    window.buscarPedidos = async () => {
        const inicio = document.getElementById('fechaInicio').value;
        const fin = document.getElementById('fechaFin').value;
        if (!inicio || !fin) { alert('Selecciona ambas fechas.'); return; }

        const startDate = new Date(inicio + 'T00:00:00');
        const endDate = new Date(fin + 'T23:59:59.999');

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/api/cobranza/buscar-pedidos?startDate=${startDate.getTime()}&endDate=${endDate.getTime()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            // Excluir pedidos que no requieren cobranza (incluye "Diseñado" y los que no tienen estatus)
            const excluidos = new Set(['pagado', 'fabricar', 'cancelado', 'corregido', 'corregir', 'diseñado', 'sin estatus']);
            pedidosEncontrados = data.orders.filter(p => {
                const estatus = (p.estatus || '').toLowerCase().trim();
                if (!estatus) return false; // "Sin estatus"
                return !excluidos.has(estatus);
            });
            renderPedidos();
        } catch (e) {
            alert('Error buscando pedidos: ' + e.message);
        }
    };

    function renderPedidos() {
        resultadosBox.style.display = 'block';
        totalPedidosSpan.textContent = pedidosEncontrados.length;

        if (pedidosEncontrados.length === 0) {
            listaPedidos.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">No se encontraron pedidos en este rango.</div>';
            pedidosSeleccionados.clear();
            actualizarBotonEnviar();
            return;
        }

        // Seleccionar todos por default (excepto los ya cobrados hoy)
        pedidosSeleccionados = new Set(pedidosEncontrados.filter(p => !p.cobradoHoy).map(p => p.id));

        listaPedidos.innerHTML = `
            <div class="select-all-row">
                <label>
                    <input type="checkbox" id="selectAll" checked onchange="toggleSelectAll(this.checked)">
                    <strong>Seleccionar todos (${pedidosEncontrados.length})</strong>
                </label>
                <span id="contadorSeleccionados">${pedidosEncontrados.length} seleccionados</span>
            </div>
        ` + pedidosEncontrados.map(p => `
            <div class="pedido-item ${p.cobradoHoy ? 'cobrado' : ''}">
                <input type="checkbox" class="pedido-check" data-id="${p.id}" ${p.cobradoHoy ? 'disabled' : 'checked'} onchange="togglePedido('${p.id}', this.checked)">
                <div class="pedido-info">
                    <span class="pedido-numero">DH${p.consecutiveOrderNumber || '?'}</span>
                    <span class="pedido-producto">${p.producto || 'Sin producto'}</span>
                    <span class="pedido-fecha">${p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : ''}</span>
                    <span class="pedido-estatus">${p.estatus || 'Sin estatus'}</span>
                    ${p.cobradoHoy ? '<span class="badge-cobrado">Cobrado Hoy</span>' : ''}
                </div>
                <span class="pedido-telefono">${p.telefono || 'Sin tel'}</span>
            </div>
        `).join('');

        actualizarBotonEnviar();
    }

    window.togglePedido = (id, checked) => {
        if (checked) pedidosSeleccionados.add(id);
        else pedidosSeleccionados.delete(id);
        // Actualizar checkbox "Seleccionar todos"
        const selectAll = document.getElementById('selectAll');
        if (selectAll) selectAll.checked = pedidosSeleccionados.size === pedidosEncontrados.length;
        actualizarBotonEnviar();
    };

    window.toggleSelectAll = (checked) => {
        if (checked) pedidosSeleccionados = new Set(pedidosEncontrados.filter(p => !p.cobradoHoy).map(p => p.id));
        else pedidosSeleccionados.clear();
        document.querySelectorAll('.pedido-check:not(:disabled)').forEach(cb => cb.checked = checked);
        actualizarBotonEnviar();
    };

    function actualizarBotonEnviar() {
        const count = pedidosSeleccionados.size;
        btnEnviar.disabled = count === 0;
        btnEnviar.innerHTML = count > 0
            ? `<i class="fas fa-paper-plane"></i> Enviar Cobranza (${count})`
            : `<i class="fas fa-paper-plane"></i> Enviar Cobranza Masiva`;
        const contador = document.getElementById('contadorSeleccionados');
        if (contador) contador.textContent = `${count} seleccionados`;
    }

    // --- Enviar cobranza ---
    window.enviarCobranza = async () => {
        if (pedidosSeleccionados.size === 0) return;

        const instrucciones = instruccionesTA.value.trim();
        if (!instrucciones) { alert('Escribe las instrucciones de IA primero.'); return; }

        const pedidosAEnviar = pedidosEncontrados.filter(p => pedidosSeleccionados.has(p.id));
        if (!confirm(`Se enviarán mensajes de cobranza a ${pedidosAEnviar.length} pedidos (${new Set(pedidosAEnviar.map(p => p.telefono)).size} contactos). ¿Continuar?`)) return;

        // Mostrar progreso
        progresoBox.style.display = 'block';
        btnEnviar.disabled = true;
        logCobranza.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';

        const telefonos = [...new Set(pedidosAEnviar.map(p => p.telefono).filter(Boolean))];
        const total = telefonos.length;
        let processed = 0;

        try {
            const token = await auth.currentUser.getIdToken();

            for (const telefono of telefonos) {
                const pedidosDeContacto = pedidosAEnviar.filter(p => p.telefono === telefono);
                const orderNumbers = pedidosDeContacto.map(p => `DH${p.consecutiveOrderNumber}`).join(', ');

                try {
                    const res = await fetch('/api/cobranza/enviar', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            contactId: telefono,
                            instructions: instrucciones,
                            orderNumbers: pedidosDeContacto.map(p => p.consecutiveOrderNumber)
                        })
                    });
                    const result = await res.json();

                    if (result.success) {
                        addLog(`${orderNumbers} (${telefono}): Enviado`, 'success');
                        // Marcar como cobrado hoy en la lista local
                        pedidosEncontrados.filter(p => p.telefono === telefono).forEach(p => {
                            p.cobradoHoy = true;
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
            document.querySelector('#progresoBox h2').innerHTML = '<i class="fas fa-check-circle" style="color:#16a34a;"></i> Cobranza completada';

            // Re-renderizar lista para mostrar badges "Cobrado Hoy"
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
        logCobranza.appendChild(entry);
        logCobranza.scrollTop = logCobranza.scrollHeight;
    }
});
