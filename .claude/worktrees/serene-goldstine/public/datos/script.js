document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('datosForm');
    const submitBtn = document.getElementById('submitBtn');
    const mensajeFormulario = document.getElementById('mensajeFormulario');
    const formContainer = document.getElementById('form-container');
    const confirmationContainer = document.getElementById('confirmation-container');

    const API_BASE_URL = window.API_BASE_URL || '';

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
