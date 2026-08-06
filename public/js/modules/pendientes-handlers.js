// =================================================================================================
// === Sección "Pendientes" ========================================================================
// =================================================================================================
// Tablero hermano de "Pendientes de Diseño". Ahí van los pendientes del equipo de diseño (Erika);
// aquí los demás (Lupita), en 5 columnas que lee GET /api/pendientes:
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
    ['video', 'Mandar video', '#e83e8c', 'fa-video'],
    ['mockup', 'Falta mockup', '#6f42c1', 'fa-wand-magic-sparkles'],
    ['atencion', 'Apoyo humano', '#0ea5e9', 'fa-hand'],
    ['ia_cola', 'Cola IA +1h', '#f59e0b', 'fa-hourglass-half'],
    ['ia_sin_pedido', 'IA no registró el pedido', '#dc2626', 'fa-triangle-exclamation'],
];

// Por qué la conversación pide un humano (campo needsAttentionReason del contacto).
const PEND_ATTN_REASONS = {
    ai_off: 'La IA está apagada y el cliente escribió',
    equipo: 'El cliente pidió algo que la IA no puede dar',
    pago_sin_comprobante: 'Dice que pagó y no mandó comprobante',
    pago_no_registrado: 'Dice que pagó y no encontramos el pago',
};

const PEND_CSS = `
<style>
.pd-board{display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;padding-bottom:4px;align-items:stretch}
.pd-col{flex:1 1 0;min-width:255px;max-width:360px;background:var(--color-subtle-bg,#f8fafc);border:1px solid var(--color-border,#e5e7eb);border-radius:10px;display:flex;flex-direction:column;min-height:0}
.pd-col-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;flex-shrink:0}
.pd-col-title{font-weight:800;font-size:.8rem;display:flex;align-items:center;gap:5px}
.pd-col-count{background:var(--color-border,#e5e7eb);color:var(--color-text,#334155);font-size:.7rem;font-weight:700;border-radius:999px;padding:1px 8px}
.pd-col-list{flex:1;min-height:0;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
.pd-card{background:var(--color-container-bg,#fff);border:1px solid var(--color-border,#e5e7eb);border-radius:8px;padding:8px 9px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.pd-card-top{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px}
.pd-card-num{font-weight:800;color:var(--color-primary);cursor:pointer;font-size:.85rem}
.pd-card-actions{display:flex;align-items:center;gap:6px}
.pd-icon-btn{border:none;background:transparent;color:#0ea5e9;cursor:pointer;font-size:14px;padding:2px}
.pd-card-datos{font-weight:600;font-size:.8rem;line-height:1.25;margin-bottom:2px}
.pd-card-sub{font-size:.72rem;color:var(--color-text-light,#94a3b8);margin-bottom:4px;word-break:break-word}
.pd-row{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:5px}
.pd-note{width:100%;min-height:30px;max-height:90px;font-size:11.5px;line-height:1.3;padding:4px 6px;border:1px solid var(--color-border,#e5e7eb);border-radius:6px;resize:vertical;background:var(--color-surface,#fff);color:var(--color-text,#334155);margin-top:5px}
.pd-thumb{width:44px;height:44px;object-fit:cover;border-radius:6px;cursor:zoom-in;border:1px solid var(--color-border,#e5e7eb);flex:0 0 auto}
.pd-age{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:5px;white-space:nowrap}
.pd-btn{padding:4px 8px;font-size:11px;border-radius:6px;font-weight:700;cursor:pointer;white-space:nowrap;border:none}
.pd-btn-ghost{background:transparent;border:1px solid var(--color-border,#e5e7eb);color:var(--color-text,#334155)}
.pd-empty{color:var(--color-text-light,#94a3b8);font-size:.78rem;text-align:center;padding:14px 6px}
/* Burbuja "el cliente te respondió" (a TI, no a la IA): igual que en Pendientes de Diseño. */
.pd-resp{display:inline-flex;align-items:center;gap:3px;background:#16a34a;color:#fff;border:none;border-radius:999px;padding:2px 7px;font-size:10.5px;font-weight:800;cursor:pointer;line-height:1.5;animation:pdPulse 2s infinite}
@keyframes pdPulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.55)}70%{box-shadow:0 0 0 6px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}
</style>`;

