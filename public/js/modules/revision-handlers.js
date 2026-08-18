// --- Revisión de pendientes (auditoría por meses) -----------------------------------------------
// Vista retrospectiva de TODO lo que quedó pendiente de NUESTRO lado, agrupado por mes, para irlo
// cerrando. Hermana de "Pendientes" (que es la cola operativa "qué trabajar ahora"); esta barre el
// histórico buscando cabos sueltos. Datos: GET /api/pendientes/revision. Ver server/pendientes/.

// motivo -> [etiqueta, color, icono]. MISMAS llaves que devuelve el endpoint (designPending + extras).
const REV_REASONS = {
    corte:            ['Pagado sin diseñar', '#7c3aed', 'fa-scissors'],
    venta_sin_cerrar: ['Pagó, no se cerró',  '#dc2626', 'fa-hand-holding-dollar'],
    mockup:           ['Sin foto/mockup',    '#0ea5e9', 'fa-image'],
    fabricar:         ['Falta producir',     '#0891b2', 'fa-industry'],
    datos:            ['Corrección',         '#ea580c', 'fa-pen'],
    video:            ['Video sin enviar',   '#16a34a', 'fa-video'],
    reenvio:          ['Reenvío',            '#c026d3', 'fa-rotate'],
    segundo_producto: ['2º producto',        '#d97706', 'fa-plus'],
    manual:           ['Marcado a mano',     '#64748b', 'fa-hand-pointer'],
};
const REV_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function revMonthLabel(mo) {
    if (mo === 'sin-fecha') return 'Sin fecha';
    const [y, m] = mo.split('-');
    return `${REV_MESES[+m - 1] || mo} ${y}`;
}

const REV_CSS = `<style>
.rev-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}
.rev-chip{border:1.5px solid;background:transparent;border-radius:999px;padding:4px 11px;font-size:.78rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px;line-height:1}
.rev-chip b{font-weight:800}
.rev-total{font-size:.85rem;color:var(--color-text-light,#64748b);margin-bottom:10px;font-weight:600}
.rev-month{border:1px solid var(--color-border,#e5e7eb);border-radius:10px;margin-bottom:10px;overflow:hidden;background:var(--color-card-bg,#fff)}
.rev-month>summary{list-style:none;cursor:pointer;padding:10px 13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--color-subtle-bg,#f8fafc);user-select:none}
.rev-month>summary::-webkit-details-marker{display:none}
.rev-month>summary::before{content:'▸';color:var(--color-text-light,#94a3b8);transition:transform .15s;font-size:.8rem}
.rev-month[open]>summary::before{transform:rotate(90deg)}
.rev-month-title{font-weight:800;font-size:1rem}
.rev-month-count{background:#7c3aed;color:#fff;border-radius:999px;padding:1px 9px;font-size:.75rem;font-weight:800}
.rev-month-break{color:var(--color-text-light,#94a3b8);font-size:.72rem;margin-left:auto;text-align:right}
.rev-rows{padding:4px}
.rev-row{padding:8px 9px;border-radius:7px}
.rev-row:hover{background:var(--color-subtle-bg,#f8fafc)}
.rev-row+.rev-row{border-top:1px solid var(--color-border,#f1f5f9)}
.rev-row-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.rev-row-main{display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}
.rev-num{font-weight:800;color:#7c3aed}
.rev-name{font-weight:600}
.rev-est{font-size:.72rem;color:var(--color-text-light,#94a3b8);background:var(--color-subtle-bg,#f1f5f9);padding:1px 7px;border-radius:6px}
.rev-row-tags{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.rev-tag{font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.rev-ia-btn{border:1px solid #7c3aed;background:transparent;color:#7c3aed;border-radius:6px;padding:2px 8px;font-size:.72rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.rev-ia-slot:not(:empty){margin-top:7px}
.rev-ia-badge{padding:7px 10px;border-radius:8px;font-size:.78rem;line-height:1.4}
.rev-ia-actions{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
.rev-ia-actions button{border:none;border-radius:6px;padding:3px 11px;font-size:.74rem;font-weight:800;cursor:pointer}
.rev-batchbar{display:flex;align-items:center;gap:10px;padding:4px 4px 8px;flex-wrap:wrap}
.rev-batch-btn{border:1px solid #7c3aed;background:#7c3aed14;color:#7c3aed;border-radius:7px;padding:4px 11px;font-size:.76rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.rev-batch-prog{font-size:.74rem;color:var(--color-text-light,#94a3b8);font-weight:600}
</style>`;

