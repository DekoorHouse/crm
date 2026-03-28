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

// ===================== STATE =====================
let currentTool = 'brush'; // brush, text, move, eyedropper
let baseImage = null;      // original uploaded Image object
let brushSize = 30;
let brushColor = '#0a0a2e';
let isDrawing = false;
let textLayers = [];       // [{ text, x, y, fontFamily, fontSize, color, glowStrength, glowColor }]
let selectedTextIdx = -1;
let dragOffset = null;
let customFonts = [];      // [{ name, url }]
let undoStack = [];
let redoStack = [];
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStart = null;

// ===================== DOM =====================
const loginView = document.getElementById('login-view');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const darkModeToggle = document.getElementById('dark-mode-toggle');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const canvasContainer = document.getElementById('canvas-container');
const canvasPlaceholder = document.getElementById('canvas-placeholder');
const imageInput = document.getElementById('image-input');

const toolBrush = document.getElementById('tool-brush');
const toolText = document.getElementById('tool-text');
const toolMove = document.getElementById('tool-move');
const brushOptions = document.getElementById('brush-options');
const textOptions = document.getElementById('text-options');

const brushSizeInput = document.getElementById('brush-size');
const brushSizeVal = document.getElementById('brush-size-val');
const brushColorInput = document.getElementById('brush-color');
const pickColorBtn = document.getElementById('pick-color');

const fontFamilySelect = document.getElementById('font-family');
const fontUpload = document.getElementById('font-upload');
const fontSizeInput = document.getElementById('font-size');
const fontSizeVal = document.getElementById('font-size-val');
const fontColorInput = document.getElementById('font-color');
const glowStrengthInput = document.getElementById('glow-strength');
const glowVal = document.getElementById('glow-val');
const glowColorInput = document.getElementById('glow-color');
const textQualityInput = document.getElementById('text-quality');
const textQualityVal = document.getElementById('text-quality-val');
const strokeWidthInput = document.getElementById('stroke-width');
const strokeWidthVal = document.getElementById('stroke-width-val');
const strokeColorInput = document.getElementById('stroke-color');
const strokeDirSelect = document.getElementById('stroke-dir');
const alignLeftBtn = document.getElementById('align-left');
const alignCenterBtn = document.getElementById('align-center');
const alignRightBtn = document.getElementById('align-right');

const textInputPanel = document.getElementById('text-input-panel');
const textContent = document.getElementById('text-content');

const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const exportBtn = document.getElementById('export-btn');

const batchToggle = document.getElementById('batch-toggle');
const batchPanel = document.getElementById('batch-panel');
const batchNames = document.getElementById('batch-names');
const batchExportBtn = document.getElementById('batch-export');
const batchProgressEl = document.getElementById('batch-progress');
const batchProgressText = document.getElementById('batch-progress-text');
const batchProgressFill = document.getElementById('batch-progress-fill');

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
    const saved = localStorage.getItem('ps-dark-mode');
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
    localStorage.setItem('ps-dark-mode', document.body.classList.contains('dark-mode'));
    updateDarkModeIcon();
});

// ===================== IMAGE UPLOAD =====================
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            baseImage = img;
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.style.display = 'block';
            canvasPlaceholder.style.display = 'none';
            textLayers = [];
            selectedTextIdx = -1;
            undoStack = [];
            redoStack = [];
            resetZoom();
            redrawCanvas();
            saveUndo();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    imageInput.value = '';
});

// ===================== PASTE IMAGE (CTRL+V) =====================
document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    baseImage = img;
                    canvas.width = img.width;
                    canvas.height = img.height;
                    canvas.style.display = 'block';
                    canvasPlaceholder.style.display = 'none';
                    textLayers = [];
                    selectedTextIdx = -1;
                    undoStack = [];
                    redoStack = [];
                    resetZoom();
                    redrawCanvas();
                    saveUndo();
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            break;
        }
    }
});

