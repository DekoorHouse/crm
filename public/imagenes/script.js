(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const state = { models: [], linkedIds: [], connected: false, qwen: null, qwenTimer: null, references: [], jobs: [], nextCursor: null, active: null, current: null, polling: null, busy: false, started: false };
    const portal = window.createImageStudioPortal({ canvas: $('generation-portal'), field: $('generation-portal-field'), pauseButton: $('generation-pause'), pauseStatus: $('generation-motion-status') });
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = value => value == null ? 'Costo no reportado' : `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value)} USD`;
    function notice(text = '', error = false) { $('notice').textContent = text; $('notice').hidden = !text; $('notice').classList.toggle('error', error); }
    function requireSession() {
        state.connected = false;
        $('session-required').hidden = false;
        $('connection').className = 'connection error';
        $('connection').innerHTML = '<span></span>Inicia sesión';
        if (!state.models.length) {
            $('model').replaceChildren(new Option('Inicia sesión para elegir un modelo', ''));
            $('model').disabled = true;
        }
        renderOptions();
    }
    async function api(path, options = {}) {
        const response = await fetch(`/api/imagenes${path}`, options);
        if (response.status === 401) requireSession();
        let data;
        try { data = await response.json(); } catch (_) { throw new Error('No se pudo leer la respuesta del servidor. Intenta de nuevo.'); }
        if (!response.ok || data.success === false) throw Object.assign(new Error(data.error || 'No se pudo completar la operación.'), { status: response.status });
        return data;
    }
    function model() { return state.models.find(m => m.id === $('model').value); }
    function applyModels(data) {
        $('session-required').hidden = true;
        Object.assign(state, { models: data.models, linkedIds: data.linkedIds, connected: data.connected, qwen: data.qwen || null });
        const previous = $('model').value || localStorage.getItem('imageStudioModel');
        const linked = state.models.filter(m => state.linkedIds.includes(m.id));
        $('model').replaceChildren(...(linked.length ? linked.map(m => new Option(m.name, m.id)) : [new Option('Vincula un modelo para empezar', '')]));
        if (linked.some(m => m.id === previous)) $('model').value = previous;
        $('model').disabled = !linked.length;
        $('connection').className = `connection ${data.connected ? 'ready' : 'error'}`;
        $('connection').innerHTML = `<span></span>${data.connected ? 'OpenRouter conectado' : 'OpenRouter sin conectar'}`;
        if (!data.connected) notice('Falta configurar la conexión de OpenRouter en el servidor.', true);
        renderOptions(); renderCatalog();
    }
    function renderOptions() {
        const selected = model();
        const labels = { auto: 'Automático', low: 'Baja', medium: 'Media', high: 'Alta', xhigh: 'Muy alta', max: 'Máxima', '1:1': '1:1 · Cuadrado', '16:9': '16:9 · Horizontal', '9:16': '9:16 · Vertical', '4:3': '4:3 · Horizontal', '3:4': '3:4 · Vertical', '4:5': '4:5 · Retrato' };
        for (const [key, container] of [['aspect_ratio', 'aspect-field'], ['resolution', 'resolution-field'], ['quality', 'quality-field']]) {
            const values = selected?.parameters[key]?.values || [];
            const previous = $(key).value;
            $(container).hidden = !values.length;
            $(key).replaceChildren(...values.map(value => new Option(labels[value] || value, value)));
            if (values.includes(previous)) $(key).value = previous;
            else if (values.includes(key === 'aspect_ratio' ? '1:1' : key === 'resolution' ? '1K' : 'auto')) $(key).value = key === 'aspect_ratio' ? '1:1' : key === 'resolution' ? '1K' : 'auto';
        }
        const max = Math.min(4, Number(selected?.parameters.input_references?.max) || 0);
        $('model-description').textContent = selected ? (max ? `Admite hasta ${max} referencias${selected.parameters.input_references.min > 0 ? ' · requiere referencia' : ''}` : 'Generación a partir de texto') : 'Agrega modelos con el botón Vincular.';
        $('model-pricing').href = selected ? `https://openrouter.ai/${selected.id}` : 'https://openrouter.ai/models?output_modalities=image';
        renderQwen(selected);
        $('references').disabled = max === 0;
        $('dropzone').style.opacity = max ? '1' : '.5';
        $('generate').disabled = !selected || state.busy || (selected.local ? state.qwen?.status !== 'ready' : !state.connected);
        if (selected) localStorage.setItem('imageStudioModel', selected.id);
    }
    // Qwen corre en la GPU propia de RunPod: con referencia edita la foto, sin referencia crea desde texto.
    function renderQwen(selected) {
        const local = !!selected?.local;
        const qwen = state.qwen || { status: 'off', message: 'Consultando la GPU…' };
        $('model-pricing').hidden = local; $('qwen-power').hidden = !local;
        $('generate-form').querySelector('.generate-footer p').textContent = local ? 'Corre en tu GPU rentada en RunPod: no cobra por imagen, solo por las horas encendida.' : 'Se usa el saldo de tu cuenta de OpenRouter.';
        if (local) {
            const mode = state.references.length ? 'Editará tu referencia (conserva el formato de la primera foto)' : 'Creará desde tu descripción';
            $('model-description').textContent = qwen.status === 'ready' ? `${mode} · GPU lista` : qwen.message;
            $('qwen-power').textContent = qwen.status === 'off' ? 'Encender GPU ahora' : 'Apagar GPU';
            $('qwen-power').dataset.action = qwen.status === 'off' ? 'start' : 'stop';
            $('aspect-field').hidden = $('aspect-field').hidden || state.references.length > 0;
        }
        $('enhance-field').hidden = !local;
        clearTimeout(state.qwenTimer);
        if (local) state.qwenTimer = setTimeout(refreshQwen, qwen.status === 'starting' ? 15000 : 60000);
    }
    async function refreshQwen() {
        try { state.qwen = (await api('/qwen')).qwen; } catch (_) { /* se reintenta en el siguiente ciclo */ }
        renderOptions();
    }
    async function toggleQwen() {
        const action = $('qwen-power').dataset.action;
        const question = action === 'start'
            ? 'La GPU cobra ~0.75 USD por hora mientras está encendida y tarda unos 10 minutos en quedar lista. Fuera de horario se apaga sola tras 45 minutos sin uso. ¿Encenderla?'
            : 'Se apagará la GPU para todo el equipo. ¿Apagarla?';
        if (!confirm(question)) return;
        $('qwen-power').disabled = true;
        try { state.qwen = (await api('/qwen/power', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })).qwen; notice(); }
        catch (err) { notice(err.message, true); }
        finally { $('qwen-power').disabled = false; renderOptions(); }
    }
    function renderCatalog() {
        const term = $('model-search').value.trim().toLowerCase();
        const models = state.models.filter(m => `${m.name} ${m.id}`.toLowerCase().includes(term));
        $('models-status').textContent = `${state.linkedIds.length} vinculados · ${models.length} modelos disponibles`;
        $('model-catalog').innerHTML = models.map(m => {
            const linked = state.linkedIds.includes(m.id);
            return `<div class="model-row"><div class="provider-icon" aria-hidden="true">${escape(m.name[0])}</div><div class="model-row-info"><h3>${escape(m.name)}</h3><p>${escape(m.id)}</p></div><button class="button secondary ${linked ? 'linked' : ''}" data-model="${escape(m.id)}" data-action="${linked ? 'unlink' : 'link'}" aria-label="${linked ? 'Quitar' : 'Vincular'} ${escape(m.name)}">${linked ? '✓ Vinculado' : '+ Vincular'}</button></div>`;
        }).join('') || '<p class="models-status">No se encontraron modelos con ese nombre.</p>';
    }
    async function showModels() {
        $('models-dialog').showModal(); $('model-search').focus();
        if (!state.models.length) {
            $('models-status').textContent = 'Consultando modelos…';
            try { applyModels(await api('/models')); } catch (err) { $('models-status').textContent = err.message; }
        }
    }
    function showTab(tab) {
        $('create-view').hidden = tab !== 'create'; $('gallery-view').hidden = tab !== 'gallery';
        portal.setVisible(tab === 'create');
        for (const name of ['create', 'gallery']) { $(`tab-${name}`).classList.toggle('active', name === tab); $(`tab-${name}`).setAttribute('aria-selected', String(name === tab)); }
        if (tab === 'gallery') loadGallery().catch(err => notice(err.message, true));
    }
    async function addFiles(files) {
        const max = Math.min(4, Number(model()?.parameters.input_references?.max) || 0);
        for (const file of files) {
            if (state.references.length >= max) { notice(`El modelo seleccionado admite hasta ${max} referencias en esta sección.`, true); break; }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 6 * 1024 * 1024) { notice('Usa archivos PNG, JPG o WebP de máximo 6 MB.', true); continue; }
            state.references.push({ file, url: URL.createObjectURL(file) });
        }
        renderReferences(); $('references').value = '';
    }
    function renderReferences() {
        if (model()?.local) renderOptions();
        $('reference-list').innerHTML = state.references.map((ref, index) => `<div class="reference-item"><img src="${escape(ref.url)}" alt="${escape(ref.file.name)}"><button type="button" data-remove="${index}" aria-label="Quitar referencia ${index + 1}">×</button></div>`).join('');
    }
    function setBusy(busy) {
        state.busy = busy;
        $('generate').querySelector('span').textContent = busy ? 'Generando…' : 'Generar imagen';
        renderOptions();
    }
    function mergeJob(job) {
        const index = state.jobs.findIndex(j => j.id === job.id);
        if (index >= 0) state.jobs[index] = job; else state.jobs.unshift(job);
        renderGallery();
    }
    function showJob(job) {
        state.current = job;
        const generating = job.status === 'generating';
        $('empty-preview').hidden = true; $('generating-preview').hidden = !generating; $('result-preview').hidden = generating;
        portal.setActive(generating);
        $('result-footer').hidden = generating;
        $('preview-badge').textContent = generating ? 'En proceso' : job.status === 'completed' ? 'Lista para descargar' : 'Generación no completada';
        if (generating) { $('generating-model').textContent = job.modelName; return; }
        const image = job.images?.[0];
        $('result-image').hidden = !image;
        if (image) $('result-image').src = image.fullUrl; else $('result-image').removeAttribute('src');
        $('result-error').hidden = !!image; $('result-error').textContent = job.error || 'No se pudo generar la imagen.';
        $('result-model').textContent = job.modelName;
        $('result-details').textContent = [image ? `${image.width} × ${image.height} px` : null, money(job.cost)].filter(Boolean).join(' · ');
        $('download').hidden = !image;
        $('result-enhanced').hidden = !job.enhancedPrompt;
        $('result-enhanced').querySelector('p').textContent = job.enhancedPrompt || '';
    }
    function clearPreview() {
        state.current = null; portal.setActive(false);
        $('empty-preview').hidden = false; $('generating-preview').hidden = true; $('result-preview').hidden = true; $('result-footer').hidden = true;
        $('preview-badge').textContent = 'Tu espacio para crear';
    }
    async function removeJob() {
        const job = state.current;
        if (!job || !confirm('¿Borrar esta imagen para siempre? Se elimina de la galería de todo el equipo y no se puede recuperar.')) return;
        $('delete-job').disabled = true;
        try {
            await api(`/generations/${job.id}`, { method: 'DELETE' });
            state.jobs = state.jobs.filter(j => j.id !== job.id); renderGallery(); clearPreview();
            notice('La imagen se borró de la galería.');
        } catch (err) { notice(err.message, true); }
        finally { $('delete-job').disabled = false; }
    }
    function elapsed() {
        if (!state.active) return;
        const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(state.active.createdAt)) / 1000));
        $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    function track(job) {
        state.active = job; localStorage.setItem('imageStudioActive', job.id); setBusy(true); showJob(job); elapsed();
        clearTimeout(state.polling);
        state.polling = setTimeout(poll, 2500);
    }
    async function poll() {
        if (!state.active) return;
        try {
            const { job } = await api(`/generations/${state.active.id}`);
            mergeJob(job);
            if (job.status !== 'generating') {
                state.active = null; localStorage.removeItem('imageStudioActive'); setBusy(false); showJob(job);
                notice(job.status === 'completed' ? 'Tu imagen está lista y se guardó en la galería.' : job.error, job.status !== 'completed');
                return;
            }
        } catch (err) {
            if (err.status === 404 || err.status === 401) {
                showJob({ ...state.active, status: 'failed', error: err.status === 404 ? 'La solicitud no se registró. Puedes volver a generar.' : err.message });
                state.active = null; localStorage.removeItem('imageStudioActive'); setBusy(false);
                notice(err.status === 404 ? 'La solicitud no se registró. Puedes volver a generar.' : err.message, true);
                return;
            }
            notice('No se pudo consultar el progreso. La solicitud ya fue enviada; reconectando…', true);
        }
        state.polling = setTimeout(poll, 3500);
    }
    async function generate(event) {
        event.preventDefault();
        if (state.busy) return;
        const selected = model();
        if (!selected) return showModels();
        const max = Math.min(4, Number(selected.parameters.input_references?.max) || 0);
        if (state.references.length > max) return notice(`Quita referencias: este modelo admite hasta ${max}.`, true);
        if (state.references.length < (Number(selected.parameters.input_references?.min) || 0)) return notice('Este modelo necesita una imagen de referencia.', true);
        notice(); setBusy(true);
        const requestId = crypto.randomUUID();
        const form = new FormData();
        form.append('requestId', requestId); form.append('prompt', $('prompt').value); form.append('model', selected.id);
        for (const key of ['aspect_ratio', 'resolution', 'quality']) if ($(key).value) form.append(key, $(key).value);
        if (selected.local) form.append('enhance', $('enhance').checked ? '1' : '0');
        state.references.forEach(ref => form.append('references', ref.file));
        try {
            const { job } = await api('/generations', { method: 'POST', body: form });
            mergeJob(job); track(job);
        } catch (err) {
            // Si se perdió la respuesta después de aceptar el trabajo, recuperar el mismo ID evita cobros repetidos.
            try { const { job } = await api(`/generations/${requestId}`); mergeJob(job); track(job); }
            catch (lookupError) {
                if (err.status && err.status < 500 || lookupError.status === 404 || lookupError.status === 401) {
                    setBusy(false); notice(err.message, true);
                } else {
                    track({ id: requestId, status: 'generating', createdAt: new Date().toISOString(), modelName: selected.name });
                    notice('Se perdió la conexión. Estamos comprobando la solicitud antes de permitir otra generación.', true);
                }
            }
        }
    }
    function renderGallery() {
        $('gallery-count').textContent = state.jobs.filter(job => job.status === 'completed').length;
        $('load-more').hidden = !state.nextCursor;
        $('gallery').innerHTML = state.jobs.length ? state.jobs.map(job => `<button class="gallery-card" data-job="${escape(job.id)}" aria-label="Abrir imagen: ${escape(job.prompt.slice(0, 100))}">${job.images?.[0] ? `<img loading="lazy" src="${escape(job.images[0].thumbUrl)}" alt="${escape(job.prompt)}">` : `<div class="gallery-placeholder"><i class="fa-solid ${job.status === 'generating' ? 'wand-magic-sparkles' : 'triangle-exclamation'}" aria-hidden="true"></i><span>${job.status === 'generating' ? 'En proceso' : 'No completada'}</span></div>`}<div class="gallery-card-info"><strong>${escape(job.modelName)}</strong><p>${escape(job.prompt)}</p><small>${new Date(job.createdAt).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${escape(job.status === 'completed' ? money(job.cost) : job.status === 'generating' ? 'Generando' : 'Revisar intento')}</small></div></button>`).join('') : '<div class="gallery-empty"><i class="fa-regular fa-images" aria-hidden="true"></i><h3>Tu galería está por comenzar</h3><p>Las imágenes que generes aparecerán aquí, listas para volver a usarlas.</p></div>';
    }
    async function loadGallery(append = false) {
        const data = await api(`/generations${append && state.nextCursor ? `?before=${encodeURIComponent(state.nextCursor)}` : ''}`);
        state.jobs = append ? [...state.jobs, ...data.jobs.filter(job => !state.jobs.some(j => j.id === job.id))] : data.jobs;
        state.nextCursor = data.nextCursor; renderGallery();
    }
    function reuse() {
        const job = state.current;
        if (!job) return;
        $('prompt').value = job.prompt; $('prompt').dispatchEvent(new Event('input'));
        if (state.linkedIds.includes(job.modelId)) { $('model').value = job.modelId; renderOptions(); }
        for (const [key, value] of Object.entries(job.options || {})) if ([...$(key).options].some(option => option.value === value)) $(key).value = value;
        showTab('create'); $('prompt').focus();
        if (job.referenceCount) notice('Agrega de nuevo las referencias que quieras usar para esta versión.');
    }
    async function download() {
        const image = state.current?.images?.[0];
        if (!image) return;
        $('download').disabled = true;
        try {
            const response = await fetch(image.fullUrl);
            if (!response.ok) throw new Error('No se pudo descargar la imagen.');
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = `dekoor-${state.current.id}.png`; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (err) { notice('No se pudo descargar. Abre la imagen para guardarla desde el navegador.', true); window.open(image.fullUrl, '_blank', 'noopener'); }
        finally { $('download').disabled = false; }
    }
    $('manage-models').addEventListener('click', showModels); $('add-model').addEventListener('click', showModels);
    $('close-models').addEventListener('click', () => $('models-dialog').close());
    $('model-search').addEventListener('input', renderCatalog);
    $('model-catalog').addEventListener('click', async event => {
        const button = event.target.closest('[data-model]'); if (!button) return;
        button.disabled = true;
        try { applyModels(await api('/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: button.dataset.model, action: button.dataset.action }) })); }
        catch (err) { $('models-status').textContent = err.message; button.disabled = false; }
    });
    $('model').addEventListener('change', renderOptions);
    $('qwen-power').addEventListener('click', toggleQwen);
    $('prompt').addEventListener('input', () => { $('prompt-count').textContent = `${$('prompt').value.length.toLocaleString('en-US')} / 6,000`; localStorage.setItem('imageStudioPrompt', $('prompt').value); });
    const ideas = {
        producto: 'Fotografía de producto de una lámpara personalizada sobre una mesa de madera clara. Fondo neutro, luz cálida y suave, detalles nítidos y un estilo elegante y natural.',
        escena: 'Un rincón de lectura acogedor al atardecer, con una lámpara encendida, plantas y un sillón de lino. Colores cálidos, luz natural y una composición serena.',
        ilustracion: 'Ilustración de un pequeño dinosaurio amistoso bajo un cielo de estrellas. Formas suaves, tonos pastel y un estilo delicado para una habitación infantil.',
    };
    document.querySelectorAll('[data-idea]').forEach(button => button.addEventListener('click', () => { $('prompt').value = ideas[button.dataset.idea]; $('prompt').dispatchEvent(new Event('input')); $('prompt').focus(); }));
    $('references').addEventListener('change', event => addFiles([...event.target.files]));
    $('reference-list').addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (button) { URL.revokeObjectURL(state.references.splice(Number(button.dataset.remove), 1)[0].url); renderReferences(); } });
    for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
    $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
    $('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); addFiles([...event.dataTransfer.files]); });
    // Ctrl+V en cualquier parte de "Crear imagen": si el portapapeles trae una imagen, se agrega como referencia.
    // Si solo trae texto, se pega normal (por ejemplo, en la descripción).
    document.addEventListener('paste', event => {
        if ($('create-view').hidden) return;
        const images = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
        if (!images.length) return;
        event.preventDefault();
        if (!model()) return notice('Elige un modelo antes de pegar una referencia.', true);
        const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
        addFiles(images.map((file, i) => new File([file], `pegada-${stamp}-${i + 1}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: file.type })));
    });
    $('generate-form').addEventListener('submit', generate);
    $('tab-create').addEventListener('click', () => showTab('create')); $('tab-gallery').addEventListener('click', () => showTab('gallery'));
    $('refresh-gallery').addEventListener('click', () => loadGallery().catch(err => notice(err.message, true)));
    $('load-more').addEventListener('click', async () => { $('load-more').disabled = true; try { await loadGallery(true); } catch (err) { notice(err.message, true); } finally { $('load-more').disabled = false; } });
    $('gallery').addEventListener('click', event => { const button = event.target.closest('[data-job]'); if (button) { const job = state.jobs.find(j => j.id === button.dataset.job); showTab('create'); showJob(job); if (job.status === 'generating' && !state.active) track(job); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
    $('reuse-prompt').addEventListener('click', reuse); $('delete-job').addEventListener('click', removeJob); $('download').addEventListener('click', download);
    setInterval(elapsed, 1000);
    firebase.auth().onAuthStateChanged(async user => {
        if (!user || state.started) return; state.started = true;
        $('prompt').value = localStorage.getItem('imageStudioPrompt') || ''; $('prompt').dispatchEvent(new Event('input'));
        const results = await Promise.allSettled([api('/models').then(applyModels), loadGallery()]);
        results.forEach(result => { if (result.status === 'rejected' && result.reason.status !== 401) notice(result.reason.message, true); });
        if (results[0].status === 'rejected' && results[0].reason.status !== 401) {
            $('connection').className = 'connection error';
            $('connection').innerHTML = '<span></span>Sin conexión';
            $('model').replaceChildren(new Option('No se pudo cargar · pulsa Vincular para reintentar', ''));
        }
        const activeId = localStorage.getItem('imageStudioActive');
        if (activeId) {
            try { const { job } = await api(`/generations/${activeId}`); if (job.status === 'generating') track(job); else { localStorage.removeItem('imageStudioActive'); showJob(job); } }
            catch (_) { localStorage.removeItem('imageStudioActive'); }
        }
    });
})();
