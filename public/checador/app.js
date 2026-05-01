// Firebase Authentication + Firestore
const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a"
};
firebase.initializeApp(firebaseConfig);
const firebaseAuth = firebase.auth();
const db = firebase.firestore();

let logsCache = [];
let employeesCache = [];
let unsubscribeLogs = null;
let unsubscribeEmployees = null;

firebaseAuth.onAuthStateChanged(user => {
    const loginView = document.getElementById('login-view');
    if (user) {
        loginView.style.display = 'none';
        unsubscribeLogs = db.collection('checador_logs')
            .orderBy('timestamp', 'desc')
            .onSnapshot(snap => {
                logsCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
                renderHistory();
            });
        unsubscribeEmployees = db.collection('checador_employees')
            .onSnapshot(snap => {
                employeesCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
                renderHistory();
            });
    } else {
        loginView.style.display = 'flex';
        if (unsubscribeLogs) { unsubscribeLogs(); unsubscribeLogs = null; }
        if (unsubscribeEmployees) { unsubscribeEmployees(); unsubscribeEmployees = null; }
        logsCache = [];
        employeesCache = [];
    }
});

document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const submitBtn = document.getElementById('login-submit-btn');
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Ingresando...';
    firebaseAuth.signInWithEmailAndPassword(email, password)
        .catch(() => { errorEl.textContent = 'Correo o contraseña incorrectos.'; })
        .finally(() => { submitBtn.disabled = false; submitBtn.textContent = 'Ingresar'; });
});

document.getElementById('logout-btn').addEventListener('click', () => {
    firebaseAuth.signOut();
});

// DOM
const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const networkStatusEl = document.getElementById('network-status');
const networkTextEl = document.getElementById('network-text');
const btnIn = document.getElementById('btn-in');
const btnOut = document.getElementById('btn-out');
const employeeIdInput = document.getElementById('employee-id');
const historyList = document.getElementById('history-list');
const notification = document.getElementById('notification');
const networkBlockedOverlay = document.getElementById('network-blocked');

let isAuthorized = false;
let recentHidden = false;

// 1. Reloj
function updateClock() {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    dateEl.textContent = now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
}

// 2. Validación de ubicación (GPS) — el backend decide modo (gps/ip).
let networkCheckInProgress = false;
const networkDiagnosticEl = document.getElementById('network-diagnostic');

function getGeolocation(timeoutMs = 10000) {
    return new Promise((resolve) => {
        if (!('geolocation' in navigator)) {
            resolve({ ok: false, reason: 'unsupported' });
            return;
        }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({
                ok: true,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            }),
            err => {
                let reason = 'error';
                if (err && err.code === 1) reason = 'denied';
                else if (err && err.code === 2) reason = 'unavailable';
                else if (err && err.code === 3) reason = 'timeout';
                resolve({ ok: false, reason });
            },
            { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
        );
    });
}

function setBadgeAuthorized(text) {
    networkStatusEl.className = "status-badge status-online";
    networkTextEl.textContent = text;
    networkBlockedOverlay.style.display = 'none';
    networkDiagnosticEl.style.display = 'none';
}

function setBadgeBlocked(text, diagnostic) {
    networkStatusEl.className = "status-badge status-offline";
    networkTextEl.textContent = text;
    if (diagnostic) {
        networkDiagnosticEl.textContent = diagnostic;
        networkDiagnosticEl.style.display = 'block';
    } else {
        networkDiagnosticEl.style.display = 'none';
    }
}

async function checkNetwork() {
    if (networkCheckInProgress) return;
    networkCheckInProgress = true;
    try {
        // Pide GPS antes de llamar al backend. Si el navegador no lo da,
        // mandamos la request sin lat/lng — el backend responde con razón clara.
        const geo = await getGeolocation();

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                let url = `/api/checador/check-network?_=${Date.now()}`;
                if (geo.ok) {
                    url += `&lat=${encodeURIComponent(geo.lat)}&lng=${encodeURIComponent(geo.lng)}&accuracy=${encodeURIComponent(Math.round(geo.accuracy || 0))}`;
                }
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                isAuthorized = !!data.authorized;
                const mode = data.mode || 'ip';

                if (isAuthorized) {
                    setBadgeAuthorized(mode === 'gps' ? 'EN LA OFICINA' : 'CONECTADO A RED OFICINA');
                    return;
                }

                if (mode === 'gps') {
                    if (!geo.ok) {
                        if (geo.reason === 'denied') {
                            setBadgeBlocked('PERMITE TU UBICACIÓN', 'Activa permisos de ubicación en el navegador (candado en la barra de direcciones) y toca el badge para reintentar.');
                        } else if (geo.reason === 'unsupported') {
                            setBadgeBlocked('UBICACIÓN NO DISPONIBLE', 'Este dispositivo o navegador no soporta GPS.');
                        } else {
                            setBadgeBlocked('OBTENIENDO UBICACIÓN…', `Reintentando GPS (${geo.reason}). Toca el badge para reintentar.`);
                        }
                    } else if (data.reason === 'low-accuracy') {
                        setBadgeBlocked('PRECISIÓN INSUFICIENTE', `Precisión actual: ${data.accuracy} m. Sal a un lugar con mejor señal y toca el badge.`);
                    } else if (typeof data.distance === 'number') {
                        setBadgeBlocked('FUERA DE LA OFICINA', `A ${data.distance} m de la oficina (radio permitido: ${data.radius} m). Toca para reintentar.`);
                    } else {
                        setBadgeBlocked('FUERA DE LA OFICINA', 'Toca el badge para reintentar.');
                    }
                } else {
                    setBadgeBlocked('RED NO AUTORIZADA', `IP detectada: ${data.ip || '—'} · toca el badge para reintentar`);
                }
                return;
            } catch (e) {
                if (attempt < 2) {
                    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                } else {
                    console.error('checkNetwork falló tras reintentos:', e);
                    isAuthorized = false;
                    setBadgeBlocked('ERROR DE CONEXIÓN', 'Toca el badge para reintentar');
                }
            }
        }
    } finally {
        networkCheckInProgress = false;
    }
}

