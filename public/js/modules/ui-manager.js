// --- START: UI Management & View Rendering ---
// Este archivo se encarga de la navegación, renderizado de vistas,
// y la manipulación de componentes de UI como modales, pickers, etc.

let ticking = false; // For scroll event throttling
let tagsSortable = null;
let adMetricsPicker = null; // Variable para la instancia del datepicker de métricas de Ad ID
let aiCountdownInterval = null; // Intervalo para la cuenta regresiva de la IA (declarado arriba para evitar TDZ)

// --- Navigation & Main View Rendering ---
function navigateTo(viewName, force = false) {
    // Difusión y Conversión se fusionaron en el hub "Campañas" como sub-pestañas.
    let campaignSubtab = null;
    if (viewName === 'difusion') { campaignSubtab = 'difusion'; viewName = 'campanas'; }
    else if (viewName === 'conversion-campanas') { campaignSubtab = 'resultados'; viewName = 'campanas'; }
    if (campaignSubtab) state.campaignTab = campaignSubtab;

    // Entrenamiento, Simulador y Rescate se fusionaron en el hub "IA" como sub-pestañas.
    let iaSubtab = null;
    if (viewName === 'entrenamiento-ia') { iaSubtab = 'entrenamiento'; viewName = 'ia'; }
    else if (viewName === 'simulador-ia') { iaSubtab = 'simulador'; viewName = 'ia'; }
    else if (viewName === 'rescate-ia') { iaSubtab = 'rescate'; viewName = 'ia'; }
    if (iaSubtab) state.iaTab = iaSubtab;

    if (state.activeView === viewName && !force) {
        // Ya estamos en el hub: solo cambiar de sub-pestaña.
        if (campaignSubtab && typeof switchCampaignTab === 'function') switchCampaignTab(campaignSubtab);
        if (iaSubtab && typeof switchIaTab === 'function') switchIaTab(iaSubtab);
        return;
    }

    // Cerramos el sidebar en móvil al navegar
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('main-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
    }
    // Al cambiar de vista limpiamos el flag de chat-open (esconde app-header)
    if (viewName !== 'chats') {
        document.body.classList.remove('chat-open');
    }

    state.activeView = viewName;



    // Actualiza la barra lateral
    document.querySelectorAll('#main-sidebar .nav-item').forEach(item => {
        const isDirectMatch = item.dataset.view === viewName;
        item.classList.toggle('active', isDirectMatch);
    });



    // Renderiza la vista principal
    const mainViewContainer = document.getElementById('main-view-container');
    switch (viewName) {
        case 'chats':
            mainViewContainer.innerHTML = ChatViewTemplate();
            renderChatWindow(); // Renderiza la ventana de chat vacía o con el contacto seleccionado
            renderTagFilters(); // Dibuja los filtros de etiqueta
            setupChatListEventListeners(); // Añade scroll infinito, etc.
            scheduleContactListRender(); // Renderiza la lista de contactos inicial
            break;
        case 'contacts':
            // "Contactos" se fusionó en la vista Clientes (pestaña Contactos).
            state.activeView = 'clientes';
            state.crmTab = 'contactos';
            mainViewContainer.innerHTML = ClientesViewTemplate();
            loadCrmView();
            break;
        case 'clientes':
            if (!['clientes', 'leads', 'contactos'].includes(state.crmTab)) state.crmTab = 'clientes';
            mainViewContainer.innerHTML = ClientesViewTemplate();
            loadCrmView(); // Carga conteos + lista de la pestaña activa
            break;
        case 'envios':
            mainViewContainer.innerHTML = EnviosViewTemplate();
            renderEnviosView(); // Carga la tabla de pedidos con comprobante validado
            break;
        // --- NUEVAS VISTAS ---
        case 'departments':
            mainViewContainer.innerHTML = DepartmentsViewTemplate();
            renderDepartmentsView(); // Dibuja la tabla de departamentos
            break;
        case 'ad-routing':
            mainViewContainer.innerHTML = AdRoutingViewTemplate();
            renderAdRoutingView(); // Dibuja la tabla de reglas
            break;
        // ---------------------
        case 'etiquetas':
            mainViewContainer.innerHTML = TagsViewTemplate();
            renderTagsView(); // Dibuja la tabla de etiquetas
            break;
        case 'campanas':
        case 'campanas-imagen': // alias: la sección con imagen se fusionó en "Campañas"
            mainViewContainer.innerHTML = CampaignsViewTemplate();
            renderCampaignsView(); // Prepara el panel "Enviar campaña"
            // Abre la sub-pestaña recordada (Difusión/Resultados se cargan diferido).
            if (typeof switchCampaignTab === 'function') switchCampaignTab(state.campaignTab || 'enviar');
            break;
        case 'mensajes-ads':
            mainViewContainer.innerHTML = MensajesAdsViewTemplate();
            renderAdResponsesView(); // Dibuja la tabla de mensajes por Ad
            break;

        case 'respuestas-rapidas':
            mainViewContainer.innerHTML = QuickRepliesViewTemplate();
            renderQuickRepliesView(); // Dibuja la tabla de respuestas rápidas
            break;

        case 'metricas':
            mainViewContainer.innerHTML = MetricsViewTemplate();
            renderMetricsView(); // Dibuja la vista de métricas (incluyendo la nueva sección)
            break;
        case 'ia':
            // Hub unificado de IA: Entrenamiento · Simulador · Rescate (sub-pestañas).
            mainViewContainer.innerHTML = AIHubViewTemplate();
            switchIaTab(state.iaTab || 'entrenamiento'); // marca activa + carga diferida del panel
            break;
        case 'ajustes':
            mainViewContainer.innerHTML = SettingsViewTemplate();
            renderAjustesView(); // Dibuja la vista de ajustes generales
            break;
        case 'mockups':
            mainViewContainer.innerHTML = MockupsViewTemplate();
            initializeMockupsHandlers(); // Preview de lámparas (pendientes + plantillas)
            break;
        default:
            mainViewContainer.innerHTML = `<div class="p-8"><h1 class="text-2xl font-bold">En construcción</h1><p class="mt-4 text-gray-600">Esta sección estará disponible próximamente.</p></div>`;
    }
}

// Sección "Envíos": tabla de pedidos con comprobante validado. Cada dato de envío va en su propia
// columna y se copia al hacer clic en la celda. Lee GET /api/envios.
// Estatus de pedido (mismos valores que en Pedidos). Cambiar a "Fabricar" dispara el evento Meta.
const ENVIO_STATUS_OPTIONS = ['Sin estatus', 'Foto enviada', 'Esperando pago', 'Pagado', 'Diseñado', 'Fabricar', 'Corregir', 'Corregido', 'Mns Amenazador', 'Cancelado'];
// Insignia de paquetería con color aproximado de su marca.
function courierBadge(paq) {
    const p = String(paq || '').toUpperCase();
    let bg = '#64748b', fg = '#fff', label = paq || '—';
    if (p.includes('DHL')) { bg = '#FFCC00'; fg = '#D40511'; label = 'DHL'; }
    else if (p.includes('FEDEX')) { bg = '#4D148C'; label = 'FedEx'; }
    else if (p.includes('ESTAFETA')) { bg = '#EE1C25'; label = 'Estafeta'; }
    else if (p.includes('EXPRESS')) { bg = '#0ea5e9'; label = paq; }
    return `<span style="display:inline-block;background:${bg};color:${fg};font-size:10px;font-weight:800;letter-spacing:.3px;padding:2px 7px;border-radius:5px;white-space:nowrap">${escapeHtml(label)}</span>`;
}

async function renderEnviosView() {
    const container = document.getElementById('envios-container');
    if (!container) return;
    container.innerHTML = '<p class="text-gray-500">Cargando envíos…</p>';
    try {
        const res = await fetch(`${API_BASE_URL}/api/envios`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || ('HTTP ' + res.status));
        window._enviosData = data.envios || []; // para los handlers de cotizar/crear guía
        _paintEnvios();
    } catch (e) {
        container.innerHTML = `<p style="color:#991b1b">No se pudieron cargar los envíos: ${escapeHtml(e.message || String(e))}</p>
            <button class="btn btn-outline btn-sm mt-2" onclick="renderEnviosView()">Reintentar</button>`;
    }
}
window.renderEnviosView = renderEnviosView;

// Pinta la tabla de Envíos desde window._enviosData (SIN volver a consultar) -> refrescos instantáneos.
function _paintEnvios() {
    const container = document.getElementById('envios-container');
    if (!container) return;
    const envios = window._enviosData || [];
    if (!envios.length) {
        container.innerHTML = '<p class="text-gray-500">Aún no hay pedidos con comprobante validado. Aparecerán aquí cuando la IA valide un comprobante de pago.</p>';
        return;
    }
        // Celda copiable: al hacer clic copia su valor. Vacío -> "—" no copiable.
        const cell = (val, style = '') => {
            const v = (val == null ? '' : String(val)).trim();
            if (!v) return `<td style="padding:10px 14px 10px 0;color:#cbd5e1">—</td>`;
            return `<td class="envio-copy" title="Clic para copiar" onclick="copyEnvioCell(this)" style="padding:10px 14px 10px 0;cursor:pointer;${style}">${escapeHtml(v)}</td>`;
        };
        const DATA_COLS = 9; // nombre..teléfono
        // _hasGuia solo para los conteos/filtros. NO se agrupa: orden cronológico ascendente
        // (los más antiguos arriba, los nuevos ABAJO). Los que faltan datos se quedan en su lugar.
        envios.forEach(e => { e._hasGuia = !!(e.guiaEnvio && e.guiaEnvio.guia); });
        const pendCount = envios.filter(e => !e._hasGuia).length;
        const guiaCount = envios.length - pendCount;
        const cotizables = envios.filter(e => e.datos && e.datos.codigoPostal && !e._hasGuia).length; // pendientes CON datos -> cotizables en lote
        const filter = window._enviosFilter || 'all';
        const _ts = (e) => (e.comprobanteValidadoAt ? new Date(e.comprobanteValidadoAt).getTime() : 0);
        const ordered = envios.slice().sort((a, b) => _ts(a) - _ts(b)); // ascendente: nuevos al final
        const shown = ordered.filter(e => filter === 'all' ? true : (filter === 'guia' ? e._hasGuia : !e._hasGuia));
        const rows = shown.map((e, dispIdx) => {
            const gi = window._enviosData.indexOf(e); // índice real en _enviosData para los handlers
            const numCell = `<td style="padding:10px 14px 10px 0;color:#94a3b8;font-weight:600;white-space:nowrap">${dispIdx + 1}</td>`;
            const montoVal = e.montoPagado != null ? `$${Number(e.montoPagado).toLocaleString('es-MX')}` : '';
            // Estatus editable: pedidos reales y líneas manuales enlazadas a su pedido (por número).
            const statusDocId = e.orderDocId || (!e.manualId ? e.id : null);
            const statusCell = statusDocId
                ? `<td style="padding:8px 14px 8px 0;white-space:nowrap"><select onchange="changeEnvioStatus('${statusDocId}', this.value, this)" style="font-size:12px;padding:4px 8px;border:1px solid var(--color-border,#e5e7eb);border-radius:6px;background:var(--color-surface,#fff);color:var(--color-text,#334155);width:138px">${ENVIO_STATUS_OPTIONS.map(o => `<option${(e.estatus || 'Sin estatus') === o ? ' selected' : ''}>${o}</option>`).join('')}</select></td>`
                : `<td style="padding:10px 14px 10px 0;color:#cbd5e1" title="Esta línea manual no coincide con ningún pedido registrado">—</td>`;
            // Nota interna (NO sale en la guía). Editable; guarda al salir del campo (onblur).
            const comentarioCell = `<td style="padding:6px 12px 6px 0"><textarea onblur="changeEnvioComentario('${escapeHtml(e.id || '')}','${escapeHtml(e.manualId || '')}',this)" placeholder="Nota interna…" title="Solo para ti — no aparece en la guía" style="width:150px;min-height:34px;max-height:90px;font-size:12px;line-height:1.3;padding:5px 7px;border:1px solid var(--color-border,#e5e7eb);border-radius:6px;resize:vertical;background:var(--color-surface,#fff);color:var(--color-text,#334155)">${escapeHtml(e.comentarioInterno || '')}</textarea></td>`;
            const d = e.datos;
            let dataCells;
            if (d) {
                dataCells =
                    cell(d.nombre, 'white-space:nowrap;font-weight:600') +
                    cell([d.direccion, d.numInterior ? `Int. ${d.numInterior}` : ''].filter(Boolean).join(' ')) +
                    cell(d.colonia, 'white-space:nowrap') +
                    cell(d.entreCalles) +
                    cell(d.referencia) +
                    cell(d.ciudad, 'white-space:nowrap') +
                    cell(d.estado, 'white-space:nowrap') +
                    cell(d.codigoPostal, 'white-space:nowrap') +
                    cell(d.telefono, 'white-space:nowrap');
            } else {
                dataCells = `<td colspan="${DATA_COLS}" style="padding:10px 0;color:#b45309;font-weight:600">Pendiente — aún no llena el formulario</td>`;
            }
            // Celda del pedido: copiable; si es manual añade una etiqueta (no copiable con el clic principal).
            const pedidoCell = `<td class="envio-copy" title="Clic para copiar" onclick="copyEnvioCell(this)" style="padding:10px 14px 10px 0;cursor:pointer;white-space:nowrap;font-weight:700;color:var(--color-primary)">${escapeHtml(e.orderNumber)}</td>`;
            // Acciones: si ya hay guía, mostrarla (guía + etiqueta + rastreo); si hay datos, botón para crear guía.
            const linkStyle = 'font-size:12px;text-decoration:none;color:var(--color-primary,#ef4444);white-space:nowrap';
            let actions = '';
            if (e.guiaEnvio && e.guiaEnvio.guia) {
                const g = e.guiaEnvio;
                const etiqueta = g.pdfPath ? `<a href="${API_BASE_URL}/api/envios/etiqueta?path=${encodeURIComponent(g.pdfPath)}" target="_blank" rel="noopener" style="${linkStyle}">🏷️ Etiqueta</a>` : (g.labelUrl ? `<a href="${g.labelUrl}" target="_blank" rel="noopener" style="${linkStyle}">🏷️ Etiqueta</a>` : '');
                const rastreo = g.tracking ? `<a href="${g.tracking}" target="_blank" rel="noopener" style="${linkStyle}">📍 Rastrear</a>` : '';
                actions = `<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-end">
                    <span style="display:flex;gap:6px;align-items:center">${courierBadge(g.mensajeria)}<span class="envio-copy" onclick="copyEnvioCell(this)" title="Clic para copiar la guía" style="font-weight:700;color:#166534;cursor:pointer;white-space:nowrap">✓ ${escapeHtml(g.guia)}</span></span>
                    <span style="display:flex;gap:10px">${etiqueta}${rastreo}</span>
                  </div>`;
            } else {
                // Pendiente de guía: crear por API (si hay datos+CP) y/o registrar una guía hecha a mano en T1.
                const btnBase = 'border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap;width:100%;text-align:center;font-weight:600';
                const crearBtn = (e.datos && e.datos.codigoPostal)
                    ? `<button onclick="openGuiaModal(${gi})" title="Cotizar y crear guía DHL/Estafeta (descuenta saldo y avisa al cliente)" style="background:var(--color-primary,#ef4444);color:#fff;border:none;${btnBase}"><i class="fas fa-box mr-1"></i>Crear guía</button>`
                    : '';
                const manualBtn = `<button onclick="openEnvioEditModal(${gi}, true)" title="Registrar una guía que hiciste MANUALMENTE en T1 (la pasa a Con guía; no cobra ni notifica)" style="background:transparent;color:#166534;border:1px solid #22c55e;${btnBase}"><i class="fas fa-clipboard-check mr-1"></i>Guía manual</button>`;
                actions = `<div style="display:flex;flex-direction:column;gap:5px;align-items:stretch">${crearBtn}${manualBtn}</div>`;
            }
            const editBtn = `<button title="Editar datos de esta fila" onclick="openEnvioEditModal(${gi})" style="border:none;background:transparent;cursor:pointer;color:#334155;padding:4px 8px;font-size:13px;"><i class="fas fa-pen"></i></button>`;
            const chatBtn = e.contactId ? `<button title="Ver y responder la conversación (sin salir de Envíos)" onclick="openChatEnviosModal('${escapeHtml(e.contactId)}')" style="border:none;background:transparent;cursor:pointer;color:#0ea5e9;padding:4px 8px;font-size:13px;"><i class="fas fa-comments"></i></button>` : '';
            // Pedidos reales: "quitar de Envíos" (oculta, no borra). Manuales: borrar de verdad.
            const hideBtn = !e.manualId ? `<button title="Quitar de Envíos (no borra el pedido)" onclick="ocultarEnvio('${e.id}')" style="border:none;background:transparent;cursor:pointer;color:#94a3b8;padding:4px 8px;font-size:13px;"><i class="fas fa-eye-slash"></i></button>` : '';
            const delBtn = e.manualId ? `<button title="Borrar línea manual" onclick="deleteEnvioManual('${e.manualId}')" style="border:none;background:transparent;cursor:pointer;color:#991b1b;padding:4px 8px;font-size:13px;"><i class="fas fa-trash"></i></button>` : '';
            // Columna de acciones ordenada: botón(es) de guía arriba; debajo, una fila con los iconos
            // (editar · chat · quitar/borrar). min-width para que todas las filas queden alineadas.
            const iconRow = `<div style="display:flex;gap:1px;align-items:center;justify-content:flex-end;margin-top:1px">${editBtn}${chatBtn}${hideBtn}${delBtn}</div>`;
            const accionCell = `<td style="padding:10px 0 10px 10px;text-align:right;white-space:nowrap;vertical-align:top"><div style="display:inline-flex;flex-direction:column;gap:6px;align-items:stretch;min-width:122px">${actions}${iconRow}</div></td>`;
            return `<tr style="border-bottom:1px solid var(--color-border);vertical-align:top">
                ${numCell}
                ${pedidoCell}
                ${cell(montoVal, 'white-space:nowrap;font-weight:600')}
                ${statusCell}
                ${comentarioCell}
                ${dataCells}
                ${accionCell}
            </tr>`;
        }).join('');
        const manualCount = envios.filter(e => e.manualId).length;
        container.innerHTML = `
            <style>
              #envios-container thead th{position:sticky;top:0;z-index:2;background:var(--color-container-bg,#fff);box-shadow:inset 0 -2px 0 var(--color-border);}
              #envios-container .envio-copy{transition:background-color .12s;border-radius:6px;}
              #envios-container .envio-copy:hover{background-color:var(--color-subtle-bg,#f1f5f9);}
              #envios-container .envio-copy[data-copied]{background-color:#dcfce7 !important;color:#166534;}
            </style>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
              ${[['all', 'Todas', envios.length], ['pendiente', 'Pendientes de guía', pendCount], ['guia', 'Con guía', guiaCount]].map(([k, lbl, c]) => `<button onclick="setEnviosFilter('${k}')" style="border:1px solid ${filter === k ? 'var(--color-primary,#ef4444)' : 'var(--color-border,#e5e7eb)'};background:${filter === k ? 'var(--color-primary,#ef4444)' : 'transparent'};color:${filter === k ? '#fff' : 'var(--color-text,#334155)'};border-radius:999px;padding:5px 14px;font-size:.8rem;cursor:pointer;font-weight:600">${lbl} (${c})</button>`).join('')}
              ${cotizables > 0 ? `<button onclick="cotizarPendientesLote()" title="Cotiza TODAS las pendientes con datos, en paralelo, y créalas en lote" style="margin-left:auto;background:var(--color-primary,#ef4444);color:#fff;border:none;border-radius:999px;padding:6px 16px;font-size:.82rem;cursor:pointer;font-weight:700;white-space:nowrap"><i class="fas fa-bolt mr-1"></i>Cotizar pendientes (${cotizables})</button>` : ''}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:10px;font-size:.8rem">
              <span style="color:var(--color-text-light,#64748b)"><i class="fas fa-wallet mr-1"></i>Saldo:</span>
              <a href="https://shipping.t1.com" target="_blank" rel="noopener" style="text-decoration:none;color:var(--color-primary,#ef4444);font-weight:600">T1 · DHL/FedEx ↗</a>
              <a href="https://app.enviosperros.com/wallet" target="_blank" rel="noopener" style="text-decoration:none;color:var(--color-primary,#ef4444);font-weight:600">Envíos Perros · Estafeta ↗</a>
            </div>
            <p class="text-xs text-gray-400 mb-2"><i class="fas fa-hand-pointer mr-1"></i> Haz clic en cualquier dato para copiarlo.</p>
            <div id="envios-scroll" style="overflow:auto">
              <table style="width:100%;border-collapse:collapse;font-size:0.875rem">
                <thead>
                  <tr style="text-align:left;border-bottom:2px solid var(--color-border);color:var(--color-text-light);white-space:nowrap">
                    <th style="padding:8px 14px 8px 0">#</th>
                    <th style="padding:8px 14px 8px 0">Pedido</th>
                    <th style="padding:8px 14px 8px 0">Monto pagado</th>
                    <th style="padding:8px 14px 8px 0">Estatus</th>
                    <th style="padding:8px 14px 8px 0">Comentario</th>
                    <th style="padding:8px 14px 8px 0">Nombre</th>
                    <th style="padding:8px 14px 8px 0">Dirección</th>
                    <th style="padding:8px 14px 8px 0">Colonia</th>
                    <th style="padding:8px 14px 8px 0">Entre calles</th>
                    <th style="padding:8px 14px 8px 0">Referencia</th>
                    <th style="padding:8px 14px 8px 0">Municipio</th>
                    <th style="padding:8px 14px 8px 0">Estado</th>
                    <th style="padding:8px 14px 8px 0">C.P.</th>
                    <th style="padding:8px 14px 8px 0">Teléfono</th>
                    <th style="padding:8px 0;text-align:right">Guía / Acciones</th>
                  </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="15" style="padding:16px 0;color:#94a3b8">No hay envíos en este filtro.</td></tr>'}</tbody>
              </table>
            </div>
            <p class="text-xs text-gray-400 mt-3">${shown.length} de ${envios.length} línea(s)${manualCount ? ` · ${manualCount} manual(es)` : ''} · ${pendCount} pendiente(s) de guía · ${guiaCount} con guía.</p>`;
    requestAnimationFrame(_ajustarAltoEnvios); // scroll dentro de la tabla: barra horizontal visible + header sticky
}
window._paintEnvios = _paintEnvios;

// Da al contenedor de la tabla un alto que llene lo que queda de pantalla, para que el scroll (vertical
// Y horizontal) viva DENTRO de la tabla: header sticky arriba y barra horizontal visible al fondo de la
// tabla (no al final de toda la página). Robusto ante zoom/tamaño (mide su posición real en pantalla).
function _ajustarAltoEnvios() {
    const el = document.getElementById('envios-scroll');
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    el.style.maxHeight = Math.max(260, Math.round(window.innerHeight - top - 30)) + 'px';
}
window.addEventListener('resize', () => { if (document.getElementById('envios-scroll')) _ajustarAltoEnvios(); });

// --- Chat en modal (desde Envíos) --------------------------------------------------------------
// En Envíos NO existe #chat-panel (las vistas se intercambian con innerHTML). Para "ver + responder"
// sin cambiar de vista, montamos la MISMA plantilla de chat dentro de un modal y reusamos toda la
// maquinaria real: handleSelectContact -> listeners de Firebase + renderChatWindow + envío. Al cerrar,
// stopChatListeners() desmonta los listeners para no dejar fugas que pinten en la vista real de Chats.
function _chatEnviosModalEl() {
    let m = document.getElementById('chat-envios-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'chat-envios-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);display:none;z-index:11000;';
    m.innerHTML = `
        <div style="position:absolute;top:2vh;left:50%;transform:translateX(-50%);width:min(480px,96vw);height:96vh;background:var(--color-container-bg,#fff);border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45);display:flex;flex-direction:column">
            <button onclick="closeChatEnviosModal()" title="Cerrar (Esc)"
                style="position:absolute;top:10px;right:14px;z-index:30;border:none;background:rgba(255,255,255,.92);border-radius:50%;width:34px;height:34px;font-size:22px;line-height:1;cursor:pointer;color:#334155;box-shadow:0 2px 8px rgba(0,0,0,.25)">&times;</button>
            <div id="chat-envios-slot" style="flex:1;min-height:0;overflow:hidden"></div>
        </div>`;
    m.addEventListener('click', e => { if (e.target === m) closeChatEnviosModal(); });
    document.body.appendChild(m);
    return m;
}

async function openChatEnviosModal(contactId) {
    if (!contactId) return;
    // Si ya estás en la vista de Chats, no hace falta modal: seleccionar normal.
    if (state.activeView === 'chats') { handleSelectContactFromPipeline(contactId); return; }
    const m = _chatEnviosModalEl();
    const slot = m.querySelector('#chat-envios-slot');
    slot.innerHTML = ChatViewTemplate();
    // Mostrar SOLO la conversación: ocultar lista de contactos y panel de detalles; chat a todo lo ancho.
    const cv = slot.querySelector('#chat-view'); if (cv) { cv.style.height = '100%'; cv.style.width = '100%'; cv.style.display = 'flex'; }
    const cpanel = slot.querySelector('#contacts-panel'); if (cpanel) cpanel.style.display = 'none';
    const dpanel = slot.querySelector('#contact-details-panel'); if (dpanel) dpanel.style.display = 'none';
    const chp = slot.querySelector('#chat-panel'); if (chp) { chp.style.width = '100%'; chp.style.maxWidth = '100%'; chp.style.flex = '1'; }
    m.style.display = 'block';
    // Flag para que renderChatWindow (que exige activeView==='chats') pinte dentro del modal en Envíos.
    state.chatModalOpen = true;
    // Mismo arranque que la vista real de Chats, pero dentro del modal.
    try { renderChatWindow(); } catch (e) {}
    try { if (typeof renderTagFilters === 'function') renderTagFilters(); } catch (e) {}
    try { if (typeof setupChatListEventListeners === 'function') setupChatListEventListeners(); } catch (e) {}
    try { await handleSelectContact(contactId); } catch (e) { console.warn('openChatEnviosModal:', e); }
}
window.openChatEnviosModal = openChatEnviosModal;

function closeChatEnviosModal() {
    const m = document.getElementById('chat-envios-modal');
    state.chatModalOpen = false;
    // Cortar listeners ANTES de quitar el DOM, para no dejar fugas apuntando al chat real.
    try { if (typeof stopChatListeners === 'function') stopChatListeners(); } catch (e) {}
    document.body.classList.remove('chat-open'); // por si se marcó en móvil dentro del modal
    if (m) {
        const slot = m.querySelector('#chat-envios-slot');
        if (slot) slot.innerHTML = '';
        m.style.display = 'none';
    }
}
window.closeChatEnviosModal = closeChatEnviosModal;

// Cerrar con Esc.
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const m = document.getElementById('chat-envios-modal');
    if (m && m.style.display !== 'none') closeChatEnviosModal();
});

// Filtro de la tabla de Envíos: 'all' | 'pendiente' (sin guía) | 'guia' (con guía).
function setEnviosFilter(f) { window._enviosFilter = f; _paintEnvios(); }
window.setEnviosFilter = setEnviosFilter;

// Cambia el estatus del pedido desde Envíos. Reusa el endpoint que YA dispara el evento Meta al pasar a "Fabricar".
async function changeEnvioStatus(orderId, newStatus, sel) {
    if (!orderId || !newStatus) return;
    try {
        const r = await fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}/change-status`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newStatus })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) throw new Error(d.message || ('HTTP ' + r.status));
        if (sel) { const c = sel.style.borderColor; sel.style.borderColor = '#16a34a'; setTimeout(() => { sel.style.borderColor = c || 'var(--color-border,#e5e7eb)'; }, 800); }
    } catch (e) {
        if (window.showError) showError('No se pudo cambiar el estatus: ' + (e.message || e)); else alert('No se pudo cambiar el estatus: ' + (e.message || e));
        renderEnviosView(); // revertir el select al valor real del servidor
    }
}
window.changeEnvioStatus = changeEnvioStatus;

// Guarda la NOTA INTERNA de una línea de Envíos (no sale en la guía). Guarda al salir del campo.
async function changeEnvioComentario(lineId, manualId, el) {
    const comentario = (el && el.value) || '';
    try { const e = (window._enviosData || []).find(x => x.id === lineId); if (e) e.comentarioInterno = comentario; } catch (_) {}
    try {
        const r = await fetch(`${API_BASE_URL}/api/envios/comentario`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: lineId, manualId: manualId || null, comentario })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) throw new Error(d.message || ('HTTP ' + r.status));
        if (el) { el.style.borderColor = '#16a34a'; setTimeout(() => { el.style.borderColor = 'var(--color-border,#e5e7eb)'; }, 800); }
    } catch (e) {
        if (window.showError) showError('No se pudo guardar la nota: ' + (e.message || e)); else alert('No se pudo guardar la nota: ' + (e.message || e));
    }
}
window.changeEnvioComentario = changeEnvioComentario;

// Quita un pedido de la tabla de Envíos (oculta, NO borra el pedido).
async function ocultarEnvio(docId) {
    if (!docId) return;
    const ok = await showConfirmModal('¿Quitar este pedido de la tabla de Envíos?<br><span style="display:block;margin-top:6px;color:var(--color-text-light,#64748b);font-size:12.5px">El pedido NO se borra; solo desaparece de aquí.</span>', { icon: 'fa-eye-slash', confirmText: 'Quitar' });
    if (!ok) return;
    try {
        const r = await fetch(`${API_BASE_URL}/api/envios/ocultar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) throw new Error(d.message || ('HTTP ' + r.status));
        renderEnviosView();
    } catch (e) {
        if (window.showError) showError('No se pudo ocultar: ' + (e.message || e)); else alert('No se pudo ocultar: ' + (e.message || e));
    }
}
window.ocultarEnvio = ocultarEnvio;

// Copia el texto de una celda de la tabla de Envíos al portapapeles (clic en la celda).
// Intenta la API moderna y, si falla, cae al fallback clásico (textarea + execCommand).
async function copyEnvioCell(el) {
    const text = (el.textContent || '').trim();
    if (!text) return;
    let ok = false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            ok = true;
        }
    } catch (_) { ok = false; }
    if (!ok) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.focus(); ta.select();
            ok = document.execCommand('copy');
            ta.remove();
        } catch (_) { ok = false; }
    }
    if (ok) {
        el.setAttribute('data-copied', '1');
        setTimeout(() => el.removeAttribute('data-copied'), 750);
    }
}
window.copyEnvioCell = copyEnvioCell;

// Muestra/oculta el formulario para agregar una línea manual a Envíos.
function toggleEnvioManualForm() {
    const f = document.getElementById('envio-manual-form');
    if (!f) return;
    const show = f.style.display === 'none';
    f.style.display = show ? 'block' : 'none';
    if (show) { const o = document.getElementById('em-order'); if (o) o.focus(); }
}
window.toggleEnvioManualForm = toggleEnvioManualForm;

