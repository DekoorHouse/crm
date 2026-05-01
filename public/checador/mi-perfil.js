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

let currentEmployee = null;
let logsCache = [];
let adjustmentsCache = [];
let holidaysCache = [];
let weekOffset = 0;
let unsubscribeLogs = null;
let unsubscribeAdj = null;
let unsubscribeHolidays = null;

function isoDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
}
function findHoliday(dateObj) {
    if (!holidaysCache.length) return null;
    const iso = isoDateStr(dateObj);
    return holidaysCache.find(h => h.date === iso) || null;
}
function getHolidayMinutesForDay(dayOfWeek) {
    if (dayOfWeek >= 1 && dayOfWeek <= 5) return 360;
    if (dayOfWeek === 6) return 240;
    return 0;
}
function getMinutesForHoliday(holiday, dayOfWeek) {
    if (holiday && Number.isFinite(Number(holiday.customMinutes)) && Number(holiday.customMinutes) >= 0) {
        return Math.round(Number(holiday.customMinutes));
    }
    return getHolidayMinutesForDay(dayOfWeek);
}

// =====================
// AUTH - requiere Firebase auth activo
// =====================
firebaseAuth.onAuthStateChanged(user => {
    if (!user) {
        window.location.href = '/checador/';
    }
});

// =====================
// PIN LOGIN
// =====================
document.getElementById('emp-pin-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pin-login-btn').click();
});

document.getElementById('emp-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('emp-pin-input').focus();
});

// Función compartida de login (usada por botón y auto-login)
async function loginWithPin(nameInput, pinInput, isAutoLogin) {
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';

    if (!nameInput || !pinInput) {
        if (!isAutoLogin) errorEl.textContent = 'Ingresa tu nombre y PIN.';
        return false;
    }

    const snap = await db.collection('checador_employees').get();
    const employees = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
    const match = employees.find(e => e.name.toLowerCase() === nameInput.toLowerCase());

    if (!match) {
        if (!isAutoLogin) errorEl.textContent = 'No encontrado.';
        else localStorage.removeItem('checador_session');
        return false;
    }

    if (!match.pin) {
        if (!isAutoLogin) errorEl.textContent = 'No tienes un PIN asignado. Contacta al administrador.';
        else localStorage.removeItem('checador_session');
        return false;
    }

    if (match.pin !== pinInput) {
        if (!isAutoLogin) errorEl.textContent = 'PIN incorrecto.';
        else localStorage.removeItem('checador_session');
        return false;
    }

    currentEmployee = match;
    document.getElementById('pin-login-view').style.display = 'none';
    document.getElementById('profile-content').style.display = 'block';

    const avatarEl = document.getElementById('profile-avatar');
    if (match.photoURL) {
        avatarEl.innerHTML = `<img src="${match.photoURL}" alt="${match.name}">`;
    } else {
        const initials = match.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        avatarEl.textContent = initials;
    }
    document.getElementById('profile-name').textContent = match.name;
    document.getElementById('info-name').textContent = match.name;
    document.getElementById('info-phone').textContent = match.phone || 'No registrado';
    document.getElementById('info-id').textContent = match.id || '—';

    // Vacaciones
    const vacSection = document.getElementById('vacation-section');
    if (match.vacaciones && match.vacacionesDesde && match.vacacionesHasta) {
        vacSection.style.display = 'block';
        const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
        document.getElementById('vac-desde-label').textContent = fmtDate(match.vacacionesDesde);
        document.getElementById('vac-hasta-label').textContent = fmtDate(match.vacacionesHasta);
    } else {
        vacSection.style.display = 'none';
    }

    unsubscribeLogs = db.collection('checador_logs')
        .orderBy('timestamp', 'desc')
        .onSnapshot(snap => {
            logsCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
            renderProfile();
        });

    unsubscribeAdj = db.collection('checador_adjustments')
        .onSnapshot(snap => {
            adjustmentsCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
            renderProfile();
        });

    unsubscribeHolidays = db.collection('checador_holidays')
        .onSnapshot(snap => {
            holidaysCache = snap.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
            renderProfile();
        });

    return true;
}

