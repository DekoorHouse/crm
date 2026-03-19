/**
 * Laser Dual Controller
 * Instancia 2 paneles independientes, uno por máquina.
 */
const WORK_W = 400, WORK_H = 400;
let ws = null;
const panels = {};

// ───────── Crear paneles ─────────
function createPanel(id) {
    const tpl = document.getElementById('machinePanelTemplate').innerHTML
        .replace(/__ID__/g, id)
        .replace(/__NUM__/g, id + 1);
    const div = document.createElement('div');
    div.innerHTML = tpl;
    const el = div.firstElementChild;
    document.getElementById('dualWorkspace').appendChild(el);

    // Refs
    const ref = (name) => el.querySelector(`[data-ref="${name}"]`);
    const canvas = ref('canvas');
    const ctx = canvas.getContext('2d');

    const state = {
        id,
        connected: false,
        posX: 0, posY: 0,
        mode: 'engrave',
        speed: 10,
        lineSpacing: 4,
        passes: 1,
        jogStep: 1,
        loadedFile: null,
        loadedImage: null,
        imageType: null,
        svgText: null,
        _svgBBox: null,
        designBox: null,
        designSelected: false,
        jobRunning: false,
        previewBitmapData: null,
        rasterResult: null,
    };

    let canvasW = 100, canvasH = 100;
    let viewZoom = 1, viewPanX = 0, viewPanY = 0;

    function setupCanvas() {
        const wrapper = ref('canvasWrapper');
        const maxW = wrapper.clientWidth * 0.95;
        const maxH = wrapper.clientHeight * 0.95;
        const aspect = WORK_W / WORK_H;
        let w = maxW, h = w / aspect;
        if (h > maxH) { h = maxH; w = h * aspect; }
        canvasW = w; canvasH = h;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        drawCanvas();
    }

    function drawCanvas() {
        const W = canvasW, H = canvasH;
        const dpr = window.devicePixelRatio || 1;
        // Limpiar todo el canvas y pintar fondo global (fuera del transform)
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();

        // Aplicar zoom y pan — todo lo que sigue está en coordenadas del workspace
        ctx.save();
        ctx.translate(viewPanX, viewPanY);
        ctx.scale(viewZoom, viewZoom);

        // Fondo del área de trabajo
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, W, H);

        // Grid
        const gx = W / (WORK_W / 10), gy = H / (WORK_H / 10);
        ctx.strokeStyle = 'rgba(88,166,255,0.07)'; ctx.lineWidth = 0.5;
        for (let x = 0; x <= W; x += gx) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
        for (let y = 0; y <= H; y += gy) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(88,166,255,0.35)'; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, W-1, H-1);

        // Origin
        ctx.fillStyle = '#3fb950';
        ctx.beginPath(); ctx.arc(4, 4, 2.5, 0, Math.PI * 2); ctx.fill();

        // Loaded design
        if (state.loadedImage) {
            const img = state.loadedImage;
            let dw, dh, dx, dy, drawX, drawY, drawW, drawH, mmW, mmH;

            if (state.imageType === 'svg') {
                if (state.svgText && !state._svgBBox) computeSvgBBox(state);
                const bb = state._svgBBox || { pageMmW: WORK_W, pageMmH: WORK_H, mmX: 0, mmY: 0, mmW: WORK_W, mmH: WORK_H };
                mmW = bb.mmW; mmH = bb.mmH;
                drawW = (bb.pageMmW / WORK_W) * W; drawH = (bb.pageMmH / WORK_H) * H;
                drawX = 0; drawY = 0;
                dx = (bb.mmX / WORK_W) * W; dy = (bb.mmY / WORK_H) * H;
                dw = (mmW / WORK_W) * W; dh = (mmH / WORK_H) * H;
            } else {
                const imgW = img.naturalWidth || img.width;
                const imgH = img.naturalHeight || img.height;
                const pxToMm = 25.4 / 96;
                const rW = imgW * pxToMm, rH = imgH * pxToMm;
                const fit = Math.min(WORK_W / rW, WORK_H / rH, 1);
                mmW = rW * fit; mmH = rH * fit;
                dw = (mmW / WORK_W) * W; dh = (mmH / WORK_H) * H;
                dx = (W - dw) / 2; dy = (H - dh) / 2;
                drawX = dx; drawY = dy; drawW = dw; drawH = dh;
            }

            state.designBox = { dx, dy, dw, dh, mmW, mmH };

            // Draw image or preview
            if (state.previewBitmapData) {
                // Mostrar preview del bitmap dithered
                const pv = state.previewBitmapData;
                const pvDpmm = (pv.dpi || 1000) / 25.4;
                const pvMmW = pv.width / pvDpmm;
                const pvMmH = pv.height / pvDpmm * state.lineSpacing;
                const pvX = (pv.offsetX / WORK_W) * W;
                const pvY = (pv.offsetY / WORK_H) * H;
                const pvW = (pvMmW / WORK_W) * W;
                const pvH = (pvMmH / WORK_H) * H;
                ctx.save(); ctx.globalAlpha = 0.95;
                ctx.drawImage(pv.canvas, pvX, pvY, pvW, pvH);
                ctx.restore();
            } else if (state.imageType === 'svg') {
                const hasImg = state.svgText && /<image[\s>]/i.test(state.svgText);
                if (hasImg) {
                    ctx.save(); ctx.shadowColor = '#00d4ff'; ctx.shadowBlur = 6;
                    ctx.globalAlpha = 0.9; ctx.drawImage(img, drawX, drawY, drawW, drawH); ctx.restore();
                } else {
                    ctx.save(); ctx.globalAlpha = 0.15; ctx.drawImage(img, drawX, drawY, drawW, drawH); ctx.restore();
                    ctx.save(); ctx.globalAlpha = 1;
                    ctx.filter = 'brightness(0) saturate(100%) invert(70%) sepia(100%) saturate(1000%) hue-rotate(165deg)';
                    ctx.shadowColor = '#00d4ff'; ctx.shadowBlur = 10;
                    ctx.drawImage(img, drawX, drawY, drawW, drawH);
                    ctx.shadowBlur = 4; ctx.drawImage(img, drawX, drawY, drawW, drawH); ctx.restore();
                }
            } else {
                ctx.save(); ctx.globalAlpha = 0.9;
                ctx.drawImage(img, drawX, drawY, drawW, drawH); ctx.restore();
            }

            // Selection
            if (state.designSelected) {
                const pad = 3;
                const offset = (Date.now() / 60) % 16;
                ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([]);
                ctx.strokeRect(dx-pad, dy-pad, dw+pad*2, dh+pad*2);
                ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2; ctx.setLineDash([6,4]); ctx.lineDashOffset = -offset;
                ctx.strokeRect(dx-pad, dy-pad, dw+pad*2, dh+pad*2);
                ctx.setLineDash([]); ctx.lineDashOffset = 0;

                // Handles
                const hs = 4; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1;
                for (const [hx,hy] of [[dx,dy],[dx+dw,dy],[dx,dy+dh],[dx+dw,dy+dh],[dx+dw/2,dy],[dx+dw/2,dy+dh],[dx,dy+dh/2],[dx+dw,dy+dh/2]]) {
                    ctx.fillRect(hx-hs,hy-hs,hs*2,hs*2); ctx.strokeRect(hx-hs,hy-hs,hs*2,hs*2);
                }

                // Dimension labels
                ctx.font = 'bold 10px JetBrains Mono, monospace';
                ctx.fillStyle = '#58a6ff'; ctx.textAlign = 'center';
                ctx.fillText(`${mmW.toFixed(1)} mm`, dx + dw/2, dy - pad - 4);
                ctx.save(); ctx.translate(dx - pad - 10, dy + dh/2); ctx.rotate(-Math.PI/2);
                ctx.fillText(`${mmH.toFixed(1)} mm`, 0, 0); ctx.restore();
                ctx.textAlign = 'start';

                if (!state._animFrame) {
                    state._animFrame = requestAnimationFrame(function tick() {
                        if (state.designSelected) { drawCanvas(); state._animFrame = requestAnimationFrame(tick); }
                        else state._animFrame = null;
                    });
                }
            } else if (state._animFrame) { cancelAnimationFrame(state._animFrame); state._animFrame = null; }
        }

        // Cerrar transform de zoom/pan
        ctx.restore();

        // Indicador de zoom (fuera del transform)
        if (viewZoom !== 1) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(W - 60, 2, 58, 16);
            ctx.fillStyle = '#58a6ff';
            ctx.font = '10px JetBrains Mono, monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${Math.round(viewZoom * 100)}%`, W - 6, 13);
            ctx.textAlign = 'start';
        }
    }

    // ───────── File handling ─────────
    const dropZone = ref('dropZone');
    const fileInput = ref('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#58a6ff'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
    dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.style.borderColor = ''; if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

    ref('removeFileBtn').addEventListener('click', () => {
        state.loadedFile = null; state.loadedImage = null; state.imageType = null;
        state.svgText = null; state._svgBBox = null; state.designSelected = false; state.designBox = null; state.previewBitmapData = null; state.rasterResult = null;
        ref('fileInfo').style.display = 'none'; dropZone.style.display = '';
        drawCanvas();
    });

    function loadFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['svg','png','jpg','jpeg','bmp'].includes(ext)) { plog('Formato no soportado', 'error'); return; }
        const reader = new FileReader();
        if (ext === 'svg') {
            reader.onload = e => {
                state.svgText = e.target.result; state._svgBBox = null;
                createTransparentSvgImage(e.target.result, (img) => {
                    if (!img) { plog('Error cargando SVG', 'error'); return; }
                    state.loadedImage = img; state.imageType = 'svg'; state.loadedFile = file;
                    state.designSelected = false; state.previewBitmapData = null; state.rasterResult = null;
                    ref('fileName').textContent = file.name; ref('fileInfo').style.display = ''; dropZone.style.display = 'none';
                    drawCanvas();
                    plog(`SVG: ${file.name}`, 'success');
                });
            };
            reader.readAsText(file);
        } else {
            reader.onload = e => {
                const img = new Image();
                img.onload = () => {
                    state.loadedImage = img; state.imageType = 'raster'; state.loadedFile = file;
                    state.designSelected = false; state.previewBitmapData = null; state.rasterResult = null;
                    ref('fileName').textContent = file.name; ref('fileInfo').style.display = ''; dropZone.style.display = 'none';
                    drawCanvas();
                    plog(`Img: ${file.name}`, 'success');
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    }

    // ───────── Canvas interaction ─────────
    let dragStart = null;
    const wrapper = ref('canvasWrapper');

    wrapper.addEventListener('mousedown', e => {
        if (e.button === 2) return; // skip right click
        dragStart = canvasCoord(e);
        state.designSelected = false; drawCanvas();
    });
    window.addEventListener('mousemove', e => {
        if (!dragStart) return;
        const cur = canvasCoord(e);
        drawCanvas();
        // Dibujar rectángulo de selección en espacio del workspace (dentro del transform)
        const sx = Math.min(dragStart.x, cur.x), sy = Math.min(dragStart.y, cur.y);
        const sw = Math.abs(cur.x - dragStart.x), sh = Math.abs(cur.y - dragStart.y);
        if (sw > 2 || sh > 2) {
            ctx.save();
            ctx.translate(viewPanX, viewPanY);
            ctx.scale(viewZoom, viewZoom);
            ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1 / viewZoom; ctx.setLineDash([4 / viewZoom, 3 / viewZoom]);
            ctx.strokeRect(sx, sy, sw, sh); ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(88,166,255,0.08)'; ctx.fillRect(sx, sy, sw, sh);
            ctx.restore();
        }
    });
    window.addEventListener('mouseup', e => {
        if (!dragStart) return;
        const start = dragStart, end = canvasCoord(e);
        dragStart = null;
        const sx = Math.min(start.x, end.x), sy = Math.min(start.y, end.y);
        const sw = Math.abs(end.x - start.x), sh = Math.abs(end.y - start.y);
        if (state.designBox) {
            const b = state.designBox;
            if (sw <= 5 && sh <= 5) {
                if (start.x >= b.dx && start.x <= b.dx+b.dw && start.y >= b.dy && start.y <= b.dy+b.dh) state.designSelected = true;
            } else if (sx <= b.dx && sy <= b.dy && sx+sw >= b.dx+b.dw && sy+sh >= b.dy+b.dh) {
                state.designSelected = true;
            }
        }
        drawCanvas();
    });

    function canvasCoord(e) {
        const r = canvas.getBoundingClientRect();
        const rawX = (e.clientX - r.left) * (canvasW / r.width);
        const rawY = (e.clientY - r.top) * (canvasH / r.height);
        // Convertir coordenadas de pantalla a coordenadas del workspace (con zoom/pan)
        return { x: (rawX - viewPanX) / viewZoom, y: (rawY - viewPanY) / viewZoom };
    }
    function screenCoord(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (canvasW / r.width), y: (e.clientY - r.top) * (canvasH / r.height) };
    }
    wrapper.addEventListener('contextmenu', e => e.preventDefault());

    // Zoom con scroll — zoom hacia el cursor
    wrapper.addEventListener('wheel', e => {
        e.preventDefault();
        const sc = screenCoord(e);
        const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZoom = Math.min(Math.max(viewZoom * zoomFactor, 0.5), 20);
        // Zoom hacia el punto del cursor
        viewPanX = sc.x - (sc.x - viewPanX) * (newZoom / viewZoom);
        viewPanY = sc.y - (sc.y - viewPanY) * (newZoom / viewZoom);
        viewZoom = newZoom;
        drawCanvas();
    }, { passive: false });

    // Pan con click derecho sostenido
    let panStart = null, panStartPan = null;
    wrapper.addEventListener('mousedown', e => {
        if (e.button === 2) {
            e.preventDefault();
            panStart = screenCoord(e);
            panStartPan = { x: viewPanX, y: viewPanY };
        }
    });
    window.addEventListener('mousemove', e => {
        if (!panStart) return;
        const cur = screenCoord(e);
        viewPanX = panStartPan.x + (cur.x - panStart.x);
        viewPanY = panStartPan.y + (cur.y - panStart.y);
        drawCanvas();
    });
    window.addEventListener('mouseup', e => {
        if (e.button === 2) panStart = null;
    });

    // Doble click para resetear zoom
    wrapper.addEventListener('dblclick', e => {
        if (e.button === 0) {
            viewZoom = 1; viewPanX = 0; viewPanY = 0;
            drawCanvas();
        }
    });

    // ───────── Controls ─────────
    // Mode
    ref('modeEngrave').addEventListener('click', () => {
        state.mode = 'engrave';
        ref('modeEngrave').style.cssText = 'flex:1;padding:2px;font-size:9px;border:1px solid rgba(88,166,255,0.3);border-radius:3px;background:rgba(88,166,255,0.15);color:#58a6ff;cursor:pointer';
        ref('modeCut').style.cssText = 'flex:1;padding:2px;font-size:9px;border:1px solid rgba(88,166,255,0.1);border-radius:3px;background:none;color:#8b949e;cursor:pointer';
    });
    ref('modeCut').addEventListener('click', () => {
        state.mode = 'cut';
        ref('modeCut').style.cssText = 'flex:1;padding:2px;font-size:9px;border:1px solid rgba(88,166,255,0.3);border-radius:3px;background:rgba(88,166,255,0.15);color:#58a6ff;cursor:pointer';
        ref('modeEngrave').style.cssText = 'flex:1;padding:2px;font-size:9px;border:1px solid rgba(88,166,255,0.1);border-radius:3px;background:none;color:#8b949e;cursor:pointer';
    });

    // Sliders
    ref('speedSlider').addEventListener('input', e => { state.speed = +e.target.value; ref('speedLabel').textContent = `${state.speed} mm/s`; });
    ref('lineSpacingSlider').addEventListener('input', e => { state.lineSpacing = +e.target.value; ref('lineSpacingLabel').textContent = `${(state.lineSpacing*0.025).toFixed(3)} mm`; });
    ref('passesSlider').addEventListener('input', e => { state.passes = +e.target.value; ref('passesLabel').textContent = `${state.passes}×`; });
    ref('lineSpacingSlider').addEventListener('change', () => { state.previewBitmapData = null; state.rasterResult = null; drawCanvas(); });

    // Jog
    el.querySelectorAll('[data-jog]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!ws) return;
            const v = btn.dataset.jog;
            if (v === 'home') { sendCmd({ cmd: 'home', machine: id }); return; }
            const [dx, dy] = v.split(',').map(Number);
            sendCmd({ cmd: 'jog', machine: id, dx: dx * state.jogStep, dy: dy * state.jogStep });
        });
    });
    el.querySelectorAll('[data-step]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.jogStep = +btn.dataset.step;
            el.querySelectorAll('[data-step]').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    // Job controls
    ref('frameBtn').addEventListener('click', () => sendCmd({ cmd: 'frame', machine: id }));
    ref('previewBtn').addEventListener('click', () => generatePreview());
    ref('simBtn').addEventListener('click', async () => {
        if (!state.loadedImage) { plog('Sin imagen para simular', 'error'); return; }
        // For engrave mode without bitmap data, auto-generate it first
        if (state.mode !== 'cut' && !state.rasterResult && !state.previewBitmapData) {
            plog('Generando bitmap para simulación...', 'info');
            try {
                const rd = await autoGenerateRaster(state);
                state.rasterResult = rd;
                // Also show preview on main canvas
                const pvCanvas = document.createElement('canvas');
                pvCanvas.width = rd.width; pvCanvas.height = rd.height;
                const pvCx = pvCanvas.getContext('2d');
                const imgData = pvCx.createImageData(rd.width, rd.height);
                const d = imgData.data;
                const rowBytes = Math.ceil(rd.width / 8);
                for (let y = 0; y < rd.height; y++) for (let x = 0; x < rd.width; x++) {
                    const bit = (rd.bitmap[y * rowBytes + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
                    const idx = (y * rd.width + x) * 4;
                    const v = bit ? 0 : 255;
                    d[idx] = v; d[idx + 1] = v; d[idx + 2] = v; d[idx + 3] = 255;
                }
                pvCx.putImageData(imgData, 0, 0);
                state.previewBitmapData = { canvas: pvCanvas, width: rd.width, height: rd.height, offsetX: rd.offsetX, offsetY: rd.offsetY, dpi: rd.dpi };
                drawCanvas();
                plog(`Bitmap: ${rd.width}×${rd.height}px`, 'success');
            } catch (err) {
                plog('Error generando bitmap: ' + err.message, 'error');
                return;
            }
        }
        plog('Abriendo simulación...', 'info');
        openLaserSim(state, plog, drawCanvas);
    });
    ref('startBtn').addEventListener('click', () => startJob());
    ref('pauseBtn').addEventListener('click', () => {
        state.jobRunning ? sendCmd({ cmd: state.jobPaused ? 'resume' : 'pause', machine: id }) : null;
        state.jobPaused = !state.jobPaused;
    });
    ref('stopBtn').addEventListener('click', () => { sendCmd({ cmd: 'stop', machine: id }); state.jobRunning = false; });
    ref('estopBtn').addEventListener('click', () => { sendCmd({ cmd: 'estop', machine: id }); state.jobRunning = false; });

    function generatePreview() {
        if (!state.loadedImage) { plog('Sin imagen para previsualizar', 'error'); return; }
        plog('Abriendo configuración BMP...', 'info');
        openBmpModal(state, plog, drawCanvas);
    }

    function startJob() {
        if (!state.loadedFile || !ws) return;
        state.jobRunning = true;
        plog(`Iniciando ${state.mode}...`, 'success');

        if (state.mode === 'cut' && state.imageType === 'svg' && state.svgText) {
            const segments = extractSVGSegments(state.svgText);
            if (!segments.length) { plog('Sin trazos SVG', 'error'); return; }
            sendCmd({ cmd: 'start', machine: id, mode: 'cut', speed: state.speed, passes: state.passes, segments });
        } else {
            // Usar resultado del modal si existe, sino generar con defaults
            let rd = state.rasterResult;
            if (!rd) {
                const bbox = (state.imageType === 'svg' && state._svgBBox) ? state._svgBBox : null;
                const dpmm = 1000 / 25.4;
                const raw = renderImageToGray(state.loadedImage, state.lineSpacing, bbox, dpmm);
                const processed = processGray(raw.gray, raw.width, raw.height, { brightness:0, contrast:0, algorithm:'atkinson', invert:false });
                rd = { bitmap: grayToBitmap(processed, raw.width, raw.height), width: raw.width, height: raw.height, offsetX: raw.offsetX, offsetY: raw.offsetY };
            }
            const rdDpmm = (rd.dpi || 1000) / 25.4;
            const mmW = (rd.width / rdDpmm).toFixed(1), mmH = (rd.height / rdDpmm * state.lineSpacing).toFixed(1);
            plog(`Bitmap: ${rd.width}×${rd.height}px → ${mmW}×${mmH}mm, offset=(${rd.offsetX.toFixed(1)},${rd.offsetY.toFixed(1)})mm, step=${state.lineSpacing}, bytes=${rd.bitmap.byteLength}`, 'info');
            sendCmd({ cmd: 'start', machine: id, mode: 'engrave', speed: state.speed, passes: state.passes,
                raster: { width: rd.width, height: rd.height, step: state.lineSpacing, offsetX: rd.offsetX, offsetY: rd.offsetY } });
            ws.send(rd.bitmap.buffer);
        }
    }

    // ───────── Console ─────────
    function plog(msg, level = 'cmd') {
        const c = ref('console');
        const d = document.createElement('div');
        d.className = `log ${level}`;
        d.textContent = msg;
        c.appendChild(d);
        c.scrollTop = c.scrollHeight;
        if (c.children.length > 100) c.removeChild(c.firstChild);
    }

    // ───────── Handle messages from server ─────────
    function handleMessage(msg) {
        if (msg.type === 'machine_ready') {
            state.connected = msg.ok;
            ref('statusDot').classList.toggle('connected', msg.ok);
            ref('connectBtn').textContent = msg.ok ? 'Desconectar' : 'Conectar';
            ref('connectBtn').style.borderColor = msg.ok ? '#f85149' : '#3fb950';
            ref('connectBtn').style.color = msg.ok ? '#f85149' : '#3fb950';
            plog(msg.ok ? 'Máquina conectada' : (msg.error || 'Error'), msg.ok ? 'success' : 'error');
        } else if (msg.type === 'position') {
            state.posX = msg.x; state.posY = msg.y;
            ref('posDisplay').textContent = `X: ${msg.x.toFixed(1)}  Y: ${msg.y.toFixed(1)}`;
        } else if (msg.type === 'progress') {
            ref('progressFill').style.width = msg.pct + '%';
        } else if (msg.type === 'done') {
            state.jobRunning = false;
            ref('progressFill').style.width = '0%';
            plog('Completado', 'success');
        } else if (msg.type === 'status') {
            plog(msg.text, msg.level);
        }
    }

    // ───────── Connect button per panel ─────────
    ref('connectBtn').addEventListener('click', () => {
        plog('Conectando...', 'info');
        if (!ws || ws.readyState !== 1) {
            // Abrir WebSocket y enviar connect_machine cuando esté listo
            connectWebSocket(() => {
                sendCmd({ cmd: 'connect_machine', machine: id });
            });
        } else {
            sendCmd({ cmd: 'connect_machine', machine: id });
        }
    });

    return { state, setupCanvas, drawCanvas, handleMessage, plog, el };
}

// ───────── SVG helpers (shared) ─────────
function svgToMmScale(svg) {
    const rawW = svg.getAttribute('width') || '';
    const vb = svg.getAttribute('viewBox');
    let vbW;
    if (vb) { vbW = vb.split(/[\s,]+/).map(Number)[2]; }
    else { vbW = parseFloat(rawW) || 400; }
    let mmW;
    if (rawW.includes('mm')) mmW = parseFloat(rawW);
    else if (rawW.includes('in')) mmW = parseFloat(rawW) * 25.4;
    else if (rawW.includes('cm')) mmW = parseFloat(rawW) * 10;
    else if (parseFloat(rawW) > 0) mmW = parseFloat(rawW) / 96 * 25.4;
    else mmW = vbW / 96 * 25.4;
    return mmW / vbW;
}

function computeSvgBBox(state) {
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden';
    container.innerHTML = state.svgText;
    document.body.appendChild(container);
    const liveSvg = container.querySelector('svg');
    const scale = svgToMmScale(liveSvg);
    const vb = liveSvg.getAttribute('viewBox');
    let pageW, pageH;
    if (vb) { const p = vb.split(/[\s,]+/).map(Number); pageW = p[2]*scale; pageH = p[3]*scale; }
    else { pageW = (parseFloat(liveSvg.getAttribute('width'))||300)*scale; pageH = (parseFloat(liveSvg.getAttribute('height'))||200)*scale; }
    // Get SVG viewBox dimensions for background rect detection
    const vbParts = vb ? vb.split(/[\s,]+/).map(Number) : null;
    const svgVbW = vbParts ? vbParts[2] : (parseFloat(liveSvg.getAttribute('width')) || 300);
    const svgVbH = vbParts ? vbParts[3] : (parseFloat(liveSvg.getAttribute('height')) || 200);
    // Query individual shapes (no <g> to avoid double-counting with children)
    const shapes = liveSvg.querySelectorAll('path,line,rect,circle,ellipse,polyline,polygon,text,image,use');
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const el of shapes) {
        try {
            const b = el.getBBox();
            if (b.width === 0 && b.height === 0) continue;
            // Skip background rects (cover entire SVG with white/no fill)
            if (el.tagName === 'rect') {
                const rx = parseFloat(el.getAttribute('x') || 0);
                const ry = parseFloat(el.getAttribute('y') || 0);
                const rw = parseFloat(el.getAttribute('width') || 0);
                const rh = parseFloat(el.getAttribute('height') || 0);
                const fill = (el.getAttribute('fill') || window.getComputedStyle(el).fill || '').toLowerCase().replace(/\s/g, '');
                const isBgSize = Math.abs(rx) < 1 && Math.abs(ry) < 1 && Math.abs(rw - svgVbW) < 2 && Math.abs(rh - svgVbH) < 2;
                const isBgFill = !fill || fill === 'white' || fill === '#ffffff' || fill === '#fff' || fill === 'rgb(255,255,255)' || fill === 'none';
                if (isBgSize && isBgFill) continue;
            }
            minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
        } catch(_) {}
    }
    document.body.removeChild(container);
    if (minX < Infinity) state._svgBBox = { pageMmW:pageW, pageMmH:pageH, mmX:minX*scale, mmY:minY*scale, mmW:(maxX-minX)*scale, mmH:(maxY-minY)*scale };
    else state._svgBBox = { pageMmW:pageW, pageMmH:pageH, mmX:0, mmY:0, mmW:pageW, mmH:pageH };
}

function extractSVGSegments(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return [];
    const scale = svgToMmScale(svg);
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden';
    container.innerHTML = svgText;
    document.body.appendChild(container);
    const liveSvg = container.querySelector('svg');
    const segments = [];
    const shapes = liveSvg.querySelectorAll('path,line,rect,circle,ellipse,polyline,polygon');
    for (const el of shapes) {
        const points = [];
        if (el.getTotalLength) {
            const len = el.getTotalLength();
            const step = Math.max(0.5, len / 500);
            for (let d = 0; d <= len; d += step) { const p = el.getPointAtLength(d); points.push({ x: p.x*scale, y: p.y*scale }); }
            const pEnd = el.getPointAtLength(len); points.push({ x: pEnd.x*scale, y: pEnd.y*scale });
        }
        if (points.length >= 2) {
            const closed = ['polygon','rect','circle','ellipse'].includes(el.tagName) || /[zZ]\s*$/.test(el.getAttribute('d')||'');
            segments.push({ points, closed });
        }
    }
    document.body.removeChild(container);
    return segments;
}

// ───────── SVG Transparency ─────────
function createTransparentSvgImage(svgText, callback) {
    // Insert into DOM to use getComputedStyle for reliable fill detection
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden';
    container.innerHTML = svgText;
    document.body.appendChild(container);
    const svg = container.querySelector('svg');
    if (!svg) { document.body.removeChild(container); callback(null); return; }
    // Replace white fills with none in CSS <style> blocks (CorelDRAW uses CSS classes)
    for (const styleEl of svg.querySelectorAll('style')) {
        styleEl.textContent = styleEl.textContent
            .replace(/fill\s*:\s*white\b/gi, 'fill:none')
            .replace(/fill\s*:\s*#fff(?:fff)?\b/gi, 'fill:none')
            .replace(/fill\s*:\s*rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/gi, 'fill:none');
    }
    // Also remove rects with white computed fill (inline or attribute-based)
    for (const r of [...svg.querySelectorAll('rect')]) {
        const computed = window.getComputedStyle(r);
        const fill = (computed.fill || '').toLowerCase();
        const isWhite = fill === 'white' || fill === '#ffffff' || fill === '#fff' ||
            /rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/.test(fill);
        if (isWhite) r.remove();
    }
    svg.setAttribute('style', (svg.getAttribute('style') || '') + ';background:transparent');
    const serialized = new XMLSerializer().serializeToString(svg);
    document.body.removeChild(container);
    const blob = new Blob([serialized], {type:'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); callback(img); };
    img.onerror = () => { URL.revokeObjectURL(url); callback(null); };
    img.src = url;
}

// ───────── SVG Engrave (strip stroked elements) ─────────
// Any element with a visible stroke (including inherited) is a cut line — remove for engraving.
// Uses getComputedStyle to catch inherited strokes from parent <g> or <svg>.
function createEngraveSvgImage(svgText) {
    return new Promise((resolve) => {
        // Insert SVG into DOM so getComputedStyle works (detects inherited stroke)
        const container = document.createElement('div');
        container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden';
        container.innerHTML = svgText;
        document.body.appendChild(container);
        const svg = container.querySelector('svg');
        if (!svg) { document.body.removeChild(container); resolve(null); return; }
        // Check all shape elements for computed stroke
        const allShapes = svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,text,use');
        for (const el of allShapes) {
            const computed = window.getComputedStyle(el);
            const stroke = computed.stroke || '';
            // Remove if stroke is any color (not none, not empty)
            if (stroke && stroke !== 'none' && stroke !== '') {
                el.remove();
            }
        }
        // Also strip stroke from <g> and <svg> so remaining elements don't inherit it
        for (const g of svg.querySelectorAll('g,svg')) {
            g.removeAttribute('stroke');
            g.removeAttribute('stroke-width');
            const style = g.getAttribute('style') || '';
            if (style) g.setAttribute('style', style.replace(/stroke\s*:[^;]+;?/gi, '').replace(/stroke-width\s*:[^;]+;?/gi, ''));
        }
        svg.setAttribute('style', (svg.getAttribute('style') || '') + ';background:transparent');
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
        document.body.removeChild(container);
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}

// ───────── Raster Pipeline ─────────
function renderImageToGray(image, lineSpacing, bbox, dpmm) {
    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;
    const pxToMm = 25.4 / 96;
    const fullMmW = imgW * pxToMm, fullMmH = imgH * pxToMm;
    const fit = Math.min(WORK_W / fullMmW, WORK_H / fullMmH, 1);
    let cropMmX = 0, cropMmY = 0, cropMmW, cropMmH;
    if (bbox) { cropMmX = bbox.mmX; cropMmY = bbox.mmY; cropMmW = bbox.mmW; cropMmH = bbox.mmH; }
    else { cropMmW = fullMmW * fit; cropMmH = fullMmH * fit; }
    const pxW = Math.round(cropMmW * dpmm);
    const pxH = Math.round(cropMmH * dpmm / lineSpacing);
    const fullPxW = Math.round(fullMmW * fit * dpmm);
    const fullPxH = Math.round(fullMmH * fit * dpmm / lineSpacing);
    const srcX = Math.round(cropMmX / (fullMmW * fit) * fullPxW);
    const srcY = Math.round(cropMmY / (fullMmH * fit) * fullPxH);
    const fullC = document.createElement('canvas');
    fullC.width = fullPxW; fullC.height = fullPxH;
    fullC.getContext('2d').drawImage(image, 0, 0, fullPxW, fullPxH);
    const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
    const cx = c.getContext('2d');
    cx.drawImage(fullC, srcX, srcY, pxW, pxH, 0, 0, pxW, pxH);
    const id = cx.getImageData(0, 0, pxW, pxH); const px = id.data;
    const gray = new Float32Array(pxW * pxH);
    for (let i = 0; i < pxW * pxH; i++) {
        const a = px[i*4+3];
        if (a < 10) { gray[i] = 255; }
        else { const af = a/255; gray[i] = af*(0.299*px[i*4]+0.587*px[i*4+1]+0.114*px[i*4+2])+(1-af)*255; }
    }
    return { gray, width: pxW, height: pxH, offsetX: cropMmX, offsetY: cropMmY };
}

function processGray(srcGray, w, h, options) {
    const gray = new Float32Array(srcGray);
    if (options.brightness) for (let i = 0; i < gray.length; i++) gray[i] += options.brightness;
    if (options.contrast) {
        const f = (259*(options.contrast+255))/(255*(259-options.contrast));
        for (let i = 0; i < gray.length; i++) gray[i] = (gray[i]-128)*f+128;
    }
    for (let i = 0; i < gray.length; i++) gray[i] = Math.max(0, Math.min(255, gray[i]));
    if (options.invert) for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
    const out = new Uint8Array(w * h);
    const algo = options.algorithm || 'atkinson';
    if (algo==='threshold') { const t=options.threshold||128; for(let i=0;i<w*h;i++)out[i]=gray[i]>t?255:0; }
    else if (algo==='atkinson') ditherAtkinson(gray, out, w, h);
    else if (algo==='floyd-steinberg') ditherFloydSteinberg(gray, out, w, h);
    else if (algo==='stucki') ditherStucki(gray, out, w, h);
    else if (algo==='jarvis') ditherJarvis(gray, out, w, h);
    else if (algo==='halftone') ditherHalftone(gray, out, w, h);
    else if (algo==='bayer4') ditherBayer(gray, out, w, h, 4);
    else if (algo==='bayer8') ditherBayer(gray, out, w, h, 8);
    else ditherAtkinson(gray, out, w, h);
    return out;
}

function grayToBitmap(gray, w, h) {
    const rowBytes = Math.ceil(w / 8);
    const bitmap = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (gray[y*w+x] === 0) bitmap[y*rowBytes + Math.floor(x/8)] |= (1 << (7 - (x%8)));
    }
    return bitmap;
}

function grayToCanvas(gray, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d'); const id = cx.createImageData(w, h);
    for (let i = 0; i < w*h; i++) { const v=gray[i]; id.data[i*4]=v; id.data[i*4+1]=v; id.data[i*4+2]=v; id.data[i*4+3]=255; }
    cx.putImageData(id, 0, 0); return c;
}

// ───────── Dithering Algorithms ─────────
function ditherAtkinson(gray, out, w, h) {
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        const i=y*w+x, old=gray[i], nw=old>128?255:0; out[i]=nw; const d=(old-nw)/8;
        if(x+1<w)gray[i+1]+=d; if(x+2<w)gray[i+2]+=d;
        if(x-1>=0&&y+1<h)gray[i-1+w]+=d; if(y+1<h)gray[i+w]+=d;
        if(x+1<w&&y+1<h)gray[i+1+w]+=d; if(y+2<h)gray[i+2*w]+=d;
    }
}
function ditherFloydSteinberg(gray, out, w, h) {
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        const i=y*w+x, old=gray[i], nw=old>128?255:0; out[i]=nw; const err=old-nw;
        if(x+1<w)gray[i+1]+=err*7/16; if(x-1>=0&&y+1<h)gray[i-1+w]+=err*3/16;
        if(y+1<h)gray[i+w]+=err*5/16; if(x+1<w&&y+1<h)gray[i+1+w]+=err*1/16;
    }
}
function ditherStucki(gray, out, w, h) {
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        const i=y*w+x, old=gray[i], nw=old>128?255:0; out[i]=nw; const err=old-nw;
        if(x+1<w)gray[i+1]+=err*8/42; if(x+2<w)gray[i+2]+=err*4/42;
        if(y+1<h){if(x-2>=0)gray[i-2+w]+=err*2/42;if(x-1>=0)gray[i-1+w]+=err*4/42;gray[i+w]+=err*8/42;if(x+1<w)gray[i+1+w]+=err*4/42;if(x+2<w)gray[i+2+w]+=err*2/42;}
        if(y+2<h){const w2=2*w;if(x-2>=0)gray[i-2+w2]+=err*1/42;if(x-1>=0)gray[i-1+w2]+=err*2/42;gray[i+w2]+=err*4/42;if(x+1<w)gray[i+1+w2]+=err*2/42;if(x+2<w)gray[i+2+w2]+=err*1/42;}
    }
}
function ditherJarvis(gray, out, w, h) {
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        const i=y*w+x, old=gray[i], nw=old>128?255:0; out[i]=nw; const err=old-nw;
        if(x+1<w)gray[i+1]+=err*7/48; if(x+2<w)gray[i+2]+=err*5/48;
        if(y+1<h){if(x-2>=0)gray[i-2+w]+=err*3/48;if(x-1>=0)gray[i-1+w]+=err*5/48;gray[i+w]+=err*7/48;if(x+1<w)gray[i+1+w]+=err*5/48;if(x+2<w)gray[i+2+w]+=err*3/48;}
        if(y+2<h){const w2=2*w;if(x-2>=0)gray[i-2+w2]+=err*1/48;if(x-1>=0)gray[i-1+w2]+=err*3/48;gray[i+w2]+=err*5/48;if(x+1<w)gray[i+1+w2]+=err*3/48;if(x+2<w)gray[i+2+w2]+=err*1/48;}
    }
}
function ditherHalftone(gray, out, w, h) {
    const cs = Math.max(4, Math.round(w/350));
    for (let cy=0;cy<h;cy+=cs) for (let cx=0;cx<w;cx+=cs) {
        let sum=0,cnt=0;
        for(let dy=0;dy<cs&&cy+dy<h;dy++) for(let dx=0;dx<cs&&cx+dx<w;dx++){sum+=gray[(cy+dy)*w+(cx+dx)];cnt++;}
        const r=cs/2*Math.sqrt(1-sum/cnt/255), mx=cx+cs/2, my=cy+cs/2;
        for(let dy=0;dy<cs&&cy+dy<h;dy++) for(let dx=0;dx<cs&&cx+dx<w;dx++){
            out[(cy+dy)*w+(cx+dx)]=Math.sqrt((cx+dx-mx)**2+(cy+dy-my)**2)<=r?0:255;
        }
    }
}
function ditherBayer(gray, out, w, h, size) {
    const m4=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
    const m8=[[0,32,8,40,2,34,10,42],[48,16,56,24,50,18,58,26],[12,44,4,36,14,46,6,38],[60,28,52,20,62,30,54,22],[3,35,11,43,1,33,9,41],[51,19,59,27,49,17,57,25],[15,47,7,39,13,45,5,37],[63,31,55,23,61,29,53,21]];
    const m=size===8?m8:m4, n=m.length, d=n*n;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) out[y*w+x]=gray[y*w+x]>((m[y%n][x%n]+0.5)/d)*255?255:0;
}

