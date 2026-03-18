// ===== Laser K40 Controller =====
// Communicates with a local WebSocket server at ws://localhost:7654
// Falls back to simulation mode when no server is found.

const WORK_W = 300; // K40 bed width  (mm)
const WORK_H = 200; // K40 bed height (mm)

const PRESETS = {
    plywood3:  { power: 60, speed: 120, passes: 1, mode: 'cut' },
    plywood6:  { power: 80, speed: 80,  passes: 2, mode: 'cut' },
    mdf3:      { power: 65, speed: 100, passes: 1, mode: 'cut' },
    mdf6:      { power: 80, speed: 70,  passes: 2, mode: 'cut' },
    acrylic3:  { power: 55, speed: 150, passes: 1, mode: 'cut' },
    acrylic5:  { power: 75, speed: 100, passes: 1, mode: 'cut' },
    leather:   { power: 35, speed: 300, passes: 1, mode: 'engrave' },
    paper:     { power: 20, speed: 400, passes: 1, mode: 'cut' },
    rubber:    { power: 40, speed: 200, passes: 1, mode: 'engrave' },
    foam:      { power: 25, speed: 350, passes: 1, mode: 'cut' },
};

const state = {
    connected:    false,
    simMode:      false,
    jobRunning:   false,
    jobPaused:    false,
    posX: 0, posY: 0,
    mode:    'engrave',
    power:   50,
    speed:   3,
    passes:  1,
    pulse:   50,
    jogStep: 1,
    zoom:    1,
    loadedFile:  null,
    loadedImage: null,
    imageType:   null,
    ws:          null,
    jobInterval: null,
    jobStart:    null,
};

// --- DOM refs ---
const $  = id => document.getElementById(id);
const machineStatus = $('machineStatus');
const statusTextEl  = $('statusText');
const connectBtn    = $('connectBtn');
const dropZone      = $('dropZone');
const fileInput     = $('fileInput');
const fileInfo      = $('fileInfo');
const fileNameEl    = $('fileName');
const removeFileBtn = $('removeFileBtn');
const speedSlider   = $('speedSlider');
const passesSlider  = $('passesSlider');
const pulseSlider   = $('pulseSlider');
const materialSel   = $('materialSelect');
const posXEl        = $('posX');
const posYEl        = $('posY');
const frameBtn      = $('frameBtn');
const startBtn      = $('startBtn');
const pauseBtn      = $('pauseBtn');
const stopBtn       = $('stopBtn');
const estopBtn      = $('estopBtn');
const laserTestBtn  = $('laserTestBtn');
const canvas        = $('laserCanvas');
const canvasWrapper = $('canvasWrapper');
const laserDot      = $('laserDot');
const zoomDisplay   = $('zoomDisplay');
const jobStatusText = $('jobStatusText');
const jobTimeText   = $('jobTimeText');
const progressFill  = $('progressFill');
const progressPct   = $('progressPct');
const consoleOutput = $('consoleOutput');
const ctx = canvas.getContext('2d');

let canvasW = 0;
let canvasH = 0;

// ===== CANVAS =====
function setupCanvas() {
    const wrapper = canvasWrapper;
    const maxW = wrapper.clientWidth  * 0.88;
    const maxH = wrapper.clientHeight * 0.88;
    const aspect = WORK_W / WORK_H;

    let w = maxW;
    let h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }

    canvasW = w;
    canvasH = h;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    drawCanvas();
}

// Click en canvas para seleccionar/deseleccionar el diseño
canvas.addEventListener('click', (e) => {
    if (!state.designBox) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasW / rect.width;
    const scaleY = canvasH / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const b = state.designBox;
    if (cx >= b.dx && cx <= b.dx + b.dw && cy >= b.dy && cy <= b.dy + b.dh) {
        state.designSelected = true;
    } else {
        state.designSelected = false;
    }
    drawCanvas();
});