// ===================== TOOLS =====================
function setTool(tool) {
    currentTool = tool;
    toolBrush.classList.toggle('active', tool === 'brush');
    toolText.classList.toggle('active', tool === 'text');
    toolMove.classList.toggle('active', tool === 'move');
    brushOptions.style.display = tool === 'brush' ? 'flex' : 'none';
    textOptions.style.display = (tool === 'text' || tool === 'move') ? 'flex' : 'none';
    textInputPanel.style.display = tool === 'text' ? 'block' : 'none';
    canvas.style.cursor = tool === 'brush' ? 'crosshair' : tool === 'text' ? 'text' : tool === 'move' ? 'grab' : 'crosshair';
    if (tool === 'eyedropper') canvas.style.cursor = 'crosshair';
}

toolBrush.addEventListener('click', () => setTool('brush'));
toolText.addEventListener('click', () => setTool('text'));
toolMove.addEventListener('click', () => setTool('move'));

// ===================== BRUSH CONTROLS =====================
brushSizeInput.addEventListener('input', () => {
    brushSize = parseFloat(brushSizeInput.value);
    brushSizeVal.textContent = brushSize;
});

brushColorInput.addEventListener('input', () => {
    brushColor = brushColorInput.value;
});

pickColorBtn.addEventListener('click', () => {
    currentTool = 'eyedropper';
    canvas.style.cursor = 'crosshair';
    toolBrush.classList.remove('active');
    pickColorBtn.classList.add('active');
});

// ===================== FONT CONTROLS =====================
fontSizeInput.addEventListener('input', () => {
    fontSizeVal.textContent = fontSizeInput.value;
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].fontSize = parseFloat(fontSizeInput.value);
        redrawCanvas();
    }
});

fontColorInput.addEventListener('input', () => {
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].color = fontColorInput.value;
        redrawCanvas();
    }
});

fontFamilySelect.addEventListener('change', () => {
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].fontFamily = fontFamilySelect.value;
        redrawCanvas();
    }
});

glowStrengthInput.addEventListener('input', () => {
    glowVal.textContent = glowStrengthInput.value;
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].glowStrength = parseFloat(glowStrengthInput.value);
        redrawCanvas();
    }
});

glowColorInput.addEventListener('input', () => {
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].glowColor = glowColorInput.value;
        redrawCanvas();
    }
});

strokeWidthInput.addEventListener('input', () => {
    strokeWidthVal.textContent = strokeWidthInput.value;
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].strokeWidth = parseFloat(strokeWidthInput.value);
        redrawCanvas();
    }
});

strokeColorInput.addEventListener('input', () => {
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].strokeColor = strokeColorInput.value;
        redrawCanvas();
    }
});

strokeDirSelect.addEventListener('change', () => {
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].strokeDir = strokeDirSelect.value;
        redrawCanvas();
    }
});

function setTextAlign(align) {
    alignLeftBtn.classList.toggle('active', align === 'left');
    alignCenterBtn.classList.toggle('active', align === 'center');
    alignRightBtn.classList.toggle('active', align === 'right');
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].textAlign = align;
        redrawCanvas();
    }
}
alignLeftBtn.addEventListener('click', () => setTextAlign('left'));
alignCenterBtn.addEventListener('click', () => setTextAlign('center'));
alignRightBtn.addEventListener('click', () => setTextAlign('right'));

textQualityInput.addEventListener('input', () => {
    textQualityVal.textContent = textQualityInput.value + 'x';
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].quality = parseFloat(textQualityInput.value);
        redrawCanvas();
    }
});

textContent.addEventListener('input', () => {
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].text = textContent.value;
        redrawCanvas();
    }
});

// ===================== FONT UPLOAD =====================
fontUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fontName = file.name.replace(/\.(ttf|otf|woff|woff2)$/i, '');
    const url = URL.createObjectURL(file);
    const font = new FontFace(fontName, `url(${url})`);
    try {
        await font.load();
        document.fonts.add(font);
        customFonts.push({ name: fontName, url });
        const opt = document.createElement('option');
        opt.value = fontName;
        opt.textContent = fontName;
        opt.selected = true;
        fontFamilySelect.appendChild(opt);
        if (selectedTextIdx >= 0) {
            textLayers[selectedTextIdx].fontFamily = fontName;
            redrawCanvas();
        }
    } catch (err) {
        alert('Error cargando fuente: ' + err.message);
    }
    fontUpload.value = '';
});