// Guarda una línea manual (solo el número de pedido es obligatorio) y refresca la tabla.
async function saveEnvioManual() {
    const g = id => (document.getElementById(id)?.value || '').trim();
    const errEl = document.getElementById('em-error');
    if (errEl) errEl.textContent = '';
    const orderNumber = g('em-order');
    if (!orderNumber) { if (errEl) errEl.textContent = 'Escribe el número de pedido.'; const o = document.getElementById('em-order'); if (o) o.focus(); return; }
    const payload = {
        orderNumber, montoPagado: g('em-monto'), nombre: g('em-nombre'), direccion: g('em-direccion'),
        colonia: g('em-colonia'), entreCalles: g('em-entrecalles'), referencia: g('em-referencia'),
        ciudad: g('em-ciudad'), estado: g('em-estado'), codigoPostal: g('em-cp'), telefono: g('em-telefono'),
    };
    const btn = document.getElementById('em-save');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Guardando…'; }
    try {
        const r = await fetch(`${API_BASE_URL}/api/envios/manual`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) throw new Error(d.message || ('HTTP ' + r.status));
        // Limpiar el formulario y ocultarlo.
        ['em-order','em-monto','em-nombre','em-direccion','em-colonia','em-entrecalles','em-referencia','em-ciudad','em-estado','em-cp','em-telefono'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const f = document.getElementById('envio-manual-form'); if (f) f.style.display = 'none';
        renderEnviosView();
    } catch (e) {
        if (errEl) errEl.textContent = 'No se pudo guardar: ' + (e.message || e);
    }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
}
window.saveEnvioManual = saveEnvioManual;

// Borra una línea manual de Envíos.
async function deleteEnvioManual(id) {
    if (!id) return;
    const ok = await showConfirmModal('¿Borrar esta línea manual de Envíos?', { icon: 'delete', confirmText: 'Borrar' });
    if (!ok) return;
    try {
        const r = await fetch(`${API_BASE_URL}/api/envios/manual/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) throw new Error(d.message || ('HTTP ' + r.status));
        renderEnviosView();
    } catch (e) {
        if (window.showError) showError('No se pudo borrar la línea: ' + (e.message || e));
        else alert('No se pudo borrar la línea: ' + (e.message || e));
    }
}
window.deleteEnvioManual = deleteEnvioManual;

// ===================== Editar una fila de Envíos =====================
// Regular (viene de un pedido) -> upsert en datos_envio (PUT /api/envios/datos/:pedido).
// Manual (envios_manuales)     -> PUT /api/envios/manual/:id.
function _envioEditModalEl() {
    let m = document.getElementById('envio-edit-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'envio-edit-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9999;';
        m.innerHTML = '<div id="envio-edit-box" style="background:var(--color-surface,#fff);color:var(--color-text,#111);max-width:560px;width:94%;max-height:90vh;overflow:auto;border-radius:14px;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.35)"></div>';
        m.addEventListener('click', (ev) => { if (ev.target === m) closeEnvioEditModal(); });
        document.body.appendChild(m);
    }
    return m;
}
function closeEnvioEditModal() { const m = document.getElementById('envio-edit-modal'); if (m) m.style.display = 'none'; }
window.closeEnvioEditModal = closeEnvioEditModal;

let _envioEditActual = null; // objeto de _enviosData en edición (no el índice, para no desincronizar).

// Abre el modal de edición para la fila en el índice i de _enviosData.
function openEnvioEditModal(i, focusGuia) {
    const e = (window._enviosData || [])[i];
    if (!e) return;
    _envioEditActual = e;
    const d = e.datos || {};
    const isManual = !!e.manualId;
    const hasGuia = !!(e.guiaEnvio && e.guiaEnvio.guia);
    const m = _envioEditModalEl();
    const inputStyle = 'width:100%;padding:8px 10px;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;font-size:.85rem;background:var(--color-bg,#fff);color:var(--color-text,#111)';
    const f = (id, label, value, attrs = '') => `
        <div style="min-width:0">
          <label style="display:block;font-size:.72rem;font-weight:600;color:var(--color-text-light,#64748b);margin-bottom:3px">${label}</label>
          <input id="ee-${id}" value="${escapeHtml(value == null ? '' : String(value))}" ${attrs} style="${inputStyle}" />
        </div>`;
    const montoField = isManual ? `<div style="margin-bottom:10px">${f('monto', 'Monto pagado', (e.montoPagado != null ? e.montoPagado : ''), 'inputmode="decimal"')}</div>` : '';
    // Sección para registrar una guía hecha MANUALMENTE en T1 (no cobra, no notifica; solo pasa a "Con guía").
    // Se muestra en filas SIN guía (registrar) o con guía MANUAL (corregir un número mal tecleado). NUNCA sobre
    // guías creadas por API (tienen etiqueta/pdf que no queremos perder). Reusa POST /api/envios/attach-guia.
    const isManualGuia = hasGuia && e.guiaEnvio.manual === true;
    const showGuiaSection = !hasGuia || isManualGuia;
    const gEnv = e.guiaEnvio || {};
    const guiaSection = !showGuiaSection ? '' : `
        <div style="margin:2px 0 4px;padding:12px 14px;border:1px dashed var(--color-primary,#ef4444);border-radius:10px;background:var(--color-subtle-bg,#fef2f2)">
          <label style="display:block;font-size:.82rem;font-weight:700;color:var(--color-primary,#ef4444);margin-bottom:5px"><i class="fas fa-clipboard-check mr-1"></i>${isManualGuia ? 'Corregir la guía registrada a mano' : '¿Ya hiciste la guía a mano en T1?'}</label>
          <p style="font-size:.72rem;color:var(--color-text-light,#64748b);margin:0 0 9px;line-height:1.35">${isManualGuia ? 'Corrige el número si lo tecleaste mal. Se actualiza la guía de este pedido.' : 'Escribe el número de guía para pasar este pedido a <b>Con guía</b>. No descuenta saldo ni avisa al cliente (para eso usa el botón <b>Crear guía</b>).'}</p>
          <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:10px">
            ${f('guia', 'Número de guía', isManualGuia ? gEnv.guia : '', 'placeholder="Ej. 9501234567" autocomplete="off"')}
            <div style="min-width:0">
              <label style="display:block;font-size:.72rem;font-weight:600;color:var(--color-text-light,#64748b);margin-bottom:3px">Paquetería</label>
              <select id="ee-mensajeria" style="${inputStyle}">
                ${['DHL', 'FedEx', 'Estafeta'].map(mm => `<option${((gEnv.mensajeria || 'DHL').toLowerCase() === mm.toLowerCase()) ? ' selected' : ''}>${mm}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>`;
    m.querySelector('#envio-edit-box').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <h3 style="margin:0;font-size:1.05rem;font-weight:700">Editar envío — ${escapeHtml(e.orderNumber)}</h3>
          <button onclick="closeEnvioEditModal()" style="border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#64748b">&times;</button>
        </div>
        <p style="font-size:.75rem;color:var(--color-text-light,#64748b);margin:0 0 12px">${isManual ? 'Línea manual.' : 'Se actualizan los datos de envío del pedido.'}${!e.datos ? ' <b>Aún sin datos:</b> se crearán al guardar.' : ''}</p>
        <div id="ee-error" style="color:#991b1b;font-size:.8rem;margin-bottom:8px"></div>
        ${guiaSection}
        <div style="display:flex;flex-direction:column;gap:10px">
          ${f('nombre', 'Nombre', d.nombre)}
          ${f('telefono', 'Teléfono', d.telefono, 'inputmode="numeric" maxlength="10"')}
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">
            ${f('direccion', 'Calle y número', d.direccion)}
            ${f('numInterior', 'No. interior', d.numInterior)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${f('colonia', 'Colonia', d.colonia)}
            ${f('cp', 'C.P.', d.codigoPostal, 'inputmode="numeric" maxlength="5"')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${f('ciudad', 'Municipio / Ciudad', d.ciudad)}
            ${f('estado', 'Estado', d.estado)}
          </div>
          ${f('entrecalles', 'Entre calles', d.entreCalles)}
          ${f('referencia', 'Referencia', d.referencia)}
        </div>
        ${montoField ? `<div style="margin-top:10px">${montoField}</div>` : ''}
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button onclick="closeEnvioEditModal()" style="border:1px solid var(--color-border,#e5e7eb);background:transparent;border-radius:8px;padding:8px 16px;cursor:pointer">Cancelar</button>
          <button id="ee-save" onclick="saveEnvioEdit()" style="background:var(--color-primary,#ef4444);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-weight:600;cursor:pointer">Guardar cambios</button>
        </div>`;
    m.style.display = 'flex';
    // Si se abrió desde el botón "Guía manual", enfocar el campo de la guía.
    if (focusGuia) { const gEl = document.getElementById('ee-guia'); if (gEl) { try { gEl.focus(); gEl.scrollIntoView({ block: 'center' }); } catch (_) {} } }
}
window.openEnvioEditModal = openEnvioEditModal;

// Guarda los cambios de la fila en edición y refresca la tabla.
async function saveEnvioEdit() {
    const e = _envioEditActual;
    if (!e) return;
    const g = id => (document.getElementById('ee-' + id)?.value || '').trim();
    const errEl = document.getElementById('ee-error');
    if (errEl) errEl.textContent = '';
    const payload = {
        nombreCompleto: g('nombre'), nombre: g('nombre'),
        telefono: g('telefono'), direccion: g('direccion'), numInterior: g('numInterior'),
        colonia: g('colonia'), entreCalles: g('entrecalles'), referencia: g('referencia'),
        ciudad: g('ciudad'), estado: g('estado'), codigoPostal: g('cp'),
    };
    if (e.manualId) payload.montoPagado = g('monto');
    const guiaManual = g('guia'); // si el operador escribió una guía hecha a mano en T1
    // 'monto' solo existe en líneas manuales; se incluye para no omitir el guardado cuando se teclea
    // SOLO monto + guía (sin datos de dirección) y así perder el monto en silencio.
    const hasAnyData = ['nombre', 'telefono', 'direccion', 'numInterior', 'colonia', 'entrecalles', 'referencia', 'ciudad', 'estado', 'cp'].some(id => g(id)) || (!!e.manualId && !!g('monto'));
    const url = e.manualId
        ? `${API_BASE_URL}/api/envios/manual/${encodeURIComponent(e.manualId)}`
        : `${API_BASE_URL}/api/envios/datos/${encodeURIComponent(e.orderNumber)}`;
    const btn = document.getElementById('ee-save');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Guardando…'; }
    try {
        // Guardar datos: en edición normal siempre; al SOLO registrar guía (sin datos escritos) se omite
        // para no crear un registro de datos vacío.
        if (hasAnyData || !guiaManual) {
            const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || d.success === false) throw new Error(d.message || ('HTTP ' + r.status));
        }
        // Registrar guía hecha MANUALMENTE en T1 -> pasa la fila a "Con guía" (no cobra, no notifica).
        if (guiaManual) {
            const mensajeria = document.getElementById('ee-mensajeria')?.value || 'DHL';
            const proveedor = /estafeta/i.test(mensajeria) ? 'ep' : 't1';
            const body = e.manualId ? { manualId: e.manualId } : { docId: e.id };
            body.guia = guiaManual; body.mensajeria = mensajeria; body.proveedor = proveedor;
            if (e.guiaEnvio && e.guiaEnvio.guia) body.overwrite = true; // corrigiendo una guía manual ya registrada
            const ar = await fetch(`${API_BASE_URL}/api/envios/attach-guia`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const ad = await ar.json().catch(() => ({}));
            if (!ar.ok || ad.success === false) throw new Error(ad.message || 'No se pudo registrar la guía');
        }
        closeEnvioEditModal();
        renderEnviosView();
    } catch (err) {
        if (errEl) errEl.textContent = 'No se pudo guardar: ' + (err.message || err);
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}
window.saveEnvioEdit = saveEnvioEdit;

// ===================== Guías DHL (T1 Envíos) desde el CRM =====================
// Modal reutilizable (se crea una sola vez y se muestra/oculta).
function _guiaModalEl() {
    let m = document.getElementById('guia-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'guia-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9999;';
        m.innerHTML = '<div id="guia-modal-box" style="background:var(--color-surface,#fff);color:var(--color-text,#111);max-width:520px;width:92%;max-height:88vh;overflow:auto;border-radius:14px;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.35)"></div>';
        m.addEventListener('click', (ev) => { if (ev.target === m) closeGuiaModal(); });
        document.body.appendChild(m);
    }
    return m;
}
function closeGuiaModal() { const m = document.getElementById('guia-modal'); if (m) m.style.display = 'none'; }
window.closeGuiaModal = closeGuiaModal;

// ======================= COTIZACIÓN EN LOTE =======================
// Cotiza TODAS las pendientes con datos en paralelo, muestra una ventana con todas las cotizaciones,
// y deja crear cada guía EN SEGUNDO PLANO (sin esperar) para no perder tiempo pedido por pedido.
function _loteModalEl() {
    let m = document.getElementById('lote-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'lote-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9999;';
        m.innerHTML = '<div id="lote-modal-box" style="background:var(--color-surface,#fff);color:var(--color-text,#111);max-width:900px;width:94%;max-height:88vh;overflow:auto;border-radius:14px;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.35)"></div>';
        m.addEventListener('click', (ev) => { if (ev.target === m) closeLoteModal(); });
        document.body.appendChild(m);
    }
    return m;
}
function closeLoteModal() { const m = document.getElementById('lote-modal'); if (m) m.style.display = 'none'; }
window.closeLoteModal = closeLoteModal;

async function cotizarPendientesLote() {
    const pend = (window._enviosData || []).filter(e => e && e.datos && e.datos.codigoPostal && !(e.guiaEnvio && e.guiaEnvio.guia));
    if (!pend.length) { alert('No hay pedidos pendientes con datos de envío para cotizar.'); return; }
    const m = _loteModalEl();
    m.querySelector('#lote-modal-box').innerHTML = `<div style="text-align:center;padding:26px"><i class="fas fa-spinner fa-spin fa-2x" style="color:var(--color-primary,#ef4444)"></i><p style="margin-top:12px">Cotizando ${pend.length} pedido(s) en paralelo…</p></div>`;
    m.style.display = 'flex';
    try {
        const items = pend.map(e => ({ orderNumber: e.orderNumber, docId: e.id, manualId: e.manualId || null, cp: e.datos.codigoPostal }));
        const r = await fetch(`${API_BASE_URL}/api/envios/cotizar-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.message || ('HTTP ' + r.status));
        window._loteData = (j.results || []).map(res => {
            const e = pend.find(x => x.id === res.docId) || pend.find(x => x.orderNumber === res.orderNumber);
            return { ...res, datos: e ? e.datos : null, cliente: e && e.datos ? (e.datos.nombre || '') : '', status: 'idle' };
        });
        _renderLoteModal();
    } catch (err) {
        m.querySelector('#lote-modal-box').innerHTML = `<p style="color:#991b1b">No se pudo cotizar el lote: ${escapeHtml(err.message || String(err))}</p><div style="text-align:center;margin-top:12px"><button onclick="closeLoteModal()" style="border:1px solid var(--color-border,#e5e7eb);background:transparent;border-radius:8px;padding:7px 16px;cursor:pointer">Cerrar</button></div>`;
    }
}
window.cotizarPendientesLote = cotizarPendientesLote;

function _renderLoteModal() {
    const box = document.getElementById('lote-modal-box');
    if (!box) return;
    const data = window._loteData || [];
    const rows = data.map((it, i) => {
        const cli = escapeHtml((it.cliente || '').slice(0, 26) || it.orderNumber);
        const pedTd = `<td style="padding:8px 10px 8px 0;font-weight:700;color:var(--color-primary);white-space:nowrap">${escapeHtml(it.orderNumber)}</td>`;
        if (it.error || !it.servicios || !it.servicios.length) {
            return `<tr style="border-bottom:1px solid var(--color-border,#e5e7eb)">${pedTd}<td style="padding:8px 10px 8px 0">${cli}</td><td style="padding:8px 10px 8px 0">${escapeHtml(it.cp || '')}</td><td colspan="2" style="padding:8px 0;color:#b45309;font-size:.8rem">⚠️ ${escapeHtml(it.error || 'Sin servicios — revisa el C.P.')}</td></tr>`;
        }
        const opts = it.servicios.map((s, si) => `<option value="${si}">${escapeHtml((s.paqueteria || '') + ' · ' + (s.servicio || ''))} — $${Number(s.costo || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</option>`).join('');
        const sel = `<select id="lote-sel-${i}" style="font-size:12px;padding:4px 6px;border:1px solid var(--color-border,#e5e7eb);border-radius:6px;max-width:280px;background:var(--color-surface,#fff);color:var(--color-text,#334155)">${opts}</select>`;
        const btn = `<button id="lote-btn-${i}" onclick="crearGuiaLote(${i})" style="background:var(--color-primary,#ef4444);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap">Crear guía</button>`;
        return `<tr style="border-bottom:1px solid var(--color-border,#e5e7eb)">${pedTd}
            <td style="padding:8px 10px 8px 0;white-space:nowrap">${cli}</td>
            <td style="padding:8px 10px 8px 0">${escapeHtml(it.cp || '')}</td>
            <td style="padding:8px 10px 8px 0">${sel}</td>
            <td style="padding:8px 0;white-space:nowrap;display:flex;gap:8px;align-items:center">${btn}<span id="lote-estado-${i}"></span></td>
          </tr>`;
    }).join('');
    const conError = data.filter(it => it.error || !it.servicios || !it.servicios.length).length;
    box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;font-size:1.1rem;font-weight:700">Cotización en lote — ${data.length} pedido(s)</h3>
          <button onclick="closeLoteModal(); renderEnviosView();" style="border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#64748b">&times;</button>
        </div>
        <p style="font-size:.8rem;color:var(--color-text-light,#64748b);margin:0 0 10px">Elige la paquetería y dale <b>Crear guía</b>. Cada una se crea en <b>segundo plano</b> — no esperes, pasa a la siguiente. ${conError ? `<span style="color:#b45309">(${conError} sin cotización — revisa el C.P.)</span>` : ''}</p>
        <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;color:var(--color-text,#334155);margin:0 0 14px;cursor:pointer;user-select:none;padding:8px 10px;background:var(--color-subtle-bg,#f8fafc);border:1px solid var(--color-border,#e5e7eb);border-radius:8px;width:fit-content">
          <input type="checkbox" id="lote-skip-notify" style="width:16px;height:16px;cursor:pointer;accent-color:var(--color-primary,#ef4444)">
          <span>No enviar mensaje a los clientes <span style="color:#94a3b8">(ya se les avisó)</span></span>
        </label>
        <table style="width:100%;border-collapse:collapse;font-size:.875rem">
          <thead><tr style="text-align:left;border-bottom:2px solid var(--color-border);color:var(--color-text-light);white-space:nowrap">
            <th style="padding:6px 10px 6px 0">Pedido</th><th style="padding:6px 10px 6px 0">Cliente</th><th style="padding:6px 10px 6px 0">C.P.</th><th style="padding:6px 10px 6px 0">Paquetería / servicio</th><th style="padding:6px 0">Acción</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="text-align:right;margin-top:14px"><button onclick="closeLoteModal(); renderEnviosView();" style="border:1px solid var(--color-border,#e5e7eb);background:transparent;border-radius:8px;padding:7px 16px;cursor:pointer">Cerrar y actualizar</button></div>`;
}

async function crearGuiaLote(i) {
    const it = (window._loteData || [])[i];
    if (!it || it.status === 'creando' || it.status === 'creada') return;
    const sel = document.getElementById('lote-sel-' + i);
    const btn = document.getElementById('lote-btn-' + i);
    const estado = document.getElementById('lote-estado-' + i);
    const s = (it.servicios || [])[sel ? (parseInt(sel.value, 10) || 0) : 0];
    if (!s) return;
    it.status = 'creando';
    if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    if (estado) estado.innerHTML = '';
    try {
        const r = await fetch(`${API_BASE_URL}/api/envios/crear-guia`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderNumber: it.orderNumber, docId: it.docId, manualId: it.manualId || null, proveedor: s.proveedor, tipoServicio: s.codigoServicio || s.tipo_servicio, mensajeria: s.paqueteria, costo: s.costo, datos: it.datos, skipNotify: !!(document.getElementById('lote-skip-notify') || {}).checked })
        });
        const j = await r.json();
        if (j && j.persistError && j.guia) { it.status = 'creada'; if (btn) btn.style.display = 'none'; if (estado) estado.innerHTML = `<span style="color:#b45309;font-size:.8rem">⚠️ creada ${escapeHtml(j.guia)} (anótala)</span>`; return; }
        if (!r.ok || !j.success) throw new Error(j.message || ('HTTP ' + r.status));
        it.status = 'creada';
        if (btn) btn.style.display = 'none';
        if (sel) sel.disabled = true;
        if (estado) estado.innerHTML = `<span style="color:#166534;font-size:.82rem;font-weight:600">✓ ${escapeHtml(j.guia)}</span>`;
    } catch (err) {
        it.status = 'idle';
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = 'Reintentar'; }
        if (estado) estado.innerHTML = `<span style="color:#991b1b;font-size:.78rem;cursor:help" title="${escapeHtml(err.message || '')}">⚠️ ${escapeHtml((err.message || 'error').slice(0, 44))}…</span>`;
    }
}
window.crearGuiaLote = crearGuiaLote;

// Pedido activo en el modal (se guarda el OBJETO, no el índice, para no desincronizar tras un re-render).
let _guiaEnvioActual = null;
let _creandoGuia = false; // guardia anti doble-clic (evita doble cobro).

// Abre el modal para el pedido en el índice i y lanza la cotización.
function openGuiaModal(i) {
    const e = (window._enviosData || [])[i];
    if (!e || !e.datos) return;
    _guiaEnvioActual = e;
    const d = e.datos;
    const m = _guiaModalEl();
    const resumen = `${escapeHtml(d.nombre || '')} · ${escapeHtml(d.ciudad || '')}, ${escapeHtml(d.estado || '')} · C.P. ${escapeHtml(d.codigoPostal || '')}`;
    m.querySelector('#guia-modal-box').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0;font-size:1.05rem;font-weight:700">Guía DHL — Pedido ${escapeHtml(e.orderNumber)}</h3>
          <button onclick="closeGuiaModal()" style="border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#64748b">&times;</button>
        </div>
        <p style="font-size:.8rem;color:var(--color-text-light,#64748b);margin:0 0 10px">${resumen}</p>
        <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;color:var(--color-text,#334155);margin:0 0 12px;cursor:pointer;user-select:none;padding:8px 10px;background:var(--color-subtle-bg,#f8fafc);border:1px solid var(--color-border,#e5e7eb);border-radius:8px">
          <input type="checkbox" id="guia-skip-notify" style="width:16px;height:16px;cursor:pointer;accent-color:var(--color-primary,#ef4444)">
          <span>No enviar mensaje al cliente <span style="color:#94a3b8">(ya se le avisó)</span></span>
        </label>
        <div id="guia-cotiz"><i class="fas fa-spinner fa-spin mr-2"></i>Cotizando…</div>`;
    m.style.display = 'flex';
    _cotizarEnModal();
}
window.openGuiaModal = openGuiaModal;

// Cotiza DHL para el pedido activo del modal y pinta las opciones (usa _guiaEnvioActual).
async function _cotizarEnModal() {
    const e = _guiaEnvioActual;
    if (!e) return;
    const cont = document.getElementById('guia-cotiz');
    if (cont) cont.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Cotizando…';
    try {
        const r = await fetch(`${API_BASE_URL}/api/envios/cotizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cp: e.datos.codigoPostal }) });
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.message || ('HTTP ' + r.status));
        // Todas las paqueterías que devuelve T1 (DHL, FedEx…), ya vienen ordenadas por precio (más barata primero).
        const list = (j.servicios || []);
        if (!list.length) { if (cont) cont.innerHTML = '<p style="color:#b45309">No hubo servicios para este C.P.</p>'; return; }
        const rowsHtml = list.map(s => {
            const costo = s.costo != null ? `$${Number(s.costo).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—';
            // Se manda tipo_servicio (el codigo que espera el proveedor) + proveedor (t1|ep).
            const payload = encodeURIComponent(JSON.stringify({ proveedor: s.proveedor, tipoServicio: s.codigoServicio || s.tipo_servicio, servicioNombre: s.servicio, mensajeria: s.paqueteria, costo: s.costo }));
            const diasTxt = s.dias == null || s.dias === '' ? '' : (typeof s.dias === 'number' ? ` · ${s.dias} día(s)` : ` · ${escapeHtml(String(s.dias))}`);
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--color-border,#e5e7eb);border-radius:10px;margin-bottom:8px">
                <div><div style="font-weight:600;display:flex;align-items:center;gap:6px">${courierBadge(s.paqueteria)}<span>${escapeHtml(s.servicio || '')}</span></div>
                  <div style="font-size:.78rem;color:#64748b">${escapeHtml(s.tipo_servicio || '')}${diasTxt}</div></div>
                <div style="text-align:right;white-space:nowrap"><div style="font-weight:700">${costo}</div>
                  <button onclick="crearGuiaDesdeModal('${payload}')" style="margin-top:4px;background:var(--color-primary,#ef4444);color:#fff;border:none;border-radius:8px;padding:5px 12px;font-size:.78rem;cursor:pointer">Crear guía</button></div>
              </div>`;
        }).join('');
        if (cont) cont.innerHTML = rowsHtml + `<p style="font-size:.72rem;color:#94a3b8;margin:6px 0 0"><i class="fas fa-circle-info mr-1"></i>Crear la guía descuenta el costo de tu saldo T1.</p>`;
    } catch (err) {
        const c = document.getElementById('guia-cotiz'); if (c) c.innerHTML = `<p style="color:#991b1b">No se pudo cotizar: ${escapeHtml(err.message || String(err))}</p><div style="text-align:center;margin-top:10px"><button onclick="_cotizarEnModal()" style="border:1px solid var(--color-border,#e5e7eb);background:transparent;border-radius:8px;padding:6px 14px;cursor:pointer">Reintentar</button></div>`;
    }
}
window._cotizarEnModal = _cotizarEnModal;

// Crea la guía (previa confirmación del costo). Guardia anti doble-clic; maneja el caso "creada pero no guardada".
async function crearGuiaDesdeModal(payloadEnc) {
    const e = _guiaEnvioActual;
    if (!e || _creandoGuia) return;
    let opt = {};
    try { opt = JSON.parse(decodeURIComponent(payloadEnc)); } catch (_) { }
    const costoTxt = opt.costo != null ? `$${Number(opt.costo).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : 'su costo';
    const nombreServ = opt.servicioNombre || opt.tipoServicio || '';
    const okCrearGuia = await showConfirmModal(`¿Crear guía <b>${escapeHtml((opt.mensajeria || '') + ' ' + (nombreServ || '')).trim()}</b> para el pedido ${escapeHtml(String(e.orderNumber))}?<br><span style="display:block;margin-top:6px;color:var(--color-text-light,#64748b);font-size:12.5px">Esto descontará <b>${escapeHtml(costoTxt)}</b> de tu saldo T1.</span>`, { icon: 'fa-box', confirmText: 'Crear guía' });
    if (!okCrearGuia) return;
    _creandoGuia = true;
    const box = document.getElementById('guia-cotiz');
    if (box) box.innerHTML = '<p style="text-align:center"><i class="fas fa-spinner fa-spin mr-2"></i>Creando guía… (no cierres esta ventana)</p>';
    const btnStyle = 'text-decoration:none;background:var(--color-primary,#ef4444);color:#fff;border-radius:8px;padding:8px 14px;font-size:.85rem';
    try {
        const r = await fetch(`${API_BASE_URL}/api/envios/crear-guia`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderNumber: e.orderNumber, docId: e.id, manualId: e.manualId || null, proveedor: opt.proveedor, tipoServicio: opt.tipoServicio, mensajeria: opt.mensajeria, costo: opt.costo, datos: e.datos, skipNotify: !!(document.getElementById('guia-skip-notify') || {}).checked }),
        });
        const j = await r.json();
        // Caso crítico: la guía SÍ se creó/cobró en T1 pero no se pudo guardar en el CRM -> mostrar el número para anotarlo.
        if (j && j.persistError && j.guia) {
            if (box) box.innerHTML = `<div style="text-align:center;padding:6px 0">
                <div style="font-size:1.8rem">⚠️</div>
                <p style="font-weight:700;margin:4px 0">Guía creada, pero no se guardó en el CRM</p>
                <p style="margin:2px 0">Anota el N° de rastreo: <b>${escapeHtml(j.guia)}</b></p>
                <p style="font-size:.78rem;color:#991b1b;margin:6px 0">${escapeHtml(j.message || '')}</p>
                <button onclick="closeGuiaModal(); renderEnviosView();" style="margin-top:12px;border:1px solid var(--color-border,#e5e7eb);background:transparent;border-radius:8px;padding:7px 16px;cursor:pointer">Cerrar</button>
              </div>`;
            return;
        }
        if (!r.ok || !j.success) { const _dt = j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : ''; throw new Error((j.message || ('HTTP ' + r.status)) + (_dt ? ' — ' + _dt : '')); }
        // Mover la fila a "Con guía" AL INSTANTE (sin F5): actualizar en memoria y re-pintar la lista de fondo.
        try {
            if (e && j.guia) {
                e.guiaEnvio = { proveedor: j.proveedor || opt.proveedor || 't1', guia: j.guia, mensajeria: opt.mensajeria || (opt.proveedor === 'ep' ? 'ENVIOSPERROS' : 'DHL'), tipoServicio: opt.tipoServicio || null, costo: (opt.costo != null ? Number(opt.costo) : null), pdfPath: j.pdfPath || null, labelUrl: j.labelUrl || null, tracking: j.tracking || null };
                if (typeof _paintEnvios === 'function') _paintEnvios();
            }
        } catch (_) { }
        const etiqueta = j.pdfPath ? `<a href="${API_BASE_URL}/api/envios/etiqueta?path=${encodeURIComponent(j.pdfPath)}" target="_blank" rel="noopener" style="${btnStyle}">🏷️ Descargar etiqueta</a>` : (j.labelUrl ? `<a href="${j.labelUrl}" target="_blank" rel="noopener" style="${btnStyle}">🏷️ Etiqueta</a>` : '');
        const rastreo = j.tracking ? `<a href="${j.tracking}" target="_blank" rel="noopener" style="${btnStyle};background:#334155">📍 Rastrear</a>` : '';
        const titulo = j.already ? 'Este pedido ya tenía guía' : '¡Guía creada!';
        if (box) box.innerHTML = `<div style="text-align:center;padding:6px 0">
            <div style="font-size:2rem">✅</div>
            <p style="font-weight:700;margin:4px 0">${titulo}</p>
            <p style="margin:2px 0">N° de rastreo: <b>${escapeHtml(j.guia)}</b></p>
            ${j.pdfPath ? '' : '<p style="font-size:.75rem;color:#b45309;margin:4px 0">La etiqueta PDF no quedó disponible; puedes descargarla desde el panel de T1.</p>'}
            <div style="display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap">${etiqueta}${rastreo}</div>
            <button onclick="closeGuiaModal(); renderEnviosView();" style="margin-top:16px;background:transparent;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;padding:7px 16px;cursor:pointer">Cerrar</button>
          </div>`;
    } catch (err) {
        if (box) box.innerHTML = `<p style="color:#991b1b">No se pudo crear la guía: ${escapeHtml(err.message || String(err))}</p>
            <div style="text-align:center;margin-top:10px"><button onclick="_cotizarEnModal()" style="border:1px solid var(--color-border,#e5e7eb);background:transparent;border-radius:8px;padding:6px 14px;cursor:pointer">Volver a cotizar</button></div>`;
    } finally {
        _creandoGuia = false;
    }
}
window.crearGuiaDesdeModal = crearGuiaDesdeModal;

// Cambia entre las sub-pestañas del hub IA (Entrenamiento · Simulador · Rescate).
function switchIaTab(tab) {
    document.querySelectorAll('.ia-tab').forEach(t => t.classList.toggle('active', t.dataset.iatab === tab));
    let activePane = null;
    document.querySelectorAll('.ia-pane').forEach(p => {
        const on = p.dataset.iapane === tab;
        p.classList.toggle('active', on);
        if (on) activePane = p;
    });
    if (typeof state !== 'undefined') state.iaTab = tab;

    // Carga diferida de cada panel la primera vez que se abre (el flag vive en el DOM,
    // que se recrea al volver a entrar al hub).
    if (activePane && !activePane.dataset.loaded) {
        activePane.dataset.loaded = '1';
        if (tab === 'entrenamiento' && typeof renderAITrainingView === 'function') renderAITrainingView();
        else if (tab === 'rescate' && typeof renderOrderFollowupView === 'function') renderOrderFollowupView();
        // 'simulador' no requiere render diferido (sus handlers son inline en el template).
    }
}

/**
 * Muestra u oculta la barra lateral principal.
 */
function toggleTagSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (sidebar) {
        // En móviles y tablets (menor a 768px), usamos el modo drawer lateral
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('mobile-open');
            if (overlay) overlay.classList.toggle('active');
            
            // Si abrimos la barra lateral en móvil, aseguramos que pierda el modo colapsado de escritorio
            sidebar.classList.remove('collapsed');
        } else {
            // En escritorio mantemos la lógica actual de expandir/colapsar
            sidebar.classList.toggle('collapsed');
            state.isTagSidebarOpen = !sidebar.classList.contains('collapsed');
        }
    }
}

// --- Component & Specific View Renderers ---

/**
 * Dibuja los botones de filtro por etiquetas en la vista de chats.
 */
function renderTagFilters() {
    if (state.activeView !== 'chats') return;
    const container = document.getElementById('tag-filters-container');
    if (!container) return;

    // Verificar si algún filtro del dropdown está activo (solo etiquetas)
    const dropdownFilters = state.tags.map(t => t.key);
    const activeDropdownFilter = dropdownFilters.includes(state.activeFilter);
    const activeDropdownLabel = state.tags.find(t => t.key === state.activeFilter)?.label || null;

    // Botón "Todos"
    const anyAdFilter = Array.isArray(state.adIdFilters) && state.adIdFilters.length > 0;
    let buttonsHtml = `<button id="filter-all" class="filter-btn ${state.activeFilter === 'all' && !state.unreadOnly && !state.purchaseFilter && !state.designReviewFilter && !state.archivedOnly && !anyAdFilter ? 'active' : ''}" onclick="setFilter('all')">Todos</button>`;

    // Estado de pedido (texto explícito — reemplaza las coronas)
    const greyActive = state.purchaseFilter === 'registered' || state.purchaseFilter === 'both';
    buttonsHtml += `<button id="filter-crown-registered" class="filter-btn ${greyActive ? 'active' : ''}" onclick="setPurchaseFilter('registered')" title="Pedidos registrados sin pagar">Registrados</button>`;

    const blueActive = state.purchaseFilter === 'completed' || state.purchaseFilter === 'both';
    buttonsHtml += `<button id="filter-crown-completed" class="filter-btn ${blueActive ? 'active' : ''}" onclick="setPurchaseFilter('completed')" title="Pedidos pagados">Pagados</button>`;

    // "En diseño" (reemplaza el pincel)
    buttonsHtml += `<button id="filter-design" class="filter-btn ${state.designReviewFilter ? 'active' : ''}" onclick="toggleDesignFilter()" title="En revisión de diseño">En diseño</button>`;

    // "Pendientes IA" (sin morado)
    buttonsHtml += `<button id="filter-pendientes_ia" class="filter-btn ${state.activeFilter === 'pendientes_ia' ? 'active' : ''}" onclick="setFilter('pendientes_ia')">Pendientes IA</button>`;

    // "No leídos"
    buttonsHtml += `<button id="filter-unread" class="filter-btn ${state.unreadOnly ? 'active' : ''}" onclick="toggleUnreadFilter()">No leídos</button>`;
    // "Archivados" (vista de chats archivados)
    buttonsHtml += `<button id="filter-archived" class="filter-btn ${state.archivedOnly ? 'active' : ''}" onclick="toggleArchivedFilter()"><i class="fas fa-box-archive mr-1"></i>Archivados</button>`;

    // "Anuncio" — selector multi-anuncio (dropdown con buscador + casillas). Filtra por anuncio(s)
    // de origen: muestra los chats que tuvieron CUALQUIERA de los anuncios marcados como fuente.
    const adCount = anyAdFilter ? state.adIdFilters.length : 0;
    const adLabel = adCount > 0 ? `${adCount} anuncio${adCount > 1 ? 's' : ''}` : 'Anuncio';
    buttonsHtml += `<div class="tag-dropdown-wrapper ad-filter-wrapper">
        <button id="filter-ad-id" class="filter-btn tag-dropdown-toggle ${anyAdFilter ? 'active' : ''}" onclick="toggleAdDropdown(event)" title="Filtrar por anuncio(s) de origen">
            <i class="fas fa-bullhorn text-[10px]"></i><span>${adLabel}</span>
        </button>
        <div id="ad-dropdown-menu" class="tag-dropdown-menu ad-dropdown-menu hidden">
            <div class="ad-dropdown-head">
                <input id="ad-filter-search" type="text" class="ad-filter-search" placeholder="Buscar anuncio…" oninput="filterAdOptions(this.value)" onclick="event.stopPropagation()">
            </div>
            <div id="ad-dropdown-list" class="ad-dropdown-list"></div>
            <div class="ad-dropdown-foot">
                <button class="ad-foot-btn" onclick="clearAdFilters()">Limpiar</button>
                <button id="ad-apply-btn" class="ad-foot-btn primary" onclick="applyPendingAdFilters()">Aplicar</button>
            </div>
        </div>
    </div>`;

    // Separador Estado | Canal
    buttonsHtml += `<span class="filter-sep" aria-hidden="true"></span>`;

    // Canales (iconos de marca: WhatsApp / Messenger / Instagram)
    const waActive = state.channelFilter === 'whatsapp';
    buttonsHtml += `<button id="filter-channel-wa" class="filter-btn filter-channel ${waActive ? 'active' : ''}" onclick="toggleChannelFilter('whatsapp')" title="Solo WhatsApp"><i class="fab fa-whatsapp text-xs" style="color: ${waActive ? 'white' : '#25D366'};"></i></button>`;
    const fbActive = state.channelFilter === 'messenger';
    buttonsHtml += `<button id="filter-channel-fb" class="filter-btn filter-channel ${fbActive ? 'active' : ''}" onclick="toggleChannelFilter('messenger')" title="Solo Messenger"><i class="fab fa-facebook-messenger text-xs" style="color: ${fbActive ? 'white' : '#0084FF'};"></i></button>`;
    const igActive = state.channelFilter === 'instagram';
    buttonsHtml += `<button id="filter-channel-ig" class="filter-btn filter-channel ${igActive ? 'active' : ''}" onclick="toggleChannelFilter('instagram')" title="Solo Instagram"><i class="fab fa-instagram text-xs" style="color: ${igActive ? 'white' : '#E1306C'};"></i></button>`;

    // Filtro por Departamento (solo se muestra si hay departamentos disponibles para el usuario)
    const profile = state.currentUserProfile;
    const isAdmin = !profile || profile.role === 'admin';
    let availableDepts = state.departments || [];
    if (!isAdmin && Array.isArray(profile.assignedDepartments) && profile.assignedDepartments.length > 0) {
        const allowed = new Set(profile.assignedDepartments);
        availableDepts = availableDepts.filter(d => allowed.has(d.id));
    }
    if (availableDepts.length > 0) {
        const activeDept = state.activeDepartmentFilter && state.activeDepartmentFilter !== 'all'
            ? availableDepts.find(d => d.id === state.activeDepartmentFilter)
            : null;
        let deptItems = `<button class="tag-dropdown-item ${!activeDept ? 'active' : ''}" onclick="setDepartmentFilter('all'); closeDeptDropdown();">Todos los departamentos</button>`;
        availableDepts.forEach(d => {
            const dot = d.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${d.color};margin-right:6px;vertical-align:middle;"></span>` : '';
            deptItems += `<button class="tag-dropdown-item ${state.activeDepartmentFilter === d.id ? 'active' : ''}" onclick="setDepartmentFilter('${d.id}'); closeDeptDropdown();">${dot}${d.name || 'Sin nombre'}</button>`;
        });
        // Separador Canal | Departamento
        buttonsHtml += `<span class="filter-sep" aria-hidden="true"></span>`;
        buttonsHtml += `<div class="tag-dropdown-wrapper">
            <button class="filter-btn tag-dropdown-toggle ${activeDept ? 'active' : ''}" onclick="toggleDeptDropdown(event)" title="Filtrar por departamento">
                ${activeDept ? `<i class="fas fa-sitemap text-xs mr-1"></i>${activeDept.name}` : '<i class="fas fa-sitemap"></i>'}
            </button>
            <div id="dept-dropdown-menu" class="tag-dropdown-menu hidden">
                ${deptItems}
            </div>
        </div>`;
    }

    // Menú desplegable de tres puntos con los demás filtros (etiquetas)
    let dropdownItems = '';
    state.tags.forEach(tag => {
        dropdownItems += `<button id="filter-${tag.key}" class="tag-dropdown-item ${state.activeFilter === tag.key ? 'active' : ''}" onclick="setFilter('${tag.key}'); closeTagDropdown();">${tag.label}</button>`;
    });

    buttonsHtml += `<div class="tag-dropdown-wrapper">
        <button class="filter-btn tag-dropdown-toggle ${activeDropdownFilter ? 'active' : ''}" onclick="toggleTagDropdown(event)">
            ${activeDropdownLabel ? activeDropdownLabel : '<i class="fas fa-ellipsis-h"></i>'}
        </button>
        <div id="tag-dropdown-menu" class="tag-dropdown-menu hidden">
            ${dropdownItems}
        </div>
    </div>`;

    container.innerHTML = buttonsHtml;
    // Actualizar los contadores después de renderizar los filtros
    actualizarContadorPendientesIA();
    actualizarContadorNoLeidos();
}

function toggleTagDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById('tag-dropdown-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');

    // Cerrar al hacer clic fuera
    if (!menu.classList.contains('hidden')) {
        setTimeout(() => {
            document.addEventListener('click', closeTagDropdownOnOutside, { once: true });
        }, 0);
    }
}

function closeTagDropdown() {
    const menu = document.getElementById('tag-dropdown-menu');
    if (menu) menu.classList.add('hidden');
}

function closeTagDropdownOnOutside(e) {
    const menu = document.getElementById('tag-dropdown-menu');
    const wrapper = menu ? menu.closest('.tag-dropdown-wrapper') : null;
    if (wrapper && !wrapper.contains(e.target)) {
        closeTagDropdown();
    }
}

// --- Dropdown de filtro por Departamento ---
function toggleDeptDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById('dept-dropdown-menu');
    if (!menu) return;
    closeTagDropdown(); // cerrar el de etiquetas si estaba abierto
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
        setTimeout(() => {
            document.addEventListener('click', closeDeptDropdownOnOutside, { once: true });
        }, 0);
    }
}

function closeDeptDropdown() {
    const menu = document.getElementById('dept-dropdown-menu');
    if (menu) menu.classList.add('hidden');
}

function closeDeptDropdownOnOutside(e) {
    const menu = document.getElementById('dept-dropdown-menu');
    const wrapper = menu ? menu.closest('.tag-dropdown-wrapper') : null;
    if (wrapper && !wrapper.contains(e.target)) {
        closeDeptDropdown();
    }
}

// --- Dropdown de filtro por Anuncio (selector multi con buscador) ---
// La selección queda "pendiente" mientras el panel está abierto; se confirma con "Aplicar".
let adFilterPending = new Set();

function toggleAdDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById('ad-dropdown-menu');
    if (!menu) return;
    closeTagDropdown();
    closeDeptDropdown();
    const willOpen = menu.classList.contains('hidden');
    if (!willOpen) { closeAdDropdown(); return; }
    menu.classList.remove('hidden');
    adFilterPending = new Set((state.adIdFilters || []).map(String));
    const search = document.getElementById('ad-filter-search');
    if (search) search.value = '';
    // Dispara la carga del catálogo PRIMERO (marca loading) y luego pinta, para mostrar "Cargando…".
    const loadPromise = (typeof fetchAdsList === 'function') ? fetchAdsList() : Promise.resolve();
    renderAdDropdownList('');
    updateAdApplyLabel();
    loadPromise.then(() => {
        const s = document.getElementById('ad-filter-search');
        renderAdDropdownList(s ? s.value : '');
    });
    setTimeout(() => document.addEventListener('click', closeAdDropdownOnOutside), 0);
    setTimeout(() => { const s = document.getElementById('ad-filter-search'); if (s) s.focus(); }, 30);
}

function closeAdDropdown() {
    const menu = document.getElementById('ad-dropdown-menu');
    if (menu) menu.classList.add('hidden');
    document.removeEventListener('click', closeAdDropdownOnOutside);
}

function closeAdDropdownOnOutside(e) {
    const menu = document.getElementById('ad-dropdown-menu');
    const wrapper = menu ? menu.closest('.tag-dropdown-wrapper') : null;
    if (!wrapper || !wrapper.contains(e.target)) {
        closeAdDropdown();
    }
}

function renderAdDropdownList(filterStr) {
    const listEl = document.getElementById('ad-dropdown-list');
    if (!listEl) return;
    const ads = Array.isArray(state.adsList) ? state.adsList : [];
    if (!ads.length) {
        listEl.innerHTML = `<div class="ad-empty">${state.adsListLoading ? 'Cargando anuncios…' : 'No hay anuncios con conversaciones todavía.'}</div>`;
        return;
    }
    const q = (filterStr || '').trim().toLowerCase();
    const filtered = q
        ? ads.filter(a => (a.name || '').toLowerCase().includes(q) || String(a.id).includes(q))
        : ads;
    if (!filtered.length) {
        listEl.innerHTML = `<div class="ad-empty">Sin coincidencias</div>`;
        return;
    }
    listEl.innerHTML = filtered.map(a => {
        const checked = adFilterPending.has(String(a.id)) ? 'checked' : '';
        const name = escapeHtml(a.name || ('Anuncio ' + a.id));
        const cfg = a.configured ? `<i class="fas fa-circle-check ad-badge" title="Configurado en reglas/respuestas"></i>` : '';
        const count = a.count ? `<span class="ad-count" title="Conversaciones de este anuncio">${a.count}</span>` : '';
        const idAttr = escapeHtml(String(a.id));
        return `<label class="ad-option">
            <input type="checkbox" data-ad-id="${idAttr}" ${checked} onchange="toggleAdPending(this.dataset.adId, this.checked)">
            <span class="ad-option-name">${name}${cfg}</span>
            ${count}
        </label>`;
    }).join('');
}

function filterAdOptions(value) {
    renderAdDropdownList(value);
}

function toggleAdPending(id, checked) {
    id = String(id);
    if (checked) adFilterPending.add(id); else adFilterPending.delete(id);
    updateAdApplyLabel();
}

function updateAdApplyLabel() {
    const btn = document.getElementById('ad-apply-btn');
    if (btn) {
        const n = adFilterPending.size;
        btn.textContent = n > 0 ? `Aplicar (${n})` : 'Aplicar';
    }
}

function applyPendingAdFilters() {
    closeAdDropdown();
    if (typeof applyAdFilters === 'function') applyAdFilters(Array.from(adFilterPending));
}

window.toggleAdDropdown = toggleAdDropdown;
window.filterAdOptions = filterAdOptions;
window.toggleAdPending = toggleAdPending;
window.applyPendingAdFilters = applyPendingAdFilters;

function toggleStatusDropdown(event) {
    event.stopPropagation();
    const wrapper = event.target.closest('.status-dropdown-wrapper');
    const menu = wrapper?.querySelector('.status-dropdown-menu');
    if (!menu) return;
    // Cerrar otros dropdowns de status abiertos
    document.querySelectorAll('.status-dropdown-menu').forEach(m => {
        if (m !== menu) m.classList.add('hidden');
    });
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
        setTimeout(() => {
            document.addEventListener('click', function closeOnOutside(e) {
                if (!wrapper.contains(e.target)) {
                    menu.classList.add('hidden');
                    document.removeEventListener('click', closeOnOutside);
                }
            });
        }, 0);
    }
}

