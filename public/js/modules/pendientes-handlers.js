// =================================================================================================
// === Sección "Pendientes" ========================================================================
// =================================================================================================
// Tablero hermano de "Pendientes de Diseño". Ahí van los pendientes del equipo de diseño (Erika);
// aquí los demás (Lupita), por categorías que lee GET /api/pendientes:
//
//   Mandar video      -> el cliente pidió video de su lámpara. La tarjeta trae el mockup que aprobó
//                        y el botón "Diseñar con IA" (la pieza casi siempre hay que cortarla antes).
//   Falta mockup      -> pedido 'Sin estatus' sin preview. Antes salía en Pendientes de Diseño.
//   Apoyo humano      -> conversaciones marcadas como urgentes (la IA no pudo con el cliente).
//   Cola IA +1h       -> contactos atorados en "Pendientes IA" que YA tienen pedido: son cambios
//                        confirmados por el cliente que faltan de aplicar.
//   IA no registró    -> lo grave: la IA cerró la venta y el pedido nunca se creó.
//
// Cada columna se resuelve con su propia acción y la tarjeta desaparece sin recargar todo (se quita
// del cache local). El backend es quien decide qué entra en cada columna; aquí solo se pinta.

const PEND_COLS = [
    ['pago_revision', 'Comprobante por revisar', '#d97706', 'fa-receipt'],
    ['pago_cancelado', 'Pago en pedido cancelado', '#dc2626', 'fa-circle-exclamation'],
    ['pago_formulario', 'Formulario por enviar', '#2563eb', 'fa-file-lines'],
    ['corregir', 'Corregir', '#ea580c', 'fa-screwdriver-wrench'],
    ['video', 'Mandar video', '#e83e8c', 'fa-video'],
    ['mockup', 'Falta mockup', '#6f42c1', 'fa-wand-magic-sparkles'],
    ['sospechoso', 'Comprobante sospechoso', '#ea580c', 'fa-receipt'],
    ['atencion', 'Apoyo humano', '#0ea5e9', 'fa-hand'],
    ['ia_cola', 'Cola IA +1h', '#f59e0b', 'fa-hourglass-half'],
    ['ia_sin_pedido', 'IA no registró el pedido', '#dc2626', 'fa-triangle-exclamation'],
];
const PEND_ORDER_COLS = ['video', 'mockup', 'corregir'];

// Por qué la conversación pide un humano (campo needsAttentionReason del contacto).
const PEND_ATTN_REASONS = {
    ai_off: 'La IA está apagada y el cliente escribió',
    equipo: 'El cliente pidió algo que la IA no puede dar',
    pago_sin_comprobante: 'Dice que pagó y no mandó comprobante',
    pago_no_registrado: 'Dice que pagó y no encontramos el pago',
    // Lo pone el barrido de server/monitoring/mensajesSinAtender.js: con la IA encendida no salió
    // nada después del mensaje del cliente. Si aparece, algo del sistema falló.
    sin_respuesta: 'La IA estaba encendida y aun así nadie contestó',
};

const PEND_CSS = `
<style>
.pd-board,.pd-board *{box-sizing:border-box}
.pd-board{display:grid;grid-template-columns:236px minmax(0,1fr);gap:20px;min-width:0;align-items:stretch}
.pd-category-nav{min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:4px;background:var(--color-subtle-bg,#f8fafc);border:1px solid var(--color-border,#e5e7eb);border-radius:12px}
.pd-nav-label{padding:10px 10px 6px;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-light,#64748b);font-weight:700}
.pd-category-btn{display:flex;align-items:center;gap:9px;width:100%;text-align:left;min-height:45px;padding:10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--color-text,#334155);font:inherit;font-size:.84rem;line-height:1.35;cursor:pointer}
.pd-category-btn>i{width:16px;flex-shrink:0;text-align:center;color:var(--pd-color)}
.pd-category-label{flex:1;min-width:0;overflow-wrap:anywhere}
.pd-category-btn:hover{background:var(--color-container-bg,#fff)}
.pd-category-btn[aria-pressed="true"]{background:var(--color-container-bg,#fff);border-color:var(--color-border,#d1d5db);box-shadow:0 1px 3px #0000000a;font-weight:800}
.pd-category-btn[aria-pressed="true"] .pd-col-count{background:var(--color-primary,#466451);color:#fff}
.pd-category-btn:focus-visible,.pd-btn:focus-visible{outline:2px solid var(--color-primary,#466451);outline-offset:2px}
.pd-panels{min-width:0;min-height:0;display:flex}
.pd-col{width:100%;min-width:0;background:var(--color-subtle-bg,#f8fafc);border:1px solid var(--color-border,#e5e7eb);border-radius:12px;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.pd-col[hidden]{display:none}
.pd-col-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px;flex-shrink:0;border-top:3px solid var(--pd-color)}
.pd-col-title{font-weight:800;font-size:1.05rem;display:flex;align-items:center;gap:8px;margin:0;min-width:0;overflow-wrap:anywhere;color:var(--pd-color)}
.pd-col-count{background:var(--color-border,#e5e7eb);color:var(--color-text,#334155);font-size:.75rem;font-weight:700;border-radius:999px;padding:2px 8px;flex-shrink:0}
.pd-col-list{flex:1;min-height:0;overflow-y:auto;padding:0 14px 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr));align-content:start;align-items:start;gap:12px;scrollbar-gutter:stable}
.pd-card{min-width:0;overflow-wrap:anywhere;background:var(--color-container-bg,#fff);border:1px solid var(--color-border,#e5e7eb);border-radius:10px;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.pd-card-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:9px}
.pd-card-num{font-weight:800;color:var(--color-primary);cursor:pointer;font-size:.95rem;min-width:0}
.pd-card-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.pd-icon-btn{border:none;background:transparent;color:#0ea5e9;cursor:pointer;font-size:16px;padding:4px}
.pd-card-datos{font-weight:600;font-size:.9rem;line-height:1.45;margin-bottom:4px}
.pd-card-sub{font-size:.82rem;line-height:1.45;color:var(--color-text-light,#64748b);margin-bottom:6px;word-break:break-word}
.pd-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:9px}
.pd-note{width:100%;min-height:58px;max-height:160px;font-size:13px;line-height:1.45;padding:8px 10px;border:1px solid var(--color-border,#e5e7eb);border-radius:7px;resize:vertical;background:var(--color-surface,#fff);color:var(--color-text,#334155);margin-top:10px}
.pd-thumb{width:64px;height:64px;object-fit:cover;border-radius:7px;cursor:zoom-in;border:1px solid var(--color-border,#e5e7eb);flex:0 0 auto}
.pd-age{font-size:11px;font-weight:700;padding:2px 6px;border-radius:5px}
.pd-btn{padding:7px 10px;font-size:12px;line-height:1.35;border-radius:7px;font-weight:700;cursor:pointer;white-space:normal;border:none;max-width:100%}
.pd-btn-ghost{background:transparent;border:1px solid var(--color-border,#e5e7eb);color:var(--color-text,#334155)}
.pd-empty{grid-column:1/-1;color:var(--color-text-light,#64748b);font-size:.95rem;text-align:center;padding:50px 16px}
@media(max-width:760px){
    .pd-board{grid-template-columns:minmax(0,1fr);gap:14px;height:auto!important}
    .pd-category-nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));overflow:visible;gap:4px}
    .pd-nav-label{grid-column:1/-1}
    .pd-category-btn{font-size:.78rem;gap:6px;padding:8px}
    .pd-col-list{overflow:visible;grid-template-columns:minmax(0,1fr);scrollbar-gutter:auto}
    .pd-col-head{padding:14px}
}
/* Burbuja "el cliente te respondió" (a TI, no a la IA): igual que en Pendientes de Diseño. */
.pd-resp{display:inline-flex;align-items:center;gap:3px;background:#16a34a;color:#fff;border:none;border-radius:999px;padding:2px 7px;font-size:10.5px;font-weight:800;cursor:pointer;line-height:1.5;animation:pdPulse 2s infinite}
@keyframes pdPulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.55)}70%{box-shadow:0 0 0 6px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}
</style>`;

