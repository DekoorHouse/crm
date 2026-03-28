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

const WA_NUMBER = '5216181333519';

// ============================================================
// NAVBAR
// ============================================================
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 10);
});

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
    if (window.scrollY > window.innerHeight * 0.5) {
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
// TESTIMONIALS (Firebase) - Inline style
// ============================================================
function loadTestimonials() {
    db.collection('referencias')
        .where('aprobado', '==', true)
        .orderBy('fecha', 'desc')
        .limit(4)
        .get()
        .then(snapshot => {
            const grid = document.getElementById('testimonialsGrid');

            if (snapshot.empty) {
                grid.innerHTML = '<p style="text-align:center;color:var(--text-light);grid-column:1/-1;">Próximamente nuevas referencias.</p>';
                return;
            }

            let html = '';
            snapshot.forEach(doc => {
                const ref = doc.data();

                const initial = ref.nombre ? ref.nombre.replace('@', '')[0].toUpperCase() : '?';
                const avatar = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#1B4D5C"/><text x="50" y="58" text-anchor="middle" font-size="40" fill="white" font-family="sans-serif">${initial}</text></svg>`)}`;

                let starsHtml = '';
                for (let s = 0; s < 5; s++) {
                    starsHtml += `<i class="fas fa-star${s < ref.rating ? '' : ' empty'}"></i>`;
                }

                // Truncate text to ~120 chars
                let text = ref.texto || '';
                if (text.length > 120) text = text.substring(0, 117) + '...';

                const name = escapeHtml(ref.nombre);
                const city = ref.ciudad ? ` — ${escapeHtml(ref.ciudad)}` : '';

                html += `
                    <div class="testimonial-inline-card">
                        <img src="${avatar}" alt="${name}" class="testimonial-avatar-lg" loading="lazy">
                        <div class="testimonial-inline-body">
                            <div class="testimonial-inline-stars">${starsHtml}</div>
                            <p class="testimonial-inline-text">${escapeHtml(text)}</p>
                            <div class="testimonial-inline-name">${name}${city}</div>
                        </div>
                    </div>
                `;
            });

            grid.innerHTML = html;
        })
        .catch(err => {
            console.error('Error cargando testimonios:', err);
            document.getElementById('testimonialsGrid').innerHTML =
                '<p style="text-align:center;color:var(--text-light);grid-column:1/-1;">No se pudieron cargar las referencias.</p>';
        });
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

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
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