function drawCanvas() {
    const W = canvasW, H = canvasH;
    ctx.clearRect(0, 0, W, H);

    // Bed background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    // Grid (10mm intervals)
    const gx = W / (WORK_W / 10);
    const gy = H / (WORK_H / 10);
    ctx.strokeStyle = 'rgba(88,166,255,0.07)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x += gx) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y <= H; y += gy) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // 50mm major grid
    const mx = W / (WORK_W / 50);
    const my = H / (WORK_H / 50);
    ctx.strokeStyle = 'rgba(88,166,255,0.15)';
    for (let x = 0; x <= W; x += mx) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y <= H; y += my) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Bed border
    ctx.strokeStyle = 'rgba(88,166,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W-1, H-1);

    // Corner marks
    const m = 9;
    ctx.strokeStyle = 'rgba(88,166,255,0.7)';
    ctx.lineWidth = 1.5;
    [[0,0,m,0,0,m],[W,0,-m,0,0,m],[0,H,m,0,0,-m],[W,H,-m,0,0,-m]].forEach(([x,y,dx1,dy1,dx2,dy2]) => {
        ctx.beginPath(); ctx.moveTo(x+dx1,y+dy1); ctx.lineTo(x,y); ctx.lineTo(x+dx2,y+dy2); ctx.stroke();
    });

    // Ruler labels (mm)
    ctx.fillStyle = 'rgba(139,148,158,0.55)';
    ctx.font = '6px JetBrains Mono, monospace';
    for (let mm = 50; mm < WORK_W; mm += 50) {
        const x = (mm / WORK_W) * W;
        ctx.fillText(mm, x + 2, 8);
    }
    for (let mm = 50; mm < WORK_H; mm += 50) {
        const y = (mm / WORK_H) * H;
        ctx.fillText(mm, 2, y - 2);
    }

    // Loaded design
    if (state.loadedImage) {
        const img = state.loadedImage;
        let dw, dh, dx, dy;
        let mmW, mmH;

        if (state.imageType === 'svg') {
            // Leer dimensiones reales del SVG
            if (state.svgText) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(state.svgText, 'image/svg+xml');
                const svg = doc.querySelector('svg');
                const vb = svg && svg.getAttribute('viewBox');
                let svgW, svgH;
                if (vb) {
                    const p = vb.split(/[\s,]+/).map(Number);
                    svgW = p[2]; svgH = p[3];
                } else {
                    svgW = parseFloat(svg?.getAttribute('width'))  || WORK_W;
                    svgH = parseFloat(svg?.getAttribute('height')) || WORK_H;
                }
                const fitScale = Math.min(WORK_W / svgW, WORK_H / svgH);
                mmW = svgW * fitScale;
                mmH = svgH * fitScale;
            } else {
                mmW = WORK_W; mmH = WORK_H;
            }
            dw = (mmW / WORK_W) * W;
            dh = (mmH / WORK_H) * H;
            dx = 0; dy = 0;
        } else {
            const imgW = img.naturalWidth || img.width;
            const imgH = img.naturalHeight || img.height;
            const fitScale = Math.min(WORK_W / imgW, WORK_H / imgH, 1);
            mmW = imgW * fitScale;
            mmH = imgH * fitScale;
            dw = (mmW / WORK_W) * W;
            dh = (mmH / WORK_H) * H;
            dx = (W - dw) / 2;
            dy = (H - dh) / 2;
        }

        // Guardar bounding box para selección y frame
        state.designBox = { dx, dy, dw, dh, mmW, mmH, mmX: (dx / W) * WORK_W, mmY: (dy / H) * WORK_H };

        ctx.save();
        if (state.mode === 'cut') {
            ctx.globalAlpha = 0.55;
            ctx.filter = 'grayscale(100%)';
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(dx, dy, dw, dh);
            ctx.setLineDash([]);
        } else {
            ctx.globalAlpha = 0.75;
            ctx.filter = 'grayscale(80%) contrast(1.2)';
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
        }

        // Selección: borde azul + dimensiones
        if (state.designSelected) {
            // Borde de selección
            ctx.strokeStyle = '#58a6ff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 3]);
            ctx.strokeRect(dx - 1, dy - 1, dw + 2, dh + 2);
            ctx.setLineDash([]);

            // Handles (esquinas)
            const hs = 4;
            ctx.fillStyle = '#58a6ff';
            for (const [hx, hy] of [[dx,dy],[dx+dw,dy],[dx,dy+dh],[dx+dw,dy+dh]]) {
                ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
            }

            // Dimensión horizontal (arriba)
            const labelW = `${mmW.toFixed(1)} mm`;
            const labelH = `${mmH.toFixed(1)} mm`;
            ctx.font = 'bold 10px JetBrains Mono, monospace';
            ctx.fillStyle = '#58a6ff';
            ctx.textAlign = 'center';
            ctx.fillText(labelW, dx + dw / 2, dy - 8);

            // Dimensión vertical (izquierda)
            ctx.save();
            ctx.translate(dx - 8, dy + dh / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(labelH, 0, 0);
            ctx.restore();
            ctx.textAlign = 'start';
        }
    } else {
        state.designBox = null;
    }

    // Origin marker
    ctx.fillStyle = '#3fb950';
    ctx.beginPath(); ctx.arc(5, 5, 3, 0, Math.PI * 2); ctx.fill();
}

