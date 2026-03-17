// Configuración
const AUTHORIZED_PREFIX = "2806:267:2484"; // Prefijo más amplio (3 bloques)
const OFFICE_WIFI_NAME = "Red Dekoor House"; 
const ADMIN_PIN = "1234"; 
const REFRESH_RATE = 1000;

// Elementos del DOM
const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const networkStatusEl = document.getElementById('network-status');
const networkTextEl = document.getElementById('network-text');
const btnIn = document.getElementById('btn-in');
const btnOut = document.getElementById('btn-out');
const employeeIdInput = document.getElementById('employee-id');
const historyList = document.getElementById('history-list');
const clearMainBtn = document.querySelector('.history-title button') || document.getElementById('clear-recent');
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
let recentHidden = false; // Estado para ocultar registros recientes temporalmente

// 1. Reloj
function updateClock() {
    const now = new Date();
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    timeEl.textContent = now.toLocaleTimeString('es-MX', timeOptions);
    dateEl.textContent = now.toLocaleDateString('es-MX', dateOptions).toUpperCase();
}

// 2. Red
async function checkNetwork() {
    try {
        const response = await fetch('https://api64.ipify.org?format=json');
        const data = await response.json();
        const userIp = data.ip;

        console.log("IP detectada:", userIp);

        // Validación flexible: Comprobamos si la IP del usuario empieza con el prefijo de la oficina
        // Esto soluciona el problema de IPs dinámicas dentro de la misma red WiFi
        if (userIp.startsWith(AUTHORIZED_PREFIX)) {
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
function registerAttendance(type) {
    const inputVal = employeeIdInput.value.trim();
    if (!inputVal) { showNotification("Ingresa tu ID o Nombre", "danger"); return; }

    const employees = getEmployees();
    // Buscamos si el input coincide con un ID o con un Nombre (ignora mayúsculas)
    const employee = employees.find(e => 
        e.id === inputVal || 
        e.name.toLowerCase() === inputVal.toLowerCase()
    );

    // Si encontramos al empleado, usamos sus datos oficiales, si no, lo que se escribió
    const finalId = employee ? employee.id : inputVal;
    const displayName = employee ? employee.name : inputVal;

    // Validación de registros duplicados (NUEVO)
    const history = JSON.parse(localStorage.getItem('attendance_logs') || '[]');
    // Buscamos el último registro de ESTE empleado específico
    const lastRegistration = history.find(log => log.id === finalId);

    if (lastRegistration) {
        if (lastRegistration.type === type) {
            const typeMsg = type === 'IN' ? 'ENTRADA' : 'SALIDA';
            showNotification(`Error: Ya tienes una ${typeMsg} registrada.`, "danger");
            return;
        }
    } else if (type === 'OUT') {
        // Si no tiene registros previos, no puede marcar salida primero
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

    saveToHistory(entry);
    showNotification(`${type === 'IN' ? 'Entrada' : 'Salida'} registrada: ${displayName}`);
    employeeIdInput.value = '';
    renderHistory();
}

function getEmployees() { return JSON.parse(localStorage.getItem('attendance_employees') || '[]'); }

function saveEmployee(name, id) {
    const employees = getEmployees();
    if (employees.some(e => e.id === id)) { showNotification("ID duplicado", "danger"); return false; }
    employees.push({ name, id });
    localStorage.setItem('attendance_employees', JSON.stringify(employees));
    return true;
}

function deleteEmployee(id) {
    let employees = getEmployees();
    employees = employees.filter(e => e.id !== id);
    localStorage.setItem('attendance_employees', JSON.stringify(employees));
    renderAdminEmployees();
}

function saveToHistory(entry) {
    const history = JSON.parse(localStorage.getItem('attendance_logs') || '[]');
    history.unshift(entry);
    localStorage.setItem('attendance_logs', JSON.stringify(history));
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem('attendance_logs') || '[]');
    historyList.innerHTML = '';
    
    // Si el usuario pidió limpiar la vista, no renderizamos nada en la principal
    if (recentHidden) return;

    // Mostrar solo los últimos 5 en la pantalla principal
    history.slice(0, 5).forEach(item => {
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

// 4. Lógica de Agrupación y Cálculo (NUEVO)
function getGroupedData() {
    const logs = JSON.parse(localStorage.getItem('attendance_logs') || '[]');
    const sortedLogs = [...logs].reverse();
    
    const groups = {}; 

    sortedLogs.forEach(log => {
        // Agrupamos por Nombre y Fecha para ser más flexibles si el ID varió
        const key = `${log.name.toLowerCase()}-${log.date}`;
        if (!groups[key]) {
            groups[key] = {
                id: log.id,
                name: log.name,
                date: log.date,
                events: []
            };
        }
        groups[key].events.push(log);
    });

    return Object.values(groups).map(group => {
        let totalMinutes = 0;
        let lastInTime = null;
        let timelineText = [];

        group.events.forEach(event => {
            timelineText.push(`<span style="color:${event.type === 'IN' ? 'var(--success)' : 'var(--warning)'}">${event.type}: ${event.time}</span>`);
            
            if (event.type === 'IN') {
                lastInTime = event.timestamp;
            } else if (event.type === 'OUT' && lastInTime) {
                const diffMs = event.timestamp - lastInTime;
                totalMinutes += Math.floor(diffMs / (1000 * 60));
                lastInTime = null;
            }
        });

        const hrs = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        group.totalStr = `${hrs}h ${mins}m`;
        
        // Cálculo de Pago (NUEVO)
        const hourlyRate = 70;
        group.payment = (totalMinutes / 60) * hourlyRate;
        
        group.timeline = timelineText.join(" | ");
        return group;
    }).reverse(); // Revertir para mostrar lo más reciente arriba
}

function renderAdminLogs() {
    const data = getGroupedData();
    adminLogsBody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.name}<br><small>ID: ${row.id}</small></td>
            <td>${row.date}</td>
            <td style="font-size: 0.8rem;">${row.timeline}</td>
            <td style="font-weight:bold; color:var(--primary)">${row.totalStr}</td>
            <td style="font-weight:bold; color:var(--success)">$${row.payment.toFixed(2)}</td>
        `;
        adminLogsBody.appendChild(tr);
    });
}

function renderAdminEmployees() {
    const employees = getEmployees();
    adminEmployeesBody.innerHTML = '';
    employees.forEach(emp => {
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
    adminLogin.style.display = 'flex';
    setTimeout(() => adminPinInput.focus(), 100); // Auto-focus en el PIN
});
cancelLoginBtn.addEventListener('click', () => { 
    adminLogin.style.display = 'none'; 
    adminPinInput.value = ''; 
    employeeIdInput.focus(); // Regresar focus al ID principal
});
loginBtn.addEventListener('click', () => {
    if (adminPinInput.value === ADMIN_PIN) {
        adminLogin.style.display = 'none'; adminPanel.style.display = 'flex';
        adminPinInput.value = ''; renderAdminLogs(); renderAdminEmployees();
    } else { showNotification("PIN Incorrecto", "danger"); adminPinInput.focus(); }
});
closeAdminBtn.addEventListener('click', () => {
    adminPanel.style.display = 'none';
    employeeIdInput.focus(); // Regresar focus al ID principal
});

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        
        // Auto-focus en el nombre si seleccionan pestaña empleados
        if (btn.dataset.tab === 'tab-employees') {
            setTimeout(() => newEmpNameInput.focus(), 100);
        }
    });
});

addEmployeeBtn.addEventListener('click', () => {
    const name = newEmpNameInput.value.trim();
    const id = newEmpIdInput.value.trim();
    if (name && id && saveEmployee(name, id)) {
        newEmpNameInput.value = ''; newEmpIdInput.value = '';
        renderAdminEmployees(); showNotification("Añadido");
    }
});

// Evento para el botón LIMPIAR de la pantalla principal (solo oculta la vista)
document.addEventListener('click', (e) => {
    if (e.target && (e.target.textContent === 'LIMPIAR' || e.target.id === 'clear-recent')) {
        recentHidden = true;
        renderHistory();
        showNotification("Vista principal limpia");
    }
});

// Al checar alguien nuevo, volvemos a mostrar la lista
const originalRegister = registerAttendance;
registerAttendance = function(type) {
    recentHidden = false;
    originalRegister(type);
};

exportCsvBtn.addEventListener('click', exportToCSV);
clearLogsBtn.addEventListener('click', () => {
    if (confirm("¿Borrar todo?")) { localStorage.removeItem('attendance_logs'); renderAdminLogs(); renderHistory(); }
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
renderHistory();

// Auto-focus inicial
setTimeout(() => employeeIdInput.focus(), 500);
