document.addEventListener('DOMContentLoaded', () => {
    const trackBtn = document.getElementById('track-btn');
    const waybillInput = document.getElementById('waybill-input');
    const resultsContainer = document.getElementById('results');
    const displayWaybill = document.getElementById('display-waybill');
    const timeline = document.getElementById('tracking-timeline');

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

    const trackPackage = async () => {
        const waybill = waybillInput.value.trim().toUpperCase();
        const phone = '7167'; 
        
        if (!waybill) {
            alert('Por favor, ingresa un número de guía válido.');
            return;
        }

        // Show loading state
        trackBtn.innerText = 'BUSCANDO...';
        trackBtn.disabled = true;

        try {
            const response = await fetch(`/api/jt/track?waybill=${waybill}&phoneVerify=${phone}`);
            const result = await response.json();


            if (result.success && result.data) {
                renderResults(waybill, result.data);
            } else {
                alert(result.message || 'Error consultando la guía. Revisa que los datos sean correctos.');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Error de conexión con el servidor.');
        } finally {
            trackBtn.innerText = 'RASTREAR';
            trackBtn.disabled = false;
        }
    };

    const translateText = (text) => {
        if (!text) return text;
        const dictionary = {
            '已签收': 'Entregado / Firmado',
            '派件中': 'En ruta de entrega',
            '运送中': 'En tránsito',
            '待取件': 'Pendiente de recolección',
            '取件中': 'En proceso de recolección',
            '已取件': 'Recolectado',
            '快件到达': 'El paquete ha llegado a',
            '快件离开': 'El paquete ha salido de',
            '已发往': 'con destino a',
            '包裹已签收!': '¡Paquete entregado!',
            '签收人是': 'Recibido por:',
            '正在派件': 'En camino',
            '如有异常问题或需投诉请拨打网点电话': '',
            'Si requieres mayor información, contáctanos al: 5571001047': '',
            '5571001047': '',
            '【': ' ',
            '】': ' '
        };

        
        let translated = text;
        Object.keys(dictionary).forEach(key => {
            translated = translated.split(key).join(dictionary[key]);
        });
        return translated;
    };

    const calculateEstimatedDate = (startDateStr) => {
        // Parse "YYYY-MM-DD HH:mm:ss"
        const date = new Date(startDateStr.replace(/-/g, '/'));
        if (isNaN(date.getTime())) return null;

        // Mexican Holidays (Approximate list for 2024-2026)
        const holidays = [
            '1/1',   // New Year
            '5/2',   // Constitution Day (approx)
            '21/3',  // Juarez birthday (approx)
            '1/5',   // Labor Day
            '16/9',  // Independence Day
            '1/10',  // Transicion Poder Ejecutivo (every 6 years, 2024)
            '20/11', // Revolution Day (approx)
            '25/12'  // Christmas
        ];

        let businessDaysAdded = 0;
        const targetBusinessDays = 7;

        while (businessDaysAdded < targetBusinessDays) {
            date.setDate(date.getDate() + 1);
            const dayOfWeek = date.getDay(); // 0 = Sun, 6 = Sat
            const holidayKey = `${date.getDate()}/${date.getMonth() + 1}`;

            // Check if it's a weekend or holiday
            if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.includes(holidayKey)) {
                businessDaysAdded++;
            }
        }

        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        let formatted = date.toLocaleDateString('es-MX', options);
        // Capitalize first letter
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    };

    const showSummaryModal = (latestEvent, oldestEvent) => {
        const modal = document.getElementById('status-modal');
        const title = document.getElementById('modal-status-title');
        const desc = document.getElementById('modal-description');
        const reassurance = document.getElementById('modal-reassurance');
        const icon = document.getElementById('modal-icon');
        const iconInner = document.getElementById('icon-inner');
        const estimatedBox = document.getElementById('estimated-box');
        const estimatedDateEl = document.getElementById('estimated-date');

        let status = translateText(latestEvent.status);
        const details = translateText(latestEvent.customerTracking);

        // Calculate Estimated Delivery
        const estimatedDate = calculateEstimatedDate(oldestEvent.scanTime);
        if (estimatedDate && !(status.toLowerCase().includes('entregado') || status.toLowerCase().includes('firmado'))) {
            estimatedDateEl.innerText = estimatedDate;
            estimatedBox.style.display = 'flex';
        } else {
            estimatedBox.style.display = 'none';
        }

        // Mensaje de confianza dinámico e iconos
        if (status.toLowerCase().includes('tránsito') || status.toLowerCase().includes('camino') || status.toLowerCase().includes('recolectado')) {
            status = "Tu pedido va en camino";
            reassurance.innerText = "¡Todo va según lo previsto! Tu paquete sigue avanzando con seguridad hacia su destino. Gracias por tu paciencia.";
            icon.style.background = "transparent"; 
            iconInner.innerHTML = '<i data-lucide="truck" style="width: 60px; height: 60px; color: #FF8E41;"></i>';
        } else if (status.toLowerCase().includes('entregado') || status.toLowerCase().includes('firmado')) {
            reassurance.innerText = "¡Excelente noticia! Tu paquete ha sido entregado exitosamente. Esperamos que disfrutes tu compra.";
            icon.style.background = "transparent";
            iconInner.innerHTML = '<i data-lucide="package-check" style="width: 60px; height: 60px; color: #28a745;"></i>';
        } else {
            reassurance.innerText = "Estamos trabajando para que recibas tu pedido lo antes posible. Tu información se actualizará pronto.";
            icon.style.background = "transparent";
            iconInner.innerHTML = '<i data-lucide="package" style="width: 60px; height: 60px; color: #FF8E41;"></i>';
        }

        title.innerText = status;
        desc.innerText = details;

        lucide.createIcons();
        modal.classList.add('active');
    };


    const showPendingModal = () => {
        const modal = document.getElementById('status-modal');
        const title = document.getElementById('modal-status-title');
        const desc = document.getElementById('modal-description');
        const reassurance = document.getElementById('modal-reassurance');
        const icon = document.getElementById('modal-icon');
        const iconInner = document.getElementById('icon-inner');
        const estimatedBox = document.getElementById('estimated-box');

        estimatedBox.style.display = 'none';
        icon.style.background = 'transparent';
        iconInner.innerHTML = '<i data-lucide="clock" style="width: 60px; height: 60px; color: #FF8E41;"></i>';
        title.innerText = 'Tu guía fue creada';
        desc.innerText = 'Tu guía fue creada y estamos esperando a que la paquetería escanee tu paquete para que pueda aparecer información.';
        reassurance.innerText = 'Esto puede tardar entre 24 y 48 hrs. Te pedimos un poco de paciencia, ¡pronto tendrás novedades de tu pedido!';

        lucide.createIcons();
        modal.classList.add('active');
    };

    const renderResults = (waybill, data) => {
        displayWaybill.innerText = waybill;
        timeline.innerHTML = '';

        const events = data.details || [];
        const currentStatus = document.getElementById('current-status');

        if (events.length === 0) {
            setTimeout(() => showPendingModal(), 300);
            return;
        }

        if (events.length > 0) {
            const latest = events[0];
            let statusText = translateText(latest.status || 'EN TRÁNSITO');
            
            // Personalizar texto para tránsito
            if (statusText.toLowerCase().includes('tránsito') || statusText.toLowerCase().includes('camino')) {
                statusText = "Tu pedido va en camino";
            }
            
            currentStatus.innerText = statusText;
            
            events.forEach((event, index) => {
                const item = document.createElement('div');
                item.className = `timeline-item ${index === 0 ? 'active' : ''}`;
                item.innerHTML = `
                    <div class="time">${event.scanTime}</div>
                    <div class="status-text">${translateText(event.status || 'Información de envío')}</div>
                    <div class="location">${translateText(event.customerTracking || '')}</div>
                `;
                timeline.appendChild(item);
            });

            // Identificar el primer registro para calcular fecha estimada
            const oldest = events[events.length - 1];

            // Mostrar el modal de resumen después de un breve delay
            setTimeout(() => showSummaryModal(latest, oldest), 500);
        }



        // Show container
        resultsContainer.classList.add('active');
        
        // Scroll to results
        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // Controladores del Modal
    document.getElementById('close-modal').addEventListener('click', () => {
        document.getElementById('status-modal').classList.remove('active');
    });

    document.getElementById('view-details-btn').addEventListener('click', () => {
        document.getElementById('status-modal').classList.remove('active');
    });

    // Cerrar al hacer clic fuera del contenido
    document.getElementById('status-modal').addEventListener('click', (e) => {
        if (e.target.id === 'status-modal') {
            document.getElementById('status-modal').classList.remove('active');
        }
    });



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
