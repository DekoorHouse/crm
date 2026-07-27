// --- Panel "Negocio" de la sección Métricas -------------------------------------------------
// Responde 8 preguntas del negocio con datos reales (GET /api/business-metrics):
//   1. Conversaciones nuevas por día          5. ¿En cuántas horas pagan tras el pedido listo?
//   2. Cuántas no contestan el 1er mensaje    6. Horario más frecuente de pago
//   3. Pedidos por día                        7. Quién pide video y cuántos de esos pagan
//   4. Comprobantes de pago y cuánto suman    8. Quién no responde a la foto del pedido (/cuatro)
// Más el EMBUDO completo y la CARTERA por cobrar.
//
// La sección Métricas ya no está en el menú: se abre con Ctrl+Alt+M (ver ui-manager.js).

const BM_STATE = { days: 30, data: null, seq: 0, charts: {} };

const BM_MONEY = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
const BM_NUM = (n) => Number(n || 0).toLocaleString('es-MX');
const BM_PCT = (n) => (Number(n) || 0).toFixed(1).replace(/\.0$/, '') + '%';
const BM_WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
/** "14 h" legible a partir de la hora 0-23. */
const BM_HOUR = (h) => `${String(h).padStart(2, '0')}:00`;

/** Lee un color del tema activo (para que las gráficas se vean bien en claro y oscuro). */
function bmCssVar(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
}

// Paleta del panel. Se rellena en cada pintado con la variante clara u oscura: el navy de marca
// sobre el fondo oscuro del tema Obsidian (#24283B) es ilegible, así que ahí se usan los tonos
// brillantes de ese tema. Los tokens del tema solo se usan para texto y rejilla.
const BM_COLORS = {};
// El ámbar y el gris van más oscuros que los del tema: sobre blanco, #f59e0b da 2.1:1 de
// contraste (ilegible en un número grande) y #94a3b8 tampoco alcanza el 3:1 de una barra.
const BM_PALETTE_LIGHT = { navy: '#163C51', orange: '#ea580c', green: '#1d9e75', red: '#e24b4a', amber: '#b45309', teal: '#0d9488', purple: '#6f42c1', gray: '#64748b' };
const BM_PALETTE_DARK = { navy: '#7aa2f7', orange: '#fb923c', green: '#9ece6a', red: '#f7768e', amber: '#e0af68', teal: '#2dd4bf', purple: '#bb9af7', gray: '#9aa0bd' };
function bmSyncPalette() {
    Object.assign(BM_COLORS, document.body.classList.contains('dark-mode') ? BM_PALETTE_DARK : BM_PALETTE_LIGHT);
}
bmSyncPalette();

// ===== Plantilla ============================================================================
function BusinessMetricsTemplate() {
    return `
    <div class="bm-panel">
        <div class="bm-toolbar">
            <div>
                <h2 class="bm-title"><i class="fas fa-chart-simple"></i> Negocio</h2>
                <p class="bm-sub">Todo en hora de CDMX. Los promedios por día excluyen hoy (día incompleto).</p>
            </div>
            <div class="bm-range">
                ${[7, 30, 90].map(d => `<button class="btn btn-subtle btn-sm bm-range-btn${d === BM_STATE.days ? ' active' : ''}" data-days="${d}">${d} días</button>`).join('')}
                <button class="btn btn-primary btn-sm" id="bm-refresh" title="Recalcular"><i class="fas fa-rotate"></i></button>
            </div>
        </div>
        <div class="bm-atajo" id="bm-atajo"></div>
        <div id="bm-body">
            <div class="bm-loading"><i class="fas fa-spinner fa-spin"></i> Calculando métricas del negocio…</div>
        </div>
    </div>`;
}
window.BusinessMetricsTemplate = BusinessMetricsTemplate;

