import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Configuración de Firebase para el proyecto.
const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
    measurementId: "G-FTCDCMZB1S"
};

// Inicialización de la aplicación de Firebase.
const firebaseApp = initializeApp(firebaseConfig);

// Exportar instancias para que otros módulos las usen
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);

/**
 * Maneja el flujo de autenticación de la aplicación.
 * @param {Function} onLoginSuccess - Callback que se ejecuta cuando el usuario inicia sesión correctamente.
 */
export function initFirebase(onLoginSuccess) {
    const loginView = document.getElementById('login-view');
    const mainContainer = document.querySelector('.container');
    const loginForm = document.getElementById('login-form');
    const loginEmail = document.getElementById('login-email');
    const loginPassword = document.getElementById('login-password');
    const loginButton = document.getElementById('login-button');
    const loginError = document.getElementById('login-error-message');
    const logoutBtn = document.getElementById('logout-btn');

    let appInitialized = false;

    // Listener de estado de autenticación
    onAuthStateChanged(auth, user => {
        if (user) {
            loginView.style.display = 'none';
            mainContainer.style.display = 'block';
            // Ejecutar la lógica principal de la app solo una vez
            if (!appInitialized) {
                if (onLoginSuccess) onLoginSuccess();
                appInitialized = true;
            }
        } else {
            loginView.style.display = 'flex';
            mainContainer.style.display = 'none';
            appInitialized = false; // Resetear para la próxima sesión
        }
    });

    // Listener para el formulario de login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginButton.disabled = true;
        loginError.textContent = '';

        try {
            await signInWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
            // onAuthStateChanged se encargará del resto
        } catch (error) {
            console.error("Error de inicio de sesión:", error.code, error.message);
            loginError.textContent = 'Correo o contraseña incorrectos.';
        } finally {
            loginButton.disabled = false;
        }
    });

    // Listener para el botón de logout
    if(logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
            } catch (error) {
                console.error("Error al cerrar sesión:", error);
            }
        });
    }
}