// ===== FILE HANDLING =====
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => e.target.files[0] && loadFile(e.target.files[0]));

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]);
});

removeFileBtn.addEventListener('click', removeFile);

function loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['svg','png','jpg','jpeg','bmp'].includes(ext)) {
        log(`Formato no soportado: .${ext}`, 'error');
        return;
    }

    const reader = new FileReader();

    if (ext === 'svg') {
        reader.onload = e => {
            state.svgText = e.target.result; // guardar SVG raw para extracción de paths
            const blob = new Blob([e.target.result], { type: 'image/svg+xml' });
            const url  = URL.createObjectURL(blob);
            const img  = new Image();
            img.onload = () => {
                state.loadedImage = img;
                state.imageType   = 'svg';
                state.loadedFile  = file;
                setFileLoaded(file.name);
                URL.revokeObjectURL(url);
                drawCanvas();
                updateControls();
                state.designSelected = true;
                log(`SVG cargado: ${file.name}`, 'success');
            };
            img.onerror = () => log('Error al cargar SVG.', 'error');
            img.src = url;
        };
        reader.readAsText(file);
    } else {
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                state.loadedImage = img;
                state.imageType   = 'raster';
                state.loadedFile  = file;
                setFileLoaded(file.name);
                drawCanvas();
                updateControls();
                state.designSelected = true;
                log(`Imagen cargada: ${file.name} (${img.width}×${img.height}px)`, 'success');
            };
            img.onerror = () => log('Error al cargar imagen.', 'error');
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

function setFileLoaded(name) {
    fileNameEl.textContent = name;
    fileInfo.style.display = 'flex';
    dropZone.style.display = 'none';
}

function removeFile() {
    state.loadedFile  = null;
    state.loadedImage = null;
    state.imageType   = null;
    state.designSelected = false;
    state.designBox = null;
    fileInfo.style.display = 'none';
    dropZone.style.display = 'block';
    fileInput.value = '';
    drawCanvas();
    updateControls();
    log('Diseño eliminado.', 'warning');
}

// ===== PARAMETERS =====
function bindSlider(slider, labelId, key, fmt) {
    const label = $(labelId);
    slider.addEventListener('input', () => {
        state[key] = +slider.value;
        label.textContent = fmt(+slider.value);
        drawCanvas();
    });
}

