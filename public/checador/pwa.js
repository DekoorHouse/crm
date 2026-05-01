// PWA: registro de service worker y manejo de "Instalar app".
// El SW vive en /sw.js (raíz) y maneja /checador/* sin reglas especiales.
(function () {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
                console.warn('SW register falló:', err);
            });
        });
    }

    const installBtn = document.getElementById('install-pwa-btn');
    const iosHint = document.getElementById('install-ios-hint');
    let deferredPrompt = null;

    // Detecta si ya está instalada (modo standalone) → no mostrar nada.
    const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    if (isStandalone) return;

    // Android / Chrome / Edge: 'beforeinstallprompt' permite mostrar un botón propio.
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.style.display = 'block';
        if (iosHint) iosHint.style.display = 'none';
    });

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            installBtn.disabled = true;
            try {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    installBtn.style.display = 'none';
                }
            } catch (err) {
                console.warn('Install prompt error:', err);
            } finally {
                deferredPrompt = null;
                installBtn.disabled = false;
            }
        });
    }

    // iOS Safari no soporta beforeinstallprompt. Mostrar hint si es iOS.
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
    if (isIOS && isSafari && iosHint) {
        iosHint.style.display = 'block';
    }

    window.addEventListener('appinstalled', () => {
        if (installBtn) installBtn.style.display = 'none';
        if (iosHint) iosHint.style.display = 'none';
    });
})();