// ───────── BMP Modal (Backend-powered, with client fallback) ─────────
const bmpModal = {
    panelState: null, panelPlog: null, panelDrawCanvas: null,
    sessionId: null,
    width: 0, height: 0, offsetX: 0, offsetY: 0, lineSpacing: 1,
    debounceTimer: null, abortCtrl: null,
    previewImg: null,
    // Client-side fallback fields
    clientMode: false,   // true when server can't handle the file
    clientGray: null,    // Float32Array grayscale source
    clientDpi: 1000,
    clientImg: null,     // cached engrave image (SVG without cut lines)
};

function bmpModalGetOptions() {
    return {
        algorithm: document.getElementById('bmpModalAlgo').value,
        brightness: parseInt(document.getElementById('bmpModalBright').value) || 0,
        contrast: parseInt(document.getElementById('bmpModalContrast').value) || 0,
        gamma: parseFloat(document.getElementById('bmpModalGamma').value) || 1.0,
        invert: document.getElementById('bmpModalInvert').checked,
        clahe: document.getElementById('bmpModalClahe').checked,
        unsharp: document.getElementById('bmpModalUnsharp').checked,
        threshold: 128,
    };
}

function bmpModalFitCanvas() {
    const canvas = document.getElementById('bmpModalCanvas');
    if (!bmpModal.width || !bmpModal.height) return;
    const container = document.getElementById('bmpModalPreviewArea');
    const cW = container.clientWidth - 20, cH = container.clientHeight - 20;
    const realAspect = bmpModal.width / (bmpModal.height * bmpModal.lineSpacing);
    let dW, dH;
    if (cW / cH > realAspect) { dH = cH; dW = dH * realAspect; }
    else { dW = cW; dH = dW / realAspect; }
    canvas.style.width = Math.round(dW) + 'px';
    canvas.style.height = Math.round(dH) + 'px';
}