function PendientesViewTemplate() {
    return `<div id="pendientes-view" class="p-4 md:p-6 h-full overflow-auto">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:4px">
            <h1 class="text-2xl font-bold" style="margin:0"><i class="fas fa-clipboard-check mr-2" style="color:#0ea5e9"></i>Pendientes</h1>
            <span id="pend-updated" style="font-size:.75rem;color:var(--color-text-light,#94a3b8)"></span>
            <span id="pend-live" role="status" style="font-size:.75rem;color:#15803d">Conectando…</span>
            <button onclick="renderPendientesView()" class="btn btn-outline btn-sm" title="Actualizar" aria-label="Actualizar pendientes" style="margin-left:auto"><i class="fas fa-rotate"></i></button>
        </div>
        <p class="text-sm text-gray-500 mb-4">Elige una categoría para atender sus pendientes.
            <span>Revisa el comprobante o el chat antes de aprobar un pago. En las demás tarjetas, <b>Ctrl+Z</b> deshace la última acción.</span></p>
        <div id="pendientes-container"></div>
    </div>`;
}
window.PendientesViewTemplate = PendientesViewTemplate;

// "hace 5 min" / "hace 3 h" / "hace 2 d" a partir de un timestamp en ms.
function pendHace(ms) {
    if (!ms) return '';
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} d`;
}

// Etiqueta de antigüedad: se pone ámbar pasadas 24 h y roja pasados 3 días (lo viejo salta a la vista).
function pendAgeBadge(ms, label) {
    if (!ms) return '';
    const d = (Date.now() - ms) / 86400000;
    const col = d >= 3 ? '#dc2626' : d >= 1 ? '#b45309' : '#94a3b8';
    return `<span class="pd-age" style="background:${col}18;color:${col}">${escapeHtml((label ? label + ' ' : '') + pendHace(ms))}</span>`;
}

function pendChanIcon(ch) {
    return ch === 'instagram' ? '<i class="fab fa-instagram" style="color:#e1306c"></i>'
        : ch === 'messenger' ? '<i class="fab fa-facebook-messenger" style="color:#0084ff"></i>'
        : '<i class="fab fa-whatsapp" style="color:#25d366"></i>';
}

const _pendDrafts = new Map();
let _pendRequest = null, _pendDataVersion = 0;
let _pendCategory = 'pago_revision';
const _pendCategoryScroll = new Map();

function _pendCancelRefresh() {
    _pendDataVersion++;
    if (_pendRequest) _pendRequest.controller.abort();
    _pendRequest = null;
}

// Una sola consulta en vuelo. Un cambio durante la consulta pide otra al terminar.
async function renderPendientesView(silent) {
    const container = document.getElementById('pendientes-container');
    if (!container) return;
    if (typeof _pendStartLive === 'function') _pendStartLive();
    if (_pendRequest) { _pendRequest.again = true; return _pendRequest.promise; }
    if (!container.querySelector('.pd-board')) container.innerHTML = '<p class="text-gray-500">Cargando…</p>';
    const request = { controller: new AbortController(), version: _pendDataVersion, again: false };
    _pendRequest = request;
    request.promise = (async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/pendientes`, { signal: request.controller.signal });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || ('HTTP ' + res.status));
            if (request !== _pendRequest || container !== document.getElementById('pendientes-container')) return;
            if (request.version !== _pendDataVersion) { request.again = true; return; }
            window._pendData = data.buckets || {};
            _paintPendientes();
            if (typeof _pendFetchHealth === 'function') _pendFetchHealth(true);
            if (typeof _pendSyncVisibleDocs === 'function') _pendSyncVisibleDocs(window._pendData);
            const upd = document.getElementById('pend-updated');
            if (upd) upd.textContent = 'actualizado ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (e) {
            if (request.controller.signal.aborted || request !== _pendRequest) return;
            if (typeof _pendFetchHealth === 'function') _pendFetchHealth(false);
            // Conservar tarjetas y borradores si se corta la conexión.
            const upd = document.getElementById('pend-updated');
            if (upd) upd.textContent = 'Sin conexión; reintentando…';
            if (!container.querySelector('.pd-board')) container.innerHTML = `<p style="color:#991b1b">No se pudieron cargar los pendientes: ${escapeHtml(e.message || String(e))}</p><button class="btn btn-outline btn-sm mt-2" onclick="renderPendientesView()">Reintentar</button>`;
            request.again = true;
        } finally {
            if (request === _pendRequest) {
                _pendRequest = null;
                if (request.again && typeof _pendScheduleRefresh === 'function') _pendScheduleRefresh();
            }
        }
    })();
    return request.promise;
}
window.renderPendientesView = renderPendientesView;

// --- Tarjetas -------------------------------------------------------------------------------
// Controles de "Diseñar con IA" para un pedido de video (mismos endpoints y estados que Diseño:
// cola -> staged -> subiendo). La pieza que hay que grabar casi siempre falta cortarla.
function pendIaControls(o) {
    const f = o.iaForce || {};
    if (o.svgCorteUrl) {
        return `<a href="${escapeHtml(o.svgCorteUrl)}" target="_blank" rel="noopener" title="Ya tiene corte: abrir el SVG en Drive" style="display:inline-flex;align-items:center;gap:4px;background:#16a34a18;color:#16a34a;border:1px solid #16a34a55;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none"><i class="fas fa-scissors"></i>Ya cortada</a>`;
    }
    if (f.status === 'approved') return `<span style="display:inline-flex;align-items:center;gap:4px;background:#0ea5e922;color:#0284c7;border:1px solid #0ea5e966;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700"><i class="fas fa-cloud-arrow-up"></i>Subiendo…</span>`;
    if (f.status === 'staged') {
        const thumb = f.cortePreviewUrl || f.previewUrl;
        const img = thumb ? `<img src="${escapeHtml(thumb)}" onclick="openImageModal(this.src)" title="Diseño listo — clic para ampliar" style="width:30px;height:30px;object-fit:cover;border-radius:5px;cursor:zoom-in;border:1px solid var(--color-border,#e5e7eb)">` : '';
        return `${img}<button onclick="pendIaConfirm('${o.id}', this)" title="Subir el corte a Drive (producción)" class="pd-btn" style="background:#16a34a;color:#fff"><i class="fas fa-cloud-arrow-up" style="margin-right:3px"></i>Subir</button><button onclick="pendIaReject('${o.id}', this)" title="Descartar este diseño de IA (no sube nada)" class="pd-btn pd-btn-ghost" style="color:#dc2626"><i class="fas fa-times"></i></button>`;
    }
    if (f.status === 'queued') return `<span title="Tu PC lo diseña y lo sube en ≤15 min" style="display:inline-flex;align-items:center;gap:4px;background:#f59e0b22;color:#b45309;border:1px solid #f59e0b66;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700"><i class="fas fa-hourglass-half"></i>En cola IA…</span>`;
    if (f.status === 'error') return `<button onclick="pendDesignIA('${o.id}', this)" title="${escapeHtml(f.error || 'Error')} — clic para reintentar" class="pd-btn" style="background:#dc262611;color:#b91c1c;border:1px solid #dc262666"><i class="fas fa-triangle-exclamation" style="margin-right:3px"></i>Reintentar IA</button>`;
    if (o.autoCutQueued) return `<span title="El worker de corte lo va a diseñar y subir a Drive solo (≤15 min). No lo cortes a mano." style="display:inline-flex;align-items:center;gap:4px;background:#7c3aed22;color:#7c3aed;border:1px solid #7c3aed66;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700"><i class="fas fa-wand-magic-sparkles"></i>Corte IA en cola</span>`;
    if (o.iaEligible) return `<button onclick="pendDesignIA('${o.id}', this)" title="Tu PC lo diseña y lo SUBE A DRIVE en ≤15 min" class="pd-btn" style="background:#7c3aed;color:#fff"><i class="fas fa-wand-magic-sparkles" style="margin-right:3px"></i>Diseñar con IA</button>`;
    return '';
}

