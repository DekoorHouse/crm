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
// TESTIMONIALS CAROUSEL (Firebase) - Loop infinito + fotos
// ============================================================
let tcIndex = 0;
let tcTotal = 0;
let tcAutoplay = null;

function loadTestimonials() {
    const track = document.getElementById('testimonialsTrack');
    if (!track) return;

    db.collection('referencias')
        .where('aprobado', '==', true)
        .orderBy('fecha', 'desc')
        .limit(10)
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                track.innerHTML = '<p style="text-align:center;color:var(--text-medium);padding:2rem;">Próximamente nuevas referencias.</p>';
                return;
            }

            const approved = snapshot.docs.map(doc => doc.data());

            let html = '';
            approved.forEach(ref => {
                const initial = ref.nombre ? ref.nombre.replace('@', '')[0].toUpperCase() : '?';
                const avatar = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#1B4D5C"/><text x="50" y="58" text-anchor="middle" font-size="40" fill="white" font-family="sans-serif">${initial}</text></svg>`)}`;

                let starsHtml = '';
                for (let s = 0; s < 5; s++) {
                    starsHtml += `<i class="fas fa-star${s < ref.rating ? '' : ' empty'}"></i>`;
                }

                let text = ref.texto || '';
                if (text.length > 160) text = text.substring(0, 157) + '...';

                const name = escapeHtml(ref.nombre);
                const city = ref.ciudad ? escapeHtml(ref.ciudad) : '';

                // Foto del producto (primera foto disponible)
                const fotos = ref.fotos || (ref.foto ? [ref.foto] : []);
                const photoHtml = fotos.length > 0
                    ? `<img src="${fotos[0]}" alt="Producto" class="tc-photo" loading="lazy">`
                    : '';

                html += `
                    <div class="tc-card">
                        <div class="tc-card-header">
                            <img src="${avatar}" alt="${name}" class="tc-avatar">
                            <div>
                                <div class="tc-name">${name}</div>
                                <div class="tc-meta">${city ? '<span class="tc-city"><i class="fas fa-map-marker-alt" style="font-size:0.7rem;margin-right:2px;"></i> ' + city + '</span>' : ''}</div>
                            </div>
                        </div>
                        <div class="tc-stars">${starsHtml}</div>
                        <div class="tc-text">${escapeHtml(text)}</div>
                        ${photoHtml}
                    </div>`;
            });

            track.innerHTML = html;
            tcTotal = approved.length;
            tcIndex = 0;
            updateTcArrows();
            startTcAutoplay();
        })
        .catch(err => {
            console.error('Error cargando testimonios:', err);
            track.innerHTML = '<p style="text-align:center;color:var(--text-medium);padding:2rem;">No se pudieron cargar las referencias.</p>';
        });
}

function getCardsPerView() {
    return window.innerWidth <= 768 ? 1 : 2;
}

function slideTc(dir) {
    const perView = getCardsPerView();
    const maxIndex = Math.max(0, tcTotal - perView);

    tcIndex += dir;
    // Loop: si pasa del final vuelve al inicio, si pasa del inicio va al final
    if (tcIndex > maxIndex) tcIndex = 0;
    if (tcIndex < 0) tcIndex = maxIndex;

    const track = document.getElementById('testimonialsTrack');
    const card = track.querySelector('.tc-card');
    if (!card) return;

    const gap = 20;
    const cardWidth = card.offsetWidth + gap;
    track.style.transform = `translateX(-${tcIndex * cardWidth}px)`;
    updateTcArrows();
}

function updateTcArrows() {
    // En loop no se deshabilitan las flechas
    const prevBtn = document.getElementById('tcPrev');
    const nextBtn = document.getElementById('tcNext');
    if (prevBtn) prevBtn.disabled = tcTotal <= getCardsPerView();
    if (nextBtn) nextBtn.disabled = tcTotal <= getCardsPerView();
}

function startTcAutoplay() {
    stopTcAutoplay();
    if (tcTotal <= getCardsPerView()) return;
    tcAutoplay = setInterval(() => slideTc(1), 5000);
}

function stopTcAutoplay() {
    if (tcAutoplay) { clearInterval(tcAutoplay); tcAutoplay = null; }
}

document.getElementById('tcPrev')?.addEventListener('click', () => { stopTcAutoplay(); slideTc(-1); startTcAutoplay(); });
document.getElementById('tcNext')?.addEventListener('click', () => { stopTcAutoplay(); slideTc(1); startTcAutoplay(); });
window.addEventListener('resize', () => { tcIndex = 0; slideTc(0); });

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
                const icon = L.divIcon({
                    className: '',
                    html: `<div class="delivery-pin"><div class="pin-head">${item.count}</div><div class="pin-tail"></div></div>`,
                    iconSize: [36, 46],
                    iconAnchor: [18, 46]
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
// HERO CAROUSEL
// ============================================================
function initCarousel() {
    const slides = document.querySelectorAll('.carousel-slide');
    const dots = document.querySelectorAll('.carousel-dot');
    if (slides.length === 0) return;

    let current = 0;
    let interval;

    function goTo(index) {
        slides[current].classList.remove('active');
        dots[current].classList.remove('active');
        current = index;
        slides[current].classList.add('active');
        dots[current].classList.add('active');
    }

    function next() {
        goTo((current + 1) % slides.length);
    }

    function startAutoplay() {
        interval = setInterval(next, 4000);
    }

    function stopAutoplay() {
        clearInterval(interval);
    }

    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            stopAutoplay();
            goTo(parseInt(dot.dataset.index));
            startAutoplay();
        });
    });

    startAutoplay();
}

// ============================================================
// INIT
// ============================================================
initCarousel();
loadTestimonials();
loadMapa();
