import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {

    const firebaseConfig = {
        apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
        authDomain: "pedidos-con-gemini.firebaseapp.com",
        projectId: "pedidos-con-gemini",
        storageBucket: "pedidos-con-gemini.firebasestorage.app",
        messagingSenderId: "300825194175",
        appId: "1:300825194175:web:972fa7b8af195a83e6e00a"
    };
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    const loadingOverlay = document.getElementById('loading-overlay');
    const seccionLogin = document.getElementById('seccionLogin');
    const seccionMetricas = document.getElementById('seccionMetricas');
    const formularioLogin = document.getElementById('formularioLogin');
    const mensajeError = document.getElementById('mensajeError');
    const usuarioLogueado = document.getElementById('usuarioLogueado');
    const tablaContainer = document.getElementById('tablaContainer');
    const cacheInfo = document.getElementById('cacheInfo');

    const SOURCE_LABELS = {
        'chat': 'Chat',
        'retargeting_plantilla': 'Retargeting'
    };

    function fmtPct(num, total) {
        if (!total) return '0%';
        return Math.round((num / total) * 100) + '%';
    }

    function fmtMoney(n) {
        if (!n) return '$0';
        return '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 });
    }

    function fmtDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
               d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    }

    function sourceBadge(source) {
        const label = SOURCE_LABELS[source] || source;
        return `<span class="badge-source badge-source-${source}">${label}</span>`;
    }

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
            seccionMetricas.style.display = 'block';
            usuarioLogueado.textContent = user.email;
            // Defaults: ultimos 30 dias
            const hoy = new Date();
            const hace30 = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
            document.getElementById('fechaInicio').value = hace30.toISOString().slice(0, 10);
            document.getElementById('fechaFin').value = hoy.toISOString().slice(0, 10);
            await cargarPlantillasFiltro();
            recargar(false);
        } else {
            seccionLogin.style.display = 'block';
            seccionMetricas.style.display = 'none';
        }
    });

    window.cerrarSesion = () => signOut(auth);

    async function cargarPlantillasFiltro() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/api/template-metrics/templates', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (data.success) {
                const sel = document.getElementById('filtroPlantilla');
                sel.innerHTML = '<option value="">Todas</option>' +
                    (data.templates || []).map(t => `<option value="${t}">${t}</option>`).join('');
            }
        } catch (e) {
            console.error('Error cargando plantillas:', e);
        }
    }

    window.recargar = async (forceRefresh) => {
        const fechaInicio = document.getElementById('fechaInicio').value;
        const fechaFin = document.getElementById('fechaFin').value;
        const filtroPlantilla = document.getElementById('filtroPlantilla').value;
        const filtroFuente = document.getElementById('filtroFuente').value;
        const agrupar = document.getElementById('agruparPlantilla').checked;

        const params = new URLSearchParams();
        if (fechaInicio) params.set('from', new Date(fechaInicio + 'T00:00:00').getTime());
        if (fechaFin) params.set('to', new Date(fechaFin + 'T23:59:59.999').getTime());
        if (filtroPlantilla) params.set('template', filtroPlantilla);
        if (filtroFuente) params.set('source', filtroFuente);
        if (agrupar) params.set('aggregate', 'template');
        if (forceRefresh) params.set('fresh', '1');

        tablaContainer.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/api/template-metrics/batches?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error');

            cacheInfo.textContent = data.fromCache ? `Cache (${Math.round(data.cacheAgeMs / 1000)}s)` : 'Actualizado ahora';
            if (agrupar) {
                renderAggregated(data.aggregated || []);
            } else {
                renderBatches(data.batches || []);
            }
        } catch (e) {
            tablaContainer.innerHTML = `<div class="empty-state" style="color:#dc2626;"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
        }
    };

    function renderBatches(batches) {
        if (!batches.length) {
            tablaContainer.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i> No hay tandas que coincidan con los filtros.</div>';
            return;
        }
        // Totales globales
        const total = batches.reduce((acc, b) => ({
            sent: acc.sent + b.sent,
            delivered: acc.delivered + b.delivered,
            read: acc.read + b.read,
            replied: acc.replied + b.replied,
            blocked: acc.blocked + b.blocked,
            purchasesCount: acc.purchasesCount + b.purchasesCount,
            purchaseValue: acc.purchaseValue + b.purchaseValue
        }), { sent: 0, delivered: 0, read: 0, replied: 0, blocked: 0, purchasesCount: 0, purchaseValue: 0 });

        const kpiHTML = `
            <div class="kpi-row">
                <div class="kpi"><div class="kpi-label">Tandas</div><div class="kpi-value">${batches.length}</div></div>
                <div class="kpi"><div class="kpi-label">Enviados</div><div class="kpi-value">${total.sent}</div></div>
                <div class="kpi"><div class="kpi-label">Entregados</div><div class="kpi-value">${total.delivered}</div><div class="kpi-sub">${fmtPct(total.delivered, total.sent)}</div></div>
                <div class="kpi"><div class="kpi-label">Le&iacute;dos</div><div class="kpi-value">${total.read}</div><div class="kpi-sub">${fmtPct(total.read, total.sent)}</div></div>
                <div class="kpi"><div class="kpi-label">Respuestas</div><div class="kpi-value">${total.replied}</div><div class="kpi-sub">${fmtPct(total.replied, total.sent)}</div></div>
                <div class="kpi"><div class="kpi-label">Bloqueos</div><div class="kpi-value">${total.blocked}</div><div class="kpi-sub">${fmtPct(total.blocked, total.sent)}</div></div>
                <div class="kpi"><div class="kpi-label">Compras</div><div class="kpi-value">${total.purchasesCount}</div><div class="kpi-sub">${fmtMoney(total.purchaseValue)}</div></div>
            </div>
        `;

        const rowsHTML = batches.map(b => `
            <tr>
                <td><strong>${b.templateName}</strong> <span style="color:#9ca3af;font-size:0.75rem;">${b.templateLanguage || ''}</span></td>
                <td>${sourceBadge(b.source)}</td>
                <td>${fmtDate(b.createdAt)}</td>
                <td class="num">${b.sent}</td>
                <td class="num">${b.delivered}<div class="pct">${fmtPct(b.delivered, b.sent)}</div></td>
                <td class="num">${b.read}<div class="pct">${fmtPct(b.read, b.sent)}</div></td>
                <td class="num">${b.replied}<div class="pct">${fmtPct(b.replied, b.sent)}</div></td>
                <td class="num">${b.blocked}<div class="pct">${fmtPct(b.blocked, b.sent)}</div></td>
                <td class="num">${b.purchasesCount}<div class="pct">${fmtMoney(b.purchaseValue)}</div></td>
                <td><button class="btn-ver" onclick="verDetalle('${b.batchId}')"><i class="fas fa-eye"></i> Ver</button></td>
            </tr>
        `).join('');

        tablaContainer.innerHTML = kpiHTML + `
            <table class="tabla-metricas">
                <thead>
                    <tr>
                        <th>Plantilla</th>
                        <th>Fuente</th>
                        <th>Fecha</th>
                        <th class="num">Enviados</th>
                        <th class="num">Entregados</th>
                        <th class="num">Le&iacute;dos</th>
                        <th class="num">Respuestas</th>
                        <th class="num">Bloqueos</th>
                        <th class="num">Compras / $</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
            </table>
        `;
    }

    function renderAggregated(rows) {
        if (!rows.length) {
            tablaContainer.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i> No hay datos para agrupar.</div>';
            return;
        }
        const rowsHTML = rows.sort((a, b) => b.sent - a.sent).map(r => `
            <tr>
                <td><strong>${r.templateName}</strong></td>
                <td>${(r.sources || []).map(s => sourceBadge(s)).join(' ')}</td>
                <td class="num">${r.batchesCount}</td>
                <td class="num">${r.sent}</td>
                <td class="num">${r.delivered}<div class="pct">${fmtPct(r.delivered, r.sent)}</div></td>
                <td class="num">${r.read}<div class="pct">${fmtPct(r.read, r.sent)}</div></td>
                <td class="num">${r.replied}<div class="pct">${fmtPct(r.replied, r.sent)}</div></td>
                <td class="num">${r.blocked}<div class="pct">${fmtPct(r.blocked, r.sent)}</div></td>
                <td class="num">${r.purchasesCount}<div class="pct">${fmtMoney(r.purchaseValue)}</div></td>
            </tr>
        `).join('');

        tablaContainer.innerHTML = `
            <table class="tabla-metricas">
                <thead>
                    <tr>
                        <th>Plantilla</th>
                        <th>Fuentes</th>
                        <th class="num">Tandas</th>
                        <th class="num">Enviados</th>
                        <th class="num">Entregados</th>
                        <th class="num">Le&iacute;dos</th>
                        <th class="num">Respuestas</th>
                        <th class="num">Bloqueos</th>
                        <th class="num">Compras / $</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
            </table>
        `;
    }

    window.verDetalle = async (batchId) => {
        const modal = document.getElementById('modalDetalle');
        const body = document.getElementById('modalBody');
        const title = document.getElementById('modalTitulo');
        modal.style.display = 'flex';
        body.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/api/template-metrics/batches/${batchId}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Error');

            const b = data.batch;
            title.innerHTML = `<i class="fas fa-list"></i> ${b.templateName} ${sourceBadge(b.source)}`;
            const sendsHTML = data.sends.map(s => {
                const statusPill = `<span class="status-pill status-${s.status || 'sent'}">${s.status || 'sent'}</span>`;
                const repliedBadge = s.repliedAt ? '<span class="badge-replied">Respondi&oacute;</span>' : '';
                const blockedBadge = s.blocked ? '<span class="badge-blocked">Bloqueado</span>' : '';
                const purchaseBadge = s.purchasesCount ? `<span class="badge-purchase">$${Number(s.purchaseValue).toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>` : '';
                return `<tr>
                    <td>${s.contactName || '(sin nombre)'}</td>
                    <td style="font-family:monospace;font-size:0.78rem;">${s.contactId}</td>
                    <td>${statusPill}</td>
                    <td>${s.sentAt ? fmtDate(s.sentAt) : ''}</td>
                    <td>${s.readAt ? fmtDate(s.readAt) : '—'}</td>
                    <td>${repliedBadge || '—'}</td>
                    <td>${blockedBadge || '—'}</td>
                    <td>${purchaseBadge || '—'}</td>
                    <td style="color:#dc2626;font-size:0.78rem;">${s.failureReason || ''}</td>
                </tr>`;
            }).join('');
            body.innerHTML = `
                <div style="margin-bottom:12px;color:#6b7280;font-size:0.85rem;">
                    Enviada por <strong>${b.sentBy || 'sistema'}</strong> · ${fmtDate(b.createdAt)} · Total contactos: <strong>${b.total}</strong>
                </div>
                <table class="tabla-metricas">
                    <thead><tr>
                        <th>Nombre</th><th>Tel&eacute;fono</th><th>Status</th><th>Enviado</th><th>Le&iacute;do</th><th>Respuesta</th><th>Bloqueo</th><th>Compra</th><th>Error</th>
                    </tr></thead>
                    <tbody>${sendsHTML}</tbody>
                </table>
            `;
        } catch (e) {
            body.innerHTML = `<div class="empty-state" style="color:#dc2626;">${e.message}</div>`;
        }
    };

    window.cerrarDetalle = (event) => {
        if (event && event.target !== event.currentTarget) return;
        document.getElementById('modalDetalle').style.display = 'none';
    };
});
