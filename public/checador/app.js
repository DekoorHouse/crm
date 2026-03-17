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

// Caché local (se actualiza en tiempo real desde Firestore)
let logsCache = [];
let employeesCache = [];
let unsubscribeLogs = null;
let unsubscribeEmployees = null;
let officeLocation = null; // { lat, lng, radius }

// Cargar configuración de ubicación de la oficina
db.collection('checador_config').doc('office').onSnapshot(doc => {
    if (doc.exists) {
        officeLocation = doc.data();
        const statusEl = document.getElementById('location-config-status');
        const coordsEl = document.getElementById('location-coords-display');
        const radiusInput = document.getElementById('location-radius');
        if (statusEl) {
            statusEl.textContent = `Radio: ${officeLocation.radius}m ✓`;
            statusEl.style.color = 'var(--success)';
        }
        if (coordsEl) {
            coordsEl.textContent = `Lat: ${officeLocation.lat.toFixed(6)}, Lng: ${officeLocation.lng.toFixed(6)}`;
            coordsEl.style.display = 'block';
        }
        if (radiusInput) radiusInput.value = officeLocation.radius;
    }
});

function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkUserLocation() {
    return new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
            pos => {
                const distance = Math.round(haversineDistance(
                    pos.coords.latitude, pos.coords.longitude,
                    officeLocation.lat, officeLocation.lng
                ));
                resolve({ ok: distance <= officeLocation.radius, distance });
            },
            () => resolve({ ok: false, error: 'Permiso de ubicación denegado' }),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    });
}

firebaseAuth.onAuthStateChanged(user => {
    const loginView = document.getElementById('login-view');
    if (user) {
        loginView.style.display = 'none';

        // Escuchar logs en tiempo real (ordenados por timestamp desc)
        unsubscribeLogs = db.collection('checador_logs')
            .orderBy('timestamp', 'desc')
            .onSnapshot(snap => {
                logsCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
                renderHistory();
                if (adminPanel && adminPanel.style.display === 'flex') {
                    renderAdminLogs();
                    renderResumen();
                }
            });

        // Escuchar empleados en tiempo real
        unsubscribeEmployees = db.collection('checador_employees')
            .onSnapshot(snap => {
                employeesCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
                if (adminPanel && adminPanel.style.display === 'flex') {
                    renderAdminEmployees();
                }
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
        .catch(() => {
            errorEl.textContent = 'Correo o contraseña incorrectos.';
        })
        .finally(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Ingresar';
        });
});

document.getElementById('logout-btn').addEventListener('click', () => {
    firebaseAuth.signOut();
});

// Configuración
const AUTHORIZED_PREFIXES = ["2806:267:2484", "177.226.102"]; // IPv6 e IPv4 de la oficina
const ADMIN_PIN = "1234";

// Elementos del DOM
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

// Admin
const openAdminBtn = document.getElementById('open-admin');
const closeAdminBtn = document.getElementById('close-admin');
const adminPanel = document.getElementById('admin-panel');
const adminLogin = document.getElementById('admin-login');
const adminPinInput = document.getElementById('admin-pin');
const loginBtn = document.getElementById('login-btn');
const cancelLoginBtn = document.getElementById('cancel-login');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const adminLogsBody = document.getElementById('admin-logs-body');
const adminEmployeesBody = document.getElementById('admin-employees-body');
const newEmpNameInput = document.getElementById('new-emp-name');
const newEmpIdInput = document.getElementById('new-emp-id');
const addEmployeeBtn = document.getElementById('add-employee-btn');
const exportCsvBtn = document.getElementById('export-csv');
const clearLogsBtn = document.getElementById('clear-all-logs');

let isAuthorized = false;
let recentHidden = false;

// 1. Reloj
function updateClock() {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    dateEl.textContent = now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
}

// 2. Red
async function checkNetwork() {
    try {
        const response = await fetch('https://api64.ipify.org?format=json');
        const data = await response.json();
        const userIp = data.ip;
        console.log("IP detectada:", userIp);
        if (AUTHORIZED_PREFIXES.some(prefix => userIp.startsWith(prefix))) {
            isAuthorized = true;
            networkStatusEl.className = "status-badge status-online";
            networkTextEl.textContent = "CONECTADO A RED OFICINA";
            networkBlockedOverlay.style.display = 'none';
        } else {
            isAuthorized = false;
            networkStatusEl.className = "status-badge status-offline";
            networkTextEl.textContent = "RED NO AUTORIZADA";
            networkBlockedOverlay.style.display = 'flex';
            const blockedMsg = document.querySelector('#network-blocked p');
            if (blockedMsg) blockedMsg.innerHTML = `Red externa (${userIp}).<br>Solo para oficina.`;
        }
    } catch (e) {
        console.error(e);
    }
}

// 3. Asistencia
async function registerAttendance(type) {
    recentHidden = false;
    const inputVal = employeeIdInput.value.trim();
    if (!inputVal) { showNotification("Ingresa tu ID o Nombre", "danger"); return; }

    // Verificar ubicación si está configurada
    if (officeLocation) {
        btnIn.disabled = true;
        btnOut.disabled = true;
        showNotification("Verificando ubicación...");
        const loc = await checkUserLocation();
        btnIn.disabled = false;
        btnOut.disabled = false;
        if (!loc.ok) {
            const msg = loc.error || `Muy lejos de la oficina (${loc.distance}m). Acércate más.`;
            showNotification(msg, "danger");
            return;
        }
    }

    const employee = employeesCache.find(e =>
        e.id === inputVal || e.name.toLowerCase() === inputVal.toLowerCase()
    );
    const finalId = employee ? employee.id : inputVal;
    const displayName = employee ? employee.name : inputVal;

    // Validación de duplicados usando la caché
    const lastRegistration = logsCache.find(log => log.id === finalId);
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
        id: finalId,
        name: displayName,
        type: type,
        time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }),
        date: new Date().toLocaleDateString('es-MX'),
        timestamp: new Date().getTime()
    };

    db.collection('checador_logs').add(entry);
    showNotification(`${type === 'IN' ? 'Entrada' : 'Salida'} registrada: ${displayName}`);
    employeeIdInput.value = '';
    // renderHistory se llama automáticamente por el listener de Firestore
}

