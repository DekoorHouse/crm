(function () {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
                console.warn('SW register fallo:', err);
            });
        });
    }

    const installBtn = document.getElementById('install-pwa-btn');
    if (!installBtn) return;

    let deferredPrompt = null;

    const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
    if (isStandalone) return;

    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.classList.add('is-ready');
    });

    if (isIOS && isSafari) {
        installBtn.classList.add('is-ready');
    }

    installBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (deferredPrompt) {
            installBtn.style.pointerEvents = 'none';
            try {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    installBtn.classList.remove('is-ready');
                }
            } catch (err) {
                console.warn('Install prompt error:', err);
            } finally {
                deferredPrompt = null;
                installBtn.style.pointerEvents = '';
            }
            return;
        }
        if (isIOS && isSafari) {
            alert('Para instalar la app:\n\n1. Toca el boton Compartir.\n2. Elige "Anadir a pantalla de inicio".');
            return;
        }
        alert('Tu navegador no soporta instalacion. Abre el sitio en Chrome o Edge desde Android.');
    });

    window.addEventListener('appinstalled', () => {
        installBtn.classList.remove('is-ready');
    });
})();
