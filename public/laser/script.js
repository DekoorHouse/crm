document.addEventListener('DOMContentLoaded', () => {
    const API = window.API_BASE_URL || '';
    let ws = null;
    let jogStep = 1;
    let opMode = 'cut';

    // Workspace
    const BED_W = 400, BED_H = 400;
    const canvas = document.getElementById('preview-canvas');
    const ctx = canvas.getContext('2d');
    const previewInfo = document.getElementById('preview-info');
    let previewImage = null;
    let canvasPx = 500;

    // DOM refs
    const connDot = document.getElementById('conn-dot');
    const connText = document.getElementById('conn-text');
    const btnInit = document.getElementById('btn-init');
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
    const sbUsb = document.getElementById('sb-usb');
    const sbFile = document.getElementById('sb-file');
    const sbJob = document.getElementById('sb-job');

    // ===================== WebSocket =====================
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
                parseProgress(data.text);
            } else if (data.type === 'status') {
                updateStatus(data.connected);
            }
        };

        ws.onclose = () => {
            updateStatus(false);
            logConsole('Desconectado del servidor', 'err');
            setTimeout(connectWS, 3000);
        };

        ws.onerror = () => {};
    }

    function updateStatus(connected) {
        connDot.className = connected ? 'dot on' : 'dot';
        connText.textContent = connected ? 'Conectado' : 'Desconectado';
        sbUsb.textContent = connected ? 'Conectado' : 'Desconectado';
    }

    // ===================== Console =====================
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
            if (cmd) { sendCommand(cmd); consoleInput.value = ''; }
        }
    });
    btnSendCmd.addEventListener('click', () => {
        const cmd = consoleInput.value.trim();
        if (cmd) { sendCommand(cmd); consoleInput.value = ''; }
    });

    // ===================== Machine Init =====================
    btnInit.addEventListener('click', () => {
        sendCommand('usb_connect');
        sendCommand('start');
        logConsole('Inicializando maquina...', 'cmd');
        setTimeout(() => {
            sendCommand('home');
            btnInit.innerHTML = '<i class="fas fa-check"></i> Conectada';
            btnInit.classList.add('active');
            btnInit.classList.remove('tag-btn');
        }, 1500);
    });

    // ===================== File Upload =====================
    uploadArea.addEventListener('click', () => fileInput.click());

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
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
        sbFile.textContent = 'Sin archivo';
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
                sendCommand('element* position 0 0');
                sbFile.textContent = data.filename;
            } else {
                logConsole(data.message, 'err');
            }
        } catch (err) {
            logConsole('Error al subir: ' + err.message, 'err');
        }
    }

    // ===================== Mode Toggle =====================
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            opMode = btn.dataset.mode;
            document.querySelectorAll('.raster-param').forEach(el => {
                el.classList.toggle('hidden', opMode !== 'raster');
            });
            const speedInput = document.getElementById('param-speed');
            if (opMode === 'raster' && parseFloat(speedInput.value) < 50) {
                speedInput.value = 150;
            } else if (opMode === 'cut' && parseFloat(speedInput.value) > 50) {
                speedInput.value = 10;
            }
        });
    });

    // ===================== Material Presets =====================
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('param-speed').value = btn.dataset.speed;
        });
    });

    // ===================== DPI <-> Step Sync =====================
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

    // ===================== Job Controls =====================
    btnStart.addEventListener('click', () => {
        const speed = document.getElementById('param-speed').value;

        // Disable all operations first, then enable only the ones we want
        sendCommand('operation* disable');

        if (opMode === 'raster') {
            const dpi = dpiInput.value;
            // Enable only raster/image operations
            sendCommand('operation* filter -t raster enable');
            sendCommand('operation* filter -t image enable');
            sendCommand(`operation* speed ${speed}`);
            sendCommand(`operation* dpi ${dpi}`);
        } else {
            // Enable only cut/engrave operations
            sendCommand('operation* filter -t cut enable');
            sendCommand('operation* filter -t engrave enable');
            sendCommand(`operation* speed ${speed}`);
        }

        sendCommand('plan copy preprocess validate blob spool');
        sbJob.textContent = 'Ejecutando...';
        document.getElementById('progress-section').classList.remove('hidden');
        startProgressPolling();
    });

    btnPause.addEventListener('click', () => sendCommand('pause'));

    btnStop.addEventListener('click', () => {
        sendCommand('estop');
        stopProgressPolling();
        setTimeout(() => {
            sendCommand('usb_connect');
            sendCommand('start');
        }, 500);
        jobRunning = false;
        sbJob.textContent = 'Detenido';
        document.getElementById('progress-fill').classList.remove('indeterminate');
        document.getElementById('progress-fill').style.width = '0%';
        document.getElementById('progress-text').textContent = 'Detenido';
        document.getElementById('progress-pct').textContent = '';
    });

    btnFrame.addEventListener('click', () => sendCommand('trace'));

    // ===================== Progress Polling =====================
    let progressInterval = null;

    let jobRunning = false;

    function parseProgress(text) {
        // Job is active if we see LaserJob in spool output
        if (text.match(/LaserJob\(/)) {
            if (!jobRunning) {
                jobRunning = true;
                document.getElementById('progress-fill').classList.add('indeterminate');
                document.getElementById('progress-text').textContent = 'Cortando...';
                document.getElementById('progress-pct').textContent = '';
                sbJob.textContent = 'Cortando...';
            }
        }

        // Empty spooler = job finished (spool output with no LaserJob lines)
        if (text.includes('Spooler on device') && !text.includes('LaserJob')) {
            if (jobRunning) {
                jobRunning = false;
                stopProgressPolling();
                document.getElementById('progress-fill').classList.remove('indeterminate');
                document.getElementById('progress-fill').style.width = '100%';
                document.getElementById('progress-text').textContent = 'Completado';
                document.getElementById('progress-pct').textContent = '';
                sbJob.textContent = 'Completado';
            }
        }
    }

    function startProgressPolling() {
        stopProgressPolling();
        progressInterval = setInterval(() => {
            sendCommand('spool');
        }, 2000);
    }

    function stopProgressPolling() {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }

    // ===================== Position Controls =====================
    btnHome.addEventListener('click', () => sendCommand('home'));
    btnUnlock.addEventListener('click', () => sendCommand('unlock'));

    document.querySelectorAll('.jog-btn[data-dir]').forEach(btn => {
        btn.addEventListener('click', () => {
            sendCommand(`${btn.dataset.dir} ${jogStep}mm`);
        });
    });

    document.querySelectorAll('.step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.step-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            jogStep = parseInt(btn.dataset.step, 10);
        });
    });

    // ===================== Preview Canvas =====================
    function initPreview() {
        const wrap = document.querySelector('.canvas-wrap');
        const size = Math.min(wrap.clientWidth, wrap.clientHeight) - 4;
        canvasPx = Math.max(size, 200);

        const ratio = window.devicePixelRatio || 1;
        canvas.width = canvasPx * ratio;
        canvas.height = canvasPx * ratio;
        canvas.style.width = canvasPx + 'px';
        canvas.style.height = canvasPx + 'px';
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawBed();
    }

    function drawBed() {
        const scale = canvasPx / BED_W;
        ctx.clearRect(0, 0, canvasPx, canvasPx);

        // Background
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, canvasPx, canvasPx);

        // Grid 50mm
        ctx.strokeStyle = '#1a2030';
        ctx.lineWidth = 1;
        for (let i = 0; i <= BED_W; i += 50) {
            const px = i * scale;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, canvasPx); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, px); ctx.lineTo(canvasPx, px); ctx.stroke();
        }

        // Labels 100mm
        ctx.fillStyle = '#2a3545';
        ctx.font = '10px sans-serif';
        for (let i = 100; i <= BED_W; i += 100) {
            const px = i * scale;
            ctx.fillText(i + '', px + 2, 12);
            ctx.fillText(i + '', 2, px + 12);
        }

        // Border
        ctx.strokeStyle = '#2a3040';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, 0, canvasPx, canvasPx);

        // Origin
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();

        // Design
        if (previewImage) {
            const img = previewImage;
            const imgW = img.naturalWidth || img.width;
            const imgH = img.naturalHeight || img.height;

            // Use the image pixel dimensions directly, scaled to bed mm
            // SVGs from the editor typically use px where 1px ≈ 0.2646mm (96dpi)
            // But we just preserve the aspect ratio and fit to bed
            const pxToMm = BED_W / Math.max(imgW, imgH);
            const realW = imgW * pxToMm;
            const realH = imgH * pxToMm;

            const drawW = realW * scale;
            const drawH = realH * scale;

            ctx.drawImage(img, 0, 0, drawW, drawH);

            // Bounding box
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(0, 0, drawW, drawH);
            ctx.setLineDash([]);

            previewInfo.textContent = `${realW.toFixed(1)} x ${realH.toFixed(1)} mm`;
        }
    }

    function loadPreview(file) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            previewImage = img;
            initPreview();
        };
        img.onerror = () => {};
        img.src = url;
    }

    function clearPreview() {
        previewImage = null;
        previewInfo.textContent = '';
        initPreview();
    }

    // ===================== Resize =====================
    window.addEventListener('resize', () => initPreview());

    // ===================== Init =====================
    connectWS();
    logConsole('Esperando conexion con MeerK40t...', 'cmd');
    initPreview();
});