// 4. Empleados
function getEmployees() { return employeesCache; }

async function saveEmployee(name, id) {
    if (employeesCache.some(e => e.id === id)) { showNotification("ID duplicado", "danger"); return false; }
    await db.collection('checador_employees').add({ name, id });
    return true;
}

async function deleteEmployee(id) {
    const emp = employeesCache.find(e => e.id === id);
    if (emp && emp._docId) {
        await db.collection('checador_employees').doc(emp._docId).delete();
    }
    // renderAdminEmployees se llama por el listener
}

// 5. Renderizado
function renderHistory() {
    historyList.innerHTML = '';
    if (recentHidden) return;
    logsCache.slice(0, 5).forEach(item => {
        const li = document.createElement('li');
        li.className = `history-item ${item.type.toLowerCase()}`;
        li.innerHTML = `
            <div class="item-info">
                <span class="item-time">${item.time} - ${item.name}</span>
                <span class="item-type">${item.type === 'IN' ? 'Entrada' : 'Salida'}</span>
            </div>
            <div style="font-size: 0.7rem; color: #94a3b8;">${item.date}</div>
        `;
        historyList.appendChild(li);
    });
}

function getGroupedData() {
    const sortedLogs = [...logsCache].reverse();
    const groups = {};
    sortedLogs.forEach(log => {
        const key = `${log.name.toLowerCase()}-${log.date}`;
        if (!groups[key]) groups[key] = { id: log.id, name: log.name, date: log.date, events: [] };
        groups[key].events.push(log);
    });
    return Object.values(groups).map(group => {
        let totalMinutes = 0, lastInTime = null, timelineText = [];
        group.events.forEach(event => {
            timelineText.push(`<span style="color:${event.type === 'IN' ? 'var(--success)' : 'var(--warning)'}">${event.type}: ${event.time}</span>`);
            if (event.type === 'IN') { lastInTime = event.timestamp; }
            else if (event.type === 'OUT' && lastInTime) {
                totalMinutes += Math.floor((event.timestamp - lastInTime) / (1000 * 60));
                lastInTime = null;
            }
        });
        const hrs = Math.floor(totalMinutes / 60);
        group.totalStr = `${hrs}h ${totalMinutes % 60}m`;
        group.payment = (totalMinutes / 60) * 70;
        group.timeline = timelineText.join(" | ");
        return group;
    }).reverse();
}