// ===================== ZOOM & PAN =====================
function applyZoom() {
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    const indicator = document.getElementById('zoom-indicator');
    if (indicator) indicator.textContent = Math.round(zoomLevel * 100) + '%';
}

function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyZoom();
}

canvasContainer.addEventListener('wheel', (e) => {
    if (!baseImage) return;
    e.preventDefault();
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const oldZoom = zoomLevel;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomLevel = Math.min(5, Math.max(0.1, zoomLevel * factor));
    const ratio = zoomLevel / oldZoom;
    panX = mouseX - ratio * (mouseX - panX);
    panY = mouseY - ratio * (mouseY - panY);
    applyZoom();
}, { passive: false });

canvasContainer.addEventListener('dblclick', (e) => {
    if (!baseImage) return;
    resetZoom();
});

// ===================== CANVAS EVENTS =====================
function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
    };
}

canvas.addEventListener('auxclick', (e) => e.preventDefault());
canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
canvas.addEventListener('mouseup', onPointerUp);
canvas.addEventListener('mouseleave', onPointerUp);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onPointerDown(e); });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); onPointerMove(e); });
canvas.addEventListener('touchend', onPointerUp);

function onPointerDown(e) {
    if (!baseImage) return;

    // Pan with middle mouse or Alt+left click
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        isPanning = true;
        panStart = { x: e.clientX - panX, y: e.clientY - panY };
        canvas.style.cursor = 'grabbing';
        return;
    }

    const pos = getCanvasPos(e);

    if (currentTool === 'eyedropper') {
        const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        brushColor = hex;
        brushColorInput.value = hex;
        pickColorBtn.classList.remove('active');
        setTool('brush');
        return;
    }

    if (currentTool === 'brush') {
        isDrawing = true;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize;
        ctx.strokeStyle = brushColor;
    }

    if (currentTool === 'text') {
        const text = textContent.value.trim();
        if (!text) { textContent.focus(); return; }
        saveUndo();
        const activeAlign = alignCenterBtn.classList.contains('active') ? 'center' : alignRightBtn.classList.contains('active') ? 'right' : 'left';
        textLayers.push({
            text,
            x: pos.x,
            y: pos.y,
            fontFamily: fontFamilySelect.value,
            fontSize: parseFloat(fontSizeInput.value),
            color: fontColorInput.value,
            glowStrength: parseFloat(glowStrengthInput.value),
            glowColor: glowColorInput.value,
            strokeWidth: parseFloat(strokeWidthInput.value),
            strokeColor: strokeColorInput.value,
            strokeDir: strokeDirSelect.value,
            quality: parseFloat(textQualityInput.value),
            textAlign: activeAlign,
        });
        selectedTextIdx = textLayers.length - 1;
        redrawCanvas();
    }

    if (currentTool === 'move') {
        // Find text layer under click
        for (let i = textLayers.length - 1; i >= 0; i--) {
            const t = textLayers[i];
            ctx.font = `${t.fontSize}px "${t.fontFamily}"`;
            const metrics = ctx.measureText(t.text);
            const w = metrics.width;
            const h = t.fontSize;
            const align = t.textAlign || 'left';
            const lx = align === 'center' ? t.x - w / 2 : align === 'right' ? t.x - w : t.x;
            if (pos.x >= lx && pos.x <= lx + w && pos.y >= t.y - h && pos.y <= t.y) {
                selectedTextIdx = i;
                dragOffset = { x: pos.x - t.x, y: pos.y - t.y };
                isDrawing = true;
                canvas.style.cursor = 'grabbing';
                // Load properties into controls
                textContent.value = t.text;
                fontFamilySelect.value = t.fontFamily;
                fontSizeInput.value = t.fontSize;
                fontSizeVal.textContent = t.fontSize;
                fontColorInput.value = t.color;
                glowStrengthInput.value = t.glowStrength;
                glowVal.textContent = t.glowStrength;
                glowColorInput.value = t.glowColor;
                strokeWidthInput.value = t.strokeWidth || 0;
                strokeWidthVal.textContent = t.strokeWidth || 0;
                strokeColorInput.value = t.strokeColor || '#0066ff';
                strokeDirSelect.value = t.strokeDir || 'center';
                const ta = t.textAlign || 'left';
                alignLeftBtn.classList.toggle('active', ta === 'left');
                alignCenterBtn.classList.toggle('active', ta === 'center');
                alignRightBtn.classList.toggle('active', ta === 'right');
                textQualityInput.value = t.quality || 1;
                textQualityVal.textContent = (t.quality || 1) + 'x';
                textInputPanel.style.display = 'block';
                redrawCanvas();
                return;
            }
        }
        selectedTextIdx = -1;
        textInputPanel.style.display = 'none';
        redrawCanvas();
    }
}

