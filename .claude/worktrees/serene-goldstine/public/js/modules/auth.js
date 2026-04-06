// --- START: Authentication Logic ---
// Este archivo maneja el flujo de autenticación del usuario,
// incluyendo el inicio de sesión, cierre de sesión y la observación
// de cambios en el estado de autenticación.

auth.onAuthStateChanged(async user => { // Hacemos la función async para esperar el perfil
    const loadingOverlay = document.getElementById('loading-overlay');
    const loginView = document.getElementById('login-view');
    const appContainer = document.getElementById('app-container');
    const userInfoEl = document.getElementById('user-info');

    if (user) {
        // --- INICIO DE MODIFICACIÓN: Cargar perfil del usuario ---
        try {
            // Intentamos cargar el perfil extendido (roles, departamentos)
            if (window.fetchUserProfile) {
                const profile = await window.fetchUserProfile(user.email);
                if (profile) {
                    state.currentUserProfile = profile;
                    console.log("Perfil de usuario cargado:", profile);
                }
            }
        } catch (err) {
            console.error("Error cargando perfil:", err);
        }
        // --- FIN DE MODIFICACIÓN ---

        loginView.classList.add('hidden');
        loginView.classList.remove('flex');
        appContainer.classList.remove('hidden');
        appContainer.classList.add('flex');
        
        // Mostrar nombre o email
        const displayName = state.currentUserProfile?.name || user.email;
        userInfoEl.textContent = `Usuario: ${displayName}`;
        
        startApp();
    } else {
        stopApp();
        // Limpiar perfil al salir
        state.currentUserProfile = null;
        
        loginView.classList.remove('hidden');
        loginView.classList.add('flex');
        appContainer.classList.add('hidden');
        appContainer.classList.remove('flex');
        userInfoEl.textContent = '';
    }
    loadingOverlay.style.opacity = '0';
    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
});

function setupAuthEventListeners() {
    const loginForm = document.getElementById('login-form');
    const logoutButton = document.getElementById('logout-button');

    if (loginForm) {
        loginForm.addEventListener('submit', e => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const submitButton = loginForm.querySelector('button[type="submit"]');
            const loginErrorMessage = document.getElementById('login-error-message');
    
            loginErrorMessage.textContent = '';
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Ingresando...';
    
            auth.signInWithEmailAndPassword(email, password)
                .catch(error => {
                    let friendlyMessage = 'Correo o contraseña incorrectos.';
                    if (error.code === 'auth/invalid-email') {
                        friendlyMessage = 'El formato del correo es incorrecto.';
                    }
                    loginErrorMessage.textContent = friendlyMessage;
                })
                .finally(() => {
                    submitButton.disabled = false;
                    submitButton.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i> Ingresar';
                });
        });
    }

    if(logoutButton) {
        logoutButton.addEventListener('click', () => {
            auth.signOut();
        });
    }
}
