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
const functions = firebase.functions();

// Caché local (se actualiza en tiempo real desde Firestore)
let logsCache = [];
let employeesCache = [];
let unsubscribeLogs = null;
let unsubscribeEmployees = null;
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

    // Verificar que esté en la red WiFi de la oficina
    if (!isAuthorized) {
        showNotification("Debes estar conectado a la red Wi-Fi de la oficina", "danger");
        return;
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

async function saveEmployee(name, id, phone = '') {
    if (employeesCache.some(e => e.id === id)) { showNotification("ID duplicado", "danger"); return false; }
    await db.collection('checador_employees').add({ name, id, phone });
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
        const sortedEvents = [...group.events].sort((a, b) => a.timestamp - b.timestamp);
        sortedEvents.forEach(event => {
            timelineText.push(`<span style="color:${event.type === 'IN' ? 'var(--success)' : 'var(--warning)'}">${event.type}: ${event.time}</span>`);
            if (event.type === 'IN') { lastInTime = event.timestamp; }
            else if (event.type === 'OUT' && lastInTime) {
                totalMinutes += Math.floor((event.timestamp - lastInTime) / (1000 * 60));
                lastInTime = null;
            }
        });
        // Si sigue activo, contar hasta ahora
        if (lastInTime) totalMinutes += Math.floor((Date.now() - lastInTime) / (1000 * 60));
        const hrs = Math.floor(totalMinutes / 60);
        group.totalStr = `${hrs}h ${totalMinutes % 60}m`;
        group.payment = (totalMinutes / 60) * 70;
        group.timeline = timelineText.join(" | ");
        return group;
    }).reverse();
}

let groupedDataCache = [];
let groupedDataMap = {}; // key: "name-date" → índice en groupedDataCache

function getMinsFromGroup(group) {
    let mins = 0, lastIn = null;
    const sorted = [...group.events].sort((a, b) => a.timestamp - b.timestamp);
    sorted.forEach(e => {
        if (e.type === 'IN') { lastIn = e.timestamp; }
        else if (e.type === 'OUT' && lastIn) { mins += Math.floor((e.timestamp - lastIn) / 60000); lastIn = null; }
    });
    if (lastIn) mins += Math.floor((Date.now() - lastIn) / 60000);
    return mins;
}

function hasActiveIn(group) {
    let lastIn = null;
    [...group.events].sort((a, b) => a.timestamp - b.timestamp).forEach(e => {
        if (e.type === 'IN') lastIn = e.timestamp;
        else if (e.type === 'OUT') lastIn = null;
    });
    return lastIn !== null;
}

