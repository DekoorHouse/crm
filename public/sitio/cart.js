/* ============================================================
   DEKOOR - Cart Module (localStorage)
   ============================================================ */

const DekoorCart = {
    KEY: 'dekoor_cart',

    get() {
        try {
            return JSON.parse(localStorage.getItem(this.KEY)) || [];
        } catch { return []; }
    },

    save(cart) {
        localStorage.setItem(this.KEY, JSON.stringify(cart));
        this.updateBadge();
    },

    add(item) {
        const cart = this.get();
        // Check if same product image already in cart
        const existing = cart.find(i => i.img === item.img);
        if (existing) {
            existing.qty += 1;
        } else {
            cart.push({
                id: Date.now().toString(36),
                name: item.name,
                collection: item.collection,
                collectionId: item.collectionId,
                price: item.price,
                originalPrice: item.originalPrice,
                img: item.img,
                qty: 1
            });
        }
        this.save(cart);
        return cart;
    },

    remove(id) {
        const cart = this.get().filter(i => i.id !== id);
        this.save(cart);
        return cart;
    },

    updateQty(id, qty) {
        const cart = this.get();
        const item = cart.find(i => i.id === id);
        if (item) {
            item.qty = Math.max(1, qty);
        }
        this.save(cart);
        return cart;
    },

    clear() {
        localStorage.removeItem(this.KEY);
        this.updateBadge();
    },

    count() {
        return this.get().reduce((sum, i) => sum + i.qty, 0);
    },

    subtotal() {
        return this.get().reduce((sum, i) => sum + (i.price * i.qty), 0);
    },

    updateBadge() {
        const badge = document.getElementById('cartBadge');
        if (!badge) return;
        const count = this.count();
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    },

    // Toast notification
    toast(message) {
        let t = document.getElementById('cartToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'cartToast';
            t.style.cssText = 'position:fixed;bottom:100px;right:24px;background:#1B4D5C;color:#fff;padding:12px 20px;border-radius:12px;font-size:0.9rem;font-weight:600;z-index:9999;opacity:0;transform:translateY(10px);transition:all 0.3s ease;pointer-events:none;font-family:Outfit,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
            document.body.appendChild(t);
        }
        t.innerHTML = '<i class="fas fa-check-circle" style="margin-right:8px;color:#10b981;"></i>' + message;
        t.style.opacity = '1';
        t.style.transform = 'translateY(0)';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => {
            t.style.opacity = '0';
            t.style.transform = 'translateY(10px)';
        }, 2500);
    }
};

// Init badge on page load
document.addEventListener('DOMContentLoaded', () => DekoorCart.updateBadge());