function onPointerMove(e) {
    if (isPanning && panStart) {
        panX = e.clientX - panStart.x;
        panY = e.clientY - panStart.y;
        applyZoom();
        return;
    }
    if (!isDrawing || !baseImage) return;
    const pos = getCanvasPos(e);

    if (currentTool === 'brush') {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    }

    if (currentTool === 'move' && selectedTextIdx >= 0 && dragOffset) {
        textLayers[selectedTextIdx].x = pos.x - dragOffset.x;
        textLayers[selectedTextIdx].y = pos.y - dragOffset.y;
        redrawCanvas();
    }
}

function onPointerUp() {
    if (isPanning) {
        isPanning = false;
        panStart = null;
        canvas.style.cursor = currentTool === 'brush' ? 'crosshair' : currentTool === 'text' ? 'text' : currentTool === 'move' ? 'grab' : 'crosshair';
        return;
    }
    if (isDrawing && currentTool === 'brush') {
        saveUndo();
    }
    if (isDrawing && currentTool === 'move') {
        saveUndo();
        canvas.style.cursor = 'grab';
    }
    isDrawing = false;
    dragOffset = null;
}

// ===================== RENDER =====================
function redrawCanvas() {
    if (!baseImage) return;
    // Draw base image
    ctx.drawImage(baseImage, 0, 0);

    // Replay brush strokes from undo stack is complex, so we use imageData approach
    // Instead, we'll redraw from the last saved state + text layers
    // For simplicity, brush strokes are baked into the undo snapshots

    // Draw text layers
    for (let i = 0; i < textLayers.length; i++) {
        const t = textLayers[i];
        drawTextLayer(t, i === selectedTextIdx);
    }
}

function getStrokeDirOffset(dir, sw) {
    const d = sw * 0.7;
    const map = {
        'center': [0, 0],
        'top': [0, -d], 'bottom': [0, d],
        'left': [-d, 0], 'right': [d, 0],
        'top-right': [d, -d], 'top-left': [-d, -d],
        'bottom-right': [d, d], 'bottom-left': [-d, d],
    };
    return map[dir] || [0, 0];
}

function drawStroke(c, t, sw, tx, ty) {
    const dir = t.strokeDir || 'center';
    const sColor = t.strokeColor || '#0066ff';
    if (dir === 'center') {
        c.strokeStyle = sColor;
        c.lineWidth = sw;
        c.lineJoin = 'round';
        c.strokeText(t.text, tx, ty);
    } else {
        const [dx, dy] = getStrokeDirOffset(dir, sw);
        c.fillStyle = sColor;
        c.fillText(t.text, tx + dx, ty + dy);
    }
}

