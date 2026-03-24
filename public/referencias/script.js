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
let selectedPhoto = null;

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

// --- Foto ---
function previewPhoto(input) {
    if (input.files && input.files[0]) {
        selectedPhoto = input.files[0];
        var reader = new FileReader();
        reader.onload = function(e) {
            var area = document.getElementById('photoUploadArea');
            area.innerHTML =
                '<img src="' + e.target.result + '" class="preview-img" alt="Preview">' +
                '<p style="margin-top:8px;color:var(--color-text-light);font-size:0.85rem;">Toca para cambiar</p>' +
                '<input type="file" id="photoInput" accept="image/*" style="display:none" onchange="previewPhoto(this)">';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function resetPhotoUpload() {
    document.getElementById('photoUploadArea').innerHTML =
        '<i class="fas fa-camera"></i>' +
        '<p>Toca para subir una foto</p>' +
        '<input type="file" id="photoInput" accept="image/*" style="display:none" onchange="previewPhoto(this)">';
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
        var photoUrl = '';
        if (selectedPhoto) {
            var formData = new FormData();
            formData.append('foto', selectedPhoto);
            var uploadRes = await fetch(API_BASE_URL + '/api/referencias/upload', {
                method: 'POST',
                body: formData
            });
            var uploadData = await uploadRes.json();
            if (!uploadRes.ok) throw new Error(uploadData.error || 'Error al subir foto');
            photoUrl = uploadData.url;
        }

        var docRef = await db.collection('referencias').add({
            nombre: nombre,
            ciudad: ciudad,
            rating: selectedRating,
            texto: texto,
            foto: photoUrl,
            fecha: firebase.firestore.FieldValue.serverTimestamp(),
            aprobado: false
        });

        // Guardar ID en localStorage para que el cliente vea su propia referencia
        var misRefs = JSON.parse(localStorage.getItem('misReferencias') || '[]');
        misRefs.push(docRef.id);
        localStorage.setItem('misReferencias', JSON.stringify(misRefs));

        selectedRating = 0;
        selectedPhoto = null;
        document.getElementById('refForm').reset();
        updateStarsUI();
        resetPhotoUpload();
        toggleForm();
        alert('¡Gracias por tu referencia! Será revisada y publicada pronto.');

    } catch (error) {
        console.error('Error al publicar:', error);
        alert('Error: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Publicar referencia';
    }
}

// --- Cargar referencias ---
function loadReferencias() {
    var misRefs = JSON.parse(localStorage.getItem('misReferencias') || '[]');

    db.collection('referencias')
        .orderBy('fecha', 'desc')
        .onSnapshot(function(snapshot) {
            var refs = [];
            snapshot.forEach(function(doc) {
                var data = doc.data();
                data.id = doc.id;
                // Mostrar si está aprobada O si es del propio cliente
                if (data.aprobado === true || misRefs.indexOf(doc.id) !== -1) {
                    data.esMia = misRefs.indexOf(doc.id) !== -1;
                    refs.push(data);
                }
            });
            renderReferencias(refs);
            updateStats(refs.filter(function(r) { return r.aprobado === true; }));
        }, function(error) {
            console.error('Error cargando referencias:', error);
            document.getElementById('refLoading').innerHTML =
                '<p style="color:#ff6b6b;">Error al cargar las referencias.</p>';
        });
}

function renderReferencias(refs) {
    var grid = document.getElementById('refGrid');
    var loading = document.getElementById('refLoading');
    var empty = document.getElementById('refEmpty');

    loading.classList.add('hidden');

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

        var photoHtml = ref.foto
            ? '<img src="' + ref.foto + '" class="ref-card-photo" alt="Foto del producto" onclick="openLightbox(\'' + ref.foto + '\')" loading="lazy">'
            : '';

        var nombre = escapeHtml(ref.nombre);
        var ciudadHtml = ref.ciudad ? '<span class="ref-city"><i class="fas fa-map-marker-alt"></i> ' + escapeHtml(ref.ciudad) + '</span>' : '';

        var pendingBadge = (ref.esMia && ref.aprobado !== true)
            ? '<span class="pending-badge"><i class="fas fa-clock"></i> Pendiente de aprobación</span>'
            : '';

        var initial = ref.nombre ? ref.nombre.replace('@','')[0].toUpperCase() : '?';
        var fallbackSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#FF8E41"/><text x="50" y="58" text-anchor="middle" font-size="40" fill="white" font-family="sans-serif">' + initial + '</text></svg>');

        html += '<div class="ref-card' + (ref.esMia && ref.aprobado !== true ? ' ref-card-pending' : '') + '">' +
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
            pendingBadge +
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

// --- Utilidades ---
function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Init ---
loadReferencias();