// Tarjeta de pedido: video, mockup y estatus Corregir.
function pendOrderCard(o) {
    const datos = String(o.datos || '')
        .replace(/nombres?\s*:\s*/i, '').replace(/\s*\|\s*fecha\s*:\s*/i, ' · ')
        .replace(/\s*\|\s*/g, ' · ').replace(/\s*\n\s*/g, ' · ').trim();
    const chatBtn = o.contactId ? `<button onclick="pendOpenChat('${escapeHtml(o.contactId)}')" title="Ver conversación" class="pd-icon-btn"><i class="fas fa-comments"></i></button>` : '';
    const resp = (o.clienteRespondio && o.contactId)
        ? `<button onclick="pendOpenChat('${escapeHtml(o.contactId)}')" title="El cliente te respondió ${escapeHtml(pendHace(o.clienteRespondioAt))} — clic para ver el chat" class="pd-resp"><i class="fas fa-reply"></i>Te respondió</button>` : '';
    const thumb = o.mockupUrl
        ? `<img src="${escapeHtml(o.mockupUrl)}" class="pd-thumb" onclick="openImageModal(this.src)" title="Mockup que aprobó el cliente — clic para ampliar">` : '';
    const esVideo = o.motivo === 'video';
    const esCorregir = o.motivo === 'corregir';
    const desde = esVideo ? (o.videoRequestedAt || o.corregirAt) : esCorregir ? (o.corregirAt || o.createdAt) : o.createdAt;
    const acciones = esCorregir
        ? `<span class="pd-age" style="color:#ea580c;background:#fff7ed">Corregir</span>${o.contactId ? `<button onclick="pendOpenChat('${escapeHtml(o.contactId)}')" class="pd-btn pd-btn-ghost">Ver conversación</button>` : ''}`
        : esVideo
        ? `${pendIaControls(o)}<button onclick="pendVideoEnviado('${o.id}', this)" title="Ya le mandaste el video: saca el pedido de esta lista" class="pd-btn" style="background:#16a34a;color:#fff"><i class="fas fa-check" style="margin-right:3px"></i>Video enviado</button>`
        : `<button onclick="navigateTo('mockups')" title="Ir a la sección Mockup para generarle su preview" class="pd-btn" style="background:#6f42c1;color:#fff"><i class="fas fa-image" style="margin-right:3px"></i>Ir a Mockup</button>
           <button onclick="pendMockupOcultar('${o.id}', this)" title="Quitar de la lista sin hacerle mockup (mismo efecto que 'Ocultar' en la sección Mockup)" class="pd-btn pd-btn-ghost">Quitar</button>`;
    return `<div class="pd-card" data-pend="${escapeHtml(o.id)}">
        <div class="pd-card-top">
            <span class="pd-card-num" onclick="pendCopyNum(this,'${escapeHtml(o.orderNumber)}')" title="Clic para copiar el número">${escapeHtml(o.orderNumber)}</span>
            <span class="pd-card-actions">${resp}${pendAgeBadge(desde)}${chatBtn}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start">
            ${thumb}
            <div style="min-width:0;flex:1">
                <div class="pd-card-datos" title="${escapeHtml(o.clienteName || '')}">${pendChanIcon(o.channel)} ${escapeHtml(datos || o.clienteName || '')}</div>
                <div class="pd-card-sub">${escapeHtml(o.producto || '')}${o.itemCount > 1 ? ' <span style="color:#94a3b8">+' + (o.itemCount - 1) + '</span>' : ''}</div>
            </div>
        </div>
        <div class="pd-row">${acciones}</div>
        <textarea class="pd-note" data-note-order="${escapeHtml(o.id)}" maxlength="2000" oninput="pendEditarComentario('${o.id}', this)" onblur="pendGuardarComentario('${o.id}', this)" placeholder="Nota interna…" title="Notas del equipo (no las ve el cliente)">${escapeHtml(_pendDrafts.get(o.id)?.value ?? o.comentario ?? '')}</textarea>
    </div>`;
}

