// --- START: Event Handlers for the Difusion View ---

// Estado local para la vista de difusión
let difusionState = {
    jobs: [], // Almacenará cada fila como un objeto
    messageSequence: [],
    contingencyTemplate: null,
};

let messageSequenceSortable = null;

// Función principal que se llama desde ui-manager.js
function initializeDifusionHandlers() {
    // Reiniciar estado cada vez que se carga la vista
    difusionState = {
        jobs: [],
        messageSequence: [],
        contingencyTemplate: null,
    };

    setupEventListeners();
    updateJobCounter();
}

// Configura todos los listeners de la página
function setupEventListeners() {
    const addRowBtn = document.getElementById('add-row-btn');
    const sendAllBtn = document.getElementById('send-all-btn');
    const addMessageBtn = document.getElementById('add-message-btn');
    const quickReplyDropdown = document.getElementById('quick-reply-dropdown');
    const selectedMessagesContainer = document.getElementById('selected-messages-container');
    const bulkTableBody = document.getElementById('bulk-table-body');
    const contingencyTemplateSelect = document.getElementById('contingency-template-select');

    if (addRowBtn) addRowBtn.addEventListener('click', handleAddRow);
    if (sendAllBtn) sendAllBtn.addEventListener('click', handleSendAll);
    if (addMessageBtn) addMessageBtn.addEventListener('click', toggleQuickReplyDropdown);
    if (contingencyTemplateSelect) contingencyTemplateSelect.addEventListener('change', (e) => {
        difusionState.contingencyTemplate = e.target.value ? JSON.parse(e.target.value) : null;
    });

    // Listeners para elementos dinámicos
    if (quickReplyDropdown) {
        quickReplyDropdown.addEventListener('click', (e) => {
            if (e.target.matches('.quick-reply-item')) {
                e.preventDefault();
                const qrId = e.target.dataset.id;
                addMessageToSequence(qrId);
                toggleQuickReplyDropdown(false); // Ocultar después de seleccionar
            }
        });
    }

    if (bulkTableBody) {
        bulkTableBody.addEventListener('click', handleTableClick);
        bulkTableBody.addEventListener('change', handleTableChange);
        bulkTableBody.addEventListener('input', debounce(handleTableInput, 300));
        setupDragAndDrop(bulkTableBody);
    }

    // Cerrar dropdown si se hace clic fuera
    document.addEventListener('click', (e) => {
        if (!addMessageBtn.contains(e.target) && !quickReplyDropdown.contains(e.target)) {
            toggleQuickReplyDropdown(false);
        }
    });

    // Inicializar SortableJS para la secuencia de mensajes
    if (selectedMessagesContainer) {
        messageSequenceSortable = new Sortable(selectedMessagesContainer, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                const { oldIndex, newIndex } = evt;
                const [movedItem] = difusionState.messageSequence.splice(oldIndex, 1);
                difusionState.messageSequence.splice(newIndex, 0, movedItem);
            }
        });
    }
}

// --- MANEJADORES DE EVENTOS ---

function handleAddRow() {
    const newJob = {
        id: `job_${Date.now()}`,
        orderId: '',
        customerName: 'N/A',
        phoneNumber: '',
        contactId: null,
        photoUrl: null,
        status: 'pending', // pending, verifying, ready, error, sending, sent
        verificationStatus: 'idle', // idle, verifying, verified, error
    };
    difusionState.jobs.push(newJob);
    renderTable();
}

function handleSendAll() {
    console.log("Preparando para enviar los siguientes trabajos:", difusionState);
    alert("Funcionalidad de envío aún no implementada. Revisa la consola para ver los datos preparados.");
    // Aquí irá la lógica para enviar `difusionState` al backend
}

function handleTableClick(e) {
    const target = e.target;
    if (target.matches('.delete-row-btn, .delete-row-btn *')) {
        const row = target.closest('tr');
        if (row) {
            removeJob(row.dataset.id);
        }
    }
}

function handleTableChange(e) {
    const target = e.target;
    if (target.matches('.photo-file-input')) {
        const row = target.closest('tr');
        if (row && target.files.length > 0) {
            handlePhotoUpload(target.files[0], row.dataset.id);
        }
    }
}

function handleTableInput(e) {
    const target = e.target;
    const row = target.closest('tr');
    if (!row) return;
    const jobId = row.dataset.id;
    const job = difusionState.jobs.find(j => j.id === jobId);
    if (!job) return;

    if (target.matches('.order-id-input')) {
        const row = target.closest('tr');
        if (row) {
            verifyOrderId(target.value.trim(), row.dataset.id);
        }
    } else if (target.matches('.phone-number-input')) {
        const phoneNumber = target.value.trim();
        job.phoneNumber = phoneNumber;
        job.contactId = phoneNumber; // El número de teléfono es el ID de contacto para WhatsApp
        checkJobReady(jobId);
    }
}