async function openBmpModal(state, plog, drawCanvas) {
    const modal = document.getElementById('bmpPreviewModal');
    modal.style.display = '';
    bmpModal.panelState = state;
    bmpModal.panelPlog = plog;
    bmpModal.panelDrawCanvas = drawCanvas;
    bmpModal.lineSpacing = state.lineSpacing;
    bmpModal.sessionId = null;
    // Reset controls
    const isBmp = state.loadedFile && state.loadedFile.name.toLowerCase().endsWith('.bmp');
    document.getElementById('bmpModalAlgo').value = isBmp ? 'threshold' : 'atkinson';
    document.getElementById('bmpModalDpi').value = 1000;
    document.getElementById('bmpModalDpiNum').value = 1000;
    document.getElementById('bmpModalBright').value = 0;
    document.getElementById('bmpModalBrightNum').value = 0;
    document.getElementById('bmpModalContrast').value = 0;
    document.getElementById('bmpModalContrastNum').value = 0;
    document.getElementById('bmpModalGamma').value = 1.0;
    document.getElementById('bmpModalGammaNum').value = 1.0;
    document.getElementById('bmpModalInvert').checked = false;
    document.getElementById('bmpModalClahe').checked = false;
    document.getElementById('bmpModalUnsharp').checked = false;
    document.getElementById('bmpModalLoading').style.display = '';
    document.getElementById('bmpModalLoading').textContent = 'Subiendo imagen al servidor...';

    // Upload image to backend
    const formData = new FormData();
    formData.append('image', state.loadedFile);
    formData.append('dpi', '1000');
    formData.append('lineSpacing', String(state.lineSpacing));
    formData.append('algorithm', isBmp ? 'threshold' : 'atkinson');
    if (state.imageType === 'svg' && state._svgBBox) {
        const bb = state._svgBBox;
        formData.append('bboxMmX', String(bb.mmX));
        formData.append('bboxMmY', String(bb.mmY));
        formData.append('bboxMmW', String(bb.mmW));
        formData.append('bboxMmH', String(bb.mmH));
    }

    bmpModal.clientMode = false;
    bmpModal.clientGray = null;
    try {
        const res = await fetch('/api/laser/dither/upload', { method: 'POST', body: formData });
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        const data = await res.json();
        bmpModal.sessionId = data.sessionId;
        bmpModal.width = data.width;
        bmpModal.height = data.height;
        bmpModal.offsetX = data.offsetX;
        bmpModal.offsetY = data.offsetY;
        bmpModal.lineSpacing = data.lineSpacing;
        document.getElementById('bmpModalLoading').style.display = 'none';
        bmpModalShowPreview(data.preview, data.info);
    } catch (err) {
        // Fallback: client-side processing
        plog('Servidor no disponible, usando procesamiento local', 'warning');
        bmpModal.clientMode = true;
        bmpModal.clientDpi = 1000;
        const dpmm = 1000 / 25.4;
        const bbox = (state.imageType === 'svg' && state._svgBBox) ? state._svgBBox : null;
        // For SVGs, strip cut lines before rasterizing
        let img = state.loadedImage;
        if (state.imageType === 'svg' && state.svgText) {
            const engraveImg = await createEngraveSvgImage(state.svgText);
            if (engraveImg) img = engraveImg;
        }
        bmpModal.clientImg = img;
        const raw = renderImageToGray(img, state.lineSpacing, bbox, dpmm);
        bmpModal.clientGray = raw.gray;
        bmpModal.width = raw.width;
        bmpModal.height = raw.height;
        bmpModal.offsetX = raw.offsetX;
        bmpModal.offsetY = raw.offsetY;
        bmpModalProcessClient();
    }
}