/** Tarjeta de KPI: número grande + apoyo + pie. */
function bmKpi({ label, value, sub, foot, color, icon }) {
    return `<div class="bm-kpi">
        <div class="bm-kpi-label">${icon ? `<i class="fas ${icon}"></i> ` : ''}${label}</div>
        <div class="bm-kpi-value" style="color:${color || 'var(--color-text)'}">${value}</div>
        ${sub ? `<div class="bm-kpi-sub">${sub}</div>` : ''}
        ${foot ? `<div class="bm-kpi-foot">${foot}</div>` : ''}
    </div>`;
}

/** Renglón de barra horizontal (para ventanas de pago, cartera, etc.). */
function bmBar({ label, count, extra, pct, max, color }) {
    const width = max > 0 ? Math.max(1.5, (count / max) * 100) : 0;
    return `<div class="bm-bar-row">
        <div class="bm-bar-label">${label}</div>
        <div class="bm-bar-track"><div class="bm-bar-fill" style="width:${width}%;background:${color}"></div></div>
        <div class="bm-bar-value">${BM_NUM(count)}${pct != null ? ` <span class="bm-bar-pct">${BM_PCT(pct)}</span>` : ''}</div>
        ${extra ? `<div class="bm-bar-extra">${extra}</div>` : ''}
    </div>`;
}

// ===== Carga y pintado ======================================================================
async function renderBusinessMetrics(fresh) {
    const body = document.getElementById('bm-body');
    if (!body) return;
    // Un rango largo tarda; si mientras carga el usuario pide otro, gana el ÚLTIMO pedido
    // (si no, se quedaría pintado el resultado del rango viejo bajo el botón nuevo).
    const seq = (BM_STATE.seq = (BM_STATE.seq || 0) + 1);
    const days = BM_STATE.days;
    body.innerHTML = `<div class="bm-loading"><i class="fas fa-spinner fa-spin"></i> Calculando ${days} días…
        <span class="bm-loading-note">la primera vez de cada rango tarda unos segundos; después queda guardado</span></div>`;
    try {
        const res = await fetch(`${API_BASE_URL}/api/business-metrics?days=${days}${fresh ? '&fresh=1' : ''}`);
        const data = await res.json();
        if (seq !== BM_STATE.seq) return;   // llegó tarde: ya hay otra petición en curso
        if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
        BM_STATE.data = data;
        bmPaint(data);
    } catch (e) {
        if (seq !== BM_STATE.seq) return;
        body.innerHTML = `<div class="bm-error"><i class="fas fa-triangle-exclamation"></i>
            No se pudieron calcular las métricas: ${escapeHtml(e.message || String(e))}
            <button class="btn btn-outline btn-sm" onclick="renderBusinessMetrics()">Reintentar</button></div>`;
    }
}
window.renderBusinessMetrics = renderBusinessMetrics;