// --- LÓGICA PRINCIPAL DE LA HERRAMIENTA ---

function removeJob(jobId) {
    difusionState.jobs = difusionState.jobs.filter(job => job.id !== jobId);
    renderTable();
}

async function verifyOrderId(orderId, jobId) {
    const job = difusionState.jobs.find(j => j.id === jobId);
    if (!job) return;

    job.orderId = orderId;

    if (!orderId) {
        job.verificationStatus = 'idle';
        job.customerName = 'N/A';
        job.phoneNumber = '';
        job.contactId = null;
        updateRowUI(job);
        checkJobReady(jobId);
        return;
    }

    job.verificationStatus = 'verifying';
    updateRowUI(job);

    try {
        const response = await fetch(`${API_BASE_URL}/api/orders/verify/${orderId}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Error de verificación');
        }
        
        job.verificationStatus = 'verified';
        job.customerName = data.customerName;
        job.phoneNumber = data.contactId;
        job.contactId = data.contactId;

    } catch (error) {
        console.error("Error al verificar el pedido:", error);
        const isPhoneNumber = /^\d{10,}$/.test(orderId.replace(/\D/g, ''));
        if (isPhoneNumber) {
            job.verificationStatus = 'verified'; // Asumimos que es un número válido si la API falla
            job.customerName = 'N/A'; // No podemos saber el nombre
            job.phoneNumber = orderId;
            job.contactId = orderId;
        } else {
            job.verificationStatus = 'error';
            job.customerName = 'No encontrado';
        }
    } finally {
        updateRowUI(job);
        checkJobReady(jobId);
    }
}

async function handlePhotoUpload(file, jobId) {
    const job = difusionState.jobs.find(j => j.id === jobId);
    if (!job) return;

    job.status = 'uploading';
    updateRowUI(job);

    try {
        const filePath = `difusion/${Date.now()}_${file.name}`;
        const fileRef = storage.ref(filePath);
        const uploadTask = await fileRef.put(file);
        const downloadURL = await uploadTask.ref.getDownloadURL();

        job.photoUrl = downloadURL;
        checkJobReady(jobId);

    } catch (error) {
        console.error("Error al subir la foto:", error);
        job.status = 'error';
        job.customerName = 'Error de foto';
    } finally {
        updateRowUI(job);
    }
}

function addMessageToSequence(qrId) {
    const quickReply = state.quickReplies.find(qr => qr.id === qrId);
    if (quickReply) {
        difusionState.messageSequence.push(quickReply);
        renderMessageSequence();
    }
}

function removeMessageFromSequence(index) {
    difusionState.messageSequence.splice(index, 1);
    renderMessageSequence();
}

// --- FUNCIONES DE RENDERIZADO Y UI ---

function renderTable() {
    const tableBody = document.getElementById('bulk-table-body');
    const emptyStateRow = document.getElementById('empty-state-row');

    if (difusionState.jobs.length === 0) {
        tableBody.innerHTML = '';
        if (emptyStateRow) tableBody.appendChild(emptyStateRow);
    } else {
        const existingEmptyRow = tableBody.querySelector('#empty-state-row');
        if (existingEmptyRow) existingEmptyRow.remove();
        tableBody.innerHTML = difusionState.jobs.map((job, index) => jobRowTemplate(job, index)).join('');
    }
    updateJobCounter();
    updateSendAllButtonState();
}

function updateRowUI(job) {
    const row = document.querySelector(`tr[data-id="${job.id}"]`);
    if (!row) return;

    const orderInput = row.querySelector('.order-id-input');
    const customerCell = row.querySelector('.customer-name-cell');
    const photoUploader = row.querySelector('.photo-uploader');
    const photoIcon = photoUploader.querySelector('i');
    const photoPreview = photoUploader.querySelector('.preview-img');
    const statusCell = row.querySelector('.status-cell');

    // Actualizar input de pedido
    orderInput.classList.remove('verified', 'error');
    if (job.verificationStatus === 'verified') orderInput.classList.add('verified');
    if (job.verificationStatus === 'error') orderInput.classList.add('error');
    
    // Actualizar nombre de cliente
    customerCell.textContent = job.customerName;

    // Actualizar celda de foto
    const hasPhoto = !!job.photoUrl;
    photoIcon.style.display = hasPhoto ? 'none' : 'flex';
    photoPreview.style.display = hasPhoto ? 'block' : 'none';
    if(hasPhoto) photoPreview.src = job.photoUrl;


    // Actualizar estatus
    statusCell.innerHTML = getStatusTag(job.status);
}

function renderMessageSequence() {
    const container = document.getElementById('selected-messages-container');
    container.innerHTML = difusionState.messageSequence.map((qr, index) => `
        <div class="message-pill bg-blue-100 text-blue-800 flex items-center gap-2 px-3 py-1 rounded-full" data-id="${qr.id}">
            <i class="fas fa-grip-vertical text-gray-400"></i>
            <span class="font-semibold">${qr.shortcut}</span>
            <i class="fas fa-times remove-pill" onclick="removeMessageFromSequence(${index})"></i>
        </div>
    `).join('');
}

function jobRowTemplate(job, index) {
    return `
        <tr data-id="${job.id}">
            <td class="text-center font-semibold text-gray-500">${index + 1}</td>
            <td>
                <input type="text" class="table-input order-id-input" placeholder="DH1025 o 521..." value="${job.orderId || ''}">
            </td>
            <td class="customer-name-cell">${job.customerName}</td>
            <td class="photo-cell">
                <label class="photo-uploader">
                    <input type="file" class="photo-file-input" accept="image/*">
                    <i class="fas fa-camera"></i>
                    <img src="${job.photoUrl || ''}" class="preview-img" style="display: ${job.photoUrl ? 'block' : 'none'};">
                </label>
            </td>
            <td class="status-cell">${getStatusTag(job.status)}</td>
            <td>
                <button class="btn btn-danger btn-sm delete-row-btn"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `;
}


function getStatusTag(status) {
    const statuses = {
        pending: { text: 'Pendiente', color: 'gray' },
        verifying: { text: 'Verificando...', color: 'blue' },
        ready: { text: 'Listo', color: 'green' },
        error: { text: 'Error', color: 'red' },
        uploading: { text: 'Subiendo...', color: 'yellow' },
        sending: { text: 'Enviando...', color: 'indigo' },
        sent: { text: 'Enviado', color: 'teal' },
    };
    const s = statuses[status] || statuses.pending;
    const colorClasses = {
        gray: 'bg-gray-100 text-gray-800',
        blue: 'bg-blue-100 text-blue-800',
        green: 'bg-green-100 text-green-800',
        red: 'bg-red-100 text-red-800',
        yellow: 'bg-yellow-100 text-yellow-800',
        indigo: 'bg-indigo-100 text-indigo-800',
        teal: 'bg-teal-100 text-teal-800',
    };
    return `<span class="status-tag ${colorClasses[s.color]}">${s.text}</span>`;
}

function updateJobCounter() {
    const counter = document.getElementById('job-counter');
    const count = difusionState.jobs.length;
    counter.textContent = `${count} Pedido${count === 1 ? '' : 's'} en la lista`;
}

function updateSendAllButtonState() {
    const sendAllBtn = document.getElementById('send-all-btn');
    const readyJobs = difusionState.jobs.filter(job => job.status === 'ready').length;
    sendAllBtn.disabled = readyJobs === 0;
    sendAllBtn.innerHTML = `<i class="fas fa-paper-plane"></i> Enviar ${readyJobs > 0 ? `(${readyJobs})` : ''}`;
}

function checkJobReady(jobId) {
    const job = difusionState.jobs.find(j => j.id === jobId);
    if (!job) return;

    // A job is ready if it has a contact ID (phone number) and a photo URL.
    if (job.contactId && job.photoUrl) {
        job.status = 'ready';
    } else if (job.verificationStatus === 'error') {
        job.status = 'error';
    } else if (job.status !== 'uploading') {
        job.status = 'pending';
    }
    updateRowUI(job);
    updateSendAllButtonState();
}

function toggleQuickReplyDropdown(forceState) {
    const dropdown = document.getElementById('quick-reply-dropdown');
    const isHidden = dropdown.classList.contains('hidden');
    if (typeof forceState === 'boolean') {
        dropdown.classList.toggle('hidden', !forceState);
    } else {
        dropdown.classList.toggle('hidden');
    }
}

// --- UTILIDADES ---

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

// Configuración de Drag and Drop para fotos
function setupDragAndDrop(container) {
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const uploader = e.target.closest('.photo-uploader');
        if (uploader) {
            uploader.classList.add('drag-over');
        }
    });

    container.addEventListener('dragleave', (e) => {
        e.preventDefault();
        const uploader = e.target.closest('.photo-uploader');
        if (uploader) {
            uploader.classList.remove('drag-over');
        }
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const uploader = e.target.closest('.photo-uploader');
        if (uploader) {
            uploader.classList.remove('drag-over');
            const row = uploader.closest('tr');
            if (e.dataTransfer.files.length > 0) {
                handlePhotoUpload(e.dataTransfer.files[0], row.dataset.id);
            }
        }
    });
}

