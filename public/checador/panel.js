// Firebase config
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

const ADMIN_PIN = "1234";

let logsCache = [];
let employeesCache = [];
let adjustmentsCache = [];
let weekOffset = 0; // 0 = semana actual, -1 = anterior, etc.

// =====================
// AUTH
// =====================
firebaseAuth.onAuthStateChanged(user => {
    if (!user) {
        window.location.href = '/checador/';
    } else {
        db.collection('checador_logs').orderBy('timestamp', 'desc')
            .onSnapshot(snap => {
                logsCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
                if (document.getElementById('panel-content').style.display !== 'none') {
                    renderAdminLogs();
                    renderResumen();
                }
            });
        db.collection('checador_employees')
            .onSnapshot(snap => {
                employeesCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
                // Auto-asignar PIN a empleados que no tengan
                employeesCache.forEach(emp => {
                    if (!emp.pin) {
                        const pin = generatePin();
                        db.collection('checador_employees').doc(emp._docId).update({ pin });
                    }
                });
                if (document.getElementById('panel-content').style.display !== 'none') {
                    renderAdminEmployees();
                }
            });
        db.collection('checador_adjustments')
            .onSnapshot(snap => {
                adjustmentsCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
                if (document.getElementById('panel-content').style.display !== 'none') {
                    renderAdminLogs();
                }
            });
    }
});

// =====================
// PIN
// =====================
document.getElementById('admin-pin').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pin-submit').click();
});

document.getElementById('pin-submit').addEventListener('click', () => {
    if (document.getElementById('admin-pin').value === ADMIN_PIN) {
        document.getElementById('pin-view').style.display = 'none';
        document.getElementById('panel-content').style.display = 'block';
        renderAdminLogs();
        renderAdminEmployees();
        renderResumen();
    } else {
        showNotification('PIN Incorrecto', 'danger');
        document.getElementById('admin-pin').focus();
    }
});

setTimeout(() => document.getElementById('admin-pin').focus(), 300);

// =====================
// WEEK NAVIGATION
// =====================
function getWeekRange(offset) {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day === 0) ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    saturday.setHours(23, 59, 59, 999);
    return { start: monday, end: saturday };
}