// Tarjeta de CONTACTO (columnas de atención humana y de la cola de la IA).
function pendContactCard(c, col) {
    const chatId = c.contactId || c.id;
    const chatBtn = `<button onclick="pendOpenChat('${escapeHtml(chatId)}')" title="Ver conversación" class="pd-icon-btn"><i class="fas fa-comments"></i></button>`;
    const unread = c.unreadCount > 0 ? `<span class="pd-age" style="background:#dc262618;color:#dc2626">${c.unreadCount} sin leer</span>` : '';
    let detalle = '', acciones = '';
    if (col.startsWith('pago_')) {
        const image = c.imageUrl ? `<a href="${escapeHtml(c.imageUrl)}" target="_blank" rel="noopener" class="pd-btn pd-btn-ghost">Ver comprobante</a>` : '';
        detalle = `<div class="pd-card-sub"><b>${escapeHtml(c.orderNumber || c.name || '')}</b><br>${escapeHtml(c.reason || 'Pendiente de procesamiento')}${c.amount ? '<br>Importe leído: $' + escapeHtml(String(c.amount)) : ''}</div>`;
        if (col !== 'pago_formulario' && (c.formSent || c.shippingDataReceived)) detalle += `<div class="pd-card-sub" style="color:#2563eb">${c.shippingDataReceived ? 'Datos de envío recibidos' : 'Datos de envío solicitados'} · comprobante por revisar</div>`;
        acciones = col === 'pago_formulario'
            ? `<button onclick="pendPaymentRetry('${escapeHtml(c.id)}', this)" class="pd-btn">Revisar y reintentar</button><button onclick="pendPaymentConfirmSent('${escapeHtml(c.id)}', this)" class="pd-btn pd-btn-ghost">Ya lo recibió</button>`
            : `${image}<button onclick="pendPaymentReview('${escapeHtml(c.id)}', '${col}', this)" class="pd-btn" style="background:#16a34a;color:white">Validar importe</button><button onclick="pendPaymentReject('${escapeHtml(c.id)}', this)" class="pd-btn pd-btn-ghost">Descartar</button>`;
    } else if (col === 'atencion') {
        const motivo = PEND_ATTN_REASONS[c.reason] || 'Necesita que la atienda una persona';
        detalle = `<div class="pd-card-sub"><b>${escapeHtml(motivo)}</b>${c.lastMessage ? '<br>“' + escapeHtml(c.lastMessage) + '”' : ''}</div>`;
        acciones = `<button onclick="pendAtendido('${escapeHtml(c.id)}', this)" title="Ya la atendiste: quita lo urgente y el parpadeo en Chats" class="pd-btn" style="background:#16a34a;color:#fff"><i class="fas fa-check" style="margin-right:3px"></i>Atendido</button>`;
    } else if (col === 'ia_cola') {
        detalle = `<div class="pd-card-sub"><b>Cambio confirmado por el cliente, sin aplicar.</b><br>
            ${c.pedido ? 'Su pedido: <b>' + escapeHtml(c.pedido.orderNumber) + '</b> (' + escapeHtml(c.pedido.estatus) + ')' : ''}
            ${c.motivoFalla ? '<br>La IA falló: ' + escapeHtml(c.motivoFalla) : ''}</div>`;
        acciones = `<button onclick="pendIaResolver('${escapeHtml(c.id)}', this)" title="Sácalo de la cola Pendientes IA (ya aplicaste el cambio)" class="pd-btn" style="background:#16a34a;color:#fff"><i class="fas fa-check" style="margin-right:3px"></i>Resuelto</button>`;
    } else if (col === 'sospechoso') {
        const motivo = (c.reason && c.reason.trim()) ? c.reason.trim() : 'El comprobante no coincide con nuestros datos (revísalo)';
        const img = c.imageUrl
            ? `<div style="margin-top:6px"><img src="${escapeHtml(c.imageUrl)}" alt="Comprobante" onclick="openImageModal(this.src)" onerror="this.parentNode.style.display='none'" style="max-width:100%;max-height:170px;border-radius:8px;border:1px solid var(--color-border,#e5e7eb);cursor:pointer;object-fit:contain"></div>`
            : '';
        const cotejoSlot = `<div class="pd-cotejo-slot" data-cotejar="${escapeHtml(c.id)}">${pendCotejarBadge(c.cotejo, c.id)}</div>`;
        detalle = `<div class="pd-card-sub"><b>Comprobante a revisar${c.orderNumber ? ' · ' + escapeHtml(c.orderNumber) : ''}</b><br>Motivo: ${escapeHtml(motivo)}${img}</div>${cotejoSlot}`;
        acciones = `<button onclick="pendSospechosoAprobar('${escapeHtml(c.id)}', this)" title="El pago es válido: la conversación sigue su flujo (se le manda el formulario de envío)" class="pd-btn" style="background:#16a34a;color:#fff"><i class="fas fa-check" style="margin-right:3px"></i>Aprobar</button>
            <button onclick="pendSospechosoDescartar('${escapeHtml(c.id)}', this)" title="El pago NO es válido o ya lo atendiste: quítalo de aquí SIN mandar formulario" class="pd-btn pd-btn-ghost">Descartar</button>`;
    } else {
        detalle = `<div class="pd-card-sub"><b>La IA le dijo “ya registramos tu pedido” y el pedido NO existe.</b>
            ${c.motivoFalla ? '<br>Motivo: ' + escapeHtml(c.motivoFalla) : ''}
            ${c.lastMessage ? '<br>“' + escapeHtml(c.lastMessage) + '”' : ''}</div>`;
        acciones = `<button onclick="pendRegistrarPedido('${escapeHtml(c.id)}')" title="Abrir el formulario de pedido para este cliente" class="pd-btn" style="background:#dc2626;color:#fff"><i class="fas fa-file-invoice" style="margin-right:3px"></i>Registrar pedido</button>
            <button onclick="pendIaResolver('${escapeHtml(c.id)}', this)" title="Ya lo resolviste: sácalo de la cola" class="pd-btn pd-btn-ghost">Resuelto</button>`;
    }
    return `<div class="pd-card" data-pend="${escapeHtml(c.id)}">
        <div class="pd-card-top">
            <span class="pd-card-num" onclick="pendOpenChat('${escapeHtml(chatId)}')" title="Abrir la conversación">${pendChanIcon(c.channel)} ${escapeHtml(c.name || c.id)}</span>
            <span class="pd-card-actions">${unread}${pendAgeBadge(c.at || c.lastMessageAt)}${chatBtn}</span>
        </div>
        ${detalle}
        <div class="pd-row">${acciones}</div>
    </div>`;
}

function _pendKeepCard(card) {
    const note = card.querySelector('.pd-note');
    const draft = note && _pendDrafts.get(note.dataset.noteOrder);
    return card.contains(document.activeElement) || !!(draft && (draft.dirty || draft.pending || draft.error)) || !!card.querySelector('button:disabled');
}