function closeStatusDropdown() {
    document.querySelectorAll('.status-dropdown-menu').forEach(m => m.classList.add('hidden'));
}

/**
 * Cambia la pestaña activa del panel de detalles del contacto (Perfil / Pedidos / Notas).
 * Guarda la selección en el estado para que persista al re-renderizar el panel.
 */
function switchContactPanelTab(tabId) {
    state.contactPanelTab = tabId;
    document.querySelectorAll('.cdetails-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.cdetails-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tabId));
}

/**
 * Actualiza el contador visual de chats pendientes de IA.
 * Puede recibir un conteo pre-calculado (desde un listener en tiempo real) o consultarlo al servidor.
 * @param {number|null} precomputedCount El conteo actual, si ya se conoce.
 */
async function actualizarContadorPendientesIA(precomputedCount = null) {
    const filterBtn = document.getElementById('filter-pendientes_ia');
    if (!filterBtn) return;

    // 1. Obtener el total (usar el valor del listener si existe, sino consultar API)
    let totalPendientes;
    if (precomputedCount !== null) {
        totalPendientes = precomputedCount;
    } else {
        totalPendientes = await fetchPendingAiCount();
    }

    // 2. Buscar o crear el badge del contador
    let badge = document.getElementById('pending-ai-counter');
    
    if (!badge) {
        // Si no existe, lo insertamos al final del botón
        badge = document.createElement('span');
        badge.id = 'pending-ai-counter';
        badge.className = 'ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm transition-all duration-300';
        badge.style.backgroundColor = 'var(--color-info, #378add)';
        filterBtn.appendChild(badge);
    }

    // 3. Actualizar el valor y la visibilidad
    if (totalPendientes > 0) {
        badge.textContent = totalPendientes;
        badge.classList.remove('hidden');
        badge.style.display = 'inline-block';
    } else {
        badge.classList.add('hidden');
        badge.style.display = 'none';
    }
}

/**
 * Actualiza el badge del contador de chats No leídos en el chip "No leídos".
 * Usa el conteo del listener en tiempo real (state.unreadTotalCount) o el valor recibido.
 */
function actualizarContadorNoLeidos(precomputedCount = null) {
    const filterBtn = document.getElementById('filter-unread');
    if (!filterBtn) return;
    const total = precomputedCount !== null ? precomputedCount : (state.unreadTotalCount || 0);

    let badge = document.getElementById('unread-counter');
    if (!badge) {
        badge = document.createElement('span');
        badge.id = 'unread-counter';
        badge.className = 'ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm transition-all duration-300';
        badge.style.backgroundColor = 'var(--color-info, #378add)';
        filterBtn.appendChild(badge);
    }

    if (total > 0) {
        badge.textContent = total;
        badge.classList.remove('hidden');
        badge.style.display = 'inline-block';
    } else {
        badge.classList.add('hidden');
        badge.style.display = 'none';
    }
}

// Renderiza la ventana principal de chat (cabecera, mensajes/notas, footer)
function renderChatWindow(options = {}) {
    if (state.activeView !== 'chats' && !state.chatModalOpen) return; // permite pintar en el modal de Envíos

    const chatPanelEl = document.getElementById('chat-panel');
    if (!chatPanelEl) return;

    // Capturamos el scroll ANTES de borrar el contenido
    const messagesContainer = document.getElementById('messages-container');
    const savedScrollTop = messagesContainer ? messagesContainer.scrollTop : null;

    // Busca el contacto seleccionado actualmente en el estado global
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    
    // Renderiza la plantilla de la ventana de chat
    chatPanelEl.innerHTML = ChatWindowTemplate(contact);

    // Añade listener al input de búsqueda de contactos
    const searchInput = document.getElementById('search-contacts-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
    }

    // Si hay un contacto seleccionado, renderiza sus componentes específicos
    if (contact) {
        // Renderiza los botones de estado/etiqueta
        const statusWrapper = document.getElementById('contact-status-wrapper');
        if (statusWrapper) { statusWrapper.innerHTML = StatusButtonsTemplate(contact); }

        // Si la pestaña activa es 'chat'
        if (state.activeTab === 'chat') {
            // Configurar opciones de renderizado
            const renderMsgOptions = {};
            
            // Si se pide preservar el scroll, desactivamos explicitamente scrollToBottom
            // y restauramos la posición si la tenemos
            if (options.preserveScroll) {
                renderMsgOptions.scrollToBottom = false;
                if (savedScrollTop !== null) {
                    renderMsgOptions.scrollTop = savedScrollTop;
                }
            }
            
            renderMessages(renderMsgOptions);

            // Añade listener de scroll para la cabecera de fecha flotante
            const messagesContainerNew = document.getElementById('messages-container');
            if (messagesContainerNew) { 
                messagesContainerNew.addEventListener('scroll', () => { 
                    if (!ticking) { 
                        window.requestAnimationFrame(() => { handleScroll(); ticking = false; }); 
                        ticking = true; 
                    } 
                }); 
            }

            // Añade listeners al formulario de envío de mensajes
            const messageForm = document.getElementById('message-form');
            const messageInput = document.getElementById('message-input');
            if (messageForm) messageForm.addEventListener('submit', handleSendMessage);
            if (messageInput) {
                messageInput.addEventListener('paste', handlePaste); 
                messageInput.addEventListener('input', handleQuickReplyInput);
                messageInput.addEventListener('keydown', handleMessageInputKeyDown);

                // Ajustar altura del textarea dinámicamente
                messageInput.addEventListener('input', () => {
                    messageInput.style.height = 'auto';
                    let newHeight = messageInput.scrollHeight;
                    if (newHeight > 120) {
                        newHeight = 120;
                    }
                    messageInput.style.height = newHeight + 'px';
                });

                messageInput.focus();
            }

        } else if (state.activeTab === 'notes') {
            renderNotes(); 
            document.getElementById('note-form').addEventListener('submit', handleSaveNote);
        }
    }
}

// --- NUEVO: Renderiza la tabla de departamentos ---
function renderDepartmentsView() {
    if (state.activeView !== 'departments') return;
    const tableBody = document.getElementById('departments-table-body');
    if (!tableBody) return;

    if (state.departments.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-4">No hay departamentos creados.</td></tr>`;
        return;
    }

    tableBody.innerHTML = state.departments.map(dept => `
        <tr>
            <td class="font-semibold">${dept.name}</td>
            <td>
                <div class="tag-color-cell">
                    <span class="tag-color-swatch" style="background-color: ${dept.color || '#6c757d'};"></span>
                    <span>${dept.color || '#6c757d'}</span>
                </div>
            </td>
            <td>
                <button onclick="enterDepartment('${dept.id}')" class="dept-count-badge" title="Ver los chats de este departamento">
                    <i class="fas fa-comments mr-1 text-gray-400"></i>
                    <span id="dept-count-${dept.id}" class="dept-count-value text-gray-400"><i class="fas fa-spinner fa-spin"></i></span>
                </button>
            </td>
            <td class="actions-cell">
                <button onclick="openDepartmentModal(state.departments.find(d => d.id === '${dept.id}'))" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteDepartment('${dept.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');

    // Cargar los conteos de contactos por departamento (asíncrono) y parchear las celdas.
    loadDepartmentCounts();
}

/**
 * Obtiene del servidor cuántos contactos hay en cada departamento y
 * actualiza las celdas de la columna "Contactos" sin recargar la tabla.
 */
async function loadDepartmentCounts() {
    const counts = await fetchDepartmentContactCounts();
    if (state.activeView !== 'departments') return; // El usuario ya navegó a otra vista.

    state.departments.forEach(dept => {
        const cell = document.getElementById(`dept-count-${dept.id}`);
        if (!cell) return;
        if (counts && typeof counts[dept.id] === 'number') {
            cell.textContent = counts[dept.id];
            cell.classList.remove('text-gray-400');
        } else {
            cell.textContent = '—';
        }
    });
}

/**
 * "Entrar" a un departamento: fuerza el filtro a ese departamento, abre la
 * vista de Chats y recarga la lista desde el servidor ya filtrada (mismo
 * comportamiento que elegir el departamento en el filtro de Chats).
 */
function enterDepartment(deptId) {
    // Forzar el filtro a ESTE departamento (sin togglear a "todos").
    state.activeDepartmentFilter = deptId || 'all';
    navigateTo('chats', true);
    // Traer del servidor los chats de ese departamento (no usar solo la caché).
    state.contacts = [];
    if (typeof renderTagFilters === 'function') renderTagFilters();
    if (typeof fetchInitialContacts === 'function') fetchInitialContacts();
}
window.enterDepartment = enterDepartment;

// --- NUEVO: Renderiza la tabla de reglas de enrutamiento ---
function renderAdRoutingView() {
    if (state.activeView !== 'ad-routing') return;
    const tableBody = document.getElementById('ad-routing-table-body');
    if (!tableBody) return;

    if (state.adRoutingRules.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-4">No hay reglas de enrutamiento.</td></tr>`;
        return;
    }

    tableBody.innerHTML = state.adRoutingRules.map(rule => {
        const dept = state.departments.find(d => d.id === rule.targetDepartmentId);
        const deptName = dept ? dept.name : 'Departamento desconocido';
        const adIdsText = Array.isArray(rule.adIds) ? rule.adIds.join(', ') : rule.adId || '';

        return `
            <tr>
                <td class="font-semibold">${rule.ruleName}</td>
                <td class="font-mono text-sm max-w-xs truncate" title="${adIdsText}">${adIdsText}</td>
                <td><span class="px-2 py-1 rounded text-xs font-bold text-white" style="background-color: ${dept?.color || '#6c757d'}">${deptName}</span></td>
                <td class="text-center font-bold">
                    ${rule.enableAi 
                        ? '<span class="text-green-500" title="IA Activada"><i class="fas fa-robot animate-pulse mr-1"></i>Sí</span>' 
                        : '<span class="text-gray-400">No</span>'}
                </td>
                <td class="actions-cell">
                    <button onclick="openAdRoutingModal(state.adRoutingRules.find(r => r.id === '${rule.id}'))" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                    <button onclick="handleDeleteAdRoutingRule('${rule.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

// Renderiza la tabla de etiquetas y configura el drag-and-drop
function renderTagsView() {
    if (state.activeView !== 'etiquetas') return;
    const tableBody = document.getElementById('tags-table-body');
    if (!tableBody) return;

    // Genera el HTML para cada fila de la tabla
    tableBody.innerHTML = state.tags.map(tag => `
        <tr class="draggable-row" data-id="${tag.id}">
            <td class="drag-handle text-center"><i class="fas fa-grip-vertical"></i></td>
            <td class="font-semibold">${tag.label}</td>
            <td>
                <div class="tag-color-cell">
                    <span class="tag-color-swatch" style="background-color: ${tag.color};"></span>
                    <span>${tag.color}</span>
                </div>
            </td>
            <td class="actions-cell">
                <button onclick="openTagModal(state.tags.find(t => t.id === '${tag.id}'))" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteTag('${tag.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');

    // Inicializa SortableJS para permitir reordenar las etiquetas arrastrando
    initTagsSortable();
}

// Renderiza la tabla de contactos (vista 'contacts')
function renderContactsView() {
    if (state.activeView !== 'contacts') return;
    const tableBody = document.getElementById('contacts-table-body');
    if (!tableBody) return;

    // Genera el HTML para cada fila
    tableBody.innerHTML = state.contacts.map(contact => {
         // Busca la información de la etiqueta del contacto
         const tag = state.tags.find(t => t.key === contact.status) || { label: 'Sin etiqueta', color: '#d1d5db' };
        return `
            <tr>
                <td class="font-semibold">${contact.name || 'Desconocido'}</td>
                <td>${contact.id}</td>
                <td>${contact.email || 'N/A'}</td>
                <td>
                    <span class="px-2 py-1 text-xs rounded-full text-white" style="background-color: ${tag.color};">${tag.label}</span>
                </td>
                <td class="actions-cell">
                    ${contact.channel === 'messenger' ? '<span class="p-2" title="Messenger"><i class="fab fa-facebook-messenger" style="color:#0084FF"></i></span>'
                    : contact.channel === 'instagram' ? '<span class="p-2" title="Instagram"><i class="fab fa-instagram" style="color:#E1306C"></i></span>'
                    : `<a href="https://wa.me/${contact.id}" target="_blank" class="p-2" title="WhatsApp"><i class="fab fa-whatsapp" style="color:#25D366"></i></a>`}
                    <button onclick="openEditContactModal('${contact.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                    <button onclick="handleDeleteContact('${contact.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>
        `
    }).join('');
}

// =====================================================================
// === VISTA CLIENTES — pestañas Clientes / Leads / Contactos          ===
// =====================================================================
// Clientes  = pagaron (purchaseStatus 'completed')
// Leads     = registraron pedido sin pagar (purchaseStatus 'registered')
// Contactos = sin pedido (resto). Para no saturar, Contactos solo carga los
//             últimos 3 días; los conteos totales vienen de /api/crm-list/counts.
const CRM_CONTACTOS_DAYS = 3;

/** Punto de entrada de la vista (lo llama navigateTo('clientes')).
 * Usa caché en memoria (state.crmCache / state.crmCounts): la primera vez pide al
 * servidor; las siguientes veces se muestra al instante sin recargar. Botón "Actualizar"
 * para refrescar a demanda. */
function loadCrmView() {
    if (state.activeView !== 'clientes') return;
    if (!state.crmTab) state.crmTab = 'clientes';
    if (!state.crmCache) state.crmCache = {};
    document.querySelectorAll('.crm-tab').forEach(b => b.classList.toggle('active', b.dataset.crmtab === state.crmTab));
    updateCrmSortVisibility();
    if (state.crmCounts) applyCrmCounts(state.crmCounts); else loadCrmCounts();
    if (state.crmTab === 'graficos') loadCrmCharts(); // usa caché si ya se cargó antes
    else loadCrmList();
}

/** Alterna barra de filtros / tabla / gráficos y el texto de ayuda según la pestaña. */
function updateCrmSortVisibility() {
    const isCharts = state.crmTab === 'graficos';
    const toolbar = document.querySelector('.crm-toolbar');
    const table = document.querySelector('.table-responsive-wrapper');
    const charts = document.getElementById('crm-charts');
    if (toolbar) toolbar.style.display = isCharts ? 'none' : '';
    if (table) table.style.display = isCharts ? 'none' : '';
    if (charts) charts.style.display = isCharts ? '' : 'none';

    const wrap = document.getElementById('crm-sort-wrap');
    if (wrap) wrap.style.display = state.crmTab === 'clientes' ? '' : 'none';
    const hint = document.getElementById('crm-tab-hint');
    if (hint) {
        hint.textContent = state.crmTab === 'clientes'
            ? 'Personas que han pagado al menos un pedido.'
            : state.crmTab === 'leads'
                ? 'Registraron un pedido pero aún no han pagado.'
                : state.crmTab === 'contactos'
                    ? `Personas sin pedido. Mostrando los de los últimos ${CRM_CONTACTOS_DAYS} días (el total está en la pestaña).`
                    : 'Resumen visual de tus clientes y compras.';
    }
}

/** Pinta los badges de conteo en las pestañas. */
function applyCrmCounts(d) {
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = (n ?? 0).toLocaleString('es-MX'); };
    set('crm-count-clientes', d.clientes);
    set('crm-count-leads', d.leads);
    set('crm-count-contactos', d.contactos);
}

/** Trae los conteos totales (clientes / leads / contactos), los cachea y los pinta.
 * fresh=true salta la caché del servidor (botón Actualizar). */
function loadCrmCounts(fresh) {
    fetch(`${API_BASE_URL}/api/crm-list/counts${fresh ? '?fresh=1' : ''}`)
        .then(r => r.json())
        .then(d => {
            if (!d || d.success === false) return;
            state.crmCounts = d;
            applyCrmCounts(d);
        })
        .catch(e => console.error('Error conteos CRM:', e));
}

function switchCrmTab(tab) {
    state.crmTab = tab;
    document.querySelectorAll('.crm-tab').forEach(b => b.classList.toggle('active', b.dataset.crmtab === tab));
    updateCrmSortVisibility();
    if (tab === 'graficos') loadCrmCharts();
    else loadCrmList();
}

/** Pestaña Gráficos: asegura tener los datos de clientes y dibuja el dashboard. */
function loadCrmCharts(fresh) {
    if (state.activeView !== 'clientes') return;
    const container = document.getElementById('crm-charts');
    if (!container) return;
    if (!state.crmCounts) loadCrmCounts();
    if (!fresh && state.crmCache && state.crmCache.clientes) {
        renderCrmCharts();
        return;
    }
    container.innerHTML = '<div class="text-center text-gray-400 py-12"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando datos de clientes…</div>';
    fetch(`${API_BASE_URL}/api/crm-list/items?tab=clientes${fresh ? '&fresh=1' : ''}`)
        .then(r => r.json())
        .then(d => {
            if (!state.crmCache) state.crmCache = {};
            state.crmCache.clientes = d.items || [];
            renderCrmCharts();
        })
        .catch(e => {
            console.error('Error cargando datos para gráficos:', e);
            container.innerHTML = `<div class="text-center py-12" style="color:var(--color-danger);"><i class="fas fa-exclamation-triangle mr-2"></i>No se pudieron cargar los datos.</div>`;
        });
}

/** Calcula métricas desde state.crmCache.clientes + conteos y dibuja los charts (Chart.js). */
function renderCrmCharts() {
    const container = document.getElementById('crm-charts');
    if (!container) return;
    const clientes = (state.crmCache && state.crmCache.clientes) || [];
    const counts = state.crmCounts || {};

    (state.crmCharts || []).forEach(ch => { try { ch.destroy(); } catch (e) {} });
    state.crmCharts = [];

    const ingresoTotal = clientes.reduce((s, c) => s + (c.totalSpent || 0), 0);
    const comprasTotales = clientes.reduce((s, c) => s + (c.orderCount || 0), 0);
    const ticket = comprasTotales > 0 ? ingresoTotal / comprasTotales : 0;
    const recurrentes = clientes.filter(c => (c.orderCount || 0) >= 2).length;
    const pctRec = clientes.length > 0 ? Math.round((recurrentes / clientes.length) * 100) : 0;

    const prod = {};
    clientes.forEach(c => (c.products || []).forEach(p => { if (p) prod[p] = (prod[p] || 0) + 1; }));
    const topProd = Object.entries(prod).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const dist = { '1': 0, '2': 0, '3': 0, '4+': 0 };
    clientes.forEach(c => { const n = c.orderCount || 0; if (n <= 1) dist['1']++; else if (n === 2) dist['2']++; else if (n === 3) dist['3']++; else dist['4+']++; });

    const top10 = clientes.slice().sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0)).slice(0, 10);

    const byMonth = {};
    clientes.forEach(c => { if (c.lastOrderDate) { const d = new Date(c.lastOrderDate); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; byMonth[k] = (byMonth[k] || 0) + 1; } });
    const months = Object.keys(byMonth).sort().slice(-12);

    const money = n => '$' + Math.round(n).toLocaleString('es-MX');
    const kpi = (label, val, sub) => `<div class="crm-kpi"><div class="crm-kpi-val">${val}</div><div class="crm-kpi-label">${label}</div>${sub ? `<div class="crm-kpi-sub">${sub}</div>` : ''}</div>`;

    container.innerHTML = `
        <div class="crm-kpi-grid">
            ${kpi('Ingreso total', money(ingresoTotal), `${clientes.length.toLocaleString('es-MX')} clientes`)}
            ${kpi('Compras totales', comprasTotales.toLocaleString('es-MX'), '')}
            ${kpi('Ticket promedio', money(ticket), 'por compra')}
            ${kpi('Clientes recurrentes', recurrentes.toLocaleString('es-MX'), `${pctRec}% del total`)}
        </div>
        <div class="crm-charts-grid">
            <div class="crm-chart-card"><h3>Embudo</h3><div class="crm-chart-box"><canvas id="cc-funnel"></canvas></div></div>
            <div class="crm-chart-card"><h3>Top productos</h3><div class="crm-chart-box"><canvas id="cc-prod"></canvas></div></div>
            <div class="crm-chart-card"><h3>Clientes por # de compras</h3><div class="crm-chart-box"><canvas id="cc-dist"></canvas></div></div>
            <div class="crm-chart-card"><h3>Clientes por mes (última compra)</h3><div class="crm-chart-box"><canvas id="cc-month"></canvas></div></div>
            <div class="crm-chart-card crm-chart-wide"><h3>Top 10 clientes por gasto</h3><div class="crm-chart-box" style="height:320px;"><canvas id="cc-top"></canvas></div></div>
        </div>`;

    if (typeof Chart === 'undefined') {
        container.insertAdjacentHTML('afterbegin', '<p class="text-xs" style="color:var(--color-danger);">No se pudo cargar la librería de gráficos (Chart.js).</p>');
        return;
    }

    const css = getComputedStyle(document.body);
    const primary = (css.getPropertyValue('--color-primary') || '#ea580c').trim();
    const palette = ['#ea580c', '#163C51', '#81B29A', '#F2CC8F', '#E07A5F', '#3D405B', '#1d9e75', '#378add'];
    const mk = (id, config) => { const el = document.getElementById(id); if (el) state.crmCharts.push(new Chart(el, config)); };
    const noLegend = { plugins: { legend: { display: false } }, maintainAspectRatio: false };

    mk('cc-funnel', {
        type: 'bar',
        data: { labels: ['Contactos', 'Leads', 'Clientes'], datasets: [{ data: [counts.contactos || 0, counts.leads || 0, counts.clientes || clientes.length], backgroundColor: ['#94a3b8', '#F2CC8F', primary] }] },
        options: { ...noLegend, scales: { y: { beginAtZero: true } } }
    });
    mk('cc-prod', {
        type: 'doughnut',
        data: { labels: topProd.map(p => p[0]), datasets: [{ data: topProd.map(p => p[1]), backgroundColor: palette }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
    mk('cc-dist', {
        type: 'bar',
        data: { labels: Object.keys(dist), datasets: [{ data: Object.values(dist), backgroundColor: primary }] },
        options: { ...noLegend, scales: { y: { beginAtZero: true } } }
    });
    mk('cc-month', {
        type: 'line',
        data: { labels: months, datasets: [{ data: months.map(m => byMonth[m]), borderColor: primary, backgroundColor: 'rgba(234,88,12,0.12)', fill: true, tension: 0.3 }] },
        options: { ...noLegend, scales: { y: { beginAtZero: true } } }
    });
    mk('cc-top', {
        type: 'bar',
        data: { labels: top10.map(c => (c.name || c.id || '').toString().slice(0, 18)), datasets: [{ data: top10.map(c => c.totalSpent || 0), backgroundColor: primary }] },
        options: { ...noLegend, indexAxis: 'y', scales: { x: { beginAtZero: true } } }
    });
}

/** Muestra la lista de la pestaña activa. Si ya está en caché, render inmediato;
 * si no (o force=true), la pide al backend y la cachea. El orden se aplica en el
 * cliente (renderCrmList), así cambiar el orden no vuelve a pedir datos. */
function loadCrmList(force, fresh) {
    if (state.activeView !== 'clientes') return;
    const tab = state.crmTab || 'clientes';
    if (!state.crmCache) state.crmCache = {};

    // Caché: si ya cargamos esta pestaña, mostramos al instante sin volver a pedir.
    if (!force && state.crmCache[tab]) {
        state.crmItems = state.crmCache[tab];
        renderCrmList();
        return;
    }

    const body = document.getElementById('crm-tbody');
    if (body) body.innerHTML = `<tr><td colspan="7" class="text-center text-gray-400 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando…</td></tr>`;

    let url = `${API_BASE_URL}/api/crm-list/items?tab=${tab}`;
    if (tab === 'contactos') url += `&days=${CRM_CONTACTOS_DAYS}`;
    if (fresh) url += `&fresh=1`;

    fetch(url)
        .then(async r => {
            const d = await r.json().catch(() => ({}));
            if (!r.ok || d.success === false) throw new Error(d.message || 'Error al cargar la lista.');
            return d;
        })
        .then(d => {
            if (state.activeView !== 'clientes') return;
            state.crmCache[tab] = d.items || [];
            state.crmItems = state.crmCache[tab];
            state.crmTruncated = !!d.truncated;
            renderCrmList();
        })
        .catch(err => {
            console.error('Error al cargar lista CRM:', err);
            if (state.activeView !== 'clientes') return;
            const b = document.getElementById('crm-tbody');
            if (b) b.innerHTML = `<tr><td colspan="7" class="text-center py-8" style="color:var(--color-danger);"><i class="fas fa-exclamation-triangle mr-2"></i>${escapeHtml(err.message || 'Error al cargar.')}</td></tr>`;
        });
}

function populateCrmStatusFilter() {
    const sel = document.getElementById('crm-status-filter');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Todos los estatus</option>' +
        (state.tags || []).map(t => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join('');
    sel.value = current;
}

function crmStatusBadge(c) {
    const tag = (state.tags || []).find(t => t.key === c.status);
    return tag
        ? `<span class="px-2 py-1 text-xs rounded-full" style="background-color:${tag.color}30;color:${tag.color};border:1px solid ${tag.color}80;">${escapeHtml(tag.label)}</span>`
        : `<span class="px-2 py-1 text-xs rounded-full" style="background-color:#e5e7eb;color:#6b7280;">Sin estatus</span>`;
}

const crmFmtMoney = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const crmFmtDate = ms => { if (!ms) return '—'; return new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); };

/** Filtra (buscador + estatus, en cliente) y dibuja columnas según la pestaña. */
function renderCrmList() {
    if (state.activeView !== 'clientes') return;
    const head = document.getElementById('crm-thead');
    const body = document.getElementById('crm-tbody');
    if (!head || !body) return;
    populateCrmStatusFilter();

    const q = (document.getElementById('crm-search')?.value || '').toLowerCase().trim();
    const estatus = document.getElementById('crm-status-filter')?.value || '';
    const tab = state.crmTab || 'clientes';

    const filtered = (state.crmItems || []).filter(c => {
        const matchQ = !q || (c.name || '').toLowerCase().includes(q) || (c.id || '').includes(q);
        const matchE = !estatus || c.status === estatus;
        return matchQ && matchE;
    });

    const action = c => `<td class="actions-cell"><button onclick="handleSelectContactFromPipeline('${c.id}')" class="p-2" title="Abrir chat"><i class="fas fa-comments"></i></button></td>`;

    if (tab === 'clientes') {
        // Orden en el cliente (sobre todos los clientes cargados): cambiar el orden es instantáneo.
        const sort = document.getElementById('crm-sort')?.value || 'recent';
        filtered.sort((a, b) => {
            if (sort === 'spent') return (b.totalSpent || 0) - (a.totalSpent || 0);
            if (sort === 'orders') return (b.orderCount || 0) - (a.orderCount || 0);
            if (sort === 'product') return ((a.products && a.products[0]) || '~').localeCompare((b.products && b.products[0]) || '~');
            return (b.lastOrderDate || b.lastMessageTimestamp || 0) - (a.lastOrderDate || a.lastMessageTimestamp || 0);
        });
        head.innerHTML = `<tr><th>Nombre</th><th>Teléfono</th><th class="text-right">Total</th><th class="text-right">Compras</th><th>Producto(s)</th><th>Última compra</th><th>Acciones</th></tr>`;
        if (!filtered.length) { body.innerHTML = `<tr><td colspan="7" class="text-center text-gray-400 py-8">Sin clientes que coincidan.</td></tr>`; return; }
        body.innerHTML = filtered.map(c => `
            <tr>
                <td class="font-semibold">${escapeHtml(c.name || 'Desconocido')}</td>
                <td>${escapeHtml(c.id || '')}</td>
                <td class="text-right font-semibold">${crmFmtMoney(c.totalSpent)}</td>
                <td class="text-right">${c.orderCount || 0}</td>
                <td title="${escapeHtml((c.products || []).join(', '))}" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((c.products || []).join(', ') || '—')}</td>
                <td>${crmFmtDate(c.lastOrderDate)}</td>
                ${action(c)}
            </tr>`).join('');
    } else {
        head.innerHTML = `<tr><th>Nombre</th><th>Teléfono</th><th>Último mensaje</th><th>Estatus</th><th>Acciones</th></tr>`;
        if (!filtered.length) {
            const vacio = tab === 'contactos' ? `Sin contactos con actividad en los últimos ${CRM_CONTACTOS_DAYS} días.` : 'Sin registros que coincidan.';
            body.innerHTML = `<tr><td colspan="5" class="text-center text-gray-400 py-8">${vacio}</td></tr>`;
            return;
        }
        body.innerHTML = filtered.map(c => `
            <tr>
                <td class="font-semibold">${escapeHtml(c.name || 'Desconocido')}</td>
                <td>${escapeHtml(c.id || '')}</td>
                <td title="${escapeHtml(c.lastMessage || '')}" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.lastMessage || '-')}</td>
                <td>${crmStatusBadge(c)}</td>
                ${action(c)}
            </tr>`).join('');
    }
}

function clearCrmFilters() {
    const s = document.getElementById('crm-search');
    const e = document.getElementById('crm-status-filter');
    if (s) s.value = '';
    if (e) e.value = '';
    renderCrmList();
}

/** Botón "Actualizar": limpia la caché y vuelve a pedir conteos + lista/gráficos. */
function refreshCrmView() {
    state.crmCache = {};
    state.crmCounts = null;
    loadCrmCounts(true);
    if (state.crmTab === 'graficos') loadCrmCharts(true);
    else loadCrmList(true, true);
}

window.loadCrmView = loadCrmView;
window.switchCrmTab = switchCrmTab;
window.loadCrmList = loadCrmList;
window.renderCrmList = renderCrmList;
window.clearCrmFilters = clearCrmFilters;
window.refreshCrmView = refreshCrmView;
window.loadCrmCharts = loadCrmCharts;
window.renderCrmCharts = renderCrmCharts;

// Prepara la vista unificada de Campañas (sub-pestañas Enviar + Crear plantilla)
function renderCampaignsView() {
    if (state.activeView !== 'campanas' && state.activeView !== 'campanas-imagen') return;
    const tagSelect = document.getElementById('campaign-tag-select');
    const templateSelect = document.getElementById('campaign-template-select');

    // Poblar select de etiquetas
    if (tagSelect) {
        tagSelect.innerHTML = '<option value="all">Todos los contactos</option>' + state.tags.map(tag => `<option value="${tag.key}">${tag.label}</option>`).join('');
    }
    // Poblar select de plantillas con TODAS las aprobadas (el valor es el nombre).
    // Las que llevan cabecera de imagen se marcan para mostrar el campo de URL.
    if (templateSelect) {
        templateSelect.innerHTML = '<option value="">-- Selecciona una plantilla --</option>' + state.templates.map(t => {
            const hasImg = (t.components || []).some(c => c.type === 'HEADER' && c.format === 'IMAGE');
            return `<option value="${t.name}">${t.name} (${t.language})${hasImg ? ' 🖼️' : ''}</option>`;
        }).join('');
    }

    // Actualizar contador inicial de destinatarios y visibilidad del campo de imagen.
    // (No se reinicia el form de "Crear plantilla" aquí: esta función se vuelve a
    //  llamar en cada snapshot de contactos/etiquetas y borraría lo que el usuario escribe.)
    updateCampaignRecipientCount();
    if (typeof onCampaignTemplateChange === 'function') onCampaignTemplateChange();
}

// Prepara el formulario para campañas con imagen
function renderCampaignsWithImageView() {
    if (state.activeView !== 'campanas-imagen') return;
    const tagSelect = document.getElementById('campaign-image-tag-select');
    const templateSelect = document.getElementById('campaign-image-template-select');

    // Poblar select de etiquetas
    if (tagSelect) {
        tagSelect.innerHTML = '<option value="all">Todos los contactos</option>' + state.tags.map(tag => `<option value="${tag.key}">${tag.label}</option>`).join('');
    }
    // Poblar select de plantillas (solo las que aceptan imagen en cabecera)
    if (templateSelect) {
        const imageTemplates = state.templates.filter(t => t.components.some(c => c.type === 'HEADER' && c.format === 'IMAGE'));
        templateSelect.innerHTML = '<option value="">-- Selecciona una plantilla --</option>' + imageTemplates.map(t => `<option value='${t.name}'>${t.name} (${t.language})</option>`).join('');
    }
    // Actualizar contador inicial de destinatarios
    updateCampaignRecipientCount('image');
}

// Prepara la vista de difusión masiva
function renderDifusionView() {
    if (state.activeView !== 'difusion' && state.activeView !== 'campanas') return;

    // Poblar dropdown de respuestas rápidas para la secuencia
    const quickReplyDropdown = document.getElementById('quick-reply-dropdown');
    if (quickReplyDropdown) {
        quickReplyDropdown.innerHTML = state.quickReplies.map(qr =>
            `<a href="#" data-id="${qr.id}" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 quick-reply-item"><strong>/${qr.shortcut}</strong>: ${qr.message || 'Adjunto'}</a>`
        ).join('');
    }

    // Poblar select de plantillas para la contingencia
    const contingencyTemplateSelect = document.getElementById('contingency-template-select');
    if (contingencyTemplateSelect) {
        contingencyTemplateSelect.innerHTML = '<option value="">-- Seleccionar plantilla --</option>' + state.templates
            .map(t => `<option value='${JSON.stringify(t)}'>${t.name} (${t.category})</option>`)
            .join('');
    }

    // Llama a la función (definida en difusion-handlers.js) para configurar listeners
    initializeDifusionHandlers();
}

// Renderiza la tabla de respuestas rápidas
function renderQuickRepliesView() {
    if (state.activeView !== 'respuestas-rapidas') return;
    const tableBody = document.getElementById('quick-replies-table-body');
    if (!tableBody) return;

    // Genera HTML para cada fila
    tableBody.innerHTML = state.quickReplies.map(reply => `
        <tr>
            <td class="font-semibold">/${reply.shortcut}</td>
            <td class="text-gray-600">${reply.message || ''} ${reply.fileUrl ? '<i class="fas fa-paperclip text-gray-400 ml-2"></i>' : ''}</td>
            <td class="actions-cell">
                <button onclick="openQuickReplyModal('${reply.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteQuickReply('${reply.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

// Renderiza la tabla de mensajes automáticos por anuncio
function renderAdResponsesView() {
    if (state.activeView !== 'mensajes-ads') return;
    const tableBody = document.getElementById('ad-responses-table-body');
    if (!tableBody) return;

    // Mensaje si no hay respuestas configuradas
    if (state.adResponses.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-4">No has agregado ningún mensaje de anuncio todavía.</td></tr>`;
        return;
    }

    // Genera HTML para cada fila
    tableBody.innerHTML = state.adResponses.map(response => {
        // Muestra los Ad IDs como string separado por comas
        const adIdsText = Array.isArray(response.adIds) ? response.adIds.join(', ') : (response.adId || ''); // Incluye fallback por si hay datos viejos
        return `
            <tr>
                <td class="font-semibold">${response.adName}</td>
                <td class="font-mono text-sm">${adIdsText}</td>
                <td class="text-gray-600 max-w-sm truncate" title="${response.message}">${response.message || ''} ${response.fileUrl ? '<i class="fas fa-paperclip text-gray-400 ml-2"></i>' : ''}</td>
                <td class="actions-cell">
                    <button onclick="openAdResponseModal('${response.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                    <button onclick="handleDeleteAdResponse('${response.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}




// Renderiza la vista del pipeline de ventas
function renderPipelineView() {
    if (state.activeView !== 'pipeline') return;
    const container = document.getElementById('pipeline-container');
    if (!container) return;

    // Genera HTML para cada columna (etiqueta)
    container.innerHTML = state.tags.map(tag => {
        // Filtra contactos que pertenecen a esta etiqueta
        const contactsInStage = state.contacts.filter(c => c.status === tag.key);
        // Calcula no leídos para la cabecera
        const totalUnread = contactsInStage.reduce((sum, contact) => sum + (contact.unreadCount || 0), 0);
        const unreadHeaderBadge = totalUnread > 0 ? `<span class="unread-badge !bg-red-500">${totalUnread}</span>` : '';

        return `
            <div class="pipeline-column">
                <div class="pipeline-header">
                    <span class="tag-color-swatch" style="background-color: ${tag.color};"></span>
                    <span class="font-bold">${tag.label}</span>
                    <span class="ml-auto text-sm font-normal text-gray-500 flex items-center gap-2">
                        ${unreadHeaderBadge}
                        <span class="flex items-center gap-1"><i class="fas fa-user"></i> ${contactsInStage.length}</span>
                    </span>
                </div>
                <div class="pipeline-cards" data-tag-key="${tag.key}">
                    ${contactsInStage.map(contact => { // Genera una tarjeta para cada contacto
                        const unreadBadge = contact.unreadCount > 0 ? `<span class="unread-badge">${contact.unreadCount}</span>` : '';
                        return `
                        <div class="pipeline-card" data-contact-id="${contact.id}" style="border-left-color: ${tag.color};" onclick="handleSelectContactFromPipeline('${contact.id}')">
                            <div class="flex justify-between items-start">
                                <div class="contact-name">${contact.name || 'Desconocido'}</div>
                                ${unreadBadge}
                            </div>
                            <p class="last-message">${contact.lastMessage || 'Sin mensajes'}</p>
                        </div>
                        `
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');

    // Inicializa SortableJS para permitir arrastrar tarjetas entre columnas
    document.querySelectorAll('.pipeline-cards').forEach(column => {
        new Sortable(column, {
            group: 'pipeline', // Permite arrastrar entre columnas del mismo grupo
            animation: 150,
            ghostClass: 'sortable-ghost', // Clase CSS para el placeholder
            onEnd: (evt) => { // Cuando se suelta una tarjeta
                const contactId = evt.item.dataset.contactId; // ID del contacto movido
                const newTagKey = evt.to.dataset.tagKey; // Key de la etiqueta destino
                handleStatusChange(contactId, newTagKey); // Llama a la función para actualizar el estado
            }
        });
    });
}



// Renderiza la vista de ajustes generales
// Llena el <select> de "Respuesta automática de Facebook" con las respuestas
// rápidas actuales, preservando la opción ya seleccionada si sigue existiendo.
function populateMessengerWelcomeSelect() {
    const sel = document.getElementById('messenger-welcome-select');
    if (!sel) return;
    const current = sel.value;
    const opts = ['<option value="">Predeterminada (saludo genérico)</option>'].concat(
        (state.quickReplies || []).map(qr => {
            const preview = (qr.message || (qr.fileUrl ? 'Adjunto' : '')).slice(0, 50);
            return `<option value="${escapeHtml(qr.shortcut)}">/${escapeHtml(qr.shortcut)} — ${escapeHtml(preview)}</option>`;
        })
    );
    sel.innerHTML = opts.join('');
    if (current) sel.value = current;
    // Refleja la opción seleccionada en la barra de texto del combobox buscable.
    if (typeof refreshMessengerWelcomeDisplay === 'function') refreshMessengerWelcomeDisplay();
}

// Cambia de pestaña dentro de Ajustes (Apariencia / Usuarios / Automatización / etc.).
function switchSettingsTab(tab) {
    state.settingsTab = tab;
    document.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', b.dataset.stab === tab));
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.toggle('active', p.dataset.spane === tab));
    // Carga diferida: el perfil de WhatsApp Business se consulta a Meta solo al abrir su pestaña.
    if (tab === 'empresa' && typeof renderBusinessProfile === 'function') renderBusinessProfile();
}
window.switchSettingsTab = switchSettingsTab;

function renderAjustesView() {
    if (state.activeView !== 'ajustes') return;

    // Respuesta automática de Facebook: poblar el select PRIMERO, antes que el
    // resto de la vista, para que nunca quede vacío si algo más fallara después.
    populateMessengerWelcomeSelect();
    if (typeof initMessengerWelcomeCombo === 'function') initMessengerWelcomeCombo();
    if (typeof loadMessengerWelcomeSetting === 'function') loadMessengerWelcomeSetting();
    // Si las respuestas rápidas aún no se han cargado, forzar su carga (el listener
    // luego repoblará el select automáticamente).
    if ((!state.quickReplies || state.quickReplies.length === 0) && typeof listenForQuickReplies === 'function') {
        listenForQuickReplies();
    }
    const saveMwBtn = document.getElementById('save-messenger-welcome-btn');
    if (saveMwBtn && typeof handleSaveMessengerWelcome === 'function') {
        saveMwBtn.removeEventListener('click', handleSaveMessengerWelcome);
        saveMwBtn.addEventListener('click', handleSaveMessengerWelcome);
    }

    // Actualiza el estado del interruptor de mensaje de ausencia
    const awayToggle = document.getElementById('away-message-toggle');
    if (awayToggle) {
        awayToggle.checked = state.awayMessageSettings.isActive;
    }

    // Estado del interruptor de "evento de compra de Meta" (registro vs Fabricar)
    const purchaseToggle = document.getElementById('purchase-trigger-toggle');
    if (purchaseToggle) {
        db.collection('crm_settings').doc('general').get().then(doc => {
            const trigger = (doc.exists && doc.data().purchaseEventTrigger === 'registration') ? 'registration' : 'fabricar';
            purchaseToggle.checked = (trigger === 'fabricar');
            updatePurchaseTriggerLabel(trigger);
        }).catch(() => {});
    }

    // Rellena el input del ID de Google Sheet
    const sheetIdInput = document.getElementById('google-sheet-id-input');
    if (sheetIdInput) {
        sheetIdInput.value = state.googleSheetSettings.googleSheetId || '';
    }
    // Añade listener al botón de guardar ID de Google Sheet
    const saveSheetIdBtn = document.getElementById('save-google-sheet-id-btn');
    if (saveSheetIdBtn && typeof handleSaveGoogleSheetId === 'function') {
        // Evita añadir múltiples listeners
        saveSheetIdBtn.removeEventListener('click', handleSaveGoogleSheetId);
        saveSheetIdBtn.addEventListener('click', handleSaveGoogleSheetId);
    }
    // Añade listener al formulario de simulación de mensaje de Ad
    const simulateAdForm = document.getElementById('simulate-ad-form');
    if (simulateAdForm && typeof handleSimulateAdMessage === 'function') {
         // Evita añadir múltiples listeners
        simulateAdForm.removeEventListener('submit', handleSimulateAdMessage);
        simulateAdForm.addEventListener('submit', handleSimulateAdMessage);
    }

    // Renderiza la lista de usuarios / operadores
    renderUsersSettings();
    // Si aún no se han cargado los usuarios, intentar cargarlos ahora.
    if ((!state.allUsers || state.allUsers.length === 0) && typeof fetchAllUsers === 'function') {
        fetchAllUsers();
    }

    // Restaura la pestaña de Ajustes que estaba activa (por defecto: Apariencia).
    if (typeof switchSettingsTab === 'function') switchSettingsTab(state.settingsTab || 'apariencia');

    // Nota: la sección "Reactivación de Leads" (genérica) se retiró del CRM; la
    // reemplaza "Rescate IA" (seguimiento de pedido en proceso). El backend genérico
    // queda inactivo. Funciones loadLeadReactSettings/handleSaveLeadReact siguen
    // definidas pero ya no se invocan desde la UI.
}

// --- INICIO: Sección de Usuarios / Operadores en Ajustes ---

/**
 * Dibuja la lista de usuarios del sistema dentro de la tarjeta de Ajustes.
 * Cada fila muestra avatar, nombre, correo, rango y departamentos, con un
 * botón para abrir el modal de edición.
 */
function renderUsersSettings() {
    const container = document.getElementById('users-list-container');
    if (!container) return; // No estamos en la vista de ajustes

    const users = state.allUsers || [];
    if (users.length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-sm">No se encontraron usuarios o aún se están cargando.</p>';
        return;
    }

    // Ordenar: admins primero, luego por nombre.
    const sorted = [...users].sort((a, b) => {
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        return (a.name || a.email).localeCompare(b.name || b.email);
    });

    container.innerHTML = sorted.map(user => {
        const displayName = (user.name && user.name.trim() && user.name.toLowerCase() !== 'null') ? user.name : user.email.split('@')[0];
        const initial = (displayName.trim()[0] || 'U').toUpperCase();
        const photo = user.photoURL || '';
        const avatarStyle = photo ? `background-image:url("${photo}");color:transparent;` : '';

        const roleBadge = user.role === 'admin'
            ? '<span class="user-badge user-badge-admin"><i class="fas fa-crown"></i> Administrador</span>'
            : '<span class="user-badge user-badge-agent"><i class="fas fa-headset"></i> Agente</span>';

        // Nombres de departamentos asignados (solo relevante para agentes)
        let deptBadges = '';
        if (user.role !== 'admin') {
            const deptIds = user.assignedDepartments || [];
            if (deptIds.length > 0) {
                deptBadges = deptIds.map(id => {
                    const dept = (state.departments || []).find(d => d.id === id);
                    return `<span class="user-badge user-badge-dept">${escapeHtml(dept ? dept.name : 'Departamento')}</span>`;
                }).join('');
            } else {
                deptBadges = '<span class="user-badge user-badge-dept">Sin departamentos</span>';
            }
        }

        return `
            <div class="user-row">
                <div class="user-row-avatar" style="${avatarStyle}">${photo ? '' : initial}</div>
                <div class="user-row-info">
                    <div class="user-row-name">${escapeHtml(displayName)}</div>
                    <div class="user-row-email">${escapeHtml(user.email)}</div>
                    <div class="user-row-meta">${roleBadge}${deptBadges}</div>
                </div>
                <button type="button" class="btn btn-subtle btn-sm flex-shrink-0" onclick="openUserModal('${user.email.replace(/'/g, "\\'")}')">
                    <i class="fas fa-pen mr-1"></i> Editar
                </button>
            </div>`;
    }).join('');
}

/**
 * Abre el modal para editar la información de un usuario / operador.
 * @param {string} email Identificador (email) del usuario a editar.
 */
function openUserModal(email) {
    const modal = document.getElementById('user-modal');
    if (!modal) return;

    const user = (state.allUsers || []).find(u => u.email === email);
    if (!user) {
        showError('No se encontró la información de este usuario.');
        return;
    }

    const displayName = (user.name && user.name.trim() && user.name.toLowerCase() !== 'null') ? user.name : '';

    document.getElementById('user-id').value = user.email;
    document.getElementById('user-name').value = displayName;
    document.getElementById('user-email-display').value = user.email;
    document.getElementById('user-role').value = user.role === 'admin' ? 'admin' : 'agent';
    document.getElementById('user-modal-title').textContent = `Editar: ${displayName || user.email.split('@')[0]}`;

    // Foto de perfil
    setUserModalPhoto(user.photoURL || '', displayName || user.email);

    // Departamentos: checkboxes
    const deptContainer = document.getElementById('user-departments-container');
    const departments = state.departments || [];
    if (departments.length > 0) {
        const assigned = user.assignedDepartments || [];
        deptContainer.innerHTML = departments.map(dept => `
            <div class="flex items-center">
                <input type="checkbox" id="user-dept-${dept.id}" name="user-departments" value="${dept.id}" ${assigned.includes(dept.id) ? 'checked' : ''} class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <label for="user-dept-${dept.id}" class="ml-3 block text-sm font-medium text-gray-700">${escapeHtml(dept.name)}</label>
            </div>
        `).join('');
    } else {
        deptContainer.innerHTML = '<p class="text-gray-400 text-sm">No hay departamentos creados.</p>';
    }

    // Oculta "Eliminar" cuando editas tu propia cuenta (no puedes borrarte a ti mismo).
    const deleteBtn = document.getElementById('user-delete-btn');
    if (deleteBtn) {
        const myEmail = (typeof auth !== 'undefined' && auth.currentUser) ? (auth.currentUser.email || '') : '';
        const isSelf = myEmail && myEmail.toLowerCase() === user.email.toLowerCase();
        deleteBtn.classList.toggle('hidden', !!isSelf);
    }

    modal.classList.remove('hidden');
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.classList.add('hidden');
    const fileInput = document.getElementById('user-photo-input');
    if (fileInput) fileInput.value = '';
}

/**
 * Actualiza el avatar (preview) del modal según haya foto o no.
 */
function setUserModalPhoto(photoURL, nameOrEmail) {
    const avatar = document.getElementById('user-avatar-preview');
    const initialEl = document.getElementById('user-avatar-initial');
    const hiddenInput = document.getElementById('user-photo-url');
    const removeBtn = document.getElementById('user-photo-remove-btn');
    const btnLabel = document.getElementById('user-photo-btn-label');
    if (!avatar) return;

    hiddenInput.value = photoURL || '';
    const initial = ((nameOrEmail || 'U').trim()[0] || 'U').toUpperCase();
    initialEl.textContent = initial;

    if (photoURL) {
        avatar.style.backgroundImage = `url("${photoURL}")`;
        avatar.classList.add('has-photo');
        if (removeBtn) removeBtn.classList.remove('hidden');
        if (btnLabel) btnLabel.textContent = 'Cambiar foto';
    } else {
        avatar.style.backgroundImage = '';
        avatar.classList.remove('has-photo');
        if (removeBtn) removeBtn.classList.add('hidden');
        if (btnLabel) btnLabel.textContent = 'Subir foto';
    }
}

/**
 * Sube la foto seleccionada a Firebase Storage y la refleja en el preview.
 */
async function handleUserPhotoSelect(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = ''; // Permite reseleccionar el mismo archivo
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showError('El archivo debe ser una imagen.');
        return;
    }

    const email = document.getElementById('user-id').value;
    const avatar = document.getElementById('user-avatar-preview');
    const overlay = avatar ? avatar.querySelector('.user-avatar-edit-overlay') : null;
    if (overlay) overlay.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    if (avatar) avatar.style.opacity = '0.6';

    try {
        const safeEmail = (email || 'anon').replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `user_avatars/${safeEmail}/${Date.now()}_${file.name}`;
        const fileRef = storage.ref(path);
        const uploadTask = await fileRef.put(file, { contentType: file.type });
        const url = await uploadTask.ref.getDownloadURL();

        const nameOrEmail = document.getElementById('user-name').value || email;
        setUserModalPhoto(url, nameOrEmail);
    } catch (error) {
        console.error('Error subiendo foto de usuario:', error);
        showError('No se pudo subir la foto. Intenta de nuevo.');
    } finally {
        if (overlay) overlay.innerHTML = '<i class="fas fa-camera"></i>';
        if (avatar) avatar.style.opacity = '1';
    }
}

/**
 * Quita la foto de perfil del usuario (vuelve a la inicial).
 */
function removeUserPhoto() {
    const nameOrEmail = document.getElementById('user-name').value || document.getElementById('user-id').value;
    setUserModalPhoto('', nameOrEmail);
}

window.renderUsersSettings = renderUsersSettings;
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.handleUserPhotoSelect = handleUserPhotoSelect;
window.removeUserPhoto = removeUserPhoto;
// --- FIN: Sección de Usuarios / Operadores en Ajustes ---

// --- INICIO: Renderizado de Entrenamiento de IA ---
async function renderAITrainingView() {
    if (state.activeView !== 'ia') return;

    // 1. Cargar instrucciones del bot desde Firestore
    try {
        const botDoc = await db.collection('crm_settings').doc('bot').get();
        if (botDoc.exists) {
            state.aiBotInstructions = botDoc.data().instructions || '';
            const textarea = document.getElementById('ai-bot-instructions');
            if (textarea) textarea.value = state.aiBotInstructions;
        }
    } catch (error) {
        console.error('Error al cargar instrucciones del bot:', error);
    }

    // 1b. Cargar instrucciones de post-venta (etapa 2) + estado del kill-switch
    try {
        const [postDoc, generalDoc] = await Promise.all([
            db.collection('crm_settings').doc('postventa').get(),
            db.collection('crm_settings').doc('general').get()
        ]);
        state.aiPostventaInstructions = (postDoc.exists && postDoc.data().instructions) || '';
        state.postSaleStageActive = !generalDoc.exists || generalDoc.data().postSaleStageActive !== false;
        const postTextarea = document.getElementById('ai-postventa-instructions');
        if (postTextarea) postTextarea.value = state.aiPostventaInstructions;
        const postToggle = document.getElementById('postventa-enabled-toggle');
        if (postToggle) postToggle.checked = state.postSaleStageActive;
    } catch (error) {
        console.error('Error al cargar instrucciones de post-venta:', error);
    }

    // 2. Listener de botón guardar instrucciones
    const saveBtn = document.getElementById('save-bot-instructions-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', handleSaveBotInstructions);
    }

    // 2b. Listener de botón guardar post-venta
    const savePostBtn = document.getElementById('save-postventa-instructions-btn');
    if (savePostBtn) {
        savePostBtn.addEventListener('click', handleSavePostventaInstructions);
    }

    // 3. Listener de formulario de conocimiento
    const knowledgeForm = document.getElementById('knowledge-form');
    if (knowledgeForm) {
        knowledgeForm.removeEventListener('submit', handleSaveKnowledge);
        knowledgeForm.addEventListener('submit', handleSaveKnowledge);
    }

    // 4. Cargar base de conocimiento desde Firestore
    loadKnowledgeBase();

    // 5. Cargar estadísticas de uso de tokens
    loadAIUsageStats();

    // 6. Cargar y renderizar instrucciones por departamento
    loadDepartmentPrompts();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function loadDepartmentPrompts() {
    const container = document.getElementById('department-prompts-container');
    if (!container) return;

    const departments = state.departments || [];
    if (departments.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-sm text-gray-500">
                No hay departamentos. Crea uno en <a href="#" onclick="navigateTo('departamentos'); return false;" class="text-blue-600 font-semibold hover:underline">Departamentos</a>.
            </div>`;
        return;
    }

    // Cargar prompts existentes desde Firestore en paralelo
    try {
        const results = await Promise.all(
            departments.map(d =>
                db.collection('ai_department_prompts').doc(d.id).get()
                    .then(snap => ({
                        id: d.id,
                        prompt: (snap.exists && snap.data().prompt) || '',
                        images: (snap.exists && Array.isArray(snap.data().images)) ? snap.data().images : []
                    }))
                    .catch(() => ({ id: d.id, prompt: '', images: [] }))
            )
        );
        state.aiDepartmentPrompts = {};
        results.forEach(r => { state.aiDepartmentPrompts[r.id] = { prompt: r.prompt, images: r.images }; });
    } catch (error) {
        console.error('Error cargando prompts por departamento:', error);
    }

    renderDepartmentPrompts();
}

// Departamentos cuyo acordeón de instrucciones está expandido (se conserva entre
// re-renderizados, p. ej. tras guardar o subir una imagen).
const openDeptPrompts = new Set();

function renderDepartmentPrompts() {
    const container = document.getElementById('department-prompts-container');
    if (!container) return;
    const departments = state.departments || [];

    container.innerHTML = departments.map(dept => {
        const data = state.aiDepartmentPrompts[dept.id] || { prompt: '', images: [] };
        const prompt = data.prompt || '';
        const images = Array.isArray(data.images) ? data.images : [];
        const hasPrompt = !!prompt.trim() || images.length > 0;
        const deptId = dept.id;
        const color = dept.color || '#6c757d';
        const name = escapeHtml(dept.name || 'Sin nombre');
        const isOpen = openDeptPrompts.has(deptId);

        const thumbnailsHtml = images.map((img, idx) => `
            <div class="relative group w-20 h-20 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex-shrink-0">
                <img src="${escapeHtml(img.url || '')}" alt="ref ${idx + 1}" class="w-full h-full object-cover" loading="lazy" />
                <button
                    type="button"
                    onclick="handleDeleteDepartmentPromptImage('${deptId}', ${idx})"
                    class="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    title="Eliminar"
                >
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');

        return `
            <div class="mb-4 border border-gray-200 rounded-lg overflow-hidden" data-dept-prompt-card="${deptId}">
                <div class="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200 cursor-pointer select-none hover:bg-gray-100 transition-colors" onclick="toggleDepartmentPrompt('${deptId}')">
                    <div class="flex items-center gap-3">
                        <div class="w-4 h-4 rounded" style="background-color: ${color};"></div>
                        <span class="font-semibold text-gray-800">${name}</span>
                        ${hasPrompt ? '<span class="text-[10px] font-bold uppercase tracking-wider text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Configurado</span>' : ''}
                        ${images.length > 0 ? `<span class="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">${images.length} ${images.length === 1 ? 'imagen' : 'imágenes'}</span>` : ''}
                    </div>
                    <i class="fas fa-chevron-down text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}" id="dept-prompt-chevron-${deptId}"></i>
                </div>
                <div class="p-4 ${isOpen ? '' : 'hidden'}" id="dept-prompt-body-${deptId}">
                    <textarea
                        id="dept-prompt-textarea-${deptId}"
                        rows="6"
                        class="w-full p-3 border border-gray-300 rounded-lg text-sm font-mono"
                        placeholder="Instrucciones del bot para &quot;${name}&quot;..."
                    >${escapeHtml(prompt)}</textarea>

                    <div class="mt-4">
                        <div class="flex items-center justify-between mb-2">
                            <label class="text-xs font-bold uppercase tracking-wider text-gray-500">Imágenes de referencia</label>
                            <button
                                type="button"
                                class="btn btn-secondary text-xs"
                                onclick="document.getElementById('dept-prompt-image-input-${deptId}').click()"
                            >
                                <i class="fas fa-image mr-1"></i>Subir imagen
                            </button>
                            <input
                                type="file"
                                id="dept-prompt-image-input-${deptId}"
                                accept="image/*"
                                multiple
                                class="hidden"
                                onchange="handleDepartmentPromptImageUpload('${deptId}', event)"
                            />
                        </div>
                        <p class="text-[11px] text-gray-500 mb-3">La IA podrá ver estas imágenes como referencia cada vez que responda a un contacto de este departamento.</p>
                        <div id="dept-prompt-thumbs-${deptId}" class="flex flex-wrap gap-2">
                            ${thumbnailsHtml || '<p class="text-xs text-gray-400 italic">Sin imágenes</p>'}
                        </div>
                    </div>

                    <div class="flex justify-end mt-4">
                        <button
                            id="save-dept-prompt-btn-${deptId}"
                            class="btn btn-primary"
                            onclick="handleSaveDepartmentPrompt('${deptId}')"
                        >
                            <i class="fas fa-save mr-2"></i>Guardar Instrucciones
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Expande/contrae el acordeón de instrucciones de un departamento.
function toggleDepartmentPrompt(deptId) {
    const body = document.getElementById(`dept-prompt-body-${deptId}`);
    if (!body) return;
    const willOpen = body.classList.contains('hidden');
    body.classList.toggle('hidden', !willOpen);
    const chevron = document.getElementById(`dept-prompt-chevron-${deptId}`);
    if (chevron) chevron.classList.toggle('rotate-180', willOpen);
    if (willOpen) openDeptPrompts.add(deptId);
    else openDeptPrompts.delete(deptId);
}

async function handleSaveDepartmentPrompt(deptId) {
    const textarea = document.getElementById(`dept-prompt-textarea-${deptId}`);
    const btn = document.getElementById(`save-dept-prompt-btn-${deptId}`);
    if (!textarea || !btn) return;

    const prompt = textarea.value.trim();
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Guardando...';

    try {
        await db.collection('ai_department_prompts').doc(deptId).set(
            { prompt, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        );
        if (!state.aiDepartmentPrompts[deptId]) state.aiDepartmentPrompts[deptId] = { prompt: '', images: [] };
        state.aiDepartmentPrompts[deptId].prompt = prompt;
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>¡Guardado!';
        showError('Instrucciones del departamento guardadas.', 'success');
        // Re-renderizar solo la tarjeta del departamento para actualizar el badge "Configurado"
        setTimeout(() => {
            renderDepartmentPrompts();
        }, 1500);
    } catch (error) {
        console.error('Error al guardar prompt de departamento:', error);
        showError('No se pudieron guardar las instrucciones del departamento.');
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

async function handleDepartmentPromptImageUpload(deptId, event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Reset input para que el mismo archivo pueda re-seleccionarse después
    event.target.value = '';

    const thumbsContainer = document.getElementById(`dept-prompt-thumbs-${deptId}`);
    if (thumbsContainer) {
        thumbsContainer.insertAdjacentHTML('beforeend',
            `<div id="dept-prompt-upload-progress-${deptId}" class="text-xs text-gray-500 flex items-center gap-2"><i class="fas fa-spinner fa-spin"></i> Subiendo ${files.length} ${files.length === 1 ? 'imagen' : 'imágenes'}...</div>`
        );
    }

    try {
        const uploadedImages = [];
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                console.warn(`[DEPT PROMPT] Archivo ignorado (no es imagen): ${file.name}`);
                continue;
            }
            const path = `ai_department_prompts/${deptId}/${Date.now()}_${file.name}`;
            const fileRef = storage.ref(path);
            const uploadTask = await fileRef.put(file, { contentType: file.type });
            const url = await uploadTask.ref.getDownloadURL();
            uploadedImages.push({ url, path, mimeType: file.type, name: file.name });
        }

        if (uploadedImages.length === 0) {
            showError('No se subió ninguna imagen válida.');
            renderDepartmentPrompts();
            return;
        }

        // Agregar al array existente en Firestore
        const docRef = db.collection('ai_department_prompts').doc(deptId);
        await docRef.set(
            {
                images: firebase.firestore.FieldValue.arrayUnion(...uploadedImages),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
        );

        // Actualizar estado local
        if (!state.aiDepartmentPrompts[deptId]) state.aiDepartmentPrompts[deptId] = { prompt: '', images: [] };
        state.aiDepartmentPrompts[deptId].images = [
            ...(state.aiDepartmentPrompts[deptId].images || []),
            ...uploadedImages
        ];

        showError(`${uploadedImages.length} ${uploadedImages.length === 1 ? 'imagen agregada' : 'imágenes agregadas'} al departamento.`, 'success');
        renderDepartmentPrompts();
    } catch (error) {
        console.error('Error al subir imagen de departamento:', error);
        showError('Falló la subida de imagen: ' + error.message);
        renderDepartmentPrompts();
    }
}

async function handleDeleteDepartmentPromptImage(deptId, imageIndex) {
    const data = state.aiDepartmentPrompts[deptId];
    if (!data || !Array.isArray(data.images) || !data.images[imageIndex]) return;
    if (!confirm('¿Eliminar esta imagen de referencia?')) return;

    const image = data.images[imageIndex];
    const newImages = data.images.filter((_, idx) => idx !== imageIndex);

    try {
        // Actualizar Firestore con el array filtrado
        await db.collection('ai_department_prompts').doc(deptId).set(
            { images: newImages, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        );

        // Best-effort: borrar el archivo de Storage
        if (image.path) {
            try {
                await storage.ref(image.path).delete();
            } catch (storageErr) {
                console.warn('[DEPT PROMPT] No se pudo eliminar el archivo de Storage:', storageErr.message);
            }
        }

        // Actualizar estado local y re-renderizar
        state.aiDepartmentPrompts[deptId].images = newImages;
        renderDepartmentPrompts();
        showError('Imagen eliminada.', 'success');
    } catch (error) {
        console.error('Error al eliminar imagen de departamento:', error);
        showError('No se pudo eliminar la imagen.');
    }
}

// Exponer en window para los onclick inline
window.handleSaveDepartmentPrompt = handleSaveDepartmentPrompt;
window.handleDepartmentPromptImageUpload = handleDepartmentPromptImageUpload;
window.handleDeleteDepartmentPromptImage = handleDeleteDepartmentPromptImage;

async function handleSaveBotInstructions() {
    const textarea = document.getElementById('ai-bot-instructions');
    const btn = document.getElementById('save-bot-instructions-btn');
    if (!textarea || !btn) return;

    const instructions = textarea.value.trim();
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Guardando...';

    try {
        await db.collection('crm_settings').doc('bot').set({ instructions }, { merge: true });
        state.aiBotInstructions = instructions;
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>¡Guardado!';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-save mr-2"></i>Guardar Instrucciones';
            btn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('Error al guardar instrucciones:', error);
        showError('No se pudieron guardar las instrucciones.');
        btn.innerHTML = '<i class="fas fa-save mr-2"></i>Guardar Instrucciones';
        btn.disabled = false;
    }
}

async function handleSavePostventaInstructions() {
    const textarea = document.getElementById('ai-postventa-instructions');
    const toggle = document.getElementById('postventa-enabled-toggle');
    const btn = document.getElementById('save-postventa-instructions-btn');
    if (!textarea || !btn) return;

    const instructions = textarea.value.trim();
    const enabled = toggle ? toggle.checked : true;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Guardando...';

    try {
        // El prompt vive en crm_settings/postventa; el kill-switch en crm_settings/general
        // (mismo doc que lee el backend junto a globalBotActive, sin lectura extra por turno).
        await Promise.all([
            db.collection('crm_settings').doc('postventa').set({ instructions }, { merge: true }),
            db.collection('crm_settings').doc('general').set({ postSaleStageActive: enabled }, { merge: true })
        ]);
        state.aiPostventaInstructions = instructions;
        state.postSaleStageActive = enabled;
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>¡Guardado!';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-save mr-2"></i>Guardar Post-Venta';
            btn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('Error al guardar post-venta:', error);
        showError('No se pudieron guardar las instrucciones de post-venta.');
        btn.innerHTML = '<i class="fas fa-save mr-2"></i>Guardar Post-Venta';
        btn.disabled = false;
    }
}

// --- Toggle: cuándo se envía el evento Purchase a Meta (registro vs Fabricar) ---
function updatePurchaseTriggerLabel(trigger) {
    const label = document.getElementById('purchase-trigger-label');
    if (label) label.textContent = (trigger === 'registration') ? 'Al registrar el pedido' : 'Al cambiar a "Fabricar"';
}

async function handlePurchaseTriggerToggle(checked) {
    const trigger = checked ? 'fabricar' : 'registration';
    try {
        await db.collection('crm_settings').doc('general').set({ purchaseEventTrigger: trigger }, { merge: true });
        updatePurchaseTriggerLabel(trigger);
        showError(trigger === 'fabricar'
            ? 'Listo: el evento de compra se enviará al pasar a "Fabricar".'
            : 'Listo: el evento de compra se enviará al registrar el pedido.', 'success');
    } catch (error) {
        console.error('Error al guardar el disparador del evento de compra:', error);
        showError('No se pudo guardar la configuración del evento de compra.');
        const t = document.getElementById('purchase-trigger-toggle');
        if (t) t.checked = !checked; // revertir visualmente
    }
}
window.handlePurchaseTriggerToggle = handlePurchaseTriggerToggle;

async function loadKnowledgeBase() {
    try {
        const snapshot = await db.collection('ai_knowledge_base').get();
        state.aiKnowledgeBase = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderKnowledgeBaseTable();
    } catch (error) {
        console.error('Error al cargar base de conocimiento:', error);
    }
}

function renderKnowledgeBaseTable() {
    const tableBody = document.getElementById('knowledge-base-table-body');
    if (!tableBody) return;

    if (state.aiKnowledgeBase.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-gray-500 py-4">No hay conocimiento agregado aún. ¡Agrega el primero!</td></tr>`;
        return;
    }

    tableBody.innerHTML = state.aiKnowledgeBase.map(item => `
        <tr>
            <td class="font-semibold">${item.topic || ''}</td>
            <td class="text-gray-600 max-w-sm truncate" title="${(item.answer || '').replace(/"/g, '&quot;')}">${item.answer || ''}</td>
            <td class="actions-cell">
                <button onclick="openKnowledgeModal('${item.id}')" class="p-2"><i class="fas fa-pencil-alt"></i></button>
                <button onclick="handleDeleteKnowledge('${item.id}')" class="p-2"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

function openKnowledgeModal(docId) {
    const modal = document.getElementById('knowledge-modal');
    const title = document.getElementById('knowledge-modal-title');
    const idInput = document.getElementById('kb-doc-id');
    const topicInput = document.getElementById('kb-topic');
    const answerInput = document.getElementById('kb-answer');

    if (!modal) return;

    if (docId) {
        // Editar
        const item = state.aiKnowledgeBase.find(k => k.id === docId);
        if (!item) return;
        title.textContent = 'Editar Conocimiento';
        idInput.value = docId;
        topicInput.value = item.topic || '';
        answerInput.value = item.answer || '';
    } else {
        // Nuevo
        title.textContent = 'Agregar Conocimiento';
        idInput.value = '';
        topicInput.value = '';
        answerInput.value = '';
    }

    modal.classList.remove('hidden');
}

function closeKnowledgeModal() {
    const modal = document.getElementById('knowledge-modal');
    if (modal) modal.classList.add('hidden');
}

async function handleSaveKnowledge(event) {
    event.preventDefault();
    const docId = document.getElementById('kb-doc-id').value;
    const topic = document.getElementById('kb-topic').value.trim();
    const answer = document.getElementById('kb-answer').value.trim();

    if (!topic || !answer) return;

    try {
        if (docId) {
            await db.collection('ai_knowledge_base').doc(docId).update({ topic, answer });
        } else {
            await db.collection('ai_knowledge_base').add({ topic, answer });
        }
        closeKnowledgeModal();
        loadKnowledgeBase(); // Recargar tabla
    } catch (error) {
        console.error('Error al guardar conocimiento:', error);
        showError('No se pudo guardar el conocimiento.');
    }
}

async function handleDeleteKnowledge(docId) {
    if (!confirm('¿Estás seguro de que quieres eliminar este conocimiento?')) return;
    try {
        await db.collection('ai_knowledge_base').doc(docId).delete();
        loadKnowledgeBase(); // Recargar tabla
    } catch (error) {
        console.error('Error al eliminar conocimiento:', error);
        showError('No se pudo eliminar el conocimiento.');
    }
}

async function loadAIUsageStats() {
    // Precios por millón de tokens (USD)
    const INPUT_PRICE_PER_M = 0.10;
    const OUTPUT_PRICE_PER_M = 0.40;

    function calculateCost(inputTokens, outputTokens) {
        return ((inputTokens / 1_000_000) * INPUT_PRICE_PER_M) + ((outputTokens / 1_000_000) * OUTPUT_PRICE_PER_M);
    }

    function formatNumber(num) {
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
        return num.toString();
    }

    try {
        // --- Datos de HOY ---
        const today = new Date().toISOString().split('T')[0];
        const todayDoc = await db.collection('ai_usage_logs').doc(today).get();
        const todayData = todayDoc.exists ? todayDoc.data() : { inputTokens: 0, outputTokens: 0, requestCount: 0 };

        const todayCost = calculateCost(todayData.inputTokens || 0, todayData.outputTokens || 0);

        const todayReqEl = document.getElementById('usage-today-requests');
        const todayInEl = document.getElementById('usage-today-input');
        const todayOutEl = document.getElementById('usage-today-output');
        const todayCostEl = document.getElementById('usage-today-cost');

        if (todayReqEl) todayReqEl.textContent = todayData.requestCount || 0;
        if (todayInEl) todayInEl.textContent = formatNumber(todayData.inputTokens || 0);
        if (todayOutEl) todayOutEl.textContent = formatNumber(todayData.outputTokens || 0);
        if (todayCostEl) todayCostEl.textContent = '$' + todayCost.toFixed(4);

        // --- Datos del MES ---
        const yearMonth = today.substring(0, 7); // YYYY-MM
        const monthStart = yearMonth + '-01';
        const monthEnd = yearMonth + '-31';

        const monthSnapshot = await db.collection('ai_usage_logs')
            .where('date', '>=', monthStart)
            .where('date', '<=', monthEnd)
            .get();

        let monthInput = 0, monthOutput = 0, monthRequests = 0;
        monthSnapshot.docs.forEach(doc => {
            const data = doc.data();
            monthInput += data.inputTokens || 0;
            monthOutput += data.outputTokens || 0;
            monthRequests += data.requestCount || 0;
        });

        const monthCost = calculateCost(monthInput, monthOutput);

        const monthReqEl = document.getElementById('usage-month-requests');
        const monthInEl = document.getElementById('usage-month-input');
        const monthOutEl = document.getElementById('usage-month-output');
        const monthCostEl = document.getElementById('usage-month-cost');

        if (monthReqEl) monthReqEl.textContent = monthRequests;
        if (monthInEl) monthInEl.textContent = formatNumber(monthInput);
        if (monthOutEl) monthOutEl.textContent = formatNumber(monthOutput);
        if (monthCostEl) monthCostEl.textContent = '$' + monthCost.toFixed(4);

    } catch (error) {
        console.error('Error al cargar estadísticas de uso de IA:', error);
    }
}

// Exportar funciones globalmente
window.openKnowledgeModal = openKnowledgeModal;
window.closeKnowledgeModal = closeKnowledgeModal;
window.handleDeleteKnowledge = handleDeleteKnowledge;
// --- FIN: Renderizado de Entrenamiento de IA ---

// --- INICIO DE MODIFICACIÓN: Renderizado de Métricas ---
// Renderiza la vista de métricas, incluyendo gráficas y la nueva sección de Ad IDs
async function renderMetricsView() {
    if (state.activeView !== 'metricas') return;

    const loadingEl = document.getElementById('metrics-loading');
    const contentEl = document.getElementById('metrics-content');
    const adMetricsLoadingEl = document.getElementById('ad-metrics-loading');
    const adMetricsNoDataEl = document.getElementById('ad-metrics-no-data');
    const adMetricsTableContainer = document.getElementById('ad-metrics-table-container');

    // Inicializar Litepicker para el rango de fechas de Ad Metrics
    const dateRangeInput = document.getElementById('ad-metrics-date-range');
    if (dateRangeInput && !adMetricsPicker) { // Inicializar solo una vez
        adMetricsPicker = new Litepicker({
            element: dateRangeInput,
            singleMode: false,
            format: 'YYYY-MM-DD', // Formato requerido por la API
            plugins: ['ranges'],
            setup: (picker) => {
                // No hacer nada al seleccionar, esperar al botón "Cargar Datos"
            }
        });
    }

    // Añadir listeners a los botones de la sección Ad Metrics
    const loadBtn = document.getElementById('load-ad-metrics-btn');
    const clearBtn = document.getElementById('clear-ad-metrics-filter-btn');

    if (loadBtn) {
        loadBtn.removeEventListener('click', loadAdIdMetrics); // Evitar duplicados
        loadBtn.addEventListener('click', loadAdIdMetrics);
    }
    if (clearBtn) {
        clearBtn.removeEventListener('click', clearAdIdMetricsFilter); // Evitar duplicados
        clearBtn.addEventListener('click', clearAdIdMetricsFilter);
    }

    // Cargar las métricas generales (gráficas)
    try {
        const response = await fetch(`${API_BASE_URL}/api/metrics`);
        if (!response.ok) {
            throw new Error('No se pudieron cargar los datos de métricas generales.');
        }
        const result = await response.json();
        const metricsData = result.data;

        loadingEl.classList.add('hidden'); // Ocultar carga general
        contentEl.classList.remove('hidden'); // Mostrar contenido

        renderDailyMessagesChart(metricsData); // Renderizar gráfica diaria
        renderTagsDistributionChart(metricsData); // Renderizar gráfica de etiquetas

    } catch (error) {
        console.error("Error fetching general metrics:", error);
        showError(error.message);
        loadingEl.innerHTML = `<p class="text-red-500">${error.message}</p>`; // Mostrar error en carga general
    }
}

// Función para cargar y renderizar los datos de mensajes por Ad ID
async function loadAdIdMetrics() {
    const loadingEl = document.getElementById('ad-metrics-loading');
    const noDataEl = document.getElementById('ad-metrics-no-data');
    const tableContainer = document.getElementById('ad-metrics-table-container');
    const tableBody = document.getElementById('ad-metrics-table-body');

    if (!adMetricsPicker || !loadingEl || !noDataEl || !tableContainer || !tableBody) return;

    const startDate = adMetricsPicker.getStartDate() ? adMetricsPicker.getStartDate().format('YYYY-MM-DD') : null;
    const endDate = adMetricsPicker.getEndDate() ? adMetricsPicker.getEndDate().format('YYYY-MM-DD') : null;

    if (!startDate || !endDate) {
        showError("Por favor, selecciona un rango de fechas.");
        return;
    }

    // Mostrar estado de carga y ocultar resultados anteriores
    loadingEl.classList.remove('hidden');
    noDataEl.classList.add('hidden');
    tableContainer.classList.add('hidden');
    tableBody.innerHTML = '';

    try {
        // Llamar a la función del api-service (DEBES CREARLA)
        const counts = await fetchMessagesByAdIdMetrics(startDate, endDate); // Asume que esta función existe en api-service.js

        if (Object.keys(counts).length === 0) {
            noDataEl.classList.remove('hidden'); // Mostrar mensaje de "sin datos"
        } else {
            renderAdIdMetricsTable(counts); // Renderizar la tabla con los datos
            tableContainer.classList.remove('hidden'); // Mostrar la tabla
        }
    } catch (error) {
        console.error("Error loading Ad ID metrics:", error);
        showError(error.message);
        noDataEl.textContent = `Error al cargar: ${error.message}`;
        noDataEl.classList.remove('hidden');
    } finally {
        loadingEl.classList.add('hidden'); // Ocultar spinner de carga
    }
}

// Función para limpiar el filtro de fechas de Ad Metrics
function clearAdIdMetricsFilter() {
    if (adMetricsPicker) {
        adMetricsPicker.clearSelection();
    }
    document.getElementById('ad-metrics-no-data')?.classList.add('hidden');
    document.getElementById('ad-metrics-table-container')?.classList.add('hidden');
    document.getElementById('ad-metrics-table-body').innerHTML = '';
}

// Función para renderizar la tabla de resultados de Ad ID Metrics
function renderAdIdMetricsTable(counts) {
    const tableBody = document.getElementById('ad-metrics-table-body');
    if (!tableBody) return;

    // Convertir el objeto a un array y ordenar por conteo descendente
    const sortedCounts = Object.entries(counts).sort(([, countA], [, countB]) => countB - countA);

    // Generar filas de la tabla
    tableBody.innerHTML = sortedCounts.map(([adId, count]) => `
        <tr>
            <td class="font-mono text-sm">${adId}</td>
            <td class="font-semibold text-center">${count}</td>
        </tr>
    `).join('');
}
// --- FIN DE MODIFICACIÓN ---

// Renderiza la gráfica de mensajes diarios
function renderDailyMessagesChart(data) {
    const ctx = document.getElementById('daily-messages-chart')?.getContext('2d');
    if (!ctx) return;

    // Destruir gráfica anterior si existe
    if (dailyMessagesChart) {
        dailyMessagesChart.destroy();
    }

    // Preparar datos para Chart.js
    const labels = data.map(d => new Date(d.date + 'T00:00:00Z').toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })); // Ajuste para UTC
    const totalMessages = data.map(d => d.totalMessages);

    // Crear nueva gráfica
    dailyMessagesChart = new Chart(ctx, {
        type: 'bar', // Tipo barra
        data: {
            labels: labels,
            datasets: [{
                label: 'Mensajes Recibidos',
                data: totalMessages,
                backgroundColor: 'rgba(129, 178, 154, 0.6)', // Color principal suave
                borderColor: 'rgba(129, 178, 154, 1)',
                borderWidth: 1,
                borderRadius: 5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true, // Empezar eje Y en 0
                    ticks: {
                        // stepSize: 1 // REMOVED: Let Chart.js calculate automatically
                    }
                }
            },
            plugins: {
                legend: {
                    display: false // Ocultar leyenda
                }
            }
        }
    });
}


// Renderiza la gráfica de distribución por etiquetas
function renderTagsDistributionChart(data) {
    const ctx = document.getElementById('tags-distribution-chart')?.getContext('2d');
    if (!ctx) return;

    // Destruir gráfica anterior si existe
    if (tagsDistributionChart) {
        tagsDistributionChart.destroy();
    }

    // Contar mensajes por etiqueta en todo el período
    const tagCounts = {};
    data.forEach(dailyData => {
        for (const tagKey in dailyData.tags) {
            if (!tagCounts[tagKey]) {
                tagCounts[tagKey] = 0;
            }
            tagCounts[tagKey] += dailyData.tags[tagKey];
        }
    });

    // Mapear keys de etiquetas a labels y colores
    const tagInfoMap = state.tags.reduce((acc, tag) => {
        acc[tag.key] = { label: tag.label, color: tag.color };
        return acc;
    }, {});
    tagInfoMap['sin_etiqueta'] = { label: 'Sin Etiqueta', color: '#a0aec0' }; // Añadir default

    // Preparar datos para Chart.js
    const labels = Object.keys(tagCounts).map(key => tagInfoMap[key]?.label || key);
    const counts = Object.values(tagCounts);
    const backgroundColors = Object.keys(tagCounts).map(key => tagInfoMap[key]?.color || '#a0aec0');

    // Crear nueva gráfica de dona
    tagsDistributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'Distribución por Etiqueta',
                data: counts,
                backgroundColor: backgroundColors,
                hoverOffset: 4 // Efecto al pasar el mouse
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top', // Posición de la leyenda
                },
                tooltip: { // Configuración de tooltips
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += context.parsed; // Muestra el valor numérico
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}


// Renderiza la lista de mensajes en el chat activo
function renderMessages(options = {}) {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    let lastMessageDate = null; 
    let messagesHtml = '';

    // Genera HTML para cada mensaje, añadiendo separadores de fecha
    state.messages.forEach(message => {
        if (message.timestamp && typeof message.timestamp.seconds === 'number') {
            const currentMessageDate = new Date(message.timestamp.seconds * 1000);
            if (!isSameDay(currentMessageDate, lastMessageDate)) { // Si es un día diferente al anterior
                messagesHtml += DateSeparatorTemplate(formatDateSeparator(currentMessageDate)); // Añade separador
                lastMessageDate = currentMessageDate;
            }
        }
        messagesHtml += MessageBubbleTemplate(message); // Añade burbuja de mensaje
    });

    // --- INICIO MODIFICACIÓN: Lógica de scroll condicional y paginación ---
    const messagesContainer = document.getElementById('messages-container');
    
    // Calculamos si el usuario está en el fondo ANTES de actualizar el contenido
    const isAtBottom = messagesContainer ? (messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 150) : true;
    const isInitialLoad = messagesContainer && messagesContainer.scrollHeight === 0;

    // Guardamos la altura del scroll ANTES de insertar los mensajes viejos
    const previousScrollHeight = messagesContainer ? messagesContainer.scrollHeight : 0;
    const previousScrollTop = messagesContainer ? messagesContainer.scrollTop : 0;

    contentContainer.innerHTML = messagesHtml; // Actualiza el DOM
    
    if (messagesContainer) {
        if (options.preserveScrollHeight) {
            // Calculamos cuánto creció el contenedor hacia arriba 
            const heightDifference = messagesContainer.scrollHeight - previousScrollHeight;
            // Ajustamos el scroll por esa diferencia para que el usuario se quede "donde estaba" visualmente
            messagesContainer.scrollTop = previousScrollTop + heightDifference;
        } else if (options.scrollTop !== undefined) {
            // Restaurar posición específica si se proporciona
            messagesContainer.scrollTop = options.scrollTop;
        } else if (options.scrollToBottom !== false) {
            // Comportamiento de scroll condicional:
            // Scroll al final solo si ya estaba en el fondo o si es la carga inicial
            if (isAtBottom || isInitialLoad) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }
    }
    // --- FIN MODIFICACIÓN ---

    handleScroll(); // Actualiza la cabecera de fecha flotante
}

// Añade un nuevo mensaje al final de la lista (para UI optimista)
function appendMessage(message) {
    const contentContainer = document.getElementById('messages-content');
    if (!contentContainer) return;

    // Verifica si se necesita un separador de fecha comparando con el penúltimo mensaje
    const lastMessage = state.messages.length > 1 ? state.messages[state.messages.length - 2] : null;
    const lastMessageDate = lastMessage?.timestamp ? new Date(lastMessage.timestamp.seconds * 1000) : null;
    const currentMessageDate = message.timestamp ? new Date(message.timestamp.seconds * 1000) : null;

    if (currentMessageDate && !isSameDay(currentMessageDate, lastMessageDate)) {
        const separatorHtml = DateSeparatorTemplate(formatDateSeparator(currentMessageDate));
        contentContainer.insertAdjacentHTML('beforeend', separatorHtml); // Añade separador
    }

    // Añade la nueva burbuja de mensaje
    const messageHtml = MessageBubbleTemplate(message);
    contentContainer.insertAdjacentHTML('beforeend', messageHtml);

    // Scroll condicional hasta el final
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) {
        const isAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 150;
        if (isAtBottom) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
}



/**
 * Renderiza las notas en la barra lateral de detalles del contacto
 * y aplica la animación de glow si hay notas.
 */
function renderSidebarNotes() {
    const sidebarNotesList = document.getElementById('sidebar-notes-list');
    const mainContainer = document.getElementById('sidebar-notes-container');

    // Actualizar el badge de conteo en la pestaña "Notas"
    const notesTabBadge = document.getElementById('notes-tab-badge');
    if (notesTabBadge) {
        const count = (state.notes && state.notes.length) ? state.notes.length : 0;
        notesTabBadge.textContent = count > 0 ? count : '';
        notesTabBadge.classList.toggle('hidden', count === 0);
    }

    if (!sidebarNotesList || !mainContainer) return;

    if (state.notes && state.notes.length > 0) {
        sidebarNotesList.innerHTML = state.notes.map(note => {
            const isEditing = state.isEditingNote === note.id;
            const time = note.timestamp 
                ? new Date(note.timestamp.seconds * 1000).toLocaleDateString('es-ES', {day:'2-digit', month:'short'}) 
                : 'Reciente';

            if (isEditing) {
                return `
                    <div class="note-item editing !p-2 !mb-2 !text-xs bg-gray-50 rounded border-l-2 border-primary">
                        <textarea id="edit-note-input-${note.id}" class="w-full p-2 text-xs border rounded mb-2 focus:ring-1 focus:ring-blue-400 outline-none" rows="3">${note.text}</textarea>
                        <div class="flex justify-end gap-2">
                             <button onclick="toggleEditNote(null)" class="text-[10px] text-gray-400 hover:text-gray-600">Cancelar</button>
                             <button onclick="handleUpdateNote('${note.id}')" class="btn btn-primary !py-1 !px-2 !text-[10px] rounded">Guardar</button>
                        </div>
                    </div>`;
            }

            return `
                <div class="note-item sidebar-note group relative !p-2 !mb-2 !text-xs !bg-transparent border-l-2 border-accent !shadow-none hover:bg-gray-50 rounded transition-colors" data-id="${note.id}">
                    <div class="flex justify-between items-start">
                        <p class="flex-grow pr-4">${note.text}</p>
                        <div class="note-actions-visible items-center gap-1 flex-shrink-0">
                            <button onclick="toggleEditNote('${note.id}')" class="text-gray-400 hover:text-blue-500 p-0.5" title="Editar"><i class="fas fa-pencil-alt text-[10px]"></i></button>
                            <button onclick="handleDeleteNote('${note.id}')" class="text-gray-400 hover:text-red-500 p-0.5" title="Eliminar"><i class="fas fa-trash-alt text-[10px]"></i></button>
                        </div>
                    </div>
                    <div class="text-[10px] text-gray-400 mt-1">
                        ${time}
                    </div>
                </div>
            `;
        }).join('');
        
        // Aplicar animación de glow
        mainContainer.classList.add('notes-glow');
    } else {
        sidebarNotesList.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-2">Sin notas internas.</p>`;
        mainContainer.classList.remove('notes-glow');
    }
}

/**
 * Muestra una cabecera de fecha flotante mientras el usuario se desplaza
 * por la lista de mensajes.
 */
function handleScroll() {
    const messagesContainer = document.getElementById('messages-container');
    const stickyHeader = document.getElementById('sticky-date-header');
    if (!messagesContainer || !stickyHeader) return;

    // Encuentra todos los separadores de fecha visibles
    const dateSeparators = messagesContainer.querySelectorAll('.date-separator-anchor');
    if (dateSeparators.length === 0) {
        stickyHeader.classList.remove('visible'); // Oculta si no hay separadores
        return;
    }

    let topVisibleSeparator = null;
    // Itera desde el último separador hacia arriba
    for (let i = dateSeparators.length - 1; i >= 0; i--) {
        const separator = dateSeparators[i];
        const rect = separator.getBoundingClientRect(); // Posición del separador
        const containerRect = messagesContainer.getBoundingClientRect(); // Posición del contenedor

        // Si el separador está por encima del borde superior visible del contenedor
        if (rect.top < containerRect.top) {
            topVisibleSeparator = separator; // Este es el que debe mostrarse en la cabecera
            break;
        }
    }

    // Actualiza o oculta la cabecera flotante
    if (topVisibleSeparator) {
        stickyHeader.textContent = topVisibleSeparator.textContent;
        stickyHeader.classList.add('visible');
    } else {
        stickyHeader.classList.remove('visible');
    }
}


// --- UI Helpers & Modals ---

// Muestra un mensaje de error/éxito temporal en la parte superior
function showError(message, type = 'error') {
    const container = document.getElementById('error-container');
    const messageEl = document.getElementById('error-message');
    if (!container || !messageEl) return;

    // Cambia el color de fondo y texto según el tipo
    container.classList.remove('bg-yellow-200', 'text-yellow-800', 'bg-green-200', 'text-green-800');
    if (type === 'success') {
        container.classList.add('bg-green-200', 'text-green-800');
        messageEl.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    } else { // 'error' o cualquier otro tipo
        container.classList.add('bg-yellow-200', 'text-yellow-800');
        messageEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${message}`;
    }

    container.classList.remove('hidden'); // Muestra el contenedor
    setTimeout(() => hideError(), 5000); // Oculta después de 5 segundos
}

// Oculta el mensaje de error/éxito
function hideError() {
    const errorContainerEl = document.getElementById('error-container');
    if(errorContainerEl) {
        errorContainerEl.classList.add('hidden');
    }
}

// Abre el modal para ver una imagen ampliada
function openImageModal(imageUrl) {
    const modal = document.getElementById('image-modal');
    const modalImage = document.getElementById('modal-image-content');
    modalImage.src = imageUrl; // Establece la imagen
    modal.classList.add('visible'); // Muestra el modal
}

// Cierra el modal de imagen ampliada
function closeImageModal() {
    const modal = document.getElementById('image-modal');
    modal.classList.remove('visible'); // Oculta el modal
    const modalImage = document.getElementById('modal-image-content');
    // Limpia la imagen después de la animación para evitar saltos visuales
    setTimeout(() => { modalImage.src = ''; }, 300);
}

// Abre la barra lateral de detalles del contacto
async function openContactDetails() {
    const contactDetailsPanelEl = document.getElementById('contact-details-panel');
    // Validaciones
    if (!state.selectedContactId || !contactDetailsPanelEl) return;
    const contact = state.contacts.find(c => c.id === state.selectedContactId);
    if (!contact) return;

    // Renderiza la plantilla de la barra lateral
    contactDetailsPanelEl.innerHTML = ContactDetailsSidebarTemplate(contact);
    contactDetailsPanelEl.classList.add('open'); // Muestra la barra lateral
    state.contactDetailsOpen = true;

    // Renderizar notas iniciales si existen
    renderSidebarNotes();

    // Carga y muestra el historial de pedidos
    const ordersListEl = document.getElementById('contact-orders-list');
    if (ordersListEl) {
        ordersListEl.innerHTML = `<div class="order-history-item loading"><i class="fas fa-spinner fa-spin"></i> Cargando historial...</div>`;

        // Inicia el listener en tiempo real para los pedidos de este contacto
        listenForContactOrders(contact.id, (orders) => {
            state.selectedContactOrders = orders; // Guarda los pedidos en el estado
            // Asegura que la barra lateral siga abierta antes de actualizar
            if (ordersListEl.closest('.open')) {
                if (orders && orders.length > 0) {
                    // Renderiza la lista de pedidos
                    ordersListEl.innerHTML = orders.map(OrderHistoryItemTemplate).join('');
                } else {
                    ordersListEl.innerHTML = `<div class="order-history-item empty">No hay pedidos anteriores.</div>`;
                }
            }
        });

        // --- Listener para cambios en los <select> de estatus (delegación de eventos) ---
        // Se mueve aquí para asegurar que exista `ordersListEl`
        ordersListEl.addEventListener('change', (event) => {
            if (event.target.classList.contains('order-history-status-select')) {
                const orderId = event.target.dataset.orderId;
                const newStatus = event.target.value;
                handleOrderStatusChange(orderId, newStatus, event.target);
            }
        });
        // --- Fin Listener ---
    }
}


// Cierra la barra lateral de detalles del contacto
function closeContactDetails() {
    const contactDetailsPanelEl = document.getElementById('contact-details-panel');
    if(contactDetailsPanelEl) {
        contactDetailsPanelEl.classList.remove('open'); // Oculta la barra
        contactDetailsPanelEl.innerHTML = ''; // Limpia el contenido
    }
    state.contactDetailsOpen = false;
    // Detiene el listener de pedidos cuando se cierra
    if (unsubscribeOrdersListener) {
        unsubscribeOrdersListener();
        unsubscribeOrdersListener = null;
    }
}

/**
 * Renderiza la vista previa de un archivo adjunto (local o remoto).
 */
function renderFilePreview() {
    const container = document.getElementById('file-preview-container');
    if (!container) return;

    if (state.stagedFiles.length > 0) { // Si hay archivos locales seleccionados
        container.innerHTML = LocalFilePreviewTemplate(state.stagedFiles);
        container.classList.remove('hidden');
    } else if (state.stagedRemoteFile) { // Si hay un archivo remoto (de respuesta rápida)
        container.innerHTML = RemoteFilePreviewTemplate(state.stagedRemoteFile);
        container.classList.remove('hidden');
    } else { // Si no hay archivo adjunto
        container.innerHTML = '';
        container.classList.add('hidden');
    }
}

// --- START: New Order Modal ---
// Functions to manage the new order modal, including photo previews and drag & drop.
let orderPhotosManager = []; // Array para fotos del pedido
let promoPhotosManager = []; // Array para fotos de la promoción
let editOrderPhotosManager = []; // Array para fotos del pedido en edición
let editPromoPhotosManager = []; // Array para fotos de la promoción en edición
let orderItemsNextIndex = 1; // Contador global para generar índices únicos al agregar productos

// --- Multi-producto: agregar/quitar filas de producto en el modal de nuevo pedido ---
window.addOrderItem = function() {
    const container = document.getElementById('order-items-container');
    if (!container) return;
    const index = orderItemsNextIndex++;
    container.insertAdjacentHTML('beforeend', NewOrderItemRowTemplate(index, false));
    updateOrderItemNumbering();
};

window.removeOrderItem = function(index) {
    const row = document.querySelector(`.order-item-row[data-item-index="${index}"]`);
    if (row) row.remove();
    updateOrderItemNumbering();
};

function updateOrderItemNumbering() {
    const rows = document.querySelectorAll('#order-items-container .order-item-row');
    rows.forEach((row, i) => {
        const numberEl = row.querySelector('.order-item-number');
        if (numberEl) numberEl.textContent = `Producto ${i + 1}`;
        const removeBtn = row.querySelector('.order-item-remove-btn');
        if (removeBtn) removeBtn.style.display = rows.length > 1 ? '' : 'none';
    });
}

// --- Gestor de productos configurables ---------------------------------------
// Reconstruye los <option> de todos los selects de producto abiertos (modales de
// nuevo/editar pedido) preservando el valor que el usuario ya tenía seleccionado.
function refreshOpenProductSelects() {
    // Re-renderiza la lista de cualquier picker de producto cuyo panel esté abierto
    // (los demás conservan su valor; la lista se reconstruye al abrirse).
    document.querySelectorAll('.product-picker').forEach(picker => {
        const panel = picker.querySelector('.product-picker-panel');
        if (panel && !panel.hidden) renderProductPickerList(picker);
    });
}

// --- Combobox de producto (buscador + "ver más") -----------------------------
// Reemplaza al <select> nativo para poder ordenar por recientes, mostrar solo los
// primeros 5 y filtrar con un buscador. El valor seleccionado vive en un
// <input type="hidden"> con la clase legacy, así que el guardado no cambia.
const PRODUCT_PICKER_LIMIT = 5;

// Normaliza para buscar sin distinguir acentos/mayúsculas (p. ej. "papa" → "Papá").
function normalizeForSearch(s) {
    // NFD separa los acentos en marcas combinantes (U+0300-U+036F) que removemos.
    return String(s == null ? "" : s).normalize("NFD")
        .split("").filter(c => { const code = c.charCodeAt(0); return code < 0x300 || code > 0x36f; })
        .join("").toLowerCase();
}

// Renderiza los <li> visibles de un picker según la búsqueda y el estado expandido.
function renderProductPickerList(picker) {
    const listEl = picker.querySelector('.product-picker-list');
    const moreBtn = picker.querySelector('.product-picker-more');
    const searchEl = picker.querySelector('.product-picker-search-input');
    const hidden = picker.querySelector('.product-picker-input');
    if (!listEl || !hidden) return;

    const term = normalizeForSearch(searchEl ? searchEl.value : '').trim();
    const selected = hidden.value;

    let names = getProductNamesRecent();
    // Conserva un valor antiguo que ya no exista en la lista (pedidos viejos).
    if (selected && !names.includes(selected)) names.unshift(selected);
    const filtered = term ? names.filter(n => normalizeForSearch(n).includes(term)) : names;

    // Al buscar mostramos todas las coincidencias; si no, respetamos "ver más".
    const expanded = picker.dataset.expanded === '1' || !!term;
    const visible = expanded ? filtered : filtered.slice(0, PRODUCT_PICKER_LIMIT);

    listEl.innerHTML = visible.length
        ? visible.map(n => `<li class="product-picker-item${n === selected ? ' is-selected' : ''}" data-value="${escapeHtml(n)}" role="option"><span>${escapeHtml(n)}</span>${n === selected ? '<i class="fas fa-check"></i>' : ''}</li>`).join('')
        : '<li class="product-picker-empty">Sin resultados</li>';

    const hidden_more = filtered.length - PRODUCT_PICKER_LIMIT;
    if (term || hidden_more <= 0) {
        moreBtn.hidden = true;
    } else if (!expanded) {
        moreBtn.hidden = false;
        moreBtn.innerHTML = `<i class="fas fa-chevron-down"></i> Ver ${hidden_more} más`;
    } else {
        moreBtn.hidden = false;
        moreBtn.innerHTML = `<i class="fas fa-chevron-up"></i> Ver menos`;
    }
}

// Cierra todos los pickers abiertos (opcionalmente excepto uno).
function closeAllProductPickers(except) {
    document.querySelectorAll('.product-picker').forEach(picker => {
        if (picker === except) return;
        const panel = picker.querySelector('.product-picker-panel');
        if (panel && !panel.hidden) {
            panel.hidden = true;
            picker.classList.remove('is-open');
            picker.dataset.expanded = '0';
        }
    });
}

// Abre el panel de un picker, limpia el buscador y enfoca.
function openProductPicker(picker) {
    closeAllProductPickers(picker);
    const panel = picker.querySelector('.product-picker-panel');
    const searchEl = picker.querySelector('.product-picker-search-input');
    if (!panel) return;
    picker.dataset.expanded = '0';
    if (searchEl) searchEl.value = '';
    panel.hidden = false;
    picker.classList.add('is-open');
    renderProductPickerList(picker);
    if (searchEl) searchEl.focus();
}

// Aplica un valor seleccionado: actualiza el input oculto, la etiqueta y cierra.
function selectProductPickerValue(picker, value) {
    const hidden = picker.querySelector('.product-picker-input');
    const label = picker.querySelector('.product-picker-value');
    const trigger = picker.querySelector('.product-picker-trigger');
    if (hidden) hidden.value = value;
    if (label) label.textContent = value || 'Selecciona un producto';
    if (trigger) trigger.classList.toggle('is-placeholder', !value);
    // Autollena el precio unitario con el precio configurado del producto (si tiene).
    const row = picker.closest('.order-item-row');
    if (row && value) {
        const priceInput = row.querySelector('.order-item-price, .edit-order-item-price');
        const price = (typeof getProductPrice === 'function') ? getProductPrice(value) : null;
        if (priceInput && price != null) priceInput.value = price;
    }
    const panel = picker.querySelector('.product-picker-panel');
    if (panel) panel.hidden = true;
    picker.classList.remove('is-open');
}

// Delegación global de eventos para todos los pickers de producto.
document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.product-picker-trigger');
    if (trigger) {
        const picker = trigger.closest('.product-picker');
        const panel = picker.querySelector('.product-picker-panel');
        if (panel.hidden) openProductPicker(picker);
        else { panel.hidden = true; picker.classList.remove('is-open'); }
        return;
    }
    const moreBtn = e.target.closest('.product-picker-more');
    if (moreBtn) {
        const picker = moreBtn.closest('.product-picker');
        picker.dataset.expanded = picker.dataset.expanded === '1' ? '0' : '1';
        renderProductPickerList(picker);
        const searchEl = picker.querySelector('.product-picker-search-input');
        if (searchEl) searchEl.focus();
        return;
    }
    const item = e.target.closest('.product-picker-item');
    if (item && item.dataset.value !== undefined) {
        selectProductPickerValue(item.closest('.product-picker'), item.dataset.value);
        return;
    }
    // Clic fuera de cualquier picker: cierra los abiertos.
    if (!e.target.closest('.product-picker')) closeAllProductPickers();
});

document.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('product-picker-search-input')) {
        const picker = e.target.closest('.product-picker');
        if (picker) renderProductPickerList(picker);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAllProductPickers(); return; }
    // Enter dentro del buscador: no enviar el formulario; elige la 1ª coincidencia.
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('product-picker-search-input')) {
        e.preventDefault();
        const picker = e.target.closest('.product-picker');
        const first = picker && picker.querySelector('.product-picker-item[data-value]');
        if (first) selectProductPickerValue(picker, first.dataset.value);
    }
});

// Abre el modal para agregar / renombrar / eliminar productos de la lista.
window.openProductsManager = function() {
    if (document.getElementById('products-manager-overlay')) return; // ya abierto
    const overlay = document.createElement('div');
    overlay.id = 'products-manager-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10000'; // por encima del modal de pedido
    overlay.innerHTML = ProductsManagerModalTemplate();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeProductsManager(); });
    document.body.appendChild(overlay);
    renderProductsManagerList();
    const input = document.getElementById('new-product-name-input');
    if (input) input.focus();
};

// Cierra el modal de gestión de productos.
window.closeProductsManager = function() {
    const overlay = document.getElementById('products-manager-overlay');
    if (overlay) overlay.remove();
};

// Renderiza la lista de productos dentro del gestor (si está abierto).
function renderProductsManagerList() {
    const listEl = document.getElementById('products-manager-list');
    if (!listEl) return; // el gestor no está abierto
    const products = state.products || [];
    // Detecta cuántos productos son duplicados (mismo nombre normalizado).
    const counts = new Map();
    products.forEach(p => {
        const key = normalizeForSearch(p.name).trim();
        if (!key) return;
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    let duplicateCount = 0;
    counts.forEach(n => { if (n > 1) duplicateCount += (n - 1); });

    const toolsEl = document.getElementById('products-manager-tools');
    if (toolsEl) {
        toolsEl.innerHTML = duplicateCount > 0
            ? `<button type="button" class="products-dedup-btn" onclick="removeDuplicateProducts()">
                   <i class="fas fa-broom"></i> Quitar ${duplicateCount} duplicado${duplicateCount === 1 ? '' : 's'}
               </button>`
            : '';
    }

    if (!products.length) {
        listEl.innerHTML = '<p class="products-manager-empty">Aún no hay productos. Agrega el primero arriba.</p>';
        return;
    }
    listEl.innerHTML = products.map(ProductManagerRowTemplate).join('');
}

// Agrega un nuevo producto a Firestore desde el input del gestor.
window.submitNewProduct = async function() {
    const input = document.getElementById('new-product-name-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) { showError("Escribe un nombre para el producto."); return; }
    const key = normalizeForSearch(name).trim();
    const exists = (state.products || []).some(p => normalizeForSearch(p.name).trim() === key);
    if (exists) { showError(`El producto "${name}" ya existe.`); return; }
    // Precio (opcional). El input trae $750 por defecto.
    const priceInput = document.getElementById('new-product-price-input');
    const priceRaw = priceInput ? priceInput.value.trim() : '';
    let price = null;
    if (priceRaw !== '') {
        price = Number(priceRaw);
        if (isNaN(price) || price < 0) { showError("El precio no es válido."); return; }
    }
    input.value = '';
    if (priceInput) priceInput.value = '750';
    input.focus();
    try {
        const maxOrder = (state.products || []).reduce((m, p) => Math.max(m, Number(p.order) || 0), -1);
        const data = {
            name,
            order: maxOrder + 1,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (price != null) data.price = price;
        await db.collection('crm_products').add(data);
        showError(`Producto "${name}" agregado.`, 'success');
    } catch (err) {
        console.error("Error al agregar producto:", err);
        showError("No se pudo agregar el producto.");
    }
};

// Renombra un producto cuando el input pierde el foco (solo si cambió).
window.saveProductName = async function(id, inputEl) {
    if (!inputEl) return;
    const newName = inputEl.value.trim();
    const original = inputEl.dataset.original || '';
    if (newName === original) return; // sin cambios
    if (!newName) {
        inputEl.value = original; // no permitir nombre vacío
        showError("El nombre del producto no puede estar vacío.");
        return;
    }
    const dup = (state.products || []).some(p => p.id !== id && (p.name || '').toLowerCase() === newName.toLowerCase());
    if (dup) {
        inputEl.value = original;
        showError(`Ya existe un producto llamado "${newName}".`);
        return;
    }
    inputEl.dataset.original = newName;
    try {
        await db.collection('crm_products').doc(id).update({ name: newName });
        showError("Producto actualizado.", 'success');
    } catch (err) {
        console.error("Error al renombrar producto:", err);
        inputEl.value = original;
        showError("No se pudo actualizar el producto.");
    }
};

// Elimina un producto tras confirmación del usuario.
window.deleteProductEntry = async function(id, btnEl) {
    const product = (state.products || []).find(p => p.id === id);
    const name = product ? product.name : 'este producto';
    const ok = await showConfirmModal(`¿Eliminar el producto "${name}" de la lista?`, {
        icon: 'delete', confirmText: 'Eliminar', cancelText: 'Cancelar'
    });
    if (!ok) return;
    try {
        await db.collection('crm_products').doc(id).delete();
        showError(`Producto "${name}" eliminado.`, 'success');
    } catch (err) {
        console.error("Error al eliminar producto:", err);
        showError("No se pudo eliminar el producto.");
    }
};

// Guarda el precio de un producto cuando el input pierde el foco (solo si cambió).
window.saveProductPrice = async function(id, inputEl) {
    if (!inputEl) return;
    const raw = inputEl.value.trim();
    const original = inputEl.dataset.originalPrice || '';
    if (raw === original) return; // sin cambios
    let price = null;
    if (raw !== '') {
        price = Number(raw);
        if (isNaN(price) || price < 0) {
            inputEl.value = original;
            showError("El precio no es válido.");
            return;
        }
    }
    inputEl.dataset.originalPrice = raw;
    try {
        await db.collection('crm_products').doc(id).update({
            price: price === null ? firebase.firestore.FieldValue.delete() : price
        });
        showError("Precio actualizado.", 'success');
    } catch (err) {
        console.error("Error al guardar el precio:", err);
        inputEl.value = original;
        showError("No se pudo actualizar el precio.");
    }
};

// Elimina productos duplicados (mismo nombre normalizado), conservando una copia
// de cada uno. Prefiere conservar la copia usada recientemente o con precio, y le
// traspasa el precio si no lo tenía. Pide confirmación antes de borrar.
window.removeDuplicateProducts = async function() {
    const products = state.products || [];
    const groups = new Map();
    products.forEach(p => {
        const key = normalizeForSearch(p.name).trim();
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    });
    const toDelete = [];
    const priceUpdates = []; // traspaso de precio al superviviente sin precio
    groups.forEach(group => {
        if (group.length < 2) return;
        group.sort((a, b) => {
            const ua = a.lastUsedAt ? 1 : 0, ub = b.lastUsedAt ? 1 : 0;
            if (ub - ua) return ub - ua;
            const pa = (a.price != null && a.price !== '') ? 1 : 0;
            const pb = (b.price != null && b.price !== '') ? 1 : 0;
            if (pb - pa) return pb - pa;
            return (Number(a.order) || 0) - (Number(b.order) || 0);
        });
        const survivor = group[0];
        const rest = group.slice(1);
        if (survivor.price == null || survivor.price === '') {
            const withPrice = rest.find(r => r.price != null && r.price !== '');
            if (withPrice) priceUpdates.push({ id: survivor.id, price: Number(withPrice.price) });
        }
        rest.forEach(r => toDelete.push(r.id));
    });
    if (!toDelete.length) { showError("No hay productos duplicados.", 'success'); return; }
    const ok = await showConfirmModal(
        `Se encontraron ${toDelete.length} producto(s) duplicado(s). ¿Quitarlos y conservar una copia de cada uno?`,
        { icon: 'delete', confirmText: 'Quitar duplicados', cancelText: 'Cancelar' }
    );
    if (!ok) return;
    try {
        const batch = db.batch();
        priceUpdates.forEach(u => batch.update(db.collection('crm_products').doc(u.id), { price: u.price }));
        toDelete.forEach(id => batch.delete(db.collection('crm_products').doc(id)));
        await batch.commit();
        showError(`Se quitaron ${toDelete.length} producto(s) duplicado(s).`, 'success');
    } catch (err) {
        console.error("Error al quitar duplicados:", err);
        showError("No se pudieron quitar los duplicados.");
    }
};

// Marca los productos indicados (por nombre) como usados ahora, para que suban a
// la parte superior de la lista la próxima vez. Fire-and-forget (no bloquea).
window.markProductsUsed = function(names) {
    if (!Array.isArray(names) || !names.length) return;
    const products = state.products || [];
    if (!products.length) return;
    const seen = new Set();
    const batch = db.batch();
    let count = 0;
    names.forEach(name => {
        const key = normalizeForSearch(name).trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        const match = products.find(p => normalizeForSearch(p.name).trim() === key);
        if (match) {
            batch.update(db.collection('crm_products').doc(match.id), {
                lastUsedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            count++;
        }
    });
    if (count) batch.commit().catch(err => console.error("Error al marcar productos usados:", err));
};
/**
 * Abre el modal para registrar un nuevo pedido, pre-rellenando datos si es posible.
 * Unificado con la lgica de Lista de Pedidos (pedidos.html / logica.js).
 */
function abrirModalPedido(contactData = null) {
    // Si viene de un evento, ignoramos el primer argumento
    if (contactData instanceof Event) contactData = null;
    const contact = contactData || state.contacts.find(c => c.id === state.selectedContactId);
    if (!contact) {
        showError("Por favor, selecciona un contacto para registrar un pedido.");
        return;
    }

    const modalContainer = document.getElementById('new-order-modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = NewOrderModalTemplate();
    
    const phoneInput = document.getElementById('pedidoTelefono');
    if (phoneInput && contact) {
        phoneInput.value = contact.phone || contact.id || '';
    }

    orderPhotosManager = [];
    promoPhotosManager = [];
    orderItemsNextIndex = 1; // El primer producto ya usa index 0

    // Configura listeners para el modal recin creado
    document.getElementById('formularioNuevoPedido').addEventListener('submit', handleSaveOrder);

    // Configura drag & drop y vista previa para fotos del pedido
    const orderPhotoContainer = document.getElementById('fileInputContainerProducto');
    const orderPhotoInput = document.getElementById('pedidoFotoFile');
    const orderPreviewContainer = document.getElementById('fotosPreviewContainer');
    setupPhotoManager(orderPhotoContainer, orderPhotoInput, orderPreviewContainer, orderPhotosManager, 'order');

    // Configura drag & drop y vista previa para fotos de promocin
    const promoPhotoContainer = document.getElementById('fileInputContainerPromocion');
    const promoPhotoInput = document.getElementById('pedidoFotoPromocionFile');
    const promoPreviewContainer = document.getElementById('promoFotosPreviewContainer');
    setupPhotoManager(promoPhotoContainer, promoPhotoInput, promoPreviewContainer, promoPhotosManager, 'promo');

    // Lgica del checkbox "Usar misma foto"
    const samePhotoCheckbox = document.getElementById('mismaFotoCheckbox');
    const samePhotoContainer = document.getElementById('mismaFotoContainer'); // Contenedor del checkbox
    const promoFileInputContainer = document.getElementById('fileInputContainerPromocion'); // Contenedor de subida de promo

    if(samePhotoCheckbox && samePhotoContainer && promoFileInputContainer) {
        samePhotoCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Copia las fotos del pedido a la promocin
                promoPhotosManager = [...orderPhotosManager];
                renderPhotoPreviews(promoPreviewContainer, promoPhotosManager, 'promo');
                promoFileInputContainer.classList.add('hidden');
            } else {
                promoPhotosManager = [];
                renderPhotoPreviews(promoPreviewContainer, promoPhotosManager, 'promo');
                promoFileInputContainer.classList.remove('hidden');
            }
        });
    }

    // Pre-popular el selector de campañas (oculto por default; aparece si se marca el checkbox)
    if (typeof populateCampanaSelectorsInOrderModal === 'function') {
        populateCampanaSelectorsInOrderModal(false);
    }
}

/**
 * Cierra el modal de nuevo pedido.
 */
function cerrarModalPedido() {
    const modalContainer = document.getElementById('new-order-modal-container');
    if (modalContainer) modalContainer.innerHTML = '';
    orderPhotosManager = [];
    promoPhotosManager = [];
}

// Los alias globales se definen al final del archivo para mayor claridad

/**
 * Cierra el modal de confirmacin de pedido.
 */
function closeOrderConfirmationModal() {
    const modalContainer = document.getElementById('order-confirmation-modal-container');
    if (modalContainer) modalContainer.innerHTML = '';
}
window.closeOrderConfirmationModal = closeOrderConfirmationModal;

/**
 * Copia el nmero de pedido al portapapeles y da feedback visual.
 */
window.copyOrderNumber = (text, btn) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalContent = btn.innerHTML;
        btn.classList.add('bg-green-100', 'text-green-600');
        btn.innerHTML = `
            <span class="text-3xl font-black tracking-wider">${text}</span>
            <div class="w-10 h-10 bg-green-500 text-white rounded-xl shadow-sm flex items-center justify-center">
                <i class="fas fa-check"></i>
            </div>
        `;
        showError("Nmero de pedido copiado al portapapeles.", "success");
        setTimeout(() => {
            btn.classList.remove('bg-green-100', 'text-green-600');
            btn.innerHTML = originalContent;
        }, 2000);
    });
};

function renderPhotoPreviews(container, managerArray, type) {
    container.innerHTML = '';
    managerArray.forEach((photoObj, index) => {
        const previewUrl = photoObj.isNew ? URL.createObjectURL(photoObj.file) : photoObj.url;
        const div = document.createElement('div');
        div.className = 'preview-thumbnail relative';
        div.innerHTML = `
            <img src="${previewUrl}" class="w-full h-full object-cover">
            <button type="button" class="delete-photo-btn" onclick="removePhoto(${index}, '${type}')"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(div);
    });

    // Update checkbox visibility if managing promo
    const samePhotoContainer = document.getElementById('order-same-photo-container');
    if (samePhotoContainer && type === 'order') {
        samePhotoContainer.style.display = managerArray.length > 0 ? 'flex' : 'none';
    }
}

// Function to handle global deletion specifically
window.removePhoto = function(index, type) {
    if (type === 'order') {
        orderPhotosManager.splice(index, 1);
        renderPhotoPreviews(document.getElementById('order-photos-preview-container'), orderPhotosManager, 'order');
    } else if (type === 'promo') {
        promoPhotosManager.splice(index, 1);
        renderPhotoPreviews(document.getElementById('order-promo-photos-preview-container'), promoPhotosManager, 'promo');
    } else if (type === 'edit-order') {
        editOrderPhotosManager.splice(index, 1);
        renderPhotoPreviews(document.getElementById('edit-order-photos-preview-container'), editOrderPhotosManager, 'edit-order');
    } else if (type === 'edit-promo') {
        editPromoPhotosManager.splice(index, 1);
        renderPhotoPreviews(document.getElementById('edit-order-promo-photos-preview-container'), editPromoPhotosManager, 'edit-promo');
    }
};

function setupPhotoManager(dropContainer, fileInput, previewContainer, managerArray, type) {
    if (!dropContainer || !fileInput || !previewContainer) return;

    const handleFiles = (files) => {
        Array.from(files).forEach(file => {
            if (file.type.startsWith('image/')) {
                managerArray.push({ file: file, isNew: true });
            }
        });
        renderPhotoPreviews(previewContainer, managerArray, type);
    };

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = ''; // Reset
    });

    dropContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropContainer.classList.add('drag-over', 'bg-green-50');
    });

    dropContainer.addEventListener('dragleave', () => {
        dropContainer.classList.remove('drag-over', 'bg-green-50');
    });

    dropContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        dropContainer.classList.remove('drag-over', 'bg-green-50');
        if (e.dataTransfer.files) {
            handleFiles(e.dataTransfer.files);
        }
    });

    // Support paste events
    dropContainer.addEventListener('paste', (e) => {
        e.preventDefault();
        if (e.clipboardData.files) {
            handleFiles(e.clipboardData.files);
        }
    });
}


