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
const toggleRefAreaBtn = document.getElementById('toggle-ref-area');
const clearRefAreaBtn = document.getElementById('clear-ref-area');
const refAreaOverlay = document.getElementById('ref-area-overlay');
let isDrawingRefArea = false;

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
        // Restore sidebar state
        if (localStorage.getItem('ps-sidebar-open') === 'true' && window.innerWidth > 768) {
            openSidebar();
        }
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
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
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

// ===================== RANGE ↔ NUMBER SYNC =====================
function linkRangeAndNumber(range, num, onChange) {
    range.addEventListener('input', () => {
        num.value = range.value;
        onChange(parseFloat(range.value));
    });
    num.addEventListener('input', () => {
        range.value = num.value;
        onChange(parseFloat(num.value));
    });
}

// ===================== BRUSH CONTROLS =====================
linkRangeAndNumber(brushSizeInput, brushSizeVal, (v) => { brushSize = v; });

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
linkRangeAndNumber(fontSizeInput, fontSizeVal, (v) => {
    if (selectedTextIdx >= 0) { textLayers[selectedTextIdx].fontSize = v; redrawCanvas(); }
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
        if (textLayers[selectedTextIdx].refArea) {
            fitTextToRefArea(textLayers[selectedTextIdx]);
            fontSizeInput.value = textLayers[selectedTextIdx].fontSize;
            fontSizeVal.value = textLayers[selectedTextIdx].fontSize;
        }
        redrawCanvas();
    }
});

linkRangeAndNumber(glowStrengthInput, glowVal, (v) => {
    if (selectedTextIdx >= 0) { textLayers[selectedTextIdx].glowStrength = v; redrawCanvas(); }
});

glowColorInput.addEventListener('input', () => {
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].glowColor = glowColorInput.value;
        redrawCanvas();
    }
});