function PendientesViewTemplate() {
    return `<div id="pendientes-view" class="p-4 md:p-6 h-full overflow-auto">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <h1 class="text-2xl font-bold" style="margin:0"><i class="fas fa-clipboard-check mr-2" style="color:#0ea5e9"></i>Pendientes</h1>
            <span id="pend-updated" style="font-size:.75rem;color:var(--color-text-light,#94a3b8)"></span>
            <button onclick="renderPendientesView()" class="btn btn-outline btn-sm" title="Actualizar" style="margin-left:auto"><i class="fas fa-rotate"></i></button>
        </div>
        <p class="text-sm text-gray-500 mb-4">Todo lo que hay que atender y no es diseño: videos por mandar, mockups que faltan, clientes que necesitan una persona y ventas que la IA dejó a medias.</p>
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

// silent=true: refresca SIN "Cargando…" y preservando el scroll de cada columna.
async function renderPendientesView(silent) {
    const container = document.getElementById('pendientes-container');
    if (!container) return;
    if (!silent) container.innerHTML = '<p class="text-gray-500">Cargando…</p>';
    try {
        const res = await fetch(`${API_BASE_URL}/api/pendientes`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || ('HTTP ' + res.status));
        window._pendData = data.buckets || {};
        _paintPendientes();
        const upd = document.getElementById('pend-updated');
        if (upd) upd.textContent = 'actualizado ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        container.innerHTML = `<p style="color:#991b1b">No se pudieron cargar los pendientes: ${escapeHtml(e.message || String(e))}</p>
            <button class="btn btn-outline btn-sm mt-2" onclick="renderPendientesView()">Reintentar</button>`;
    }
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

// Tarjeta de PEDIDO (columnas "Mandar video" y "Falta mockup").
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
    const desde = esVideo ? (o.videoRequestedAt || o.corregirAt) : o.createdAt;
    const acciones = esVideo
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
        <textarea class="pd-note" onblur="pendGuardarComentario('${o.id}', this)" placeholder="Nota interna…" title="Notas del equipo (no las ve el cliente)">${escapeHtml(o.comentario || '')}</textarea>
    </div>`;
}

// Tarjeta de CONTACTO (columnas de atención humana y de la cola de la IA).
function pendContactCard(c, col) {
    const chatBtn = `<button onclick="pendOpenChat('${escapeHtml(c.id)}')" title="Ver conversación" class="pd-icon-btn"><i class="fas fa-comments"></i></button>`;
    const unread = c.unreadCount > 0 ? `<span class="pd-age" style="background:#dc262618;color:#dc2626">${c.unreadCount} sin leer</span>` : '';
    let detalle = '', acciones = '';
    if (col === 'atencion') {
        const motivo = PEND_ATTN_REASONS[c.reason] || 'Necesita que la atienda una persona';
        detalle = `<div class="pd-card-sub"><b>${escapeHtml(motivo)}</b>${c.lastMessage ? '<br>“' + escapeHtml(c.lastMessage) + '”' : ''}</div>`;
        acciones = `<button onclick="pendAtendido('${escapeHtml(c.id)}', this)" title="Ya la atendiste: quita lo urgente y el parpadeo en Chats" class="pd-btn" style="background:#16a34a;color:#fff"><i class="fas fa-check" style="margin-right:3px"></i>Atendido</button>`;
    } else if (col === 'ia_cola') {
        detalle = `<div class="pd-card-sub"><b>Cambio confirmado por el cliente, sin aplicar.</b><br>
            ${c.pedido ? 'Su pedido: <b>' + escapeHtml(c.pedido.orderNumber) + '</b> (' + escapeHtml(c.pedido.estatus) + ')' : ''}
            ${c.motivoFalla ? '<br>La IA falló: ' + escapeHtml(c.motivoFalla) : ''}</div>`;
        acciones = `<button onclick="pendIaResolver('${escapeHtml(c.id)}', this)" title="Sácalo de la cola Pendientes IA (ya aplicaste el cambio)" class="pd-btn" style="background:#16a34a;color:#fff"><i class="fas fa-check" style="margin-right:3px"></i>Resuelto</button>`;
    } else {
        detalle = `<div class="pd-card-sub"><b>La IA le dijo “ya registramos tu pedido” y el pedido NO existe.</b>
            ${c.motivoFalla ? '<br>Motivo: ' + escapeHtml(c.motivoFalla) : ''}
            ${c.lastMessage ? '<br>“' + escapeHtml(c.lastMessage) + '”' : ''}</div>`;
        acciones = `<button onclick="pendRegistrarPedido('${escapeHtml(c.id)}')" title="Abrir el formulario de pedido para este cliente" class="pd-btn" style="background:#dc2626;color:#fff"><i class="fas fa-file-invoice" style="margin-right:3px"></i>Registrar pedido</button>
            <button onclick="pendIaResolver('${escapeHtml(c.id)}', this)" title="Ya lo resolviste: sácalo de la cola" class="pd-btn pd-btn-ghost">Resuelto</button>`;
    }
    return `<div class="pd-card" data-pend="${escapeHtml(c.id)}">
        <div class="pd-card-top">
            <span class="pd-card-num" onclick="pendOpenChat('${escapeHtml(c.id)}')" title="Abrir la conversación">${pendChanIcon(c.channel)} ${escapeHtml(c.name || c.id)}</span>
            <span class="pd-card-actions">${unread}${pendAgeBadge(c.at || c.lastMessageAt)}${chatBtn}</span>
        </div>
        ${detalle}
        <div class="pd-row">${acciones}</div>
    </div>`;
}