// Cierra el modal de nuevo pedido y limpia los arrays de fotos
function closeNewOrderModal() {
    const modalContainer = document.getElementById('new-order-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = ''; // Limpia el contenido del modal
    }
    // Limpia los arrays de fotos
    orderPhotosManager = [];
    promoPhotosManager = [];
}
// --- END: New Order Modal ---

// --- START: Conversation Preview Modal ---
// Cierra el modal de previsualización de conversación
function closeConversationPreviewModal() {
    const modalContainer = document.getElementById('conversation-preview-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = ''; // Limpia el contenido
    }
    document.body.classList.remove('modal-open'); // Permite scroll en el body
    // Remover el listener de ESC (registrado en openConversationPreview) para evitar fugas.
    if (window.previewEscHandler) {
        document.removeEventListener('keydown', window.previewEscHandler, true);
        window.previewEscHandler = null;
    }
}
// --- END: Conversation Preview Modal ---

// --- INICIO DE MODIFICACIÓN: Funciones para el modal de detalles/edición de pedido ---


// Cierra el modal de edición de pedido y limpia los arrays de fotos
function closeOrderEditModal() {
    const modalContainer = document.getElementById('order-edit-modal-container');
    if (modalContainer) {
        modalContainer.innerHTML = ''; // Limpia el contenido
    }
    // Limpia los arrays de fotos de edición
    editOrderPhotosManager = [];
    editPromoPhotosManager = [];
}