function getWeekDates(offset) {
    const { start } = getWeekRange(offset);
    const dates = [];
    for (let i = 0; i < 6; i++) { // Lun a Sáb
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function formatWeekLabel(offset) {
    const { start, end } = getWeekRange(offset);
    const fmt = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    return `${fmt(start)} — ${fmt(end)}, ${start.getFullYear()}`;
}

function dateObjToStr(d) {
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

document.getElementById('prev-week').addEventListener('click', () => {
    weekOffset--;
    renderAdminLogs();
});

document.getElementById('next-week').addEventListener('click', () => {
    if (weekOffset < 0) { weekOffset++; renderAdminLogs(); }
});

// =====================
// GROUPED DATA
// =====================
let groupedDataCache = [];
let groupedDataMap = {};

function resolveLogName(log) {
    // Si el name del log coincide con un ID de empleado, usar el nombre real
    const emp = employeesCache.find(e => e.id === log.name);
    return emp ? emp.name : log.name;
}

function getGroupedData() {
    const sortedLogs = [...logsCache].reverse();
    const groups = {};
    sortedLogs.forEach(log => {
        const resolved = resolveLogName(log);
        const key = `${resolved.toLowerCase()}-${log.date}`;
        if (!groups[key]) groups[key] = { id: log.id, name: resolved, date: log.date, events: [] };
        groups[key].events.push(log);
    });
    return Object.values(groups).map(group => {
        let totalMinutes = 0, lastInTime = null, timelineText = [];
        const sortedEvents = [...group.events].sort((a, b) => a.timestamp - b.timestamp);
        sortedEvents.forEach(event => {
            timelineText.push(`<span style="color:${event.type === 'IN' ? 'var(--success)' : 'var(--warning)'}">${event.type}: ${event.time}</span>`);
            if (event.type === 'IN') { lastInTime = event.timestamp; }
            else if (event.type === 'OUT' && lastInTime) {
                totalMinutes += Math.floor((event.timestamp - lastInTime) / 60000);
                lastInTime = null;
            }
        });
        if (lastInTime) totalMinutes += Math.floor((Date.now() - lastInTime) / 60000);
        group.totalStr = `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
        group.payment = (totalMinutes / 60) * 70;
        group.timeline = timelineText.join(" | ");
        return group;
    }).reverse();
}

function getMinsFromGroup(group) {
    let mins = 0, lastIn = null;
    [...group.events].sort((a, b) => a.timestamp - b.timestamp).forEach(e => {
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

// =====================
// VACACIONES
// =====================
function getVacationMinutes(dayOfWeek) {
    // 0=Dom, 1=Lun, ..., 5=Vie, 6=Sáb
    if (dayOfWeek >= 1 && dayOfWeek <= 5) return 360; // L-V: 9am-3pm = 6h
    if (dayOfWeek === 6) return 240; // Sáb: 9am-1pm = 4h
    return 0;
}

function isOnVacation(empName, checkDate) {
    const emp = employeesCache.find(e => e.name.toLowerCase() === empName.toLowerCase());
    if (!emp || !emp.vacaciones || !emp.vacacionesDesde || !emp.vacacionesHasta) return false;
    const d = checkDate ? new Date(checkDate) : new Date();
    d.setHours(12, 0, 0, 0);
    const desde = new Date(emp.vacacionesDesde + 'T00:00:00');
    const hasta = new Date(emp.vacacionesHasta + 'T23:59:59');
    return d >= desde && d <= hasta;
}

// =====================
// ASISTENCIA (VISTA SEMANAL)
// =====================
function renderAdminLogs() {
    const data = getGroupedData();
    groupedDataCache = data;
    groupedDataMap = {};
    data.forEach((group, idx) => {
        groupedDataMap[`${group.name.toLowerCase()}-${group.date}`] = idx;
    });

    const thead = document.getElementById('admin-table').querySelector('thead');
    const tbody = document.getElementById('admin-logs-body');

    // Actualizar navegación
    document.getElementById('week-label').textContent = formatWeekLabel(weekOffset);
    document.getElementById('next-week').disabled = weekOffset >= 0;

    // 6 días de la semana (Lun-Sáb)
    const weekDates = getWeekDates(weekOffset);
    const weekDateStrs = weekDates.map(dateObjToStr);

    // Empleados: registrados + cualquiera que aparezca en logs
    const empMap = {};
    // Mapa de id -> nombre para resolver logs con ID en vez de nombre
    const idToName = {};
    employeesCache.forEach(e => {
        empMap[e.name.toLowerCase()] = { name: e.name };
        if (e.id) idToName[e.id] = e.name;
    });
    logsCache.forEach(l => {
        // Si el name del log coincide con un ID de empleado, usar el nombre real
        const resolvedName = idToName[l.name] || l.name;
        if (!empMap[resolvedName.toLowerCase()]) empMap[resolvedName.toLowerCase()] = { name: resolvedName };
    });
    const employees = Object.values(empMap).sort((a, b) => a.name.localeCompare(b.name));

    if (!employees.length) {
        thead.innerHTML = '<tr><th>Sin registros</th></tr>';
        tbody.innerHTML = '<tr><td style="color:var(--text-muted); text-align:center; padding:20px;">Añade personas en la pestaña Equipo</td></tr>';
        return;
    }

    // Encabezado: Fecha | Emp1 | Emp2 | ... | Total
    thead.innerHTML = `<tr>
        <th style="min-width:75px;">Fecha</th>
        ${employees.map(e => {
            const isRecognized = employeesCache.some(emp => emp.name.toLowerCase() === e.name.toLowerCase());
            if (isRecognized) {
                return `<th style="text-align:center; min-width:85px;">${e.name}</th>`;
            } else {
                return `<th style="text-align:center; min-width:85px; cursor:pointer; color:var(--warning);" onclick="promptMergeEmployee('${e.name.replace(/'/g, "\\'")}')" title="Click para asignar">${e.name} ⚠️</th>`;
            }
        }).join('')}
        <th style="text-align:center; min-width:70px;">Total</th>
    </tr>`;

    tbody.innerHTML = '';
    const empTotals = {};
    employees.forEach(e => empTotals[e.name.toLowerCase()] = 0);

    weekDates.forEach((dateObj, i) => {
        const dateStr = weekDateStrs[i];
        const dayName = dateObj.toLocaleDateString('es-MX', { weekday: 'short' });
        const label = `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${dateObj.getDate()}/${dateObj.getMonth() + 1}`;

        let dayMins = 0;
        const cells = employees.map(emp => {
            const key = `${emp.name.toLowerCase()}-${dateStr}`;
            const idx = groupedDataMap[key];
            // Vacaciones: si no hay logs y está de vacaciones en esa fecha, auto-llenar horas
            if (idx === undefined && isOnVacation(emp.name, dateObj)) {
                const today = new Date(); today.setHours(23, 59, 59, 999);
                if (dateObj <= today) {
                    const vacMins = getVacationMinutes(dateObj.getDay());
                    if (vacMins > 0) {
                        dayMins += vacMins;
                        empTotals[emp.name.toLowerCase()] += vacMins;
                        return `<td style="text-align:center;"><span style="color:#f59e0b; font-weight:600; font-size:0.9rem;">🏖 ${Math.floor(vacMins/60)}h</span></td>`;
                    }
                }
            }
            if (idx === undefined) return `<td style="text-align:center; cursor:pointer; color:rgba(255,255,255,0.15);" onclick="openNewEntryModal('${emp.name}', '${emp.id}', '${dateStr}')" title="Click para agregar">—</td>`;
            const group = data[idx];
            const mins = getMinsFromGroup(group);
            dayMins += mins;
            empTotals[emp.name.toLowerCase()] += mins;
            const active = hasActiveIn(group);
            const cellLabel = mins > 0 ? `${Math.floor(mins/60)}h ${mins%60}m` : (active ? '▶ activo' : '0h 0m');
            const color = mins > 0 ? 'var(--success)' : (active ? 'var(--warning)' : 'var(--text-muted)');
            return `<td style="text-align:center; cursor:pointer;" onclick="openEditModal(${idx})" title="Click para editar">
                <span style="color:${color}; font-weight:600; font-size:0.9rem;">${cellLabel}</span>
            </td>`;
        });

        const dayStr = dayMins > 0 ? `${Math.floor(dayMins/60)}h ${dayMins%60}m` : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-weight:600; white-space:nowrap; font-size:0.85rem;">${label}</td>${cells.join('')}<td style="text-align:center; font-weight:bold; color:var(--primary); font-size:0.85rem;">${dayStr}</td>`;
        tbody.appendChild(tr);
    });

    // Obtener rango de la semana para filtrar ajustes
    const { start: weekStart, end: weekEnd } = getWeekRange(weekOffset);

    // Fila de totales
    const totalCells = employees.map(e => {
        const mins = empTotals[e.name.toLowerCase()];
        const basePay = Math.round((mins / 60) * 70);
        // Ajustes de esta persona en esta semana
        const adjs = getWeekAdjustments(e.name, weekStart, weekEnd);
        const adjTotal = adjs.reduce((sum, a) => sum + (a.type === 'bono' ? a.amount : -a.amount), 0);
        const finalPay = basePay + adjTotal;
        const adjLabel = adjTotal !== 0 ? `<br><small style="color:${adjTotal > 0 ? '#10b981' : '#ef4444'};">${adjTotal > 0 ? '+' : ''}$${adjTotal}</small>` : '';
        return `<td style="text-align:center; border-top:2px solid var(--glass-border);">
            <span style="font-weight:bold; color:var(--success);">${mins > 0 ? `${Math.floor(mins/60)}h ${mins%60}m` : '—'}</span>
            ${mins > 0 || adjTotal !== 0 ? `<br><small style="color:var(--text-muted);">$${finalPay}</small>${adjLabel}` : ''}
            <br><span style="cursor:pointer; font-size:0.7rem; color:var(--primary); opacity:0.7;" onclick="openAdjModal('${e.name.replace(/'/g, "\\'")}')">+/-</span>
        </td>`;
    }).join('');
    const totalAll = Object.values(empTotals).reduce((a, b) => a + b, 0);
    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `<td style="font-weight:bold; color:var(--text-muted); border-top:2px solid var(--glass-border);">TOTAL</td>${totalCells}<td style="text-align:center; font-weight:bold; color:var(--primary); border-top:2px solid var(--glass-border);">${totalAll > 0 ? `${Math.floor(totalAll/60)}h ${totalAll%60}m` : '—'}</td>`;
    tbody.appendChild(totalRow);
}

// =====================
// MERGE EMPLEADOS NO RECONOCIDOS
// =====================
async function promptMergeEmployee(oldName) {
    const options = employeesCache.map((e, i) => `${i + 1}. ${e.name}`).join('\n');
    const input = prompt(`"${oldName}" no esta reconocido.\n\nEscribe el numero o nombre al que pertenecen estos registros:\n${options}`);
    if (!input) return;

    let emp;
    const num = parseInt(input);
    if (!isNaN(num) && num >= 1 && num <= employeesCache.length) {
        emp = employeesCache[num - 1];
    } else {
        emp = employeesCache.find(e => e.name.toLowerCase() === input.trim().toLowerCase());
    }
    if (!emp) { showNotification('No encontrado', 'danger'); return; }

    if (!confirm(`¿Mover todos los registros de "${oldName}" a "${emp.name}"?`)) return;

    const snap = await db.collection('checador_logs').where('name', '==', oldName).get();
    if (snap.empty) { showNotification('No se encontraron registros', 'danger'); return; }

    const batchSize = 500;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += batchSize) {
        const batch = db.batch();
        docs.slice(i, i + batchSize).forEach(doc => batch.update(doc.ref, { name: emp.name, id: emp.id }));
        await batch.commit();
    }
    showNotification(`${docs.length} registro(s) movidos a ${emp.name}`);
}

// =====================
// EDICIÓN DE REGISTROS
// =====================
let editingEntries = [];
let editingMeta = null;

function openEditModal(idx) {
    const group = groupedDataCache[idx];
    editingMeta = { name: group.name, id: group.id, date: group.date };
    editingEntries = [...group.events]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(e => ({ ...e, isNew: false, isDeleted: false }));
    document.getElementById('edit-log-title').textContent = `${group.name} — ${group.date}`;
    renderEditEntries();
    document.getElementById('edit-log-modal').style.display = 'flex';
}

function openNewEntryModal(empName, empId, dateStr) {
    // Convertir dateStr (YYYY-MM-DD) a formato D/M/YYYY
    const [y, m, d] = dateStr.split('-');
    const displayDate = `${parseInt(d)}/${parseInt(m)}/${y}`;
    editingMeta = { name: empName, id: empId, date: displayDate };
    editingEntries = [];
    document.getElementById('edit-log-title').textContent = `${empName} — ${displayDate}`;
    renderEditEntries();
    document.getElementById('edit-log-modal').style.display = 'flex';
}

function dateToInput(dateStr) {
    const [d, m, y] = dateStr.split('/');
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function inputToDate(val) {
    const [y, m, d] = val.split('-');
    return `${parseInt(d)}/${parseInt(m)}/${y}`;
}

function renderEditEntries() {
    const container = document.getElementById('edit-log-entries');
    container.innerHTML = '';

    // Selector de empleado (sin ID visible)
    const empOptions = employeesCache.map(e =>
        `<option value="${e.id}" data-name="${e.name}" ${e.name.toLowerCase() === editingMeta.name.toLowerCase() ? 'selected' : ''}>${e.name}</option>`
    ).join('');

    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'margin-bottom:14px; display:flex; gap:10px;';
    metaDiv.innerHTML = `
        <div style="flex:1;">
            <label style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:5px;">Nombre</label>
            <select id="edit-employee" style="width:100%; padding:9px; font-size:0.9rem; margin:0; background:rgba(255,255,255,0.08); border:1px solid var(--glass-border); border-radius:8px; color:white;">
                ${empOptions}
                <option value="__manual__" ${!employeesCache.find(e => e.name.toLowerCase() === editingMeta.name.toLowerCase()) ? 'selected' : ''}>✏️ Manual...</option>
            </select>
        </div>
        <div style="flex:1;">
            <label style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:5px;">Fecha</label>
            <input type="date" id="edit-date" value="${dateToInput(editingMeta.date)}"
                style="width:100%; padding:9px; font-size:0.9rem; margin:0; background:rgba(255,255,255,0.08); border:1px solid var(--glass-border); border-radius:8px; color:white;">
        </div>
    `;
    container.appendChild(metaDiv);

    // Campo manual
    const isManual = !employeesCache.find(e => e.name.toLowerCase() === editingMeta.name.toLowerCase());
    const manualDiv = document.createElement('div');
    manualDiv.id = 'edit-manual-emp';
    manualDiv.style.cssText = `margin-bottom:14px; ${isManual ? 'display:flex;' : 'display:none;'} gap:10px;`;
    manualDiv.innerHTML = `
        <div style="flex:1;">
            <label style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:5px;">Nombre</label>
            <input type="text" id="edit-emp-name" value="${editingMeta.name}" placeholder="Nombre" style="width:100%; padding:9px; font-size:0.9rem; margin:0;">
        </div>
    `;
    container.appendChild(manualDiv);

    metaDiv.querySelector('#edit-employee').addEventListener('change', e => {
        if (e.target.value === '__manual__') {
            manualDiv.style.display = 'flex';
        } else {
            manualDiv.style.display = 'none';
            document.getElementById('edit-emp-name').value = e.target.selectedOptions[0].dataset.name;
        }
    });

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

    const newDate = inputToDate(document.getElementById('edit-date').value);
    const empSelect = document.getElementById('edit-employee');
    let newName, newId;
    if (empSelect.value === '__manual__') {
        newName = document.getElementById('edit-emp-name').value.trim() || editingMeta.name;
        newId = editingMeta.id || newName;
    } else {
        newId = empSelect.value;
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
                id: newId, name: newName, type: entry.type, time: entry.time, date: newDate, timestamp
            });
        } else if (!entry.isDeleted && !entry.isNew && entry._docId) {
            batch.update(db.collection('checador_logs').doc(entry._docId), {
                id: newId, name: newName, time: entry.time, date: newDate, timestamp
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

// =====================
// EMPLEADOS
// =====================
function generatePin() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

async function saveEmployee(name, phone) {
    if (employeesCache.some(e => e.name.toLowerCase() === name.toLowerCase())) {
        showNotification("Nombre duplicado", "danger");
        return false;
    }
    const pin = generatePin();
    await db.collection('checador_employees').add({ name, id: Date.now().toString(), phone, pin });
    showNotification(`PIN asignado: ${pin}`);
    return true;
}

async function regeneratePin(docId) {
    const pin = generatePin();
    await db.collection('checador_employees').doc(docId).update({ pin });
    showNotification(`Nuevo PIN: ${pin}`);
}

async function deleteEmployee(docId) {
    await db.collection('checador_employees').doc(docId).delete();
}

async function updateEmployee(docId, field, value, oldName) {
    // Obtener el id interno del empleado antes de actualizar
    const emp = employeesCache.find(e => e._docId === docId);
    const empId = emp ? emp.id : null;

    await db.collection('checador_employees').doc(docId).update({ [field]: value });

    // Si cambió el nombre, actualizar todos los logs históricos de ese empleado
    if (field === 'name' && oldName) {
        // Buscar logs por nombre anterior
        const snap = await db.collection('checador_logs').where('name', '==', oldName).get();
        if (!snap.empty) {
            const batch = db.batch();
            snap.docs.forEach(doc => batch.update(doc.ref, { name: value }));
            await batch.commit();
        }
        // Buscar logs por id interno del empleado (cubre registros legacy donde name=id)
        if (empId) {
            const snap2 = await db.collection('checador_logs').where('id', '==', empId).get();
            if (!snap2.empty) {
                const batch2 = db.batch();
                snap2.docs.forEach(doc => batch2.update(doc.ref, { name: value }));
                await batch2.commit();
            }
        }
    }
    showNotification('Actualizado');
}

function renderAdminEmployees() {
    const tbody = document.getElementById('admin-employees-body');
    tbody.innerHTML = '';
    employeesCache.forEach(emp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${emp.name}" data-doc="${emp._docId}" data-field="name"
                style="background:transparent; border:1px solid transparent; color:white; padding:6px 8px; border-radius:6px; width:100%; font-size:0.9rem;"
                onfocus="this.style.borderColor='var(--primary)'; this.style.background='rgba(255,255,255,0.08)'"
                onblur="this.style.borderColor='transparent'; this.style.background='transparent'"></td>
            <td><input type="tel" value="${emp.phone || ''}" data-doc="${emp._docId}" data-field="phone" placeholder="Sin número"
                style="background:transparent; border:1px solid transparent; color:var(--success); padding:6px 8px; border-radius:6px; width:100%; font-size:0.82rem;"
                onfocus="this.style.borderColor='var(--primary)'; this.style.background='rgba(255,255,255,0.08)'"
                onblur="this.style.borderColor='transparent'; this.style.background='transparent'"></td>
            <td style="text-align:center;">
                <span style="font-family:monospace; font-size:1rem; letter-spacing:2px; color:var(--primary); font-weight:700;">${emp.pin || '—'}</span>
                <button class="btn-small" onclick="regeneratePin('${emp._docId}')" style="margin-left:6px; padding:4px 8px; font-size:0.7rem;" title="Generar nuevo PIN">🔄</button>
            </td>
            <td style="text-align:center;">
                <button class="btn-small vacation-toggle" data-doc="${emp._docId}" data-name="${emp.name}"
                    style="padding:6px 12px; font-size:0.78rem; border-radius:10px; cursor:pointer;
                    ${emp.vacaciones && emp.vacacionesDesde ? 'background:linear-gradient(135deg,#f59e0b,#d97706); color:white; border:none;' : 'background:rgba(255,255,255,0.1); color:var(--text-muted); border:1px solid var(--glass-border);'}">
                    ${emp.vacaciones && emp.vacacionesDesde && emp.vacacionesHasta ? `🏖 ${emp.vacacionesDesde.slice(5)} a ${emp.vacacionesHasta.slice(5)}` : 'No'}
                </button>
            </td>
            <td><button class="btn-small btn-danger" onclick="deleteEmployee('${emp._docId}')">Eliminar</button></td>
        `;
        // Guardar al presionar Enter o al perder foco si cambió el valor
        tr.querySelectorAll('input').forEach(input => {
            const original = input.value;
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            });
            input.addEventListener('blur', () => {
                const newVal = input.value.trim();
                if (newVal !== original && (input.dataset.field !== 'name' || newVal)) {
                    updateEmployee(input.dataset.doc, input.dataset.field, newVal, input.dataset.field === 'name' ? original : null);
                }
            });
        });
        tr.querySelectorAll('.vacation-toggle').forEach(btn => {
            btn.addEventListener('click', () => openVacModal(btn.dataset.doc, btn.dataset.name));
        });
        tbody.appendChild(tr);
    });
}

document.getElementById('add-employee-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-emp-name').value.trim();
    const phone = document.getElementById('new-emp-phone').value.trim();
    if (name) {
        const ok = await saveEmployee(name, phone);
        if (ok) {
            document.getElementById('new-emp-name').value = '';
            document.getElementById('new-emp-phone').value = '';
            showNotification("Añadido");
        }
    }
});

// =====================
// CSV EXPORT
// =====================
function exportToCSV() {
    const data = getGroupedData();
    if (data.length === 0) { showNotification("Sin datos", "danger"); return; }
    const { start: wkS, end: wkE } = getWeekRange(weekOffset);
    let csv = "Nombre,Fecha,Eventos,Total Tiempo,Pago Horas,Ajustes,Pago Final\n";
    data.forEach(r => {
        const cleanEvents = r.timeline.replace(/<[^>]*>/g, '');
        const adjs = getWeekAdjustments(r.name, wkS, wkE);
        const adjSum = adjs.reduce((s, a) => s + (a.type === 'bono' ? a.amount : -a.amount), 0);
        const basePay = r.payment.toFixed(2);
        const adjText = adjs.map(a => `${a.type === 'bono' ? '+' : '-'}$${a.amount} ${a.concept || ''}`).join('; ') || '—';
        const finalPay = (r.payment + adjSum).toFixed(2);
        csv += `"${r.name}","${r.date}","${cleanEvents}","${r.totalStr}","$${basePay}","${adjText}","$${finalPay}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `reporte_asistencia_${new Date().toLocaleDateString()}.csv`;
    link.click();
}

document.getElementById('export-csv').addEventListener('click', exportToCSV);

document.getElementById('clear-all-logs').addEventListener('click', async () => {
    if (confirm("¿Borrar todo?")) {
        const snap = await db.collection('checador_logs').get();
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
});

// =====================
// TABS
// =====================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'tab-employees') setTimeout(() => document.getElementById('new-emp-name').focus(), 100);
        if (btn.dataset.tab === 'tab-resumen') renderResumen();
    });
});

// =====================
// RESUMEN
// =====================
let currentPeriod = 'semanal';

function parseLogDate(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length === 3) return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    return null;
}

function getPeriodRange(period) {
    const now = new Date();
    let start, end;
    if (period === 'semanal') {
        const day = now.getDay();
        const diff = (day === 0) ? -6 : 1 - day;
        start = new Date(now);
        start.setDate(now.getDate() + diff);
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
        const resolved = resolveLogName(log);
        const key = `${resolved.toLowerCase()}-${log.date}`;
        if (!dayGroups[key]) dayGroups[key] = { name: resolved, events: [] };
        dayGroups[key].events.push(log);
    });

    const byEmployee = {};
    Object.values(dayGroups).forEach(group => {
        const k = group.name.toLowerCase();
        if (!byEmployee[k]) byEmployee[k] = { name: group.name, minutes: 0, days: 0 };
        let mins = 0, lastIn = null, hasIn = false;
        [...group.events].sort((a, b) => a.timestamp - b.timestamp).forEach(e => {
            if (e.type === 'IN') { lastIn = e.timestamp; hasIn = true; }
            else if (e.type === 'OUT' && lastIn) { mins += Math.floor((e.timestamp - lastIn) / 60000); lastIn = null; }
        });
        if (lastIn) mins += Math.floor((Date.now() - lastIn) / 60000);
        if (hasIn) { byEmployee[k].minutes += mins; byEmployee[k].days += 1; }
    });

    // Agregar días de vacaciones para empleados que estén de vacaciones en cada fecha
    const today = new Date(); today.setHours(23, 59, 59, 999);
    employeesCache.forEach(emp => {
        if (!emp.vacaciones || !emp.vacacionesDesde || !emp.vacacionesHasta) return;
        const k = emp.name.toLowerCase();
        if (!byEmployee[k]) byEmployee[k] = { name: emp.name, minutes: 0, days: 0 };
        const cur = new Date(start);
        while (cur <= end && cur <= today) {
            if (isOnVacation(emp.name, cur)) {
                const dateStr = `${cur.getDate()}/${cur.getMonth() + 1}/${cur.getFullYear()}`;
                const dayKey = `${k}-${dateStr}`;
                if (!dayGroups[dayKey]) {
                    const vacMins = getVacationMinutes(cur.getDay());
                    if (vacMins > 0) { byEmployee[k].minutes += vacMins; byEmployee[k].days += 1; }
                }
            }
            cur.setDate(cur.getDate() + 1);
        }
    });

    return Object.values(byEmployee)
        .map(emp => ({
            ...emp,
            totalStr: `${Math.floor(emp.minutes / 60)}h ${emp.minutes % 60}m`,
            payment: (emp.minutes / 60) * 70
        }))
        .sort((a, b) => b.minutes - a.minutes);
}

function getAdjustmentsForPeriod(name, start, end) {
    return adjustmentsCache.filter(a => {
        if (a.name.toLowerCase() !== name.toLowerCase()) return false;
        const d = a.timestamp ? new Date(a.timestamp) : null;
        return d && d >= start && d <= end;
    });
}

function renderResumen() {
    const data = getResumenData(currentPeriod);
    const { start, end } = getPeriodRange(currentPeriod);
    const tbody = document.getElementById('resumen-body');
    document.getElementById('resumen-period-label').textContent = getPeriodLabel(currentPeriod);
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">Sin registros para este periodo</td></tr>`;
        return;
    }

    let totalMins = 0, totalBasePay = 0, totalAdjSum = 0, totalFinal = 0;
    data.forEach(emp => {
        totalMins += emp.minutes;
        const basePay = Math.round(emp.payment);
        totalBasePay += basePay;

        // Ajustes del periodo
        const adjs = getAdjustmentsForPeriod(emp.name, start, end);
        const adjSum = adjs.reduce((s, a) => s + (a.type === 'bono' ? a.amount : -a.amount), 0);
        totalAdjSum += adjSum;
        const finalPay = basePay + adjSum;
        totalFinal += finalPay;

        const adjLabel = adjSum !== 0
            ? `<span style="color:${adjSum > 0 ? '#10b981' : '#ef4444'}; font-weight:600;">${adjSum > 0 ? '+' : ''}$${adjSum}</span>`
            : '<span style="color:var(--text-muted);">—</span>';
        const adjDetail = adjs.length > 0
            ? `<br><small style="color:var(--text-muted);">${adjs.map(a => `${a.type === 'bono' ? '+' : '-'}$${a.amount} ${a.concept || ''}`).join(', ')}</small>`
            : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${emp.name}</td>
            <td>${emp.days} dia${emp.days !== 1 ? 's' : ''}</td>
            <td style="font-weight:bold; color:var(--primary)">${emp.totalStr}</td>
            <td style="color:var(--text-muted)">$${basePay.toLocaleString()}</td>
            <td>${adjLabel}${adjDetail}</td>
            <td style="font-weight:bold; color:var(--success)">$${finalPay.toLocaleString()}</td>
        `;
        tbody.appendChild(tr);
    });

    const tfr = document.createElement('tr');
    tfr.style.borderTop = '2px solid var(--glass-border)';
    const totalAdjLabel = totalAdjSum !== 0
        ? `<span style="color:${totalAdjSum > 0 ? '#10b981' : '#ef4444'}; font-weight:600;">${totalAdjSum > 0 ? '+' : ''}$${totalAdjSum}</span>`
        : '—';
    tfr.innerHTML = `
        <td style="font-weight:bold; color:var(--text-muted);">TOTAL</td>
        <td></td>
        <td style="font-weight:bold; color:var(--primary)">${Math.floor(totalMins / 60)}h ${totalMins % 60}m</td>
        <td style="color:var(--text-muted);">$${totalBasePay.toLocaleString()}</td>
        <td>${totalAdjLabel}</td>
        <td style="font-weight:bold; color:var(--success)">$${totalFinal.toLocaleString()}</td>
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
// WHATSAPP
// =====================
document.getElementById('send-whatsapp-btn').addEventListener('click', async () => {
    const btn = document.getElementById('send-whatsapp-btn');
    const data = getResumenData(currentPeriod);

    if (data.length === 0) { showNotification('Sin datos para enviar', 'danger'); return; }

    const withPhone = employeesCache.filter(e => e.phone);
    if (withPhone.length === 0) { showNotification('Nadie tiene numero de WhatsApp', 'danger'); return; }

    if (!confirm(`¿Enviar reporte ${currentPeriod} a ${withPhone.length} persona(s) por WhatsApp?`)) return;

    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
        const sendReport = functions.httpsCallable('sendReportManual');
        const result = await sendReport({ period: currentPeriod });
        const { sent, errors } = result.data;
        showNotification(`Enviado a ${sent} persona(s)${errors > 0 ? `. ${errors} error(es)` : ''}`);
    } catch (err) {
        showNotification('Error al enviar: ' + (err.message || 'Intenta de nuevo'), 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '📲 Enviar por WhatsApp';
    }
});

// =====================
// WHATSAPP REPORTE SEMANAL (ASISTENCIA)
// =====================
let waReportData = [];

function buildWeekReportData() {
    const weekDates = getWeekDates(weekOffset);
    const weekDateStrs = weekDates.map(dateObjToStr);
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const data = getGroupedData();

    const result = [];
    employeesCache.forEach(emp => {
        if (!emp.phone) return;
        const entry = { name: emp.name, phone: emp.phone, photoURL: emp.photoURL || null, days: [], totalMins: 0 };
        const today = new Date(); today.setHours(23, 59, 59, 999);
        weekDates.forEach((dateObj, i) => {
            const key = `${emp.name.toLowerCase()}-${weekDateStrs[i]}`;
            const idx = groupedDataMap[key];
            if (idx !== undefined) {
                const mins = getMinsFromGroup(data[idx]);
                entry.totalMins += mins;
                if (mins > 0) entry.days.push({ day: dayNames[i], hours: `${Math.floor(mins/60)}h ${mins%60}m` });
            } else if (isOnVacation(emp.name, dateObj) && dateObj <= today) {
                const vacMins = getVacationMinutes(dateObj.getDay());
                if (vacMins > 0) {
                    entry.totalMins += vacMins;
                    entry.days.push({ day: dayNames[i], hours: `${Math.floor(vacMins/60)}h 🏖` });
                }
            }
        });
        if (entry.totalMins > 0) result.push(entry);
    });
    return result;
}

document.getElementById('send-week-whatsapp').addEventListener('click', () => {
    waReportData = buildWeekReportData();
    if (waReportData.length === 0) {
        showNotification('Sin datos o nadie tiene WhatsApp', 'danger');
        return;
    }

    document.getElementById('wa-modal-week').textContent = formatWeekLabel(weekOffset);
    const checklist = document.getElementById('wa-checklist');
    checklist.innerHTML = '';

    const { start: wkS, end: wkE } = getWeekRange(weekOffset);

    waReportData.forEach((emp, i) => {
        const totalH = Math.floor(emp.totalMins / 60);
        const totalM = emp.totalMins % 60;
        const basePay = Math.round((emp.totalMins / 60) * 70);
        const adjs = getWeekAdjustments(emp.name, wkS, wkE);
        const adjSum = adjs.reduce((s, a) => s + (a.type === 'bono' ? a.amount : -a.amount), 0);
        const finalPay = basePay + adjSum;
        const adjInfo = adjSum !== 0 ? ` <span style="color:${adjSum > 0 ? '#10b981' : '#ef4444'};">(${adjSum > 0 ? '+' : ''}$${adjSum})</span>` : '';

        const initials = emp.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const avatarHtml = emp.photoURL
            ? `<img src="${emp.photoURL}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; flex-shrink:0;">`
            : `<div style="width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700; flex-shrink:0; color:var(--text-muted);">${initials}</div>`;

        const label = document.createElement('label');
        label.style.cssText = 'display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:12px; cursor:pointer;';
        label.innerHTML = `
            <input type="checkbox" class="wa-check" data-idx="${i}" checked style="width:18px; height:18px; accent-color:#25D366; cursor:pointer; flex-shrink:0;">
            ${avatarHtml}
            <div style="flex:1; min-width:0;">
                <div style="font-weight:600; font-size:0.9rem;">${emp.name}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">${totalH}h ${totalM}m · $${finalPay.toLocaleString()}${adjInfo}</div>
            </div>
        `;
        checklist.appendChild(label);
    });

    document.getElementById('wa-select-all').checked = true;
    updateWaSendBtn();
    document.getElementById('wa-modal').style.display = 'flex';
});

document.getElementById('wa-modal-close').addEventListener('click', () => {
    document.getElementById('wa-modal').style.display = 'none';
});

document.getElementById('wa-modal').addEventListener('click', (e) => {
    if (e.target.id === 'wa-modal') document.getElementById('wa-modal').style.display = 'none';
});

document.getElementById('wa-select-all').addEventListener('change', (e) => {
    document.querySelectorAll('.wa-check').forEach(cb => cb.checked = e.target.checked);
    updateWaSendBtn();
});

document.getElementById('wa-checklist').addEventListener('change', () => {
    const all = document.querySelectorAll('.wa-check');
    const checked = document.querySelectorAll('.wa-check:checked');
    document.getElementById('wa-select-all').checked = all.length === checked.length;
    updateWaSendBtn();
});

function updateWaSendBtn() {
    const count = document.querySelectorAll('.wa-check:checked').length;
    const btn = document.getElementById('wa-send-btn');
    btn.textContent = count > 0 ? `Enviar a ${count} persona${count !== 1 ? 's' : ''}` : 'Selecciona al menos una persona';
    btn.disabled = count === 0;
}

document.getElementById('wa-send-btn').addEventListener('click', async () => {
    const btn = document.getElementById('wa-send-btn');
    const selected = [...document.querySelectorAll('.wa-check:checked')].map(cb => waReportData[parseInt(cb.dataset.idx)]);
    if (selected.length === 0) return;

    const weekLabel = formatWeekLabel(weekOffset);
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const { start: wkStart, end: wkEnd } = getWeekRange(weekOffset);

    let sent = 0, errors = 0;
    for (const emp of selected) {
        const totalH = Math.floor(emp.totalMins / 60);
        const totalM = emp.totalMins % 60;
        const basePay = Math.round((emp.totalMins / 60) * 70);
        const lines = emp.days.map(d => `  ${d.day}: ${d.hours}`).join('\n');

        // Ajustes
        const adjs = getWeekAdjustments(emp.name, wkStart, wkEnd);
        let adjLines = '';
        let adjTotal = 0;
        if (adjs.length > 0) {
            adjLines = '\n\n📝 *Ajustes:*\n' + adjs.map(a => {
                const sign = a.type === 'bono' ? '+' : '-';
                adjTotal += a.type === 'bono' ? a.amount : -a.amount;
                return `  ${sign}$${a.amount} ${a.concept || ''}`;
            }).join('\n');
        }
        const finalPay = basePay + adjTotal;

        const msg = `📋 *Reporte Semanal*\n${weekLabel}\n\n👤 *${emp.name}*\n\n${lines}\n\n⏱ *Total:* ${totalH}h ${totalM}m\n💰 *Pago horas:* $${basePay.toLocaleString()}${adjLines}\n\n💵 *Pago final:* $${finalPay.toLocaleString()}`;

        try {
            const resp = await fetch('/api/checador/whatsapp-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: emp.phone, name: emp.name, report: msg })
            });
            const result = await resp.json();
            if (result.ok) sent++;
            else errors++;
        } catch (e) {
            errors++;
        }
    }

    showNotification(`Enviado a ${sent} persona(s)${errors > 0 ? `. ${errors} error(es)` : ''}`);
    document.getElementById('wa-modal').style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Enviar';
});

// =====================
// BONOS / DESCUENTOS
// =====================
let adjCurrentName = '';
let adjCurrentType = 'bono';

function getWeekAdjustments(name, weekStart, weekEnd) {
    return adjustmentsCache.filter(a => {
        if (a.name.toLowerCase() !== name.toLowerCase()) return false;
        const d = a.timestamp ? new Date(a.timestamp) : null;
        return d && d >= weekStart && d <= weekEnd;
    });
}

function openAdjModal(name) {
    adjCurrentName = name;
    adjCurrentType = 'bono';
    document.getElementById('adj-modal-title').textContent = name;
    document.getElementById('adj-amount').value = '';
    document.getElementById('adj-concept').value = '';

    // Reset botones tipo
    document.querySelectorAll('.adj-type-btn').forEach(btn => {
        if (btn.dataset.type === 'bono') {
            btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
            btn.style.border = 'none';
        } else {
            btn.style.background = 'rgba(255,255,255,0.1)';
            btn.style.border = '1px solid var(--glass-border)';
        }
    });

    renderAdjExisting();
    document.getElementById('adj-modal').style.display = 'flex';
    document.getElementById('adj-amount').focus();
}

function renderAdjExisting() {
    const container = document.getElementById('adj-existing');
    const { start, end } = getWeekRange(weekOffset);
    const adjs = getWeekAdjustments(adjCurrentName, start, end);

    if (adjs.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `<div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; text-transform:uppercase; font-weight:600;">Ajustes esta semana</div>`;
    adjs.forEach(a => {
        const isBono = a.type === 'bono';
        const div = document.createElement('div');
        div.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(255,255,255,0.03); border-radius:8px; margin-bottom:4px; font-size:0.85rem;';
        div.innerHTML = `
            <div style="flex:1;">
                <span style="color:${isBono ? '#10b981' : '#ef4444'}; font-weight:700;">${isBono ? '+' : '-'}$${a.amount}</span>
                <span style="color:var(--text-muted); margin-left:8px;">${a.concept || ''}</span>
            </div>
            <button onclick="deleteAdjustment('${a._docId}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1rem; padding:2px 6px;" title="Eliminar">&times;</button>
        `;
        container.appendChild(div);
    });
}

document.querySelectorAll('.adj-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        adjCurrentType = btn.dataset.type;
        document.querySelectorAll('.adj-type-btn').forEach(b => {
            if (b.dataset.type === adjCurrentType) {
                b.style.background = adjCurrentType === 'bono' ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#ef4444,#dc2626)';
                b.style.border = 'none';
            } else {
                b.style.background = 'rgba(255,255,255,0.1)';
                b.style.border = '1px solid var(--glass-border)';
            }
        });
    });
});