// Pinta las 5 columnas desde window._pendData (sin volver a consultar).
function _paintPendientes() {
    const container = document.getElementById('pendientes-container');
    if (!container) return;
    // Preserva el scroll de cada columna: al resolver una tarjeta la lista no salta al inicio.
    const saved = {};
    PEND_COLS.forEach(([k]) => { const el = document.getElementById('pd-col-' + k); if (el) saved[k] = el.scrollTop; });
    const data = window._pendData || {};
    const cols = PEND_COLS.map(([key, label, color, icon]) => {
        const items = data[key] || [];
        const cards = items.length
            ? items.map(x => (key === 'video' || key === 'mockup') ? pendOrderCard(x) : pendContactCard(x, key)).join('')
            : `<div class="pd-empty"><i class="fas fa-check-circle" style="margin-right:5px;color:#16a34a"></i>Nada pendiente</div>`;
        return `<div class="pd-col">
            <div class="pd-col-head" style="border-top:3px solid ${color};border-radius:10px 10px 0 0">
                <span class="pd-col-title" style="color:${color}"><i class="fas ${icon}"></i>${label}</span>
                <span class="pd-col-count">${items.length}</span>
            </div>
            <div class="pd-col-list" id="pd-col-${key}">${cards}</div>
        </div>`;
    }).join('');
    container.innerHTML = PEND_CSS + `<div class="pd-board">${cols}</div>`;
    _pendFitHeight();
    PEND_COLS.forEach(([k]) => { const el = document.getElementById('pd-col-' + k); if (el && saved[k] != null) el.scrollTop = saved[k]; });
    if (!window._pendResizeBound) {
        window._pendResizeBound = true;
        window.addEventListener('resize', () => _pendFitHeight());
    }
}

// El tablero ocupa de su tope al fondo de la ventana: encabezados fijos y scroll por columna.
function _pendFitHeight() {
    const board = document.querySelector('#pendientes-container .pd-board');
    if (!board) return;
    const top = board.getBoundingClientRect().top;
    board.style.height = Math.max(320, window.innerHeight - top - 16) + 'px';
}

// --- Acciones ---------------------------------------------------------------------------------
async function _pendPost(path, body) {
    const opt = { method: 'POST' };
    if (body) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    const res = await fetch(`${API_BASE_URL}/api/${path}`, opt);
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw new Error(d.message || ('HTTP ' + res.status));
    return d;
}

// Quita una tarjeta del cache local y re-pinta (sin re-consultar: no parpadea ni salta el scroll).
function _pendRemove(col, id) {
    const arr = (window._pendData || {})[col];
    if (!arr) return;
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) arr.splice(i, 1);
    _paintPendientes();
}

function pendOpenChat(contactId) {
    if (!contactId) return;
    if (typeof openChatEnviosModal === 'function') openChatEnviosModal(String(contactId));
}
window.pendOpenChat = pendOpenChat;

