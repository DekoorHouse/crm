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

// 2. Red — valida en el backend (lee req.ip y compara contra prefijos en Firestore)
let networkCheckInProgress = false;

async function checkNetwork() {
    if (networkCheckInProgress) return;
    networkCheckInProgress = true;
    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const response = await fetch('/api/checador/check-network', { cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                isAuthorized = !!data.authorized;
                if (isAuthorized) {
                    networkStatusEl.className = "status-badge status-online";
                    networkTextEl.textContent = "CONECTADO A RED OFICINA";
                    networkBlockedOverlay.style.display = 'none';
                } else {
                    networkStatusEl.className = "status-badge status-offline";
                    networkTextEl.textContent = "RED NO AUTORIZADA";
                }
                return;
            } catch (e) {
                if (attempt < 2) {
                    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                } else {
                    console.error('checkNetwork falló tras reintentos:', e);
                    isAuthorized = false;
                    networkStatusEl.className = "status-badge status-offline";
                    networkTextEl.textContent = "ERROR DE CONEXIÓN";
                }
            }
        }
    } finally {
        networkCheckInProgress = false;
    }
}

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
        showNotification("Debes estar conectado a la red Wi-Fi de la oficina", "danger");
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
setTimeout(() => employeeIdInput.focus(), 500);
