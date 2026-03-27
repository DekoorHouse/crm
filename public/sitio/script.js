/* ============================================================
   DEKOOR - Sitio Web Principal - Script
   ============================================================ */

// --- Firebase Init ---
const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const API_BASE_URL = window.API_BASE_URL || '';

// --- WhatsApp number ---
const WA_NUMBER = '5216181333519';

// ============================================================
// PRODUCTS DATA
// ============================================================
const products = [
    {
        name: "Cuadro con Foto",
        desc: "Grabado láser sobre MDF con tu foto favorita",
        price: "Desde $399",
        icon: "fas fa-image",
        categories: ["ella", "el", "parejas", "familia"]
    },
    {
        name: "Letrero Personalizado",
        desc: "Letrero decorativo con nombre o frase especial",
        price: "Desde $299",
        icon: "fas fa-font",
        categories: ["ella", "familia"]
    },
    {
        name: "Llavero Grabado",
        desc: "Llavero en MDF o acrílico con diseño personalizado",
        price: "Desde $99",
        icon: "fas fa-key",
        categories: ["ella", "el", "parejas"]
    },
    {
        name: "Portarretrato Láser",
        desc: "Marco con grabado especial para tu mejor recuerdo",
        price: "Desde $349",
        icon: "fas fa-border-all",
        categories: ["ella", "parejas", "familia"]
    },
    {
        name: "Trofeo de Acrílico",
        desc: "Reconocimiento profesional con grabado de precisión",
        price: "Desde $499",
        icon: "fas fa-trophy",
        categories: ["corporativo", "el"]
    },
    {
        name: "Caja Personalizada",
        desc: "Caja de madera grabada, perfecta para regalo sorpresa",
        price: "Desde $449",
        icon: "fas fa-box-open",
        categories: ["ella", "el", "parejas"]
    },
    {
        name: "Placa Corporativa",
        desc: "Placa con logo de empresa en madera o acrílico",
        price: "Desde $599",
        icon: "fas fa-building",
        categories: ["corporativo"]
    },
    {
        name: "Set de Posavasos",
        desc: "Juego de posavasos grabados con diseños únicos",
        price: "Desde $249",
        icon: "fas fa-coaster",
        categories: ["familia", "parejas"]
    },
    {
        name: "Lámpara Acrílica LED",
        desc: "Lámpara con grabado 3D y base con luz LED",
        price: "Desde $549",
        icon: "fas fa-lightbulb",
        categories: ["ella", "el", "parejas"]
    }
];

// ============================================================
// NAVBAR
// ============================================================
const navbar = document.getElementById('navbar');
const hero = document.getElementById('inicio');

const navObserver = new IntersectionObserver(
    ([entry]) => {
        navbar.classList.toggle('scrolled', !entry.isIntersecting);
    },
    { threshold: 0.1 }
);
navObserver.observe(hero);

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            closeMobileMenu();
        }
    });
});

// ============================================================
// MOBILE MENU
// ============================================================
const mobileMenu = document.getElementById('mobileMenu');
const hamburgerBtn = document.getElementById('hamburgerBtn');

hamburgerBtn.addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
});

mobileMenu.querySelector('.mobile-menu-overlay').addEventListener('click', closeMobileMenu);
mobileMenu.querySelector('.mobile-menu-close').addEventListener('click', closeMobileMenu);

mobileMenu.querySelectorAll('.mobile-link').forEach(link => {
    link.addEventListener('click', () => closeMobileMenu());
});

function closeMobileMenu() {
    mobileMenu.classList.add('hidden');
}

// ============================================================
// PRODUCTS
// ============================================================
const productGrid = document.getElementById('productGrid');
const productFilters = document.getElementById('productFilters');
let currentFilter = 'todos';