bindSlider(speedSlider,  'speedLabel',  'speed',  v => `${v} mm/s`);
bindSlider(passesSlider, 'passesLabel', 'passes', v => `${v}×`);
bindSlider(pulseSlider,  'pulseLabel',  'pulse',  v => `${v}ms`);

document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
        drawCanvas();
    });
});

materialSel.addEventListener('change', () => {
    const p = PRESETS[materialSel.value];
    if (!p) return;

    state.power = p.power;
    const speedMms = Math.round(p.speed / 60);
    speedSlider.value  = speedMms;  state.speed  = speedMms;  $('speedLabel').textContent  = `${speedMms} mm/s`;
    passesSlider.value = p.passes;  state.passes = p.passes;  $('passesLabel').textContent = `${p.passes}×`;

    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === p.mode));
    state.mode = p.mode;

    log(`Preset: ${materialSel.options[materialSel.selectedIndex].text} — ${speedMms}mm/s`, 'info');
    drawCanvas();
});

// ===== CONNECTION =====
connectBtn.addEventListener('click', () => {
    if (state.connected || state.simMode) disconnect();
    else tryConnect();
});

function tryConnect() {
    log('Buscando servidor láser en localhost:7654...', 'cmd');
    connectBtn.disabled = true;
    statusTextEl.textContent = 'Conectando...';

    try {
        const ws = new WebSocket('ws://localhost:7654');
        state.ws = ws;

        const timer = setTimeout(() => { ws.close(); enterSimMode(); }, 3000);

        ws.onopen = () => {
            clearTimeout(timer);
            // Esperar confirmación USB del servidor antes de marcar como conectado
            setStatus('', 'Conectando USB...');
            connectBtn.disabled = false;
        };

        ws.onclose = () => { if (state.connected) disconnect(); };
        ws.onerror = () => { clearTimeout(timer); ws.close(); enterSimMode(); };
        ws.onmessage = e => handleMessage(JSON.parse(e.data));

    } catch (_) { enterSimMode(); }
}

function enterSimMode() {
    state.simMode  = true;
    state.connected = false;
    setStatus('sim-mode', 'Simulación');
    connectBtn.textContent = 'Desconectar';
    connectBtn.className   = 'btn-connect sim';
    connectBtn.disabled    = false;
    laserTestBtn.disabled  = false;
    setJogEnabled(true);
    updateControls();
    log('Sin servidor. Modo simulación activo.', 'warning');
    log('Para K40 real: ejecuta el servidor en localhost:7654', 'cmd');
}

function disconnect() {
    if (state.ws) { state.ws.close(); state.ws = null; }
    if (state.jobRunning) stopJob(false);
    state.connected = false;
    state.simMode   = false;
    setStatus('', 'Desconectado');
    connectBtn.textContent = 'Conectar';
    connectBtn.className   = 'btn-connect';
    laserTestBtn.disabled  = true;
    setJogEnabled(false);
    updateControls();
    log('Desconectado.', 'warning');
}

function setStatus(cls, text) {
    machineStatus.className = 'machine-status ' + cls;
    statusTextEl.textContent = text;
}

function handleMessage(msg) {
    if (msg.type === 'position') {
        state.posX = msg.x; state.posY = msg.y;
        updatePosDisplay();
        moveLaserDot(msg.x, msg.y);
    } else if (msg.type === 'progress') {
        setProgress(msg.pct);
    } else if (msg.type === 'machine_ready') {
        if (msg.ok) {
            state.connected = true;
            setStatus('connected', 'K40 Conectado');
            connectBtn.textContent = 'Desconectar';
            connectBtn.className   = 'btn-connect active';
            laserTestBtn.disabled  = false;
            setJogEnabled(true);
            updateControls();
        } else {
            // USB falló → entrar en simulación
            log(`USB Error: ${msg.error}`, 'error');
            enterSimMode();
        }
    } else if (msg.type === 'status') {
        log(msg.text, msg.level || 'cmd');
    } else if (msg.type === 'done') {
        finishJob();
    }
}