function RevisionViewTemplate() {
    return `<div id="revision-view" class="p-4 md:p-6 h-full overflow-auto">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <h1 class="text-2xl font-bold" style="margin:0"><i class="fas fa-list-check mr-2" style="color:#7c3aed"></i>Revisión de pendientes</h1>
            <span id="rev-updated" style="font-size:.75rem;color:var(--color-text-light,#94a3b8)"></span>
            <button onclick="renderRevisionView()" class="btn btn-outline btn-sm" title="Actualizar" style="margin-left:auto"><i class="fas fa-rotate"></i></button>
        </div>
        <p class="text-sm text-gray-500 mb-4">Todo lo que quedó pendiente de <b>nuestro</b> lado, mes por mes, para irlo cerrando: sin foto/mockup, video pedido sin enviar, pagado sin diseñar, ventas que no se cerraron, correcciones y reenvíos. Clic en un pedido abre su chat.</p>
        <div id="revision-container"><p class="text-gray-500">Cargando…</p></div>
    </div>`;
}
window.RevisionViewTemplate = RevisionViewTemplate;

async function renderRevisionView() {
    const container = document.getElementById('revision-container');
    if (!container) return;
    container.innerHTML = '<p class="text-gray-500">Cargando…</p>';
    try {
        const res = await fetch(`${API_BASE_URL}/api/pendientes/revision`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || ('HTTP ' + res.status));
        window._revData = data;
        _paintRevision();
        const upd = document.getElementById('rev-updated');
        if (upd) upd.textContent = 'actualizado ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        container.innerHTML = `<p style="color:#991b1b">No se pudo cargar la revisión: ${escapeHtml(e.message || String(e))}</p>
            <button class="btn btn-outline btn-sm mt-2" onclick="renderRevisionView()">Reintentar</button>`;
    }
}
window.renderRevisionView = renderRevisionView;

// Filtro por categoría (clic en un chip): muestra solo los pedidos con ese motivo.
function revSetFilter(r) { window._revFilter = (window._revFilter === r) ? null : r; _paintRevision(); }
window.revSetFilter = revSetFilter;

function revOrderRow(o) {
    const tags = (o.reasons || []).map(r => {
        const [label, color, icon] = REV_REASONS[r] || [r, '#64748b', 'fa-circle'];
        return `<span class="rev-tag" style="background:${color}1a;color:${color}"><i class="fas ${icon}"></i>${label}</span>`;
    }).join('');
    const chat = o.contactId ? `<button onclick="pendOpenChat('${escapeHtml(o.contactId)}')" class="pd-icon-btn" title="Abrir conversación"><i class="fas fa-comments"></i></button>` : '';
    const iaBtn = `<button class="rev-ia-btn" onclick="revRevisarIa('${escapeHtml(o.id)}')" title="Revisar la conversación con IA: ¿ya está resuelto?"><i class="fas fa-robot"></i> IA</button>`;
    const clickNum = o.contactId ? `onclick="pendOpenChat('${escapeHtml(o.contactId)}')" style="cursor:pointer"` : '';
    return `<div class="rev-row" data-roworder="${escapeHtml(o.id)}">
        <div class="rev-row-head">
            <div class="rev-row-main">
                <span class="rev-num" ${clickNum}>${escapeHtml(o.orderNumber || '')}</span>
                <span class="rev-name">${escapeHtml(o.name || '')}</span>
                <span class="rev-est">${escapeHtml(o.estatus || '')}</span>
                ${pendAgeBadge(o.createdAt)}
            </div>
            <div class="rev-row-tags">${tags}${iaBtn}${chat}</div>
        </div>
        <div class="rev-ia-slot" data-ia="${escapeHtml(o.id)}">${o.revisionIa ? revIaBadge(o.revisionIa, o) : ''}</div>
    </div>`;
}

function _paintRevision() {
    const container = document.getElementById('revision-container');
    const data = window._revData;
    if (!container || !data) return;
    const filter = window._revFilter || null;
    const totals = data.totals || { byReason: {}, total: 0 };

    const chips = Object.keys(REV_REASONS).filter(r => totals.byReason[r]).map(r => {
        const [label, color] = REV_REASONS[r];
        const on = filter === r;
        return `<button onclick="revSetFilter('${r}')" class="rev-chip" style="border-color:${color};${on ? `background:${color};color:#fff` : `color:${color}`}">${escapeHtml(label)} <b>${totals.byReason[r]}</b></button>`;
    }).join('');
    const chipsBar = `<div class="rev-chips">${chips}${filter ? `<button onclick="revSetFilter(null)" class="rev-chip" style="border-color:#94a3b8;color:#64748b"><i class="fas fa-xmark"></i> Quitar filtro</button>` : ''}</div>`;

    const monthsHtml = (data.months || []).map(mo => {
        let orders = mo.orders || [];
        if (filter) orders = orders.filter(o => (o.reasons || []).includes(filter));
        if (!orders.length) return '';
        const breakdown = Object.entries(mo.byReason || {}).filter(([r]) => !filter || r === filter)
            .sort((a, b) => b[1] - a[1])
            .map(([r, n]) => { const [label, color] = REV_REASONS[r] || [r, '#64748b']; return `<span style="color:${color}">${escapeHtml(label)}: ${n}</span>`; })
            .join(' · ');
        return `<details class="rev-month" open>
            <summary><span class="rev-month-title">${escapeHtml(revMonthLabel(mo.month))}</span><span class="rev-month-count">${orders.length}</span><span class="rev-month-break">${breakdown}</span></summary>
            <div class="rev-rows">
                <div class="rev-batchbar">
                    <button class="rev-batch-btn" onclick="revBatchMes('${escapeHtml(mo.month)}')"><i class="fas fa-robot"></i> Revisar estos con IA</button>
                    <span class="rev-batch-prog" id="rev-prog-${escapeHtml(mo.month)}"></span>
                </div>
                ${orders.map(revOrderRow).join('')}
            </div>
        </details>`;
    }).join('');

    const totalShown = filter ? (totals.byReason[filter] || 0) : totals.total;
    const sub = filter ? ('· ' + (REV_REASONS[filter] ? REV_REASONS[filter][0] : filter)) : 'pendientes de nuestro lado';
    container.innerHTML = REV_CSS + chipsBar
        + `<div class="rev-total">${totalShown} pedido(s) ${sub}</div>`
        + (monthsHtml || '<div class="pd-empty" style="padding:20px;text-align:center;color:#16a34a"><i class="fas fa-check-circle"></i> Nada pendiente 🎉</div>');
}

// --- Revisión con IA de la conversación --------------------------------------------------------
async function _revPost(path, body) {
    const opt = { method: 'POST' };
    if (body) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    const res = await fetch(`${API_BASE_URL}/api/${path}`, opt);
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.success === false) throw new Error(d.error || d.message || ('HTTP ' + res.status));
    return d;
}
function _revFindOrder(orderId) {
    for (const mo of ((window._revData || {}).months || [])) {
        const o = (mo.orders || []).find(x => x.id === orderId);
        if (o) return o;
    }
    return null;
}
function _revSlot(orderId) {
    return [...document.querySelectorAll('.rev-ia-slot[data-ia]')].find(el => el.getAttribute('data-ia') === String(orderId));
}

// Pinta el veredicto de la IA sobre un pedido.
function revIaBadge(v, o) {
    if (!v) return '';
    if (v.pending) return `<div class="rev-ia-badge" style="background:#eef2ff;color:#3730a3"><i class="fas fa-circle-notch fa-spin"></i> Revisando la conversación…</div>`;
    const conf = v.confianza ? ` · confianza ${escapeHtml(v.confianza)}` : '';
    if (v.resuelto) {
        const senal = v.senal ? `<div style="margin-top:3px;font-style:italic">“${escapeHtml(v.senal)}”</div>` : '';
        const sugEntregar = (v.estadoSugerido && /entreg/i.test(v.estadoSugerido)) || (o && (o.reasons || []).some(r => ['fabricar', 'corte', 'venta_sin_cerrar'].includes(r)));
        const actions = `<div class="rev-ia-actions">
            ${(o && o.contactId && sugEntregar) ? `<button style="background:#16a34a;color:#fff" onclick="revMarcarEntregado('${escapeHtml(o.id)}')">Marcar entregado</button>` : ''}
            ${(o && o.contactId) ? `<button style="background:#e5e7eb;color:#374151" onclick="pendOpenChat('${escapeHtml(o.contactId)}')">Abrir chat</button>` : ''}
        </div>`;
        return `<div class="rev-ia-badge" style="background:#dcfce7;color:#166534">
            <div style="font-weight:800"><i class="fas fa-circle-check"></i> Parece que YA está resuelto${conf}</div>
            ${v.explicacion ? `<div style="margin-top:2px">${escapeHtml(v.explicacion)}</div>` : ''}${senal}${actions}</div>`;
    }
    if (v.error) {
        return `<div class="rev-ia-badge" style="background:#e5e7eb;color:#374151"><i class="fas fa-triangle-exclamation"></i> No se pudo revisar. <a onclick="revRevisarIa('${escapeHtml(o.id)}', true)" style="cursor:pointer;text-decoration:underline">Reintentar</a></div>`;
    }
    return `<div class="rev-ia-badge" style="background:#fef9c3;color:#854d0e"><i class="fas fa-hourglass-half"></i> Sigue pendiente según la conversación${conf}${v.explicacion ? ' — ' + escapeHtml(v.explicacion) : ''}</div>`;
}

// Revisa UN pedido: la IA lee su conversación y dice si ya está resuelto. Cachea en el server.
async function revRevisarIa(orderId, force) {
    const o = _revFindOrder(orderId);
    const slot = _revSlot(orderId);
    if (slot) slot.innerHTML = revIaBadge({ pending: true }, o);
    try {
        const r = await _revPost(`pendientes/revision/${orderId}/revisar-ia`, force ? { force: true } : null);
        const v = (r && r.verdict) || { error: 'sin respuesta' };
        if (o) o.revisionIa = v;
        const s2 = _revSlot(orderId); if (s2) s2.innerHTML = revIaBadge(v, o);
    } catch (e) {
        const s2 = _revSlot(orderId); if (s2) s2.innerHTML = revIaBadge({ error: e.message || 'error' }, o);
    }
}
window.revRevisarIa = revRevisarIa;

// Marca el pedido como Entregado (reusa /orders/:id/change-status, que recalcula pendientes) y lo saca.
async function revMarcarEntregado(orderId) {
    const o = _revFindOrder(orderId);
    if (!o) return;
    if (!confirm(`¿Marcar ${o.orderNumber} como ENTREGADO? Se quita de los pendientes.`)) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}/change-status`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newStatus: 'Entregado' }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.success) throw new Error(d.message || ('HTTP ' + res.status));
        _revRemoveOrder(orderId);
        if (typeof pendToast === 'function') pendToast(`${o.orderNumber} marcado como entregado ✅`, {});
    } catch (e) { alert('No se pudo marcar entregado: ' + (e.message || e)); }
}
window.revMarcarEntregado = revMarcarEntregado;

