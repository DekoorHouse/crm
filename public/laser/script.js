document.addEventListener('DOMContentLoaded', () => {
    const API = window.API_BASE_URL || '';
    let ws = null;
    let jogStep = 1;
    let opMode = 'cut'; // 'cut' or 'raster'

    // Workspace dimensions (mm)
    const BED_W = 400;
    const BED_H = 400;
    const CANVAS_PX = 500; // canvas pixel size

    const previewCanvas = document.getElementById('preview-canvas');
    const previewCtx = previewCanvas.getContext('2d');
    const previewContainer = document.getElementById('preview-container');
    const previewInfo = document.getElementById('preview-info');
    let previewImage = null; // loaded image/svg for preview

    // --- DOM refs ---
    const connStatus = document.getElementById('conn-status');
    const statusDot = connStatus.querySelector('.status-dot');
    const statusText = connStatus.querySelector('.status-text');
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const loadedFile = document.getElementById('loaded-file');
    const loadedFilename = document.getElementById('loaded-filename');
    const btnClearFile = document.getElementById('btn-clear-file');
    const consoleOutput = document.getElementById('console-output');
    const consoleInput = document.getElementById('console-input');
    const btnSendCmd = document.getElementById('btn-send-cmd');
    const btnStart = document.getElementById('btn-start');
    const btnPause = document.getElementById('btn-pause');
    const btnStop = document.getElementById('btn-stop');
    const btnFrame = document.getElementById('btn-frame');
    const btnHome = document.getElementById('btn-home');
    const btnUnlock = document.getElementById('btn-unlock');

    // --- WebSocket connection ---
    function connectWS() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ws/laser`);

        ws.onopen = () => {
            updateStatus(true);
            logConsole('Conectado al servidor', 'ok');
        };

        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'output') {
                logConsole(data.text);
            } else if (data.type === 'status') {
                updateStatus(data.connected);
            }
        };

        ws.onclose = () => {
            updateStatus(false);
            logConsole('Desconectado del servidor', 'err');
            setTimeout(connectWS, 3000);
        };

        ws.onerror = () => {
            // onclose will fire after this
        };
    }

    function updateStatus(connected) {
        if (connected) {
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Conectado';
        } else {
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = 'Desconectado';
        }
    }

    // --- Console ---
    function logConsole(text, type = '') {
        const div = document.createElement('div');
        if (type) div.className = `line-${type}`;
        div.textContent = text;
        consoleOutput.appendChild(div);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    function sendCommand(cmd) {
        if (!cmd) return;
        logConsole(`>> ${cmd}`, 'cmd');

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'command', cmd }));
        } else {
            // Fallback to HTTP
            fetch(`${API}/api/laser/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd })
            }).then(r => r.json()).then(data => {
                if (!data.success) logConsole(data.message, 'err');
            }).catch(err => logConsole('Error: ' + err.message, 'err'));
        }
    }

    // Console input
    consoleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const cmd = consoleInput.value.trim();
            if (cmd) {
                sendCommand(cmd);
                consoleInput.value = '';
            }
        }
    });

    btnSendCmd.addEventListener('click', () => {
        const cmd = consoleInput.value.trim();
        if (cmd) {
            sendCommand(cmd);
            consoleInput.value = '';
        }
    });

    // --- File upload ---
    uploadArea.addEventListener('click', () => fileInput.click());

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            uploadFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            uploadFile(fileInput.files[0]);
            fileInput.value = '';
        }
    });

    btnClearFile.addEventListener('click', () => {
        loadedFile.classList.add('hidden');
        uploadArea.classList.remove('hidden');
        clearPreview();
    });

    async function uploadFile(file) {
        loadPreview(file);
        logConsole(`Subiendo: ${file.name}...`, 'cmd');
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${API}/api/laser/upload`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                loadedFilename.textContent = data.filename;
                loadedFile.classList.remove('hidden');
                uploadArea.classList.add('hidden');
                logConsole(`Archivo cargado: ${data.filename}`, 'ok');
                // Reposition elements to origin (0,0) to avoid out-of-bounds
                sendCommand('element* position 0 0');
            } else {
                logConsole(data.message, 'err');
            }
        } catch (err) {
            logConsole('Error al subir: ' + err.message, 'err');
        }
    }

    // --- Mode toggle ---
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            opMode = btn.dataset.mode;
            const rasterParams = document.querySelectorAll('.raster-param');
            rasterParams.forEach(el => {
                el.classList.toggle('hidden', opMode !== 'raster');
            });
            // Adjust default speed for mode
            const speedInput = document.getElementById('param-speed');
            if (opMode === 'raster' && parseFloat(speedInput.value) < 50) {
                speedInput.value = 150;
            } else if (opMode === 'cut' && parseFloat(speedInput.value) > 50) {
                speedInput.value = 10;
            }
        });
    });

    // --- Material presets ---
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('param-speed').value = btn.dataset.speed;
        });
    });

    // --- Job controls ---
    // --- DPI <-> Step sync ---
    const dpiInput = document.getElementById('param-dpi');
    const stepInput = document.getElementById('param-step');

    dpiInput.addEventListener('input', () => {
        const dpi = parseFloat(dpiInput.value);
        if (dpi > 0) stepInput.value = (25.4 / dpi).toFixed(3);
    });

    stepInput.addEventListener('input', () => {
        const step = parseFloat(stepInput.value);
        if (step > 0) dpiInput.value = Math.round(25.4 / step);
    });

    btnStart.addEventListener('click', () => {
        const speed = document.getElementById('param-speed').value;
        if (opMode === 'raster') {
            const dpi = dpiInput.value;
            const bidir = document.getElementById('param-bidir').checked;
            // Set raster/image operations
            sendCommand(`operation* filter -t raster speed ${speed}`);
            sendCommand(`operation* filter -t raster dpi ${dpi}`);
            sendCommand(`operation* filter -t image speed ${speed}`);
            sendCommand(`operation* filter -t image dpi ${dpi}`);
        } else {
            // Set only cut/engrave operations
            sendCommand(`operation* filter -t cut speed ${speed}`);
            sendCommand(`operation* filter -t engrave speed ${speed}`);
        }
        sendCommand(`plan copy preprocess validate blob spool`);
    });

    btnPause.addEventListener('click', () => sendCommand('pause'));
    btnStop.addEventListener('click', () => {
        sendCommand('estop');
        // Reconnect USB and restart pipe after abort
        setTimeout(() => {
            sendCommand('usb_connect');
            sendCommand('start');
        }, 500);
    });
    btnFrame.addEventListener('click', () => sendCommand('trace'));

    // --- Position controls ---
    btnHome.addEventListener('click', () => sendCommand('home'));
    btnUnlock.addEventListener('click', () => sendCommand('unlock'));

    // Jog buttons
    const jogDirections = { up: 'up', down: 'down', left: 'left', right: 'right' };
    document.querySelectorAll('.jog-btn[data-dir]').forEach(btn => {
        btn.addEventListener('click', () => {
            const dir = btn.dataset.dir;
            sendCommand(`${dir} ${jogStep}mm`);
        });
    });

    // Step size buttons
    document.querySelectorAll('.step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.step-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            jogStep = parseInt(btn.dataset.step, 10);
        });
    });

    // --- Preview ---
    function initPreview() {
        const ratio = window.devicePixelRatio || 1;
        previewCanvas.width = CANVAS_PX * ratio;
        previewCanvas.height = CANVAS_PX * ratio;
        previewCanvas.style.width = CANVAS_PX + 'px';
        previewCanvas.style.height = CANVAS_PX + 'px';
        previewCtx.scale(ratio, ratio);
        drawBed();
    }

    function drawBed() {
        const ctx = previewCtx;
        const scale = CANVAS_PX / BED_W;
        ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);

        // Background
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

        // Grid (every 50mm)
        ctx.strokeStyle = '#1a2030';
        ctx.lineWidth = 1;
        for (let i = 0; i <= BED_W; i += 50) {
            const px = i * scale;
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, CANVAS_PX);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, px);
            ctx.lineTo(CANVAS_PX, px);
            ctx.stroke();
        }

        // Grid labels (every 100mm)
        ctx.fillStyle = '#3a4050';
        ctx.font = '10px sans-serif';
        for (let i = 0; i <= BED_W; i += 100) {
            if (i === 0) continue;
            const px = i * scale;
            ctx.fillText(i + '', px + 2, 12);
            ctx.fillText(i + '', 2, px + 12);
        }

        // Border
        ctx.strokeStyle = '#2a3040';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, 0, CANVAS_PX, CANVAS_PX);

        // Origin marker
        ctx.fillStyle = '#4a9eff';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();

        // Draw loaded image if any
        if (previewImage) {
            const img = previewImage;
            const imgW = img.naturalWidth || img.width;
            const imgH = img.naturalHeight || img.height;

            // Scale image to real mm on the bed
            const imgAspect = imgW / imgH;
            // Assume SVG viewBox maps to ~320mm wide (K40 bed), scale proportionally
            let realW = Math.min(BED_W * 0.8, BED_W);
            let realH = realW / imgAspect;
            if (realH > BED_H) {
                realH = BED_H;
                realW = realH * imgAspect;
            }

            const drawW = realW * scale;
            const drawH = realH * scale;

            // Position at origin (0,0) — top-left corner
            const x = 0;
            const y = 0;

            ctx.drawImage(img, x, y, drawW, drawH);

            // Bounding box
            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x, y, drawW, drawH);
            ctx.setLineDash([]);

            // Size info
            const sizeW = (drawW / scale).toFixed(1);
            const sizeH = (drawH / scale).toFixed(1);
            previewInfo.textContent = `${sizeW} x ${sizeH} mm`;
        }
    }

    function loadPreview(file) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            previewImage = img;
            previewContainer.classList.remove('hidden');
            initPreview();
        };
        img.onerror = () => {
            // For SVG that may fail as img, try as object
            previewContainer.classList.add('hidden');
        };
        img.src = url;
    }

    function clearPreview() {
        previewImage = null;
        previewContainer.classList.add('hidden');
    }

    // --- Machine init ---
    const btnInit = document.getElementById('btn-init');
    const initBar = document.getElementById('init-bar');
    let machineReady = false;

    btnInit.addEventListener('click', () => {
        sendCommand('usb_connect');
        sendCommand('start');
        logConsole('Inicializando máquina...', 'cmd');
        setTimeout(() => {
            sendCommand('home');
            machineReady = true;
            initBar.classList.add('connected');
            btnInit.innerHTML = '<i class="fas fa-check"></i> Máquina Conectada';
            document.querySelector('.init-hint').textContent = 'USB conectado y listo para operar';
        }, 1500);
    });

    // --- Init ---
    connectWS();
    logConsole('Esperando conexión con MeerK40t...', 'cmd');
});