/**
 * Abre el modal para editar un pedido existente.
 * @param {string} orderId - El ID del pedido a editar.
 */
function openOrderEditModal(orderId) {
    const order = state.selectedContactOrders.find(o => o.id === orderId);
    if (!order) {
        showError("No se pudo encontrar el pedido para editar.");
        return;
    }

    const modalContainer = document.getElementById('order-edit-modal-container');
    if (!modalContainer) {
        console.error("El contenedor del modal de edición de pedidos no existe.");
        return;
    }

    modalContainer.innerHTML = OrderEditModalTemplate(order);

    // --- Poblar campos compartidos ---
    const phoneInput = document.getElementById('edit-order-phone');
    if (phoneInput) phoneInput.value = order.telefono || '';
    const promoDetails = document.getElementById('edit-order-promo-details');
    if (promoDetails) promoDetails.value = order.datosPromocion || '';
    const comments = document.getElementById('edit-order-comments');
    if (comments) comments.value = order.comentarios || '';

    // --- Poblar items (multi-producto) ---
    // Si el pedido ya tiene items embebidos, usarlos. Si no, construir un item desde los campos legacy.
    const itemsToRender = (Array.isArray(order.items) && order.items.length > 0)
        ? order.items.map(it => ({ ...it, cantidad: Math.max(1, parseInt(it.cantidad, 10) || 1) }))
        : [{ producto: order.producto || 'Spiderman', cantidad: 1, precio: order.precio || 0, datosProducto: order.datosProducto || '' }];

    editOrderItemsNextIndex = itemsToRender.length;
    const itemsContainer = document.getElementById('edit-order-items-container');
    if (itemsContainer) {
        itemsContainer.innerHTML = itemsToRender.map((item, idx) => EditOrderItemRowTemplate(idx, item, idx === 0)).join('');
        updateEditOrderItemNumbering();
    }

    // --- Configurar managers de fotos ---
    editOrderPhotosManager = order.fotoUrls ? order.fotoUrls.map(url => ({ file: null, url, isNew: false })) : [];
    editPromoPhotosManager = order.fotoPromocionUrls ? order.fotoPromocionUrls.map(url => ({ file: null, url, isNew: false })) : [];

    const editOrderPhotoContainer = document.getElementById('edit-order-file-input-container-product');
    const editOrderPhotoInput = document.getElementById('edit-order-photo-file');
    const editOrderPreviewContainer = document.getElementById('edit-order-photos-preview-container');
    if (editOrderPhotoContainer && editOrderPhotoInput && editOrderPreviewContainer) {
        setupPhotoManager(editOrderPhotoContainer, editOrderPhotoInput, editOrderPreviewContainer, editOrderPhotosManager, 'edit-order');
        renderPhotoPreviews(editOrderPreviewContainer, editOrderPhotosManager, 'edit-order');
    }

    const editPromoPhotoContainer = document.getElementById('edit-order-file-input-container-promo');
    const editPromoPhotoInput = document.getElementById('edit-order-promo-photo-file');
    const editPromoPreviewContainer = document.getElementById('edit-order-promo-photos-preview-container');
    if (editPromoPhotoContainer && editPromoPhotoInput && editPromoPreviewContainer) {
        setupPhotoManager(editPromoPhotoContainer, editPromoPhotoInput, editPromoPreviewContainer, editPromoPhotosManager, 'edit-promo');
        renderPhotoPreviews(editPromoPreviewContainer, editPromoPhotosManager, 'edit-promo');
    }

    // Añadir el listener para el envío del formulario de edición
    const form = document.getElementById('edit-order-form');
    if (form) {
        form.addEventListener('submit', (event) => handleUpdateExistingOrder(event, orderId));
    } else {
        console.error("El formulario de edición de pedido ('edit-order-form') no se encontró en la plantilla.");
    }

    // Pre-llenar selector de campaña/plantilla si el pedido ya estaba tagueado
    if (typeof prefillEditOrderCampaign === 'function') {
        prefillEditOrderCampaign(order);
    }
}