function drawTextLayer(t, isSelected) {
    ctx.save();
    const q = t.quality || 1;
    const align = t.textAlign || 'left';
    const scale = t.fontSize / 100; // proportional scaling for effects
    const glow = (t.glowStrength || 0) * scale;
    const sw = (t.strokeWidth || 0) * scale;
    ctx.font = `${t.fontSize}px "${t.fontFamily}"`;
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(t.text);
    const textW = metrics.width;
    const textH = t.fontSize;
    const glowPad = glow > 0 ? glow * 3 : 0;
    const pad = Math.max(glowPad, sw + 6);
    const alignOff = align === 'center' ? -textW / 2 : align === 'right' ? -textW : 0;

    if (q > 1) {
        const offW = Math.ceil(textW + pad * 2);
        const offH = Math.ceil(textH + pad * 2);
        const tmp = document.createElement('canvas');
        tmp.width = Math.ceil(offW * q);
        tmp.height = Math.ceil(offH * q);
        const tc = tmp.getContext('2d');
        tc.scale(q, q);
        tc.font = `${t.fontSize}px "${t.fontFamily}"`;
        tc.textBaseline = 'alphabetic';

        if (glow > 0) {
            tc.shadowColor = t.glowColor;
            tc.shadowBlur = glow;
            tc.fillStyle = t.color;
            for (let g = 0; g < 3; g++) tc.fillText(t.text, pad, textH + pad);
        }
        tc.shadowColor = 'transparent';
        tc.shadowBlur = 0;
        if (sw > 0) drawStroke(tc, t, sw, pad, textH + pad);
        tc.fillStyle = t.color;
        tc.fillText(t.text, pad, textH + pad);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tmp, t.x + alignOff - pad, t.y - textH - pad, offW, offH);
    } else {
        ctx.textAlign = align;
        if (glow > 0) {
            ctx.shadowColor = t.glowColor;
            ctx.shadowBlur = glow;
            ctx.fillStyle = t.color;
            for (let g = 0; g < 3; g++) ctx.fillText(t.text, t.x, t.y);
        }
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        if (sw > 0) drawStroke(ctx, t, sw, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
    }

    // Selection indicator
    const selX = t.x + alignOff;
    if (isSelected) {
        ctx.textAlign = 'left';
        ctx.strokeStyle = '#7aa2f7';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(selX - 4, t.y - textH - 2, textW + 8, textH + 8);
        ctx.setLineDash([]);
    }

    ctx.restore();
}

// Redraw with snapshot data (for undo)
function redrawFromSnapshot(snapshot) {
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        for (let i = 0; i < textLayers.length; i++) {
            drawTextLayer(textLayers[i], i === selectedTextIdx);
        }
    };
    img.src = snapshot;
}

// ===================== UNDO/REDO =====================
function saveUndo() {
    // Save canvas state without text layers
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0);
    undoStack.push({
        imageData: tempCanvas.toDataURL('image/png'),
        textLayers: JSON.parse(JSON.stringify(textLayers)),
    });
    if (undoStack.length > 30) undoStack.shift();
    redoStack = [];
}

undoBtn.addEventListener('click', () => {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    const state = undoStack[undoStack.length - 1];
    textLayers = JSON.parse(JSON.stringify(state.textLayers));
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
    img.src = state.imageData;
});

redoBtn.addEventListener('click', () => {
    if (redoStack.length === 0) return;
    const state = redoStack.pop();
    undoStack.push(state);
    textLayers = JSON.parse(JSON.stringify(state.textLayers));
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
    img.src = state.imageData;
});

// ===================== EXPORT =====================
exportBtn.addEventListener('click', () => {
    if (!baseImage) return;
    // Render final canvas without selection indicator
    const sel = selectedTextIdx;
    selectedTextIdx = -1;
    redrawCanvas();

    const link = document.createElement('a');
    link.download = `lampara-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    selectedTextIdx = sel;
    redrawCanvas();
});

// ===================== BATCH EXPORT =====================
batchToggle.addEventListener('change', () => {
    batchPanel.style.display = batchToggle.checked ? 'block' : 'none';
});

batchExportBtn.addEventListener('click', async () => {
    const names = batchNames.value.trim().split('\n').map(n => n.trim()).filter(Boolean);
    if (names.length === 0) { alert('Agrega al menos un nombre.'); return; }
    if (!baseImage) { alert('Sube una imagen primero.'); return; }
    if (textLayers.length === 0) { alert('Agrega al menos un texto primero.'); return; }

    batchExportBtn.disabled = true;
    batchProgressEl.style.display = 'block';

    // Save current text
    const originalTexts = textLayers.map(t => t.text);

    for (let i = 0; i < names.length; i++) {
        // Update first text layer with the new name
        textLayers[0].text = names[i];
        const prevSel = selectedTextIdx;
        selectedTextIdx = -1;
        redrawCanvas();

        // Small delay for render
        await new Promise(r => setTimeout(r, 50));

        const link = document.createElement('a');
        link.download = `${names[i].replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '_')}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        selectedTextIdx = prevSel;

        const pct = Math.round(((i + 1) / names.length) * 100);
        batchProgressText.textContent = `${i + 1}/${names.length}`;
        batchProgressFill.style.width = `${pct}%`;

        await new Promise(r => setTimeout(r, 200)); // delay between downloads
    }

    // Restore original texts
    textLayers.forEach((t, i) => { t.text = originalTexts[i]; });
    redrawCanvas();

    batchExportBtn.disabled = false;
    batchProgressEl.style.display = 'none';
});