document.getElementById('adj-save-btn').addEventListener('click', async () => {
    const amount = parseInt(document.getElementById('adj-amount').value);
    const concept = document.getElementById('adj-concept').value.trim();
    if (!amount || amount <= 0) { showNotification('Ingresa un monto valido', 'danger'); return; }

    const btn = document.getElementById('adj-save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    await db.collection('checador_adjustments').add({
        name: adjCurrentName,
        type: adjCurrentType,
        amount,
        concept,
        timestamp: Date.now(),
        weekOffset
    });

    showNotification(`${adjCurrentType === 'bono' ? 'Bono' : 'Descuento'} de $${amount} agregado`);
    document.getElementById('adj-amount').value = '';
    document.getElementById('adj-concept').value = '';
    btn.disabled = false;
    btn.textContent = 'Guardar';
    renderAdjExisting();
});

async function deleteAdjustment(docId) {
    await db.collection('checador_adjustments').doc(docId).delete();
    showNotification('Ajuste eliminado');
    renderAdjExisting();
}

document.getElementById('adj-modal-close').addEventListener('click', () => {
    document.getElementById('adj-modal').style.display = 'none';
});

document.getElementById('adj-modal').addEventListener('click', (e) => {
    if (e.target.id === 'adj-modal') document.getElementById('adj-modal').style.display = 'none';
});