// Reconcilia por ID: el campo que se está editando conserva su nodo, cursor y Ctrl+Z.
function _paintPendientes() {
    const container = document.getElementById('pendientes-container');
    if (!container) return;
    const data = window._pendData || {};
    if (!container.querySelector('.pd-board')) {
        container.innerHTML = PEND_CSS + `<div class="pd-board">
            <nav class="pd-category-nav" aria-label="Categorías de pendientes">
                <div class="pd-nav-label">Categorías</div>
                ${PEND_COLS.map(([key, label, color, icon]) => `<button type="button" class="pd-category-btn" data-pend-category="${key}" aria-pressed="${key === _pendCategory}" aria-controls="pd-panel-${key}" style="--pd-color:${color}" onclick="pendSelectCategory('${key}')"><i class="fas ${icon}" aria-hidden="true"></i><span class="pd-category-label">${label}</span><span class="pd-col-count">0</span></button>`).join('')}
            </nav>
            <div class="pd-panels">${PEND_COLS.map(([key, label, color, icon]) => `<section class="pd-col" id="pd-panel-${key}" aria-labelledby="pd-title-${key}" style="--pd-color:${color}" ${key === _pendCategory ? '' : 'hidden'}>
                <div class="pd-col-head">
                    <h2 class="pd-col-title" id="pd-title-${key}"><i class="fas ${icon}" aria-hidden="true"></i>${label}</h2>
                    <span class="pd-col-count">0</span>
                </div>
                <div class="pd-col-list" id="pd-col-${key}"></div>
            </section>`).join('')}</div>
        </div>`;
    }
    PEND_COLS.forEach(([key]) => {
        const list = document.getElementById('pd-col-' + key), scrollTop = list.scrollTop;
        const cards = [...list.querySelectorAll('.pd-card')];
        const anchor = key === _pendCategory ? cards.find(card => card.getBoundingClientRect().bottom > list.getBoundingClientRect().top) : null;
        const anchorTop = anchor?.getBoundingClientRect().top;
        const old = new Map(cards.map(card => [card.dataset.pend, card]));
        const items = data[key] || [], wanted = new Set(items.map(item => item.id));
        list.querySelector('.pd-empty')?.remove();
        let cursor = list.firstElementChild;
        for (const item of items) {
            const draft = _pendDrafts.get(item.id);
            if (draft && !draft.dirty && !draft.pending && !draft.error && item.comentario === draft.value) _pendDrafts.delete(item.id);
            const html = PEND_ORDER_COLS.includes(key) ? pendOrderCard(item) : pendContactCard(item, key);
            let card = old.get(item.id);
            const keep = card && _pendKeepCard(card);
            if (!card || (!keep && card._pendHtml !== html)) {
                const template = document.createElement('template'); template.innerHTML = html;
                const fresh = template.content.firstElementChild; fresh._pendHtml = html;
                if (card) { if (cursor === card) cursor = fresh; card.replaceWith(fresh); }
                card = fresh;
            }
            if (card !== cursor && !keep) list.insertBefore(card, cursor);
            cursor = card.nextElementSibling;
            card.querySelector('.pd-note-retained')?.remove();
        }
        for (const card of cards) {
            if (wanted.has(card.dataset.pend) || !card.isConnected) continue;
            if (_pendKeepCard(card) && card.querySelector('.pd-note')) {
                if (!card.querySelector('.pd-note-retained')) {
                    const notice = document.createElement('div'); notice.className = 'pd-note-retained pd-card-sub';
                    notice.textContent = 'Este pedido salió de pendientes. Conservamos tu nota mientras terminas de editarla.';
                    card.appendChild(notice);
                }
            } else card.remove();
        }
        list.parentElement.querySelector('.pd-col-count').textContent = items.length;
        container.querySelector(`[data-pend-category="${key}"] .pd-col-count`).textContent = items.length;
        if (!list.children.length) list.innerHTML = '<div class="pd-empty">✓ Nada pendiente</div>';
        if (key === _pendCategory) {
            list.scrollTop = scrollTop;
            if (anchor?.isConnected) list.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
        }
    });
    _pendFitHeight();
    // Cotejo automático contra Ingresos: cada comprobante sospechoso se coteja solo al pintarse (una
    // vez por sesión; el OCR se cachea en el server). pendCotejar se salta los ya cotejados.
    container.querySelectorAll('.pd-cotejo-slot[data-cotejar]').forEach(el => pendCotejar(el.getAttribute('data-cotejar')));
    if (!window._pendResizeBound) {
        window._pendResizeBound = true;
        window.addEventListener('resize', () => _pendFitHeight());
    }
}

// Conserva los paneles, borradores y posición de cada categoría al cambiar de vista.
function pendSelectCategory(key) {
    if (!PEND_COLS.some(col => col[0] === key) || key === _pendCategory) return;
    const previous = document.getElementById('pd-col-' + _pendCategory);
    if (previous) {
        _pendCategoryScroll.set(_pendCategory, previous.scrollTop);
        if (previous.contains(document.activeElement)) document.activeElement.blur();
    }
    _pendCategory = key;
    PEND_COLS.forEach(([category]) => {
        const panel = document.getElementById('pd-panel-' + category);
        if (panel) panel.hidden = category !== key;
        document.querySelector(`[data-pend-category="${category}"]`)?.setAttribute('aria-pressed', String(category === key));
    });
    const list = document.getElementById('pd-col-' + key);
    if (list) list.scrollTop = _pendCategoryScroll.get(key) || 0;
    _pendFitHeight();
}
window.pendSelectCategory = pendSelectCategory;

// En escritorio solo se desplazan las tarjetas; en móvil la página crece verticalmente.
function _pendFitHeight() {
    const board = document.querySelector('#pendientes-container .pd-board');
    if (!board) return;
    if (window.matchMedia('(max-width:760px)').matches) { board.style.height = ''; return; }
    const top = board.getBoundingClientRect().top;
    board.style.height = Math.max(320, window.innerHeight - top - 16) + 'px';
}

// --- Acciones ---------------------------------------------------------------------------------
async function _pendPost(path, body) {
    _pendDataVersion++;
    const opt = { method: 'POST' };
    if (body) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    try {
        const res = await fetch(`${API_BASE_URL}/api/${path}`, opt);
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.success) throw new Error(d.message || ('HTTP ' + res.status));
        return d;
    } finally {
        _pendDataVersion++;
        if (typeof _pendScheduleRefresh === 'function') _pendScheduleRefresh();
    }
}

// Diálogo dentro de la página: conserva el comprobante y el motivo a la vista.
function _pendPaymentDialog(title, contents, submitLabel = 'Confirmar') {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'max-width:480px;width:calc(100% - 32px);padding:24px;border:1px solid #cbd5e1;border-radius:14px;color:#334155;background:white;box-shadow:0 20px 80px #0004';
        dialog.innerHTML = `<form><h2 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h2>${contents}<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:22px"><button type="button" data-cancel class="pd-btn pd-btn-ghost" style="padding:10px 16px">Cancelar</button><button type="submit" class="pd-btn" style="padding:10px 16px;background:#15803d;color:white">${escapeHtml(submitLabel)}</button></div></form>`;
        const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
        dialog.querySelector('[data-cancel]').onclick = () => finish(null);
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
        dialog.querySelector('form').onsubmit = event => { event.preventDefault(); finish(Object.fromEntries(new FormData(event.target))); };
        document.body.appendChild(dialog);
        dialog.showModal();
    });
}

async function _pendPaymentAction(path, body, button) {
    button.disabled = true;
    try { await _pendPost(path, body); await renderPendientesView(true); }
    catch (e) { await _pendPaymentDialog('No se completó la acción', `<p>${escapeHtml(e.message)}</p>`, 'Entendido'); await renderPendientesView(true); }
    finally { button.disabled = false; }
}

async function pendPaymentReview(id, col, button) {
    const receipt = window._pendData?.[col]?.find(r => r.id === id);
    if (!receipt) return;
    const reactivate = /cancelad/i.test(receipt.reason || '');
    const fieldStyle = 'display:block;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:16px;margin:6px 0 14px;box-sizing:border-box';
    const values = await _pendPaymentDialog(`Validar pago · ${receipt.orderNumber || 'Seleccionar pedido'}`, `
        <p style="line-height:1.5">${escapeHtml(receipt.reason || '')}</p>
        ${receipt.imageUrl ? `<a href="${escapeHtml(receipt.imageUrl)}" target="_blank" rel="noopener">Abrir comprobante</a>` : ''}
        ${!receipt.orderId ? `<label>Pedido de este contacto<input name="orderNumber" required placeholder="DH12345" pattern="[Dd]?[Hh]?[0-9]+" style="${fieldStyle}"></label>` : ''}
        <label>Importe recibido en este comprobante (MXN)<input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(String(receipt.amount || ''))}" style="${fieldStyle}"></label>
        <p style="font-size:14px;line-height:1.5">Se aprobará este abono. Los datos de envío se solicitan cuando los comprobantes cubren el total, aunque la aprobación siga pendiente.</p>
        <label style="display:flex;gap:8px;line-height:1.4"><input type="checkbox" required name="reviewed"> Confirmo que revisé el comprobante y recibimos este importe.${reactivate ? ' Autorizo reactivar el pedido cancelado cuando quede liquidado.' : ''}</label>`, 'Validar importe');
    if (!values) return;
    await _pendPaymentAction(`payments/receipts/${encodeURIComponent(id)}/review`, { amount: Number(values.amount), reactivate, orderNumber: receipt.orderNumber || values.orderNumber }, button);
}

