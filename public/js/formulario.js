document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('clienteForm');
    const submitBtn = document.getElementById('submitBtn');
    const mensajeFormulario = document.getElementById('mensajeFormulario');
    const formContainer = document.getElementById('client-form-container');
    const confirmationContainer = document.getElementById('confirmation-container');
    
    // La URL base de tu API que ya existe en otros archivos.
    const API_BASE_URL = 'https://crm-rzon.onrender.com';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const nombre = document.getElementById('nombre').value.trim();
        const telefono = document.getElementById('telefono').value.trim();

        if (!/^\d{10}$/.test(telefono)) {
            mensajeFormulario.textContent = 'Por favor, introduce un número de teléfono válido de 10 dígitos.';
            mensajeFormulario.className = 'error';
            return;
        }

        const originalButtonText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
        mensajeFormulario.textContent = '';

        try {
            const response = await fetch(`${API_BASE_URL}/api/clientes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nombre, phone: telefono })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Ocurrió un error en el servidor.');
            }

            // Ocultar formulario y mostrar confirmación
            formContainer.style.display = 'none';
            confirmationContainer.style.display = 'block';

        } catch (error) {
            console.error("Error al registrar cliente:", error);
            mensajeFormulario.textContent = `Error: ${error.message}`;
            mensajeFormulario.className = 'error';
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalButtonText;
        }
    });
});
