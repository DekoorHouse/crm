// Firestore avisa; el endpoint conserva las reglas de clasificación del tablero.
// Se agrupan ráfagas y sólo hay una consulta HTTP en vuelo (pendientes-handlers.js).
let _pendLiveUnsubs = [], _pendLiveDocs = new Map(), _pendDocSources = new Map();
let _pendLiveTimer = null, _pendLiveLastFetch = 0, _pendLiveActive = false;
const _pendLiveErrors = new Set();
const _pendVisible = () => typeof state !== 'undefined' && state.activeView === 'pendientes'
    && !document.hidden && !!document.getElementById('pendientes-container');

function _pendLiveStatus() {
    const el = document.getElementById('pend-live');
    if (!el) return;
    el.textContent = _pendLiveErrors.size ? 'Reconectando…' : _pendLiveActive ? '● En vivo' : 'Conectando…';
    el.style.color = _pendLiveErrors.size ? '#d97706' : '#15803d';
}

function _pendFetchHealth(ok) {
    if (ok) _pendLiveErrors.delete('http'); else _pendLiveErrors.add('http');
    _pendLiveStatus();
}

function _pendScheduleRefresh() {
    if (!_pendVisible() || _pendLiveTimer) return;
    // Máximo una petición por ráfaga; nunca se aplaza indefinidamente si hay muchos cambios.
    _pendLiveTimer = setTimeout(() => {
        _pendLiveTimer = null;
        if (!_pendVisible()) return;
        _pendLiveLastFetch = Date.now();
        renderPendientesView(true);
    }, Math.max(450, 2500 - (Date.now() - _pendLiveLastFetch)));
}

function _pendLiveError(key, error) {
    _pendLiveErrors.add(key); _pendLiveStatus();
    console.warn('[PENDIENTES] Conexión en vivo:', key, error.message);
}

function _pendSetDocSource(source, paths) {
    _pendDocSources.set(source, new Set(paths.filter(Boolean)));
    const wanted = new Set([..._pendDocSources.values()].flatMap(set => [...set]));
    for (const [path, unsub] of _pendLiveDocs) {
        if (!wanted.has(path)) { unsub(); _pendLiveDocs.delete(path); _pendLiveErrors.delete(path); }
    }
    for (const path of wanted) {
        if (_pendLiveDocs.has(path)) continue;
        const slash = path.indexOf('/');
        const unsub = db.collection(path.slice(0, slash)).doc(path.slice(slash + 1)).onSnapshot(() => {
            if (!_pendLiveActive) return;
            _pendLiveErrors.delete(path); _pendLiveStatus(); _pendScheduleRefresh();
        }, error => _pendLiveError(path, error));
        _pendLiveDocs.set(path, unsub);
    }
}

function _pendSyncVisibleDocs(buckets) {
    if (!_pendLiveActive) return;
    const paths = [];
    for (const rows of Object.values(buckets)) for (const row of rows) {
        if (row.contactId) paths.push('contacts_whatsapp/' + row.contactId);
        if (row.orderId || row.pedido?.id) paths.push('pedidos/' + (row.orderId || row.pedido.id));
    }
    _pendSetDocSource('visible', paths);
}

function _pendStartLive() {
    if (_pendLiveActive || !_pendVisible()) return;
    if (typeof db === 'undefined' || !db?.collection) { _pendLiveErrors.add('sdk'); _pendLiveStatus(); return; }
    _pendLiveActive = true; _pendLiveErrors.clear();
    const watch = (key, query, dependencies) => {
        const unsub = query.onSnapshot(snapshot => {
            if (!_pendLiveActive) return;
            _pendLiveErrors.delete(key);
            if (dependencies) _pendSetDocSource(key, snapshot.docs.flatMap(dependencies));
            _pendLiveStatus();
            if (!snapshot.docChanges || snapshot.docChanges().length) _pendScheduleRefresh();
        }, error => _pendLiveError(key, error));
        _pendLiveUnsubs.push(unsub);
    };
    const contactPath = d => {
        const id = d.data().contactId || d.data().telefono;
        return id ? ['contacts_whatsapp/' + id] : [];
    };
    const orderPaths = d => ['mockup_previews/' + d.id, ...contactPath(d)];
    try {
        watch('mockup', db.collection('pedidos').where('estatus', '==', 'Sin estatus').limit(500), orderPaths);
        watch('video', db.collection('pedidos').where('estatus', '==', 'Corregir'), orderPaths);
        watch('atencion', db.collection('contacts_whatsapp').where('needsAttention', '==', true).limit(200));
        watch('ia', db.collection('contacts_whatsapp').where('status', '==', 'pendientes_ia').limit(300));
        watch('sospechosos', db.collection('contacts_whatsapp').where('suspiciousReceiptPending', '==', true).limit(200));
        watch('recibos', db.collection('payment_receipts').where('open', '==', true), d => [
            ...contactPath(d), ...(d.data().orderId ? ['pedidos/' + d.data().orderId] : []),
        ]);
        watch('formularios', db.collection('pedidos').where('shippingFormStatus', 'in', ['pending', 'sending', 'retry', 'review']), contactPath);
        watch('fallas', db.collection('ai_order_failures').orderBy('at', 'desc').limit(80), contactPath);
        // Registrar un pedido resuelve una falla aunque nazca directamente en Fabricar.
        watch('registros', db.collection('pedidos').orderBy('createdAt', 'desc').limit(25));
        _pendLiveStatus();
    } catch (error) {
        _pendStopLive(); _pendLiveError('inicio', error);
    }
}

function _pendStopLive() {
    _pendLiveActive = false;
    for (const unsub of [..._pendLiveUnsubs, ..._pendLiveDocs.values()]) { try { unsub(); } catch (_) {} }
    _pendLiveUnsubs = []; _pendLiveDocs.clear(); _pendDocSources.clear();
    clearTimeout(_pendLiveTimer); _pendLiveTimer = null;
    _pendCancelRefresh();
}
window._pendStopLive = _pendStopLive;

document.addEventListener('visibilitychange', () => {
    if (document.hidden) _pendStopLive();
    else if (_pendVisible()) { _pendStartLive(); _pendScheduleRefresh(); }
});
window.addEventListener('pagehide', _pendStopLive);
window.addEventListener('pageshow', () => { if (_pendVisible()) { _pendStartLive(); _pendScheduleRefresh(); } });
window.addEventListener('online', () => {
    if (_pendVisible()) { _pendStopLive(); _pendStartLive(); _pendScheduleRefresh(); }
});
// Respaldo de reconexión y condiciones por tiempo (por ejemplo, Cola IA +1h).
// No se pausa por escribir una nota ni por tener abierto el chat.
setInterval(() => {
    if (!_pendVisible()) return;
    if (!_pendLiveActive || _pendLiveErrors.size) { _pendStopLive(); _pendStartLive(); }
    _pendScheduleRefresh();
}, 60000);
