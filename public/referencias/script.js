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

// --- Estado ---
let selectedRating = 0;
let selectedPhotos = [];
var PAGE_SIZE = 6;
var allRefs = [];
var lastDoc = null;
var loadingMore = false;
var hasMore = true;
var misRefs = JSON.parse(localStorage.getItem('misReferencias') || '[]');

// --- Menú hamburguesa ---
function toggleMenu() {
    document.getElementById('navMenu').classList.toggle('hidden');
}

// --- Toggle formulario ---
function toggleForm() {
    const card = document.getElementById('refFormCard');
    card.classList.toggle('hidden');
    if (!card.classList.contains('hidden')) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// --- Estrellas ---
document.getElementById('ratingStars').addEventListener('click', function(e) {
    if (e.target.tagName === 'I') {
        selectedRating = parseInt(e.target.dataset.val);
        updateStarsUI();
    }
});
document.getElementById('ratingStars').addEventListener('mouseover', function(e) {
    if (e.target.tagName === 'I') {
        highlightStars(parseInt(e.target.dataset.val));
    }
});
document.getElementById('ratingStars').addEventListener('mouseout', function() {
    updateStarsUI();
});

function updateStarsUI() { highlightStars(selectedRating); }
function highlightStars(val) {
    var stars = document.querySelectorAll('#ratingStars i');
    for (var i = 0; i < stars.length; i++) {
        var starVal = parseInt(stars[i].dataset.val);
        if (starVal <= val) {
            stars[i].classList.add('active');
        } else {
            stars[i].classList.remove('active');
        }
    }
}

// --- Fotos (máximo 5) ---
function addPhotos(input) {
    if (!input.files) return;
    var remaining = 5 - selectedPhotos.length;
    var files = Array.from(input.files).slice(0, remaining);
    for (var i = 0; i < files.length; i++) {
        selectedPhotos.push(files[i]);
    }
    renderPhotoPreview();
}

function removePhoto(index) {
    selectedPhotos.splice(index, 1);
    renderPhotoPreview();
}

function renderPhotoPreview() {
    var area = document.getElementById('photoUploadArea');
    if (selectedPhotos.length === 0) {
        resetPhotoUpload();
        return;
    }
    var html = '<div class="photo-preview-grid">';
    for (var i = 0; i < selectedPhotos.length; i++) {
        html += '<div class="photo-preview-item" id="photoPreview' + i + '">' +
            '<button type="button" class="photo-remove-btn" onclick="removePhoto(' + i + ')">&times;</button>' +
        '</div>';
    }
    if (selectedPhotos.length < 5) {
        html += '<div class="photo-add-btn" onclick="document.getElementById(\'photoInput\').click()">' +
            '<i class="fas fa-plus"></i>' +
        '</div>';
    }
    html += '</div>' +
        '<input type="file" id="photoInput" accept="image/*" multiple style="display:none" onchange="addPhotos(this)">' +
        '<p style="margin-top:8px;color:var(--text-gray);font-size:0.8rem;">' + selectedPhotos.length + '/5 fotos</p>';
    area.innerHTML = html;
    for (var j = 0; j < selectedPhotos.length; j++) {
        (function(idx) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var el = document.getElementById('photoPreview' + idx);
                if (el) el.style.backgroundImage = 'url(' + e.target.result + ')';
            };
            reader.readAsDataURL(selectedPhotos[idx]);
        })(j);
    }
}

function resetPhotoUpload() {
    selectedPhotos = [];
    document.getElementById('photoUploadArea').innerHTML =
        '<i class="fas fa-camera"></i>' +
        '<p>Toca para subir fotos</p>' +
        '<p style="font-size:0.8rem;color:var(--text-gray);margin-top:4px;">Máximo 5 fotos</p>' +
        '<input type="file" id="photoInput" accept="image/*" multiple style="display:none" onchange="addPhotos(this)">';
}