// Permitir reintento manual tocando el badge
document.getElementById('network-status').addEventListener('click', checkNetwork);

// 3. Asistencia
async function registerAttendance(type) {
    recentHidden = false;
    const inputVal = employeeIdInput.value.trim();
    if (!inputVal) { showNotification("Ingresa tu nombre", "danger"); return; }

    const employee = employeesCache.find(e =>
        e.name.toLowerCase() === inputVal.toLowerCase()
    );
    if (!employee) {
        showNotification("Nombre no reconocido. Verifica que esté bien escrito.", "danger");
        return;
    }
    const displayName = employee.name;

    // Revalidar antes de registrar para que un fallo transitorio no bloquee al usuario
    if (!isAuthorized && displayName.toLowerCase() !== 'rosario') {
        await checkNetwork();
    }

    if (!isAuthorized && displayName.toLowerCase() !== 'rosario') {
        showNotification("Debes estar físicamente en la oficina para checar", "danger");
        return;
    }

    const lastRegistration = logsCache.find(log => log.name.toLowerCase() === displayName.toLowerCase());
    if (lastRegistration) {
        if (lastRegistration.type === type) {
            showNotification(`Error: Ya tienes una ${type === 'IN' ? 'ENTRADA' : 'SALIDA'} registrada.`, "danger");
            return;
        }
    } else if (type === 'OUT') {
        showNotification("Error: Debes marcar ENTRADA primero.", "danger");
        return;
    }

    const entry = {
        id: employee ? employee.id : displayName,
        name: displayName,
        type: type,
        time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }),
        date: new Date().toLocaleDateString('es-MX'),
        timestamp: new Date().getTime()
    };

    db.collection('checador_logs').add(entry);
    showNotification(`${type === 'IN' ? 'Entrada' : 'Salida'} registrada: ${displayName}`);
    employeeIdInput.value = '';
}

// 4. Renderizado
function getEmployeePhoto(name) {
    const emp = employeesCache.find(e => e.name.toLowerCase() === name.toLowerCase());
    return emp && emp.photoURL ? emp.photoURL : null;
}

function getEmployeeInitials(name) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function renderHistory() {
    historyList.innerHTML = '';
    if (recentHidden) return;
    logsCache.slice(0, 5).forEach(item => {
        const photo = getEmployeePhoto(item.name);
        const avatarHtml = photo
            ? `<img src="${photo}" alt="${item.name}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; flex-shrink:0;">`
            : `<div style="width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700; flex-shrink:0; color:var(--text-muted);">${getEmployeeInitials(item.name)}</div>`;

        const li = document.createElement('li');
        li.className = `history-item ${item.type.toLowerCase()}`;
        li.innerHTML = `
            ${avatarHtml}
            <div class="item-info" style="flex:1; margin-left:10px;">
                <span class="item-time">${item.time} - ${item.name}</span>
                <span class="item-type">${item.type === 'IN' ? 'Entrada' : 'Salida'}</span>
            </div>
            <div style="font-size: 0.7rem; color: #94a3b8;">${item.date}</div>
        `;
        historyList.appendChild(li);
    });
}

function showNotification(m, t = "success") {
    notification.textContent = m;
    notification.style.background = t === "success" ? "var(--primary)" : "#ef4444";
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), 3000);
}

// Event Listeners
btnIn.addEventListener('click', () => registerAttendance('IN'));
btnOut.addEventListener('click', () => registerAttendance('OUT'));

document.addEventListener('click', (e) => {
    if (e.target && (e.target.textContent === 'LIMPIAR' || e.target.id === 'clear-recent')) {
        recentHidden = true;
        renderHistory();
        showNotification("Vista principal limpia");
    }
});

setInterval(updateClock, 1000);
updateClock();
checkNetwork();
setInterval(checkNetwork, 30 * 1000);

// Revalidar al volver a la pestaña — Chrome móvil suspende setInterval en background
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkNetwork();
});
// Revalidar cuando la conexión se recupera
window.addEventListener('online', checkNetwork);

setTimeout(() => employeeIdInput.focus(), 500);
