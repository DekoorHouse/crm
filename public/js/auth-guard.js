/**
 * Auth Guard - Protege páginas legacy redirigiendo a /login si no hay sesión.
 * Uso: agregar antes del script principal de la página:
 *   <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script>
 *   <script src="/js/auth-guard.js"></script>
 */
(function () {
    const firebaseConfig = {
        apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
        authDomain: "pedidos-con-gemini.firebaseapp.com",
        projectId: "pedidos-con-gemini",
        storageBucket: "pedidos-con-gemini.firebasestorage.app",
        messagingSenderId: "300825194175",
        appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
    };

    // Solo inicializar si no hay app Firebase ya creada
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    firebase.auth().onAuthStateChanged(function (user) {
        var overlay = document.getElementById('loading-overlay');
        if (!user) {
            // No hay sesión — redirigir al login
            window.location.replace('/login?redirect=' + encodeURIComponent(window.location.pathname));
            return;
        }
        // Usuario autenticado — quitar overlay de carga
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(function () { overlay.style.display = 'none'; }, 400);
        }
    });
})();
