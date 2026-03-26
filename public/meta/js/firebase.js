import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

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

    onAuthStateChanged(auth, user => {
        if (user) {
            loginView.style.display = 'none';
            mainContainer.style.display = 'block';
            if (!appInitialized) {
                if (onLoginSuccess) onLoginSuccess();
                appInitialized = true;
            }
        } else {
            loginView.style.display = 'flex';
            mainContainer.style.display = 'none';
            appInitialized = false;
        }
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginButton.disabled = true;
        loginError.textContent = '';
        try {
            await signInWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
        } catch (error) {
            loginError.textContent = 'Correo o contrasena incorrectos.';
        } finally {
            loginButton.disabled = false;
        }
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try { await signOut(auth); } catch (e) { console.error('Logout error:', e); }
        });
    }
}
