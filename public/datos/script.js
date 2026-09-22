document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('datosForm');
    const submitBtn = document.getElementById('submitBtn');
    const mensajeFormulario = document.getElementById('mensajeFormulario');
    const formContainer = document.getElementById('form-container');
    const confirmationContainer = document.getElementById('confirmation-container');

    const API_BASE_URL = window.API_BASE_URL || '';

    // Cruce del C.P. con SEPOMEX mientras el cliente llena el formulario: muestra a qué municipio
    // corresponde y avisa si no cuadra con el estado elegido. Errores de dedo reales: 47980 (Degollado)
    // por 48980 (Cihuatlán), 75535 (Puebla) por 77535 (Cancún), 83033 (no existe) por 87033 (Cd. Victoria).
    const cpInput = document.getElementById('codigoPostal');
    const estadoSelect = document.getElementById('estado');
    const cpHint = document.getElementById('cpHint');
    let cpInfo = null;      // { cp, found, municipio, estado }
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const mismoEstado = (a, b) => {
        a = norm(a); b = norm(b);
        if (!a || !b) return true;
        if (a === b || a.includes(b) || b.includes(a)) {
            // "mexico" (Edomex) vs "ciudad de mexico" son estados distintos
            if ((a === 'mexico' && b.includes('ciudad')) || (b === 'mexico' && a.includes('ciudad'))) return false;
            return true;
        }
        const alias = { 'ciudad de mexico': ['cdmx', 'distrito federal', 'df'], 'mexico': ['estado de mexico', 'edomex', 'edo de mexico'] };
        return (alias[a] || []).includes(b) || (alias[b] || []).includes(a);
    };
    const pintarHint = () => {
        if (!cpHint) return;
        if (!cpInfo) { cpHint.textContent = ''; cpHint.style.color = '#6b7280'; return; }
        if (!cpInfo.found) { cpHint.textContent = '⚠️ No encontramos ese código postal. Revisa que esté bien escrito.'; cpHint.style.color = '#dc2626'; return; }
        const ok = mismoEstado(cpInfo.estado, estadoSelect ? estadoSelect.value : '');
        cpHint.textContent = (ok ? '📍 ' : '⚠️ Ese código postal es de ') + `${cpInfo.municipio || ''}, ${cpInfo.estado || ''}` + (ok ? '' : '. Revisa que sea el correcto.');
        cpHint.style.color = ok ? '#15803d' : '#dc2626';
    };
    const consultarCp = async () => {
        const cp = cpInput ? cpInput.value.trim() : '';
        if (!/^\d{5}$/.test(cp)) { cpInfo = null; pintarHint(); return; }
        if (cpInfo && cpInfo.cp === cp) { pintarHint(); return; }
        try {
            const r = await fetch(`${API_BASE_URL}/api/codigo-postal/${cp}`);
            const j = await r.json();
            cpInfo = (j && j.success !== false && (j.municipio || j.estado)) ? { cp, found: true, municipio: j.municipio || j.ciudad || '', estado: j.estado || '' } : { cp, found: false };
        } catch (_) { cpInfo = null; }
        pintarHint();
    };
    if (cpInput) { cpInput.addEventListener('input', consultarCp); cpInput.addEventListener('blur', consultarCp); }
    if (estadoSelect) estadoSelect.addEventListener('change', pintarHint);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const telefono = document.getElementById('telefono').value.trim();
        if (!/^\d{10}$/.test(telefono)) {
            mensajeFormulario.textContent = 'El teléfono debe tener exactamente 10 dígitos, sin espacios.';
            mensajeFormulario.className = 'error';
            return;
        }

        const codigoPostal = document.getElementById('codigoPostal').value.trim();
        if (!/^\d{5}$/.test(codigoPostal)) {
            mensajeFormulario.textContent = 'El código postal debe tener exactamente 5 dígitos.';
            mensajeFormulario.className = 'error';
            return;
        }

        // Confirmación cuando el C.P. no cuadra con el estado elegido (o no existe): el cliente puede
        // seguir, pero se lo hacemos notar antes de mandar los datos.
        if (cpInfo && cpInfo.cp === codigoPostal) {
            const estadoElegido = document.getElementById('estado').value;
            if (!cpInfo.found) {
                if (!window.confirm(`No encontramos el código postal ${codigoPostal}. ¿Seguro que es correcto?`)) return;
            } else if (!mismoEstado(cpInfo.estado, estadoElegido)) {
                if (!window.confirm(`El código postal ${codigoPostal} corresponde a ${cpInfo.municipio}, ${cpInfo.estado}, pero elegiste "${estadoElegido}". ¿Seguro que es correcto?`)) return;
            }
        }

        const originalButtonText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
        mensajeFormulario.textContent = '';

        const payload = {
            numeroPedido: document.getElementById('numeroPedido').value.trim(),
            nombreCompleto: document.getElementById('nombreCompleto').value.trim(),
            telefono,
            direccion: document.getElementById('direccion').value.trim(),
            numInterior: document.getElementById('numInterior').value.trim(),
            colonia: document.getElementById('colonia').value.trim(),
            estado: document.getElementById('estado').value,
            ciudad: document.getElementById('ciudad').value.trim(),
            codigoPostal,
            referencia: document.getElementById('referencia').value.trim(),
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/datos-envio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Ocurrió un error en el servidor.');
            }

            formContainer.style.display = 'none';
            confirmationContainer.style.display = 'block';

        } catch (error) {
            console.error('Error al enviar datos:', error);
            mensajeFormulario.textContent = `Error: ${error.message}`;
            mensajeFormulario.className = 'error';
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalButtonText;
        }
    });
});
