import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

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

    // DOM
    const loadingOverlay = document.getElementById('loading-overlay');
    const seccionLogin = document.getElementById('seccionLogin');
    const seccionCobranza = document.getElementById('seccionCobranza');
    const formularioLogin = document.getElementById('formularioLogin');
    const mensajeError = document.getElementById('mensajeError');
    const usuarioLogueado = document.getElementById('usuarioLogueado');
    const instruccionesTA = document.getElementById('instruccionesIA');
    const resultadosBox = document.getElementById('resultadosBox');
    const listaPedidos = document.getElementById('listaPedidos');
    const totalPedidosSpan = document.getElementById('totalPedidos');
    const btnEnviar = document.getElementById('btnEnviarCobranza');
    const progresoBox = document.getElementById('progresoBox');
    const progressBar = document.getElementById('progressBar');
    const progresoTexto = document.getElementById('progresoTexto');
    const logCobranza = document.getElementById('logCobranza');

    let pedidosEncontrados = [];

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
            seccionCobranza.style.display = 'block';
            usuarioLogueado.textContent = user.email;
            await cargarInstrucciones();
        } else {
            seccionLogin.style.display = 'block';
            seccionCobranza.style.display = 'none';
        }
    });

    window.cerrarSesion = () => signOut(auth);

    // --- Instrucciones ---
    async function cargarInstrucciones() {
        try {
            const docSnap = await getDoc(doc(db, 'crm_settings', 'bot_cobranza'));
            if (docSnap.exists() && docSnap.data().instructions) {
                instruccionesTA.value = docSnap.data().instructions;
            }
        } catch (e) {
            console.error('Error cargando instrucciones:', e);
        }
    }

    window.guardarInstrucciones = async () => {
        try {
            await setDoc(doc(db, 'crm_settings', 'bot_cobranza'), {
                instructions: instruccionesTA.value
            }, { merge: true });
            alert('Instrucciones guardadas.');
        } catch (e) {
            console.error('Error guardando instrucciones:', e);
            alert('Error al guardar.');
        }
    };

    // --- Date pickers ---
    flatpickr('#fechaInicio', { locale: 'es', dateFormat: 'Y-m-d', defaultDate: 'today' });
    flatpickr('#fechaFin', { locale: 'es', dateFormat: 'Y-m-d', defaultDate: 'today' });

    // --- Buscar pedidos ---
    window.buscarPedidos = async () => {
        const inicio = document.getElementById('fechaInicio').value;
        const fin = document.getElementById('fechaFin').value;
        if (!inicio || !fin) { alert('Selecciona ambas fechas.'); return; }

        const startDate = new Date(inicio);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(fin);
        endDate.setHours(23, 59, 59, 999);

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/api/cobranza/buscar-pedidos?startDate=${startDate.getTime()}&endDate=${endDate.getTime()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            pedidosEncontrados = data.orders;
            renderPedidos();
        } catch (e) {
            alert('Error buscando pedidos: ' + e.message);
        }
    };

    function renderPedidos() {
        resultadosBox.style.display = 'block';
        totalPedidosSpan.textContent = pedidosEncontrados.length;
        btnEnviar.disabled = pedidosEncontrados.length === 0;

        if (pedidosEncontrados.length === 0) {
            listaPedidos.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">No se encontraron pedidos en este rango.</div>';
            return;
        }

        listaPedidos.innerHTML = pedidosEncontrados.map(p => `
            <div class="pedido-item">
                <div class="pedido-info">
                    <span class="pedido-numero">DH${p.consecutiveOrderNumber || '?'}</span>
                    <span class="pedido-producto">${p.producto || 'Sin producto'}</span>
                    <span class="pedido-fecha">${p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : ''}</span>
                </div>
                <span class="pedido-telefono">${p.telefono || 'Sin tel'}</span>
            </div>
        `).join('');
    }

    // --- Enviar cobranza ---
    window.enviarCobranza = async () => {
        if (pedidosEncontrados.length === 0) return;

        const instrucciones = instruccionesTA.value.trim();
        if (!instrucciones) { alert('Escribe las instrucciones de IA primero.'); return; }

        if (!confirm(`Se enviarán mensajes de cobranza a ${pedidosEncontrados.length} pedidos. ¿Continuar?`)) return;

        // Mostrar progreso
        progresoBox.style.display = 'block';
        btnEnviar.disabled = true;
        logCobranza.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';

        const telefonos = [...new Set(pedidosEncontrados.map(p => p.telefono).filter(Boolean))];
        const total = telefonos.length;
        let processed = 0;

        try {
            const token = await auth.currentUser.getIdToken();

            for (const telefono of telefonos) {
                const pedidosDeContacto = pedidosEncontrados.filter(p => p.telefono === telefono);
                const orderNumbers = pedidosDeContacto.map(p => `DH${p.consecutiveOrderNumber}`).join(', ');

                try {
                    const res = await fetch('/api/cobranza/enviar', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            contactId: telefono,
                            instructions: instrucciones,
                            orderNumbers: pedidosDeContacto.map(p => p.consecutiveOrderNumber)
                        })
                    });
                    const result = await res.json();

                    if (result.success) {
                        addLog(`${orderNumbers} (${telefono}): Enviado`, 'success');
                    } else if (result.skipped) {
                        addLog(`${orderNumbers} (${telefono}): ${result.reason}`, 'skip');
                    } else {
                        addLog(`${orderNumbers} (${telefono}): Error - ${result.message}`, 'error');
                    }
                } catch (err) {
                    addLog(`${orderNumbers} (${telefono}): Error de red - ${err.message}`, 'error');
                }

                processed++;
                const pct = Math.round((processed / total) * 100);
                progressBar.style.width = pct + '%';
                progressBar.textContent = pct + '%';
                progresoTexto.textContent = `${processed} / ${total} contactos procesados`;
            }

            progresoTexto.textContent = `Completado: ${processed} / ${total} contactos procesados`;
            document.querySelector('#progresoBox h2').innerHTML = '<i class="fas fa-check-circle" style="color:#16a34a;"></i> Cobranza completada';

        } catch (e) {
            alert('Error general: ' + e.message);
        }

        btnEnviar.disabled = false;
    };

    function addLog(message, type) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logCobranza.appendChild(entry);
        logCobranza.scrollTop = logCobranza.scrollHeight;
    }
});
