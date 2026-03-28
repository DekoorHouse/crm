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

const MODELS_INFO = {
    'imagen-4-fast':    { name: 'Imagen 4 Fast',       type: 'Imagen',             cost: 0.02,  speed: 'fast',     isImagen: true },
    'imagen-4':         { name: 'Imagen 4',            type: 'Imagen',             cost: 0.04,  speed: 'standard', isImagen: true },
    'imagen-4-ultra':   { name: 'Imagen 4 Ultra',      type: 'Imagen',             cost: 0.06,  speed: 'premium',  isImagen: true },
    'nano-banana':      { name: 'Nano Banana',         type: 'Gemini 2.5 Flash',   cost: 0.039, speed: 'standard', isImagen: false },
    'nano-banana-2':    { name: 'Nano Banana 2',       type: 'Gemini 3.1 Flash',   cost: 0.067, speed: 'standard', isImagen: false },
    'nano-banana-pro':  { name: 'Nano Banana Pro',     type: 'Gemini 3 Pro',       cost: 0.134, speed: 'premium',  isImagen: false },
};

// ===================== STATE =====================
let selectedModel = 'imagen-4-fast';
let sessionCost = 0;
let sessionImages = 0;
let sessionTokens = 0;
let history = [];
let isGenerating = false;

// ===================== DOM ELEMENTS =====================
const loginView = document.getElementById('login-view');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const darkModeToggle = document.getElementById('dark-mode-toggle');

const modelsGrid = document.getElementById('models-grid');
const promptInput = document.getElementById('prompt-input');
const aspectSelect = document.getElementById('aspect-ratio');
const sampleCountSelect = document.getElementById('sample-count');
const sampleCountGroup = document.getElementById('sample-count-group');
const generateBtn = document.getElementById('generate-btn');

const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');

const resultsSection = document.getElementById('results-section');
const resultsGrid = document.getElementById('results-grid');
const resultModel = document.getElementById('result-model');
const resultTokens = document.getElementById('result-tokens');
const resultCost = document.getElementById('result-cost');

const historySection = document.getElementById('history-section');
const historyList = document.getElementById('history-list');

const sessionCostEl = document.getElementById('session-cost');
const sessionImagesEl = document.getElementById('session-images');
const sessionTokensEl = document.getElementById('session-tokens');

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxDownload = document.getElementById('lightbox-download');

// ===================== AUTH =====================
firebaseAuth.onAuthStateChanged(user => {
    if (user) {
        loginView.style.display = 'none';
        app.style.display = 'block';
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
        updateDarkModeIcon();
    }
}

function updateDarkModeIcon() {
    const icon = darkModeToggle.querySelector('i');
    if (document.body.classList.contains('dark-mode')) {
        icon.className = 'fas fa-sun';
    } else {
        icon.className = 'fas fa-moon';
    }
}

darkModeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('mockups-dark-mode', document.body.classList.contains('dark-mode'));
    updateDarkModeIcon();
});

// ===================== MODEL SELECTOR =====================
modelsGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.model-card');
    if (!card) return;
    modelsGrid.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedModel = card.dataset.model;
    updateSampleCountVisibility();
});

function updateSampleCountVisibility() {
    const info = MODELS_INFO[selectedModel];
    // Solo modelos Imagen soportan multiples imagenes
    sampleCountGroup.style.display = info?.isImagen ? 'flex' : 'none';
    if (!info?.isImagen) sampleCountSelect.value = '1';
}

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
        const res = await fetch(`${API_BASE}/api/mockups/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                model: selectedModel,
                aspectRatio: aspectSelect.value,
                sampleCount: parseInt(sampleCountSelect.value),
            }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.error || `Error ${res.status}`);
        }

        renderResults(data);
        updateSessionCost(data);
        addToHistory(prompt, data);

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
    resultModel.textContent = data.model;
    resultTokens.textContent = `${data.usage.totalTokens} tokens`;
    resultCost.textContent = `$${data.cost.total.toFixed(4)}`;

    resultsGrid.innerHTML = '';
    data.images.forEach((src, i) => {
        const card = document.createElement('div');
        card.className = 'result-card';
        card.innerHTML = `
            <img src="${src}" alt="Generated image ${i + 1}">
            <div class="result-card-actions">
                <button class="btn download-btn" data-index="${i}"><i class="fas fa-download"></i> Descargar</button>
            </div>
        `;
        card.querySelector('img').addEventListener('click', () => openLightbox(src));
        card.querySelector('.download-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            downloadImage(src, `mockup-${Date.now()}-${i}.png`);
        });
        resultsGrid.appendChild(card);
    });
}

// ===================== SESSION COST =====================
function updateSessionCost(data) {
    sessionCost += data.cost.total;
    sessionImages += data.images.length;
    sessionTokens += data.usage.totalTokens;

    sessionCostEl.textContent = `$${sessionCost.toFixed(4)}`;
    sessionImagesEl.textContent = sessionImages;
    sessionTokensEl.textContent = sessionTokens.toLocaleString();
}

// ===================== HISTORY =====================
function addToHistory(prompt, data) {
    const entry = {
        prompt,
        model: data.model,
        cost: data.cost.total,
        thumb: data.images[0],
        timestamp: new Date(),
    };
    history.unshift(entry);
    renderHistory();
}

function renderHistory() {
    if (history.length === 0) {
        historySection.style.display = 'none';
        return;
    }
    historySection.style.display = 'block';
    historyList.innerHTML = '';
    history.forEach((h) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <img class="history-thumb" src="${h.thumb}" alt="">
            <span class="history-prompt">${escapeHtml(h.prompt)}</span>
            <span class="history-model">${h.model}</span>
            <span class="history-cost">$${h.cost.toFixed(4)}</span>
        `;
        div.addEventListener('click', () => openLightbox(h.thumb));
        historyList.appendChild(div);
    });
}

// ===================== LIGHTBOX =====================
let currentLightboxSrc = '';

function openLightbox(src) {
    currentLightboxSrc = src;
    lightboxImg.src = src;
    lightbox.style.display = 'flex';
}

lightboxClose.addEventListener('click', () => {
    lightbox.style.display = 'none';
});

lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) lightbox.style.display = 'none';
});

lightboxDownload.addEventListener('click', () => {
    downloadImage(currentLightboxSrc, `mockup-${Date.now()}.png`);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.style.display === 'flex') {
        lightbox.style.display = 'none';
    }
});

// ===================== UTILITIES =====================
function downloadImage(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===================== INIT =====================
initDarkMode();
updateSampleCountVisibility();