function bmpModalShowPreview(base64Png, info) {
    const canvas = document.getElementById('bmpModalCanvas');
    const img = new Image();
    img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        bmpModalFitCanvas();
    };
    img.src = 'data:image/png;base64,' + base64Png;
    if (info) document.getElementById('bmpModalInfo').textContent = info;
}

async function bmpModalProcess() {
    if (bmpModal.clientMode) { bmpModalProcessClient(); return; }
    if (!bmpModal.sessionId) return;
    if (bmpModal.abortCtrl) bmpModal.abortCtrl.abort();
    bmpModal.abortCtrl = new AbortController();
    document.getElementById('bmpModalLoading').style.display = '';
    document.getElementById('bmpModalLoading').textContent = 'Procesando...';
    const opts = { sessionId: bmpModal.sessionId, ...bmpModalGetOptions() };
    try {
        const res = await fetch('/api/laser/dither/process', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts), signal: bmpModal.abortCtrl.signal,
        });
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        const data = await res.json();
        bmpModal.width = data.width;
        bmpModal.height = data.height;
        document.getElementById('bmpModalLoading').style.display = 'none';
        bmpModalShowPreview(data.preview, data.info);
    } catch (err) {
        if (err.name === 'AbortError') return;
        document.getElementById('bmpModalLoading').style.display = 'none';
    }
}