async function pendPaymentReject(id, button) {
    if (!await _pendPaymentDialog('Descartar comprobante', '<p>No se sumará el importe ni se enviará el formulario de este comprobante.</p>', 'Descartar')) return;
    await _pendPaymentAction(`payments/receipts/${encodeURIComponent(id)}/review`, { action: 'reject' }, button);
}

async function pendPaymentRetry(id, button) {
    if (!await _pendPaymentDialog('Reenviar formulario', '<p>Confirma en el chat que hace falta el formulario. Si ya llegó, usa “Ya lo recibió” para cerrar el pendiente sin repetir el mensaje.</p><label><input type="checkbox" required> Revisé el chat y hace falta enviar el formulario.</label>', 'Enviar formulario')) return;
    await _pendPaymentAction(`payments/forms/${encodeURIComponent(id)}/retry`, null, button);
}

async function pendPaymentConfirmSent(id, button) {
    if (!await _pendPaymentDialog('Confirmar recepción del formulario', '<p>Esta acción cierra el pendiente sin reenviar el mensaje.</p><label><input type="checkbox" required> Comprobé en el chat que el cliente ya recibió el formulario de este pedido.</label>', 'Ya lo recibió')) return;
    await _pendPaymentAction(`payments/forms/${encodeURIComponent(id)}/confirm-sent`, null, button);
}

// Quita una tarjeta del cache local y re-pinta (sin re-consultar: no parpadea ni salta el scroll).
// Devuelve lo que quitó y de qué posición, que es justo lo que necesita el deshacer para regresarla
// a su lugar (y no al final de la columna).
function _pendRemove(col, id) {
    const arr = (window._pendData || {})[col];
    if (!arr) return null;
    const i = arr.findIndex(x => x.id === id);
    const item = i >= 0 ? arr.splice(i, 1)[0] : null;
    _paintPendientes();
    return item ? { col, index: i, item } : null;
}

// --- Deshacer (Ctrl+Z) -------------------------------------------------------------------------
// Todas las acciones de esta sección quitan la tarjeta de la lista, y varias son un clic de distancia
// de la de al lado. Cada una apila aquí cómo revertirse (endpoint inverso + dónde estaba la tarjeta),
// así que Ctrl+Z —o el botón del aviso— deshace la última, y otra vez la anterior.
const PEND_UNDO_MAX = 20;
window._pendUndo = window._pendUndo || [];

function _pendPushUndo(quitado, label, undoFn) {
    if (!quitado) return;                       // la tarjeta ya no estaba: nada que regresar
    window._pendUndo.push({ ...quitado, label, undo: undoFn });
    if (window._pendUndo.length > PEND_UNDO_MAX) window._pendUndo.shift();
    pendToast(label, { undo: true });
}

async function pendUndo() {
    const e = window._pendUndo.pop();
    if (!e) return pendToast('No hay nada que deshacer', {});
    try {
        await e.undo();
    } catch (err) {
        window._pendUndo.push(e);                // no se pudo revertir: la acción sigue disponible
        alert('No se pudo deshacer: ' + (err.message || err));
        return;
    }
    const arr = (window._pendData || {})[e.col];
    if (arr) arr.splice(Math.min(e.index, arr.length), 0, e.item);
    _paintPendientes();
    pendToast('Se deshizo: ' + e.label, {});
}
window.pendUndo = pendUndo;

// Aviso abajo a la izquierda: dice qué acabas de hacer y ofrece deshacerlo. Se va solo a los 8 s,
// pero el deshacer sigue disponible con Ctrl+Z (el aviso es el recordatorio, no el único camino).
function pendToast(msg, opts) {
    let el = document.getElementById('pend-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'pend-toast';
        el.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:11500;display:flex;align-items:center;gap:12px;'
            + 'background:#1e293b;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.28);'
            + 'font-size:.85rem;font-weight:600;max-width:min(460px,90vw)';
        document.body.appendChild(el);
    }
    el.innerHTML = `<span>${escapeHtml(msg)}</span>`
        + ((opts && opts.undo) ? `<button onclick="pendUndo()" style="border:none;background:#38bdf8;color:#0b2436;padding:4px 10px;border-radius:6px;font-size:.8rem;font-weight:800;cursor:pointer;white-space:nowrap"><i class="fas fa-rotate-left" style="margin-right:4px"></i>Deshacer</button>` : '');
    el.style.display = 'flex';
    clearTimeout(window._pendToastT);
    window._pendToastT = setTimeout(() => { el.style.display = 'none'; }, 8000);
}
window.pendToast = pendToast;

// Ctrl+Z / Cmd+Z. Solo en esta sección y solo cuando NO se está escribiendo: dentro de una nota o del
// chat, Ctrl+Z tiene que seguir deshaciendo el TEXTO (lo del navegador), no la tarjeta.
document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || String(e.key).toLowerCase() !== 'z') return;
    if (typeof state === 'undefined' || state.activeView !== 'pendientes' || state.chatModalOpen) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable)) return;
    e.preventDefault();
    pendUndo();
});

// La ventana de chat (encabezado con etiquetas/IA/archivar y el panel Detalles del contacto) se pinta
// desde `state.contacts`. Un contacto de esta sección puede NO estar ahí (la vista de Chats solo carga
// los últimos 30), y entonces el modal salía sin encabezado ni opciones. Se trae de Firestore y se
// inyecta antes de abrir.
async function _pendEnsureContact(contactId) {
    try {
        if (typeof state === 'undefined' || !Array.isArray(state.contacts)) return;
        if (state.contacts.some(c => c.id === contactId)) return;
        const doc = await db.collection('contacts_whatsapp').doc(String(contactId)).get();
        if (!doc.exists) return;
        const c = { id: doc.id, ...doc.data() };
        state.contacts.unshift(typeof processContacts === 'function' ? processContacts([c])[0] : c);
    } catch (e) { console.warn('[pendientes] no se pudo precargar el contacto:', e.message); }
}

// Abre la conversación COMPLETA (con el panel de detalles: Perfil, Pedidos, Notas, indicación para
// Andrea…). Se cierra con Esc o con la ✕, como los demás modales.
async function pendOpenChat(contactId) {
    if (!contactId) return;
    await _pendEnsureContact(String(contactId));
    if (typeof openChatEnviosModal === 'function') await openChatEnviosModal(String(contactId), { full: true });
}
window.pendOpenChat = pendOpenChat;

function pendCopyNum(el, num) {
    try { navigator.clipboard.writeText(String(num || '').replace(/^DH/, '')); } catch (_) {}
    const antes = el.textContent;
    el.textContent = '¡copiado!';
    setTimeout(() => { el.textContent = antes; }, 900);
}
window.pendCopyNum = pendCopyNum;

// Nombre corto de una tarjeta (DH#### o el nombre del cliente) para el texto del aviso de deshacer.
// Se lee ANTES de quitarla de la lista.
const _pendNombre = (col, id) => {
    const o = ((window._pendData || {})[col] || []).find(x => x.id === id);
    return o ? (o.orderNumber || o.name || id) : id;
};