let groupedDataCache = [];

function renderAdminLogs() {
    const data = getGroupedData();
    groupedDataCache = data;
    adminLogsBody.innerHTML = '';
    data.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.name}<br><small>ID: ${row.id}</small></td>
            <td>${row.date}</td>
            <td style="font-size: 0.8rem;">${row.timeline}</td>
            <td style="font-weight:bold; color:var(--primary)">${row.totalStr}</td>
            <td style="font-weight:bold; color:var(--success)">$${row.payment.toFixed(2)}</td>
            <td><button class="btn-small" onclick="openEditModal(${idx})" style="font-size:0.75rem;">Editar</button></td>
        `;
        adminLogsBody.appendChild(tr);
    });
}

// =====================
// EDICIÓN DE REGISTROS
// =====================
let editingEntries = [];
let editingMeta = null; // { name, id, date }

function openEditModal(idx) {
    const group = groupedDataCache[idx];
    editingMeta = { name: group.name, id: group.id, date: group.date };
    // Ordenar por timestamp asc para mostrar cronológicamente
    editingEntries = [...group.events]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(e => ({ ...e, isNew: false, isDeleted: false }));
    document.getElementById('edit-log-title').textContent = `${group.name} — ${group.date}`;
    renderEditEntries();
    document.getElementById('edit-log-modal').style.display = 'flex';
}

function dateToInput(dateStr) {
    // "17/3/2026" → "2026-03-17"
    const [d, m, y] = dateStr.split('/');
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function inputToDate(val) {
    // "2026-03-17" → "17/3/2026"
    const [y, m, d] = val.split('-');
    return `${parseInt(d)}/${parseInt(m)}/${y}`;
}

function renderEditEntries() {
    const container = document.getElementById('edit-log-entries');
    container.innerHTML = '';

    // Selector de empleado
    const empOptions = employeesCache.map(e =>
        `<option value="${e.id}" data-name="${e.name}" ${e.id === editingMeta.id ? 'selected' : ''}>${e.name} (${e.id})</option>`
    ).join('');
    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'margin-bottom:14px; display:flex; gap:10px;';
    metaDiv.innerHTML = `
        <div style="flex:1;">
            <label style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:5px;">Empleado</label>
            <select id="edit-employee" style="width:100%; padding:9px; font-size:0.9rem; margin:0; background:rgba(255,255,255,0.08); border:1px solid var(--glass-border); border-radius:8px; color:white;">
                ${empOptions}
                <option value="__manual__" ${!employeesCache.find(e=>e.id===editingMeta.id) ? 'selected':''}>✏️ Manual...</option>
            </select>
        </div>
        <div style="flex:1;">
            <label style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:5px;">Fecha</label>
            <input type="date" id="edit-date" value="${dateToInput(editingMeta.date)}"
                style="width:100%; padding:9px; font-size:0.9rem; margin:0; background:rgba(255,255,255,0.08); border:1px solid var(--glass-border); border-radius:8px; color:white;">
        </div>
    `;
    container.appendChild(metaDiv);

    // Campo manual si seleccionan "Manual..."
    const manualDiv = document.createElement('div');
    manualDiv.id = 'edit-manual-emp';
    manualDiv.style.cssText = 'margin-bottom:14px; display:flex; gap:10px;' + (!employeesCache.find(e=>e.id===editingMeta.id) ? '' : 'display:none;');
    manualDiv.innerHTML = `
        <div style="flex:1;">
            <label style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:5px;">Nombre</label>
            <input type="text" id="edit-emp-name" value="${editingMeta.name}" placeholder="Nombre" style="width:100%; padding:9px; font-size:0.9rem; margin:0;">
        </div>
        <div style="flex:1;">
            <label style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:5px;">ID</label>
            <input type="text" id="edit-emp-id" value="${editingMeta.id}" placeholder="ID" style="width:100%; padding:9px; font-size:0.9rem; margin:0;">
        </div>
    `;
    container.appendChild(manualDiv);

    metaDiv.querySelector('#edit-employee').addEventListener('change', e => {
        if (e.target.value === '__manual__') {
            manualDiv.style.display = 'flex';
        } else {
            manualDiv.style.display = 'none';
            const opt = e.target.selectedOptions[0];
            document.getElementById('edit-emp-name').value = opt.dataset.name;
            document.getElementById('edit-emp-id').value = opt.value;
        }
    });

    // Separador
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid var(--glass-border); margin-bottom:12px;';
    container.appendChild(sep);

    // Lista de registros de hora
    const visible = editingEntries.filter(e => !e.isDeleted);
    if (visible.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'color:var(--text-muted); text-align:center; padding:10px 0;';
        empty.textContent = 'Sin registros de hora. Agrega uno abajo.';
        container.appendChild(empty);
    }
    visible.forEach(entry => {
        const realIdx = editingEntries.indexOf(entry);
        const color = entry.type === 'IN' ? 'var(--success)' : 'var(--warning)';
        const div = document.createElement('div');
        div.style.cssText = 'display:flex; align-items:center; gap:10px; padding:12px; background:rgba(255,255,255,0.04); border-radius:10px; margin-bottom:8px;';
        div.innerHTML = `
            <span style="color:${color}; font-weight:700; width:55px; font-size:0.85rem;">${entry.type}</span>
            <input type="time" value="${entry.time}" data-idx="${realIdx}"
                style="flex:1; padding:9px; font-size:1rem; margin:0; background:rgba(255,255,255,0.08);
                       border:1px solid var(--glass-border); border-radius:8px; color:white;">
            <button data-idx="${realIdx}" class="del-entry-btn btn-small btn-danger" style="padding:6px 10px;">✕</button>
        `;
        container.appendChild(div);
    });

    container.querySelectorAll('input[type="time"]').forEach(input => {
        input.addEventListener('change', e => {
            editingEntries[parseInt(e.target.dataset.idx)].time = e.target.value;
        });
    });
    container.querySelectorAll('.del-entry-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            editingEntries[parseInt(e.target.dataset.idx)].isDeleted = true;
            renderEditEntries();
        });
    });
}

function addLogEntry(type) {
    const now = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    editingEntries.push({ type, time: now, isNew: true, isDeleted: false, _docId: null });
    renderEditEntries();
}

async function saveEditChanges() {
    const saveBtn = document.getElementById('save-edit-log');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    // Leer fecha y empleado actuales del modal
    const dateInput = document.getElementById('edit-date').value;
    const newDate = inputToDate(dateInput);
    const empSelect = document.getElementById('edit-employee');
    let newName, newId;
    if (empSelect.value === '__manual__') {
        newName = document.getElementById('edit-emp-name').value.trim() || editingMeta.name;
        newId   = document.getElementById('edit-emp-id').value.trim()   || editingMeta.id;
    } else {
        newId   = empSelect.value;
        newName = empSelect.selectedOptions[0].dataset.name;
    }

    const [d, mo, y] = newDate.split('/').map(Number);
    const batch = db.batch();

    for (const entry of editingEntries) {
        const [h, m] = entry.time.split(':').map(Number);
        const timestamp = new Date(y, mo - 1, d, h, m, 0).getTime();

        if (entry.isDeleted && !entry.isNew && entry._docId) {
            batch.delete(db.collection('checador_logs').doc(entry._docId));
        } else if (!entry.isDeleted && entry.isNew) {
            batch.set(db.collection('checador_logs').doc(), {
                id: newId, name: newName,
                type: entry.type, time: entry.time,
                date: newDate, timestamp
            });
        } else if (!entry.isDeleted && !entry.isNew && entry._docId) {
            batch.update(db.collection('checador_logs').doc(entry._docId), {
                id: newId, name: newName,
                time: entry.time, date: newDate, timestamp
            });
        }
    }

    await batch.commit();
    document.getElementById('edit-log-modal').style.display = 'none';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar Cambios';
    showNotification('Registros actualizados');
}

document.getElementById('close-edit-log').addEventListener('click', () => {
    document.getElementById('edit-log-modal').style.display = 'none';
});
document.getElementById('add-log-in').addEventListener('click', () => addLogEntry('IN'));
document.getElementById('add-log-out').addEventListener('click', () => addLogEntry('OUT'));
document.getElementById('save-edit-log').addEventListener('click', saveEditChanges);

function renderAdminEmployees() {
    adminEmployeesBody.innerHTML = '';
    employeesCache.forEach(emp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${emp.id}</td>
            <td>${emp.name}</td>
            <td><button class="btn-small btn-danger" onclick="deleteEmployee('${emp.id}')">Eliminar</button></td>
        `;
        adminEmployeesBody.appendChild(tr);
    });
}