// ===== JOG =====
function setJogEnabled(on) {
    document.querySelectorAll('.jog-btn').forEach(b =>
        b.classList.toggle('disabled-state', !on)
    );
}

const JOG_MAP = {
    jogUp: [0,-1], jogDown: [0,1], jogLeft: [-1,0], jogRight: [1,0],
    jogUpLeft: [-1,-1], jogUpRight: [1,-1], jogDownLeft: [-1,1], jogDownRight: [1,1],
};

document.querySelectorAll('.jog-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!state.connected && !state.simMode) return;
        if (btn.id === 'jogHome') {
            state.posX = 0; state.posY = 0;
            updatePosDisplay();
            if (state.ws) sendWs({ cmd: 'home' });
            if (state.simMode) flashDot(0, 0);
            log('Origen (0,0)', 'cmd');
            return;
        }
        const dir = JOG_MAP[btn.id];
        if (!dir) return;
        const s = state.jogStep;
        state.posX = clamp(state.posX + dir[0] * s, 0, WORK_W);
        state.posY = clamp(state.posY + dir[1] * s, 0, WORK_H);
        updatePosDisplay();
        if (state.ws) sendWs({ cmd: 'jog', dx: dir[0] * s, dy: dir[1] * s });
        if (state.simMode || state.connected) flashDot(state.posX, state.posY);
    });
});

document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.step-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.jogStep = +btn.dataset.step;
    });
});

// ===== JOB CONTROLS =====
function updateControls() {
    const active = state.connected || state.simMode;
    const hasFile = !!state.loadedFile;
    frameBtn.disabled = !(active && hasFile);
    startBtn.disabled = !(active && hasFile) || state.jobRunning;
    pauseBtn.disabled = !state.jobRunning;
    stopBtn.disabled  = !state.jobRunning;
}

frameBtn.addEventListener('click', () => {
    log('Ejecutando frame de prueba...', 'cmd');
    if (state.ws) sendWs({ cmd: 'frame' });
    else simFrame();
});

startBtn.addEventListener('click', startJob);
pauseBtn.addEventListener('click', togglePause);
stopBtn.addEventListener('click', () => stopJob(true));

estopBtn.addEventListener('click', () => {
    sendWs({ cmd: 'estop' });
    stopJob(false);
    log('¡PARO DE EMERGENCIA!', 'error');
});

laserTestBtn.addEventListener('click', () => {
    const ms = state.pulse;
    log(`Pulso de prueba: ${ms}ms @ ${state.power}%`, 'warning');
    if (state.ws) sendWs({ cmd: 'pulse', ms, power: state.power });
    else { flashDot(state.posX, state.posY, ms); }
});

// ===== SVG PATH EXTRACTION =====
function extractSVGSegments(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return [];

    // Determinar escala: SVG coords → mm en el área de trabajo
    const vb = svg.getAttribute('viewBox');
    let svgW, svgH;
    if (vb) {
        const parts = vb.split(/[\s,]+/).map(Number);
        svgW = parts[2]; svgH = parts[3];
    } else {
        svgW = parseFloat(svg.getAttribute('width'))  || WORK_W;
        svgH = parseFloat(svg.getAttribute('height')) || WORK_H;
    }

    // Escalar para que quepa en el área de trabajo manteniendo proporción
    const scale = Math.min(WORK_W / svgW, WORK_H / svgH);

    // Insertar en DOM oculto para usar getPointAtLength
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden';
    container.innerHTML = svgText;
    document.body.appendChild(container);
    const liveSvg = container.querySelector('svg');

    const segments = [];
    const shapes = liveSvg.querySelectorAll('path, line, rect, circle, ellipse, polyline, polygon');

    for (const el of shapes) {
        const points = [];
        if (el.getTotalLength) {
            const len = el.getTotalLength();
            const step = Math.max(0.5, len / 500); // máx 500 puntos por shape
            for (let d = 0; d <= len; d += step) {
                const p = el.getPointAtLength(d);
                points.push({ x: p.x * scale, y: p.y * scale });
            }
            // Punto final exacto
            const pEnd = el.getPointAtLength(len);
            points.push({ x: pEnd.x * scale, y: pEnd.y * scale });
        }
        if (points.length >= 2) {
            const closed = el.tagName === 'polygon' || el.tagName === 'rect' ||
                           el.tagName === 'circle' || el.tagName === 'ellipse' ||
                           (el.tagName === 'path' && /[zZ]\s*$/.test(el.getAttribute('d') || ''));
            segments.push({ points, closed });
        }
    }

    document.body.removeChild(container);
    return segments;
}