// --- Multi-producto en modal de edición ---
let editOrderItemsNextIndex = 1;

window.addEditOrderItem = function() {
    const container = document.getElementById('edit-order-items-container');
    if (!container) return;
    const index = editOrderItemsNextIndex++;
    const defProduct = (typeof getProductNamesRecent === 'function' && getProductNamesRecent()[0]) || 'Spiderman';
    const defPrice = (typeof getProductPrice === 'function') ? getProductPrice(defProduct) : null;
    container.insertAdjacentHTML('beforeend', EditOrderItemRowTemplate(index, { producto: defProduct, precio: defPrice != null ? defPrice : '', datosProducto: '' }, false));
    updateEditOrderItemNumbering();
};

window.removeEditOrderItem = function(index) {
    const row = document.querySelector(`#edit-order-items-container .order-item-row[data-item-index="${index}"]`);
    if (row) row.remove();
    updateEditOrderItemNumbering();
};

function updateEditOrderItemNumbering() {
    const rows = document.querySelectorAll('#edit-order-items-container .order-item-row');
    rows.forEach((row, i) => {
        const numberEl = row.querySelector('.order-item-number');
        if (numberEl) numberEl.textContent = `Producto ${i + 1}`;
        const removeBtn = row.querySelector('.order-item-remove-btn');
        if (removeBtn) removeBtn.style.display = rows.length > 1 ? '' : 'none';
    });
}
// --- FIN DE MODIFICACIÓN ---

