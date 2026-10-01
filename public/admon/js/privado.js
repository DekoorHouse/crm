import { state } from './state.js';
import { formatCurrency, getExpenseParts, fechaContable } from './utils.js';

/**
 * @file Vista privada de los gastos de Chris.
 *
 * No tiene botón ni menú: se abre con 5 clics seguidos en una zona vacía de
 * la pestaña Datos, fuera de la tabla de movimientos. El modal se crea al
 * abrirse y se quita del DOM al cerrarse, así que mientras está cerrado no
 * queda nada visible ni en el HTML de la página.
 */

const CATEGORIA = 'Chris';
const CLICS = 5;
const MAX_PAUSA_MS = 700;   // pausa máxima entre un clic y el siguiente

// Grupos provisionales por palabra clave; gana el primero que coincide. Si el
// movimiento ya trae subcategoría, manda la subcategoría. Cuando se afinen las
// categorías de Chris, esta lista es lo único que hay que tocar.
const GRUPOS = [
    ['Efectivo', ['retiro sin tarjeta', 'retiro cajero']],
    ['Salud', ['vital dent', 'dentlife', 'ortho', 'farmacia', 'similares', 'hospital', 'laboratorio', 'dr ']],
    ['Auto', ['autozone', 'gaso', 'gasolin', 'pemex', 'taller', 'llanta', 'refaccion']],
    ['Súper y despensa', ['minisuper', 'mini super', 'alsuper', 'sams', 'walmart', 'carniceria', 'fruteria', 'super didi', 'soriana', 'chedraui', 'bodega aurrera', 'costco']],
    ['Comida', ['didi food', 'didifood', 'tacos', 'tortas', 'hamburg', 'pizza', 'rappi', 'uber eats', 'starbucks', 'rest ']],
    ['Compras', ['coppel', 'temu', 'zap', 'liverpool', 'amazon', 'mercadolibre', 'shein', 'suburbia', 'verti']],
    ['Celular y servicios', ['recargas', 'telefonia', 'chatgpt', 'netflix', 'spotify', 'megacable', 'telcel', 'cfe', 'totalplay', 'tconect']],
    ['Transferencias', ['spei enviado', 'pago cuenta de tercero', 'transf']],
];
const OTROS = 'Otros';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function grupoDe(concepto) {
    const c = String(concepto || '').toLowerCase().replace(/\s+/g, ' ');
    for (const [grupo, claves] of GRUPOS) {
        if (claves.some(k => c.includes(k))) return grupo;
    }
    return OTROS;
}