// ===== RASTER BITMAP EXTRACTION =====
function extractRasterBitmap(image) {
    // Determinar tamaño en el canvas del bed
    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;
    const scaleToFit = Math.min(WORK_W / imgW, WORK_H / imgH, 1);
    const mmW = imgW * scaleToFit;
    const mmH = imgH * scaleToFit;

    // Resolución: 1000 DPI = 39.37 px/mm
    const DPI = 39.37;
    const pxW = Math.round(mmW * DPI);
    const pxH = Math.round(mmH * DPI);

    // Renderizar a canvas offscreen en escala de grises
    const offCanvas = document.createElement('canvas');
    offCanvas.width = pxW;
    offCanvas.height = pxH;
    const ctx = offCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pxW, pxH);
    ctx.drawImage(image, 0, 0, pxW, pxH);

    const imageData = ctx.getImageData(0, 0, pxW, pxH);
    const pixels = imageData.data;

    // Convertir a escala de grises y aplicar threshold
    const gray = new Uint8Array(pxW * pxH);
    for (let i = 0; i < pxW * pxH; i++) {
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    // Floyd-Steinberg dithering → 1 bit
    for (let y = 0; y < pxH; y++) {
        for (let x = 0; x < pxW; x++) {
            const idx = y * pxW + x;
            const old = gray[idx];
            const nw = old < 128 ? 0 : 255;
            gray[idx] = nw;
            const err = old - nw;
            if (x + 1 < pxW)               gray[idx + 1]        += err * 7 / 16;
            if (y + 1 < pxH && x > 0)      gray[(y+1)*pxW+x-1]  += err * 3 / 16;
            if (y + 1 < pxH)               gray[(y+1)*pxW+x]    += err * 5 / 16;
            if (y + 1 < pxH && x + 1 < pxW) gray[(y+1)*pxW+x+1] += err * 1 / 16;
        }
    }

    // Pack a 1 bit por pixel (MSB first), pixel oscuro = 1 (láser ON)
    const rowBytes = Math.ceil(pxW / 8);
    const bitmap = new Uint8Array(rowBytes * pxH);
    for (let y = 0; y < pxH; y++) {
        for (let x = 0; x < pxW; x++) {
            if (gray[y * pxW + x] === 0) { // oscuro = láser ON
                const byteIdx = y * rowBytes + Math.floor(x / 8);
                bitmap[byteIdx] |= (1 << (7 - (x % 8)));
            }
        }
    }

    return { bitmap, width: pxW, height: pxH, step: 1, offsetX: 0, offsetY: 0, mmW, mmH };
}

