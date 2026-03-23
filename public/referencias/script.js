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
const storage = firebase.storage();
const API_BASE_URL = window.API_BASE_URL || '';

// --- Estado ---
let selectedRating = 0;
let selectedPhoto = null;
let selectedSocial = 'facebook';

// --- Dark mode ---
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const icon = document.querySelector('.dark-toggle i');
    icon.className = document.body.classList.contains('dark-mode') ? 'fas fa-sun' : 'fas fa-moon';
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    document.querySelector('.dark-toggle i').className = 'fas fa-sun';
}

// --- Toggle formulario ---
function toggleForm() {
    const card = document.getElementById('refFormCard');
    card.classList.toggle('hidden');
    if (!card.classList.contains('hidden')) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// --- Selector de red social ---
function selectSocial(type) {
    selectedSocial = type;
    const tabFb = document.getElementById('tabFb');
    const tabIg = document.getElementById('tabIg');
    const input = document.getElementById('refProfileUrl');
    const hint = document.getElementById('profileHint');

    tabFb.className = 'social-tab' + (type === 'facebook' ? ' active-fb' : '');
    tabIg.className = 'social-tab' + (type === 'instagram' ? ' active-ig' : '');

    if (type === 'facebook') {
        input.placeholder = 'https://facebook.com/tu.perfil';
        hint.textContent = 'Pega el link de tu perfil de Facebook para verificar tu identidad';
    } else {
        input.placeholder = 'https://instagram.com/tu_usuario';
        hint.textContent = 'Pega el link de tu perfil de Instagram para verificar tu identidad';
    }
}

// --- Estrellas ---
document.getElementById('ratingStars').addEventListener('click', (e) => {
    if (e.target.tagName === 'I') {
        selectedRating = parseInt(e.target.dataset.val);
        updateStarsUI();
    }
});
document.getElementById('ratingStars').addEventListener('mouseover', (e) => {
    if (e.target.tagName === 'I') {
        highlightStars(parseInt(e.target.dataset.val));
    }
});
document.getElementById('ratingStars').addEventListener('mouseout', () => {
    updateStarsUI();
});

function updateStarsUI() {
    highlightStars(selectedRating);
}
function highlightStars(val) {
    document.querySelectorAll('#ratingStars i').forEach(star => {
        star.classList.toggle('active', parseInt(star.dataset.val) <= val);
    });
}

// --- Foto ---
function previewPhoto(input) {
    if (input.files && input.files[0]) {
        selectedPhoto = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            const area = document.getElementById('photoUploadArea');
            area.innerHTML = `
                <img src="${e.target.result}" class="preview-img" alt="Preview">
                <p style="margin-top:8px;color:var(--color-text-light);font-size:0.85rem;">Toca para cambiar</p>
                <input type="file" id="photoInput" accept="image/*" style="display:none" onchange="previewPhoto(this)">
            `;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function resetPhotoUpload() {
    const area = document.getElementById('photoUploadArea');
    area.innerHTML = `
        <i class="fas fa-camera"></i>
        <p>Toca para subir una foto</p>
        <input type="file" id="photoInput" accept="image/*" style="display:none" onchange="previewPhoto(this)">
    `;
}

// --- Subir referencia ---
async function submitReferencia(event) {
    event.preventDefault();

    const nombre = document.getElementById('refNombre').value.trim();
    const profileUrl = document.getElementById('refProfileUrl').value.trim();
    const texto = document.getElementById('refTexto').value.trim();

    if (!nombre) { alert('Escribe tu nombre.'); return; }
    if (!profileUrl) { alert('Pega el link de tu perfil.'); return; }
    if (selectedRating === 0) { alert('Selecciona una calificación de estrellas.'); return; }
    if (!texto) { alert('Escribe tu opinión.'); return; }

    // Validar que el URL sea de facebook o instagram
    const isFbUrl = profileUrl.includes('facebook.com') || profileUrl.includes('fb.com');
    const isIgUrl = profileUrl.includes('instagram.com');
    if (selectedSocial === 'facebook' && !isFbUrl) {
        alert('El link no parece ser un perfil de Facebook válido.');
        return;
    }
    if (selectedSocial === 'instagram' && !isIgUrl) {
        alert('El link no parece ser un perfil de Instagram válido.');
        return;
    }

    const btn = document.getElementById('btnSubmit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando...';

    try {
        let photoUrl = '';

        if (selectedPhoto) {
            const ext = selectedPhoto.name.split('.').pop();
            const fileName = `referencias/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
            const ref = storage.ref(fileName);
            await ref.put(selectedPhoto);
            photoUrl = await ref.getDownloadURL();
        }

        await db.collection('referencias').add({
            nombre: nombre,
            profileUrl: profileUrl,
            source: selectedSocial,
            rating: selectedRating,
            texto: texto,
            foto: photoUrl,
            fecha: firebase.firestore.FieldValue.serverTimestamp(),
            aprobado: true
        });

        // Reset
        selectedRating = 0;
        selectedPhoto = null;
        document.getElementById('refForm').reset();
        updateStarsUI();
        resetPhotoUpload();
        selectSocial('facebook');
        toggleForm();
        alert('¡Gracias por tu referencia! Ya está publicada.');

    } catch (error) {
        console.error('Error al publicar referencia:', error);
        alert('Hubo un error al publicar. Intenta de nuevo.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Publicar referencia';
    }
}

// --- Cargar referencias ---
function loadReferencias() {
    db.collection('referencias')
        .orderBy('fecha', 'desc')
        .onSnapshot(snapshot => {
            const refs = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(r => r.aprobado !== false);
            renderReferencias(refs);
            updateStats(refs);
        }, error => {
            console.error('Error cargando referencias:', error);
            document.getElementById('refLoading').innerHTML =
                '<p style="color:var(--color-danger);">Error al cargar las referencias.</p>';
        });
}

function renderReferencias(refs) {
    const grid = document.getElementById('refGrid');
    const loading = document.getElementById('refLoading');
    const empty = document.getElementById('refEmpty');

    loading.classList.add('hidden');

    if (refs.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    grid.innerHTML = refs.map(ref => {
        const fecha = ref.fecha ? ref.fecha.toDate() : new Date();
        const fechaStr = fecha.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

        const stars = Array.from({ length: 5 }, (_, i) =>
            `<i class="fas fa-star ${i < ref.rating ? '' : 'empty'}"></i>`
        ).join('');

        const initial = ref.nombre ? ref.nombre[0].toUpperCase() : '?';
        const sourceIcon = ref.source === 'facebook'
            ? '<i class="fab fa-facebook verified" style="color:#1877F2" title="Perfil de Facebook"></i>'
            : '<i class="fab fa-instagram verified" style="color:#E4405F" title="Perfil de Instagram"></i>';

        const photoHtml = ref.foto
            ? `<img src="${ref.foto}" class="ref-card-photo" alt="Foto del producto" onclick="openLightbox('${ref.foto}')" loading="lazy">`
            : '';

        const nameHtml = ref.profileUrl
            ? `<a href="${escapeHtml(ref.profileUrl)}" target="_blank" rel="noopener">${escapeHtml(ref.nombre)}</a>`
            : escapeHtml(ref.nombre);

        // Avatar: initial letter circle
        const avatarHtml = ref.avatar
            ? `<img src="${ref.avatar}" alt="${escapeHtml(ref.nombre)}" onerror="this.parentElement.innerHTML='${initial}'">`
            : initial;

        return `
            <div class="ref-card">
                <div class="ref-card-header">
                    <div class="ref-avatar">${avatarHtml}</div>
                    <div class="ref-author">
                        <div class="ref-author-name">${nameHtml} ${sourceIcon}</div>
                        <div class="ref-date">${fechaStr}</div>
                    </div>
                </div>
                <div class="ref-card-stars">${stars}</div>
                <div class="ref-card-text">${escapeHtml(ref.texto)}</div>
                ${photoHtml}
            </div>
        `;
    }).join('');
}

function updateStats(refs) {
    document.getElementById('statTotal').textContent = refs.length;
    const avg = refs.length > 0
        ? (refs.reduce((sum, r) => sum + (r.rating || 0), 0) / refs.length).toFixed(1)
        : '0';
    document.getElementById('statAvg').textContent = avg;
    document.getElementById('stat5').textContent = refs.filter(r => r.rating === 5).length;
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
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Init ---
loadReferencias();
