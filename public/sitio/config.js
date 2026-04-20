/* ============================================================
   DEKOOR - Config Module (Precios centralizados)
   ============================================================
   Expone window.DekoorConfig.prices con los precios actuales.
   Fuente de verdad: server/prices.js (consumido via /api/config/prices).
   Tiene defaults locales como fallback si falla el fetch.
   ============================================================ */

(function() {
    // Defaults (fallback si falla fetch). DEBEN coincidir con server/prices.js.
    const defaults = {
        productUnitPrice: 650,
        productOriginalPrice: 780,
        shippingJtCost: 0,
        shippingDhlCost: 160,
        currency: 'MXN',
        maxQty: 50
    };

    window.DekoorConfig = window.DekoorConfig || {};
    window.DekoorConfig.prices = Object.assign({}, defaults);

    // Format helpers
    window.DekoorConfig.fmt = function(val) {
        return '$' + Number(val).toLocaleString('en');
    };
    window.DekoorConfig.fmtMxn = function(val) {
        return '$' + Number(val).toLocaleString('en') + ' MXN';
    };

    // Aplica precios al DOM usando atributos data-price y data-price-fmt
    function applyPrices() {
        const p = window.DekoorConfig.prices;
        document.querySelectorAll('[data-price]').forEach(el => {
            const key = el.getAttribute('data-price');
            const fmt = el.getAttribute('data-price-fmt') || 'default';

            let value;
            switch (key) {
                case 'unit': value = p.productUnitPrice; break;
                case 'original': value = p.productOriginalPrice; break;
                case 'shipping-dhl': value = p.shippingDhlCost; break;
                case 'shipping-jt': value = p.shippingJtCost; break;
                case 'total-dhl': value = p.productUnitPrice + p.shippingDhlCost; break;
                default: return;
            }

            switch (fmt) {
                case 'from':     el.textContent = 'Desde $' + value; break;
                case 'plus':     el.textContent = '+$' + value + ' MXN'; break;
                case 'mxn':      el.textContent = '$' + value.toLocaleString('en') + ' MXN'; break;
                case 'with-2dec':el.textContent = '$' + value.toLocaleString('en') + '.00'; break;
                case 'raw':      el.textContent = String(value); break;
                default:         el.textContent = '$' + value.toLocaleString('en');
            }
        });
        window.dispatchEvent(new CustomEvent('dekoor:prices-updated', { detail: p }));
    }

    // Fetch from server (source of truth)
    const API = window.API_BASE_URL || '';
    fetch(API + '/api/config/prices', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (data && typeof data.productUnitPrice === 'number') {
                window.DekoorConfig.prices = Object.assign({}, defaults, data);
            }
        })
        .catch(() => { /* usa defaults */ })
        .finally(() => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', applyPrices);
            } else {
                applyPrices();
            }
        });

    // Expone applyPrices para re-aplicar en contenido dinamico
    window.DekoorConfig.applyPrices = applyPrices;
})();