function renderProducts(filter) {
    const filtered = filter === 'todos'
        ? products
        : products.filter(p => p.categories.includes(filter));

    productGrid.innerHTML = filtered.map(p => {
        const waMsg = encodeURIComponent(`Hola Dekoor, me interesa el producto: ${p.name}`);
        return `
            <div class="product-card">
                <div class="product-image">
                    <i class="${p.icon}"></i>
                </div>
                <div class="product-info">
                    <div class="product-name">${p.name}</div>
                    <div class="product-desc">${p.desc}</div>
                    <div class="product-bottom">
                        <span class="product-price">${p.price}</span>
                        <a href="https://wa.me/${WA_NUMBER}?text=${waMsg}" target="_blank" rel="noopener" class="product-btn">
                            <i class="fab fa-whatsapp"></i> Pedir
                        </a>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

productFilters.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    productFilters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentFilter = btn.dataset.filter;
    renderProducts(currentFilter);
});

renderProducts('todos');

// ============================================================
// FAQ ACCORDION
// ============================================================
document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const answer = item.querySelector('.faq-answer');
        const isActive = item.classList.contains('active');

        // Close all
        document.querySelectorAll('.faq-item.active').forEach(activeItem => {
            activeItem.classList.remove('active');
            activeItem.querySelector('.faq-answer').style.maxHeight = '0';
        });

        // Open clicked if it wasn't active
        if (!isActive) {
            item.classList.add('active');
            answer.style.maxHeight = answer.scrollHeight + 'px';
        }
    });
});

// ============================================================
// SCROLL ANIMATIONS
// ============================================================
const fadeSections = document.querySelectorAll('.fade-section');

const fadeObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                fadeObserver.unobserve(entry.target);
            }
        });
    },
    { threshold: 0.1 }
);

fadeSections.forEach(section => fadeObserver.observe(section));

// ============================================================
// SCROLL TO TOP
// ============================================================
const scrollTopBtn = document.getElementById('scrollTopBtn');

window.addEventListener('scroll', () => {
    if (window.scrollY > window.innerHeight) {
        scrollTopBtn.classList.remove('hidden');
    } else {
        scrollTopBtn.classList.add('hidden');
    }
});

scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ============================================================
// LIGHTBOX
// ============================================================
function openLightbox(url) {
    document.getElementById('lightboxImg').src = url;
    document.getElementById('lightbox').classList.remove('hidden');
}

function closeLightbox() {
    document.getElementById('lightbox').classList.add('hidden');
    document.getElementById('lightboxImg').src = '';
}

// ============================================================
// TESTIMONIALS (Firebase)
// ============================================================
function loadTestimonials() {
    db.collection('referencias')
        .where('aprobado', '==', true)
        .orderBy('fecha', 'desc')
        .limit(3)
        .get()
        .then(snapshot => {
            const grid = document.getElementById('testimonialsGrid');

            if (snapshot.empty) {
                grid.innerHTML = '<p style="text-align:center;color:var(--text-gray);grid-column:1/-1;">Próximamente nuevas referencias.</p>';
                return;
            }

            let html = '';
            snapshot.forEach(doc => {
                const ref = doc.data();
                const fecha = ref.fecha ? ref.fecha.toDate() : new Date();
                const fechaStr = fecha.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

                let starsHtml = '';
                for (let s = 0; s < 5; s++) {
                    starsHtml += `<i class="fas fa-star ${s < ref.rating ? '' : 'empty'}"></i>`;
                }

                const initial = ref.nombre ? ref.nombre.replace('@', '')[0].toUpperCase() : '?';
                const avatar = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#FF8E41"/><text x="50" y="58" text-anchor="middle" font-size="40" fill="white" font-family="sans-serif">${initial}</text></svg>`)}`;

                const ciudadHtml = ref.ciudad
                    ? `<span class="testimonial-city"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(ref.ciudad)}</span>`
                    : '';

                html += `
                    <div class="testimonial-card">
                        <div class="testimonial-header">
                            <img src="${avatar}" alt="${escapeHtml(ref.nombre)}" class="testimonial-avatar" loading="lazy">
                            <div>
                                <div class="testimonial-author-name">${escapeHtml(ref.nombre)}</div>
                                <div class="testimonial-date">${fechaStr} ${ciudadHtml ? '&middot; ' + ciudadHtml : ''}</div>
                            </div>
                        </div>
                        <div class="testimonial-stars">${starsHtml}</div>
                        <div class="testimonial-text">${escapeHtml(ref.texto)}</div>
                    </div>
                `;
            });

            grid.innerHTML = html;
        })
        .catch(err => {
            console.error('Error cargando testimonios:', err);
            document.getElementById('testimonialsGrid').innerHTML =
                '<p style="text-align:center;color:var(--text-gray);grid-column:1/-1;">No se pudieron cargar las referencias.</p>';
        });

    // Load stats
    db.collection('referencias')
        .where('aprobado', '==', true)
        .get()
        .then(snapshot => {
            let total = 0;
            let sumRating = 0;
            let five = 0;

            snapshot.forEach(doc => {
                const data = doc.data();
                total++;
                sumRating += (data.rating || 0);
                if (data.rating === 5) five++;
            });

            const avg = total > 0 ? (sumRating / total).toFixed(1) : '0';
            animateCounter('tStatTotal', total);
            animateCounter('tStatAvg', parseFloat(avg), 1);
            animateCounter('tStat5', five);
        })
        .catch(err => console.error('Error cargando stats:', err));
}

// ============================================================
// MAP (Leaflet)
// ============================================================
function loadMapa() {
    const mapEl = document.getElementById('deliveryMap');
    if (!mapEl) return;

    const map = L.map('deliveryMap', {
        scrollWheelZoom: false,
        attributionControl: false
    }).setView([23.6345, -102.5528], 5);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 18
    }).addTo(map);

    fetch(API_BASE_URL + '/api/referencias/mapa')
        .then(res => res.json())
        .then(data => {
            if (!data || !data.estados) return;

            document.getElementById('mapStats').innerHTML =
                `<div class="map-stat-pill"><strong>${data.totalEntregas}</strong> entregas</div>` +
                `<div class="map-stat-pill"><strong>${data.totalEstados}</strong> estados</div>`;

            data.estados.forEach(item => {
                const size = Math.min(Math.max(Math.sqrt(item.count) * 8 + 20, 28), 60);
                const icon = L.divIcon({
                    className: '',
                    html: `<div class="delivery-marker" style="width:${size}px;height:${size}px;">${item.count}</div>`,
                    iconSize: [size, size],
                    iconAnchor: [size / 2, size / 2]
                });

                L.marker([item.lat, item.lng], { icon })
                    .addTo(map)
                    .bindPopup(
                        `<div class="popup-city">${item.estado}</div>` +
                        `<div class="popup-count">${item.count} entrega${item.count > 1 ? 's' : ''}</div>`
                    );
            });
        })
        .catch(err => console.error('Error cargando mapa:', err));
}

// ============================================================
// COUNTER ANIMATION
// ============================================================
function animateCounter(elementId, target, decimals = 0) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const duration = 1500;
    const start = performance.now();

    function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        const current = eased * target;

        el.textContent = decimals > 0 ? current.toFixed(decimals) : Math.round(current);

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================
// INIT
// ============================================================
loadTestimonials();
loadMapa();