function startJob() {
    if (!state.loadedFile) { log('No hay archivo cargado.', 'error'); return; }

    state.jobRunning = true;
    state.jobPaused  = false;
    state.jobStart   = Date.now();
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled  = false;
    frameBtn.disabled = true;
    jobStatusText.textContent = `Procesando: ${state.loadedFile.name}`;
    const modeStr = state.mode === 'cut' ? 'Corte' : 'Grabado';
    log(`Iniciando trabajo: ${modeStr} @ ${state.speed}mm/s × ${state.passes}`, 'success');

    if (!state.ws) { simJob(); return; }

    if (state.mode === 'cut' && state.imageType === 'svg' && state.svgText) {
        // Vector cutting
        const segments = extractSVGSegments(state.svgText);
        if (segments.length === 0) {
            log('No se encontraron trazos en el SVG.', 'error');
            stopJob(false);
            return;
        }
        log(`Vector: ${segments.length} segmentos extraídos`, 'info');
        sendWs({ cmd: 'start', mode: 'cut', speed: state.speed, passes: state.passes, segments });
    } else {
        // Raster engraving (BMP/PNG/SVG → bitmap)
        const rasterData = extractRasterBitmap(state.loadedImage);
        log(`Raster: ${rasterData.width}×${rasterData.height}px, ${rasterData.bitmap.byteLength} bytes`, 'info');
        sendWs({
            cmd: 'start', mode: 'engrave', speed: state.speed, passes: state.passes,
            raster: { width: rasterData.width, height: rasterData.height, step: rasterData.step,
                      offsetX: rasterData.offsetX, offsetY: rasterData.offsetY }
        });
        // Enviar bitmap como binary
        state.ws.send(rasterData.bitmap.buffer);
    }
}

function togglePause() {
    state.jobPaused = !state.jobPaused;
    if (state.jobPaused) {
        pauseBtn.innerHTML = '<i class="fas fa-play"></i><span>Reanudar</span>';
        pauseBtn.style.cssText = 'border-color:var(--green);color:var(--green);background:rgba(63,185,80,.1)';
        log('Pausado.', 'warning');
        if (state.ws) sendWs({ cmd: 'pause' });
    } else {
        pauseBtn.innerHTML = '<i class="fas fa-pause"></i><span>Pausar</span>';
        pauseBtn.style.cssText = '';
        log('Reanudado.', 'success');
        if (state.ws) sendWs({ cmd: 'resume' });
    }
}

function stopJob(log_it = true) {
    if (state.jobInterval) { clearInterval(state.jobInterval); state.jobInterval = null; }
    state.jobRunning = false;
    state.jobPaused  = false;
    laserDot.style.display = 'none';
    pauseBtn.innerHTML = '<i class="fas fa-pause"></i><span>Pausar</span>';
    pauseBtn.style.cssText = '';
    setProgress(0);
    jobStatusText.textContent = 'Sin trabajo activo';
    jobTimeText.textContent   = '';
    updateControls();
    if (log_it) log('Trabajo detenido.', 'warning');
    if (state.ws) sendWs({ cmd: 'stop' });
}

function finishJob() {
    if (state.jobInterval) { clearInterval(state.jobInterval); state.jobInterval = null; }
    state.jobRunning = false;
    laserDot.style.display = 'none';
    setProgress(100);
    const secs = Math.round((Date.now() - state.jobStart) / 1000);
    jobStatusText.textContent = 'Trabajo completado';
    log(`¡Completado en ${fmtTime(secs)}!`, 'success');
    pauseBtn.innerHTML = '<i class="fas fa-pause"></i><span>Pausar</span>';
    pauseBtn.style.cssText = '';
    updateControls();
}

// ===== SIMULATION =====
function simFrame() {
    const r = canvasRect();
    laserDot.style.display = 'block';
    const corners = [
        [r.l,         r.t        ],
        [r.l + r.w,   r.t        ],
        [r.l + r.w,   r.t + r.h  ],
        [r.l,         r.t + r.h  ],
        [r.l,         r.t        ],
    ];
    let i = 0;
    const go = () => {
        if (i >= corners.length) { laserDot.style.display = 'none'; log('Frame completo.', 'success'); return; }
        laserDot.style.left = corners[i][0] + 'px';
        laserDot.style.top  = corners[i][1] + 'px';
        i++;
        setTimeout(go, 380);
    };
    go();
}