function bmpModalProcessClient() {
    if (!bmpModal.clientGray) return;
    const opts = bmpModalGetOptions();
    const w = bmpModal.width, h = bmpModal.height;
    const dithered = processGray(bmpModal.clientGray, w, h, opts);
    // Render to canvas preview
    const canvas = document.getElementById('bmpModalCanvas');
    canvas.width = w; canvas.height = h;
    const cx = canvas.getContext('2d');
    const imgData = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const v = dithered[i]; const idx = i * 4;
        imgData.data[idx] = v; imgData.data[idx+1] = v; imgData.data[idx+2] = v; imgData.data[idx+3] = 255;
    }
    cx.putImageData(imgData, 0, 0);
    bmpModalFitCanvas();
    const dpmm = bmpModal.clientDpi / 25.4;
    const mmW = (w / dpmm).toFixed(1), mmH = (h / dpmm * bmpModal.lineSpacing).toFixed(1);
    document.getElementById('bmpModalInfo').textContent = `${w}×${h}px | ${mmW}×${mmH}mm | ${bmpModal.clientDpi} DPI (local)`;
    document.getElementById('bmpModalLoading').style.display = 'none';
}

function bmpModalScheduleUpdate() {
    if (bmpModal.debounceTimer) clearTimeout(bmpModal.debounceTimer);
    bmpModal.debounceTimer = setTimeout(bmpModalProcess, 300);
}