async function pendVideoEnviado(orderId, el) {
    if (el) el.disabled = true;
    const num = _pendNombre('video', orderId);
    try {
        await _pendPost(`pendientes/video/${orderId}/enviado`);
        _pendPushUndo(_pendRemove('video', orderId), `${num}: video enviado`,
            () => _pendPost(`pendientes/video/${orderId}/reabrir`));
    } catch (e) { if (el) el.disabled = false; alert('No se pudo marcar el video como enviado: ' + (e.message || e)); }
}
window.pendVideoEnviado = pendVideoEnviado;

async function pendMockupOcultar(orderId, el) {
    if (el) el.disabled = true;
    const num = _pendNombre('mockup', orderId);
    try {
        await _pendPost(`pendientes/mockup/${orderId}/ocultar`);
        _pendPushUndo(_pendRemove('mockup', orderId), `${num}: quitado de Falta mockup`,
            () => _pendPost(`pendientes/mockup/${orderId}/ocultar`, { enabled: false }));
    } catch (e) { if (el) el.disabled = false; alert('No se pudo quitar: ' + (e.message || e)); }
}
window.pendMockupOcultar = pendMockupOcultar;

async function pendAtendido(contactId, el) {
    if (el) el.disabled = true;
    const card = ((window._pendData || {}).atencion || []).find(x => x.id === contactId) || {};
    try {
        await _pendPost(`pendientes/atencion/${contactId}/atendido`);
        // Si la lista de Chats ya está cargada en memoria, apaga también ahí el parpadeo.
        const enChats = (v, r) => {
            try {
                const c = (typeof state !== 'undefined' && state.contacts) ? state.contacts.find(x => x.id === contactId) : null;
                if (c) { c.needsAttention = v; c.needsAttentionReason = r; }
                if (typeof scheduleContactListRender === 'function') scheduleContactListRender();
            } catch (_) {}
        };
        enChats(false, null);
        _pendPushUndo(_pendRemove('atencion', contactId), `${card.name || contactId}: marcada como atendida`,
            async () => {
                // El motivo y la fecha originales viajan de vuelta para que la conversación reaparezca
                // con su antigüedad real (si no, saldría como recién marcada).
                await _pendPost(`pendientes/atencion/${contactId}/reabrir`, { reason: card.reason || null, at: card.at || null });
                enChats(true, card.reason || null);
            });
    } catch (e) { if (el) el.disabled = false; alert('No se pudo marcar como atendida: ' + (e.message || e)); }
}
window.pendAtendido = pendAtendido;

// Aprobar un comprobante sospechoso: valida el pago y la conversación sigue su flujo (backend manda
// el formulario de envío). No es deshacible desde aquí (ya se validó el pago); si fue error, se maneja en el chat.
async function pendSospechosoAprobar(contactId, el) {
    if (el) el.disabled = true;
    const card = ((window._pendData || {}).sospechoso || []).find(x => x.id === contactId) || {};
    try {
        await _pendPost(`pendientes/sospechoso/${contactId}/aprobar`);
        _pendRemove('sospechoso', contactId);
        pendToast(`${card.name || contactId}: comprobante aprobado ✅ — la conversación sigue su flujo`, {});
    } catch (e) {
        if (el) el.disabled = false;
        pendToast('No se pudo aprobar: ' + (e.message || e), {});
    }
}
window.pendSospechosoAprobar = pendSospechosoAprobar;

// Descartar: quita el comprobante de la columna SIN validar (pago no bueno o ya atendido por el chat).
async function pendSospechosoDescartar(contactId, el) {
    if (el) el.disabled = true;
    try {
        await _pendPost(`pendientes/sospechoso/${contactId}/descartar`);
        _pendRemove('sospechoso', contactId);
        pendToast('Comprobante quitado de la lista', {});
    } catch (e) {
        if (el) el.disabled = false;
        pendToast('No se pudo quitar: ' + (e.message || e), {});
    }
}
window.pendSospechosoDescartar = pendSospechosoDescartar;

// Pinta el veredicto del cotejo contra Ingresos (colección `expenses` de Admon). El encabezado es
// clic-para-recotejar (útil tras importar un estado de cuenta nuevo). cotejo=null -> "Cotejando…".
function pendCotejarBadge(cotejo, contactId) {
    const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const wrap = (bg, fg, inner) => `<div class="pd-cotejo" style="margin-top:7px;padding:7px 9px;border-radius:8px;font-size:.78rem;line-height:1.35;background:${bg};color:${fg}">${inner}</div>`;
    if (!cotejo) return wrap('#eef2ff', '#3730a3', `<i class="fas fa-circle-notch fa-spin"></i> Cotejando con Ingresos…`);
    const recotejar = contactId ? ` <span onclick="pendCotejar('${escapeHtml(contactId)}', true)" title="Volver a cotejar contra Ingresos" style="cursor:pointer;opacity:.7;margin-left:4px"><i class="fas fa-rotate-right"></i></span>` : '';
    const leido = [];
    if (cotejo.monto != null) leido.push(money(cotejo.monto));
    if (cotejo.fecha) leido.push(escapeHtml(cotejo.fecha));
    if (cotejo.banco) leido.push(escapeHtml(cotejo.banco));
    const leidoStr = leido.length ? `<div style="margin-top:3px;opacity:.85">Comprobante: ${leido.join(' · ')}</div>` : '';
    const best = cotejo.best;
    const movStr = (best && (cotejo.status === 'match' || cotejo.status === 'partial'))
        ? `<div style="margin-top:3px">Ingreso: <b>${money(best.credit)}</b> · ${escapeHtml(best.date)}<br><span style="opacity:.72">${escapeHtml(best.concept || '')}</span></div>` : '';
    const M = {
        match:            ['#dcfce7', '#166534', 'fa-circle-check',        'Coincide en Ingresos'],
        partial:          ['#fef9c3', '#854d0e', 'fa-circle-exclamation',  'Coincide monto/fecha, sin confirmar banco'],
        none:             ['#fee2e2', '#991b1b', 'fa-circle-xmark',        'Sin ingreso que coincida'],
        not_receipt:      ['#e5e7eb', '#374151', 'fa-image',               'La imagen no parece un comprobante'],
        unreadable_amount:['#e5e7eb', '#374151', 'fa-circle-question',     'No se pudo leer el monto del comprobante'],
        no_image:         ['#e5e7eb', '#374151', 'fa-image',              'Sin imagen para cotejar'],
        ocr_error:        ['#e5e7eb', '#374151', 'fa-triangle-exclamation','No se pudo leer el comprobante'],
        error:            ['#e5e7eb', '#374151', 'fa-triangle-exclamation','No se pudo cotejar'],
    };
    const [bg, fg, icon, label] = M[cotejo.status] || ['#e5e7eb', '#374151', 'fa-circle-info', cotejo.status || 'Sin cotejar'];
    const efectivoNote = (cotejo.efectivo && (cotejo.status === 'partial' || cotejo.status === 'none'))
        ? `<div style="margin-top:4px;opacity:.72;font-size:.72rem"><i class="fas fa-circle-info"></i> Pago en efectivo (OXXO cobra comisión: se coteja el neto). El efectivo no se puede atar a un cliente.</div>` : '';
    return wrap(bg, fg, `<div style="font-weight:700"><i class="fas ${icon}"></i> ${label}${recotejar}</div>${leidoStr}${movStr}${efectivoNote}`);
}

