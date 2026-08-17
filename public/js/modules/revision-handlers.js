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
.rev-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 9px;border-radius:7px;flex-wrap:wrap}
.rev-row:hover{background:var(--color-subtle-bg,#f8fafc)}
.rev-row+.rev-row{border-top:1px solid var(--color-border,#f1f5f9)}
.rev-row-main{display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}
.rev-num{font-weight:800;color:#7c3aed}
.rev-name{font-weight:600}
.rev-est{font-size:.72rem;color:var(--color-text-light,#94a3b8);background:var(--color-subtle-bg,#f1f5f9);padding:1px 7px;border-radius:6px}
.rev-row-tags{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.rev-tag{font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
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
    const clickNum = o.contactId ? `onclick="pendOpenChat('${escapeHtml(o.contactId)}')" style="cursor:pointer"` : '';
    return `<div class="rev-row">
        <div class="rev-row-main">
            <span class="rev-num" ${clickNum}>${escapeHtml(o.orderNumber || '')}</span>
            <span class="rev-name">${escapeHtml(o.name || '')}</span>
            <span class="rev-est">${escapeHtml(o.estatus || '')}</span>
            ${pendAgeBadge(o.createdAt)}
        </div>
        <div class="rev-row-tags">${tags}${chat}</div>
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
            <div class="rev-rows">${orders.map(revOrderRow).join('')}</div>
        </details>`;
    }).join('');

    const totalShown = filter ? (totals.byReason[filter] || 0) : totals.total;
    const sub = filter ? ('· ' + (REV_REASONS[filter] ? REV_REASONS[filter][0] : filter)) : 'pendientes de nuestro lado';
    container.innerHTML = REV_CSS + chipsBar
        + `<div class="rev-total">${totalShown} pedido(s) ${sub}</div>`
        + (monthsHtml || '<div class="pd-empty" style="padding:20px;text-align:center;color:#16a34a"><i class="fas fa-check-circle"></i> Nada pendiente 🎉</div>');
}