function bmpModalOnDpiChange() {
    // DPI change requires re-render (new resolution)
    if (!bmpModal.panelState) return;
    if (bmpModal.clientMode) {
        // Client mode: re-render at new DPI using cached engrave image
        const newDpi = parseInt(document.getElementById('bmpModalDpi').value) || 1000;
        document.getElementById('bmpModalDpiNum').value = newDpi;
        bmpModal.clientDpi = newDpi;
        const dpmm = newDpi / 25.4;
        const state = bmpModal.panelState;
        const bbox = (state.imageType === 'svg' && state._svgBBox) ? state._svgBBox : null;
        const img = bmpModal.clientImg || state.loadedImage;
        const raw = renderImageToGray(img, state.lineSpacing, bbox, dpmm);
        bmpModal.clientGray = raw.gray;
        bmpModal.width = raw.width;
        bmpModal.height = raw.height;
        bmpModal.offsetX = raw.offsetX;
        bmpModal.offsetY = raw.offsetY;
        bmpModalProcessClient();
        return;
    }
    document.getElementById('bmpModalDpiNum').value = document.getElementById('bmpModalDpi').value;
    document.getElementById('bmpModalLoading').style.display = '';
    document.getElementById('bmpModalLoading').textContent = 'Re-renderizando...';
    // Re-upload with new DPI
    const state = bmpModal.panelState;
    const formData = new FormData();
    formData.append('image', state.loadedFile);
    formData.append('dpi', document.getElementById('bmpModalDpi').value);
    formData.append('lineSpacing', String(bmpModal.lineSpacing));
    formData.append('algorithm', document.getElementById('bmpModalAlgo').value);
    if (state.imageType === 'svg' && state._svgBBox) {
        const bb = state._svgBBox;
        formData.append('bboxMmX', String(bb.mmX));
        formData.append('bboxMmY', String(bb.mmY));
        formData.append('bboxMmW', String(bb.mmW));
        formData.append('bboxMmH', String(bb.mmH));
    }
    fetch('/api/laser/dither/upload', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (bmpModal.sessionId) fetch('/api/laser/dither/session/' + bmpModal.sessionId, { method: 'DELETE' });
            bmpModal.sessionId = data.sessionId;
            bmpModal.width = data.width;
            bmpModal.height = data.height;
            bmpModal.offsetX = data.offsetX;
            bmpModal.offsetY = data.offsetY;
            document.getElementById('bmpModalLoading').style.display = 'none';
            bmpModalShowPreview(data.preview, data.info);
            // Re-process with current options
            bmpModalProcess();
        })
        .catch(err => {
            document.getElementById('bmpModalLoading').textContent = 'Error: ' + err.message;
        });
}

async function bmpModalFinalize() {
    if (bmpModal.clientMode) { bmpModalFinalizeClient(); return; }
    if (!bmpModal.sessionId) return;
    document.getElementById('bmpModalLoading').style.display = '';
    document.getElementById('bmpModalLoading').textContent = 'Generando bitmap final...';
    const opts = { sessionId: bmpModal.sessionId, ...bmpModalGetOptions() };
    try {
        const res = await fetch('/api/laser/dither/finalize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts),
        });
        if (!res.ok) throw new Error('Finalize failed');
        const w = parseInt(res.headers.get('X-Bitmap-Width'));
        const h = parseInt(res.headers.get('X-Bitmap-Height'));
        const offX = parseFloat(res.headers.get('X-Offset-X'));
        const offY = parseFloat(res.headers.get('X-Offset-Y'));
        const bitmap = new Uint8Array(await res.arrayBuffer());

        // Create preview canvas from the bitmap
        const pvCanvas = document.createElement('canvas');
        pvCanvas.width = w; pvCanvas.height = h;
        const pvCx = pvCanvas.getContext('2d');
        const imgData = pvCx.createImageData(w, h);
        const d = imgData.data;
        const rowBytes = Math.ceil(w / 8);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const bit = (bitmap[y * rowBytes + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
            const idx = (y * w + x) * 4;
            const v = bit ? 0 : 255;
            d[idx] = v; d[idx + 1] = v; d[idx + 2] = v; d[idx + 3] = 255;
        }
        pvCx.putImageData(imgData, 0, 0);

        const state = bmpModal.panelState;
        const modalDpi = parseInt(document.getElementById('bmpModalDpi').value) || 1000;
        state.previewBitmapData = { canvas: pvCanvas, width: w, height: h, offsetX: offX, offsetY: offY, dpi: modalDpi };
        state.rasterResult = { bitmap, width: w, height: h, offsetX: offX, offsetY: offY, dpi: modalDpi };

        closeBmpModal();
        if (bmpModal.panelDrawCanvas) bmpModal.panelDrawCanvas();
        if (bmpModal.panelPlog) bmpModal.panelPlog(`Preview: ${w}×${h}px`, 'success');
    } catch (err) {
        document.getElementById('bmpModalLoading').textContent = 'Error: ' + err.message;
    }
}

function bmpModalFinalizeClient() {
    if (!bmpModal.clientGray) return;
    const opts = bmpModalGetOptions();
    const w = bmpModal.width, h = bmpModal.height;
    const dithered = processGray(bmpModal.clientGray, w, h, opts);
    const bitmap = grayToBitmap(dithered, w, h);
    const offX = bmpModal.offsetX, offY = bmpModal.offsetY;
    const modalDpi = bmpModal.clientDpi;

    // Create preview canvas
    const pvCanvas = document.createElement('canvas');
    pvCanvas.width = w; pvCanvas.height = h;
    const pvCx = pvCanvas.getContext('2d');
    const imgData = pvCx.createImageData(w, h);
    const d = imgData.data;
    const rowBytes = Math.ceil(w / 8);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const bit = (bitmap[y * rowBytes + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
        const idx = (y * w + x) * 4;
        const v = bit ? 0 : 255;
        d[idx] = v; d[idx+1] = v; d[idx+2] = v; d[idx+3] = 255;
    }
    pvCx.putImageData(imgData, 0, 0);

    const state = bmpModal.panelState;
    state.previewBitmapData = { canvas: pvCanvas, width: w, height: h, offsetX: offX, offsetY: offY, dpi: modalDpi };
    state.rasterResult = { bitmap, width: w, height: h, offsetX: offX, offsetY: offY, dpi: modalDpi };

    closeBmpModal();
    if (bmpModal.panelDrawCanvas) bmpModal.panelDrawCanvas();
    if (bmpModal.panelPlog) bmpModal.panelPlog(`Preview: ${w}×${h}px (local)`, 'success');
}

function closeBmpModal() {
    document.getElementById('bmpPreviewModal').style.display = 'none';
    if (bmpModal.sessionId) {
        fetch('/api/laser/dither/session/' + bmpModal.sessionId, { method: 'DELETE' }).catch(() => {});
    }
    bmpModal.sessionId = null;
}

// ───────── Auto-generate raster (for simulation without BMP config) ─────────
async function autoGenerateRaster(state) {
    const isBmp = state.loadedFile && state.loadedFile.name.toLowerCase().endsWith('.bmp');
    // Try server first, fall back to client-side Canvas pipeline
    try {
        const formData = new FormData();
        formData.append('image', state.loadedFile);
        formData.append('dpi', '300');
        formData.append('lineSpacing', String(state.lineSpacing));
        formData.append('algorithm', isBmp ? 'threshold' : 'atkinson');
        if (state.imageType === 'svg' && state._svgBBox) {
            const bb = state._svgBBox;
            formData.append('bboxMmX', String(bb.mmX));
            formData.append('bboxMmY', String(bb.mmY));
            formData.append('bboxMmW', String(bb.mmW));
            formData.append('bboxMmH', String(bb.mmH));
        }
        const uploadRes = await fetch('/api/laser/dither/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) throw new Error((await uploadRes.json()).error || uploadRes.statusText);
        const uploadData = await uploadRes.json();
        const sessionId = uploadData.sessionId;
        const finalRes = await fetch('/api/laser/dither/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId, algorithm: isBmp ? 'threshold' : 'atkinson',
                brightness: 0, contrast: 0, gamma: 1.0,
                invert: false, clahe: false, unsharp: false, threshold: 128,
            }),
        });
        if (!finalRes.ok) throw new Error('Finalize failed');
        const w = parseInt(finalRes.headers.get('X-Bitmap-Width'));
        const h = parseInt(finalRes.headers.get('X-Bitmap-Height'));
        const offX = parseFloat(finalRes.headers.get('X-Offset-X'));
        const offY = parseFloat(finalRes.headers.get('X-Offset-Y'));
        const bitmap = new Uint8Array(await finalRes.arrayBuffer());
        fetch('/api/laser/dither/session/' + sessionId, { method: 'DELETE' }).catch(() => {});
        return { bitmap, width: w, height: h, offsetX: offX, offsetY: offY, dpi: 300 };
    } catch (_serverErr) {
        // Fallback: client-side Canvas pipeline (works with any image the browser can display)
        const dpmm = 300 / 25.4;
        const bbox = (state.imageType === 'svg' && state._svgBBox) ? state._svgBBox : null;
        // For SVGs, strip cut lines (stroke-only elements) before rasterizing
        let img = state.loadedImage;
        if (state.imageType === 'svg' && state.svgText) {
            const engraveImg = await createEngraveSvgImage(state.svgText);
            if (engraveImg) img = engraveImg;
        }
        const raw = renderImageToGray(img, state.lineSpacing, bbox, dpmm);
        const processed = processGray(raw.gray, raw.width, raw.height, {
            brightness: 0, contrast: 0, algorithm: isBmp ? 'threshold' : 'atkinson', invert: false,
        });
        const bitmap = grayToBitmap(processed, raw.width, raw.height);
        return { bitmap, width: raw.width, height: raw.height, offsetX: raw.offsetX, offsetY: raw.offsetY, dpi: 300 };
    }
}

