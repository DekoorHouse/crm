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
                const pvMmW = pv.width / 39.37;
                const pvMmH = pv.height / 39.37 * state.lineSpacing;
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
                const blob = new Blob([e.target.result], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    state.loadedImage = img; state.imageType = 'svg'; state.loadedFile = file;
                    state.designSelected = false; state.previewBitmapData = null; state.rasterResult = null;
                    ref('fileName').textContent = file.name; ref('fileInfo').style.display = ''; dropZone.style.display = 'none';
                    URL.revokeObjectURL(url); drawCanvas();
                    plog(`SVG: ${file.name}`, 'success');
                };
                img.src = url;
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
            const mmW = (rd.width / 39.37).toFixed(1), mmH = (rd.height / 39.37 * state.lineSpacing).toFixed(1);
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
    const shapes = liveSvg.querySelectorAll('path,line,rect,circle,ellipse,polyline,polygon,text,image,use,g');
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const el of shapes) { try { const b=el.getBBox(); if(b.width===0&&b.height===0)continue; minX=Math.min(minX,b.x); minY=Math.min(minY,b.y); maxX=Math.max(maxX,b.x+b.width); maxY=Math.max(maxY,b.y+b.height); } catch(_){} }
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
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) { callback(null); return; }
    const vb = svg.getAttribute('viewBox');
    let svgW, svgH;
    if (vb) { const p = vb.split(/[\s,]+/).map(Number); svgW = p[2]; svgH = p[3]; }
    else { svgW = parseFloat(svg.getAttribute('width'))||300; svgH = parseFloat(svg.getAttribute('height'))||200; }
    // Eliminar rects de fondo (primer rect que cubre todo el SVG con fill blanco)
    for (const r of svg.querySelectorAll('rect')) {
        const x = parseFloat(r.getAttribute('x')||0), y = parseFloat(r.getAttribute('y')||0);
        const w = parseFloat(r.getAttribute('width')||0), h = parseFloat(r.getAttribute('height')||0);
        const fill = (r.getAttribute('fill')||'').toLowerCase().replace(/\s/g,'');
        if (x<=0 && y<=0 && Math.abs(w-svgW)<1 && Math.abs(h-svgH)<1 &&
            (fill===''||fill==='white'||fill==='#ffffff'||fill==='#fff'||fill==='rgb(255,255,255)')) {
            r.remove(); break;
        }
    }
    svg.setAttribute('style','background:transparent');
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {type:'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); callback(img); };
    img.onerror = () => { URL.revokeObjectURL(url); callback(null); };
    img.src = url;
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

// ───────── BMP Modal ─────────
const bmpModal = {
    panelState: null, panelPlog: null, panelDrawCanvas: null,
    sourceImage: null, grayData: null,
    width: 0, height: 0, offsetX: 0, offsetY: 0, lineSpacing: 1,
    debounceTimer: null,
};

function openBmpModal(state, plog, drawCanvas) {
    const modal = document.getElementById('bmpPreviewModal');
    modal.style.display = '';
    bmpModal.panelState = state;
    bmpModal.panelPlog = plog;
    bmpModal.panelDrawCanvas = drawCanvas;
    bmpModal.lineSpacing = state.lineSpacing;
    // Reset controls
    const isBmp = state.loadedFile && state.loadedFile.name.toLowerCase().endsWith('.bmp');
    document.getElementById('bmpModalAlgo').value = isBmp ? 'threshold' : 'atkinson';
    document.getElementById('bmpModalDpi').value = 1000;
    document.getElementById('bmpModalDpiNum').value = 1000;
    document.getElementById('bmpModalBright').value = 0;
    document.getElementById('bmpModalBrightNum').value = 0;
    document.getElementById('bmpModalContrast').value = 0;
    document.getElementById('bmpModalContrastNum').value = 0;
    document.getElementById('bmpModalInvert').checked = false;
    document.getElementById('bmpModalLoading').style.display = '';
    document.getElementById('bmpModalLoading').textContent = 'Renderizando...';
    // Para SVGs, crear imagen transparente (sin fondo blanco)
    if (state.imageType === 'svg' && state.svgText) {
        createTransparentSvgImage(state.svgText, (timg) => {
            bmpModalRender(timg || state.loadedImage, state);
        });
    } else {
        bmpModalRender(state.loadedImage, state);
    }
}

function bmpModalRender(image, state) {
    const dpmm = parseInt(document.getElementById('bmpModalDpi').value) / 25.4;
    const bbox = (state.imageType === 'svg' && state._svgBBox) ? state._svgBBox : null;
    const result = renderImageToGray(image, bmpModal.lineSpacing, bbox, dpmm);
    bmpModal.sourceImage = image;
    bmpModal.grayData = result.gray;
    bmpModal.width = result.width;
    bmpModal.height = result.height;
    bmpModal.offsetX = result.offsetX;
    bmpModal.offsetY = result.offsetY;
    document.getElementById('bmpModalLoading').style.display = 'none';
    bmpModalUpdatePreview();
}

function bmpModalUpdatePreview() {
    if (!bmpModal.grayData) return;
    const options = {
        brightness: parseInt(document.getElementById('bmpModalBright').value),
        contrast: parseInt(document.getElementById('bmpModalContrast').value),
        algorithm: document.getElementById('bmpModalAlgo').value,
        invert: document.getElementById('bmpModalInvert').checked,
        threshold: 128,
    };
    const processed = processGray(bmpModal.grayData, bmpModal.width, bmpModal.height, options);
    const c = grayToCanvas(processed, bmpModal.width, bmpModal.height);
    const canvas = document.getElementById('bmpModalCanvas');
    canvas.width = c.width; canvas.height = c.height;
    canvas.getContext('2d').drawImage(c, 0, 0);
    // Corregir aspect ratio: lineSpacing comprime la altura, estirar visualmente
    canvas.style.aspectRatio = `${bmpModal.width} / ${bmpModal.height * bmpModal.lineSpacing}`;
    const dpi = parseInt(document.getElementById('bmpModalDpi').value);
    const dpmm = dpi / 25.4;
    const mmW = (bmpModal.width / dpmm).toFixed(1);
    const mmH = (bmpModal.height / dpmm * bmpModal.lineSpacing).toFixed(1);
    document.getElementById('bmpModalInfo').textContent = `${bmpModal.width}×${bmpModal.height}px | ${mmW}×${mmH}mm | ${dpi} DPI`;
}

function bmpModalScheduleUpdate() {
    if (bmpModal.debounceTimer) cancelAnimationFrame(bmpModal.debounceTimer);
    bmpModal.debounceTimer = requestAnimationFrame(bmpModalUpdatePreview);
}

function bmpModalOnDpiChange() {
    if (!bmpModal.sourceImage || !bmpModal.panelState) return;
    // Sync slider ↔ number
    document.getElementById('bmpModalDpiNum').value = document.getElementById('bmpModalDpi').value;
    document.getElementById('bmpModalLoading').style.display = '';
    document.getElementById('bmpModalLoading').textContent = 'Re-renderizando...';
    setTimeout(() => bmpModalRender(bmpModal.sourceImage, bmpModal.panelState), 30);
}

function bmpModalFinalize() {
    const options = {
        brightness: parseInt(document.getElementById('bmpModalBright').value),
        contrast: parseInt(document.getElementById('bmpModalContrast').value),
        algorithm: document.getElementById('bmpModalAlgo').value,
        invert: document.getElementById('bmpModalInvert').checked,
        threshold: 128,
    };
    const processed = processGray(bmpModal.grayData, bmpModal.width, bmpModal.height, options);
    const bitmap = grayToBitmap(processed, bmpModal.width, bmpModal.height);
    const pvCanvas = grayToCanvas(processed, bmpModal.width, bmpModal.height);
    const state = bmpModal.panelState;
    state.previewBitmapData = {
        canvas: pvCanvas, width: bmpModal.width, height: bmpModal.height,
        offsetX: bmpModal.offsetX, offsetY: bmpModal.offsetY,
    };
    state.rasterResult = {
        bitmap, width: bmpModal.width, height: bmpModal.height,
        offsetX: bmpModal.offsetX, offsetY: bmpModal.offsetY,
    };
    closeBmpModal();
    if (bmpModal.panelDrawCanvas) bmpModal.panelDrawCanvas();
    const dpmm = parseInt(document.getElementById('bmpModalDpi').value) / 25.4;
    const mmW = (bmpModal.width / dpmm).toFixed(1), mmH = (bmpModal.height / dpmm * bmpModal.lineSpacing).toFixed(1);
    if (bmpModal.panelPlog) bmpModal.panelPlog(`Preview: ${bmpModal.width}×${bmpModal.height}px → ${mmW}×${mmH}mm`, 'success');
}

function closeBmpModal() {
    document.getElementById('bmpPreviewModal').style.display = 'none';
    bmpModal.grayData = null; bmpModal.sourceImage = null;
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
syncSliderNum('bmpModalDpi', 'bmpModalDpiNum');
document.getElementById('bmpModalDpi').addEventListener('change', bmpModalOnDpiChange);
document.getElementById('bmpModalDpiNum').addEventListener('change', bmpModalOnDpiChange);
document.getElementById('bmpModalInvert').addEventListener('change', bmpModalScheduleUpdate);
// Cerrar modal con Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('bmpPreviewModal').style.display !== 'none') closeBmpModal();
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

window.addEventListener('resize', () => { panels[0].setupCanvas(); panels[1].setupCanvas(); });
setTimeout(() => { panels[0].setupCanvas(); panels[1].setupCanvas(); }, 100);