// --- Subir referencia ---
async function submitReferencia(event) {
    event.preventDefault();

    var nombre = document.getElementById('refNombre').value.trim();
    if (!nombre) { alert('Escribe tu nombre.'); return; }

    var ciudad = document.getElementById('refCiudad').value.trim();
    if (!ciudad) { alert('Escribe tu ciudad.'); return; }

    if (selectedRating === 0) { alert('Selecciona una calificación.'); return; }

    var texto = document.getElementById('refTexto').value.trim();
    if (!texto) { alert('Escribe tu opinión.'); return; }

    var btn = document.getElementById('btnSubmit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando...';

    try {
        var fotos = [];
        for (var p = 0; p < selectedPhotos.length; p++) {
            var formData = new FormData();
            formData.append('foto', selectedPhotos[p]);
            var uploadRes = await fetch(API_BASE_URL + '/api/referencias/upload', {
                method: 'POST',
                body: formData
            });
            var uploadData = await uploadRes.json();
            if (!uploadRes.ok) throw new Error(uploadData.error || 'Error al subir foto');
            fotos.push(uploadData.url);
        }

        var docRef = await db.collection('referencias').add({
            nombre: nombre,
            ciudad: ciudad,
            rating: selectedRating,
            texto: texto,
            foto: fotos[0] || '',
            fotos: fotos,
            fecha: firebase.firestore.FieldValue.serverTimestamp(),
            aprobado: false
        });

        misRefs.push(docRef.id);
        localStorage.setItem('misReferencias', JSON.stringify(misRefs));

        // Notificar por WhatsApp (no bloquea al usuario)
        fetch(API_BASE_URL + '/api/referencias/notificar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nombre, ciudad: ciudad, rating: selectedRating, texto: texto })
        }).catch(function() {});

        selectedRating = 0;
        selectedPhotos = [];
        document.getElementById('refForm').reset();
        updateStarsUI();
        resetPhotoUpload();
        toggleForm();
        showModal('¡Gracias por tu comentario!');

        // Recargar para mostrar la nueva referencia del cliente
        allRefs = [];
        lastDoc = null;
        hasMore = true;
        document.getElementById('refGrid').innerHTML = '';
        loadReferencias();

    } catch (error) {
        console.error('Error al publicar:', error);
        alert('Error: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Publicar referencia';
    }
}

// --- Cargar referencias con paginación ---
function loadReferencias() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;

    var loadMoreEl = document.getElementById('loadMore');
    if (loadMoreEl) loadMoreEl.classList.remove('hidden');

    var query = db.collection('referencias')
        .orderBy('fecha', 'desc');

    if (lastDoc) {
        query = query.startAfter(lastDoc);
    }

    query.limit(PAGE_SIZE).get().then(function(snapshot) {
        // Ocultar loading inicial
        document.getElementById('refLoading').classList.add('hidden');

        if (snapshot.empty && allRefs.length === 0) {
            document.getElementById('refEmpty').classList.remove('hidden');
            hasMore = false;
            loadingMore = false;
            if (loadMoreEl) loadMoreEl.classList.add('hidden');
            // Aún así cargar las propias del cliente
            loadMisRefs();
            return;
        }

        snapshot.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;
            data._doc = doc;
            // Solo agregar si es aprobada o es del propio cliente
            if (data.aprobado === true || misRefs.indexOf(doc.id) !== -1) {
                // Evitar duplicados
                if (!allRefs.some(function(r) { return r.id === data.id; })) {
                    allRefs.push(data);
                }
            }
        });

        if (snapshot.docs.length > 0) {
            lastDoc = snapshot.docs[snapshot.docs.length - 1];
        }

        if (snapshot.docs.length < PAGE_SIZE) {
            hasMore = false;
        }

        renderReferencias(allRefs);
        updateStats(allRefs.filter(function(r) { return r.aprobado === true; }));

        loadingMore = false;
        if (loadMoreEl) loadMoreEl.classList.add('hidden');

    }).catch(function(error) {
        console.error('Error cargando referencias:', error);
        document.getElementById('refLoading').innerHTML =
            '<p style="color:#ff6b6b;">Error al cargar las referencias.</p>';
        loadingMore = false;
    });
}

// Cargar referencias propias que no estén en la lista
function loadMisRefs() {
    if (misRefs.length === 0) return;
    misRefs.forEach(function(refId) {
        if (allRefs.some(function(r) { return r.id === refId; })) return;
        db.collection('referencias').doc(refId).get().then(function(doc) {
            if (doc.exists) {
                var data = doc.data();
                data.id = doc.id;
                allRefs.unshift(data);
                renderReferencias(allRefs);
            }
        });
    });
}

// --- Scroll infinito ---
window.addEventListener('scroll', function() {
    if (loadingMore || !hasMore) return;
    var scrollY = window.scrollY || window.pageYOffset;
    var windowH = window.innerHeight;
    var docH = document.documentElement.scrollHeight;
    if (scrollY + windowH >= docH - 400) {
        loadReferencias();
    }
});