function exportToCSV() {
    const data = getGroupedData();
    if (data.length === 0) { showNotification("Sin datos", "danger"); return; }
    let csv = "Empleado,ID,Fecha,Eventos,Total Tiempo,Pago ($70/hr)\n";
    data.forEach(r => {
        const cleanEvents = r.timeline.replace(/<[^>]*>/g, '');
        csv += `"${r.name}","${r.id}","${r.date}","${cleanEvents}","${r.totalStr}","$${r.payment.toFixed(2)}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `reporte_asistencia_${new Date().toLocaleDateString()}.csv`;
    link.click();
}

// Event Listeners
btnIn.addEventListener('click', () => registerAttendance('IN'));
btnOut.addEventListener('click', () => registerAttendance('OUT'));

openAdminBtn.addEventListener('click', () => {
    adminPinInput.value = '';
    adminLogin.style.display = 'flex';
    setTimeout(() => adminPinInput.focus(), 100);
});

adminPinInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click();
    if (e.key === 'Escape') cancelLoginBtn.click();
});
cancelLoginBtn.addEventListener('click', () => {
    adminLogin.style.display = 'none';
    adminPinInput.value = '';
    employeeIdInput.focus();
});
loginBtn.addEventListener('click', () => {
    if (adminPinInput.value === ADMIN_PIN) {
        adminLogin.style.display = 'none';
        adminPanel.style.display = 'flex';
        adminPinInput.value = '';
        renderAdminLogs(); renderAdminEmployees(); renderResumen();
    } else {
        showNotification("PIN Incorrecto", "danger");
        adminPinInput.focus();
    }
});
closeAdminBtn.addEventListener('click', () => {
    adminPanel.style.display = 'none';
    employeeIdInput.focus();
});

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'tab-employees') setTimeout(() => newEmpNameInput.focus(), 100);
        if (btn.dataset.tab === 'tab-resumen') renderResumen();
    });
});

addEmployeeBtn.addEventListener('click', async () => {
    const name = newEmpNameInput.value.trim();
    const id = newEmpIdInput.value.trim();
    if (name && id) {
        const ok = await saveEmployee(name, id);
        if (ok) {
            newEmpNameInput.value = ''; newEmpIdInput.value = '';
            showNotification("Añadido");
        }
    }
});

document.addEventListener('click', (e) => {
    if (e.target && (e.target.textContent === 'LIMPIAR' || e.target.id === 'clear-recent')) {
        recentHidden = true;
        renderHistory();
        showNotification("Vista principal limpia");
    }
});

document.getElementById('set-office-location').addEventListener('click', () => {
    const radius = parseInt(document.getElementById('location-radius').value) || 100;
    showNotification('Obteniendo GPS...');
    navigator.geolocation.getCurrentPosition(
        async pos => {
            const { latitude, longitude, accuracy } = pos.coords;
            await db.collection('checador_config').doc('office').set({ lat: latitude, lng: longitude, radius });
            showNotification(`Guardado. Precisión GPS: ±${Math.round(accuracy)}m`);
        },
        () => showNotification('No se pudo obtener ubicación. Usa el celular.', 'danger'),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
});

document.getElementById('test-location').addEventListener('click', () => {
    if (!officeLocation) { showNotification('Primero guarda la ubicación de la oficina', 'danger'); return; }
    navigator.geolocation.getCurrentPosition(
        pos => {
            const distance = Math.round(haversineDistance(
                pos.coords.latitude, pos.coords.longitude,
                officeLocation.lat, officeLocation.lng
            ));
            const ok = distance <= officeLocation.radius;
            showNotification(
                ok ? `✓ Dentro del radio (${distance}m de la oficina)` : `✗ Fuera del radio: ${distance}m (límite: ${officeLocation.radius}m)`,
                ok ? 'success' : 'danger'
            );
        },
        () => showNotification('No se pudo obtener ubicación', 'danger'),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
});

exportCsvBtn.addEventListener('click', exportToCSV);

clearLogsBtn.addEventListener('click', async () => {
    if (confirm("¿Borrar todo?")) {
        const snap = await db.collection('checador_logs').get();
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        // renderAdminLogs y renderHistory se llaman por el listener
    }
});

function showNotification(m, t = "success") {
    notification.textContent = m;
    notification.style.background = t === "success" ? "var(--primary)" : "#ef4444";
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), 3000);
}

setInterval(updateClock, 1000);
updateClock();
checkNetwork();

setTimeout(() => employeeIdInput.focus(), 500);

// =====================
// PESTAÑA: RESUMEN
// =====================
let currentPeriod = 'semanal';

function parseLogDate(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    return null;
}

function getPeriodRange(period) {
    const now = new Date();
    let start, end;
    if (period === 'semanal') {
        const day = now.getDay();
        const diffToMonday = (day === 0) ? -6 : 1 - day;
        start = new Date(now);
        start.setDate(now.getDate() + diffToMonday);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
    } else if (period === 'mensual') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
    return { start, end };
}

function getPeriodLabel(period) {
    const { start, end } = getPeriodRange(period);
    const fmt = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    if (period === 'semanal') return `${fmt(start)} – ${fmt(end)}`;
    if (period === 'mensual') return start.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return String(start.getFullYear());
}

function getResumenData(period) {
    const { start, end } = getPeriodRange(period);
    const filtered = logsCache.filter(log => {
        const d = parseLogDate(log.date);
        return d && d >= start && d <= end;
    });

    const dayGroups = {};
    filtered.forEach(log => {
        const key = `${log.name.toLowerCase()}-${log.date}`;
        if (!dayGroups[key]) dayGroups[key] = { name: log.name, id: log.id, events: [] };
        dayGroups[key].events.push(log);
    });

    const byEmployee = {};
    Object.values(dayGroups).forEach(group => {
        const k = group.name.toLowerCase();
        if (!byEmployee[k]) byEmployee[k] = { name: group.name, id: group.id, minutes: 0, days: 0 };
        let mins = 0, lastIn = null;
        group.events.forEach(e => {
            if (e.type === 'IN') { lastIn = e.timestamp; }
            else if (e.type === 'OUT' && lastIn) { mins += Math.floor((e.timestamp - lastIn) / 60000); lastIn = null; }
        });
        if (mins > 0) { byEmployee[k].minutes += mins; byEmployee[k].days += 1; }
    });

    return Object.values(byEmployee)
        .map(emp => ({
            ...emp,
            totalStr: `${Math.floor(emp.minutes / 60)}h ${emp.minutes % 60}m`,
            payment: (emp.minutes / 60) * 70
        }))
        .sort((a, b) => b.minutes - a.minutes);
}

function renderResumen() {
    const data = getResumenData(currentPeriod);
    const tbody = document.getElementById('resumen-body');
    const label = document.getElementById('resumen-period-label');
    label.textContent = getPeriodLabel(currentPeriod);
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">Sin registros para este período</td></tr>`;
        return;
    }

    let totalMins = 0, totalPay = 0;
    data.forEach(emp => {
        totalMins += emp.minutes;
        totalPay += emp.payment;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${emp.name}<br><small style="color:var(--text-muted)">ID: ${emp.id}</small></td>
            <td>${emp.days} día${emp.days !== 1 ? 's' : ''}</td>
            <td style="font-weight:bold; color:var(--primary)">${emp.totalStr}</td>
            <td style="font-weight:bold; color:var(--success)">$${emp.payment.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    const totalHrs = Math.floor(totalMins / 60);
    const tfr = document.createElement('tr');
    tfr.style.borderTop = '2px solid var(--glass-border)';
    tfr.innerHTML = `
        <td style="font-weight:bold; color:var(--text-muted);">TOTAL</td>
        <td></td>
        <td style="font-weight:bold; color:var(--primary)">${totalHrs}h ${totalMins % 60}m</td>
        <td style="font-weight:bold; color:var(--success)">$${totalPay.toFixed(2)}</td>
    `;
    tbody.appendChild(tfr);
}

document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        renderResumen();
    });
});