function bmPaint(d) {
    bmSyncPalette(); // el usuario pudo cambiar de tema desde la última vez
    const c = d.conversations, o = d.orders, r = d.receipts, pw = d.payWindows;
    const ph = d.payHours, v = d.video, pn = d.photoNoReply, f = d.funnel, pp = d.pendingPayment;

    // Aviso de historia incompleta: los sellos de pago/entrega se agregaron al CRM hace poco, así
    // que en un rango largo las primeras semanas salen en cero y parecería una caída de ventas.
    const gapDays = (day) => day ? Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(d.range.from + 'T12:00:00Z')) / 86400000) : 0;
    const gaps = [];
    if (gapDays(d.meta.firstReceiptDay) > 2) gaps.push(`comprobantes de pago desde el <b>${d.meta.firstReceiptDay}</b>`);
    if (gapDays(d.meta.firstReadySentDay) > 2) gaps.push(`envíos de pedido terminado desde el <b>${d.meta.firstReadySentDay}</b>`);

    document.getElementById('bm-body').innerHTML = `
        ${gaps.length ? `<div class="bm-warn"><i class="fas fa-circle-info"></i>
            El rango empieza el ${d.range.from}, pero solo hay ${gaps.join(' y ')} — esos campos se
            empezaron a registrar en el CRM después. Antes de esas fechas los números salen en cero
            porque no hay historia, no porque no se vendiera.</div>` : ''}
        <div class="bm-kpis">
            ${bmKpi({
                icon: 'fa-comments', label: 'Conversaciones nuevas', color: BM_COLORS.navy,
                value: BM_NUM(c.avgPerDay) + ' <small>/día</small>',
                sub: `${BM_NUM(c.total)} en ${d.range.days} días`,
                foot: `Hoy: <b>${BM_NUM(c.today)}</b>`,
            })}
            ${bmKpi({
                icon: 'fa-ghost', label: 'No contestan el 1er mensaje', color: BM_COLORS.red,
                value: BM_PCT(c.noReplyPct),
                sub: `${BM_NUM(c.noReply)} de ${BM_NUM(c.settledTotal)} conversaciones`,
                foot: `Sí platican: <b>${BM_PCT(c.engagedPct)}</b>`,
            })}
            ${bmKpi({
                icon: 'fa-box', label: 'Pedidos registrados', color: BM_COLORS.orange,
                value: BM_NUM(o.avgPerDay) + ' <small>/día</small>',
                sub: `${BM_NUM(o.total)} pedidos · ticket ${BM_MONEY(o.avgTicket)}`,
                foot: `Hoy: <b>${BM_NUM(o.today)}</b>`,
            })}
            ${bmKpi({
                icon: 'fa-receipt', label: 'Comprobantes de pago', color: BM_COLORS.green,
                value: BM_NUM(r.count),
                sub: `<b>${BM_MONEY(r.value)}</b> en total`,
                foot: `${BM_NUM(r.avgPerDay)} pagos y ${BM_MONEY(r.valuePerDay)} por día`,
            })}
            ${bmKpi({
                icon: 'fa-stopwatch', label: 'Pagan en menos de 24 h', color: BM_COLORS.teal,
                value: BM_PCT(pw.cumulative.h24.pct),
                sub: `${BM_NUM(pw.cumulative.h24.count)} de ${BM_NUM(pw.cumulative.h24.base)} pedidos entregados`,
                foot: pw.medianHours != null ? `Mitad paga antes de <b>${pw.medianHours} h</b>` : '&nbsp;',
            })}
            ${bmKpi({
                icon: 'fa-hand-holding-dollar', label: 'Por cobrar (todo el histórico)', color: BM_COLORS.amber,
                value: BM_MONEY(pp.value),
                sub: `${BM_NUM(pp.count)} pedidos entregados sin pago`,
                foot: `De esta semana: <b>${BM_MONEY((pp.buckets[0] || {}).value || 0)}</b>`,
            })}
        </div>

        <div class="settings-card bm-card">
            <h3 class="bm-h3">Embudo · de la conversación al dinero</h3>
            <p class="bm-note">Sigue a los pedidos que NACIERON en el rango, y cada paso es un subconjunto del anterior.</p>
            <div class="bm-funnel">
                ${bmFunnelStep('Conversaciones nuevas', f.conversations, null, BM_COLORS.navy)}
                ${bmFunnelStep('Pedidos registrados', f.orders, f.convToOrderPct, BM_COLORS.orange)}
                ${bmFunnelStep('Pedido terminado enviado', f.readySent, f.orderToReadyPct, BM_COLORS.purple)}
                ${bmFunnelStep('De esos, pagados', f.paid, f.readyToPaidPct, BM_COLORS.green)}
            </div>
            <div class="bm-funnel-foot">
                De cada 100 conversaciones nuevas, <b>${BM_PCT(f.convToPaidPct)}</b> termina pagando
                (${BM_NUM(f.paidTotal)} pedidos pagados en total) ·
                Facturado en el rango: <b>${BM_MONEY(f.revenue)}</b> ·
                Cada conversación nueva vale <b>${BM_MONEY(f.revenuePerConversation)}</b>
                ${f.paidWithoutReadyStamp > 0 ? `<br><span class="bm-tiny"><i class="fas fa-circle-info"></i>
                   El paso «pedido terminado enviado» va corto: solo cuenta los envíos con sello, y
                   ${BM_NUM(f.paidWithoutReadyStamp)} pedidos pagaron sin él. El módulo Mockup siempre sella;
                   la respuesta rápida /cuatro del chat apenas empezó a sellarse, así que las fechas
                   anteriores no la traen. En unas semanas el paso queda completo.</span>` : ''}
            </div>
        </div>

        <div class="bm-grid2">
            <div class="settings-card bm-card">
                <h3 class="bm-h3">1 y 2 · Conversaciones nuevas y quién se queda callado</h3>
                <p class="bm-note">Barra completa = conversaciones que llegaron ese día. La parte roja = las que ya no volvieron a escribir después de nuestra primera respuesta.</p>
                <div class="bm-chart"><canvas id="bm-chart-conv"></canvas></div>
            </div>
            <div class="settings-card bm-card">
                <h3 class="bm-h3">3 y 4 · Pedidos y dinero cobrado por día</h3>
                <p class="bm-note">Barras = pedidos registrados. Línea = pesos de los comprobantes validados ese día.</p>
                <div class="bm-chart"><canvas id="bm-chart-orders"></canvas></div>
            </div>
        </div>

        <div class="bm-grid2">
            <div class="settings-card bm-card">
                <h3 class="bm-h3">5 · ¿Cuánto tardan en pagar después de recibir su pedido terminado?</h3>
                <p class="bm-note">Les mandamos foto + datos de pago a <b>${BM_NUM(pw.sent)}</b> pedidos en el rango.${pw.prepaid > 0
                    ? ` De esos, ${BM_NUM(pw.prepaid)} ya habían pagado antes (anticipo o pago durante la venta) y no cuentan aquí:
                        quedan <b>${BM_NUM(pw.cohort)}</b> que debían al recibirlo.` : ''}</p>
                ${pw.cohort === 0 ? '<p class="bm-empty">Sin pedidos entregados en este rango.</p>' : `
                <div class="bm-bars">
                    ${pw.buckets.map((b, i) => bmBar({
                        label: b.label, count: b.count, pct: b.pctOfPaid, max: Math.max(...pw.buckets.map(x => x.count)),
                        color: [BM_COLORS.green, BM_COLORS.teal, BM_COLORS.amber, BM_COLORS.orange, BM_COLORS.gray][i],
                    })).join('')}
                    ${bmBar({ label: '<b>Todavía sin pagar</b>', count: pw.unpaid, pct: null, max: Math.max(...pw.buckets.map(x => x.count)), color: BM_COLORS.red })}
                </div>
                <p class="bm-note" style="margin:10px 0 4px">El % de arriba es <b>de los ${BM_NUM(pw.paid)} que ya pagaron</b> (cuándo pagaron).
                   Abajo, el % <b>de todos los clientes</b>: cada ventana solo cuenta a quienes ya tuvieron ese tiempo completo para pagar.</p>
                <div class="bm-cum">
                    ${['h4', 'h8', 'h12', 'h24'].map(k => `<div class="bm-cum-item">
                        <div class="bm-cum-label">Pagó en ≤ ${k.slice(1)} h</div>
                        <div class="bm-cum-val">${BM_PCT(pw.cumulative[k].pct)}</div>
                        <div class="bm-cum-sub">${BM_NUM(pw.cumulative[k].count)} de ${BM_NUM(pw.cumulative[k].base)}</div>
                    </div>`).join('')}
                </div>
                <p class="bm-note">Promedio ${pw.avgHours != null ? pw.avgHours + ' h' : '—'} ·
                   mediana ${pw.medianHours != null ? pw.medianHours + ' h' : '—'} ·
                   de los que ya llevan más de 24 h, pagó <b>${BM_PCT(pw.maturePaidPct)}</b>.</p>`}
            </div>
            <div class="settings-card bm-card">
                <h3 class="bm-h3">6 · ¿A qué hora nos pagan?</h3>
                <p class="bm-note">${ph.total > 0 ? `Hora pico: <b>${BM_HOUR(ph.topHour)}</b> (${BM_NUM(ph.topHourCount)} pagos).
                   Mejor bloque de 3 h: <b>${BM_HOUR(ph.topBlock)} a ${BM_HOUR((ph.topBlock + 3) % 24)}</b> con ${BM_NUM(ph.topBlockCount)} de ${BM_NUM(ph.total)} pagos.` : 'Sin pagos en el rango.'}</p>
                <div class="bm-chart"><canvas id="bm-chart-hours"></canvas></div>
                <div class="bm-weekdays">
                    ${(ph.weekdays || []).map((n, i) => {
                        const max = Math.max(1, ...(ph.weekdays || [1]));
                        return `<div class="bm-wd"><div class="bm-wd-bar" style="height:${Math.max(4, (n / max) * 52)}px"></div>
                            <div class="bm-wd-n">${BM_NUM(n)}</div><div class="bm-wd-d">${BM_WEEKDAYS[i]}</div></div>`;
                    }).join('')}
                </div>
            </div>
        </div>

        <div class="bm-grid2">
            <div class="settings-card bm-card">
                <h3 class="bm-h3">7 · Piden video de su pedido</h3>
                <p class="bm-note">Clientes que pidieron un video o foto extra de su producto ya terminado.</p>
                ${v.requested === 0 ? '<p class="bm-empty">Nadie pidió video en este rango.</p>' : `
                <div class="bm-duo">
                    <div><div class="bm-duo-val" style="color:${BM_COLORS.purple}">${BM_NUM(v.requested)}</div><div class="bm-duo-lbl">pidieron video</div></div>
                    <div><div class="bm-duo-val" style="color:${BM_COLORS.green}">${BM_NUM(v.paid)}</div><div class="bm-duo-lbl">de esos ya pagaron</div></div>
                    <div><div class="bm-duo-val" style="color:${v.paidPct >= v.baselinePaidPct ? BM_COLORS.green : BM_COLORS.red}">${BM_PCT(v.paidPct)}</div><div class="bm-duo-lbl">tasa de pago</div></div>
                </div>
                <p class="bm-note">Comparado con <b>${BM_PCT(v.baselinePaidPct)}</b> de todos los que reciben su pedido terminado.
                   ${v.paidPct >= v.baselinePaidPct
                        ? 'Pedir video es <b>buena señal</b>: pagan igual o más que el promedio — vale la pena grabarlo rápido.'
                        : 'Piden video y pagan <b>menos</b> que el promedio: el video se está usando para ganar tiempo o hay dudas sin resolver.'}
                   ${v.mature < v.requested ? `<br><span class="bm-tiny">(${BM_NUM(v.requested - v.mature)} pidieron hace menos de 24 h y no cuentan en la tasa)</span>` : ''}</p>
                <div class="bm-money">Ya cobrado de estos pedidos: <b>${BM_MONEY(v.value)}</b></div>`}
            </div>
            <div class="settings-card bm-card">
                <h3 class="bm-h3">8 · No responden a la foto del pedido terminado</h3>
                <p class="bm-note">De los ${BM_NUM(pn.base)} pedidos que llevan más de 24 h con su foto enviada (/cuatro)
                   y que todavía debían al recibirla.</p>
                ${pn.base === 0 ? '<p class="bm-empty">Sin pedidos entregados con 24 h de antigüedad en el rango.</p>' : `
                <div class="bm-duo">
                    <div><div class="bm-duo-val" style="color:${BM_COLORS.red}">${BM_PCT(pn.noReplyPct)}</div><div class="bm-duo-lbl">no contestaron nada</div></div>
                    <div><div class="bm-duo-val">${BM_NUM(pn.matureNoReply)}</div><div class="bm-duo-lbl">clientes callados</div></div>
                    <div><div class="bm-duo-val" style="color:${BM_COLORS.green}">${BM_PCT(pn.noReplyPaidPct)}</div><div class="bm-duo-lbl">de los callados sí pagó</div></div>
                </div>
                <div class="bm-bars bm-bars-tight">
                    ${bmBar({ label: 'Contestaron → pagaron', count: pn.repliedPaid, pct: pn.repliedPaidPct, max: Math.max(pn.matureReplied, pn.matureNoReply), color: BM_COLORS.green })}
                    ${bmBar({ label: 'Contestaron → sin pagar', count: pn.matureReplied - pn.repliedPaid, pct: null, max: Math.max(pn.matureReplied, pn.matureNoReply), color: BM_COLORS.amber })}
                    ${bmBar({ label: 'Callados → pagaron', count: pn.noReplyPaid, pct: null, max: Math.max(pn.matureReplied, pn.matureNoReply), color: BM_COLORS.teal })}
                    ${bmBar({ label: 'Callados → sin pagar', count: pn.matureNoReply - pn.noReplyPaid, pct: null, max: Math.max(pn.matureReplied, pn.matureNoReply), color: BM_COLORS.red })}
                </div>
                <p class="bm-note">Quien contesta paga <b>${BM_PCT(pn.repliedPaidPct)}</b> de las veces; quien no contesta, <b>${BM_PCT(pn.noReplyPaidPct)}</b>
                   — y es normal que sea casi 0, porque el comprobante llega justamente como mensaje.
                   Lo que importa aquí es el <b>tamaño</b> del grupo callado: son ${BM_NUM(pn.matureNoReply)} pedidos ya fabricados
                   y sin cobrar, la lista más rentable para perseguir a mano.</p>`}
            </div>
        </div>

        <div class="settings-card bm-card">
            <h3 class="bm-h3">Cartera por cobrar</h3>
            <p class="bm-note">Pedidos en «Foto enviada», «Esperando pago» o «Corregido» que nunca registraron comprobante, de cualquier fecha.</p>
            <div class="bm-bars">
                ${(pp.buckets || []).map((b, i) => bmBar({
                    label: b.label, count: b.count, extra: BM_MONEY(b.value),
                    max: Math.max(...(pp.buckets || [{ count: 1 }]).map(x => x.count)),
                    color: [BM_COLORS.green, BM_COLORS.amber, BM_COLORS.gray][i],
                })).join('')}
            </div>
        </div>

        <p class="bm-foot">Calculado ${new Date(d.meta.computedAt).toLocaleString('es-MX')}${d.fromCache ? ' · desde caché (10 min)' : ''} ·
           ${BM_NUM(d.meta.recomputedDays)} día(s) recalculados · rango ${d.range.from} a ${d.range.to}</p>
    `;

    bmDrawCharts(d);
}