function renderReferencias(refs) {
    var grid = document.getElementById('refGrid');
    var empty = document.getElementById('refEmpty');

    if (refs.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    var html = '';
    for (var i = 0; i < refs.length; i++) {
        var ref = refs[i];
        var fecha = ref.fecha ? ref.fecha.toDate() : new Date();
        var fechaStr = fecha.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

        var starsHtml = '';
        for (var s = 0; s < 5; s++) {
            starsHtml += '<i class="fas fa-star ' + (s < ref.rating ? '' : 'empty') + '"></i>';
        }

        var photoHtml = '';
        var refFotos = ref.fotos || (ref.foto ? [ref.foto] : []);
        if (refFotos.length === 1) {
            photoHtml = '<img src="' + refFotos[0] + '" class="ref-card-photo" alt="Foto del producto" onclick="openLightbox(\'' + refFotos[0] + '\')" loading="lazy">';
        } else if (refFotos.length > 1) {
            photoHtml = '<div class="ref-photos-grid ref-photos-' + Math.min(refFotos.length, 5) + '">';
            for (var f = 0; f < refFotos.length; f++) {
                photoHtml += '<img src="' + refFotos[f] + '" class="ref-grid-photo" alt="Foto" onclick="openLightbox(\'' + refFotos[f] + '\')" loading="lazy">';
            }
            photoHtml += '</div>';
        }

        var nombre = escapeHtml(ref.nombre);
        var ciudadHtml = ref.ciudad ? '<span class="ref-city"><i class="fas fa-map-marker-alt"></i> ' + escapeHtml(ref.ciudad) + '</span>' : '';

        var initial = ref.nombre ? ref.nombre.replace('@','')[0].toUpperCase() : '?';
        var fallbackSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#FF8E41"/><text x="50" y="58" text-anchor="middle" font-size="40" fill="white" font-family="sans-serif">' + initial + '</text></svg>');

        html += '<div class="ref-card">' +
            '<div class="ref-card-header">' +
                '<img src="' + fallbackSvg + '" alt="' + nombre + '" loading="lazy">' +
                '<div class="ref-author">' +
                    '<div class="ref-author-name">' + nombre + '</div>' +
                    '<div class="ref-date">' + fechaStr + (ciudadHtml ? ' &middot; ' + ciudadHtml : '') + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="ref-card-stars">' + starsHtml + '</div>' +
            '<div class="ref-card-text">' + escapeHtml(ref.texto) + '</div>' +
            photoHtml +
        '</div>';
    }
    grid.innerHTML = html;
}

function updateStats(refs) {
    document.getElementById('statTotal').textContent = refs.length;
    var total = 0;
    var five = 0;
    for (var i = 0; i < refs.length; i++) {
        total += (refs[i].rating || 0);
        if (refs[i].rating === 5) five++;
    }
    var avg = refs.length > 0 ? (total / refs.length).toFixed(1) : '0';
    document.getElementById('statAvg').textContent = avg;
    document.getElementById('stat5').textContent = five;
}

// --- Lightbox ---
function openLightbox(url) {
    document.getElementById('lightboxImg').src = url;
    document.getElementById('lightbox').classList.remove('hidden');
}
function closeLightbox() {
    document.getElementById('lightbox').classList.add('hidden');
    document.getElementById('lightboxImg').src = '';
}

// --- Modal ---
function showModal(msg) {
    document.getElementById('modalMsg').textContent = msg;
    document.getElementById('customModal').classList.remove('hidden');
}
function closeModal() {
    document.getElementById('customModal').classList.add('hidden');
}

// --- Utilidades ---
function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Mapa de entregas ---
function loadMapa() {
    var map = L.map('deliveryMap', {
        scrollWheelZoom: false,
        attributionControl: false
    }).setView([23.6345, -102.5528], 5);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 18
    }).addTo(map);

    fetch(API_BASE_URL + '/api/referencias/mapa')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (!data || !data.estados) return;

            document.getElementById('mapStats').innerHTML =
                '<div class="map-stat-pill"><strong>' + data.totalEntregas + '</strong> entregas</div>' +
                '<div class="map-stat-pill"><strong>' + data.totalEstados + '</strong> estados</div>';

            data.estados.forEach(function(item) {
                var size = Math.min(Math.max(Math.sqrt(item.count) * 8 + 20, 28), 60);
                var icon = L.divIcon({
                    className: '',
                    html: '<div class="delivery-marker" style="width:' + size + 'px;height:' + size + 'px;">' + item.count + '</div>',
                    iconSize: [size, size],
                    iconAnchor: [size / 2, size / 2]
                });

                L.marker([item.lat, item.lng], { icon: icon })
                    .addTo(map)
                    .bindPopup(
                        '<div class="popup-city">' + item.estado + '</div>' +
                        '<div class="popup-count">' + item.count + ' entrega' + (item.count > 1 ? 's' : '') + '</div>'
                    );
            });
        })
        .catch(function(err) {
            console.error('Error cargando mapa:', err);
        });
}

// --- Init ---
loadReferencias();
loadMapa();
