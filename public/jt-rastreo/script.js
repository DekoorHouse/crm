document.addEventListener('DOMContentLoaded', () => {
    const trackBtn = document.getElementById('track-btn');
    const waybillInput = document.getElementById('waybill-input');
    const resultsContainer = document.getElementById('results');
    const displayWaybill = document.getElementById('display-waybill');
    const timeline = document.getElementById('tracking-timeline');
    const officialLink = document.getElementById('official-link');

    // Simulated tracking data for demonstration
    const mockResponses = {
        'JMX12345678': [
            { time: '2024-03-14 10:30', status: 'En Tránsito', location: 'Centro de Distribución, CDMX', active: true },
            { time: '2024-03-14 08:15', status: 'Recolectado', location: 'Almacén Origen, Queretaro', active: false },
            { time: '2024-03-13 22:00', status: 'Guía Generada', location: 'Plataforma Digital', active: false }
        ],
        'default': [
            { time: 'Recién actualizado', status: 'Procesando información', location: 'Sistema J&T Express', active: true }
        ]
    };

    const trackPackage = () => {
        const waybill = waybillInput.value.trim().toUpperCase();
        
        if (!waybill) {
            alert('Por favor, ingresa un número de guía válido.');
            return;
        }

        // Show loading state
        trackBtn.innerText = 'BUSCANDO...';
        trackBtn.disabled = true;

        // Simulate API delay
        setTimeout(() => {
            const data = mockResponses[waybill] || mockResponses['default'];
            renderResults(waybill, data);
            
            trackBtn.innerText = 'RASTREAR';
            trackBtn.disabled = false;
        }, 800);
    };

    const renderResults = (waybill, events) => {
        displayWaybill.innerText = waybill;
        timeline.innerHTML = '';

        events.forEach((event, index) => {
            const item = document.createElement('div');
            item.className = `timeline-item ${event.active ? 'active' : ''}`;
            item.innerHTML = `
                <div class="time">${event.time}</div>
                <div class="status-text">${event.status}</div>
                <div class="location">${event.location}</div>
            `;
            timeline.appendChild(item);
        });

        // Update official link
        officialLink.href = `https://www.jtexpress.mx/trajectoryQuery?waybillNo=${waybill}`;
        
        // Show container
        resultsContainer.classList.add('active');
        
        // Scroll to results
        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    trackBtn.addEventListener('click', trackPackage);
    
    waybillInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') trackPackage();
    });
});

/**
 * NOTA PARA DESARROLLO:
 * Para integrar la API real de J&T México:
 * 1. Registrarse en https://open.jtjms-mx.com/
 * 2. El endpoint es: https://openapi.jtjms-mx.com/webopenplatformapi/api/logistics/trace
 * 3. Se requiere firma MD5 y Base64 para el 'digest'.
 * 4. Por seguridad, la llamada debe hacerse desde un servidor (Backend) para no exponer la llave privada.
 */