function _revRemoveOrder(orderId) {
    const data = window._revData;
    if (!data) return;
    (data.months || []).forEach(mo => {
        const i = (mo.orders || []).findIndex(x => x.id === orderId);
        if (i < 0) return;
        const [rm] = mo.orders.splice(i, 1);
        mo.total = Math.max(0, (mo.total || 1) - 1);
        (rm.reasons || []).forEach(r => {
            if (mo.byReason && mo.byReason[r]) mo.byReason[r]--;
            if (data.totals && data.totals.byReason && data.totals.byReason[r]) data.totals.byReason[r]--;
        });
        if (data.totals) data.totals.total = Math.max(0, (data.totals.total || 1) - 1);
    });
    _paintRevision();
}

// Revisa con IA TODOS los pedidos VISIBLES de un mes (respeta el filtro de categoría activo). Con tope
// de concurrencia y confirmación, porque cada pedido usa una llamada a la IA.
async function revBatchMes(month) {
    const data = window._revData;
    if (!data) return;
    const mo = (data.months || []).find(m => m.month === month);
    if (!mo) return;
    const filter = window._revFilter || null;
    const orders = (mo.orders || []).filter(o => !o.revisionIa && (!filter || (o.reasons || []).includes(filter)));
    const prog = document.getElementById('rev-prog-' + month);
    const total = orders.length;
    if (!total) { if (prog) prog.textContent = 'Nada nuevo que revisar (ya revisados).'; return; }
    if (!confirm(`Revisar ${total} pedido(s) de ${revMonthLabel(month)} con IA?\nCada pedido usa una llamada a la IA.`)) return;
    let done = 0;
    if (prog) prog.textContent = `Revisando… 0/${total}`;
    const queue = orders.slice();
    const worker = async () => {
        while (queue.length) {
            const o = queue.shift();
            await revRevisarIa(o.id);
            done++;
            if (prog) prog.textContent = `Revisando… ${done}/${total}`;
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
    if (prog) prog.textContent = `Listo: ${total} revisados.`;
}
window.revBatchMes = revBatchMes;