// ===================== SAVE / LOAD PROJECT =====================
const saveProjectBtn = document.getElementById('save-project-btn');
const loadProjectInput = document.getElementById('load-project-input');

saveProjectBtn.addEventListener('click', () => {
    if (!baseImage) { alert('No hay proyecto para guardar.'); return; }

    // Render canvas without text to capture base + brush strokes
    const sel = selectedTextIdx;
    selectedTextIdx = -1;
    const savedLayers = [...textLayers];
    textLayers = [];
    redrawCanvas();
    const canvasState = canvas.toDataURL('image/png');
    textLayers = savedLayers;
    selectedTextIdx = sel;
    redrawCanvas();

    const project = {
        version: 1,
        width: canvas.width,
        height: canvas.height,
        baseImage: baseImage.src,
        canvasState,
        textLayers: JSON.parse(JSON.stringify(textLayers)),
    };

    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `proyecto-${Date.now()}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
});

loadProjectInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const project = JSON.parse(ev.target.result);
            if (!project.baseImage || !project.textLayers) {
                alert('Archivo de proyecto inválido.'); return;
            }

            // Load base image
            const base = new Image();
            base.onload = () => {
                baseImage = base;
                canvas.width = project.width || base.width;
                canvas.height = project.height || base.height;
                canvas.style.display = 'block';
                canvasPlaceholder.style.display = 'none';

                // Load canvas state (base + brush strokes)
                if (project.canvasState) {
                    const stateImg = new Image();
                    stateImg.onload = () => {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(stateImg, 0, 0);
                        textLayers = project.textLayers;
                        selectedTextIdx = -1;
                        undoStack = [];
                        redoStack = [];
                        resetZoom();

                        // Re-register custom fonts used in text layers
                        loadProjectFonts(textLayers);

                        redrawCanvas();
                        saveUndo();
                    };
                    stateImg.src = project.canvasState;
                } else {
                    ctx.drawImage(base, 0, 0);
                    textLayers = project.textLayers;
                    selectedTextIdx = -1;
                    undoStack = [];
                    redoStack = [];
                    resetZoom();
                    redrawCanvas();
                    saveUndo();
                }
            };
            base.src = project.baseImage;
        } catch (err) {
            alert('Error al cargar proyecto: ' + err.message);
        }
    };
    reader.readAsText(file);
    loadProjectInput.value = '';
});

function loadProjectFonts(layers) {
    const defaultFonts = ['Inter', 'Arial', 'Georgia', 'Verdana', 'Courier New', 'Rows of Sunflowers'];
    const needed = [...new Set(layers.map(t => t.fontFamily))].filter(f => !defaultFonts.includes(f));
    needed.forEach(fontName => {
        // Add to select if not present
        const exists = [...fontFamilySelect.options].some(o => o.value === fontName);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = fontName;
            opt.textContent = fontName + ' (proyecto)';
            fontFamilySelect.appendChild(opt);
        }
    });
}

// ===================== KEYBOARD SHORTCUTS =====================
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoBtn.click(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redoBtn.click(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveProjectBtn.click(); }
    if (e.key === 'Delete' && selectedTextIdx >= 0) {
        saveUndo();
        textLayers.splice(selectedTextIdx, 1);
        selectedTextIdx = -1;
        textInputPanel.style.display = 'none';
        redrawCanvas();
    }
});

// ===================== LOAD BUNDLED FONTS =====================
(async () => {
    try {
        const font = new FontFace('Rows of Sunflowers', "url('/editor/fonts/RowsOfSunflowers.ttf')");
        await font.load();
        document.fonts.add(font);
    } catch (err) {
        console.warn('No se pudo cargar Rows of Sunflowers:', err);
    }
})();

// ===================== INIT =====================
initDarkMode();
