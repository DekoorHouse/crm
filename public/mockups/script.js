// ===================== FIREBASE CONFIG =====================
const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a"
};
firebase.initializeApp(firebaseConfig);
const firebaseAuth = firebase.auth();

// ===================== CONSTANTS =====================
const API_BASE = window.API_BASE_URL || '';

// ===================== STATE =====================
let sessionCost = 0;
let sessionImages = 0;
let sessionTokensIn = 0;
let sessionTokensOut = 0;
let isGenerating = false;
let uploadedImages = []; // [{ mimeType, base64, dataUrl }]
let galleryItems = [];
let currentLightboxItem = null;

// ===================== DOM ELEMENTS =====================
const loginView = document.getElementById('login-view');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const darkModeToggle = document.getElementById('dark-mode-toggle');

const promptInput = document.getElementById('prompt-input');
const aspectSelect = document.getElementById('aspect-ratio');
const generateBtn = document.getElementById('generate-btn');

const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');

const resultsSection = document.getElementById('results-section');
const resultsGrid = document.getElementById('results-grid');
const resultTokensIn = document.getElementById('result-tokens-in');
const resultTokensOut = document.getElementById('result-tokens-out');
const resultCost = document.getElementById('result-cost');

const galleryGrid = document.getElementById('gallery-grid');
const galleryEmpty = document.getElementById('gallery-empty');

const sessionCostEl = document.getElementById('session-cost');
const sessionImagesEl = document.getElementById('session-images');
const sessionTokensInEl = document.getElementById('session-tokens-in');
const sessionTokensOutEl = document.getElementById('session-tokens-out');

const uploadDropzone = document.getElementById('upload-dropzone');
const imageUploadInput = document.getElementById('image-upload');
const uploadPlaceholder = document.getElementById('upload-placeholder');
const uploadPreviews = document.getElementById('upload-previews');

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxDownload = document.getElementById('lightbox-download');
const lightboxDelete = document.getElementById('lightbox-delete');
const lightboxPrompt = document.getElementById('lightbox-prompt');

// ===================== AUTH =====================
firebaseAuth.onAuthStateChanged(user => {
    if (user) {
        loginView.style.display = 'none';
        app.style.display = 'block';
        loadGallery();
    } else {
        loginView.style.display = 'flex';
        app.style.display = 'none';
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    try {
        await firebaseAuth.signInWithEmailAndPassword(loginEmail.value, loginPassword.value);
    } catch (err) {
        loginError.textContent = 'Credenciales incorrectas.';
    }
});

logoutBtn.addEventListener('click', () => firebaseAuth.signOut());

// ===================== DARK MODE =====================
function initDarkMode() {
    const saved = localStorage.getItem('mockups-dark-mode');
    if (saved === 'true' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-mode');
    }
    updateDarkModeIcon();
}

function updateDarkModeIcon() {
    const icon = darkModeToggle.querySelector('i');
    icon.className = document.body.classList.contains('dark-mode') ? 'fas fa-sun' : 'fas fa-moon';
}

darkModeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('mockups-dark-mode', document.body.classList.contains('dark-mode'));
    updateDarkModeIcon();
});

// ===================== GENERATE =====================
generateBtn.addEventListener('click', generate);
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();
});