function pendCopyNum(el, num) {
    try { navigator.clipboard.writeText(String(num || '').replace(/^DH/, '')); } catch (_) {}
    const antes = el.textContent;
    el.textContent = '¡copiado!';
    setTimeout(() => { el.textContent = antes; }, 900);
}
window.pendCopyNum = pendCopyNum;

async function pendVideoEnviado(orderId, el) {
    if (el) el.disabled = true;
    try {
        await _pendPost(`pendientes/video/${orderId}/enviado`);
        _pendRemove('video', orderId);
    } catch (e) { if (el) el.disabled = false; alert('No se pudo marcar el video como enviado: ' + (e.message || e)); }
}
window.pendVideoEnviado = pendVideoEnviado;

async function pendMockupOcultar(orderId, el) {
    if (typeof showConfirmModal === 'function'
        && !await showConfirmModal('¿Quitar este pedido de la lista sin hacerle mockup?', { icon: 'warning', confirmText: 'Quitar' })) return;
    if (el) el.disabled = true;
    try {
        await _pendPost(`pendientes/mockup/${orderId}/ocultar`);
        _pendRemove('mockup', orderId);
    } catch (e) { if (el) el.disabled = false; alert('No se pudo quitar: ' + (e.message || e)); }
}
window.pendMockupOcultar = pendMockupOcultar;

async function pendAtendido(contactId, el) {
    if (el) el.disabled = true;
    try {
        await _pendPost(`pendientes/atencion/${contactId}/atendido`);
        // Si la lista de Chats ya está cargada en memoria, apaga también ahí el parpadeo.
        try {
            const c = (typeof state !== 'undefined' && state.contacts) ? state.contacts.find(x => x.id === contactId) : null;
            if (c) { c.needsAttention = false; c.needsAttentionReason = null; }
        } catch (_) {}
        _pendRemove('atencion', contactId);
    } catch (e) { if (el) el.disabled = false; alert('No se pudo marcar como atendida: ' + (e.message || e)); }
}
window.pendAtendido = pendAtendido;

async function pendIaResolver(contactId, el) {
    if (typeof showConfirmModal === 'function'
        && !await showConfirmModal('¿Sacar a este cliente de la cola "Pendientes IA"? Hazlo solo si ya registraste o aplicaste su pedido.', { icon: 'fa-check', confirmText: 'Sí, resuelto' })) return;
    if (el) el.disabled = true;
    try {
        await _pendPost(`pendientes/ia/${contactId}/resolver`);
        _pendRemove('ia_cola', contactId);
        _pendRemove('ia_sin_pedido', contactId);
    } catch (e) { if (el) el.disabled = false; alert('No se pudo resolver: ' + (e.message || e)); }
}
window.pendIaResolver = pendIaResolver;

// Abre el formulario de pedido ya apuntando a ese cliente (el mismo del chat).
function pendRegistrarPedido(contactId) {
    if (typeof abrirModalPedido !== 'function') return;
    abrirModalPedido({ id: String(contactId), phone: String(contactId) });
}
window.pendRegistrarPedido = pendRegistrarPedido;

async function pendGuardarComentario(orderId, el) {
    try {
        await _pendPost(`pendientes/${orderId}/comentario`, { comentario: el.value });
        for (const col of ['video', 'mockup']) {
            const o = ((window._pendData || {})[col] || []).find(x => x.id === orderId);
            if (o) o.comentario = el.value;
        }
        el.style.borderColor = '#16a34a';
        setTimeout(() => { el.style.borderColor = ''; }, 900);
    } catch (e) { alert('No se pudo guardar la nota: ' + (e.message || e)); }
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

// --- Refresco automático ----------------------------------------------------------------------
// Cada 2 min mientras la sección está a la vista. Se salta si hay un chat abierto encima o si se
// está escribiendo una nota (re-pintar borraría lo tecleado).
setInterval(() => {
    try {
        if (typeof state === 'undefined' || state.activeView !== 'pendientes') return;
        if (document.hidden || state.chatModalOpen) return;
        const a = document.activeElement;
        if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return;
        renderPendientesView(true);
    } catch (_) {}
}, 120000);