// Botón de login manual
document.getElementById('pin-login-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('emp-name-input').value.trim();
    const pinInput = document.getElementById('emp-pin-input').value.trim();
    loginWithPin(nameInput, pinInput, false);
});

// Limpiar sesiones cacheadas de versiones anteriores
localStorage.removeItem('checador_session');

// =====================
// LOGOUT
// =====================
document.getElementById('logout-btn').addEventListener('click', () => {
    currentEmployee = null;
    if (unsubscribeLogs) { unsubscribeLogs(); unsubscribeLogs = null; }
    if (unsubscribeAdj) { unsubscribeAdj(); unsubscribeAdj = null; }
    if (unsubscribeHolidays) { unsubscribeHolidays(); unsubscribeHolidays = null; }
    logsCache = [];
    adjustmentsCache = [];
    holidaysCache = [];
    document.getElementById('profile-content').style.display = 'none';
    document.getElementById('pin-login-view').style.display = 'flex';
    document.getElementById('emp-name-input').value = '';
    document.getElementById('emp-pin-input').value = '';
    document.getElementById('login-error').textContent = '';
});

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
    for (let i = 0; i < 6; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function dateObjToStr(d) {
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function formatWeekLabel(offset) {
    const { start, end } = getWeekRange(offset);
    const fmt = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    return `${fmt(start)} — ${fmt(end)}, ${start.getFullYear()}`;
}

document.getElementById('prev-week').addEventListener('click', () => {
    weekOffset--;
    renderProfile();
});

document.getElementById('next-week').addEventListener('click', () => {
    if (weekOffset < 0) { weekOffset++; renderProfile(); }
});

// =====================
// RENDER
// =====================
function renderProfile() {
    if (!currentEmployee) return;

    const empName = currentEmployee.name.toLowerCase();
    const weekDates = getWeekDates(weekOffset);
    const weekDateStrs = weekDates.map(dateObjToStr);
    const todayStr = dateObjToStr(new Date());

    // Actualizar navegacion
    document.getElementById('week-label').textContent = formatWeekLabel(weekOffset);
    document.getElementById('next-week').disabled = weekOffset >= 0;

    // Filtrar logs de este empleado
    const myLogs = logsCache.filter(log => {
        const logName = log.name ? log.name.toLowerCase() : '';
        const logId = log.id || '';
        return logName === empName || logId === currentEmployee.id;
    });

    let totalWeekMins = 0;
    let daysWorked = 0;
    const daysList = document.getElementById('days-list');
    daysList.innerHTML = '';

    const dayNames = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

    weekDates.forEach((dateObj, i) => {
        const dateStr = weekDateStrs[i];
        const isToday = dateStr === todayStr && weekOffset === 0;

        // Obtener logs de este dia
        const dayLogs = myLogs
            .filter(log => log.date === dateStr)
            .sort((a, b) => a.timestamp - b.timestamp);

        let dayMins = 0;
        let lastIn = null;
        const timeline = [];

        dayLogs.forEach(log => {
            if (log.type === 'IN') {
                lastIn = log.timestamp;
                timeline.push(`Entrada ${log.time}`);
            } else if (log.type === 'OUT') {
                if (lastIn) {
                    dayMins += Math.floor((log.timestamp - lastIn) / 60000);
                    lastIn = null;
                }
                timeline.push(`Salida ${log.time}`);
            }
        });
        // Si hay entrada activa sin salida
        if (lastIn) {
            dayMins += Math.floor((Date.now() - lastIn) / 60000);
            timeline.push('(activo)');
        }

        // Vacaciones: si no hay logs, checar si está de vacaciones en esa fecha
        let isVacDay = false;
        let isHolidayDay = false;
        let holidayLabel = '';
        if (dayLogs.length === 0 && currentEmployee.vacaciones && currentEmployee.vacacionesDesde && currentEmployee.vacacionesHasta) {
            const checkD = new Date(dateObj); checkD.setHours(12, 0, 0, 0);
            const desde = new Date(currentEmployee.vacacionesDesde + 'T00:00:00');
            const hasta = new Date(currentEmployee.vacacionesHasta + 'T23:59:59');
            const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
            if (checkD >= desde && checkD <= hasta && dateObj <= todayEnd) {
                const dow = dateObj.getDay();
                if (dow >= 1 && dow <= 5) { dayMins = 360; isVacDay = true; }
                else if (dow === 6) { dayMins = 240; isVacDay = true; }
            }
        }
        // Día inhábil: si no hay logs ni vacaciones, checar si la fecha es inhábil.
        // Se muestra inmediatamente, incluso para fechas futuras.
        if (dayLogs.length === 0 && !isVacDay) {
            const holiday = findHoliday(dateObj);
            if (holiday) {
                const hMins = getMinutesForHoliday(holiday, dateObj.getDay());
                if (hMins > 0) {
                    dayMins = hMins;
                    isHolidayDay = true;
                    holidayLabel = holiday.label || 'Día inhábil';
                }
            }
        }

        if (dayLogs.length > 0 || isVacDay || isHolidayDay) {
            daysWorked++;
            totalWeekMins += dayMins;
        }

        const hasData = dayLogs.length > 0 || isVacDay || isHolidayDay;
        const hoursStr = dayMins > 0 ? `${Math.floor(dayMins / 60)}h ${dayMins % 60}m` : (hasData ? '0h 0m' : '—');
        const dayPay = Math.round((dayMins / 60) * 70);
        const payStr = hasData ? `$${dayPay.toLocaleString()}` : '';

        const row = document.createElement('div');
        row.className = `day-row ${hasData ? 'has-data' : 'no-data'} ${isToday ? 'today' : ''}`;
        if (isVacDay) row.style.borderLeftColor = '#f59e0b';
        else if (isHolidayDay) row.style.borderLeftColor = '#a78bfa';
        let detail = '';
        if (isVacDay) detail = '🏖 Vacaciones';
        else if (isHolidayDay) detail = `📅 ${holidayLabel}`;
        else if (dayLogs.length > 0) detail = timeline.join(' &bull; ');
        row.innerHTML = `
            <span class="day-name">${dayNames[i]}</span>
            <span class="day-detail">${detail}</span>
            <span class="day-hours">${hoursStr}${payStr ? `<br><small style="color:var(--primary); font-weight:600;">${payStr}</small>` : ''}</span>
        `;
        daysList.appendChild(row);
    });

    // Stats
    const totalHours = Math.floor(totalWeekMins / 60);
    const totalRemainMins = totalWeekMins % 60;
    const basePay = Math.round((totalWeekMins / 60) * 70);

    // Ajustes de la semana
    const { start: wkStart, end: wkEnd } = getWeekRange(weekOffset);
    const myAdjs = adjustmentsCache.filter(a => {
        if (a.name.toLowerCase() !== empName) return false;
        const d = a.timestamp ? new Date(a.timestamp) : null;
        return d && d >= wkStart && d <= wkEnd;
    });
    const adjTotal = myAdjs.reduce((sum, a) => sum + (a.type === 'bono' ? a.amount : -a.amount), 0);
    const finalPay = basePay + adjTotal;

    document.getElementById('stat-days').textContent = daysWorked;
    document.getElementById('stat-hours').textContent = `${totalHours}h ${totalRemainMins}m`;
    document.getElementById('stat-pay').textContent = `$${finalPay.toLocaleString()}`;

    // Render ajustes
    const adjSection = document.getElementById('adj-section');
    if (myAdjs.length > 0) {
        adjSection.style.display = 'block';
        adjSection.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase; font-weight:600; margin-bottom:8px;">Ajustes esta semana</div>`;
        myAdjs.forEach(a => {
            const isBono = a.type === 'bono';
            const div = document.createElement('div');
            div.className = 'day-row has-data';
            div.style.borderLeftColor = isBono ? '#10b981' : '#ef4444';
            div.innerHTML = `
                <span style="font-weight:600; color:${isBono ? '#10b981' : '#ef4444'};">${isBono ? '+' : '-'}$${a.amount}</span>
                <span class="day-detail">${a.concept || ''}</span>
                <span class="day-hours" style="color:${isBono ? '#10b981' : '#ef4444'};">${isBono ? 'Bono' : 'Descuento'}</span>
            `;
            adjSection.appendChild(div);
        });
        if (adjTotal !== 0) {
            const sumDiv = document.createElement('div');
            sumDiv.style.cssText = 'text-align:right; font-size:0.8rem; color:var(--text-muted); margin-top:4px;';
            sumDiv.innerHTML = `Pago horas: $${basePay.toLocaleString()} ${adjTotal > 0 ? '+' : ''}${adjTotal} = <strong style="color:var(--primary);">$${finalPay.toLocaleString()}</strong>`;
            adjSection.appendChild(sumDiv);
        }
    } else {
        adjSection.style.display = 'none';
    }

    // Estado actual: revisar si hoy tiene entrada activa sin salida
    const todayLogs = myLogs
        .filter(log => log.date === todayStr)
        .sort((a, b) => a.timestamp - b.timestamp);
    let activeNow = false;
    todayLogs.forEach(log => {
        if (log.type === 'IN') activeNow = true;
        else if (log.type === 'OUT') activeNow = false;
    });
    const statusEl = document.getElementById('info-status');
    if (activeNow) {
        statusEl.innerHTML = '<span style="color:var(--success);">En oficina</span>';
    } else if (todayLogs.length > 0) {
        statusEl.innerHTML = '<span style="color:var(--warning);">Salio hoy</span>';
    } else {
        statusEl.innerHTML = '<span style="color:var(--text-muted);">Sin registro hoy</span>';
    }
}

// =====================
// NOTIFICATION
// =====================
function showNotification(m, t = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = m;
    notification.style.background = t === 'success' ? 'var(--primary)' : '#ef4444';
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), 3000);
}