// --- Funciones para Modales (Ad Response, Quick Reply, Knowledge Base, etc.) ---

// Abre el modal para añadir/editar Mensajes de Anuncio
function openAdResponseModal(responseId = null) {
    const modal = document.getElementById('ad-response-modal');
    if (!modal) return;

    // Obtener referencias a elementos del formulario
    const form = document.getElementById('ad-response-form');
    const titleEl = document.getElementById('ad-response-modal-title');
    const docIdInput = document.getElementById('ar-doc-id');
    const nameInput = document.getElementById('ar-name');
    const adIdInput = document.getElementById('ar-ad-id'); // Este es el input que modificaremos
    const messageTextarea = document.getElementById('ar-message');
    const fileUrlInput = document.getElementById('ar-file-url');
    const fileTypeInput = document.getElementById('ar-file-type');
    const mediaPreview = document.getElementById('ar-media-preview');
    const attachButtonText = document.getElementById('ar-attach-button-text');
    const fileInput = document.getElementById('ar-file-input');

    // Resetear formulario
    form.reset();
    docIdInput.value = '';
    fileUrlInput.value = ''; // Limpiar URL oculta
    fileTypeInput.value = ''; // Limpiar tipo oculto
    mediaPreview.innerHTML = ''; // Limpiar vista previa
    attachButtonText.textContent = 'Adjuntar Archivo'; // Texto original del botón

    if (responseId) {
        // --- Modo Edición ---
        const adResponse = state.adResponses.find(r => r.id === responseId); // Busca la respuesta en el estado
        if (adResponse) {
            titleEl.textContent = 'Editar Mensaje de Anuncio';
            docIdInput.value = adResponse.id; // Guarda el ID para la actualización
            nameInput.value = adResponse.adName || '';
            // --- INICIO MODIFICACIÓN: Poblar con IDs separados por comas ---
            // Unir el array 'adIds' (o usar 'adId' como fallback) en un string
            adIdInput.value = Array.isArray(adResponse.adIds) ? adResponse.adIds.join(', ') : (adResponse.adId || '');
            // --- FIN MODIFICACIÓN ---
            messageTextarea.value = adResponse.message || '';
            fileUrlInput.value = adResponse.fileUrl || ''; // Guarda URL existente (oculta)
            fileTypeInput.value = adResponse.fileType || ''; // Guarda tipo existente (oculto)

            // Muestra enlace al archivo adjunto actual si existe
            if (adResponse.fileUrl) {
                mediaPreview.innerHTML = `<a href="${adResponse.fileUrl}" target="_blank" class="text-blue-600 hover:underline">Ver adjunto actual</a>`;
                attachButtonText.textContent = 'Reemplazar Archivo'; // Cambia texto del botón
            }
        }
    } else {
        // --- Modo Añadir ---
        titleEl.textContent = 'Añadir Mensaje de Anuncio';
        adIdInput.value = ''; // Asegurarse de que esté vacío al añadir uno nuevo
    }

    // Listener para el input de archivo (maneja la selección de un NUEVO archivo)
    fileInput.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            fileUrlInput.value = ''; // Limpia la URL existente si se selecciona uno nuevo
            fileTypeInput.value = file.type; // Guarda el tipo del nuevo archivo
            mediaPreview.innerHTML = `<span class="text-sm text-gray-600">Archivo seleccionado: <strong>${file.name}</strong></span>`;
            attachButtonText.textContent = 'Cambiar Archivo';
        }
    };

    modal.classList.remove('hidden'); // Muestra el modal
}


// Cierra el modal de Mensajes de Anuncio
function closeAdResponseModal() {
    const modal = document.getElementById('ad-response-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Abre el modal para añadir/editar Respuestas Rápidas
function openQuickReplyModal(replyId = null) {
    const modal = document.getElementById('quick-reply-modal');
    if (!modal) return;

    // Referencias a elementos del form
    const form = document.getElementById('quick-reply-form');
    const titleEl = document.getElementById('quick-reply-modal-title');
    const docIdInput = document.getElementById('qr-doc-id');
    const shortcutInput = document.getElementById('qr-shortcut');
    const messageTextarea = document.getElementById('qr-message');
    const fileUrlInput = document.getElementById('qr-file-url');
    const fileTypeInput = document.getElementById('qr-file-type');
    const mediaPreview = document.getElementById('qr-media-preview');
    const attachButtonText = document.getElementById('qr-attach-button-text');
    const fileInput = document.getElementById('qr-file-input');

    // Resetear form
    form.reset();
    docIdInput.value = '';
    fileUrlInput.value = '';
    fileTypeInput.value = '';
    mediaPreview.innerHTML = '';
    attachButtonText.textContent = 'Adjuntar Archivo';

    if (replyId) {
        // --- Modo Edición ---
        const reply = state.quickReplies.find(r => r.id === replyId); // Busca en estado
        if (reply) {
            titleEl.textContent = 'Editar Respuesta Rápida';
            docIdInput.value = reply.id;
            shortcutInput.value = reply.shortcut || '';
            messageTextarea.value = reply.message || '';
            fileUrlInput.value = reply.fileUrl || '';
            fileTypeInput.value = reply.fileType || '';

            // Muestra enlace al adjunto actual
            if (reply.fileUrl) {
                mediaPreview.innerHTML = `<a href="${reply.fileUrl}" target="_blank" class="text-blue-600 hover:underline">Ver adjunto actual</a>`;
                attachButtonText.textContent = 'Reemplazar Archivo';
            }
        }
    } else {
        // --- Modo Añadir ---
        titleEl.textContent = 'Añadir Respuesta Rápida';
    }

    // Listener para NUEVO archivo
    fileInput.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            fileUrlInput.value = ''; // Limpiar URL previa
            fileTypeInput.value = file.type;
            mediaPreview.innerHTML = `<span class="text-sm text-gray-600">Seleccionado: <strong>${file.name}</strong></span>`;
            attachButtonText.textContent = 'Cambiar Archivo';
        }
    };

    modal.classList.remove('hidden'); // Muestra modal
}

// Cierra el modal de Respuestas Rápidas
function closeQuickReplyModal() {
    const modal = document.getElementById('quick-reply-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Abre el modal para editar un contacto (desde barra lateral o vista de contactos)
function openEditContactModal(contactId = null) {
    const modal = document.getElementById('edit-contact-modal');
    const form = document.getElementById('edit-contact-form');
    const title = document.getElementById('edit-contact-modal-title');
    const idInput = document.getElementById('edit-contact-id');
    const nameInput = document.getElementById('edit-contact-name');
    const nicknameInput = document.getElementById('edit-contact-nickname');
    const emailInput = document.getElementById('edit-contact-email');

    form.reset();
    idInput.value = '';

    // Determina si se está editando desde la barra lateral o creando uno nuevo
    const idToEdit = contactId || state.selectedContactId;
    const contact = state.contacts.find(c => c.id === idToEdit);

    if (contact) { // Modo edición
        title.textContent = "Editar Contacto";
        idInput.value = contact.id;
        nameInput.value = contact.name || '';
        nicknameInput.value = contact.nickname || '';
        emailInput.value = contact.email || '';
    } else { // Modo añadir (actualmente no implementado botón directo, pero se deja la lógica)
        title.textContent = "Añadir Contacto";
        // Aquí podrías pedir el número de teléfono si fuera necesario añadir
    }

    modal.classList.remove('hidden');
    nameInput.focus();
}

// Cierra el modal de edición de contacto
function closeEditContactModal() {
    const modal = document.getElementById('edit-contact-modal');
    modal.classList.add('hidden');
}

// Abre el modal para añadir/editar etiquetas
function openTagModal(tag = null) {
    const modal = document.getElementById('tag-modal');
    const form = document.getElementById('tag-form');
    const title = document.getElementById('tag-modal-title');
    const idInput = document.getElementById('tag-id');
    const labelInput = document.getElementById('tag-label');
    const colorInput = document.getElementById('tag-color-input');
    const colorPreview = document.getElementById('tag-color-preview');
    const colorHex = document.getElementById('tag-color-hex');

    form.reset();
    idInput.value = '';
    const defaultColor = '#3182ce'; // Color azul por defecto

    if (tag) { // Modo edición
        title.textContent = "Editar Etiqueta";
        idInput.value = tag.id;
        labelInput.value = tag.label;
        colorInput.value = tag.color;
        colorPreview.style.backgroundColor = tag.color;
        colorHex.textContent = tag.color;
    } else { // Modo añadir
        title.textContent = "Nueva Etiqueta";
        colorInput.value = defaultColor;
        colorPreview.style.backgroundColor = defaultColor;
        colorHex.textContent = defaultColor;
    }

    // Listener para actualizar la vista previa del color en tiempo real
    colorInput.oninput = () => {
        colorPreview.style.backgroundColor = colorInput.value;
        colorHex.textContent = colorInput.value;
    };

    modal.classList.remove('hidden');
    labelInput.focus();
}

// Cierra el modal de etiquetas
function closeTagModal() {
    const modal = document.getElementById('tag-modal');
    modal.classList.add('hidden');
}


/**
 * Maneja el cambio de estatus de un pedido desde la barra lateral de detalles.
 * Usa el endpoint del servidor para que al cambiar a "Fabricar" se envíe el evento Purchase a Meta
 * y se actualice la corona del contacto a zafiro.
 * @param {string} orderId - El ID del documento del pedido en Firestore.
 * @param {string} newStatus - El nuevo valor del estatus.
 * @param {HTMLElement} [selectEl] - El <select> que disparó el cambio (para animación).
 */
async function handleOrderStatusChange(orderId, newStatus, selectEl) {
    if (!orderId || !newStatus) {
        console.error("Falta el ID del pedido o el nuevo estatus.");
        showError("Error interno: no se pudo identificar el pedido o el estatus.", 'error');
        return;
    }

    // Animación inmediata al cambiar a Fabricar (antes del API call)
    if (newStatus === 'Fabricar' && selectEl) {
        const rect = selectEl.getBoundingClientRect();
        playGemPlacementAnimationCRM(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/orders/${orderId}/change-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newStatus })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Error del servidor.');
        }

        showError('Estatus del pedido actualizado.', 'success');

        // Actualizar estado local inmediatamente
        const orderInState = state.selectedContactOrders.find(o => o.id === orderId);
        if (orderInState) {
            orderInState.estatus = newStatus;
        }

        // Actualizar estilos del select inmediatamente
        if (selectEl) {
            const statusStyle = state.orderStatuses.find(s => s.key === newStatus) || { color: '#e9ecef' };
            selectEl.style.backgroundColor = statusStyle.color + '20';
            selectEl.style.color = statusStyle.color;
            selectEl.style.borderColor = statusStyle.color + '50';
        }

    } catch (error) {
        console.error("Error al actualizar el estatus del pedido: ", error);
        showError("Error al guardar el cambio. Revisa la consola.", 'error');
    }
}

/** Animación: gema zafiro cae y se coloca con destellos (CRM sidebar) */
function playGemPlacementAnimationCRM(x, y) {
    const container = document.createElement('div');
    container.className = 'gem-anim-container';
    container.style.left = x + 'px';
    container.style.top = y + 'px';

    const gem = document.createElement('div');
    gem.className = 'gem-anim-gem';
    gem.innerHTML = '<i class="fas fa-gem"></i>';
    container.appendChild(gem);

    const glow = document.createElement('div');
    glow.className = 'gem-anim-glow';
    container.appendChild(glow);

    const sparkles = document.createElement('div');
    sparkles.className = 'gem-anim-sparkles';
    for (let i = 0; i < 8; i++) {
        const s = document.createElement('span');
        const angle = (360 / 8) * i;
        const dist = 30 + Math.random() * 25;
        s.style.setProperty('--sx', Math.cos(angle * Math.PI / 180) * dist + 'px');
        s.style.setProperty('--sy', Math.sin(angle * Math.PI / 180) * dist + 'px');
        s.style.animationDelay = (0.55 + Math.random() * 0.2) + 's';
        sparkles.appendChild(s);
    }
    container.appendChild(sparkles);

    document.body.appendChild(container);
    setTimeout(() => container.remove(), 2200);
}



/**
 * Actualiza el contador de destinatarios para las vistas de campañas.
 * @param {string} type - El tipo de campaña ('text' o 'image'). Por defecto es 'text'.
 */
function updateCampaignRecipientCount(type = 'text') {
    const isImageCampaign = type === 'image';
    const tagSelectId = isImageCampaign ? 'campaign-image-tag-select' : 'campaign-tag-select';
    const countElId = isImageCampaign ? 'campaign-image-recipient-count' : 'campaign-recipient-count';

    const tagSelect = document.getElementById(tagSelectId);
    const countEl = document.getElementById(countElId);

    if (!tagSelect || !countEl) return; // Si los elementos no existen en la vista actual

    const selectedTagKey = tagSelect.value;
    let recipientCount = 0;

    if (selectedTagKey === 'all') {
        recipientCount = state.contacts.length;
    } else {
        recipientCount = state.contacts.filter(c => c.status === selectedTagKey).length;
    }

    countEl.textContent = `${recipientCount} destinatarios`;
}



// --- NUEVAS FUNCIONES PARA MODALES DE DEPARTAMENTOS Y REGLAS ---

// --- Modal de Departamentos ---
function openDepartmentModal(dept = null) {
    const modal = document.getElementById('department-modal');
    const form = document.getElementById('department-form');
    const title = document.getElementById('department-modal-title');
    const idInput = document.getElementById('dept-id');
    const nameInput = document.getElementById('dept-name');
    const colorInput = document.getElementById('dept-color-input');
    const colorPreview = document.getElementById('dept-color-preview');
    const colorHex = document.getElementById('dept-color-hex');
    const usersContainer = document.getElementById('department-users-container');

    if (!modal || !usersContainer) return;

    form.reset();
    idInput.value = '';
    usersContainer.innerHTML = '<p class="text-gray-400">Cargando usuarios...</p>';
    const defaultColor = '#6c757d';

    // Rellenar lista de usuarios
    if (state.allUsers && state.allUsers.length > 0) {
        usersContainer.innerHTML = state.allUsers.map(user => `
            <div class="flex items-center">
                <input type="checkbox" id="user-${user.uid}" name="department-users" value="${user.email}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <label for="user-${user.uid}" class="ml-3 block text-sm font-medium text-gray-700">
                    ${user.name || user.email}
                </label>
            </div>
        `).join('');
    } else {
        usersContainer.innerHTML = '<p class="text-gray-400">No se encontraron usuarios o aún no se han cargado.</p>';
    }

    if (dept) { // Modo Edición
        title.textContent = "Editar Departamento";
        idInput.value = dept.id;
        nameInput.value = dept.name || '';
        colorInput.value = dept.color || defaultColor;
        colorPreview.style.backgroundColor = dept.color || defaultColor;
        colorHex.textContent = dept.color || defaultColor;

        // Marcar los checkboxes de los usuarios asignados
        // Se buscan los usuarios cuyo array 'assignedDepartments' incluye el ID de este departamento.
        if (state.allUsers.length > 0) {
             state.allUsers.forEach(user => {
                if (user.assignedDepartments && user.assignedDepartments.includes(dept.id)) {
                    const checkbox = usersContainer.querySelector(`input[value="${user.email}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                    }
                }
            });
        }

    } else { // Modo Añadir
        title.textContent = "Nuevo Departamento";
        colorInput.value = defaultColor;
        colorPreview.style.backgroundColor = defaultColor;
        colorHex.textContent = defaultColor;
    }

    // Listener para color preview
    colorInput.oninput = () => {
        colorPreview.style.backgroundColor = colorInput.value;
        colorHex.textContent = colorInput.value;
    };

    modal.classList.remove('hidden');
    nameInput.focus();
}

function closeDepartmentModal() {
    const modal = document.getElementById('department-modal');
    if (modal) modal.classList.add('hidden');
}

// --- Modal de Reglas de Enrutamiento ---
function openAdRoutingModal(rule = null) {
    const modal = document.getElementById('ad-routing-modal');
    const form = document.getElementById('ad-routing-form');
    const title = document.getElementById('ad-routing-modal-title');
    const idInput = document.getElementById('rule-id');
    const nameInput = document.getElementById('rule-name');
    const adIdsInput = document.getElementById('rule-ad-ids');
    const deptSelect = document.getElementById('rule-target-dept');

    if (!modal) return;

    // Poblar el select de departamentos
    deptSelect.innerHTML = '<option value="">-- Seleccionar Departamento --</option>' + 
        state.departments.map(dept => `<option value="${dept.id}">${dept.name}</option>`).join('');

    form.reset();
    idInput.value = '';

    if (rule) { // Modo Edición
        title.textContent = "Editar Regla";
        idInput.value = rule.id;
        nameInput.value = rule.ruleName || '';
        adIdsInput.value = Array.isArray(rule.adIds) ? rule.adIds.join(', ') : '';
        deptSelect.value = rule.targetDepartmentId || '';
        document.getElementById('rule-enable-ai').checked = rule.enableAi || false;
    } else { // Modo Añadir
        title.textContent = "Nueva Regla de Enrutamiento";
        document.getElementById('rule-enable-ai').checked = false;
    }

    modal.classList.remove('hidden');
    nameInput.focus();
}

function closeAdRoutingModal() {
    const modal = document.getElementById('ad-routing-modal');
    if (modal) modal.classList.add('hidden');
}

// --- Modal de Transferencia de Chat ---
function openTransferModal(contactId) {
    const modal = document.getElementById('transfer-modal');
    if (!modal) return;

    // Set the hidden input for the contact ID
    const contactIdInput = document.getElementById('transfer-contact-id');
    contactIdInput.value = contactId;

    const wrapper = document.getElementById('custom-dept-select-wrapper');
    const button = document.getElementById('transfer-dept-button');
    const buttonText = document.getElementById('transfer-dept-button-text');
    const optionsContainer = document.getElementById('transfer-dept-options');
    const hiddenInput = document.getElementById('transfer-dept-hidden-input');

    // Clear previous options and reset state
    optionsContainer.innerHTML = '';
    hiddenInput.value = '';
    buttonText.textContent = '-- Seleccionar Departamento --';
    button.classList.remove('open');
    optionsContainer.classList.add('hidden');


    // Populate options
    state.departments.forEach(dept => {
        const option = document.createElement('div');
        option.className = 'custom-select-option';
        option.dataset.value = dept.id;
        
        option.innerHTML = `
            <span class="color-circle" style="background-color: ${dept.color || '#d1d5db'}"></span>
            <span>${dept.name}</span>
        `;
        
        // Add click listener to each option
        option.addEventListener('click', () => {
            hiddenInput.value = dept.id;
            buttonText.textContent = dept.name;
            optionsContainer.classList.add('hidden');
            button.classList.remove('open');
        });
        
        optionsContainer.appendChild(option);
    });

    // Toggle options visibility
    const toggleDropdown = (e) => {
        e.stopPropagation();
        const isHidden = optionsContainer.classList.contains('hidden');
        if (isHidden) {
            optionsContainer.classList.remove('hidden');
            button.classList.add('open');
            // Attach listener to close dropdown when clicking outside
            // Use timeout to avoid it firing from the same click that opened it
            setTimeout(() => {
                document.addEventListener('click', closeDropdown, { once: true });
            }, 0);
        } else {
            optionsContainer.classList.add('hidden');
            button.classList.remove('open');
        }
    };
    
    // Assign the toggle function to the button click
    button.onclick = toggleDropdown;

    // Global click listener to close dropdown
    const closeDropdown = (e) => {
        if (!wrapper.contains(e.target)) {
            optionsContainer.classList.add('hidden');
            button.classList.remove('open');
        } else {
             // If the click was inside the wrapper (e.g. on the button again), re-add the listener
             // because the 'once' option will have removed it. The toggle function will handle closing.
             setTimeout(() => {
                document.addEventListener('click', closeDropdown, { once: true });
            }, 0);
        }
    };

    modal.classList.remove('hidden');
}

function closeTransferModal() {
    const modal = document.getElementById('transfer-modal');
    if (modal) modal.classList.add('hidden');
}

// --- FIN NUEVAS FUNCIONES ---

/**
 * Establece la pestaña activa (ej. 'chat' o 'notas') y vuelve a renderizar la vista.
 * @param {string} tabName - El nombre de la pestaña a activar.
 */
function setActiveTab(tabName) {
    if (state.activeTab === tabName) return; // No hacer nada si ya está activa

    state.activeTab = tabName;
    renderChatWindow(); // Volver a renderizar para mostrar el contenido correcto
}


/**
 * Alterna entre el modo de visualización y edición de una nota.
 * @param {string} noteId - El ID de la nota a editar.
 */
function toggleEditNote(noteId) {
    state.isEditingNote = noteId;
    renderSidebarNotes();
}

// --- NUEVO: Lógica de Tema Oscuro ---

/**
 * Catálogo de temas. El id coincide con la clase body.theme-<id> en style.css
 * (excepto 'obsidian', que reutiliza el tema oscuro existente body.dark-mode).
 */
const CRM_THEMES = [
    { id: 'dekoor',   name: 'Tradicional Dekoor', desc: 'Azul y naranja de marca',     isDark: false, swatches: ['#163C51', '#ea580c', '#f4f4f2'] },
    { id: 'obsidian', name: 'Obsidiana',          desc: 'Oscuro elegante',             isDark: true,  swatches: ['#7aa2f7', '#e0af68', '#1a1b26'] },
    { id: 'lila',     name: 'Lila',               desc: 'Lavanda femenino',            isDark: false, swatches: ['#8a5cd1', '#d6608f', '#faf7fe'] },
    { id: 'elegante', name: 'Elegante',           desc: 'Marfil, salvia y dorado',     isDark: false, swatches: ['#47634f', '#b08d57', '#faf8f4'] },
    { id: 'minimal',  name: 'Minimalista',        desc: 'Blanco y negro + azul',       isDark: false, swatches: ['#18181b', '#2563eb', '#ffffff'] },
];
const CRM_THEME_IDS = CRM_THEMES.map(t => t.id);
const DEFAULT_THEME = 'dekoor';

/** Normaliza el valor guardado (incluye migración del esquema anterior light/dark). */
function normalizeThemeId(raw) {
    if (CRM_THEME_IDS.includes(raw)) return raw;
    if (raw === 'dark') return 'obsidian';
    if (raw === 'light') return 'dekoor';
    return DEFAULT_THEME;
}

/** Devuelve el id del tema activo. */
function getCurrentTheme() {
    return normalizeThemeId(localStorage.getItem('crm_theme'));
}

/**
 * Aplica un tema por id: limpia clases de tema previas, agrega theme-<id> y
 * la clase dark-mode si es oscuro. Guarda la preferencia y refresca la UI.
 */
function applyTheme(id) {
    const theme = CRM_THEMES.find(t => t.id === id) || CRM_THEMES[0];
    const body = document.body;
    CRM_THEMES.forEach(t => body.classList.remove('theme-' + t.id));
    body.classList.add('theme-' + theme.id);
    body.classList.toggle('dark-mode', theme.isDark);
    localStorage.setItem('crm_theme', theme.id);
    updateDarkModeIcon();
    // Marca la tarjeta activa si el selector de Ajustes está montado.
    document.querySelectorAll('[data-theme-card]').forEach(el => {
        el.classList.toggle('theme-card-active', el.dataset.themeCard === theme.id);
    });
}

/** Selección desde el selector de Ajustes (alias claro para onclick). */
function setTheme(id) { applyTheme(id); }

/**
 * Botón de la cabecera: alterna rápido entre claro (último claro usado) y
 * oscuro (Obsidiana), conservando el tema claro preferido del usuario.
 */
function toggleDarkMode() {
    const current = getCurrentTheme();
    if (current === 'obsidian') {
        applyTheme(localStorage.getItem('crm_theme_light') || DEFAULT_THEME);
    } else {
        localStorage.setItem('crm_theme_light', current);
        applyTheme('obsidian');
    }
}

/** Actualiza el icono del botón de tema (sol/luna) según si el tema es oscuro. */
function updateDarkModeIcon() {
    const icon = document.getElementById('dark-mode-icon');
    if (icon) {
        const isDark = document.body.classList.contains('dark-mode');
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    }
}

/** Inicializa el tema al cargar la página. */
function initTheme() {
    const id = getCurrentTheme();
    if (!CRM_THEMES.find(t => t.id === id)?.isDark) {
        localStorage.setItem('crm_theme_light', id);
    }
    applyTheme(id);
}

// --- FIN NUEVO ---

// --- Make functions globally accessible ---

// Esto permite llamar a las funciones desde los atributos onclick en el HTML
window.navigateTo = navigateTo;
window.toggleTagSidebar = toggleTagSidebar;
window.toggleTagDropdown = toggleTagDropdown;
window.closeTagDropdown = closeTagDropdown;
window.toggleDeptDropdown = toggleDeptDropdown;
window.closeDeptDropdown = closeDeptDropdown;
window.toggleStatusDropdown = toggleStatusDropdown;
window.closeStatusDropdown = closeStatusDropdown;
window.switchContactPanelTab = switchContactPanelTab;

window.closeImageModal = closeImageModal;
window.openContactDetails = openContactDetails;
window.closeContactDetails = closeContactDetails;
window.openEditContactModal = openEditContactModal;
window.closeEditContactModal = closeEditContactModal;
window.openTagModal = openTagModal;
window.closeTagModal = closeTagModal;
window.openQuickReplyModal = openQuickReplyModal;
window.closeQuickReplyModal = closeQuickReplyModal;
window.openAdResponseModal = openAdResponseModal;
window.closeAdResponseModal = closeAdResponseModal;

window.openNewOrderModal = abrirModalPedido; 
window.closeNewOrderModal = cerrarModalPedido; 
window.cerrarModalPedido = cerrarModalPedido;
window.abrirModalPedido = abrirModalPedido;
window.closeConversationPreviewModal = closeConversationPreviewModal; 
window.openOrderEditModal = openOrderEditModal; 
window.closeOrderEditModal = closeOrderEditModal; 

// --- EXPORTAR NUEVAS FUNCIONES DE TEMA ---
window.toggleDarkMode = toggleDarkMode;
window.initTheme = initTheme;
window.applyTheme = applyTheme;
window.setTheme = setTheme;
window.getCurrentTheme = getCurrentTheme;
window.CRM_THEMES = CRM_THEMES;

// --- EXPORTAR NUEVAS FUNCIONES ---
window.openDepartmentModal = openDepartmentModal;
window.closeDepartmentModal = closeDepartmentModal;
window.openAdRoutingModal = openAdRoutingModal;
window.closeAdRoutingModal = closeAdRoutingModal;
window.openTransferModal = openTransferModal;
window.closeTransferModal = closeTransferModal;
// ---------------------------------

// --- Funciones del template que necesitan acceso global ---

window.copyFormattedText = copyFormattedText;
window.copyToClipboard = copyToClipboard;
window.setActiveTab = setActiveTab;
window.toggleEditNote = toggleEditNote;
window.updateCampaignRecipientCount = updateCampaignRecipientCount; // Definida en ui-manager
window.handleOrderStatusChange = handleOrderStatusChange; // Definida en ui-manager

// --- START SIMULADOR IA ---
let simulatorHistory = [];
let simulatorTokens = { input: 0, output: 0, cached: 0 };

function updateSimulatorTokenUI() {
    const inputEl = document.getElementById('simulator-input-tokens');
    const outputEl = document.getElementById('simulator-output-tokens');
    const cachedEl = document.getElementById('simulator-cached-tokens');
    const totalEl = document.getElementById('simulator-total-tokens');
    const costEl = document.getElementById('simulator-cost');
    const newInput = Math.max(0, simulatorTokens.input - simulatorTokens.cached);
    if (inputEl) inputEl.textContent = newInput.toLocaleString();
    if (outputEl) outputEl.textContent = simulatorTokens.output.toLocaleString();
    if (cachedEl) cachedEl.textContent = simulatorTokens.cached.toLocaleString();
    if (totalEl) totalEl.textContent = (simulatorTokens.input + simulatorTokens.output).toLocaleString();
    // Costos gemini-3-flash-preview (por 1M tokens)
    // Input: $0.50, Output: $3.00, Cached: $0.05 (90% descuento)
    const costInput = (newInput / 1_000_000) * 0.50;
    const costCached = (simulatorTokens.cached / 1_000_000) * 0.05;
    const costOutput = (simulatorTokens.output / 1_000_000) * 3.00;
    const totalCost = costInput + costCached + costOutput;
    if (costEl) costEl.textContent = '$' + totalCost.toFixed(6);
}

let simulatorAiTimer = null;
let simulatorCountdownInterval = null;
let simulatorCountdownValue = 20;

window.skipSimulatorTimer = function() {
    if (simulatorAiTimer) {
        clearTimeout(simulatorAiTimer);
        simulatorAiTimer = null;
    }
    if (simulatorCountdownInterval) {
        clearInterval(simulatorCountdownInterval);
        simulatorCountdownInterval = null;
    }
    const typingIndicator = document.getElementById('simulator-typing-indicator');
    if (typingIndicator) {
        const timerText = document.getElementById('simulator-timer-text');
        if (timerText) timerText.textContent = "Procesando...";
    }
    
    // Ejecutar inmediatamente
    processSimulatorAi();
};

async function processSimulatorAi() {
    const typingIndicator = document.getElementById('simulator-typing-indicator');
    
    // Clonar historial actual
    const historyCopy = [...simulatorHistory];
    
    // El último mensaje del usuario se pasa como "message" directo, no duplicarlo en "history"
    let lastUserIndex = -1;
    for (let i = historyCopy.length - 1; i >= 0; i--) {
        if (historyCopy[i].role === 'user') {
            lastUserIndex = i;
            break;
        }
    }
    
    if (lastUserIndex === -1) {
        if (typingIndicator) typingIndicator.classList.add('hidden');
        return;
    }

    const lastMessageObj = historyCopy[lastUserIndex];
    const lastMessageText = lastMessageObj.content;
    const lastMediaBase64 = lastMessageObj.mediaBase64;
    const lastMediaMimeType = lastMessageObj.mediaMimeType;
    historyCopy.splice(lastUserIndex, 1); // Quitar el último para que apiRoutes no lo duplique

    try {
        const response = await fetch(`${API_BASE_URL}/api/simulate-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: lastMessageText, mediaBase64: lastMediaBase64, mediaMimeType: lastMediaMimeType, history: historyCopy })
        });
        const data = await response.json();

        if (typingIndicator) typingIndicator.classList.add('hidden');

        if (data.success && data.response) {
            const messages = data.response.split('[SPLIT]').map(m => m.trim()).filter(m => m);
            
            // Acumular tokens
            simulatorTokens.input += (data.inputTokens || 0);
            simulatorTokens.output += (data.outputTokens || 0);
            simulatorTokens.cached += (data.cachedTokens || 0);
            updateSimulatorTokenUI();

            const assistId = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
            simulatorHistory.push({ id: assistId, role: 'assistant', content: data.response.replace(/\[SPLIT\]/g,"\\n") });

            // Renderizar cada parte con un pequeño retraso
            for (let i = 0; i < messages.length; i++) {
                if(i > 0) await new Promise(resolve => setTimeout(resolve, 800));
                const replyText = (data.shouldQuote && i === 0) ? lastMessageText : null;
                renderSimulatorMessage(messages[i], 'assistant', replyText, assistId);
            }
        } else {
            renderSimulatorMessage('Error: No se pudo obtener respuesta de la IA', 'error');
        }
    } catch (error) {
        console.error('Simulator error:', error);
        if (typingIndicator) typingIndicator.classList.add('hidden');
        renderSimulatorMessage(`Error: ${error.message || 'Error de conexión con el servidor'}`, 'error');
    }
}

let currentSimulatorMediaBase64 = null;
let currentSimulatorMediaMimeType = null;

window.handleSimulatorMediaUpload = function(event) {
    const file = event.target.files[0];
    if (file) processSimulatorMedia(file);
};

window.handleSimulatorDrop = function(event) {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        processSimulatorMedia(event.dataTransfer.files[0]);
    }
};

