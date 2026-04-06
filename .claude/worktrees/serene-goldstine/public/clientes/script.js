import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

    // --- DOM Elements ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const seccionLogin = document.getElementById('seccionLogin');
    const seccionClientes = document.getElementById('seccionClientes');
    const usuarioLogueado = document.getElementById('usuarioLogueado');
    const formularioLogin = document.getElementById('formularioLogin');
    const inputEmail = document.getElementById('email');
    const inputPassword = document.getElementById('password');
    const mensajeErrorLogin = document.getElementById('mensajeError');
    const cuerpoTablaClientes = document.getElementById('cuerpoTablaClientes');
    const btnCerrarSesion = document.getElementById('btnCerrarSesion');
    const contadorClientes = document.getElementById('contadorClientes');
    
    // Filter elements
    const filtroNombreInput = document.getElementById('filtroNombre');
    const filtroEstatusSelect = document.getElementById('filtroEstatus');
    const btnBorrarFiltros = document.getElementById('btnBorrarFiltros');
    
    // Dark Mode Toggle elements
    const darkModeToggle = document.getElementById('darkModeToggle');

    let allContacts = [];
    let allTags = [];
    let unsubscribeContacts = null;
    let unsubscribeTags = null;

    function applySavedTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            if (darkModeToggle) darkModeToggle.innerHTML = '<i class="fas fa-sun"></i> Modo Claro';
        } else {
            document.body.classList.remove('dark-mode');
            if (darkModeToggle) darkModeToggle.innerHTML = '<i class="fas fa-moon"></i> Modo Oscuro';
        }
    }
    
    function formatFirebaseTimestamp(timestamp) {
         if (!timestamp || typeof timestamp.toDate !== 'function') return 'Fecha inválida';
         try {
             return timestamp.toDate().toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
         } catch (e) { return 'Fecha inválida'; }
    }

    function renderClientes() {
        const nombreFilter = filtroNombreInput.value.toLowerCase();
        const estatusFilter = filtroEstatusSelect.value;

        const filteredContacts = allContacts.filter(contact => {
            const nameMatch = contact.name?.toLowerCase().includes(nombreFilter) || contact.id.includes(nombreFilter);
            const statusMatch = !estatusFilter || contact.status === estatusFilter;
            return nameMatch && statusMatch;
        });
        
        contadorClientes.textContent = filteredContacts.length;
        cuerpoTablaClientes.innerHTML = '';

        if (filteredContacts.length === 0) {
            cuerpoTablaClientes.innerHTML = `<tr><td colspan="5" class="empty-cell">No se encontraron clientes que coincidan con los filtros.</td></tr>`;
            return;
        }

        filteredContacts.forEach(contact => {
            const tr = document.createElement('tr');
            
            const tag = allTags.find(t => t.key === contact.status);
            const statusHtml = tag
                ? `<span class="status-display" style="background-color: ${tag.color}30; color: ${tag.color}; border: 1px solid ${tag.color}80;">${tag.label}</span>`
                : `<span class="status-display status-sin-estatus">Sin Estatus</span>`;

            tr.innerHTML = `
                <td>${contact.name || 'Desconocido'}</td>
                <td>${contact.id}</td>
                <td class="comment-cell" title="${contact.lastMessage || ''}">${contact.lastMessage || '-'}</td>
                <td>${statusHtml}</td>
                <td>
                    <a href="/index.html?contact=${contact.id}" class="action-button edit-button" title="Abrir Chat">
                        <i class="fas fa-comments"></i>
                    </a>
                </td>
            `;
            cuerpoTablaClientes.appendChild(tr);
        });
    }

    function listenForContacts() {
        if (unsubscribeContacts) unsubscribeContacts();
        const q = query(collection(db, "contacts_whatsapp"), orderBy("lastMessageTimestamp", "desc"));
        unsubscribeContacts = onSnapshot(q, (snapshot) => {
            allContacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderClientes();
        }, (error) => {
            console.error("Error al obtener clientes:", error);
            cuerpoTablaClientes.innerHTML = `<tr><td colspan="5" class="empty-cell" style="color: #d9534f;">Hubo un error al cargar los clientes.</td></tr>`;
        });
    }

    function listenForTagsAndPopulateFilter() {
        if(unsubscribeTags) unsubscribeTags();
        const q = query(collection(db, "crm_tags"), orderBy("order"));
        unsubscribeTags = onSnapshot(q, (snapshot) => {
            allTags = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const currentValue = filtroEstatusSelect.value;
            filtroEstatusSelect.innerHTML = '<option value="">Todos los estatus</option>';
            allTags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag.key;
                option.textContent = tag.label;
                filtroEstatusSelect.appendChild(option);
            });
            filtroEstatusSelect.value = currentValue;
            renderClientes(); // Re-render to apply correct tag colors
        });
    }

    // --- Auth & Initial Load ---
    applySavedTheme();

    onAuthStateChanged(auth, (user) => {
        if (user) {
            seccionClientes.style.display = 'block';
            seccionLogin.style.display = 'none';
            const name = user.email.split('@')[0];
            usuarioLogueado.textContent = `¡Hola, ${name.charAt(0).toUpperCase() + name.slice(1)}! 👋`;
            listenForContacts();
            listenForTagsAndPopulateFilter();
        } else {
            seccionClientes.style.display = 'none';
            seccionLogin.style.display = 'flex';
            if (unsubscribeContacts) unsubscribeContacts();
            if (unsubscribeTags) unsubscribeTags();
        }
        loadingOverlay.style.opacity = '0';
        setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
    });

    if (formularioLogin) {
         formularioLogin.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = inputEmail.value;
            const password = inputPassword.value;
            mensajeErrorLogin.textContent = '';
            const loginButton = formularioLogin.querySelector('button[type="submit"]');
            loginButton.disabled = true;
            loginButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ingresando...';
            signInWithEmailAndPassword(auth, email, password)
              .catch(() => {
                mensajeErrorLogin.textContent = 'El correo o la contraseña no coinciden.';
              })
              .finally(() => {
                 loginButton.disabled = false; 
                 loginButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Ingresar';
              });
        });
    }

    if (btnCerrarSesion) {
        btnCerrarSesion.addEventListener('click', () => signOut(auth));
    }

    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            darkModeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i> Modo Claro' : '<i class="fas fa-moon"></i> Modo Oscuro';
        });
    }
    
    // Filter listeners
    filtroNombreInput.addEventListener('input', renderClientes);
    filtroEstatusSelect.addEventListener('change', renderClientes);
    btnBorrarFiltros.addEventListener('click', () => {
        filtroNombreInput.value = '';
        filtroEstatusSelect.value = '';
        renderClientes();
    });
});