linkRangeAndNumber(strokeWidthInput, strokeWidthVal, (v) => {
    if (selectedTextIdx >= 0) { textLayers[selectedTextIdx].strokeWidth = v; redrawCanvas(); }
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

linkRangeAndNumber(textQualityInput, textQualityVal, (v) => {
    if (selectedTextIdx >= 0) { textLayers[selectedTextIdx].quality = v; redrawCanvas(); }
});

textContent.addEventListener('input', () => {
    if (selectedTextIdx >= 0) {
        textLayers[selectedTextIdx].text = textContent.value;
        if (textLayers[selectedTextIdx].refArea) {
            fitTextToRefArea(textLayers[selectedTextIdx]);
            fontSizeInput.value = textLayers[selectedTextIdx].fontSize;
            fontSizeVal.value = textLayers[selectedTextIdx].fontSize;
        }
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
                fontSizeVal.value = t.fontSize;
                fontColorInput.value = t.color;
                glowStrengthInput.value = t.glowStrength;
                glowVal.value = t.glowStrength;
                glowColorInput.value = t.glowColor;
                strokeWidthInput.value = t.strokeWidth || 0;
                strokeWidthVal.value = t.strokeWidth || 0;
                strokeColorInput.value = t.strokeColor || '#0066ff';
                strokeDirSelect.value = t.strokeDir || 'center';
                const ta = t.textAlign || 'left';
                alignLeftBtn.classList.toggle('active', ta === 'left');
                alignCenterBtn.classList.toggle('active', ta === 'center');
                alignRightBtn.classList.toggle('active', ta === 'right');
                textQualityInput.value = t.quality || 1;
                textQualityVal.value = t.quality || 1;
                textInputPanel.style.display = 'block';
                updateRefAreaUI();
                redrawCanvas();
                return;
            }
        }
        selectedTextIdx = -1;
        textInputPanel.style.display = 'none';
        updateRefAreaUI();
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
        const t = textLayers[selectedTextIdx];
        const dx = (pos.x - dragOffset.x) - t.x;
        const dy = (pos.y - dragOffset.y) - t.y;
        t.x += dx;
        t.y += dy;
        if (t.refArea) {
            t.refArea.x += dx;
            t.refArea.y += dy;
        }
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

    // Draw ref areas (only for selected text, or all in edit view)
    for (let i = 0; i < textLayers.length; i++) {
        if (i === selectedTextIdx) drawRefArea(textLayers[i]);
    }

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
    const steps = 8;
    const stepAlpha = 0.18;

    if (dir === 'center') {
        // Draw from outer (large lineWidth, 1 layer) to inner (small, many layers)
        // Natural overlap accumulation creates the gradient
        for (let i = steps; i >= 1; i--) {
            c.globalAlpha = stepAlpha;
            c.strokeStyle = sColor;
            c.lineWidth = sw * (i / steps);
            c.lineJoin = 'round';
            c.strokeText(t.text, tx, ty);
        }
        c.globalAlpha = 1;
    } else {
        // Draw from farthest offset to closest — overlap builds opacity near text
        for (let i = steps; i >= 1; i--) {
            const frac = i / steps;
            const [dx, dy] = getStrokeDirOffset(dir, sw * frac);
            c.globalAlpha = stepAlpha;
            c.fillStyle = sColor;
            c.fillText(t.text, tx + dx, ty + dy);
        }
        c.globalAlpha = 1;
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
        if (textLayers[0].refArea) fitTextToRefArea(textLayers[0]);
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
    if (textLayers[0].refArea) fitTextToRefArea(textLayers[0]);
    redrawCanvas();

    batchExportBtn.disabled = false;
    batchProgressEl.style.display = 'none';
});

// ===================== FIREBASE DB & STORAGE =====================
const db = firebase.firestore();
const storage = firebase.storage();
let currentProjectId = null;

// ===================== SAVE / LOAD PROJECT (FIREBASE) =====================
const saveProjectBtn = document.getElementById('save-project-btn');
const openProjectsBtn = document.getElementById('open-projects-btn');
const projectsSidebar = document.getElementById('projects-sidebar');
const projectsList = document.getElementById('projects-list');
const projectsEmpty = document.getElementById('projects-empty');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const sidebarOpenBtn = document.getElementById('sidebar-open-btn');
const sidebarScrim = document.getElementById('sidebar-scrim');

function showSaving(msg) {
    let el = document.getElementById('saving-indicator');
    if (!el) {
        el = document.createElement('div');
        el.id = 'saving-indicator';
        el.className = 'saving-indicator';
        document.body.appendChild(el);
    }
    el.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`;
    el.style.display = 'flex';
    return el;
}
function hideSaving() {
    const el = document.getElementById('saving-indicator');
    if (el) el.style.display = 'none';
}

function generateThumbnail() {
    const sel = selectedTextIdx;
    selectedTextIdx = -1;
    redrawCanvas();
    const tmp = document.createElement('canvas');
    const scale = 200 / canvas.width;
    tmp.width = 200;
    tmp.height = canvas.height * scale;
    tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
    selectedTextIdx = sel;
    redrawCanvas();
    return tmp.toDataURL('image/jpeg', 0.7);
}

async function uploadToStorage(dataUrl, path) {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const ref = storage.ref(path);
    await ref.put(blob);
    return await ref.getDownloadURL();
}

function getProjectName() {
    if (textLayers.length > 0 && textLayers[0].text) return textLayers[0].text;
    return 'Sin nombre';
}

function getCanvasStateWithoutText() {
    const sel = selectedTextIdx;
    selectedTextIdx = -1;
    const saved = [...textLayers];
    textLayers = [];
    redrawCanvas();
    const data = canvas.toDataURL('image/png');
    textLayers = saved;
    selectedTextIdx = sel;
    redrawCanvas();
    return data;
}

saveProjectBtn.addEventListener('click', async () => {
    if (!baseImage) { alert('No hay proyecto para guardar.'); return; }
    const indicator = showSaving('Guardando...');
    try {
        const ts = Date.now();
        const canvasState = getCanvasStateWithoutText();
        const thumbnail = generateThumbnail();

        if (currentProjectId) {
            // Update existing
            const baseUrl = await uploadToStorage(baseImage.src, `ps_projects/${currentProjectId}/base_${ts}`);
            const stateUrl = await uploadToStorage(canvasState, `ps_projects/${currentProjectId}/state_${ts}`);
            await db.collection('ps_projects').doc(currentProjectId).update({
                name: getProjectName(),
                baseImage: baseUrl,
                canvasState: stateUrl,
                textLayers: JSON.stringify(textLayers),
                width: canvas.width,
                height: canvas.height,
                thumbnail,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
        } else {
            // New project
            const docRef = await db.collection('ps_projects').add({
                name: getProjectName(),
                textLayers: JSON.stringify(textLayers),
                width: canvas.width,
                height: canvas.height,
                thumbnail,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            currentProjectId = docRef.id;
            const baseUrl = await uploadToStorage(baseImage.src, `ps_projects/${currentProjectId}/base_${ts}`);
            const stateUrl = await uploadToStorage(canvasState, `ps_projects/${currentProjectId}/state_${ts}`);
            await docRef.update({ baseImage: baseUrl, canvasState: stateUrl });
        }
        indicator.innerHTML = '<i class="fas fa-check"></i> Guardado';
        setTimeout(hideSaving, 1500);
    } catch (err) {
        hideSaving();
        alert('Error al guardar: ' + err.message);
    }
});

// ===================== PROJECTS SIDEBAR =====================
function openSidebar() {
    projectsSidebar.classList.remove('collapsed');
    sidebarOpenBtn.classList.remove('visible');
    if (window.innerWidth <= 768) sidebarScrim.classList.add('visible');
    localStorage.setItem('ps-sidebar-open', 'true');
    loadProjectsList();
}
function closeSidebar() {
    projectsSidebar.classList.add('collapsed');
    sidebarOpenBtn.classList.add('visible');
    sidebarScrim.classList.remove('visible');
    localStorage.setItem('ps-sidebar-open', 'false');
}
openProjectsBtn.addEventListener('click', () => {
    if (!projectsSidebar.classList.contains('collapsed')) closeSidebar();
    else openSidebar();
});
closeSidebarBtn.addEventListener('click', closeSidebar);
sidebarOpenBtn.addEventListener('click', openSidebar);
sidebarScrim.addEventListener('click', closeSidebar);
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) sidebarScrim.classList.remove('visible');
});

async function loadProjectsList() {
    projectsList.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-3);padding:20px;"><i class="fas fa-spinner fa-spin"></i> Cargando...</p>';
    projectsEmpty.style.display = 'none';
    try {
        const snap = await db.collection('ps_projects').orderBy('updatedAt', 'desc').get();
        projectsList.innerHTML = '';
        if (snap.empty) {
            projectsEmpty.style.display = 'block';
            return;
        }
        snap.forEach(doc => {
            const p = doc.data();
            const card = document.createElement('div');
            card.className = 'project-card';
            const date = p.updatedAt ? p.updatedAt.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            card.innerHTML = `
                <img class="project-card-thumb" src="${p.thumbnail || ''}" alt="" onerror="this.style.display='none'">
                <div class="project-card-info">
                    <div class="project-card-name">${p.name || 'Sin nombre'}</div>
                    <div class="project-card-date">${date}</div>
                </div>
                <button class="project-card-delete" data-id="${doc.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
            `;
            card.addEventListener('click', (e) => {
                if (e.target.closest('.project-card-delete')) return;
                openProject(doc.id, p);
            });
            card.querySelector('.project-card-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteProject(doc.id);
            });
            projectsList.appendChild(card);
        });
    } catch (err) {
        projectsList.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--danger);padding:20px;">Error: ${err.message}</p>`;
    }
}

async function openProject(id, p) {
    if (window.innerWidth <= 768) closeSidebar();
    const indicator = showSaving('Cargando proyecto...');
    try {
        const base = new Image();
        base.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            base.onload = resolve;
            base.onerror = reject;
            base.src = p.canvasState || p.baseImage;
        });

        // Load base image separately for future saves
        const origBase = new Image();
        origBase.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            origBase.onload = resolve;
            origBase.onerror = reject;
            origBase.src = p.baseImage;
        });

        baseImage = origBase;
        canvas.width = p.width || base.width;
        canvas.height = p.height || base.height;
        canvas.style.display = 'block';
        canvasPlaceholder.style.display = 'none';

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(base, 0, 0);

        textLayers = JSON.parse(p.textLayers || '[]');
        selectedTextIdx = -1;
        undoStack = [];
        redoStack = [];
        currentProjectId = id;
        resetZoom();
        loadProjectFonts(textLayers);
        redrawCanvas();
        saveUndo();
        hideSaving();
    } catch (err) {
        hideSaving();
        alert('Error al cargar proyecto: ' + err.message);
    }
}

