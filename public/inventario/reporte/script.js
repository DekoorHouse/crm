import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

const $ = (id) => document.getElementById(id);

function toast(msg, type = '') {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    setTimeout(() => { el.className = 'toast'; }, 3000);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtNum(n) {
    const num = Number(n);
    if (!isFinite(num)) return '0';
    return num.toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

function fmtMoney(n) {
    const num = Number(n) || 0;
    return '$' + num.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtFechaHora(d) {
    return d.toLocaleString('es-MX', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// Auth
$('formularioLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('mensajeError').textContent = '';
    try {
        await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
    } catch {
        $('mensajeError').textContent = 'Credenciales incorrectas.';
    }
});

$('btnCerrarSesion').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
    $('loading-overlay').style.display = 'none';
    if (user) {
        $('seccionLogin').style.display = 'none';
        $('seccionApp').style.display = 'block';
        $('usuarioLogueado').textContent = user.email;
        await cargarReporte();
    } else {
        $('seccionLogin').style.display = 'block';
        $('seccionApp').style.display = 'none';
    }
});

$('btnRecargar').addEventListener('click', () => cargarReporte());
$('btnEnviarAhora').addEventListener('click', async () => {
    const btn = $('btnEnviarAhora');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/api/inventario/enviar-reporte', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success || (data.envio && data.envio.ok)) {
            toast('Reporte enviado por WhatsApp ✓', 'success');
        } else {
            const motivo = data.envio?.motivo || data.motivo || data.message || 'Error desconocido';
            toast('Falló envío: ' + motivo, 'error');
            console.warn('[REPORTE] Detalle:', data);
        }
    } catch (err) {
        toast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar por WhatsApp ahora';
    }
});

async function cargarReporte() {
    $('reporteWhen').textContent = 'Calculando…';
    $('tbodyAPedir').innerHTML = `<tr><td colspan="8" class="empty">Cargando...</td></tr>`;
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/api/inventario/reporte', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Error');
        renderReporte(data.reporte);
    } catch (err) {
        $('tbodyAPedir').innerHTML = `<tr><td colspan="8" class="empty" style="color:var(--color-danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
        $('reporteWhen').textContent = '';
    }
}

function renderReporte(reporte) {
    const ahora = new Date();
    $('reporteWhen').textContent = 'Generado ' + fmtFechaHora(ahora);

    // --- Resumen ---
    const totalPedidos = reporte.pedidos.total || 0;
    const aPedirCount = reporte.aPedir.length;
    const aPedirCriticos = reporte.aPedir.filter(p => p.stockActual === 0).length;
    const cards = [
        {
            label: 'Pedidos confirmados (24h)',
            value: totalPedidos,
            sub: 'Pagado o Fabricar',
            cls: ''
        },
        {
            label: 'Materiales a pedir',
            value: aPedirCount,
            sub: aPedirCriticos > 0 ? `${aPedirCriticos} agotado(s)` : 'bajo el mínimo',
            cls: aPedirCriticos > 0 ? 'danger' : (aPedirCount > 0 ? 'warn' : '')
        },
        {
            label: 'Costo aproximado',
            value: fmtMoney(reporte.costoTotal),
            sub: 'del pedido total',
            cls: ''
        },
        {
            label: 'Materiales en stock OK',
            value: reporte.stockOk.length,
            sub: 'sobre el mínimo',
            cls: ''
        }
    ];
    $('summaryGrid').innerHTML = cards.map(c => `
        <div class="summary-card ${c.cls}">
            <div class="label">${escapeHtml(c.label)}</div>
            <div class="value">${escapeHtml(String(c.value))}</div>
            <div class="sub">${escapeHtml(c.sub)}</div>
        </div>
    `).join('');

    // --- Pedidos por producto ---
    const porProducto = reporte.pedidos.porProducto || {};
    const productoEntries = Object.entries(porProducto);
    if (productoEntries.length > 0) {
        $('pedidosSection').style.display = 'block';
        productoEntries.sort((a, b) => b[1] - a[1]);
        $('pedidosPorProducto').innerHTML = productoEntries.map(([p, qty]) =>
            `<span class="chip">${escapeHtml(p)} <strong>×${qty}</strong></span>`
        ).join('');
    } else {
        $('pedidosSection').style.display = 'none';
    }

    // --- A pedir ---
    if (reporte.aPedir.length === 0) {
        $('tbodyAPedir').innerHTML = `<tr><td colspan="8" class="empty">🎉 Ningún material está bajo el mínimo. Todo bien.</td></tr>`;
    } else {
        $('tbodyAPedir').innerHTML = reporte.aPedir.map(p => {
            const stockClass = p.stockActual === 0 ? 'stock-low' : 'stock-warn';
            const sug = p.sugerencia;
            const modoTxt = sug.modo === 'fijo'
                ? `<span class="badge badge-fijo">Fijo</span>`
                : `<span class="badge badge-dinamico">Auto</span>`;
            const aPedirTxt = sug.multiplo > 1
                ? `<strong>${sug.paquetes}</strong> pack${sug.paquetes === 1 ? '' : 's'} <span style="color:var(--color-muted)">(${fmtNum(sug.unidades)} ${escapeHtml(p.unidad)})</span>`
                : `<strong>${fmtNum(sug.unidades)}</strong> ${escapeHtml(p.unidad)}`;
            return `
                <tr>
                    <td><strong>${escapeHtml(p.nombre)}</strong></td>
                    <td class="num ${stockClass}">${fmtNum(p.stockActual)}</td>
                    <td class="num">${fmtNum(p.stockMinimo)}</td>
                    <td class="num">${fmtNum(p.consumo24h)}</td>
                    <td class="num">${aPedirTxt}</td>
                    <td>${modoTxt}</td>
                    <td>${escapeHtml(p.proveedor || '')}</td>
                    <td class="num"><strong>${fmtMoney(p.costoEstimado)}</strong></td>
                </tr>
            `;
        }).join('');
    }

    // --- Stock OK ---
    if (reporte.stockOk.length > 0) {
        $('stockOkTitle').style.display = '';
        $('stockOkWrap').style.display = '';
        $('tbodyStockOk').innerHTML = reporte.stockOk.map(s => `
            <tr>
                <td>${escapeHtml(s.nombre)}</td>
                <td class="num">${fmtNum(s.stockActual)}</td>
                <td class="num">${fmtNum(s.stockMinimo)}</td>
            </tr>
        `).join('');
    } else {
        $('stockOkTitle').style.display = 'none';
        $('stockOkWrap').style.display = 'none';
    }
}