function simJob() {
    const speedFactor = 400 / state.speed;
    const totalMs = 9000 * speedFactor * state.passes;
    const t0 = Date.now();
    laserDot.style.display = 'block';
    log('Simulando trabajo...', 'cmd');

    const LINES = 38;
    state.jobInterval = setInterval(() => {
        if (state.jobPaused) return;
        const elapsed  = Date.now() - t0;
        const progress = Math.min(100, (elapsed / totalMs) * 100);

        setProgress(progress);

        const r = canvasRect();
        const lineIdx  = Math.floor((progress / 100) * LINES);
        const lineFrac = ((progress / 100) * LINES) % 1;
        const even = lineIdx % 2 === 0;
        const dotX = r.l + (even ? lineFrac : 1 - lineFrac) * r.w;
        const dotY = r.t + (lineIdx / LINES) * r.h;
        laserDot.style.left = dotX + 'px';
        laserDot.style.top  = dotY + 'px';

        state.posX = clamp(((dotX - r.l) / r.w) * WORK_W, 0, WORK_W);
        state.posY = clamp(((dotY - r.t) / r.h) * WORK_H, 0, WORK_H);
        updatePosDisplay();

        jobTimeText.textContent = fmtTime(Math.round((Date.now() - state.jobStart) / 1000));

        if (progress >= 100) { clearInterval(state.jobInterval); finishJob(); }
    }, 50);
}

// ===== ZOOM =====
document.getElementById('toolZoomIn').addEventListener('click',  () => applyZoom(state.zoom * 1.25));
document.getElementById('toolZoomOut').addEventListener('click', () => applyZoom(state.zoom * 0.8));
document.getElementById('toolFit').addEventListener('click',     () => { state.zoom = 1; setupCanvas(); zoomDisplay.textContent = '100%'; });

canvasWrapper.addEventListener('wheel', e => {
    e.preventDefault();
    applyZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 0.91));
}, { passive: false });

function applyZoom(z) {
    state.zoom = clamp(z, 0.3, 5);
    const w = canvasW * state.zoom;
    const h = canvasH * state.zoom;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
}

// ===== UTILS =====
function canvasRect() {
    const cr = canvas.getBoundingClientRect();
    const wr = canvasWrapper.getBoundingClientRect();
    return { l: cr.left - wr.left, t: cr.top - wr.top, w: cr.width, h: cr.height };
}

function moveLaserDot(x, y) {
    const r = canvasRect();
    laserDot.style.display = 'block';
    laserDot.style.left = (r.l + (x / WORK_W) * r.w) + 'px';
    laserDot.style.top  = (r.t + (y / WORK_H) * r.h) + 'px';
}

function flashDot(x, y, ms = 800) {
    moveLaserDot(x, y);
    clearTimeout(window._dotTimer);
    window._dotTimer = setTimeout(() => { if (!state.jobRunning) laserDot.style.display = 'none'; }, ms);
}

function updatePosDisplay() {
    posXEl.textContent = state.posX.toFixed(1);
    posYEl.textContent = state.posY.toFixed(1);
}

function setProgress(pct) {
    progressFill.style.width = pct + '%';
    progressPct.textContent  = Math.round(pct) + '%';
}

function sendWs(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(data));
}

function log(msg, type = 'cmd') {
    const t    = new Date().toLocaleTimeString('es-MX', { hour12: false });
    const pre  = { info:'[INFO]', success:'[OK]  ', warning:'[WARN]', error:'[ERR!]', cmd:'[SYS] ' }[type] || '[SYS] ';
    const line = document.createElement('div');
    line.className   = `log ${type}`;
    line.textContent = `${t} ${pre} ${msg}`;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function fmtTime(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

$('clearConsoleBtn').addEventListener('click', () => { consoleOutput.innerHTML = ''; });

window.addEventListener('resize', setupCanvas);
setupCanvas();
updateControls();
setJogEnabled(false);