async function deleteProject(id) {
    if (!confirm('Eliminar este proyecto?')) return;
    try {
        await db.collection('ps_projects').doc(id).delete();
        if (currentProjectId === id) currentProjectId = null;
        loadProjectsList();
    } catch (err) {
        alert('Error al eliminar: ' + err.message);
    }
}

function loadProjectFonts(layers) {
    const defaultFonts = ['Inter', 'Arial', 'Georgia', 'Verdana', 'Courier New', 'Rows of Sunflowers'];
    const needed = [...new Set(layers.map(t => t.fontFamily))].filter(f => !defaultFonts.includes(f));
    needed.forEach(fontName => {
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

// ===================== REFERENCE AREA =====================
function fitTextToRefArea(t) {
    if (!t.refArea) return;
    const ra = t.refArea;
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = 1; tmpCanvas.height = 1;
    const tc = tmpCanvas.getContext('2d');

    // Binary search for max font size that fits within refArea
    let lo = 4, hi = 1000;
    for (let iter = 0; iter < 30; iter++) {
        const mid = (lo + hi) / 2;
        tc.font = `${mid}px "${t.fontFamily}"`;
        const m = tc.measureText(t.text);
        if (m.width <= ra.w && mid <= ra.h) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    t.fontSize = Math.max(4, Math.floor(lo * 10) / 10);

    // Center text in the ref area
    tc.font = `${t.fontSize}px "${t.fontFamily}"`;
    const finalW = tc.measureText(t.text).width;
    t.x = ra.x + ra.w / 2;
    t.y = ra.y + ra.h / 2 + t.fontSize * 0.35; // baseline adjust
    t.textAlign = 'center';
}

function drawRefArea(t) {
    if (!t.refArea) return;
    const ra = t.refArea;
    ctx.save();
    ctx.strokeStyle = '#4da6ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(ra.x, ra.y, ra.w, ra.h);
    ctx.fillStyle = 'rgba(77, 166, 255, 0.06)';
    ctx.fillRect(ra.x, ra.y, ra.w, ra.h);
    ctx.setLineDash([]);
    ctx.restore();
}

function updateRefAreaUI() {
    const hasRef = selectedTextIdx >= 0 && textLayers[selectedTextIdx] && textLayers[selectedTextIdx].refArea;
    clearRefAreaBtn.style.display = hasRef ? 'inline-flex' : 'none';
    toggleRefAreaBtn.classList.toggle('ref-active', hasRef);
}

// Enter ref area draw mode
toggleRefAreaBtn.addEventListener('click', () => {
    if (!baseImage) { alert('Sube una imagen primero.'); return; }
    refAreaOverlay.style.display = 'block';
    isDrawingRefArea = true;
});

clearRefAreaBtn.addEventListener('click', () => {
    if (selectedTextIdx >= 0) {
        saveUndo();
        textLayers[selectedTextIdx].refArea = null;
        updateRefAreaUI();
        redrawCanvas();
    }
});

// Ref area drawing on overlay
(function setupRefAreaDraw() {
    let startX, startY, drawRect;

    function screenToCanvas(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height),
        };
    }

    function canvasToOverlay(clientX, clientY) {
        const cRect = canvas.getBoundingClientRect();
        const oRect = refAreaOverlay.getBoundingClientRect();
        return {
            x: cRect.left - oRect.left + (clientX - cRect.left),
            y: cRect.top - oRect.top + (clientY - cRect.top),
        };
    }

    refAreaOverlay.addEventListener('mousedown', (e) => {
        if (!isDrawingRefArea) return;
        const startCanvas = screenToCanvas(e.clientX, e.clientY);
        startX = startCanvas.x;
        startY = startCanvas.y;
        const startOverlay = canvasToOverlay(e.clientX, e.clientY);

        drawRect = document.createElement('div');
        drawRect.style.cssText = 'position:absolute;border:2px dashed #4da6ff;background:rgba(77,166,255,0.1);pointer-events:none;';
        refAreaOverlay.appendChild(drawRect);

        function onMove(ev) {
            const cur = canvasToOverlay(ev.clientX, ev.clientY);
            const sx = Math.min(startOverlay.x, cur.x);
            const sy = Math.min(startOverlay.y, cur.y);
            const w = Math.abs(cur.x - startOverlay.x);
            const h = Math.abs(cur.y - startOverlay.y);
            drawRect.style.left = sx + 'px';
            drawRect.style.top = sy + 'px';
            drawRect.style.width = w + 'px';
            drawRect.style.height = h + 'px';
        }

        function onUp(ev) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (drawRect) drawRect.remove();

            const endCanvas = screenToCanvas(ev.clientX, ev.clientY);
            const x = Math.min(startX, endCanvas.x);
            const y = Math.min(startY, endCanvas.y);
            const w = Math.abs(endCanvas.x - startX);
            const h = Math.abs(endCanvas.y - startY);

            refAreaOverlay.style.display = 'none';
            isDrawingRefArea = false;

            if (w < 10 || h < 10) return; // too small, ignore

            saveUndo();
            if (selectedTextIdx < 0) {
                // Create a new text layer with this ref area
                const activeAlign = 'center';
                textLayers.push({
                    text: textContent.value.trim() || 'Nombre',
                    x: x + w / 2,
                    y: y + h / 2,
                    fontFamily: fontFamilySelect.value,
                    fontSize: 48,
                    color: fontColorInput.value,
                    glowStrength: parseFloat(glowStrengthInput.value),
                    glowColor: glowColorInput.value,
                    strokeWidth: parseFloat(strokeWidthInput.value),
                    strokeColor: strokeColorInput.value,
                    strokeDir: strokeDirSelect.value,
                    quality: parseFloat(textQualityInput.value),
                    textAlign: activeAlign,
                    refArea: { x, y, w, h },
                });
                selectedTextIdx = textLayers.length - 1;
            } else {
                textLayers[selectedTextIdx].refArea = { x, y, w, h };
            }
            fitTextToRefArea(textLayers[selectedTextIdx]);
            updateRefAreaUI();
            // Sync controls
            const t = textLayers[selectedTextIdx];
            textContent.value = t.text;
            fontSizeInput.value = t.fontSize;
            fontSizeVal.value = t.fontSize;
            textInputPanel.style.display = 'block';
            setTool('move');
            redrawCanvas();
            textContent.focus();
            textContent.select();
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Cancel on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isDrawingRefArea) {
            refAreaOverlay.style.display = 'none';
            isDrawingRefArea = false;
        }
    });
})();

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
