document.addEventListener('DOMContentLoaded', () => {
    const API = window.API_BASE_URL || '';
    let ws = null;
    let jogStep = 1;
    let opMode = 'cut'; // 'cut' or 'raster'

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
    });

    async function uploadFile(file) {
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
            sendCommand(`operation* speed ${speed}`);
            sendCommand(`operation* dpi ${dpi}`);
            if (!bidir) {
                sendCommand(`operation* op-property-set raster_swing False`);
            }
        } else {
            sendCommand(`operation* speed ${speed}`);
        }
        sendCommand(`plan copy preprocess validate blob spool`);
    });

    btnPause.addEventListener('click', () => sendCommand('pause'));
    btnStop.addEventListener('click', () => sendCommand('estop'));
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

    // --- Init ---
    connectWS();
    logConsole('Esperando conexión con MeerK40t...', 'cmd');
});
