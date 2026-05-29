/**
 * Bootstrap PWA para el sistema de comunicación masiva (Dekoor Retargeting).
 * - Registra el service worker con scope raíz.
 * - Muestra un botón flotante "Instalar app" cuando el navegador lo permite.
 * Incluir en: /audiencias/, /cobranza/, /retargeting/, /retargeting/nuevos/
 */
(function () {
    // --- Inyectar logo de marca (masthead + login) ---
    function initBrand() {
        const LOGO = '/favicon.png';
        // Logo en el encabezado de cada página
        document.querySelectorAll('.titulo-container h1').forEach((h1) => {
            if (h1.querySelector('.brand-logo')) return;
            const img = document.createElement('img');
            img.src = LOGO;
            img.alt = 'Dekoor';
            img.className = 'brand-logo';
            h1.insertBefore(img, h1.firstChild);
        });
        // Logo en la pantalla de login
        const lc = document.querySelector('.login-container');
        if (lc && !lc.querySelector('.login-brand-logo')) {
            const img = document.createElement('img');
            img.src = LOGO;
            img.alt = 'Dekoor';
            img.className = 'login-brand-logo';
            lc.insertBefore(img, lc.firstChild);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBrand);
    } else {
        initBrand();
    }

    // Registrar service worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/comunicacion-sw.js', { scope: '/' })
                .catch((err) => console.warn('[retargeting-pwa] SW no registrado:', err));
        });
    }

    // --- Botón flotante de instalación ---
    let deferredPrompt = null;

    function crearBoton() {
        if (document.getElementById('pwa-install-btn')) return document.getElementById('pwa-install-btn');
        const btn = document.createElement('button');
        btn.id = 'pwa-install-btn';
        btn.type = 'button';
        btn.innerHTML = '<i class="fas fa-download"></i> Instalar app';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '9998',
            padding: '12px 18px',
            background: '#16a34a',
            color: '#fff',
            border: 'none',
            borderRadius: '999px',
            fontSize: '14px',
            fontWeight: '700',
            fontFamily: 'inherit',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(22,163,74,0.4)',
            display: 'none',
            alignItems: 'center',
            gap: '8px'
        });
        btn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            btn.style.display = 'none';
            console.log('[retargeting-pwa] instalación:', outcome);
        });
        document.body.appendChild(btn);
        return btn;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const btn = crearBoton();
        btn.style.display = 'inline-flex';
    });

    // Ocultar el botón si ya se instaló
    window.addEventListener('appinstalled', () => {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'none';
        deferredPrompt = null;
    });
})();