function bmFunnelStep(label, value, pctFromPrev, color) {
    return `<div class="bm-fn-step">
        ${pctFromPrev != null ? `<div class="bm-fn-arrow"><i class="fas fa-chevron-right"></i><span>${BM_PCT(pctFromPrev)}</span></div>` : ''}
        <div class="bm-fn-box" style="border-top-color:${color}">
            <div class="bm-fn-val">${BM_NUM(value)}</div>
            <div class="bm-fn-lbl">${label}</div>
        </div>
    </div>`;
}

// ===== Gráficas =============================================================================
function bmDrawCharts(d) {
    if (typeof Chart === 'undefined') return;
    Object.values(BM_STATE.charts).forEach(ch => { try { ch.destroy(); } catch (_) {} });
    BM_STATE.charts = {};

    const text = bmCssVar('--color-text-light', '#5f5e5a');
    const grid = bmCssVar('--color-border', 'rgba(0,0,0,.08)');
    const base = {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } } },
        scales: {
            x: { stacked: false, ticks: { color: text, maxRotation: 0, autoSkipPadding: 12, font: { size: 10 } }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { color: text, precision: 0, font: { size: 10 } }, grid: { color: grid } },
        },
    };
    const labels = d.daily.map(r => r.label);

    // 1 y 2 — conversaciones nuevas, apiladas: contestaron vs. se quedaron callados
    const convCtx = document.getElementById('bm-chart-conv');
    if (convCtx) {
        BM_STATE.charts.conv = new Chart(convCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Sí siguieron platicando', data: d.daily.map(r => Math.max(0, r.newConversations - r.noReply - r.neverAnswered)), backgroundColor: BM_COLORS.navy, borderRadius: 3, stack: 'c' },
                    { label: 'No contestaron', data: d.daily.map(r => r.noReply), backgroundColor: BM_COLORS.red, borderRadius: 3, stack: 'c' },
                    { label: 'Nunca les contestamos', data: d.daily.map(r => r.neverAnswered), backgroundColor: BM_COLORS.amber, borderRadius: 3, stack: 'c' },
                ],
            },
            options: { ...base, scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } } },
        });
    }

    // 3 y 4 — pedidos (barras) vs. dinero cobrado (línea, eje derecho)
    const ordCtx = document.getElementById('bm-chart-orders');
    if (ordCtx) {
        BM_STATE.charts.orders = new Chart(ordCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Pedidos', data: d.daily.map(r => r.orders), backgroundColor: BM_COLORS.orange, borderRadius: 3, yAxisID: 'y' },
                    { label: 'Comprobantes', data: d.daily.map(r => r.receipts), backgroundColor: BM_COLORS.teal, borderRadius: 3, yAxisID: 'y' },
                    { label: '$ cobrado', data: d.daily.map(r => r.receiptsValue), type: 'line', borderColor: BM_COLORS.green, backgroundColor: BM_COLORS.green, borderWidth: 2, pointRadius: 2, tension: 0.3, yAxisID: 'y2' },
                ],
            },
            options: {
                ...base,
                scales: {
                    ...base.scales,
                    y2: {
                        position: 'right', beginAtZero: true, grid: { display: false },
                        ticks: { color: text, font: { size: 10 }, callback: (val) => '$' + (val / 1000) + 'k' },
                    },
                },
            },
        });
    }

    // 6 — histograma de horas de pago (la hora pico resaltada)
    const hCtx = document.getElementById('bm-chart-hours');
    if (hCtx) {
        BM_STATE.charts.hours = new Chart(hCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: d.payHours.hours.map(h => String(h.hour).padStart(2, '0')),
                datasets: [{
                    label: 'Pagos',
                    data: d.payHours.hours.map(h => h.count),
                    backgroundColor: d.payHours.hours.map(h => h.hour === d.payHours.topHour ? BM_COLORS.orange : BM_COLORS.navy),
                    borderRadius: 3,
                }],
            },
            options: { ...base, plugins: { legend: { display: false } } },
        });
    }
}