// =====================
// VACACIONES MODAL
// =====================
let vacCurrentDocId = '';

function openVacModal(docId, name) {
    vacCurrentDocId = docId;
    const emp = employeesCache.find(e => e._docId === docId);
    document.getElementById('vac-modal-title').textContent = `🏖 Vacaciones — ${name}`;
    document.getElementById('vac-desde').value = emp && emp.vacacionesDesde ? emp.vacacionesDesde : '';
    document.getElementById('vac-hasta').value = emp && emp.vacacionesHasta ? emp.vacacionesHasta : '';
    document.getElementById('vac-remove-btn').style.display = emp && emp.vacaciones ? 'block' : 'none';
    document.getElementById('vac-modal').style.display = 'flex';
    document.getElementById('vac-desde').focus();
}

document.getElementById('vac-save-btn').addEventListener('click', async () => {
    const desde = document.getElementById('vac-desde').value;
    const hasta = document.getElementById('vac-hasta').value;
    if (!desde || !hasta) { showNotification('Selecciona ambas fechas', 'danger'); return; }
    if (hasta < desde) { showNotification('La fecha fin debe ser después del inicio', 'danger'); return; }

    const btn = document.getElementById('vac-save-btn');
    btn.disabled = true; btn.textContent = 'Guardando...';
    await db.collection('checador_employees').doc(vacCurrentDocId).update({
        vacaciones: true, vacacionesDesde: desde, vacacionesHasta: hasta
    });
    btn.disabled = false; btn.textContent = 'Guardar';
    document.getElementById('vac-modal').style.display = 'none';
    showNotification('Vacaciones guardadas 🏖');
});

document.getElementById('vac-remove-btn').addEventListener('click', async () => {
    await db.collection('checador_employees').doc(vacCurrentDocId).update({
        vacaciones: false, vacacionesDesde: '', vacacionesHasta: ''
    });
    document.getElementById('vac-modal').style.display = 'none';
    showNotification('Vacaciones removidas');
});

document.getElementById('vac-modal-close').addEventListener('click', () => {
    document.getElementById('vac-modal').style.display = 'none';
});

document.getElementById('vac-modal').addEventListener('click', (e) => {
    if (e.target.id === 'vac-modal') document.getElementById('vac-modal').style.display = 'none';
});

// =====================
// NOTIFICATION
// =====================
function showNotification(m, t = "success") {
    const el = document.getElementById('notification');
    el.textContent = m;
    el.style.background = t === "success" ? "var(--primary)" : "#ef4444";
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}