// ───────── Laser Simulation Preview ─────────
const laserSim = {
    state: null, plog: null, drawCanvas: null,
    playing: false, animFrame: null,
    commands: [],       // [{type:'move'|'cut', x, y}]
    cmdIndex: 0,
    headX: 0, headY: 0,
    speed: 5,
    // Offscreen buffer canvases for trails (avoid re-drawing thousands of lines)
    bufferCut: null,    // canvas for cut trails
    bufferMove: null,   // canvas for move trails
    bufW: 0, bufH: 0,
    isRaster: false,
};

function openLaserSim(panelState, plog, drawCanvas) {
    const modal = document.getElementById('laserSimModal');
    modal.style.display = '';
    laserSim.state = panelState;
    laserSim.plog = plog;
    laserSim.drawCanvas = drawCanvas;
    laserSim.playing = false;
    laserSim.cmdIndex = 0;
    laserSim.headX = 0; laserSim.headY = 0;
    laserSim.speed = 5;
    laserSim.isRaster = !(panelState.mode === 'cut' && panelState.imageType === 'svg');
    document.getElementById('simSpeedSlider').value = 5;
    document.getElementById('simSpeedLabel').textContent = '5×';
    document.getElementById('simPlayBtn').innerHTML = '<i class="fas fa-play"></i>';

    // Build command list based on mode
    laserSim.commands = buildSimCommands(panelState);

    // Calculate estimated distance
    let cutDist = 0, moveDist = 0;
    let px = 0, py = 0;
    for (const cmd of laserSim.commands) {
        const d = Math.sqrt((cmd.x - px) ** 2 + (cmd.y - py) ** 2);
        if (cmd.type === 'cut') cutDist += d; else moveDist += d;
        px = cmd.x; py = cmd.y;
    }
    const estTime = cutDist / panelState.speed;

    document.getElementById('simInfoBox').innerHTML =
        `<b>Modo:</b> ${panelState.mode === 'cut' ? 'Corte' : 'Grabado'}<br>` +
        `<b>Comandos:</b> ${laserSim.commands.length.toLocaleString()}<br>` +
        `<b>Dist. corte:</b> ${cutDist.toFixed(0)} mm<br>` +
        `<b>Dist. viaje:</b> ${moveDist.toFixed(0)} mm<br>` +
        `<b>Vel.:</b> ${panelState.speed} mm/s<br>` +
        `<b>Est.:</b> ${formatSimTime(estTime)}`;

    document.getElementById('simProgressLabel').textContent = '0%';
    document.getElementById('simProgressBar').style.width = '0%';
    document.getElementById('simTimeLabel').textContent = formatSimTime(estTime);

    simFitCanvas();
    simInitBuffers();
    simDrawFrame();
}

