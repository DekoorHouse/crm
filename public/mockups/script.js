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
let batchMode = false;
let batchProductImage = null; // { mimeType, base64, dataUrl }
let batchNameImages = []; // [{ mimeType, base64, dataUrl }]
const BATCH_PROMPT = 'Cambia el nombre de la lámpara por el de la imagen negra. Respeta la tipografía. Incluye todo el texto de la imagen negra. Y que el nuevo nombre se integre bien para que parezca completamente realista. Que todo el texto esté del mismo lado. De ser necesario ajusta el tamaño del texto para que quepa.';
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
const resolutionSelect = document.getElementById('resolution');
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
const uploadPreviews = document.getElementById('upload-previews');

const batchModeToggle = document.getElementById('batch-mode-toggle');
const singleModeDiv = document.getElementById('single-mode');
const batchModeDiv = document.getElementById('batch-mode');
const batchNamesInput = document.getElementById('batch-names');
const batchProductDropzone = document.getElementById('batch-product-dropzone');
const batchProductInput = document.getElementById('batch-product-input');
const batchProductPreview = document.getElementById('batch-product-preview');
const batchNamesDropzone = document.getElementById('batch-names-dropzone');
const batchNamesInputFile = document.getElementById('batch-names-input');
const batchNamesPreviews = document.getElementById('batch-names-previews');
const batchProgress = document.getElementById('batch-progress');
const batchProgressText = document.getElementById('batch-progress-text');
const batchProgressPct = document.getElementById('batch-progress-pct');
const batchProgressFill = document.getElementById('batch-progress-fill');

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

// ===================== BATCH MODE TOGGLE =====================
batchModeToggle.addEventListener('change', () => {
    batchMode = batchModeToggle.checked;
    singleModeDiv.style.display = batchMode ? 'none' : 'block';
    batchModeDiv.style.display = batchMode ? 'block' : 'none';
    generateBtn.innerHTML = batchMode
        ? '<i class="fas fa-bolt"></i> Generar Lote'
        : '<i class="fas fa-bolt"></i> Generar';
});

// ===================== BATCH UPLOADS =====================
// Product image (single)
batchProductDropzone.addEventListener('click', () => batchProductInput.click());
batchProductInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadBatchProductImage(e.target.files[0]);
    batchProductInput.value = '';
});
batchProductDropzone.addEventListener('dragover', (e) => { e.preventDefault(); batchProductDropzone.classList.add('dragover'); });
batchProductDropzone.addEventListener('dragleave', () => batchProductDropzone.classList.remove('dragover'));
batchProductDropzone.addEventListener('drop', (e) => {
    e.preventDefault(); batchProductDropzone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) loadBatchProductImage(e.dataTransfer.files[0]);
});

function loadBatchProductImage(file) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        batchProductImage = { mimeType: file.type, base64: e.target.result.split(',')[1], dataUrl: e.target.result };
        renderBatchProductPreview();
    };
    reader.readAsDataURL(file);
}

function renderBatchProductPreview() {
    batchProductPreview.innerHTML = '';
    if (!batchProductImage) return;
    const thumb = document.createElement('div');
    thumb.className = 'upload-thumb';
    thumb.innerHTML = `
        <img src="${batchProductImage.dataUrl}" alt="">
        <button class="upload-thumb-remove"><i class="fas fa-times"></i></button>
    `;
    thumb.querySelector('.upload-thumb-remove').addEventListener('click', () => {
        batchProductImage = null;
        renderBatchProductPreview();
    });
    batchProductPreview.appendChild(thumb);
}

// Name images (multiple)
batchNamesDropzone.addEventListener('click', () => batchNamesInputFile.click());
batchNamesInputFile.addEventListener('change', (e) => {
    for (const file of e.target.files) loadBatchNameImage(file);
    batchNamesInputFile.value = '';
});
batchNamesDropzone.addEventListener('dragover', (e) => { e.preventDefault(); batchNamesDropzone.classList.add('dragover'); });
batchNamesDropzone.addEventListener('dragleave', () => batchNamesDropzone.classList.remove('dragover'));
batchNamesDropzone.addEventListener('drop', (e) => {
    e.preventDefault(); batchNamesDropzone.classList.remove('dragover');
    for (const file of e.dataTransfer.files) loadBatchNameImage(file);
});

function loadBatchNameImage(file) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const id = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        batchNameImages.push({ id, mimeType: file.type, base64: e.target.result.split(',')[1], dataUrl: e.target.result });
        renderBatchNamePreviews();
    };
    reader.readAsDataURL(file);
}

function renderBatchNamePreviews() {
    batchNamesPreviews.innerHTML = '';
    batchNameImages.forEach((img, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'upload-thumb';
        thumb.innerHTML = `
            <img src="${img.dataUrl}" alt="">
            <button class="upload-thumb-remove" data-id="${img.id}"><i class="fas fa-times"></i></button>
        `;
        thumb.querySelector('.upload-thumb-remove').addEventListener('click', () => {
            batchNameImages = batchNameImages.filter(x => x.id !== img.id);
            renderBatchNamePreviews();
        });
        batchNamesPreviews.appendChild(thumb);
    });
}

// ===================== GENERATE =====================
generateBtn.addEventListener('click', () => batchMode ? generateBatch() : generate());
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
        const payload = { prompt, aspectRatio: aspectSelect.value, resolution: resolutionSelect.value };
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

// ===================== BATCH GENERATE =====================
async function generateBatch() {
    const names = batchNamesInput.value.trim().split('\n').map(n => n.trim()).filter(Boolean);
    if (names.length === 0) { alert('Agrega al menos un nombre a la lista.'); return; }
    if (!batchProductImage) { alert('Sube la imagen del producto.'); return; }
    if (batchNameImages.length !== names.length) {
        alert(`Tienes ${names.length} nombres pero ${batchNameImages.length} imágenes. Deben coincidir.`);
        return;
    }
    if (isGenerating) return;

    isGenerating = true;
    generateBtn.disabled = true;
    errorState.style.display = 'none';
    resultsSection.style.display = 'none';
    batchProgress.style.display = 'block';

    let completed = 0;
    const total = names.length;
    const errors = [];
    updateBatchProgress(0, total);

    const promises = names.map((name, i) => {
        const payload = {
            prompt: BATCH_PROMPT,
            aspectRatio: aspectSelect.value,
            resolution: resolutionSelect.value,
            images: [
                { mimeType: batchProductImage.mimeType, base64: batchProductImage.base64 },
                { mimeType: batchNameImages[i].mimeType, base64: batchNameImages[i].base64 },
            ],
        };

        return fetch(`${API_BASE}/api/mockups/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        .then(res => res.json())
        .then(data => {
            completed++;
            updateBatchProgress(completed, total);
            if (data.success) updateSessionCost(data);
            else errors.push(`${name}: ${data.error}`);
            return data;
        })
        .catch(err => {
            completed++;
            updateBatchProgress(completed, total);
            errors.push(`${name}: ${err.message}`);
            return { success: false };
        });
    });

    await Promise.all(promises);
    await loadGallery();

    batchProgress.style.display = 'none';
    isGenerating = false;
    generateBtn.disabled = false;

    if (errors.length > 0) {
        errorState.style.display = 'block';
        errorMessage.textContent = `${errors.length} errores: ${errors[0]}`;
    }
}

function updateBatchProgress(completed, total) {
    const pct = Math.round((completed / total) * 100);
    batchProgressText.textContent = `Generando ${completed}/${total}...`;
    batchProgressPct.textContent = `${pct}%`;
    batchProgressFill.style.width = `${pct}%`;
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