async function generate() {
    const prompt = promptInput.value.trim();
    if (!prompt || isGenerating) return;

    isGenerating = true;
    generateBtn.disabled = true;
    loadingState.style.display = 'block';
    errorState.style.display = 'none';
    resultsSection.style.display = 'none';

    try {
        const payload = { prompt, aspectRatio: aspectSelect.value };
        if (uploadedImages.length > 0) {
            payload.images = uploadedImages.map(i => ({ mimeType: i.mimeType, base64: i.base64 }));
        }

        const res = await fetch(`${API_BASE}/api/mockups/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || `Error ${res.status}`);

        renderResults(data);
        updateSessionCost(data);
        // Recargar galería para mostrar la nueva imagen
        await loadGallery();

    } catch (err) {
        errorState.style.display = 'block';
        errorMessage.textContent = err.message;
    } finally {
        isGenerating = false;
        generateBtn.disabled = false;
        loadingState.style.display = 'none';
    }
}

// ===================== RENDER RESULTS =====================
function renderResults(data) {
    resultsSection.style.display = 'block';
    resultTokensIn.textContent = `In: ${data.usage.inputTokens.toLocaleString()}`;
    resultTokensOut.textContent = `Out: ${data.usage.outputTokens.toLocaleString()}`;
    resultCost.textContent = `$${data.cost.total.toFixed(4)}`;

    resultsGrid.innerHTML = '';
    data.images.forEach((img) => {
        const card = document.createElement('div');
        card.className = 'result-card';
        card.innerHTML = `<img src="${img.fullUrl}" alt="Generated">`;
        card.addEventListener('click', () => openLightbox({ fullUrl: img.fullUrl, id: img.id, prompt: promptInput.value.trim() }));
        resultsGrid.appendChild(card);
    });
}

// ===================== SESSION COST =====================
function updateSessionCost(data) {
    sessionCost += data.cost.total;
    sessionImages += data.images.length;
    sessionTokensIn += data.usage.inputTokens;
    sessionTokensOut += data.usage.outputTokens;

    sessionCostEl.textContent = `$${sessionCost.toFixed(4)}`;
    sessionImagesEl.textContent = sessionImages;
    sessionTokensInEl.textContent = sessionTokensIn.toLocaleString();
    sessionTokensOutEl.textContent = sessionTokensOut.toLocaleString();
}

// ===================== GALLERY =====================
async function loadGallery() {
    try {
        const res = await fetch(`${API_BASE}/api/mockups/gallery`);
        const data = await res.json();
        if (data.success) {
            galleryItems = data.items;
            renderGallery();
        }
    } catch (err) {
        console.error('Error cargando galería:', err);
    }
}

function renderGallery() {
    galleryGrid.innerHTML = '';

    if (galleryItems.length === 0) {
        galleryGrid.innerHTML = `
            <div class="gallery-empty">
                <i class="fas fa-images"></i>
                <p>Las imagenes generadas apareceran aqui</p>
            </div>`;
        return;
    }

    galleryItems.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'gallery-card';
        card.innerHTML = `
            <img src="${item.thumbUrl}" alt="${escapeHtml(item.prompt)}" loading="lazy">
            <div class="gallery-card-overlay">
                <button class="btn delete-btn" data-id="${item.id}"><i class="fas fa-trash"></i></button>
            </div>
        `;
        card.addEventListener('click', (e) => {
            if (e.target.closest('.delete-btn')) return;
            openLightbox(item);
        });
        card.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteImage(item.id);
        });
        galleryGrid.appendChild(card);
    });
}

async function deleteImage(id) {
    if (!confirm('Eliminar esta imagen?')) return;
    try {
        const res = await fetch(`${API_BASE}/api/mockups/gallery/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            galleryItems = galleryItems.filter(i => i.id !== id);
            renderGallery();
            if (currentLightboxItem?.id === id) lightbox.style.display = 'none';
        }
    } catch (err) {
        console.error('Error eliminando:', err);
    }
}

// ===================== IMAGE UPLOAD (MULTIPLE) =====================
uploadDropzone.addEventListener('click', () => imageUploadInput.click());

imageUploadInput.addEventListener('change', (e) => {
    for (const file of e.target.files) handleImageFile(file);
    imageUploadInput.value = '';
});

uploadDropzone.addEventListener('dragover', (e) => { e.preventDefault(); uploadDropzone.classList.add('dragover'); });
uploadDropzone.addEventListener('dragleave', () => uploadDropzone.classList.remove('dragover'));
uploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDropzone.classList.remove('dragover');
    for (const file of e.dataTransfer.files) handleImageFile(file);
});

function handleImageFile(file) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        const id = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        uploadedImages.push({ id, mimeType: file.type, base64: dataUrl.split(',')[1], dataUrl });
        renderUploadPreviews();
    };
    reader.readAsDataURL(file);
}

function removeUploadedImage(id) {
    uploadedImages = uploadedImages.filter(i => i.id !== id);
    renderUploadPreviews();
}

function renderUploadPreviews() {
    uploadPreviews.innerHTML = '';
    uploadedImages.forEach((img) => {
        const thumb = document.createElement('div');
        thumb.className = 'upload-thumb';
        thumb.innerHTML = `
            <img src="${img.dataUrl}" alt="">
            <button class="upload-thumb-remove" data-id="${img.id}"><i class="fas fa-times"></i></button>
        `;
        thumb.querySelector('.upload-thumb-remove').addEventListener('click', () => removeUploadedImage(img.id));
        uploadPreviews.appendChild(thumb);
    });
}

// ===================== LIGHTBOX =====================
function openLightbox(item) {
    currentLightboxItem = item;
    lightboxImg.src = item.fullUrl;
    lightboxPrompt.textContent = item.prompt || '';
    lightbox.style.display = 'flex';
}

lightboxClose.addEventListener('click', () => { lightbox.style.display = 'none'; });
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.style.display = 'none'; });

lightboxDownload.addEventListener('click', () => {
    if (!currentLightboxItem) return;
    const a = document.createElement('a');
    a.href = currentLightboxItem.fullUrl;
    a.download = `mockup-${Date.now()}.webp`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

lightboxDelete.addEventListener('click', () => {
    if (currentLightboxItem?.id) deleteImage(currentLightboxItem.id);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.style.display === 'flex') lightbox.style.display = 'none';
});

// ===================== UTILITIES =====================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===================== INIT =====================
initDarkMode();
