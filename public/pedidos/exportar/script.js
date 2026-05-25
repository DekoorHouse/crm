import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, where, orderBy, Timestamp, getDocs, limit as firestoreLimit, startAfter } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Misma config que el CRM principal (pedidos-con-gemini)
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
const db = getFirestore(app);

// --- DOM ---
const seccionLogin = document.getElementById('seccionLogin');
const seccionExport = document.getElementById('seccionExport');
const usuarioLogueado = document.getElementById('usuarioLogueado');
const formularioLogin = document.getElementById('formularioLogin');
const inputEmail = document.getElementById('email');
const inputPassword = document.getElementById('password');
const mensajeError = document.getElementById('mensajeError');
const btnCerrarSesion = document.getElementById('btnCerrarSesion');
const fechaDesdeInput = document.getElementById('fechaDesde');
const fechaHastaInput = document.getElementById('fechaHasta');
const btnDescargar = document.getElementById('btnDescargar');
const loader = document.getElementById('loader');
const loaderMsg = document.getElementById('loaderMsg');
const statusMsg = document.getElementById('statusMsg');

// --- Helpers de fecha (hora local del navegador) ---
function todayLocalYmd() {
    return formatDateLocalYmd(new Date());
}

function formatDateLocalYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseInputYmdToLocalDate(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// Defaults: 2026-03-01 a hoy
fechaDesdeInput.value = '2026-03-01';
fechaHastaInput.value = todayLocalYmd();
fechaHastaInput.max = todayLocalYmd();

// --- Auth ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        seccionLogin.style.display = 'none';
        seccionExport.style.display = 'block';
        usuarioLogueado.textContent = user.email || '';
    } else {
        seccionLogin.style.display = 'flex';
        seccionExport.style.display = 'none';
    }
});

formularioLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    mensajeError.textContent = '';
    try {
        await signInWithEmailAndPassword(auth, inputEmail.value.trim(), inputPassword.value);
    } catch (err) {
        mensajeError.textContent = 'Correo o contrasena incorrectos.';
    }
});

btnCerrarSesion.addEventListener('click', () => signOut(auth));

// --- Helpers CSV ---
function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    // Escapar si tiene coma, comillas, salto de linea o retorno
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