// =====================
// FOTO DE PERFIL
// =====================
document.getElementById('avatar-wrapper').addEventListener('click', () => {
    if (!currentEmployee) return;
    document.getElementById('avatar-input').click();
});

document.getElementById('avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !currentEmployee) return;

    if (!file.type.startsWith('image/')) {
        showNotification('Solo se permiten imagenes', 'danger');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showNotification('La imagen no debe superar 5 MB', 'danger');
        return;
    }

    const overlay = document.getElementById('avatar-overlay');
    overlay.textContent = 'SUBIENDO...';
    overlay.classList.add('avatar-uploading');

    try {
        const formData = new FormData();
        formData.append('foto', file);
        formData.append('empId', currentEmployee.id);
        formData.append('docId', currentEmployee._docId);

        const resp = await fetch('/api/checador/avatar', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Error al subir');

        const avatarEl = document.getElementById('profile-avatar');
        avatarEl.innerHTML = `<img src="${data.url}" alt="${currentEmployee.name}">`;
        currentEmployee.photoURL = data.url;

        showNotification('Foto actualizada');
    } catch (err) {
        console.error('Error subiendo foto:', err);
        showNotification('Error al subir la foto', 'danger');
    } finally {
        overlay.textContent = 'CAMBIAR';
        overlay.classList.remove('avatar-uploading');
        e.target.value = '';
    }
});

// Focus
setTimeout(() => document.getElementById('emp-name-input').focus(), 300);