// ===== Selector del atajo de teclado ========================================================
// No todas las combinaciones llegan al navegador (distribución del teclado, extensiones,
// programas que se apropian de combinaciones globales). En vez de adivinar cuál sí pasa, aquí
// se graba la que el usuario quiera y se ve EN VIVO lo que el navegador reporta: si al presionar
// una combinación no aparece nada, esa combinación no llega y hay que elegir otra.
function bmPintarAtajo(msg) {
    const el = document.getElementById('bm-atajo');
    if (!el) return;
    const actual = formatMetricasAtajo(getMetricasAtajo());
    const grabando = !!window._grabandoAtajoMetricas;
    el.innerHTML = grabando
        ? `<span class="bm-atajo-rec"><i class="fas fa-keyboard"></i> Presiona la combinación que quieras…</span>
           <span class="bm-atajo-eco">${msg || 'esperando…'}</span>
           <button class="btn btn-subtle btn-sm" data-atajo="cancelar">Cancelar</button>`
        : `<span><i class="fas fa-keyboard"></i> Atajo para abrir Métricas: <b>${escapeHtml(actual)}</b></span>
           <button class="btn btn-subtle btn-sm" data-atajo="cambiar">Cambiar</button>
           ${actual !== formatMetricasAtajo(window.METRICAS_ATAJO_DEFAULT)
                ? '<button class="btn btn-subtle btn-sm" data-atajo="restaurar">Restaurar Ctrl+Alt+M</button>' : ''}
           <span class="bm-atajo-eco">También abre con <b>#metricas</b> en la URL o 5 clics en el logo.</span>`;
}