function formatSimTime(s) {
    if (!isFinite(s) || s < 0) return '--:--';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function buildSimCommands(state) {
    const cmds = [];
    if (state.mode === 'cut' && state.imageType === 'svg' && state.svgText) {
        // Vector cut mode: follow SVG segments
        const segments = extractSVGSegments(state.svgText);
        for (const seg of segments) {
            if (seg.points.length < 2) continue;
            cmds.push({ type: 'move', x: seg.points[0].x, y: seg.points[0].y });
            for (let i = 1; i < seg.points.length; i++) {
                cmds.push({ type: 'cut', x: seg.points[i].x, y: seg.points[i].y });
            }
            if (seg.closed) cmds.push({ type: 'cut', x: seg.points[0].x, y: seg.points[0].y });
        }
    } else {
        // Engrave mode: simulate raster scanning
        const rd = state.rasterResult || state.previewBitmapData;
        if (rd) {
            const w = rd.width, h = rd.height;
            const offX = rd.offsetX || 0, offY = rd.offsetY || 0;
            const ls = state.lineSpacing;
            const rdDpi = rd.dpi || 1000;
            const pxToMm = 25.4 / rdDpi;
            const rowBytes = Math.ceil(w / 8);
            let getBit;
            if (rd.bitmap) {
                getBit = (x, y) => (rd.bitmap[y * rowBytes + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
            } else if (rd.canvas) {
                const pvCx = rd.canvas.getContext('2d');
                const imgData = pvCx.getImageData(0, 0, w, h);
                getBit = (x, y) => imgData.data[(y * w + x) * 4] === 0 ? 1 : 0;
            } else return cmds;

            // Target ~400 visible rows for smooth animation
            const maxRows = 800;
            const rowStep = Math.max(1, Math.floor(h / maxRows));

            for (let y = 0; y < h; y += rowStep) {
                const mmY = offY + y * pxToMm * ls;
                const rowIdx = Math.floor(y / rowStep);
                const ltr = (rowIdx % 2 === 0);

                // Run-length encode this row: find start/end of burn runs
                // Scan left-to-right always, then reverse if needed
                let runs = []; // [{startPx, endPx}]
                let runStart = -1;
                for (let x = 0; x < w; x++) {
                    const bit = getBit(x, y);
                    if (bit && runStart < 0) runStart = x;
                    else if (!bit && runStart >= 0) { runs.push({ s: runStart, e: x - 1 }); runStart = -1; }
                }
                if (runStart >= 0) runs.push({ s: runStart, e: w - 1 });

                if (runs.length === 0) continue; // empty row, skip entirely

                // Move to start of line
                const startX = ltr ? offX : offX + (w - 1) * pxToMm;
                cmds.push({ type: 'move', x: startX, y: mmY });

                if (!ltr) runs.reverse(); // reverse order for right-to-left

                let lastX = ltr ? 0 : w - 1;
                for (const run of runs) {
                    const rs = ltr ? run.s : run.e;
                    const re = ltr ? run.e : run.s;
                    // Move to start of run (if not already there)
                    if (rs !== lastX) {
                        cmds.push({ type: 'move', x: offX + rs * pxToMm, y: mmY });
                    }
                    // Cut to end of run
                    cmds.push({ type: 'cut', x: offX + re * pxToMm, y: mmY });
                    lastX = re;
                }
            }
        } else {
            // No bitmap yet: zigzag pattern showing raster direction
            const bb = state._svgBBox;
            let ox, oy, mw, mh;
            if (bb) { ox = bb.mmX; oy = bb.mmY; mw = bb.mmW; mh = bb.mmH; }
            else {
                const img = state.loadedImage;
                const imgW = img.naturalWidth || img.width;
                const imgH = img.naturalHeight || img.height;
                const pxToMm = 25.4 / 96;
                const rW = imgW * pxToMm, rH = imgH * pxToMm;
                const fit = Math.min(WORK_W / rW, WORK_H / rH, 1);
                mw = rW * fit; mh = rH * fit;
                ox = (WORK_W - mw) / 2; oy = (WORK_H - mh) / 2;
            }
            // Use ~200 lines max for the preview pattern
            const stepMm = Math.max(mh / 200, state.lineSpacing * 0.025);
            const rows = Math.ceil(mh / stepMm);
            for (let r = 0; r < rows; r++) {
                const y = oy + r * stepMm;
                const ltr = (r % 2 === 0);
                cmds.push({ type: 'move', x: ltr ? ox : ox + mw, y });
                cmds.push({ type: 'cut', x: ltr ? ox + mw : ox, y });
            }
        }
    }
    if (cmds.length > 0) cmds.push({ type: 'move', x: 0, y: 0 });
    return cmds;
}

function simFitCanvas() {
    const canvas = document.getElementById('simCanvas');
    const area = document.getElementById('simCanvasArea');
    const maxW = area.clientWidth - 20;
    const maxH = area.clientHeight - 20;
    const aspect = WORK_W / WORK_H;
    let w = maxW, h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = Math.round(w) + 'px';
    canvas.style.height = Math.round(h) + 'px';
}

function simInitBuffers() {
    const canvas = document.getElementById('simCanvas');
    const w = canvas.width, h = canvas.height;
    laserSim.bufW = w; laserSim.bufH = h;
    // Create offscreen buffer for cut trails
    laserSim.bufferCut = document.createElement('canvas');
    laserSim.bufferCut.width = w; laserSim.bufferCut.height = h;
    // Create offscreen buffer for move trails
    laserSim.bufferMove = document.createElement('canvas');
    laserSim.bufferMove.width = w; laserSim.bufferMove.height = h;
}

function simDrawFrame() {
    const canvas = document.getElementById('simCanvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Background + grid
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);
    const gx = W / (WORK_W / 10), gy = H / (WORK_H / 10);
    ctx.strokeStyle = 'rgba(88,166,255,0.07)'; ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x += gx) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += gy) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(88,166,255,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.fillStyle = '#3fb950';
    ctx.beginPath(); ctx.arc(4, 4, 2.5, 0, Math.PI * 2); ctx.fill();

    // Composite the buffer canvases (all accumulated trails)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // raw pixel space
    if (laserSim.bufferMove) { ctx.globalAlpha = 0.3; ctx.drawImage(laserSim.bufferMove, 0, 0); }
    if (laserSim.bufferCut) { ctx.globalAlpha = 1.0; ctx.drawImage(laserSim.bufferCut, 0, 0); }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Laser head
    const scaleX = W / WORK_W, scaleY = H / WORK_H;
    const hx = laserSim.headX * scaleX;
    const hy = laserSim.headY * scaleY;
    // Glow
    const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, 10);
    grad.addColorStop(0, 'rgba(0,212,255,0.9)');
    grad.addColorStop(0.4, 'rgba(0,212,255,0.3)');
    grad.addColorStop(1, 'rgba(0,212,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(hx - 10, hy - 10, 20, 20);
    // Dot
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(hx, hy, 1.2, 0, Math.PI * 2); ctx.fill();
    // Crosshair
    ctx.strokeStyle = 'rgba(0,212,255,0.3)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();

    document.getElementById('simPosLabel').textContent =
        `X: ${laserSim.headX.toFixed(1)}  Y: ${laserSim.headY.toFixed(1)}`;
}

function simStep(count) {
    const cmds = laserSim.commands;
    if (laserSim.cmdIndex >= cmds.length) { simPause(); return; }

    const dpr = window.devicePixelRatio || 1;
    const W = laserSim.bufW / dpr;
    const H = laserSim.bufH / dpr;
    const scaleX = W / WORK_W, scaleY = H / WORK_H;
    const isRaster = laserSim.isRaster;

    // Draw new trail segments directly onto the buffer canvases
    const cutCtx = laserSim.bufferCut.getContext('2d');
    const moveCtx = laserSim.bufferMove.getContext('2d');

    // Setup cut trail style
    cutCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cutCtx.strokeStyle = '#00d4ff';
    cutCtx.lineWidth = isRaster ? 0.8 : 1.5;
    cutCtx.shadowColor = isRaster ? 'transparent' : '#00d4ff';
    cutCtx.shadowBlur = isRaster ? 0 : 3;
    cutCtx.beginPath();

    // Setup move trail style
    moveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    moveCtx.strokeStyle = '#58a6ff';
    moveCtx.lineWidth = 0.5;
    moveCtx.setLineDash([3, 3]);
    moveCtx.beginPath();

    let hasCut = false, hasMove = false;

    for (let i = 0; i < count && laserSim.cmdIndex < cmds.length; i++) {
        const cmd = cmds[laserSim.cmdIndex];
        const x1 = laserSim.headX * scaleX, y1 = laserSim.headY * scaleY;
        const x2 = cmd.x * scaleX, y2 = cmd.y * scaleY;

        if (cmd.type === 'cut') {
            cutCtx.moveTo(x1, y1); cutCtx.lineTo(x2, y2);
            hasCut = true;
        } else {
            moveCtx.moveTo(x1, y1); moveCtx.lineTo(x2, y2);
            hasMove = true;
        }
        laserSim.headX = cmd.x;
        laserSim.headY = cmd.y;
        laserSim.cmdIndex++;
    }

    if (hasCut) cutCtx.stroke();
    if (hasMove) moveCtx.stroke();
    moveCtx.setLineDash([]);
    cutCtx.shadowBlur = 0;

    // Update progress
    const pct = cmds.length > 0 ? Math.round((laserSim.cmdIndex / cmds.length) * 100) : 0;
    document.getElementById('simProgressLabel').textContent = pct + '%';
    document.getElementById('simProgressBar').style.width = pct + '%';
}

function simAnimate() {
    if (!laserSim.playing) return;
    const speed = laserSim.speed;
    const stepsPerFrame = Math.max(1, Math.round(speed * speed * 0.4));
    simStep(stepsPerFrame);
    simDrawFrame();
    if (laserSim.cmdIndex < laserSim.commands.length) {
        laserSim.animFrame = requestAnimationFrame(simAnimate);
    } else {
        simPause();
    }
}

function simPlay() {
    if (laserSim.cmdIndex >= laserSim.commands.length) simRestart();
    laserSim.playing = true;
    document.getElementById('simPlayBtn').innerHTML = '<i class="fas fa-pause"></i>';
    laserSim.animFrame = requestAnimationFrame(simAnimate);
}

function simPause() {
    laserSim.playing = false;
    if (laserSim.animFrame) { cancelAnimationFrame(laserSim.animFrame); laserSim.animFrame = null; }
    document.getElementById('simPlayBtn').innerHTML = '<i class="fas fa-play"></i>';
}

function simRestart() {
    simPause();
    laserSim.cmdIndex = 0;
    laserSim.headX = 0; laserSim.headY = 0;
    simInitBuffers(); // Clear the buffer canvases
    document.getElementById('simProgressLabel').textContent = '0%';
    document.getElementById('simProgressBar').style.width = '0%';
    simDrawFrame();
}

function closeLaserSim() {
    simPause();
    document.getElementById('laserSimModal').style.display = 'none';
}

// ───────── Init ─────────
panels[0] = createPanel(0);
panels[1] = createPanel(1);

// Modal event listeners
document.getElementById('bmpModalCancel').addEventListener('click', closeBmpModal);
document.getElementById('bmpModalFinish').addEventListener('click', bmpModalFinalize);
document.getElementById('bmpModalAlgo').addEventListener('change', bmpModalScheduleUpdate);
// Sync slider ↔ number input bidireccional
function syncSliderNum(sliderId, numId, onChange) {
    const slider = document.getElementById(sliderId);
    const num = document.getElementById(numId);
    slider.addEventListener('input', () => { num.value = slider.value; if (onChange) onChange(); });
    num.addEventListener('input', () => {
        const v = Math.max(+slider.min, Math.min(+slider.max, +num.value || 0));
        slider.value = v; if (onChange) onChange();
    });
}
syncSliderNum('bmpModalBright', 'bmpModalBrightNum', bmpModalScheduleUpdate);
syncSliderNum('bmpModalContrast', 'bmpModalContrastNum', bmpModalScheduleUpdate);
syncSliderNum('bmpModalGamma', 'bmpModalGammaNum', bmpModalScheduleUpdate);
syncSliderNum('bmpModalDpi', 'bmpModalDpiNum');
document.getElementById('bmpModalDpi').addEventListener('change', bmpModalOnDpiChange);
document.getElementById('bmpModalDpiNum').addEventListener('change', bmpModalOnDpiChange);
document.getElementById('bmpModalInvert').addEventListener('change', bmpModalScheduleUpdate);
document.getElementById('bmpModalClahe').addEventListener('change', bmpModalScheduleUpdate);
document.getElementById('bmpModalUnsharp').addEventListener('change', bmpModalScheduleUpdate);
// Cerrar modal con Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (document.getElementById('laserSimModal').style.display !== 'none') closeLaserSim();
        else if (document.getElementById('bmpPreviewModal').style.display !== 'none') closeBmpModal();
    }
});
// Simulation modal event listeners
document.getElementById('simCloseBtn').addEventListener('click', closeLaserSim);
document.getElementById('simPlayBtn').addEventListener('click', () => {
    laserSim.playing ? simPause() : simPlay();
});
document.getElementById('simRestartBtn').addEventListener('click', simRestart);
document.getElementById('simStepBtn').addEventListener('click', () => {
    if (laserSim.playing) simPause();
    const speed = laserSim.speed;
    simStep(Math.max(1, Math.round(speed * speed * 0.2)));
    simDrawFrame();
});
document.getElementById('simSpeedSlider').addEventListener('input', e => {
    laserSim.speed = +e.target.value;
    document.getElementById('simSpeedLabel').textContent = e.target.value + '×';
});

function sendCmd(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

let _wsOnOpenCallbacks = [];

function connectWebSocket(onReady) {
    if (onReady) _wsOnOpenCallbacks.push(onReady);
    if (ws && ws.readyState === 1) { _wsOnOpenCallbacks.forEach(cb => cb()); _wsOnOpenCallbacks = []; return; }
    if (ws && ws.readyState === 0) return; // ya está conectando
    ws = new WebSocket('ws://localhost:7654');
    ws.onopen = () => {
        _wsOnOpenCallbacks.forEach(cb => cb());
        _wsOnOpenCallbacks = [];
    };
    ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const msg = JSON.parse(e.data);
        const machineId = msg.machine != null ? msg.machine : null;
        if (machineId != null && panels[machineId]) {
            panels[machineId].handleMessage(msg);
        }
        // Mensajes sin machine ID no se envían a ningún panel (evitar duplicados)
    };
    ws.onclose = () => {
        ws = null;
        for (const p of [panels[0], panels[1]]) {
            p.state.connected = false;
            p.el.querySelector('[data-ref="statusDot"]').classList.remove('connected');
            p.el.querySelector('[data-ref="connectBtn"]').textContent = 'Conectar';
            p.plog('Desconectado', 'warning');
        }
    };
}

window.addEventListener('resize', () => {
    panels[0].setupCanvas(); panels[1].setupCanvas();
    if (document.getElementById('laserSimModal').style.display !== 'none') { simFitCanvas(); simDrawFrame(); }
});
setTimeout(() => { panels[0].setupCanvas(); panels[1].setupCanvas(); }, 100);