function renderAdminLogs() {
    const data = getGroupedData();
    groupedDataCache = data;
    groupedDataMap = {};
    data.forEach((group, idx) => {
        groupedDataMap[`${group.name.toLowerCase()}-${group.date}`] = idx;
    });

    const table = document.getElementById('admin-table');
    const thead = table.querySelector('thead');

    // Fechas únicas (desc) y empleados únicos (por nombre)
    const dateSet = new Set(logsCache.map(l => l.date));
    const parseD = s => { const [d,m,y] = s.split('/').map(Number); return new Date(y, m-1, d); };
    const dates = [...dateSet].sort((a, b) => parseD(a) - parseD(b));

    const empMap = {};
    logsCache.forEach(l => { const k = l.name.toLowerCase(); if (!empMap[k]) empMap[k] = { name: l.name, id: l.id }; });
    const employees = Object.values(empMap).sort((a, b) => a.name.localeCompare(b.name));

    if (!dates.length || !employees.length) {
        thead.innerHTML = '<tr><th>Sin registros</th></tr>';
        adminLogsBody.innerHTML = '<tr><td style="color:var(--text-muted); text-align:center; padding:20px;">Sin datos</td></tr>';
        return;
    }

    // Encabezado dinámico
    thead.innerHTML = `<tr>
        <th style="min-width:75px;">Fecha</th>
        ${employees.map(e => `<th style="text-align:center; min-width:85px;">${e.name}<br><small style="font-weight:400; color:var(--text-muted);">ID: ${e.id}</small></th>`).join('')}
        <th style="text-align:center; min-width:70px;">Total</th>
    </tr>`;

    adminLogsBody.innerHTML = '';
    const empTotals = {};
    employees.forEach(e => empTotals[e.name.toLowerCase()] = 0);

    dates.forEach(date => {
        const dateObj = parseD(date);
        const [d, m] = date.split('/');
        const dayName = dateObj.toLocaleDateString('es-MX', { weekday: 'short' });
        const label = `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${d}/${m}`;

        let dayMins = 0;
        const cells = employees.map(emp => {
            const key = `${emp.name.toLowerCase()}-${date}`;
            const idx = groupedDataMap[key];
            if (idx === undefined) return `<td style="text-align:center; color:rgba(255,255,255,0.15);">—</td>`;
            const group = data[idx];
            const mins = getMinsFromGroup(group);
            dayMins += mins;
            empTotals[emp.name.toLowerCase()] += mins;
            const active = hasActiveIn(group);
            const label2 = mins > 0 ? `${Math.floor(mins/60)}h ${mins%60}m` : (active ? '▶ activo' : '0h 0m');
            const color = mins > 0 ? 'var(--success)' : (active ? 'var(--warning)' : 'var(--text-muted)');
            return `<td style="text-align:center; cursor:pointer;" onclick="openEditModal(${idx})" title="Click para editar">
                <span style="color:${color}; font-weight:600; font-size:0.9rem;">${label2}</span>
            </td>`;
        });

        const dayStr = dayMins > 0 ? `${Math.floor(dayMins/60)}h ${dayMins%60}m` : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-weight:600; white-space:nowrap; font-size:0.85rem;">${label}</td>${cells.join('')}<td style="text-align:center; font-weight:bold; color:var(--primary); font-size:0.85rem;">${dayStr}</td>`;
        adminLogsBody.appendChild(tr);
    });

    // Fila de totales
    const totalCells = employees.map(e => {
        const mins = empTotals[e.name.toLowerCase()];
        return `<td style="text-align:center; border-top:2px solid var(--glass-border);">
            <span style="font-weight:bold; color:var(--success);">${mins > 0 ? `${Math.floor(mins/60)}h ${mins%60}m` : '—'}</span>
            ${mins > 0 ? `<br><small style="color:var(--text-muted);">$${((mins/60)*70).toFixed(0)}</small>` : ''}
        </td>`;
    }).join('');
    const totalAll = Object.values(empTotals).reduce((a,b) => a+b, 0);
    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `<td style="font-weight:bold; color:var(--text-muted); border-top:2px solid var(--glass-border);">TOTAL</td>${totalCells}<td style="text-align:center; font-weight:bold; color:var(--primary); border-top:2px solid var(--glass-border);">${totalAll > 0 ? `${Math.floor(totalAll/60)}h ${totalAll%60}m` : '—'}</td>`;
    adminLogsBody.appendChild(totalRow);
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
        const phoneDisplay = emp.phone
            ? `<span style="color:var(--success); font-size:0.82rem;">${emp.phone}</span>`
            : `<span style="color:var(--text-muted); font-size:0.8rem;">Sin número</span>`;
        tr.innerHTML = `
            <td>${emp.id}</td>
            <td>${emp.name}</td>
            <td>${phoneDisplay}</td>
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
    const phone = document.getElementById('new-emp-phone').value.trim();
    if (name && id) {
        const ok = await saveEmployee(name, id, phone);
        if (ok) {
            newEmpNameInput.value = ''; newEmpIdInput.value = '';
            document.getElementById('new-emp-phone').value = '';
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
        let mins = 0, lastIn = null, hasIn = false;
        // Ordenar eventos cronológicamente antes de calcular
        const sorted = [...group.events].sort((a, b) => a.timestamp - b.timestamp);
        sorted.forEach(e => {
            if (e.type === 'IN') { lastIn = e.timestamp; hasIn = true; }
            else if (e.type === 'OUT' && lastIn) { mins += Math.floor((e.timestamp - lastIn) / 60000); lastIn = null; }
        });
        // Si sigue activo (hay IN pero no OUT), contar hasta ahora
        if (lastIn) mins += Math.floor((Date.now() - lastIn) / 60000);
        if (hasIn) { byEmployee[k].minutes += mins; byEmployee[k].days += 1; }
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

// =====================
// ENVÍO POR WHATSAPP
// =====================
document.getElementById('send-whatsapp-btn').addEventListener('click', async () => {
    const btn = document.getElementById('send-whatsapp-btn');
    const data = getResumenData(currentPeriod);

    if (data.length === 0) {
        showNotification('Sin datos para enviar', 'danger');
        return;
    }

    const withPhone = employeesCache.filter(e => e.phone);
    if (withPhone.length === 0) {
        showNotification('Ningún empleado tiene número de WhatsApp registrado', 'danger');
        return;
    }

    if (!confirm(`¿Enviar reporte ${currentPeriod} a ${withPhone.length} empleado(s) por WhatsApp?`)) return;

    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
        const sendReport = functions.httpsCallable('sendReportManual');
        const result = await sendReport({ period: currentPeriod });
        const { sent, skipped, errors } = result.data;
        showNotification(`✓ Enviado a ${sent} empleado(s)${errors > 0 ? `. ${errors} error(es)` : ''}`);
    } catch (err) {
        console.error('Error enviando reportes:', err);
        showNotification('Error al enviar: ' + (err.message || 'Intenta de nuevo'), 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '📲 Enviar por WhatsApp';
    }
});