function bmGrabarAtajo(activar) {
    window._grabandoAtajoMetricas = !!activar;
    if (activar && !window._bmAtajoListener) {
        // En captura: así se ve la tecla aunque otro handler la consuma después.
        window._bmAtajoListener = (e) => {
            if (!window._grabandoAtajoMetricas) return;
            if (e.code === 'Escape') { bmGrabarAtajo(false); bmPintarAtajo(); return; }
            const sc = atajoDesdeEvento(e);
            if (!sc) { bmPintarAtajo('recibiendo modificadores…'); return; } // solo Ctrl/Alt/Shift
            e.preventDefault();
            e.stopPropagation();
            setMetricasAtajo(sc);
            bmGrabarAtajo(false);
            bmPintarAtajo();
            mostrarToastAtajo(`Atajo guardado: ${formatMetricasAtajo(sc)}`);
        };
        window.addEventListener('keydown', window._bmAtajoListener, true);
    }
    bmPintarAtajo();
}

function mostrarToastAtajo(txt) {
    const el = document.getElementById('bm-atajo');
    if (el) el.insertAdjacentHTML('beforeend', `<span class="bm-atajo-ok"><i class="fas fa-check"></i> ${escapeHtml(txt)}</span>`);
}

// ===== Eventos del panel ====================================================================
function initBusinessMetrics() {
    const panel = document.querySelector('.bm-panel');
    if (!panel) return;
    panel.addEventListener('click', (e) => {
        const rangeBtn = e.target.closest('.bm-range-btn');
        if (rangeBtn) {
            BM_STATE.days = parseInt(rangeBtn.dataset.days, 10) || 30;
            panel.querySelectorAll('.bm-range-btn').forEach(b => b.classList.toggle('active', b === rangeBtn));
            renderBusinessMetrics();
            return;
        }
        if (e.target.closest('#bm-refresh')) { renderBusinessMetrics(true); return; }

        const atajoBtn = e.target.closest('[data-atajo]');
        if (atajoBtn) {
            const accion = atajoBtn.dataset.atajo;
            if (accion === 'cambiar') bmGrabarAtajo(true);
            else if (accion === 'cancelar') bmGrabarAtajo(false);
            else if (accion === 'restaurar') { setMetricasAtajo(null); bmPintarAtajo(); }
        }
    });
    bmPintarAtajo();

    // Si el usuario cambia el tema con el panel abierto, repintar para que los colores de las
    // gráficas y los números cambien con él (una sola vez por sesión).
    if (!BM_STATE.themeWatch) {
        BM_STATE.themeWatch = true;
        new MutationObserver(() => {
            if (document.getElementById('bm-body') && BM_STATE.data) bmPaint(BM_STATE.data);
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    renderBusinessMetrics();
}
window.initBusinessMetrics = initBusinessMetrics;
