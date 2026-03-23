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
const auth = firebase.auth();
const API_BASE_URL = window.API_BASE_URL || '';

// --- Estado ---
let socialUser = null; // { name, avatar, profileUrl, source: 'facebook'|'instagram' }
let selectedRating = 0;
let selectedPhoto = null; // File object

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

// --- Login con Facebook ---
function loginWithFacebook() {
    const provider = new firebase.auth.FacebookAuthProvider();
    provider.addScope('public_profile');

    auth.signInWithPopup(provider)
        .then(result => {
            const profile = result.additionalUserInfo.profile;
            socialUser = {
                name: profile.name || result.user.displayName,
                avatar: result.user.photoURL || `https://graph.facebook.com/${profile.id}/picture?type=large`,
                profileUrl: profile.link || `https://facebook.com/${profile.id}`,
                source: 'facebook',
                uid: result.user.uid
            };
            showLoggedUser();
        })
        .catch(err => {
            console.error('Error Facebook login:', err);
            if (err.code === 'auth/account-exists-with-different-credential') {
                alert('Ya tienes una cuenta con ese correo usando otro método. Intenta con la otra red social.');
            } else if (err.code !== 'auth/popup-closed-by-user') {
                alert('No se pudo iniciar sesión con Facebook. Intenta de nuevo.');
            }
        });
}

// --- Login con Instagram (via Facebook provider, ya que IG usa Facebook Login) ---
function loginWithInstagram() {
    // Instagram usa Facebook Login como backend
    // Abrimos Facebook pero indicamos source como instagram para el perfil
    const provider = new firebase.auth.FacebookAuthProvider();
    provider.addScope('public_profile');

    auth.signInWithPopup(provider)
        .then(result => {
            const profile = result.additionalUserInfo.profile;
            socialUser = {
                name: profile.name || result.user.displayName,
                avatar: result.user.photoURL || `https://graph.facebook.com/${profile.id}/picture?type=large`,
                profileUrl: profile.link || `https://facebook.com/${profile.id}`,
                source: 'instagram',
                uid: result.user.uid
            };
            showLoggedUser();
        })
        .catch(err => {
            console.error('Error Instagram login:', err);
            if (err.code !== 'auth/popup-closed-by-user') {
                alert('No se pudo iniciar sesión. Intenta de nuevo.');
            }
        });
}

function showLoggedUser() {
    document.getElementById('socialLoginSection').classList.add('hidden');
    document.getElementById('loggedUserBar').classList.remove('hidden');
    document.getElementById('refForm').classList.remove('hidden');

    document.getElementById('loggedAvatar').src = socialUser.avatar;
    document.getElementById('loggedName').textContent = socialUser.name;
    document.getElementById('loggedSource').innerHTML = socialUser.source === 'facebook'
        ? '<i class="fab fa-facebook" style="color:#1877F2"></i> Facebook'
        : '<i class="fab fa-instagram" style="color:#E4405F"></i> Instagram';
}

function logoutSocial() {
    auth.signOut();
    socialUser = null;
    selectedRating = 0;
    selectedPhoto = null;
    document.getElementById('socialLoginSection').classList.remove('hidden');
    document.getElementById('loggedUserBar').classList.add('hidden');
    document.getElementById('refForm').classList.add('hidden');
    document.getElementById('refForm').reset();
    updateStarsUI();
    resetPhotoUpload();
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
        const hoverVal = parseInt(e.target.dataset.val);
        highlightStars(hoverVal);
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

    if (!socialUser) {
        alert('Primero inicia sesión con Facebook o Instagram.');
        return;
    }
    if (selectedRating === 0) {
        alert('Selecciona una calificación de estrellas.');
        return;
    }

    const texto = document.getElementById('refTexto').value.trim();
    if (!texto) {
        alert('Escribe tu opinión.');
        return;
    }

    const btn = document.getElementById('btnSubmit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando...';

    try {
        let photoUrl = '';

        // Subir foto si hay
        if (selectedPhoto) {
            const ext = selectedPhoto.name.split('.').pop();
            const fileName = `referencias/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
            const ref = storage.ref(fileName);
            await ref.put(selectedPhoto);
            photoUrl = await ref.getDownloadURL();
        }

        // Guardar en Firestore
        await db.collection('referencias').add({
            nombre: socialUser.name,
            avatar: socialUser.avatar,
            profileUrl: socialUser.profileUrl,
            source: socialUser.source,
            uid: socialUser.uid,
            rating: selectedRating,
            texto: texto,
            foto: photoUrl,
            fecha: firebase.firestore.FieldValue.serverTimestamp(),
            aprobado: true // auto-aprobado, cambiar a false si quieres moderación
        });

        // Reset
        selectedRating = 0;
        selectedPhoto = null;
        document.getElementById('refForm').reset();
        updateStarsUI();
        resetPhotoUpload();
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

        const sourceIcon = ref.source === 'facebook'
            ? '<i class="fab fa-facebook verified" title="Verificado con Facebook"></i>'
            : '<i class="fab fa-instagram verified" style="color:#E4405F" title="Verificado con Instagram"></i>';

        const photoHtml = ref.foto
            ? `<img src="${ref.foto}" class="ref-card-photo" alt="Foto del producto" onclick="openLightbox('${ref.foto}')" loading="lazy">`
            : '';

        const profileLink = ref.profileUrl
            ? `<a href="${ref.profileUrl}" target="_blank" rel="noopener">${escapeHtml(ref.nombre)}</a>`
            : escapeHtml(ref.nombre);

        return `
            <div class="ref-card">
                <div class="ref-card-header">
                    <img src="${ref.avatar}" alt="${escapeHtml(ref.nombre)}" loading="lazy"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2250%22 fill=%22%2381B29A%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>${ref.nombre ? ref.nombre[0].toUpperCase() : 'U'}</text></svg>'">
                    <div class="ref-author">
                        <div class="ref-author-name">${profileLink} ${sourceIcon}</div>
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