async function sha256Hex(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function normalizePhone(p) {
    return String(p || '').replace(/\D/g, '');
}

// Devuelve LADA (3 digitos) de un telefono normalizado.
// Acepta formatos 521XXXXXXXXXX (whatsapp), 52XXXXXXXXXX, o 10 digitos.
function getLada(cleanPhone) {
    let n = cleanPhone;
    if (n.startsWith('521') && n.length >= 13) n = n.slice(3);
    else if (n.startsWith('52') && n.length >= 12) n = n.slice(2);
    return n.slice(0, 3);
}

function metodoPagoFromPhone(cleanPhone) {
    if (!cleanPhone) return '';
    return getLada(cleanPhone) === '618'
        ? 'Pago al momento de la entrega'
        : 'despues de ver la foto de su pedido terminado';
}

async function idClienteHash(cleanPhone) {
    if (!cleanPhone) return '';
    const last4 = cleanPhone.slice(-4);
    const hash = await sha256Hex(cleanPhone);
    return `${last4}-${hash.slice(0, 6)}`;
}

function fechaPedidoYmd(createdAt) {
    if (!createdAt) return '';
    const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    return formatDateLocalYmd(d);
}

// --- Lectura paginada de pedidos (streaming) ---
const BATCH_SIZE = 500;
const pedidosRef = collection(db, 'pedidos');
const enviosRef = collection(db, 'datos_envio');

async function* iteratePedidos(startTs, endTs) {
    let cursor = null;
    while (true) {
        const constraints = [
            where('createdAt', '>=', startTs),
            where('createdAt', '<=', endTs),
            orderBy('createdAt', 'asc'),
        ];
        if (cursor) constraints.push(startAfter(cursor));
        constraints.push(firestoreLimit(BATCH_SIZE));
        const q = query(pedidosRef, ...constraints);
        const snap = await getDocs(q);
        if (snap.empty) return;
        for (const doc of snap.docs) {
            yield { _id: doc.id, ...doc.data() };
        }
        if (snap.docs.length < BATCH_SIZE) return;
        cursor = snap.docs[snap.docs.length - 1];
    }
}

// JOIN: para un lote de pedidos, regresa Map<digits-only-orderNumber, datos_envio>
async function fetchEnviosForBatch(batch) {
    const map = new Map();
    const keysDh = [...new Set(
        batch
            .map(p => p.consecutiveOrderNumber != null ? `DH${p.consecutiveOrderNumber}` : null)
            .filter(Boolean)
    )];
    if (keysDh.length === 0) return map;
    // Firestore "in" max 10 valores
    for (let i = 0; i < keysDh.length; i += 10) {
        const chunk = keysDh.slice(i, i + 10);
        const q = query(enviosRef, where('numeroPedido', 'in', chunk));
        const snap = await getDocs(q);
        snap.docs.forEach(doc => {
            const d = doc.data();
            const key = String(d.numeroPedido || '').replace(/\D/g, '');
            if (key && !map.has(key)) map.set(key, d);
        });
    }
    return map;
}

const HEADERS = [
    'id_pedido', 'fecha_pedido', 'id_cliente', 'monto_total', 'producto',
    'estatus', 'cantidad_piezas', 'estado', 'metodo_pago', 'costo_envio_real'
];

async function buildRowForPedido(p, enviosMap, hashCache) {
    const cleanPhone = normalizePhone(p.telefono);
    const consec = p.consecutiveOrderNumber != null ? String(p.consecutiveOrderNumber) : '';
    const envio = consec ? enviosMap.get(consec) : null;

    let idCliente = '';
    if (cleanPhone) {
        if (hashCache.has(cleanPhone)) {
            idCliente = hashCache.get(cleanPhone);
        } else {
            idCliente = await idClienteHash(cleanPhone);
            hashCache.set(cleanPhone, idCliente);
        }
    }

    return [
        consec ? `DH${consec}` : p._id,
        fechaPedidoYmd(p.createdAt),
        idCliente,
        p.precio != null && p.precio !== '' ? String(p.precio) : '',
        p.producto || '',
        p.estatus || '',
        p.cantidad != null && p.cantidad !== '' ? String(p.cantidad) : '',
        envio && envio.estado ? envio.estado : '',
        metodoPagoFromPhone(cleanPhone),
        '' // costo_envio_real: no hay dato en el sistema
    ];
}

async function buildCsvAndDownload(desdeYmd, hastaYmd) {
    const desdeDate = parseInputYmdToLocalDate(desdeYmd);
    const hastaDate = parseInputYmdToLocalDate(hastaYmd);
    hastaDate.setHours(23, 59, 59, 999); // inclusivo
    const startTs = Timestamp.fromDate(desdeDate);
    const endTs = Timestamp.fromDate(hastaDate);

    // Acumulamos por chunks de texto para no concatenar strings gigantes
    const chunks = ['﻿' + HEADERS.join(',') + '\r\n'];
    const hashCache = new Map();
    let totalCount = 0;
    let batch = [];

    async function flushBatch() {
        if (batch.length === 0) return;
        const enviosMap = await fetchEnviosForBatch(batch);
        const rows = await Promise.all(
            batch.map(p => buildRowForPedido(p, enviosMap, hashCache))
        );
        for (const row of rows) {
            chunks.push(row.map(csvEscape).join(',') + '\r\n');
        }
        totalCount += batch.length;
        loaderMsg.textContent = `Procesando... ${totalCount} pedido(s)`;
        batch = [];
    }

    for await (const p of iteratePedidos(startTs, endTs)) {
        batch.push(p);
        if (batch.length >= BATCH_SIZE) {
            await flushBatch();
        }
    }
    await flushBatch();

    if (totalCount === 0) {
        return 0;
    }

    // Trigger de descarga
    const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const ymdDesde = desdeYmd.replace(/-/g, '');
    const ymdHasta = hastaYmd.replace(/-/g, '');
    const fileName = `pedidos_dekoor_${ymdDesde}_a_${ymdHasta}.csv`;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);

    return totalCount;
}

// --- Handler del boton ---
btnDescargar.addEventListener('click', async () => {
    statusMsg.textContent = '';
    statusMsg.className = 'status-msg';

    const desdeYmd = fechaDesdeInput.value;
    const hastaYmd = fechaHastaInput.value;
    if (!desdeYmd || !hastaYmd) {
        statusMsg.textContent = 'Selecciona ambas fechas.';
        statusMsg.classList.add('error');
        return;
    }
    if (desdeYmd > hastaYmd) {
        statusMsg.textContent = 'La fecha "Desde" no puede ser despues de "Hasta".';
        statusMsg.classList.add('error');
        return;
    }

    btnDescargar.disabled = true;
    loaderMsg.textContent = 'Generando CSV...';
    const loaderTimer = setTimeout(() => {
        loader.style.display = 'flex';
    }, 1000);

    try {
        const total = await buildCsvAndDownload(desdeYmd, hastaYmd);
        if (total === 0) {
            statusMsg.textContent = 'No hay pedidos en ese rango.';
            statusMsg.classList.add('warning');
        } else {
            statusMsg.textContent = `Listo: ${total} pedido(s) exportado(s).`;
            statusMsg.classList.add('success');
        }
    } catch (err) {
        console.error('Error al exportar:', err);
        statusMsg.textContent = `Error: ${err.message || err}`;
        statusMsg.classList.add('error');
    } finally {
        clearTimeout(loaderTimer);
        loader.style.display = 'none';
        btnDescargar.disabled = false;
    }
});