/** Movimientos con la parte que le toca a Chris (respeta los splits). */
export function movimientosChris(expenses) {
    const out = [];
    for (const e of expenses || []) {
        if (!e || !e.date || !(e.type === 'operativo' || !e.type)) continue;
        const partes = getExpenseParts(e).filter(p => p.category === CATEGORIA && (Number(p.amount) || 0) > 0);
        if (!partes.length) continue;
        const sub = partes.find(p => p.subcategory)?.subcategory;
        out.push({
            date: fechaContable(e),   // la renta de sep pagada el 1-oct cuenta en sep
            concept: String(e.concept || '').replace(/\s+/g, ' ').trim(),
            monto: partes.reduce((s, p) => s + (Number(p.amount) || 0), 0),
            grupo: sub || grupoDe(e.concept),
        });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Meses 'AAAA-MM' desde el inicio del ajuste de saldo hasta el mes actual. */
function rangoMeses(desde) {
    const hoy = new Date();
    const fin = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const out = [];
    let [a, m] = String(desde || '2026-03').slice(0, 7).split('-').map(Number);
    for (let k = `${a}-${String(m).padStart(2, '0')}`; k <= fin; ) {
        out.push(k);
        m++; if (m > 12) { m = 1; a++; }
        k = `${a}-${String(m).padStart(2, '0')}`;
    }
    return out;
}

const etiquetaMes = k => `${MESES[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`;
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const color = v => getComputedStyle(document.body).getPropertyValue(v).trim();

// ---------------------------------------------------------------------------

let vista = null;   // { el, graficas, movs, meses, mesSel, grupoSel, alTeclear }

function abrir() {
    if (vista) return;
    const movs = movimientosChris(state.expenses);
    const meses = rangoMeses(state.balanceConfig?.openingDate);
    const mesActual = meses[meses.length - 1];

    const el = document.createElement('div');
    el.id = 'privado-modal';
    el.className = 'modal-overlay';
    el.innerHTML = `
        <div class="modal-content modal-lg privado">
            <div class="modal-header privado-header">
                <span>Mis movimientos</span>
                <button type="button" class="privado-cerrar" aria-label="Cerrar">&times;</button>
            </div>
            <div class="modal-body privado-body">
                <div class="privado-tiles"></div>
                <div class="privado-graf privado-graf-meses"><canvas></canvas></div>
                <div class="privado-fila">
                    <div class="privado-graf privado-graf-grupos"><canvas></canvas></div>
                    <div class="privado-lista"></div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(el);

    const alTeclear = ev => { if (ev.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', alTeclear);
    el.addEventListener('click', ev => { if (ev.target === el) cerrar(); });
    el.querySelector('.privado-cerrar').addEventListener('click', cerrar);

    vista = { el, graficas: {}, movs, meses, mesSel: mesActual, grupoSel: null, alTeclear };
    pintar();
    requestAnimationFrame(() => el.classList.add('visible'));
}

function cerrar() {
    if (!vista) return;
    Object.values(vista.graficas).forEach(g => g && g.destroy());
    document.removeEventListener('keydown', vista.alTeclear);
    vista.el.remove();
    vista = null;
}

function pintar() {
    const { el, movs, meses, mesSel } = vista;
    const porMes = Object.fromEntries(meses.map(k => [k, 0]));
    movs.forEach(m => { const k = m.date.slice(0, 7); if (k in porMes) porMes[k] += m.monto; });

    const delMes = movs.filter(m => m.date.startsWith(mesSel));
    const totalMes = delMes.reduce((s, m) => s + m.monto, 0);
    // Promedio de los meses cerrados (el mes en curso va a medias).
    const cerrados = meses.slice(0, -1);
    const promedio = cerrados.length ? cerrados.reduce((s, k) => s + porMes[k], 0) / cerrados.length : 0;
    const dif = promedio ? (totalMes - promedio) / promedio : 0;

    el.querySelector('.privado-tiles').innerHTML = `
        <div class="privado-tile"><small>${esc(etiquetaMes(mesSel).replace(/^./, c => c.toUpperCase()))}</small><strong>${formatCurrency(totalMes)}</strong></div>
        <div class="privado-tile"><small>Movimientos</small><strong>${delMes.length}</strong></div>
        <div class="privado-tile"><small>Promedio mensual</small><strong>${formatCurrency(promedio)}</strong>
            ${promedio ? `<span class="${dif > 0 ? 'privado-sube' : 'privado-baja'}">${dif > 0 ? '+' : ''}${(dif * 100).toFixed(0)}% este mes</span>` : ''}</div>`;

    pintarMeses(porMes);
    pintarGrupos(delMes);
    pintarLista(delMes);
}

function opcionesBase(extra) {
    const texto = color('--text-secondary') || '#64748b';
    const rejilla = color('--border-color') || 'rgba(0,0,0,.08)';
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatCurrency(c.parsed[extra?.indexAxis === 'y' ? 'x' : 'y']) } } },
        scales: {
            x: { ticks: { color: texto }, grid: { color: rejilla } },
            y: { ticks: { color: texto }, grid: { color: rejilla } },
        },
        ...extra,
    };
}

function pintarMeses(porMes) {
    const { el, graficas, meses } = vista;
    const primario = color('--primary') || '#6366f1';
    graficas.meses?.destroy();
    graficas.meses = new Chart(el.querySelector('.privado-graf-meses canvas'), {
        type: 'bar',
        data: {
            labels: meses.map(etiquetaMes),
            datasets: [{
                data: meses.map(k => porMes[k]),
                backgroundColor: meses.map(k => k === vista.mesSel ? primario : primario + '55'),
                borderRadius: 6,
            }],
        },
        options: opcionesBase({
            onClick: (_ev, items) => {
                if (!items.length) return;
                vista.mesSel = meses[items[0].index];
                vista.grupoSel = null;
                pintar();
            },
        }),
    });
}

function pintarGrupos(delMes) {
    const { el, graficas } = vista;
    const primario = color('--primary') || '#6366f1';
    const porGrupo = {};
    delMes.forEach(m => { porGrupo[m.grupo] = (porGrupo[m.grupo] || 0) + m.monto; });
    const orden = Object.entries(porGrupo).sort((a, b) => b[1] - a[1]);
    graficas.grupos?.destroy();
    graficas.grupos = new Chart(el.querySelector('.privado-graf-grupos canvas'), {
        type: 'bar',
        data: {
            labels: orden.map(([g]) => g),
            datasets: [{
                data: orden.map(([, v]) => v),
                backgroundColor: orden.map(([g]) => !vista.grupoSel || g === vista.grupoSel ? primario : primario + '40'),
                borderRadius: 6,
            }],
        },
        options: opcionesBase({
            indexAxis: 'y',
            onClick: (_ev, items) => {
                if (!items.length) return;
                const g = orden[items[0].index][0];
                vista.grupoSel = vista.grupoSel === g ? null : g;
                pintarGrupos(delMes);
                pintarLista(delMes);
            },
        }),
    });
}

function pintarLista(delMes) {
    const lista = vista.grupoSel ? delMes.filter(m => m.grupo === vista.grupoSel) : delMes;
    const total = lista.reduce((s, m) => s + m.monto, 0);
    vista.el.querySelector('.privado-lista').innerHTML = `
        <div class="privado-lista-titulo">${esc(vista.grupoSel || 'Todos')} · ${formatCurrency(total)}</div>
        ${lista.length ? lista.map(m => `
            <div class="privado-mov">
                <span class="privado-fecha">${m.date.slice(8, 10)}/${m.date.slice(5, 7)}</span>
                <span class="privado-concepto" title="${esc(m.concept)}">${esc(m.concept)}</span>
                <span class="privado-monto">${formatCurrency(m.monto)}</span>
            </div>`).join('') : '<p class="privado-vacio">Sin movimientos.</p>'}`;
}

/** Engancha el gesto de 5 clics. Se llama una vez al iniciar la app. */
export function initPrivado() {
    let cuenta = 0;
    let ultimo = 0;
    document.addEventListener('click', ev => {
        const tabla = document.getElementById('data-table-container');
        // Sólo con la pestaña Datos a la vista y en zona vacía: un clic en la
        // tabla, en un control o dentro de un modal reinicia la cuenta.
        if (vista || !tabla || tabla.offsetParent === null) { cuenta = 0; return; }
        const t = ev.target;
        if (!(t instanceof Element) || tabla.contains(t) ||
            t.closest('.modal-overlay, button, a, input, select, textarea, label, [role="button"], .tab, .litepicker, .custom-dropdown')) {
            cuenta = 0;
            return;
        }
        const ahora = Date.now();
        cuenta = ahora - ultimo <= MAX_PAUSA_MS ? cuenta + 1 : 1;
        ultimo = ahora;
        if (cuenta >= CLICS) {
            cuenta = 0;
            window.getSelection?.()?.removeAllRanges();   // los clics rápidos seleccionan texto
            if (typeof Chart !== 'undefined') abrir();
        }
    });
}