window.removeSimulatorMedia = function() {
    currentSimulatorMediaBase64 = null;
    currentSimulatorMediaMimeType = null;
    document.getElementById('simulator-media-preview-container').classList.add('hidden');
    document.getElementById('simulator-image-preview').src = '';
    document.getElementById('simulator-image-preview').classList.add('hidden');
    document.getElementById('simulator-audio-preview').src = '';
    document.getElementById('simulator-audio-preview').classList.add('hidden');
    document.getElementById('simulator-media-upload').value = '';
};

function processSimulatorMedia(file) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) {
        alert('Por favor selecciona un archivo de imagen o audio válido.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        currentSimulatorMediaBase64 = e.target.result;
        currentSimulatorMediaMimeType = file.type;
        
        if (file.type.startsWith('image/')) {
            document.getElementById('simulator-image-preview').src = currentSimulatorMediaBase64;
            document.getElementById('simulator-image-preview').classList.remove('hidden');
            document.getElementById('simulator-audio-preview').classList.add('hidden');
        } else if (file.type.startsWith('audio/')) {
            document.getElementById('simulator-audio-preview').src = currentSimulatorMediaBase64;
            document.getElementById('simulator-audio-preview').classList.remove('hidden');
            document.getElementById('simulator-image-preview').classList.add('hidden');
        }
        
        document.getElementById('simulator-media-preview-container').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

async function sendSimulatorMessage() {
    const input = document.getElementById('simulator-chat-input');
    const roleSelect = document.getElementById('simulator-role-select');
    const text = input.value.trim();
    // Allow ending message if there's text OR media
    if (!text && !currentSimulatorMediaBase64) return;

    const role = roleSelect ? roleSelect.value : 'user';
    const msgId = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

    // Save media before clearing
    const mediaToAttach = currentSimulatorMediaBase64;
    const mediaMimeType = currentSimulatorMediaMimeType;

    // Mostrar mensaje del usuario / agente inmediatamente
    renderSimulatorMessage(text, role, null, msgId, mediaToAttach, mediaMimeType);
    input.value = '';
    removeSimulatorMedia(); // Clear preview

    // Añadir al historial INMEDIATAMENTE
    let defaultContent = '📷 Imagen';
    if (mediaMimeType && mediaMimeType.startsWith('audio/')) {
        defaultContent = '🎵 Audio';
    }
    simulatorHistory.push({ id: msgId, role: role, content: text || defaultContent, mediaBase64: mediaToAttach, mediaMimeType: mediaMimeType });
    
    // Si el mensaje es del agente, no hacemos petición a la IA en su nombre
    if (role === 'assistant') {
        return;
    }

    // --- REPLICA EL DEBOUNCE DEL SERVIDOR (20 seg) ---
    if (simulatorAiTimer) {
        clearTimeout(simulatorAiTimer);
    }
    if (simulatorCountdownInterval) {
        clearInterval(simulatorCountdownInterval);
    }

    const typingIndicator = document.getElementById('simulator-typing-indicator');
    const timerText = document.getElementById('simulator-timer-text');
    
    if (typingIndicator) typingIndicator.classList.remove('hidden');
    
    simulatorCountdownValue = 20;
    if (timerText) timerText.textContent = `Esperando (${simulatorCountdownValue}s)`;

    simulatorCountdownInterval = setInterval(() => {
        simulatorCountdownValue--;
        if (simulatorCountdownValue > 0) {
            if (timerText) timerText.textContent = `Esperando (${simulatorCountdownValue}s)`;
        } else {
            clearInterval(simulatorCountdownInterval);
            if (timerText) timerText.textContent = "Procesando...";
        }
    }, 1000);

    simulatorAiTimer = setTimeout(async () => {
        simulatorAiTimer = null;
        clearInterval(simulatorCountdownInterval);
        await processSimulatorAi();
    }, 20000);
}

function formatSimulatorText(text) {
    return text
        .replace(/\\n/g, '<br>')
        .replace(/\n/g, '<br>')
        .replace(/```([\s\S]*?)```/g, '<code class="bg-gray-200 px-1 rounded text-sm">$1</code>')
        .replace(/\*([^*]+)\*/g, '<b>$1</b>')
        .replace(/_(.*?)_/g, '<i>$1</i>')
        .replace(/~(.*?)~/g, '<s>$1</s>');
}

function renderSimulatorMessage(text, sender, repliedToText = null, msgId = null, mediaBase64 = null, mediaMimeType = null) {
    const historyContainer = document.getElementById('simulator-chat-history');
    if (!historyContainer) return;

    let mediaHtml = '';
    if (mediaBase64) {
        if (mediaMimeType && mediaMimeType.startsWith('audio/')) {
            mediaHtml = `<audio controls src="${mediaBase64}" class="mb-1 w-full max-w-[200px] h-10 rounded-lg"></audio>`;
        } else {
            mediaHtml = `<img src="${mediaBase64}" class="rounded-lg mb-1 max-w-full cursor-pointer hover:opacity-90 transition-opacity" onclick="openImageModal('${mediaBase64}')">`;
        }
    }

    const msgDiv = document.createElement('div');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedText = formatSimulatorText(text);
    const deleteBtn = `<button class="sim-msg-delete" onclick="deleteSimulatorMessage(this)" title="Eliminar mensaje"><i class="fas fa-times"></i></button>`;
    if (sender === 'user') {
        msgDiv.className = 'flex justify-end sim-msg-wrapper';
        if (msgId) msgDiv.setAttribute('data-msg-id', msgId);
        msgDiv.innerHTML = `<div class="bg-[#d9fdd3] text-[#111b21] rounded-lg rounded-tr-sm px-3 py-2 max-w-[85%] shadow-sm relative sim-msg-bubble">${deleteBtn}${mediaHtml}<span class="break-words text-[15px]">${formattedText}</span><span class="text-[11px] text-gray-500 float-right ml-2 mt-1">${time} <i class="fas fa-check-double text-[#53bdeb]"></i></span></div>`;
    } else if (sender === 'assistant') {
        msgDiv.className = 'flex justify-start sim-msg-wrapper';
        if (msgId) msgDiv.setAttribute('data-msg-id', msgId);
        let replyHtml = '';
        if (repliedToText) {
            replyHtml = `<div class="bg-black/5 border-l-4 border-purple-500 rounded p-1 mb-1 text-xs text-gray-600 max-w-full overflow-hidden"><span class="text-purple-600 font-semibold block">Cliente</span><span class="truncate block">${repliedToText}</span></div>`;
        }
        msgDiv.innerHTML = `<div class="bg-white text-[#111b21] rounded-lg rounded-tl-sm px-3 py-2 max-w-[85%] shadow-sm relative sim-msg-bubble">${deleteBtn}${replyHtml}${mediaHtml}<span class="break-words text-[15px]">${formattedText}</span><span class="text-[11px] text-gray-500 float-right ml-2 mt-1">${time}</span></div>`;
    } else {
        msgDiv.className = 'flex justify-center';
        msgDiv.innerHTML = `<div class="bg-red-100 text-red-600 rounded-lg px-3 py-1 text-xs shadow-sm">${text}</div>`;
    }

    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
}

function deleteSimulatorMessage(btnElement) {
    const msgWrapper = btnElement.closest('.sim-msg-wrapper');
    if (!msgWrapper) return;
    
    const msgId = msgWrapper.getAttribute('data-msg-id');
    
    // Eliminar del historial de mensajes
    if (msgId) {
        const index = simulatorHistory.findIndex(m => m.id === msgId);
        if (index > -1) {
            simulatorHistory.splice(index, 1);
        }
    }
    
    // Eliminar del DOM (si hay varios mensajes con el mismo ID por culpa del [SPLIT], borramos todos)
    if (msgId) {
        document.querySelectorAll(`.sim-msg-wrapper[data-msg-id="${msgId}"]`).forEach(el => el.remove());
    } else {
        msgWrapper.remove();
    }
}
window.deleteSimulatorMessage = deleteSimulatorMessage;

function clearSimulatorChat() {
    simulatorHistory = [];
    simulatorTokens = { input: 0, output: 0, cached: 0 };
    updateSimulatorTokenUI();
    const historyContainer = document.getElementById('simulator-chat-history');
    if (historyContainer) {
        historyContainer.innerHTML = `
            <div class="text-center my-4">
                <span class="bg-[#e1f3fb] text-[#1f2937] text-xs px-3 py-1 rounded-lg inline-block shadow-sm">
                    <i class="fas fa-lock mr-1"></i> Los mensajes y llamadas están cifrados de extremo a extremo.
                </span>
            </div>
        `;
    }
}

window.sendSimulatorMessage = sendSimulatorMessage;
window.clearSimulatorChat = clearSimulatorChat;
// --- FIN SIMULADOR IA ---
window.loadAdIdMetrics = loadAdIdMetrics; // Definida en ui-manager
window.clearAdIdMetricsFilter = clearAdIdMetricsFilter; // Definida en ui-manager

// --- START: AI TIMER FOR NORMAL CHATS ---

window.skipAiWait = async function() {
    const contactId = state.selectedContactId;
    if (!contactId) return;

    const timerText = document.getElementById('ai-timer-text');
    if (timerText) timerText.textContent = "Saltando...";

    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/skip-ai`, {
            method: 'POST'
        });
        const data = await response.json();
        if (data.success) {
            // Actualizar localmente para esconder el indicador de inmediato
            const contact = state.contacts.find(c => c.id === contactId);
            if (contact) delete contact.aiNextRun;
            checkAiTimer();
        } else {
            console.warn("[AI] No se pudo saltar el timer:", data.message);
            if (timerText) timerText.textContent = "Error";
            setTimeout(checkAiTimer, 2000);
        }
    } catch (error) {
        console.error("[AI] Error saltando el timer:", error);
    }
};

function checkAiTimer() {
    if (aiCountdownInterval) {
        clearInterval(aiCountdownInterval);
        aiCountdownInterval = null;
    }

    const contactId = state.selectedContactId;
    if (!contactId || (state.activeView !== 'chats' && !state.chatModalOpen)) {
        const indicator = document.getElementById('ai-typing-indicator');
        if (indicator) indicator.classList.add('hidden');
        return;
    }

    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact) return; 

    const indicator = document.getElementById('ai-typing-indicator');
    const timerText = document.getElementById('ai-timer-text');
    const spacer = document.getElementById('ai-typing-spacer');
    const skipBtn = document.getElementById('ai-skip-btn');
    const cancelBtn = document.getElementById('ai-cancel-btn');

    // 1. Caso: AI está generando realmente (procesando el mensaje)
    if (contact.aiStatus === 'generating') {
        if (indicator && timerText) {
            indicator.classList.remove('hidden');
            if (spacer) spacer.classList.remove('hidden');
            timerText.textContent = `Generando respuesta...`;
            if (skipBtn) skipBtn.classList.add('hidden');
            if (cancelBtn) cancelBtn.classList.remove('hidden');
        }
        return;
    }

    // 2. Caso: Cuenta regresiva (esperando a que el usuario termine de escribir)
    if (!contact.aiNextRun || !indicator || !timerText) {
        if (indicator) indicator.classList.add('hidden');
        if (spacer) spacer.classList.add('hidden');
        return;
    }

    if (skipBtn) skipBtn.classList.remove('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');

    const updateCountdown = () => {
        const now = new Date();
        const diff = Math.ceil((contact.aiNextRun - now) / 1000);

        if (diff <= 0) {
            if (contact.aiStatus !== 'generating') {
                indicator.classList.add('hidden');
                if (spacer) spacer.classList.add('hidden');
            }
            clearInterval(aiCountdownInterval);
            aiCountdownInterval = null;
        } else {
            const wasHidden = indicator.classList.contains('hidden');
            indicator.classList.remove('hidden');
            if (spacer) spacer.classList.remove('hidden');
            timerText.textContent = `Esperando (${diff}s)`;
            
            if (wasHidden) {
                const container = document.getElementById('messages-container');
                if (container) {
                    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
                    if (isNearBottom || container.scrollHeight < container.clientHeight * 2) {
                        container.scrollTop = container.scrollHeight;
                    }
                }
            }
        }
    };

    updateCountdown();
    aiCountdownInterval = setInterval(updateCountdown, 1000);
}

// Nueva función para cancelar la IA
async function cancelAiResponse() {
    const contactId = state.selectedContactId;
    if (!contactId) return;

    try {
        // Actualización optimista
        const indicator = document.getElementById('ai-typing-indicator');
        if (indicator) indicator.classList.add('hidden');
        
        const contact = state.contacts.find(c => c.id === contactId);
        if (contact) {
            delete contact.aiStatus;
            delete contact.aiNextRun;
        }

        await fetch(`/api/wa/contacts/${contactId}/cancel-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("Error al cancelar IA:", error);
    }
}
window.cancelAiResponse = cancelAiResponse;

// Escuchar cambios en la vista para detener/iniciar el timer
window.addEventListener('popstate', checkAiTimer);
// Envolver navigateTo para llamar a checkAiTimer
const originalNavigateTo = window.navigateTo;
window.navigateTo = function(...args) {
    const res = originalNavigateTo.apply(this, args);
    setTimeout(checkAiTimer, 100);
    return res;
};

// Exportar para que otros módulos puedan lanzarlo
window.checkAiTimer = checkAiTimer;
// --- END: AI TIMER FOR NORMAL CHATS ---

/**
 * Actualiza el contenido del badge de pedidos diarios en el header.
 * Si el conteo es 0, oculta el badge.
 * @param {number} count El número de pedidos registrados hoy.
 */
function actualizarBadgePedidosHoy(count) {
    const badge = document.getElementById('header-daily-orders-badge');
    if (!badge) return;

    badge.textContent = count;
    
    // Si hay pedidos, mostrar el badge; si no, ocultarlo
    if (count > 0) {
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }

    // Efecto de animación jumpy cuando cambia el número (opcional, ya tiene la animación de pop por CSS al aparecer)
}

// --- TRAFFIC STATS BADGE (temporal) ---
(function initTrafficBadge() {
    const badge = document.getElementById('traffic-badge');
    const timer = document.getElementById('traffic-timer');
    if (!badge) return;
    let localRemaining = 0;
    async function update() {
        try {
            const res = await fetch('/api/traffic-stats');
            const data = await res.json();
            badge.textContent = data.current.count;
            badge.style.display = 'inline-block';
            localRemaining = data.current.remainingSeconds;
            updateTimer();
            if (timer) timer.style.display = 'inline-block';
        } catch (e) { /* ignore */ }
    }
    function updateTimer() {
        if (!timer) return;
        const m = Math.floor(localRemaining / 60);
        const s = localRemaining % 60;
        timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
    update();
    setInterval(update, 30000);
    setInterval(() => { if (localRemaining > 0) { localRemaining--; updateTimer(); } }, 1000);
    badge.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/traffic-stats');
            const data = await res.json();
            const lines = data.history.map(h => `${h.date} ${h.from}-${h.to}: ${h.count} req`).join('\n');
            alert(`Ventana actual: ${data.current.count} req (restan ${Math.floor(data.current.remainingSeconds/60)}:${String(data.current.remainingSeconds%60).padStart(2,'0')})\n\nHistorial:\n${lines || 'Sin datos aún'}`);
        } catch (e) { alert('Error al obtener stats'); }
    });
})();

/**
 * Cierra la ventana de chat en móviles para volver a la lista de contactos.
 */
function closeChatOnMobile() {
    state.selectedContactId = null;
    const chatView = document.getElementById('chat-view');
    if (chatView) {
        chatView.classList.remove('contact-selected');
    }
    document.body.classList.remove('chat-open');
    // Opcional: Re-renderizar para limpiar el estado visual si es necesario
    // renderChatWindow();
}

window.actualizarBadgePedidosHoy = actualizarBadgePedidosHoy;
window.closeChatOnMobile = closeChatOnMobile;
window.toggleTagSidebar = toggleTagSidebar;

// =====================================================================
// === TRACKING DE CAMPAÑAS — render, modal de campaña, helpers       ===
// =====================================================================

/**
 * Calcula KPIs por plantilla para una campaña, leyendo de state.pedidosConCampana.
 * Devuelve plantillas[] + totales.
 */
function getKPIsForCampana(campana) {
    const pedidosCampana = state.pedidosConCampana.filter(p => p.campana_id === campana.id);
    const plantillasDeclaradas = Object.keys(campana.plantillas || {});
    const plantillasEnPedidos = Array.from(new Set(pedidosCampana.map(p => p.plantilla_origen || '(sin plantilla)')));
    const allPlantillas = Array.from(new Set([...plantillasDeclaradas, ...plantillasEnPedidos]));

    const plantillas = allPlantillas.map(p => {
        const pedidosPlantilla = pedidosCampana.filter(x => (x.plantilla_origen || '(sin plantilla)') === p);
        const pagados = pedidosPlantilla.filter(x => x.estatus === 'Pagado');
        const monto = pagados.reduce((s, x) => s + (x.precio || 0), 0);
        const contactados = campana.plantillas?.[p]?.contactados ?? 0;
        return { plantilla: p, contactados, pedidos: pedidosPlantilla.length, pagados: pagados.length, monto };
    });

    return {
        plantillas,
        totalContactados: plantillas.reduce((s, k) => s + k.contactados, 0),
        totalPedidos: plantillas.reduce((s, k) => s + k.pedidos, 0),
        totalPagados: plantillas.reduce((s, k) => s + k.pagados, 0),
        totalMonto: plantillas.reduce((s, k) => s + k.monto, 0)
    };
}

function renderConversionCampanasView() {
    if (state.activeView !== 'conversion-campanas' && state.activeView !== 'campanas') return;
    const container = document.getElementById('conversion-campanas-list');
    if (!container) return;

    if (!state.campanasList || state.campanasList.length === 0) {
        container.innerHTML = `
            <div style="background:#f8f9fa;border-radius:12px;padding:48px;text-align:center;">
                <i class="fas fa-bullhorn" style="font-size:48px;color:#cbd5e1;"></i>
                <p style="margin-top:12px;color:#6b7280;font-size:14px;">No hay campañas todavía.</p>
                <p style="font-size:12px;color:#9ca3af;">Crea una para empezar a medir conversión por plantilla.</p>
            </div>
        `;
        return;
    }

    // Auto-expandir activas si es la primera carga
    if (Object.keys(state.campanaExpandState).length === 0) {
        state.campanasList.forEach(c => {
            if (c.estatus === 'activa') state.campanaExpandState[c.id] = true;
        });
    }

    container.innerHTML = state.campanasList.map(c => {
        const kpis = getKPIsForCampana(c);
        return CampanaCardTemplate(c, kpis);
    }).join('');
}

function toggleCampanaExpand(id) {
    state.campanaExpandState[id] = !state.campanaExpandState[id];
    renderConversionCampanasView();
}

// --- Modal crear/editar campaña ---
function openCampanaFormModal(campanaId) {
    const campana = campanaId ? state.campanasList.find(c => c.id === campanaId) : null;
    const container = document.getElementById('campana-form-modal-container');
    if (!container) return;
    container.innerHTML = CampanaFormModalTemplate(campana);
    const form = document.getElementById('campana-form');
    if (form) form.addEventListener('submit', handleSaveCampana);
}

function closeCampanaFormModal() {
    const container = document.getElementById('campana-form-modal-container');
    if (container) container.innerHTML = '';
}

function addCampanaPlantillaRow() {
    const container = document.getElementById('campana-plantillas-container');
    if (!container) return;
    const idx = container.children.length;
    const html = `
        <div class="campana-plantilla-row" data-row-idx="${idx}" style="display:grid;grid-template-columns:5fr 2fr auto 4fr auto;gap:8px;align-items:center;padding:8px;background:#f8f9fa;border-radius:8px;margin-bottom:8px;">
            <input type="text" class="campana-plantilla-nombre" value="" placeholder="Nombre plantilla" list="meta-templates-list" autocomplete="off" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
            <input type="number" min="0" class="campana-plantilla-contactados" value="0" placeholder="0" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
            <button type="button" onclick="detectContactadosForRow(this)" title="Detectar automaticamente cuantos contactos recibieron esta plantilla en el rango de fechas" style="background:#81B29A;border:none;color:white;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:4px;white-space:nowrap;">
                <i class="fas fa-search"></i> Detectar
            </button>
            <input type="text" class="campana-plantilla-notas" value="" placeholder="Notas (opcional)" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
            <button type="button" onclick="removeCampanaPlantillaRow(this)" style="background:none;border:none;color:#6b7280;cursor:pointer;padding:6px;" title="Quitar"><i class="fas fa-trash"></i></button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
}

function removeCampanaPlantillaRow(btn) {
    const row = btn.closest('.campana-plantilla-row');
    if (row) row.remove();
}

// --- Helpers para los selectores de campaña dentro del modal de pedido (crear/editar) ---
// `isEdit` = true → modal de edición (IDs con prefijo "edit"); false → modal de creación
function togglePedidoCampanaSection(isEdit) {
    const cbId = isEdit ? 'editPedidoVieneDeCampana' : 'pedidoVieneDeCampana';
    const wrapId = isEdit ? 'editPedidoCampanaSelectors' : 'pedidoCampanaSelectors';
    const cb = document.getElementById(cbId);
    const wrap = document.getElementById(wrapId);
    if (!cb || !wrap) return;
    if (cb.checked) {
        wrap.style.display = 'grid';
        // Poblar selectores de campañas activas si están vacíos
        populateCampanaSelectorsInOrderModal(isEdit);
    } else {
        wrap.style.display = 'none';
    }
}

// Cache de plantillas Meta para el selector del modal (1h)
let _metaPlantillasCache = null;
let _metaPlantillasCachedAt = 0;
const META_PLANTILLAS_TTL_MS = 60 * 60 * 1000;

async function _fetchMetaPlantillasParaModal() {
    if (_metaPlantillasCache && (Date.now() - _metaPlantillasCachedAt) < META_PLANTILLAS_TTL_MS) {
        return _metaPlantillasCache;
    }
    try {
        const res = await fetch('/api/whatsapp-templates');
        const data = await res.json();
        if (data?.success && Array.isArray(data.templates)) {
            _metaPlantillasCache = data.templates;
            _metaPlantillasCachedAt = Date.now();
            console.log('[OrderModal/clásico] plantillas Meta cargadas:', data.templates.length);
            return data.templates;
        }
        console.warn('[OrderModal/clásico] respuesta sin templates:', data);
    } catch (e) {
        console.warn('[OrderModal/clásico] error cargando plantillas:', e);
    }
    return [];
}

async function populateCampanaSelectorsInOrderModal(isEdit) {
    const campId = isEdit ? 'editPedidoCampanaId' : 'pedidoCampanaId';
    const sel = document.getElementById(campId);
    if (!sel) return;
    // Conserva el valor seleccionado si existe
    const prevValue = sel.value;
    const activas = (state.campanasList || []).filter(c => c.estatus === 'activa');

    // Cargar plantillas Meta como campañas virtuales (no bloquea: primer render usa
    // cache si existe; si no, render con solo reales y luego refresca al llegar la data)
    const metaPlantillas = _metaPlantillasCache || [];
    const usedNames = new Set();
    activas.forEach(c => Object.keys(c.plantillas || {}).forEach(p => usedNames.add(p)));
    const virtuales = metaPlantillas
        .filter(t => !usedNames.has(t.name))
        .map(t => ({
            id: 'tpl:' + t.name,
            nombre: '📨 ' + t.name,
            estatus: 'activa',
            plantillas: { [t.name]: { contactados: 0, notas: '' } }
        }));

    const todas = [...activas, ...virtuales];
    if (todas.length === 0) {
        sel.innerHTML = '<option value="">Cargando plantillas...</option>';
    } else {
        sel.innerHTML = '<option value="">Seleccionar campaña...</option>' +
            todas.map(c => `<option value="${escapeHtmlSafe(c.id)}" ${prevValue === c.id ? 'selected' : ''}>${escapeHtmlSafe(c.nombre)}</option>`).join('');
    }
    onPedidoCampanaChange(isEdit, true);

    // Si no estaba en cache aún, hacer fetch y re-render una vez resuelva
    if (!_metaPlantillasCache) {
        const fresh = await _fetchMetaPlantillasParaModal();
        if (fresh.length && document.getElementById(campId)) {
            // Re-render con la data nueva (sólo si el modal sigue abierto)
            populateCampanaSelectorsInOrderModal(isEdit);
        } else if (!fresh.length && todas.length === 0) {
            sel.innerHTML = '<option value="">Sin campañas activas</option>';
        }
    }
}

function onPedidoCampanaChange(isEdit, preserveSelectedPlantilla) {
    const campId = isEdit ? 'editPedidoCampanaId' : 'pedidoCampanaId';
    const plantId = isEdit ? 'editPedidoPlantillaOrigen' : 'pedidoPlantillaOrigen';
    const sel = document.getElementById(campId);
    const plant = document.getElementById(plantId);
    if (!sel || !plant) return;
    const prevPlantilla = preserveSelectedPlantilla ? plant.value : '';
    const selVal = sel.value;

    // Campañas virtuales tpl:<templateName> → la plantilla origen es la misma plantilla
    if (selVal && selVal.startsWith('tpl:')) {
        const tplName = selVal.slice(4);
        plant.innerHTML = `<option value="${escapeHtmlSafe(tplName)}" selected>${escapeHtmlSafe(tplName)}</option>`;
        return;
    }

    const camp = (state.campanasList || []).find(c => c.id === selVal);
    const keys = camp ? Object.keys(camp.plantillas || {}) : [];
    if (keys.length === 0) {
        plant.innerHTML = '<option value="">Elige campaña primero</option>';
    } else {
        plant.innerHTML = '<option value="">Seleccionar plantilla...</option>' +
            keys.map(k => `<option value="${escapeHtmlSafe(k)}" ${prevPlantilla === k ? 'selected' : ''}>${escapeHtmlSafe(k)}</option>`).join('');
    }
}

// Llamada por el listener de campañas cuando cambian (para refrescar dropdowns si el modal está abierto)
function refreshCampanaSelectorsInOpenOrderModal() {
    if (document.getElementById('pedidoCampanaId')) {
        populateCampanaSelectorsInOrderModal(false);
    }
    if (document.getElementById('editPedidoCampanaId')) {
        populateCampanaSelectorsInOrderModal(true);
    }
}

// Para pre-llenar campos al EDITAR un pedido que ya tiene campana_id/plantilla_origen.
// Se llama desde openOrderEditModal() después de poblar el resto.
function prefillEditOrderCampaign(order) {
    const cb = document.getElementById('editPedidoVieneDeCampana');
    if (!cb) return;
    if (order.campana_id) {
        cb.checked = true;
        const wrap = document.getElementById('editPedidoCampanaSelectors');
        if (wrap) wrap.style.display = 'grid';
        populateCampanaSelectorsInOrderModal(true);
        const camp = document.getElementById('editPedidoCampanaId');
        if (camp) {
            // Si la campaña ya está cerrada y no aparece en activas, agregar manualmente
            if (!Array.from(camp.options).some(o => o.value === order.campana_id)) {
                const camHistorico = state.campanasList.find(c => c.id === order.campana_id);
                const label = camHistorico ? `${camHistorico.nombre} (cerrada)` : `(campaña ${order.campana_id.slice(0,6)})`;
                const opt = document.createElement('option');
                opt.value = order.campana_id;
                opt.textContent = label;
                camp.appendChild(opt);
            }
            camp.value = order.campana_id;
        }
        onPedidoCampanaChange(true, false);
        const plant = document.getElementById('editPedidoPlantillaOrigen');
        if (plant && order.plantilla_origen) {
            // Si la plantilla no está en la lista (campaña ajustada), agregarla manualmente
            if (!Array.from(plant.options).some(o => o.value === order.plantilla_origen)) {
                const opt = document.createElement('option');
                opt.value = order.plantilla_origen;
                opt.textContent = order.plantilla_origen;
                plant.appendChild(opt);
            }
            plant.value = order.plantilla_origen;
        }
    } else {
        cb.checked = false;
    }
}

function escapeHtmlSafe(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

window.toggleCampanaExpand = toggleCampanaExpand;
window.openCampanaFormModal = openCampanaFormModal;
window.closeCampanaFormModal = closeCampanaFormModal;
window.addCampanaPlantillaRow = addCampanaPlantillaRow;
window.removeCampanaPlantillaRow = removeCampanaPlantillaRow;
window.togglePedidoCampanaSection = togglePedidoCampanaSection;
window.onPedidoCampanaChange = onPedidoCampanaChange;
window.populateCampanaSelectorsInOrderModal = populateCampanaSelectorsInOrderModal;
window.refreshCampanaSelectorsInOpenOrderModal = refreshCampanaSelectorsInOpenOrderModal;
window.prefillEditOrderCampaign = prefillEditOrderCampaign;
window.renderConversionCampanasView = renderConversionCampanasView;
window.getKPIsForCampana = getKPIsForCampana;