// Dispara el cotejo de una tarjeta (automático al pintarse; o forzado con el botón ↻). Cachea el OCR
// en el server; sólo re-cotejo por sesión salvo force. Actualiza el panel in situ sin re-pintar todo.
async function pendCotejar(contactId, force) {
    if (!contactId) return;
    window._pendCotejadas = window._pendCotejadas || new Set();
    if (!force && window._pendCotejadas.has(contactId)) return;
    window._pendCotejadas.add(contactId);
    const slotOf = () => [...document.querySelectorAll('.pd-cotejo-slot[data-cotejar]')].find(el => el.getAttribute('data-cotejar') === String(contactId));
    if (force) { const s = slotOf(); if (s) s.innerHTML = pendCotejarBadge(null, contactId); }
    try {
        const r = await _pendPost(`pendientes/sospechoso/${contactId}/cotejar`, force ? { force: true } : null);
        const cotejo = (r && r.cotejo) || { status: 'error' };
        const item = ((window._pendData || {}).sospechoso || []).find(x => x.id === contactId);
        if (item) item.cotejo = cotejo;                         // persistir en el cache local para el próximo re-pinta
        const s = slotOf(); if (s) s.innerHTML = pendCotejarBadge(cotejo, contactId);
    } catch (e) {
        const s = slotOf(); if (s) s.innerHTML = pendCotejarBadge({ status: 'error' }, contactId);
    }
}
window.pendCotejar = pendCotejar;

async function pendIaResolver(contactId, el) {
    if (el) el.disabled = true;
    const card = [...((window._pendData || {}).ia_cola || []), ...((window._pendData || {}).ia_sin_pedido || [])]
        .find(x => x.id === contactId) || {};
    try {
        const r = await _pendPost(`pendientes/ia/${contactId}/resolver`);
        const quitado = _pendRemove('ia_cola', contactId) || _pendRemove('ia_sin_pedido', contactId);
        _pendPushUndo(quitado, `${card.name || contactId}: sacado de la cola de la IA`,
            () => _pendPost(`pendientes/ia/${contactId}/reabrir`, { fallas: r.fallas || [], estabaEnCola: r.estabaEnCola }));
    } catch (e) { if (el) el.disabled = false; alert('No se pudo resolver: ' + (e.message || e)); }
}
window.pendIaResolver = pendIaResolver;

// Abre el formulario de pedido ya apuntando a ese cliente (el mismo del chat).
function pendRegistrarPedido(contactId) {
    if (typeof abrirModalPedido !== 'function') return;
    abrirModalPedido({ id: String(contactId), phone: String(contactId) });
}
window.pendRegistrarPedido = pendRegistrarPedido;

function pendEditarComentario(orderId, el) {
    let draft = _pendDrafts.get(orderId);
    if (!draft) {
        const item = PEND_ORDER_COLS.flatMap(col => window._pendData?.[col] || []).find(o => o.id === orderId);
        draft = { value: el.value, saved: item?.comentario || '', pending: 0, chain: Promise.resolve() };
        _pendDrafts.set(orderId, draft);
    }
    draft.value = el.value;
    draft.dirty = draft.value !== draft.saved;
    el.style.borderColor = draft.dirty ? '#d97706' : '';
    return draft;
}
window.pendEditarComentario = pendEditarComentario;

async function pendGuardarComentario(orderId, el) {
    // Enfocar y salir sin escribir no debe sobrescribir la nota de otro operador.
    if (!_pendDrafts.has(orderId)) { _paintPendientes(); return; }
    const draft = pendEditarComentario(orderId, el), value = el.value;
    if ((!draft.dirty && !draft.error && !draft.pending) || (draft.pending && draft.queued === value)) {
        if (!draft.pending) _paintPendientes();
        return draft.chain;
    }
    draft.pending++; draft.queued = value;
    // Serializar guardados evita que una respuesta lenta restaure una versión anterior.
    draft.chain = draft.chain.catch(() => {}).then(async () => {
        try {
            await _pendPost(`pendientes/${encodeURIComponent(orderId)}/comentario`, { comentario: value });
            draft.saved = value; draft.error = false; draft.dirty = draft.value !== value;
            for (const col of PEND_ORDER_COLS) {
                const o = (window._pendData?.[col] || []).find(x => x.id === orderId);
                if (o) o.comentario = value;
            }
            el.style.borderColor = draft.dirty ? '#d97706' : '#16a34a';
            el.closest('.pd-card')?.querySelector('.pd-note-error')?.remove();
        } catch (e) {
            draft.error = true; draft.dirty = true; el.style.borderColor = '#dc2626';
            const card = el.closest('.pd-card');
            if (card && !card.querySelector('.pd-note-error')) {
                const retry = document.createElement('button'); retry.className = 'pd-btn pd-note-error';
                retry.textContent = 'No se guardó la nota · Reintentar';
                retry.onclick = () => pendGuardarComentario(orderId, card.querySelector('.pd-note'));
                card.appendChild(retry);
            }
        } finally {
            draft.pending--;
            _paintPendientes();
        }
    });
    return draft.chain;
}
window.pendGuardarComentario = pendGuardarComentario;

// --- "Diseñar con IA" (mismos endpoints que Pendientes de Diseño; el worker local hace el corte) ---
function _pendUpdateIa(orderId, iaForce) {
    const o = ((window._pendData || {}).video || []).find(x => x.id === orderId);
    if (o) o.iaForce = iaForce;
    _paintPendientes();
}

async function pendDesignIA(orderId, el) {
    if (el) el.disabled = true;
    try {
        await _pendPost(`design-pending/${orderId}/design-ia`);
        _pendUpdateIa(orderId, { status: 'queued' });
    } catch (e) { if (el) el.disabled = false; alert('No se pudo enviar a diseño con IA: ' + (e.message || e)); }
}
window.pendDesignIA = pendDesignIA;

async function pendIaConfirm(orderId, el) {
    if (typeof showConfirmModal === 'function'
        && !await showConfirmModal('¿Subir el corte a Drive? Esto lo manda a producción (tu PC lo sube en ≤15 min).', { icon: 'fa-cloud-arrow-up', confirmText: 'Subir a Drive' })) return;
    if (el) el.disabled = true;
    try {
        await _pendPost(`design-pending/${orderId}/ia-confirm`);
        const o = ((window._pendData || {}).video || []).find(x => x.id === orderId);
        _pendUpdateIa(orderId, { ...((o && o.iaForce) || {}), status: 'approved' });
    } catch (e) { if (el) el.disabled = false; alert('No se pudo confirmar: ' + (e.message || e)); }
}
window.pendIaConfirm = pendIaConfirm;

async function pendIaReject(orderId, el) {
    if (el) el.disabled = true;
    try {
        await _pendPost(`design-pending/${orderId}/ia-reject`);
        _pendUpdateIa(orderId, null);
    } catch (e) { if (el) el.disabled = false; alert('No se pudo descartar: ' + (e.message || e)); }
}
window.pendIaReject = pendIaReject;

// Las suscripciones y su recuperación viven en pendientes-live.js.
