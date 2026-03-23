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
const storageRef = firebase.storage();
const auth = firebase.auth();

// --- Estado ---
let socialUser = null;
let selectedRating = 0;
let selectedPhoto = null;

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

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile) {
        auth.signInWithRedirect(provider);
    } else {
        auth.signInWithPopup(provider)
            .then(function(result) {
                setSocialUserFromFirebase(result.user);
            })
            .catch(function(err) {
                console.error('Error Facebook login:', err);
                if (err.code === 'auth/account-exists-with-different-credential') {
                    alert('Ya existe una cuenta con ese correo electrónico.');
                } else if (err.code !== 'auth/popup-closed-by-user') {
                    alert('Error: ' + err.message);
                }
            });
    }
}

function setSocialUserFromFirebase(user) {
    if (!user) return;
    var fbData = null;
    for (var i = 0; i < user.providerData.length; i++) {
        if (user.providerData[i].providerId === 'facebook.com') {
            fbData = user.providerData[i];
            break;
        }
    }
    if (!fbData) return;

    socialUser = {
        name: fbData.displayName || user.displayName || 'Usuario',
        avatar: 'https://graph.facebook.com/' + fbData.uid + '/picture?width=200&height=200',
        profileUrl: 'https://facebook.com/' + fbData.uid,
        uid: user.uid
    };
    showLoggedUser();
}

function showLoggedUser() {
    document.getElementById('refFormCard').classList.remove('hidden');
    document.getElementById('socialLoginSection').classList.add('hidden');
    document.getElementById('loggedUserBar').classList.remove('hidden');
    document.getElementById('refForm').classList.remove('hidden');

    document.getElementById('loggedAvatar').src = socialUser.avatar;
    document.getElementById('loggedName').textContent = socialUser.name;
    document.getElementById('loggedSource').innerHTML = '<i class="fab fa-facebook" style="color:#1877F2"></i> Verificado con Facebook';
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

// Detectar sesión activa de Facebook al cargar
auth.onAuthStateChanged(function(user) {
    try {
        if (user && !socialUser) {
            setSocialUserFromFirebase(user);
        }
    } catch (e) {
        console.error('Error en onAuthStateChanged:', e);
    }
});

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

    if (!socialUser) { alert('Primero inicia sesión con Facebook.'); return; }
    if (selectedRating === 0) { alert('Selecciona una calificación.'); return; }

    var texto = document.getElementById('refTexto').value.trim();
    if (!texto) { alert('Escribe tu opinión.'); return; }

    var btn = document.getElementById('btnSubmit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando...';

    try {
        var photoUrl = '';
        if (selectedPhoto) {
            var ext = selectedPhoto.name.split('.').pop();
            var fileName = 'referencias/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + ext;
            var fileRef = storageRef.ref(fileName);
            await fileRef.put(selectedPhoto);
            photoUrl = await fileRef.getDownloadURL();
        }

        await db.collection('referencias').add({
            nombre: socialUser.name,
            avatar: socialUser.avatar,
            profileUrl: socialUser.profileUrl,
            uid: socialUser.uid,
            source: 'facebook',
            rating: selectedRating,
            texto: texto,
            foto: photoUrl,
            fecha: firebase.firestore.FieldValue.serverTimestamp(),
            aprobado: true
        });

        selectedRating = 0;
        selectedPhoto = null;
        document.getElementById('refForm').reset();
        updateStarsUI();
        resetPhotoUpload();
        toggleForm();
        alert('¡Gracias por tu referencia! Ya está publicada.');

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
    db.collection('referencias')
        .orderBy('fecha', 'desc')
        .onSnapshot(function(snapshot) {
            var refs = [];
            snapshot.forEach(function(doc) {
                var data = doc.data();
                if (data.aprobado !== false) {
                    data.id = doc.id;
                    refs.push(data);
                }
            });
            renderReferencias(refs);
            updateStats(refs);
        }, function(error) {
            console.error('Error cargando referencias:', error);
            document.getElementById('refLoading').innerHTML =
                '<p style="color:var(--color-danger);">Error al cargar las referencias.</p>';
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
        var nameHtml = ref.profileUrl
            ? '<a href="' + escapeHtml(ref.profileUrl) + '" target="_blank" rel="noopener">' + nombre + '</a>'
            : nombre;

        var initial = ref.nombre ? ref.nombre[0].toUpperCase() : '?';
        var avatarSrc = ref.avatar || '';
        var fallbackSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#81B29A"/><text x="50" y="58" text-anchor="middle" font-size="40" fill="white" font-family="sans-serif">' + initial + '</text></svg>');

        html += '<div class="ref-card">' +
            '<div class="ref-card-header">' +
                '<img src="' + (avatarSrc || fallbackSvg) + '" alt="' + nombre + '" loading="lazy" onerror="this.src=\'' + fallbackSvg + '\'">' +
                '<div class="ref-author">' +
                    '<div class="ref-author-name">' + nameHtml + ' <i class="fab fa-facebook-square verified" style="color:#1877F2" title="Verificado con Facebook"></i></div>' +
                    '<div class="ref-date">' + fechaStr + '</div>' +
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

// --- Utilidades ---
function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Init ---
loadReferencias();
