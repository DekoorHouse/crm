import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, onSnapshot, serverTimestamp, orderBy, doc, updateDoc, where, getDocs, runTransaction, getDoc, deleteDoc, Timestamp, limit as firestoreLimit, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

document.addEventListener('DOMContentLoaded', () => {

    const startTime = Date.now(); 

    const firebaseConfig = {
        apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg", // Replace with your actual Firebase config
        authDomain: "pedidos-con-gemini.firebaseapp.com",
        projectId: "pedidos-con-gemini",
        storageBucket: "pedidos-con-gemini.firebasestorage.app", // Correct storage bucket
        messagingSenderId: "300825194175",
        appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
        measurementId: "G-FTCDCMZB1S"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);

    // --- DOM Elements ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const seccionLogin = document.getElementById('seccionLogin');
    const seccionPedidos = document.getElementById('seccionPedidos');
    const usuarioLogueado = document.getElementById('usuarioLogueado');
    const formularioLogin = document.getElementById('formularioLogin');
    const inputEmail = document.getElementById('email');
    const inputPassword = document.getElementById('password');
    const mensajeErrorLogin = document.getElementById('mensajeError');
    const cuerpoTablaPedidos = document.getElementById('cuerpoTablaPedidos');
    const btnCerrarSesion = document.getElementById('btnCerrarSesion');
    const btnMostrarFormularioPedido = document.getElementById('btnMostrarFormularioPedido');
    const modalNuevoPedido = document.getElementById('modalNuevoPedido');
    const btnCerrarModal = document.getElementById('btnCerrarModal');
    const formularioNuevoPedido = document.getElementById('formularioNuevoPedido');
    const btnCancelarPedido = document.getElementById('btnCancelarPedido');
    const btnGuardarPedido = document.getElementById('btnGuardarPedido');
    const mensajeErrorPedido = document.getElementById('mensajeErrorPedido');
    const modalTitle = document.getElementById('modalTitle');
    const contadorPedidosHoy = document.getElementById('contadorPedidosHoy');
    const contadorPedidosFiltrados = document.getElementById('contadorPedidosFiltrados');
    const contadorSumaFiltrada = document.getElementById('contadorSumaFiltrada');
    const mensajeConfirmacionGeneral = document.getElementById('mensajeConfirmacion');
    const tablaPedidos = document.getElementById('tablaPedidos');
    const tablaContainer = document.querySelector('.tabla-container');
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    const loadAllBtn = document.getElementById('loadAllBtn');
    const copyToast = document.getElementById('copy-toast');
    const photoCopyToast = document.getElementById('photo-copy-toast');


    // Form inputs for pedido
    const pedidoProductoSelect = document.getElementById('pedidoProductoSelect');
    const pedidoTelefonoInput = document.getElementById('pedidoTelefono');
    const pedidoCantidadInput = document.getElementById('pedidoCantidad');
    const pedidoPrecioInput = document.getElementById('pedidoPrecio');
    const pedidoComentariosInput = document.getElementById('pedidoComentarios');
    const pedidoDatosProductoInput = document.getElementById('pedidoDatosProducto');
    const pedidoDatosPromocionInput = document.getElementById('pedidoDatosPromocion');

    // Product Photo elements
    const fileInputContainerProducto = document.getElementById('fileInputContainerProducto');
    const pedidoFotoFileInput = document.getElementById('pedidoFotoFile');
    const fotosPreviewContainer = document.getElementById('fotosPreviewContainer');
    
    // Promotion Photo elements
    const fileInputContainerPromocion = document.getElementById('fileInputContainerPromocion');
    const pedidoFotoPromocionFileInput = document.getElementById('pedidoFotoPromocionFile');
    const promoFotosPreviewContainer = document.getElementById('promoFotosPreviewContainer');

    // "Same Photo" Checkbox Elements
    const mismaFotoContainer = document.getElementById('mismaFotoContainer');
    const mismaFotoCheckbox = document.getElementById('mismaFotoCheckbox');

    // Image modal elements
    const modalImagenPedido = document.getElementById('modalImagenPedido');
    const btnCerrarModalImagen = document.getElementById('btnCerrarModalImagen');
    const imagenModal = document.getElementById('imagenModal');
    const modalImagenPedidoId = document.getElementById('modalImagenPedidoId');
    const modalImagenPrevBtn = document.getElementById('modalImagenPrevBtn');
    const modalImagenNextBtn = document.getElementById('modalImagenNextBtn');
    const modalImagenPedidoCounter = document.getElementById('modalImagenPedidoCounter');
    const modalThumbnailContainer = document.getElementById('modalThumbnailContainer');

    // Filter elements
    const filtroProductoSelect = document.getElementById('filtroProducto');
    const filtroFechaSelect = document.getElementById('filtroFecha');
    const filtroEstatusSelect = document.getElementById('filtroEstatus');
    const btnAplicarFiltros = document.getElementById('btnAplicarFiltros');
    const btnBorrarFiltros = document.getElementById('btnBorrarFiltros');
    const rangoFechaPersonalizadoContainer = document.getElementById('rangoFechaPersonalizado');
    const filtroFechaPersonalizadaInput = document.getElementById('filtroFechaPersonalizada');


    // Dark Mode Toggle elements
    const darkModeToggle = document.getElementById('darkModeToggle');

    // Confirmation Modal for Deletion elements
    const modalConfirmarBorrado = document.getElementById('modalConfirmarBorrado');
    const btnCerrarModalConfirmarBorrado = document.getElementById('btnCerrarModalConfirmarBorrado');
    const textoConfirmarBorrado = document.getElementById('textoConfirmarBorrado');
    const btnCancelarBorrado = document.getElementById('btnCancelarBorrado');
    const btnConfirmarBorradoDefinitivo = document.getElementById('btnConfirmarBorradoDefinitivo');
    const mensajeErrorConfirmacion = document.getElementById('mensajeErrorConfirmacion');

    // New Order Registration Confirmation Modal Elements
    const modalConfirmacionRegistro = document.getElementById('modalConfirmacionRegistro');
    const numeroPedidoConfirmacionSpan = document.getElementById('numeroPedidoConfirmacion');
    const btnCopiarNumeroPedidoConfirmacion = document.getElementById('btnCopiarNumeroPedidoConfirmacion');
    const btnCerrarModalConfirmacionRegistro = document.getElementById('btnCerrarModalConfirmacionRegistro');

    // Full Comment Modal Elements
    const modalComentario = document.getElementById('modalComentario');
    const textoComentarioCompleto = document.getElementById('textoComentarioCompleto');
    const btnCerrarModalComentarioTop = document.getElementById('btnCerrarModalComentarioTop');
    const btnCerrarModalComentarioBottom = document.getElementById('btnCerrarModalComentarioBottom');

    // Search Bar Elements
    const searchBarContainer = document.getElementById('search-bar-container');
    const searchInput = document.getElementById('searchInput');
    const searchMatchIcon = document.getElementById('search-match-icon');
    const closeSearchBtn = document.getElementById('closeSearchBtn');
    const pageOverlay = document.getElementById('page-overlay');
    const searchCounter = document.getElementById('search-counter');
    const prevMatchBtn = document.getElementById('prevMatchBtn');
    const nextMatchBtn = document.getElementById('nextMatchBtn');


    // --- State Management & Firebase Refs ---
    const pedidosCollectionRef = collection(db, "pedidos");
    const orderCounterRef = doc(db, "counters", "orders");

    let unsubscribePedidos = null;
    let unsubscribeHoy = null;
    let activeCircularMenu = null;
    let editingPedidoId = null;
    let pedidoParaBorrarId = null;
    let pedidoParaBorrarData = null;
    let loggedInUserName = '';
    let currentlySelectedRow = null;
    let selectedRowId = null; 
    let searchMatches = [];
    let currentSearchIndex = -1;
    let selectedThumbnail = { element: null, manager: null, index: -1 };
    let datePickerInstance = null;
    let filteredCounterClicks = 0;
    let lastFilteredCounterClickTime = 0;

    // Data map for event delegation (orderId -> pedido data)
    let pedidosDataMap = new Map();

    // Pagination state
    let pedidosPagination = {
        lastVisibleId: null,
        hasMore: true,
        isLoadingMore: false,
        currentFilters: { producto: '', dateFilter: '', estatus: '', customStart: null, customEnd: null }
    };
    let allLoadedPedidos = []; // All currently loaded order data
    let isFetchingAll = false; // Guard against recursive fetchAllRemainingOrders

    // State for multiple order photos
    let orderPhotosManager = [];
    let initialOrderPhotoUrls = []; 

    // State for multiple promotion photos
    let promoPhotosManager = [];
    let initialPromoPhotoUrls = [];
    
    // State for image modal viewer
    let modalImageViewer = {
        urls: [],
        currentIndex: 0,
        orderId: ''
    };

    const statusOptions = [
        { value: "Sin estatus", text: "Sin Estatus", icon: "fas fa-question-circle", color: "#6c757d" },
        { value: "Foto enviada", text: "Foto Enviada", icon: "fas fa-camera-retro", color: "#007bff" },
        { value: "Esperando pago", text: "Esperando Pago", icon: "fas fa-hourglass-half", color: "#ffc107" },
        { value: "Pagado", text: "Pagado", icon: "fas fa-check-circle", color: "#28a745" },
        { value: "Diseñado", text: "Diseñado", icon: "fas fa-palette", color: "#6f42c1" },
        { value: "Fabricar", text: "Fabricar", icon: "fas fa-cogs", color: "#17a2b8" },
        { value: "Corregir", text: "Corregir", icon: "fas fa-edit", color: "#fd7e14" },
        { value: "Corregido", text: "Corregido", icon: "fas fa-check-double", color: "#20c997" },
        { value: "Mns Amenazador", text: "Mns Amenazador", icon: "fas fa-skull-crossbones", color: "#dc3545" },
        { value: "Cancelado", text: "Cancelado", icon: "fas fa-times-circle", color: "#6c757d" }
    ];

    // --- All Function Definitions ---
    
    function applySavedTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            if (darkModeToggle) darkModeToggle.innerHTML = '<i class="fas fa-sun"></i> Modo Claro';
        } else {
            document.body.classList.remove('dark-mode');
             if (darkModeToggle) darkModeToggle.innerHTML = '<i class="fas fa-moon"></i> Modo Oscuro';
        }
    }
    
    function preloadImage(src) { const img = new Image(); img.src = src; }

    function formatFirebaseTimestamp(timestamp) {
         if (!timestamp) return 'Fecha inválida';
         try {
             let date;
             if (typeof timestamp.toDate === 'function') {
                 date = timestamp.toDate();
             } else if (timestamp._seconds != null) {
                 date = new Date(timestamp._seconds * 1000);
             } else {
                 return 'Fecha inválida';
             }
             return date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
         } catch (e) { return 'Fecha inválida'; }
    }
    function formatCurrency(value) {
        const number = Number(value);
        if (isNaN(number)) return '-';
        return number.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
    }


    function arePhotoArraysIdentical(arr1, arr2) {
        if (arr1.length !== arr2.length) return false;
        const getSignature = (p) => p.isNew ? p.file.name + p.file.size : p.url;
        const signatures1 = arr1.map(getSignature).sort();
        const signatures2 = arr2.map(getSignature).sort();
        return signatures1.every((val, index) => val === signatures2[index]);
    }

    function createPhotoPreviewRenderer(previewContainer, photoManager, onUpdateCallback) {
        let draggedItem = null;

        const renderPreviews = () => {
            previewContainer.innerHTML = '';
            
            photoManager.forEach((photo, index) => {
                const thumb = document.createElement('div');
                thumb.className = 'preview-thumbnail';
                
                thumb.dataset.index = index;
                thumb.draggable = true;
                
                thumb.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (selectedThumbnail.element && selectedThumbnail.element !== thumb) {
                        selectedThumbnail.element.classList.remove('selected');
                    }
                    
                    if (thumb.classList.contains('selected')) {
                        thumb.classList.remove('selected');
                        selectedThumbnail = { element: null, manager: null, index: -1 };
                    } else {
                        thumb.classList.add('selected');
                        selectedThumbnail = { element: thumb, manager: photoManager, index };
                    }
                });

                thumb.addEventListener('dragstart', e => {
                    draggedItem = thumb;
                    e.dataTransfer.setData('draggedIndex', index);
                    e.dataTransfer.setData('sourceContainerId', previewContainer.id);
                    setTimeout(() => thumb.classList.add('dragging'), 0);
                });

                thumb.addEventListener('dragend', () => {
                    if (draggedItem) {
                        draggedItem.classList.remove('dragging');
                    }
                    draggedItem = null;
                });

                const img = document.createElement('img');
                img.src = photo.isNew ? URL.createObjectURL(photo.file) : photo.url;
                if (photo.isNew) {
                    img.onload = () => URL.revokeObjectURL(img.src);
                }
                
                const delBtn = document.createElement('button');
                delBtn.className = 'delete-photo-btn';
                delBtn.innerHTML = '&times;';
                delBtn.title = 'Eliminar esta foto';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (thumb.classList.contains('selected')) {
                        selectedThumbnail = { element: null, manager: null, index: -1 };
                    }
                    photoManager.splice(index, 1);
                    renderPreviews(); 
                };

                thumb.appendChild(img);
                thumb.appendChild(delBtn);
                previewContainer.appendChild(thumb);
            });

            if (onUpdateCallback) {
                onUpdateCallback(photoManager, previewContainer);
            }
        };

        previewContainer.addEventListener('dragover', e => {
            e.preventDefault();
            const afterElement = getDragAfterElement(previewContainer, e.clientX);
            previewContainer.querySelectorAll('.preview-thumbnail').forEach(t => t.classList.remove('drag-over-placeholder'));
            const sourceContainerId = e.dataTransfer.getData('sourceContainerId');
            if (sourceContainerId) {
                 if(document.querySelector('.dragging')){
                     if (afterElement) {
                        afterElement.classList.add('drag-over-placeholder');
                     }
                 }
            }
        });
        
         previewContainer.addEventListener('dragleave', e => {
             if (!previewContainer.contains(e.relatedTarget)) {
                previewContainer.querySelectorAll('.preview-thumbnail').forEach(t => t.classList.remove('drag-over-placeholder'));
             }
        });

        previewContainer.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            previewContainer.querySelectorAll('.preview-thumbnail').forEach(t => t.classList.remove('drag-over-placeholder'));

            const sourceContainerId = e.dataTransfer.getData('sourceContainerId');
            const draggedIndex = e.dataTransfer.getData('draggedIndex');

            if (sourceContainerId && draggedIndex !== null) {
                if (sourceContainerId === previewContainer.id) {
                    const oldIndex = parseInt(draggedIndex);
                    const afterElement = getDragAfterElement(previewContainer, e.clientX);
                    let newIndex;

                    if (afterElement == null) {
                        newIndex = photoManager.length;
                    } else {
                        newIndex = parseInt(afterElement.dataset.index);
                    }

                    const [movedItem] = photoManager.splice(oldIndex, 1);
                    photoManager.splice(newIndex > oldIndex ? newIndex - 1 : newIndex, 0, movedItem);
                    
                } else {
                    const sourceManager = (sourceContainerId === fotosPreviewContainer.id) ? orderPhotosManager : promoPhotosManager;
                    const photoToCopy = sourceManager[draggedIndex];

                    if (photoToCopy) {
                        const newPhoto = { ...p, isNew: true, file: p.file };
                        photoManager.push(newPhoto);
                    }
                }
                renderPreviews();
            }
        });
        
        function getDragAfterElement(container, x) {
            const draggableElements = [...container.querySelectorAll('.preview-thumbnail:not(.dragging)')];
            return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = x - box.left - box.width / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }

        return renderPreviews;
    }
    
    const onOrderPhotosUpdate = (manager) => {
        if (!mismaFotoContainer || !mismaFotoCheckbox) return;

        if (manager.length > 0) {
            mismaFotoContainer.style.display = 'flex';
        } else {
            mismaFotoContainer.style.display = 'none';
            if (mismaFotoCheckbox.checked) {
                mismaFotoCheckbox.checked = false;
                promoPhotosManager.length = 0;
                renderPromoPhotoPreviews();
            }
        }

        if (mismaFotoCheckbox.checked) {
            promoPhotosManager.length = 0;
            const newPromoPhotos = manager.map(p => ({ ...p, isNew: true, file: p.file }));
            promoPhotosManager.push(...newPromoPhotos);
            renderPromoPhotoPreviews();
        }
    };
    
    const onPromoPhotosUpdate = (manager) => {
         if (mismaFotoCheckbox.checked && !arePhotoArraysIdentical(orderPhotosManager, promoPhotosManager)) {
            mismaFotoCheckbox.checked = false;
        }
    };

    const renderOrderPhotoPreviews = createPhotoPreviewRenderer(fotosPreviewContainer, orderPhotosManager, onOrderPhotosUpdate);
    const renderPromoPhotoPreviews = createPhotoPreviewRenderer(promoFotosPreviewContainer, promoPhotosManager, onPromoPhotosUpdate);


    function setupDragAndDrop(dropZoneElement, fileInputElement, managerArray, renderFunction) {
        if (!dropZoneElement || !fileInputElement) return;

        dropZoneElement.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZoneElement.classList.add('drag-over');
        });

        dropZoneElement.addEventListener('dragleave', (e) => {
            if (!dropZoneElement.contains(e.relatedTarget)) {
                dropZoneElement.classList.remove('drag-over');
            }
        });

        dropZoneElement.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZoneElement.classList.remove('drag-over');

            const sourceContainerId = e.dataTransfer.getData('sourceContainerId');
            if (sourceContainerId) {
                return; 
            }

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                for (const file of e.dataTransfer.files) {
                     if (file.type.startsWith('image/')) {
                        managerArray.push({ file: file, url: null, isNew: true });
                     }
                }
                renderFunction();
            }
        });
        
         fileInputElement.addEventListener('change', (e) => {
            for (const file of e.target.files) {
                managerArray.push({ file: file, url: null, isNew: true });
            }
            renderFunction();
            e.target.value = '';
        });
    }
    
    function setupPasteListener(pasteZone, manager, renderFunc) {
        pasteZone.addEventListener('paste', e => {
            e.preventDefault();
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            let imagesPasted = false;
            for (const item of items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    manager.push({ file, url: null, isNew: true });
                    imagesPasted = true;
                }
            }
            if (imagesPasted) {
                renderFunc();
            }
        });
    }
    
    function abrirModalPedido(pedidoData = null) {
        if (!modalNuevoPedido || !formularioNuevoPedido || !modalTitle || !btnGuardarPedido || !pedidoPrecioInput) return;

        formularioNuevoPedido.reset();
        editingPedidoId = null;
        mensajeErrorPedido.textContent = '';
        
        orderPhotosManager.length = 0;
        initialOrderPhotoUrls.length = 0;
        promoPhotosManager.length = 0;
        initialPromoPhotoUrls.length = 0;
        selectedThumbnail = { element: null, manager: null, index: -1 };
        mismaFotoContainer.style.display = 'none';
        fileInputContainerPromocion.style.pointerEvents = 'auto';
        fileInputContainerPromocion.style.opacity = '1';
        
        if (pedidoData) { // EDIT MODE
            modalTitle.innerHTML = '<i class="fas fa-edit"></i> Editar Pedido';
            btnGuardarPedido.innerHTML = '<i class="fas fa-save"></i> Guardar Cambios';
            editingPedidoId = pedidoData.id;

            pedidoProductoSelect.value = pedidoData.producto || '';

            pedidoTelefonoInput.value = pedidoData.telefono || '';
            // Soporta tanto 'cantidad' a nivel raiz como en items[0]
            const editCantidad = pedidoData.cantidad
                || (Array.isArray(pedidoData.items) && pedidoData.items[0]?.cantidad)
                || 1;
            if (pedidoCantidadInput) pedidoCantidadInput.value = Math.max(1, Number(editCantidad) || 1);
            pedidoPrecioInput.value = pedidoData.precio || '';
            pedidoComentariosInput.value = pedidoData.comentarios || '';
            pedidoDatosProductoInput.value = pedidoData.datosProducto || '';
            pedidoDatosPromocionInput.value = pedidoData.datosPromocion || '';

            const photoUrls = pedidoData.fotoUrls || (pedidoData.fotoUrl ? [pedidoData.fotoUrl] : []);
            initialOrderPhotoUrls.push(...photoUrls);
            photoUrls.forEach(url => orderPhotosManager.push({ file: null, url: url, isNew: false }));

            const promoUrls = pedidoData.fotoPromocionUrls || (pedidoData.fotoPromocionUrl ? [pedidoData.fotoPromocionUrl] : []);
            initialPromoPhotoUrls.push(...promoUrls);
            promoUrls.forEach(url => promoPhotosManager.push({ file: null, url: url, isNew: false }));

        } else { // NEW ORDER MODE
            modalTitle.innerHTML = '<i class="fas fa-pencil-alt"></i> Registrar Nuevo Pedido';
            btnGuardarPedido.innerHTML = '<i class="fas fa-save"></i> Guardar Pedido';
            pedidoPrecioInput.value = '650';
            pedidoProductoSelect.value = 'Spiderman';
            if (pedidoCantidadInput) pedidoCantidadInput.value = '1';
        }

        renderOrderPhotoPreviews();
        renderPromoPhotoPreviews();

        modalNuevoPedido.style.display = 'flex';
        document.body.classList.add('modal-open');
        pedidoProductoSelect.focus();
    }

    function cerrarModalPedido() {
        if (!modalNuevoPedido) return;
        modalNuevoPedido.style.display = 'none';
        document.body.classList.remove('modal-open');
        if(btnGuardarPedido) btnGuardarPedido.disabled = false;
        if(btnCancelarPedido) btnCancelarPedido.disabled = false;
        if(btnGuardarPedido) btnGuardarPedido.innerHTML = '<i class="fas fa-save"></i> Guardar Pedido';
        editingPedidoId = null;
    }

    function updateModalImageView() {
        const { urls, currentIndex, orderId } = modalImageViewer;
        if (!urls || urls.length === 0) {
            cerrarModalImagen();
            return;
        }
        
        imagenModal.src = urls[currentIndex];
        modalImagenPedidoId.textContent = orderId;
        modalImagenPedidoCounter.textContent = `${currentIndex + 1} / ${urls.length}`;
        modalImagenPrevBtn.disabled = currentIndex === 0;
        modalImagenNextBtn.disabled = currentIndex === urls.length - 1;

        document.querySelectorAll('.modal-thumbnail-item').forEach(thumb => thumb.classList.remove('active'));
        const activeThumb = document.querySelector(`.modal-thumbnail-item[data-index="${currentIndex}"]`);
        if(activeThumb) {
            activeThumb.classList.add('active');
            activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }

        if (currentIndex < urls.length - 1) preloadImage(urls[currentIndex + 1]);
        if (currentIndex > 0) preloadImage(urls[currentIndex - 1]);
    }

    function abrirModalImagen(imageUrls, startIndex, orderId) {
        if (!modalImagenPedido || !imageUrls || imageUrls.length === 0) return;
        
        modalImageViewer = {
            urls: imageUrls,
            currentIndex: startIndex,
            orderId: orderId
        };
        
        modalThumbnailContainer.innerHTML = '';
        imageUrls.forEach((url, index) => {
            const thumbImg = document.createElement('img');
            thumbImg.src = url;
            thumbImg.className = 'modal-thumbnail-item';
            thumbImg.dataset.index = index;
            thumbImg.addEventListener('click', () => {
                modalImageViewer.currentIndex = index;
                updateModalImageView();
            });
            modalThumbnailContainer.appendChild(thumbImg);
        });

        updateModalImageView();
        modalImagenPedido.style.display = 'flex';
        document.body.classList.add('modal-open');
    }

    function cerrarModalImagen() {
        if (!modalImagenPedido) return;
        modalImagenPedido.style.display = 'none';
        document.body.classList.remove('modal-open');
        imagenModal.src = '';
        modalThumbnailContainer.innerHTML = '';
        modalImageViewer = { urls: [], currentIndex: 0, orderId: '' };
    }
    
    function abrirModalConfirmarBorrado(pedidoId, pedidoData) {
        if (!modalConfirmarBorrado || !textoConfirmarBorrado || !mensajeErrorConfirmacion) return;
        pedidoParaBorrarId = pedidoId;
        pedidoParaBorrarData = pedidoData;
        textoConfirmarBorrado.innerHTML = `¿Estás seguro de que quieres borrar el pedido <strong>DH${pedidoData.consecutiveOrderNumber || pedidoId}</strong>? Esta acción no se puede deshacer.`;
        mensajeErrorConfirmacion.textContent = '';
        mensajeErrorConfirmacion.className = '';
        modalConfirmarBorrado.style.display = 'flex';
        document.body.classList.add('modal-open');
        if(btnConfirmarBorradoDefinitivo) btnConfirmarBorradoDefinitivo.disabled = false;
        if(btnCancelarBorrado) btnCancelarBorrado.disabled = false;
    }

    function cerrarModalConfirmarBorrado() {
        if (!modalConfirmarBorrado) return;
        modalConfirmarBorrado.style.display = 'none';
        document.body.classList.remove('modal-open');
        pedidoParaBorrarId = null;
        pedidoParaBorrarData = null;
        if(btnConfirmarBorradoDefinitivo) btnConfirmarBorradoDefinitivo.innerHTML = '<i class="fas fa-trash-alt"></i> Sí, Borrar';
    }

    // ============================================================
    // MODAL OXXO: Genera referencia de pago para mandar por WhatsApp
    // ============================================================
    let oxxoPedidoActual = null;

    function abrirModalOxxo(pedidoId, pedidoData) {
        const modal = document.getElementById('modalOxxo');
        if (!modal) return;
        oxxoPedidoActual = { id: pedidoId, data: pedidoData };

        // Si ya existe una referencia OXXO en el pedido, mostrarla directamente
        if (pedidoData.oxxo && pedidoData.oxxo.barcodeContent) {
            renderResultadoOxxo({
                amount: pedidoData.oxxo.amount,
                customerName: pedidoData.consecutiveOrderNumber ? `DH${pedidoData.consecutiveOrderNumber}` : '',
                barcodeContent: pedidoData.oxxo.barcodeContent,
                voucherUrl: pedidoData.oxxo.voucherUrl,
                expirationDate: pedidoData.oxxo.expirationDate
            }, pedidoData);
        } else {
            // Step 1: pre-llenar con datos del pedido
            document.getElementById('oxxoStepDatos').style.display = '';
            document.getElementById('oxxoStepResultado').style.display = 'none';
            document.getElementById('oxxoMontoInput').value = pedidoData.precio || '';
            document.getElementById('oxxoNombreInput').value = '';
            document.getElementById('oxxoNotaInput').value = '';
            const orderNum = pedidoData.consecutiveOrderNumber ? `DH${pedidoData.consecutiveOrderNumber}` : pedidoId;
            const tel = pedidoData.telefono || 's/n';
            const prod = pedidoData.producto || 's/p';
            document.getElementById('oxxoPedidoInfo').innerHTML =
                `<strong>Pedido:</strong> ${orderNum} &nbsp;·&nbsp; <strong>Tel:</strong> ${tel} &nbsp;·&nbsp; <strong>Producto:</strong> ${prod}`;
            document.getElementById('oxxoErrorMsg').style.display = 'none';
            const btn = document.getElementById('btnGenerarOxxo');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-bolt"></i> Generar referencia';
        }

        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    }

    function cerrarModalOxxo() {
        const modal = document.getElementById('modalOxxo');
        if (!modal) return;
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
        oxxoPedidoActual = null;
    }

    async function generarReferenciaOxxo() {
        if (!oxxoPedidoActual) return;
        const monto = parseFloat(document.getElementById('oxxoMontoInput').value);
        const nombre = document.getElementById('oxxoNombreInput').value.trim();
        const nota = document.getElementById('oxxoNotaInput').value.trim();
        const errorEl = document.getElementById('oxxoErrorMsg');
        errorEl.style.display = 'none';

        if (!monto || monto <= 0) {
            errorEl.textContent = 'Ingresa un monto válido.';
            errorEl.style.display = 'block';
            return;
        }

        const btn = document.getElementById('btnGenerarOxxo');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';

        const pedido = oxxoPedidoActual.data;
        const orderNumber = pedido.consecutiveOrderNumber ? `DH${pedido.consecutiveOrderNumber}` : oxxoPedidoActual.id;

        try {
            const res = await fetch((window.API_BASE_URL || '') + '/api/mercadopago/oxxo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: monto,
                    customerName: nombre || pedido.cliente || '',
                    customerPhone: pedido.telefono || '',
                    orderNumber,
                    productName: pedido.producto ? `${pedido.producto} - ${orderNumber}` : `Pedido ${orderNumber}`,
                    note: nota
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al generar referencia');

            renderResultadoOxxo({
                amount: data.amount,
                customerName: nombre || pedido.cliente || '',
                barcodeContent: data.barcodeContent,
                voucherUrl: data.voucherUrl,
                expirationDate: data.expirationDate
            }, pedido);
        } catch (err) {
            console.error('[OXXO] Error:', err);
            errorEl.textContent = 'Error: ' + err.message;
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-bolt"></i> Generar referencia';
        }
    }

    function renderResultadoOxxo(data, pedido) {
        document.getElementById('oxxoStepDatos').style.display = 'none';
        document.getElementById('oxxoStepResultado').style.display = '';

        const orderNumber = pedido?.consecutiveOrderNumber ? `DH${pedido.consecutiveOrderNumber}` : '';
        document.getElementById('oxxoResultMonto').textContent = `$${Number(data.amount).toLocaleString('es-MX')} MXN`;
        document.getElementById('oxxoResultRef').textContent = data.barcodeContent || '-';

        let venceTxt = '-';
        if (data.expirationDate) {
            try {
                const d = data.expirationDate.toDate ? data.expirationDate.toDate() : new Date(data.expirationDate);
                venceTxt = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            } catch {}
        }
        document.getElementById('oxxoResultVence').textContent = venceTxt;

        // Imagen del ticket
        const imgWrap = document.getElementById('oxxoTicketImageWrap');
        const imgEl = document.getElementById('oxxoTicketImage');
        const dlLink = document.getElementById('oxxoTicketDownload');
        if (data.ticketImageUrl) {
            imgEl.src = data.ticketImageUrl;
            dlLink.href = data.ticketImageUrl;
            imgWrap.style.display = '';
            dlLink.style.display = '';
        } else {
            imgWrap.style.display = 'none';
            dlLink.style.display = 'none';
        }

        const voucherLink = document.getElementById('oxxoResultVoucherLink');
        voucherLink.href = data.voucherUrl || '#';
        voucherLink.style.display = data.voucherUrl ? '' : 'none';

        // Boton: enviar imagen al cliente directo via WhatsApp API
        const btnEnviar = document.getElementById('btnEnviarImagenWA');
        btnEnviar.onclick = async () => {
            if (!data.ticketImageUrl) {
                alert('No hay imagen del ticket. Vuelve a generar.');
                return;
            }
            const original = btnEnviar.innerHTML;
            btnEnviar.disabled = true;
            btnEnviar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
            try {
                const res = await fetch((window.API_BASE_URL || '') + '/api/mercadopago/oxxo/send-to-customer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        externalReference: data.externalReference,
                        customerPhone: pedido?.telefono || ''
                    })
                });
                const j = await res.json();
                if (!res.ok || !j.success) throw new Error(j.error || 'Error al enviar');
                btnEnviar.innerHTML = '<i class="fas fa-check"></i> ¡Imagen enviada!';
                btnEnviar.style.background = '#10b981';
            } catch (err) {
                btnEnviar.disabled = false;
                btnEnviar.innerHTML = original;
                alert('Error: ' + err.message);
            }
        };
    }

    function mostrarModalConfirmacionRegistro(numeroPedido) {
        if (!modalConfirmacionRegistro || !numeroPedidoConfirmacionSpan || !btnCopiarNumeroPedidoConfirmacion) return;

        numeroPedidoConfirmacionSpan.textContent = `DH${numeroPedido}`;
        btnCopiarNumeroPedidoConfirmacion.innerHTML = '<i class="fas fa-copy"></i>';
        btnCopiarNumeroPedidoConfirmacion.classList.remove('copied');

        modalConfirmacionRegistro.style.display = 'flex';
        document.body.classList.add('modal-open');

        if (typeof confetti === 'function') {
            const duration = 3 * 1000;
            const animationEnd = Date.now() + duration;
            const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1001 };

            function randomInRange(min, max) { return Math.random() * (max - min) + min; }

            const interval = setInterval(function() {
                const timeLeft = animationEnd - Date.now();
                if (timeLeft <= 0) return clearInterval(interval);

                const particleCount = 50 * (timeLeft / duration);
                confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
                confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
            }, 250);

            confetti({
                particleCount: 150,
                spread: 100,
                origin: { y: 0.6 },
                zIndex: 1001,
                colors: ['#E07A5F', '#81B29A', '#F2CC8F', '#FFFBF5', '#5D5C61']
            });

        } else {
            console.warn("La librería confetti no está cargada.");
        }
    }

    function cerrarModalConfirmacionRegistro() {
        if (!modalConfirmacionRegistro) return;
        modalConfirmacionRegistro.style.display = 'none';
        document.body.classList.remove('modal-open');
    }

    function abrirModalComentario(texto) {
        if(!modalComentario || !textoComentarioCompleto) return;
        textoComentarioCompleto.textContent = texto || 'No hay comentario.';
        modalComentario.style.display = 'flex';
        document.body.classList.add('modal-open');
    }

    function cerrarModalComentario() {
        if(!modalComentario) return;
        modalComentario.style.display = 'none';
        document.body.classList.remove('modal-open');
    }

    function getDateRange(filter) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let startDate = null, endDate = null;
        switch (filter) {
            case 'hoy':
                startDate = today;
                endDate = new Date(today);
                endDate.setDate(today.getDate() + 1);
                break;
            case 'ayer':
                startDate = new Date(today);
                startDate.setDate(today.getDate() - 1);
                endDate = today;
                break;
            case 'este-mes':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                break;
            case 'ultimos-10-dias':
                startDate = new Date(today);
                startDate.setDate(today.getDate() - 9);
                endDate = new Date(today);
                endDate.setDate(today.getDate() + 1);
                break;
        }
        return { startDate, endDate };
    }
    
    // --- Row rendering helper ---
    function detectPhoneDuplicates(orders) {
        const ordersToHighlight = new Set();
        const phoneGroups = new Map();
        for (const order of orders) {
            if (!order.telefono || !order.createdAt) continue;
            let date;
            if (typeof order.createdAt.toDate === 'function') {
                date = order.createdAt.toDate();
            } else if (order.createdAt._seconds != null) {
                date = new Date(order.createdAt._seconds * 1000);
            } else continue;
            if (!phoneGroups.has(order.telefono)) phoneGroups.set(order.telefono, []);
            phoneGroups.get(order.telefono).push({ id: order.id, date });
        }
        for (const [, entries] of phoneGroups) {
            if (entries.length < 2) continue;
            entries.sort((a, b) => a.date - b.date);
            for (let i = 0; i < entries.length - 1; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    const diffHours = (entries[j].date - entries[i].date) / 36e5;
                    if (diffHours >= 24) break;
                    ordersToHighlight.add(entries[i].id);
                    ordersToHighlight.add(entries[j].id);
                }
            }
        }
        return ordersToHighlight;
    }

    function createPedidoRow(pedido, ordersToHighlight) {
        pedidosDataMap.set(pedido.id, pedido);
        const tr = document.createElement('tr');
        tr.dataset.id = pedido.id;

        const consecutiveOrderNumber = pedido.consecutiveOrderNumber || 'N/A';
        const fechaFormateada = formatFirebaseTimestamp(pedido.createdAt);
        const vendedor = pedido.vendedor || '<em>N/A</em>';
        const telefonoOriginal = pedido.telefono || '-';
        const estatus = pedido.estatus || 'Sin estatus';
        const comentarios = pedido.comentarios || '-';
        // Soportar pedidos con múltiples items embebidos
        const formatItemName = (it) => {
            const qty = Number(it.cantidad) || 1;
            return qty > 1 ? `${it.producto} ×${qty}` : it.producto;
        };
        let productoNombre;
        let precioTotal = Number(pedido.precio) || 0;
        if (Array.isArray(pedido.items) && pedido.items.length > 0) {
            // Recalcular total considerando cantidad por item
            precioTotal = pedido.items.reduce((sum, it) => {
                const qty = Math.max(1, Number(it.cantidad) || 1);
                return sum + (Number(it.precio) || 0) * qty;
            }, 0);
            if (pedido.items.length === 1) {
                productoNombre = formatItemName(pedido.items[0]);
            } else if (pedido.items.length <= 3) {
                productoNombre = pedido.items.map(formatItemName).join(' + ');
            } else {
                productoNombre = `${pedido.items.length} productos`;
            }
        } else {
            // Legacy: producto + cantidad a nivel raiz
            const qty = Math.max(1, Number(pedido.cantidad) || 1);
            precioTotal = (Number(pedido.precio) || 0) * qty;
            productoNombre = pedido.producto
                ? (qty > 1 ? `${pedido.producto} ×${qty}` : pedido.producto)
                : '<em>N/A</em>';
        }
        const precioFormateado = formatCurrency(precioTotal);
        const datosProductoTexto = pedido.datosProducto || '-';
        const datosPromocionTexto = pedido.datosPromocion || '-';

        const orderPhotoUrls = pedido.fotoUrls || (pedido.fotoUrl ? [pedido.fotoUrl] : []);
        const promoPhotoUrls = pedido.fotoPromocionUrls || (pedido.fotoPromocionUrl ? [pedido.fotoPromocionUrl] : []);

        const createTd = (content, isHtml = false) => {
            const td = document.createElement('td');
            if (isHtml) td.innerHTML = content; else td.textContent = content;
            return td;
        };

        const createDatosCell = (photoUrls, texto, orderId, type) => {
            const td = createTd('');
            const container = document.createElement('div');
            container.className = 'datos-container';

            if (photoUrls.length > 0) {
                const imgContainer = document.createElement('div');
                imgContainer.className = 'img-container';

                const placeholder = document.createElement('div');
                placeholder.className = 'foto-placeholder-icon';
                placeholder.innerHTML = '<i class="fas fa-camera"></i>';
                placeholder.title = 'Ver foto(s)';

                placeholder.dataset.action = 'view-photo';
                placeholder.dataset.photoUrls = JSON.stringify(photoUrls);
                placeholder.dataset.orderNumber = orderId;
                imgContainer.appendChild(placeholder);

                if (photoUrls.length > 1) {
                    const badge = document.createElement('span');
                    badge.className = 'photo-count-badge';
                    badge.textContent = `+${photoUrls.length - 1}`;
                    badge.title = `${photoUrls.length} fotos en total`;
                    imgContainer.appendChild(badge);
                }
                container.appendChild(imgContainer);
            } else {
                const ph = document.createElement('span');
                ph.className = 'foto-placeholder'; ph.textContent = '-';
                container.appendChild(ph);
            }

            const textoSpan = document.createElement('span');
            textoSpan.className = 'datos-text';
            textoSpan.innerHTML = texto;
            container.appendChild(textoSpan);
            td.appendChild(container);
            return td;
        };

        tr.appendChild(createTd(consecutiveOrderNumber !== 'N/A' ? `DH${consecutiveOrderNumber}` : 'N/A'));
        tr.appendChild(createTd(fechaFormateada));
        tr.appendChild(createTd(vendedor, true));

        const telefonoTd = document.createElement('td');
        const phoneActionsContainer = document.createElement('div');
        phoneActionsContainer.className = 'phone-actions-container';

        if (telefonoOriginal !== '-') {
            const checkboxContainer = document.createElement('label');
            checkboxContainer.className = 'phone-checkbox-container';
            checkboxContainer.title = 'Marcar como verificado';

            const checkboxInput = document.createElement('input');
            checkboxInput.type = 'checkbox';
            checkboxInput.checked = pedido.telefonoVerificado === true;
            checkboxInput.dataset.action = 'toggle-phone-verified';
            checkboxInput.dataset.orderId = pedido.id;

            const checkmarkSpan = document.createElement('span');
            checkmarkSpan.className = 'checkmark';

            checkboxContainer.appendChild(checkboxInput);
            checkboxContainer.appendChild(checkmarkSpan);
            phoneActionsContainer.appendChild(checkboxContainer);
        }

        const telefonoSpan = document.createElement('span');
        telefonoSpan.textContent = telefonoOriginal;
        if (ordersToHighlight.has(pedido.id)) {
            telefonoSpan.style.color = 'red';
            telefonoSpan.style.fontWeight = 'bold';
            telefonoSpan.title = 'Este número fue registrado múltiples veces en menos de 24 horas.';
        }
        phoneActionsContainer.appendChild(telefonoSpan);

        if (telefonoOriginal !== '-') {
            const copyButton = document.createElement('button');
            copyButton.className = 'copy-phone-button';
            copyButton.title = 'Copiar teléfono';
            copyButton.innerHTML = '<i class="fas fa-copy"></i>';
            copyButton.dataset.action = 'copy-phone';
            copyButton.dataset.phone = telefonoOriginal;
            phoneActionsContainer.appendChild(copyButton);
        }
        telefonoTd.appendChild(phoneActionsContainer);
        tr.appendChild(telefonoTd);

        const estatusTdCell = createTd('');
        const statusActionsContainer = document.createElement('div');
        statusActionsContainer.className = 'status-actions-container';

        const checkboxContainerEstatus = document.createElement('label');
        checkboxContainerEstatus.className = 'status-checkbox-container';
        checkboxContainerEstatus.title = 'Marcar como verificado';

        const checkboxInputEstatus = document.createElement('input');
        checkboxInputEstatus.type = 'checkbox';
        checkboxInputEstatus.checked = pedido.estatusVerificado === true;
        checkboxInputEstatus.dataset.action = 'toggle-status-verified';
        checkboxInputEstatus.dataset.orderId = pedido.id;

        const checkmarkSpanEstatus = document.createElement('span');
        checkmarkSpanEstatus.className = 'checkmark';

        checkboxContainerEstatus.appendChild(checkboxInputEstatus);
        checkboxContainerEstatus.appendChild(checkmarkSpanEstatus);
        statusActionsContainer.appendChild(checkboxContainerEstatus);

        const estatusSpan = document.createElement('span');
        estatusSpan.className = `status-display status-${estatus.toLowerCase().replace(/\s+/g, '-')}`;
        estatusSpan.textContent = estatus;
        estatusSpan.title = "Clic para cambiar estatus";
        estatusSpan.dataset.action = 'change-status';
        estatusSpan.dataset.orderId = pedido.id;
        estatusSpan.dataset.status = estatus;
        statusActionsContainer.appendChild(estatusSpan);

        estatusTdCell.appendChild(statusActionsContainer);
        tr.appendChild(estatusTdCell);

        const comentariosTd = createTd(comentarios);
        comentariosTd.classList.add('comment-cell');
        comentariosTd.dataset.fullText = comentarios;
        comentariosTd.title = 'Doble clic para ver el comentario completo';
        tr.appendChild(comentariosTd);

        tr.appendChild(createTd(productoNombre, true));
        tr.appendChild(createDatosCell(orderPhotoUrls, datosProductoTexto, consecutiveOrderNumber, 'Pedido'));
        tr.appendChild(createDatosCell(promoPhotoUrls, datosPromocionTexto, consecutiveOrderNumber, 'Promo'));
        tr.appendChild(createTd(precioFormateado));

        const accionesTd = createTd('');
        const editButton = document.createElement('button');
        editButton.className = 'action-button edit-button';
        editButton.innerHTML = '<i class="fas fa-edit"></i> Editar';
        editButton.title = 'Editar Pedido';
        editButton.dataset.action = 'edit';
        editButton.dataset.orderId = pedido.id;
        accionesTd.appendChild(editButton);

        // Boton OXXO: genera referencia de pago y la copia para mandar por WhatsApp
        const oxxoButton = document.createElement('button');
        const oxxoEstado = pedido.oxxo?.status;
        if (oxxoEstado === 'approved') {
            oxxoButton.className = 'action-button oxxo-button oxxo-paid';
            oxxoButton.innerHTML = '<i class="fas fa-check-circle"></i> OXXO Pagado';
            oxxoButton.title = 'Pago OXXO acreditado';
        } else if (oxxoEstado === 'pending') {
            oxxoButton.className = 'action-button oxxo-button oxxo-pending';
            oxxoButton.innerHTML = '<i class="fas fa-clock"></i> OXXO Pendiente';
            oxxoButton.title = 'Ver referencia OXXO';
        } else {
            oxxoButton.className = 'action-button oxxo-button';
            oxxoButton.innerHTML = '<i class="fas fa-store"></i> OXXO';
            oxxoButton.title = 'Generar referencia de pago OXXO';
        }
        oxxoButton.dataset.action = 'oxxo';
        oxxoButton.dataset.orderId = pedido.id;
        accionesTd.appendChild(oxxoButton);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'action-button delete-button';
        deleteButton.innerHTML = '<i class="fas fa-trash-alt"></i> Borrar';
        deleteButton.title = 'Borrar Pedido';
        deleteButton.dataset.action = 'delete';
        deleteButton.dataset.orderId = pedido.id;
        accionesTd.appendChild(deleteButton);
        tr.appendChild(accionesTd);

        return tr;
    }

    function renderOrders(orders, append = false) {
        if (!cuerpoTablaPedidos) return;

        if (!append) {
            cuerpoTablaPedidos.innerHTML = '';
        } else {
            // Remove the loading sentinel if present
            const sentinel = cuerpoTablaPedidos.querySelector('.loading-sentinel');
            if (sentinel) sentinel.remove();
        }

        if (orders.length === 0 && !append) {
            cuerpoTablaPedidos.innerHTML = `<tr><td colspan="11" class="empty-cell">Aún no hay pedidos registrados que coincidan con los filtros. 😊</td></tr>`;
            return;
        }

        const ordersToHighlight = detectPhoneDuplicates(allLoadedPedidos);

        const fragment = document.createDocumentFragment();
        orders.forEach(pedido => {
            fragment.appendChild(createPedidoRow(pedido, ordersToHighlight));
        });
        cuerpoTablaPedidos.appendChild(fragment);

        // Add loading sentinel for infinite scroll
        if (pedidosPagination.hasMore) {
            const sentinel = document.createElement('tr');
            sentinel.className = 'loading-sentinel';
            sentinel.innerHTML = `<td colspan="11" class="loading-cell" style="padding: 12px; text-align: center; opacity: 0.5;"><i class="fas fa-spinner fa-spin"></i> Cargando más...</td>`;
            cuerpoTablaPedidos.appendChild(sentinel);
        }

        if (selectedRowId) {
            const rowToReselect = cuerpoTablaPedidos.querySelector(`tr[data-id="${selectedRowId}"]`);
            if (rowToReselect) {
                rowToReselect.classList.add('selected-row');
                currentlySelectedRow = rowToReselect;
            } else if (!append) {
                selectedRowId = null;
                currentlySelectedRow = null;
            }
        }

        if (document.body.classList.contains('search-active') && !isFetchingAll) {
            performSearch(false);
        }
    }

    // --- Paginated data fetching ---
    function buildApiUrl(filters, startAfterId = null) {
        const params = new URLSearchParams();
        params.set('limit', '50');
        if (filters.producto) params.set('producto', filters.producto);
        if (filters.estatus) params.set('estatus', filters.estatus);
        if (filters.dateFilter) params.set('dateFilter', filters.dateFilter);
        if (filters.customStart) params.set('customStart', filters.customStart);
        if (filters.customEnd) params.set('customEnd', filters.customEnd);
        if (startAfterId) params.set('startAfterId', startAfterId);
        return `/api/orders/list?${params.toString()}`;
    }

    async function getFilteredCount(filters) {
        let q = query(pedidosCollectionRef);
        if (filters.producto) q = query(q, where("producto", "==", filters.producto));
        if (filters.estatus) q = query(q, where("estatus", "==", filters.estatus));
        if (filters.dateFilter === 'personalizado' && filters.customStart && filters.customEnd) {
            q = query(q, where("createdAt", ">=", Timestamp.fromMillis(Number(filters.customStart))));
            q = query(q, where("createdAt", "<=", Timestamp.fromMillis(Number(filters.customEnd))));
        } else if (filters.dateFilter) {
            const { startDate, endDate } = getDateRange(filters.dateFilter);
            if (startDate && endDate) {
                q = query(q, where("createdAt", ">=", startDate), where("createdAt", "<", endDate));
            }
        }
        const snapshot = await getCountFromServer(q);
        return snapshot.data().count;
    }

    async function fetchInitialOrders(filters, silent = false) {
        if (!cuerpoTablaPedidos) return;
        if (unsubscribePedidos) { unsubscribePedidos(); unsubscribePedidos = null; }

        // Reset pagination state
        pedidosPagination = { lastVisibleId: null, hasMore: true, isLoadingMore: false, currentFilters: { ...filters } };
        allLoadedPedidos = [];
        pedidosDataMap.clear();

        if (!silent) {
            cuerpoTablaPedidos.innerHTML = `<tr><td colspan="11" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Cargando pedidos lindos...</td></tr>`;
        }

        try {
            const response = await fetch(buildApiUrl(filters));
            const data = await response.json();

            if (!data.success) throw new Error(data.message || 'Error fetching orders');

            allLoadedPedidos = data.orders;
            pedidosPagination.lastVisibleId = data.lastVisibleId;
            pedidosPagination.hasMore = data.hasMore;

            // Update counters — exact count from server
            const exactCount = await getFilteredCount(filters);
            const sumaTotal = allLoadedPedidos.reduce((sum, o) => sum + (Number(o.precio) || 0), 0);

            const defaultDateFilter = (auth.currentUser && auth.currentUser.email === 'alex@dekoor.com') ? 'hoy' : 'ultimos-10-dias';
            const isDefaultView = !filters.producto && !filters.estatus && filters.dateFilter === defaultDateFilter && !filters.customStart;

            contadorPedidosFiltrados.textContent = `${exactCount} filtrados`;
            contadorSumaFiltrada.textContent = formatCurrency(sumaTotal);
            contadorPedidosFiltrados.classList.toggle('visible', !isDefaultView);
            if (isDefaultView) {
                contadorSumaFiltrada.classList.remove('visible');
                filteredCounterClicks = 0;
            }

            renderOrders(allLoadedPedidos, false);
            setupRealtimeListener(filters);
            if (loadAllBtn) loadAllBtn.style.display = data.hasMore ? 'block' : 'none';
        } catch (error) {
            console.error("Error al obtener pedidos:", error);
            cuerpoTablaPedidos.innerHTML = `<tr><td colspan="11" class="empty-cell" style="color: #d9534f;">Hubo un error al cargar los pedidos.</td></tr>`;
        }
    }

    async function fetchMoreOrders() {
        if (pedidosPagination.isLoadingMore || !pedidosPagination.hasMore || !pedidosPagination.lastVisibleId) return;
        pedidosPagination.isLoadingMore = true;

        try {
            const response = await fetch(buildApiUrl(pedidosPagination.currentFilters, pedidosPagination.lastVisibleId));
            const data = await response.json();

            if (!data.success) throw new Error(data.message || 'Error fetching more orders');

            allLoadedPedidos.push(...data.orders);
            pedidosPagination.lastVisibleId = data.lastVisibleId;
            pedidosPagination.hasMore = data.hasMore;

            // Update sum with loaded data (count stays exact from initial fetch)
            const sumaTotal = allLoadedPedidos.reduce((sum, o) => sum + (Number(o.precio) || 0), 0);
            contadorSumaFiltrada.textContent = formatCurrency(sumaTotal);

            renderOrders(data.orders, true);
            if (loadAllBtn && !data.hasMore) loadAllBtn.style.display = 'none';
        } catch (error) {
            console.error("Error al cargar más pedidos:", error);
        } finally {
            pedidosPagination.isLoadingMore = false;
        }
    }

    async function fetchAllRemainingOrders() {
        if (!pedidosPagination.hasMore || isFetchingAll) return;
        isFetchingAll = true;
        if (loadAllBtn) {
            loadAllBtn.disabled = true;
            loadAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando...';
        }
        try {
            while (pedidosPagination.hasMore && pedidosPagination.lastVisibleId) {
                await fetchMoreOrders();
            }
        } finally {
            isFetchingAll = false;
            if (loadAllBtn) {
                loadAllBtn.style.display = 'none';
                loadAllBtn.disabled = false;
                loadAllBtn.innerHTML = '<i class="fas fa-download"></i> Cargar todos';
            }
            // Run search once after all orders are loaded (not during each batch)
            if (document.body.classList.contains('search-active')) {
                performSearch(false);
            }
        }
    }

    // Real-time listener: observa TODOS los pedidos del rango de fecha (sin filtro de
    // estatus/producto ni limit) para detectar cualquier cambio en cualquier pedido.
    function setupRealtimeListener(filters) {
        if (unsubscribePedidos) { unsubscribePedidos(); unsubscribePedidos = null; }

        let q = query(pedidosCollectionRef);

        if (filters.dateFilter === 'personalizado' && filters.customStart && filters.customEnd) {
            q = query(q, where("createdAt", ">=", Timestamp.fromMillis(Number(filters.customStart))));
            q = query(q, where("createdAt", "<=", Timestamp.fromMillis(Number(filters.customEnd))));
        } else if (filters.dateFilter) {
            const { startDate, endDate } = getDateRange(filters.dateFilter);
            if (startDate && endDate) {
                q = query(q, where("createdAt", ">=", startDate), where("createdAt", "<", endDate));
            }
        }

        // Ignore snapshots during initial sync (cache + server reconciliation)
        const setupTime = Date.now();
        unsubscribePedidos = onSnapshot(q, { includeMetadataChanges: false }, (snapshot) => {
            if (Date.now() - setupTime < 3000) return;

            // Debounce: re-fetch the current view after a short delay
            clearTimeout(window._pedidosRealtimeTimer);
            window._pedidosRealtimeTimer = setTimeout(async () => {
                const scrollPos = tablaContainer ? tablaContainer.scrollTop : 0;
                await fetchInitialOrders(pedidosPagination.currentFilters, true);
                if (tablaContainer) tablaContainer.scrollTop = scrollPos;
            }, 1500);
        });
    }

    // Backward-compatible wrapper
    function cargarPedidos(productoFilter = '', dateFilter = '', statusFilter = '', customStartDate = null, customEndDate = null) {
        const filters = {
            producto: productoFilter,
            dateFilter: dateFilter,
            estatus: statusFilter,
            customStart: customStartDate ? customStartDate.toMillis().toString() : null,
            customEnd: customEndDate ? customEndDate.toMillis().toString() : null
        };
        fetchInitialOrders(filters);
    }

    async function borrarPedido() {
        if (!auth.currentUser || !pedidoParaBorrarId || !pedidoParaBorrarData) return;

        const pedidoRef = doc(db, "pedidos", pedidoParaBorrarId);
        const originalButtonText = btnConfirmarBorradoDefinitivo.innerHTML;
        btnConfirmarBorradoDefinitivo.disabled = true;
        btnCancelarBorrado.disabled = true;
        btnConfirmarBorradoDefinitivo.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Borrando...';
        if(mensajeErrorConfirmacion) mensajeErrorConfirmacion.textContent = '';

        try {
            const photoUrlsToDelete = [
                ...(pedidoParaBorrarData.fotoUrls || []),
                ...(pedidoParaBorrarData.fotoPromocionUrls || [])
            ];
            if (pedidoParaBorrarData.fotoUrl) photoUrlsToDelete.push(pedidoParaBorrarData.fotoUrl);
            if (pedidoParaBorrarData.fotoPromocionUrl) photoUrlsToDelete.push(pedidoParaBorrarData.fotoPromocionUrl);

            const deletePromises = photoUrlsToDelete.map(url => {
                try {
                    const storageRef = ref(storage, url);
                    return deleteObject(storageRef);
                } catch (error) {
                    console.warn("Error eliminando foto del Storage (ignorado):", error.code, error.message);
                    return Promise.resolve();
                }
            });
            await Promise.all(deletePromises);
            
            await deleteDoc(pedidoRef);
            cerrarModalConfirmarBorrado();
        } catch (error) {
            console.error("Error al borrar pedido: ", error);
            if(mensajeErrorConfirmacion) mensajeErrorConfirmacion.textContent = `Error al borrar: ${error.message}. Intenta de nuevo.`;
            btnConfirmarBorradoDefinitivo.disabled = false;
            btnCancelarBorrado.disabled = false;
            btnConfirmarBorradoDefinitivo.innerHTML = originalButtonText;
        }
    }

    function populateProductFilter() {
         if (!filtroProductoSelect || !pedidoProductoSelect) return;
         const currentValue = filtroProductoSelect.value;
         filtroProductoSelect.innerHTML = '<option value="">Todos los productos</option>';
         // Reuse product options from the order modal instead of fetching all documents
         Array.from(pedidoProductoSelect.options).forEach(opt => {
             const option = document.createElement('option');
             option.value = opt.value;
             option.textContent = opt.textContent;
             filtroProductoSelect.appendChild(option);
         });
         filtroProductoSelect.value = currentValue;
    }

    function populateStatusFilter() {
        if (!filtroEstatusSelect) return;
        filtroEstatusSelect.innerHTML = '<option value="">Todos los estatus</option>';
        statusOptions.forEach(status => {
            const option = document.createElement('option');
            option.value = status.value;
            option.textContent = status.text;
            filtroEstatusSelect.appendChild(option);
        });
    }

    function mostrarMenuEstatus(event, pedidoId, currentStatus) {
        event.stopPropagation();
        cerrarMenuEstatus();

        const clickedElement = event.target.closest('.status-display') || event.target;
        const clickedRect = clickedElement.getBoundingClientRect();

        activeCircularMenu = document.createElement('div');
        activeCircularMenu.className = 'circular-menu-container';

        const infoBar = document.createElement('div');
        infoBar.className = 'circular-menu-info-bar';
        infoBar.textContent = 'Selecciona un estado';
        activeCircularMenu.appendChild(infoBar);

        const menu = document.createElement('div');
        menu.className = 'circular-menu';
        const numItems = statusOptions.length;
        const angleStep = 360 / numItems;
        const radius = 95;

        statusOptions.forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'menu-item';
            const iconColor = option.color || 'var(--color-primary)';

            if (option.value === currentStatus) {
                item.classList.add('active-status');
                item.style.setProperty('color', iconColor);
            }

            item.innerHTML = `<i class="${option.icon}" style="color: ${iconColor};"></i><span>${option.text}</span>`;

            const itemAngle = (angleStep * index - 90) * (Math.PI / 180);
            const transformX = Math.cos(itemAngle) * radius;
            const transformY = Math.sin(itemAngle) * radius;
            item.style.transform = `translate(${transformX}px, ${transformY}px) scale(1)`;

            item.addEventListener('mouseover', () => {
                item.style.transform = `translate(${transformX}px, ${transformY}px) scale(1.15)`;
                infoBar.textContent = option.text;
                infoBar.style.backgroundColor = iconColor;
                infoBar.style.color = '#FFFFFF';
            });
            item.addEventListener('mouseout', () => {
                item.style.transform = `translate(${transformX}px, ${transformY}px) scale(1)`;
                infoBar.textContent = 'Selecciona un estado';
                infoBar.style.backgroundColor = 'var(--color-text-light)';
                infoBar.style.color = 'white';
            });
            item.addEventListener('click', (clickEvent) => {
                const menuRect = activeCircularMenu.getBoundingClientRect();
                const animX = menuRect.left + menuRect.width / 2;
                const animY = menuRect.top + menuRect.height / 2;
                actualizarEstatusPedido(pedidoId, option.value, animX, animY);
                cerrarMenuEstatus();
            });
            menu.appendChild(item);
        });

        activeCircularMenu.appendChild(menu);
        document.body.appendChild(activeCircularMenu);

        const menuWidth = activeCircularMenu.offsetWidth;
        const menuHeight = activeCircularMenu.offsetHeight;

        let targetLeft = clickedRect.left + (clickedRect.width / 2) - (menuWidth / 2);
        let targetTop = clickedRect.top + (clickedRect.height / 2) - (menuHeight / 2);

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 10;

        targetLeft = Math.max(padding, Math.min(targetLeft, viewportWidth - menuWidth - padding));
        targetTop = Math.max(padding, Math.min(targetTop, viewportHeight - menuHeight - padding));

        activeCircularMenu.style.left = `${targetLeft}px`;
        activeCircularMenu.style.top = `${targetTop}px`;

        setTimeout(() => {
            document.addEventListener('click', cerrarMenuEstatusOnClickOutside);
            document.addEventListener('keydown', cerrarMenuEstatusOnEsc);
        }, 0);
    }

    function cerrarMenuEstatus() {
        if (activeCircularMenu) activeCircularMenu.remove();
        activeCircularMenu = null;
        document.removeEventListener('click', cerrarMenuEstatusOnClickOutside);
        document.removeEventListener('keydown', cerrarMenuEstatusOnEsc);
    }
    function cerrarMenuEstatusOnClickOutside(event) {
        if (activeCircularMenu && !activeCircularMenu.contains(event.target) && !event.target.closest('.status-display')) cerrarMenuEstatus();
    }
    function cerrarMenuEstatusOnEsc(event) { if (event.key === "Escape") cerrarMenuEstatus(); }

    async function actualizarEstatusPedido(pedidoId, nuevoEstatus, animX, animY) {
        if (!auth.currentUser) return;
        // Animación inmediata al cambiar a Fabricar (antes del API call)
        if (nuevoEstatus === 'Fabricar' && animX && animY) {
            playGemPlacementAnimation(animX, animY);
        }
        // Optimistic update: actualizar DOM e in-memory antes del API call
        const row = cuerpoTablaPedidos.querySelector(`tr[data-id="${pedidoId}"]`);
        const oldStatus = row ? row.querySelector('.status-display')?.textContent : null;
        if (row) {
            const span = row.querySelector('.status-display');
            if (span) {
                span.className = `status-display status-${nuevoEstatus.toLowerCase().replace(/\s+/g, '-')}`;
                span.textContent = nuevoEstatus;
                span.dataset.status = nuevoEstatus;
            }
        }
        const data = pedidosDataMap.get(pedidoId);
        if (data) data.estatus = nuevoEstatus;
        try {
            const response = await fetch(`/api/orders/${pedidoId}/change-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newStatus: nuevoEstatus })
            });
            const result = await response.json();
            if (!response.ok) {
                console.error("Error del servidor al actualizar estatus:", result.message);
                // Revertir si falla
                if (row && oldStatus) {
                    const span = row.querySelector('.status-display');
                    if (span) {
                        span.className = `status-display status-${oldStatus.toLowerCase().replace(/\s+/g, '-')}`;
                        span.textContent = oldStatus;
                        span.dataset.status = oldStatus;
                    }
                }
                if (data && oldStatus) data.estatus = oldStatus;
            }
        } catch (error) {
            console.error("Error al actualizar estatus: ", error);
            // Revertir si falla
            if (row && oldStatus) {
                const span = row.querySelector('.status-display');
                if (span) {
                    span.className = `status-display status-${oldStatus.toLowerCase().replace(/\s+/g, '-')}`;
                    span.textContent = oldStatus;
                    span.dataset.status = oldStatus;
                }
            }
            if (data && oldStatus) data.estatus = oldStatus;
        }
    }

    /** Animación: gema zafiro cae y se coloca con destellos */
    function playGemPlacementAnimation(x, y) {
        const container = document.createElement('div');
        container.className = 'gem-anim-container';
        container.style.left = x + 'px';
        container.style.top = y + 'px';

        // Gema principal
        const gem = document.createElement('div');
        gem.className = 'gem-anim-gem';
        gem.innerHTML = '<i class="fas fa-gem"></i>';
        container.appendChild(gem);

        // Anillo de resplandor
        const glow = document.createElement('div');
        glow.className = 'gem-anim-glow';
        container.appendChild(glow);

        // Destellos / sparkles
        const sparkles = document.createElement('div');
        sparkles.className = 'gem-anim-sparkles';
        for (let i = 0; i < 8; i++) {
            const s = document.createElement('span');
            const angle = (360 / 8) * i;
            const dist = 30 + Math.random() * 25;
            s.style.setProperty('--sx', Math.cos(angle * Math.PI / 180) * dist + 'px');
            s.style.setProperty('--sy', Math.sin(angle * Math.PI / 180) * dist + 'px');
            s.style.animationDelay = (0.55 + Math.random() * 0.2) + 's';
            sparkles.appendChild(s);
        }
        container.appendChild(sparkles);

        document.body.appendChild(container);
        setTimeout(() => container.remove(), 2200);
    }
    
    async function actualizarVerificacionTelefono(pedidoId, isChecked) {
        if (!auth.currentUser) return;
        const pedidoRef = doc(db, "pedidos", pedidoId);
        try {
            await updateDoc(pedidoRef, { telefonoVerificado: isChecked });
        } catch (error) {
            console.error("Error al actualizar la verificación del teléfono: ", error);
            const checkboxInTable = cuerpoTablaPedidos.querySelector(`tr[data-id="${pedidoId}"] input[type="checkbox"]`);
            if (checkboxInTable) {
                checkboxInTable.checked = !isChecked;
            }
            showCopyToast("Error al guardar el cambio", "error");
        }
    }

    async function actualizarVerificacionEstatus(pedidoId, isChecked) {
        if (!auth.currentUser) return;
        const pedidoRef = doc(db, "pedidos", pedidoId);
        try {
            await updateDoc(pedidoRef, { estatusVerificado: isChecked });
        } catch (error) {
            console.error("Error al actualizar la verificación del estatus: ", error);
            const checkboxInTable = cuerpoTablaPedidos.querySelector(`tr[data-id="${pedidoId}"] .status-checkbox-container input[type="checkbox"]`);
            if (checkboxInTable) {
                checkboxInTable.checked = !isChecked;
            }
            showCopyToast("Error al guardar el cambio", "error");
        }
    }

    async function handleFormSubmit(e) {
        e.preventDefault();
        if(mensajeErrorPedido) mensajeErrorPedido.textContent = '';

        let productoFinal = pedidoProductoSelect.value;
        if (!productoFinal) {
                if(mensajeErrorPedido) mensajeErrorPedido.textContent = '¡Debes seleccionar un producto!';
                pedidoProductoSelect.focus(); return;
        }

        const telefono = pedidoTelefonoInput.value.trim();
        if (!telefono) {
            if(mensajeErrorPedido) mensajeErrorPedido.textContent = '¡El número de teléfono es obligatorio!';
            pedidoTelefonoInput.focus(); return;
        }

        if (!auth.currentUser) {
            if(mensajeErrorPedido) mensajeErrorPedido.textContent = 'Necesitas iniciar sesión para guardar pedidos.'; return;
        }

        const originalGuardarText = btnGuardarPedido.innerHTML;
        btnGuardarPedido.disabled = true;
        if(btnCancelarPedido) btnCancelarPedido.disabled = true;
        btnGuardarPedido.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        
        try {
            async function processPhotos(manager, initialUrls, storagePath) {
                btnGuardarPedido.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Subiendo fotos...`;
                const uploadPromises = manager.map(photo => {
                    if (photo.isNew) {
                        const filePath = `${storagePath}/${Date.now()}_${photo.file.name}`;
                        const storageRefFs = ref(storage, filePath);
                        return uploadBytesResumable(storageRefFs, photo.file).then(snapshot => getDownloadURL(snapshot.ref));
                    }
                    return Promise.resolve(photo.url);
                });

                const finalUrls = await Promise.all(uploadPromises);
                const finalUrlSet = new Set(finalUrls);
                const urlsToDelete = initialUrls.filter(url => !finalUrlSet.has(url));
                
                const deletePromises = urlsToDelete.map(url => {
                    const oldRef = ref(storage, url);
                    return deleteObject(oldRef).catch(err => console.warn(`Failed to delete old photo:`, err))
                });
                await Promise.all(deletePromises);

                return finalUrls;
            }

            const finalOrderPhotoUrls = await processPhotos(orderPhotosManager, initialOrderPhotoUrls, 'pedidos');
            const finalPromoPhotoUrls = await processPhotos(promoPhotosManager, initialPromoPhotoUrls, 'promociones');
            
            const cantidad = Math.max(1, parseInt(pedidoCantidadInput?.value, 10) || 1);
            const pedidoData = {
                producto: productoFinal,
                telefono: telefono,
                fotoUrls: finalOrderPhotoUrls,
                fotoPromocionUrls: finalPromoPhotoUrls,
                comentarios: pedidoComentariosInput.value.trim(),
                datosProducto: pedidoDatosProductoInput.value.trim(),
                datosPromocion: pedidoDatosPromocionInput.value.trim(),
                cantidad: cantidad,
                precio: Number(pedidoPrecioInput.value) || 0,
                userEmail: auth.currentUser.email
            };

            if (editingPedidoId) {
                btnGuardarPedido.innerHTML = '<i class="fas fa-database"></i> Actualizando...';
                const docRef = doc(db, "pedidos", editingPedidoId);
                Object.keys(pedidoData).forEach(key => pedidoData[key] === undefined && delete pedidoData[key]);
                // Optimistic update: cerrar modal y actualizar fila antes del await
                const editedId = editingPedidoId;
                cerrarModalPedido();
                const existingData = pedidosDataMap.get(editedId);
                if (existingData) {
                    Object.assign(existingData, pedidoData);
                    const oldRow = cuerpoTablaPedidos.querySelector(`tr[data-id="${editedId}"]`);
                    if (oldRow) {
                        const newRow = createPedidoRow(existingData, new Set());
                        oldRow.replaceWith(newRow);
                    }
                }
                await updateDoc(docRef, pedidoData);
            } else {
                btnGuardarPedido.innerHTML = '<i class="fas fa-database"></i> Guardando...';
                const newOrderNumber = await runTransaction(db, async (transaction) => {
                    const counterDoc = await transaction.get(orderCounterRef);
                    let currentCounter = counterDoc.exists() ? counterDoc.data().lastOrderNumber || 0 : 0;
                    const nextOrderNumber = (currentCounter < 1000) ? 1001 : currentCounter + 1;
                    transaction.set(orderCounterRef, { lastOrderNumber: nextOrderNumber }, { merge: true });
                    return nextOrderNumber;
                });
                const nuevoPedido = { 
                    ...pedidoData, 
                    vendedor: loggedInUserName,
                    consecutiveOrderNumber: newOrderNumber, 
                    createdAt: serverTimestamp(), 
                    createdBy: auth.currentUser.uid, 
                    estatus: "Sin estatus",
                    telefonoVerificado: false, 
                    estatusVerificado: false
                };
                await addDoc(pedidosCollectionRef, nuevoPedido);
                cerrarModalPedido();
                mostrarModalConfirmacionRegistro(newOrderNumber);
                const scrollPos = tablaContainer ? tablaContainer.scrollTop : 0;
                await fetchInitialOrders(pedidosPagination.currentFilters, true);
                if (tablaContainer) tablaContainer.scrollTop = scrollPos;
                actualizarContadorHoy();
            }
            populateProductFilter();
        } catch (error) {
            if(mensajeErrorPedido) mensajeErrorPedido.textContent = `Error: ${error.message}. Intenta de nuevo.`;
            console.error("Error guardando pedido:", error);
        } finally {
            btnGuardarPedido.disabled = false;
            if(btnCancelarPedido) btnCancelarPedido.disabled = false;
            btnGuardarPedido.innerHTML = originalGuardarText;
        }
    }
    
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function clearSearchHighlight() {
        document.querySelectorAll('mark.search-highlight-text').forEach(markNode => {
            const parent = markNode.parentNode;
            if (parent) {
                while (markNode.firstChild) {
                    parent.insertBefore(markNode.firstChild, markNode);
                }
                parent.removeChild(markNode);
                parent.normalize();
            }
        });
    }
    
    function highlightTextInNode(node, regex, matches, cell) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.nodeValue;
            if (regex.test(text)) {
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                text.replace(regex, (match, offset) => {
                    if (offset > lastIndex) fragment.appendChild(document.createTextNode(text.substring(lastIndex, offset)));
                    const mark = document.createElement('mark');
                    mark.className = 'search-highlight-text';
                    mark.textContent = match;
                    fragment.appendChild(mark);
                    matches.push({ element: mark, cell: cell });
                    lastIndex = offset + match.length;
                });
                if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
                if(node.parentNode) node.parentNode.replaceChild(fragment, node);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE && !/^(script|style|mark)$/i.test(node.tagName)) {
            Array.from(node.childNodes).forEach(child => highlightTextInNode(child, regex, matches, cell));
        }
    }

    function openSearch() {
        if (searchBarContainer.style.display === 'flex') {
            searchInput.select();
            return;
        }
        if (currentlySelectedRow) {
            currentlySelectedRow.classList.remove('selected-row');
            currentlySelectedRow = null;
            selectedRowId = null;
        }
        searchBarContainer.style.display = 'flex';
        document.body.classList.add('search-active');
        searchInput.focus();
        performSearch(true);
    }

    function closeSearch() {
        document.body.classList.remove('search-active');
        searchBarContainer.style.display = 'none';
        searchInput.value = '';
        clearSearchHighlight();
        searchMatches = [];
        currentSearchIndex = -1;
        document.querySelectorAll('#cuerpoTablaPedidos tr').forEach(row => {
            row.classList.remove('search-match', 'current-search-highlight');
        });
        searchMatchIcon.style.display = 'none';
        updateSearchUI();
    }

    function updateSearchUI() {
        if(searchMatchIcon) searchMatchIcon.style.display = 'none';

        if (searchMatches.length > 0) {
            searchCounter.textContent = `${currentSearchIndex + 1}/${searchMatches.length}`;
            prevMatchBtn.disabled = false;
            nextMatchBtn.disabled = false;
            
            const currentMatch = searchMatches[currentSearchIndex];
            if (currentMatch && currentMatch.cell) {
                const cellIndex = Array.from(currentMatch.cell.parentNode.children).indexOf(currentMatch.cell);
                if (cellIndex === 0) { // # Pedido
                    searchMatchIcon.innerHTML = '<i class="fas fa-hashtag"></i>';
                    searchMatchIcon.style.color = '#3498db';
                    searchMatchIcon.style.display = 'inline-block';
                } else if (cellIndex === 3) { // Teléfono
                    searchMatchIcon.innerHTML = '<i class="fas fa-phone-alt"></i>';
                    searchMatchIcon.style.color = '#96ceb4';
                    searchMatchIcon.style.display = 'inline-block';
                }
            }

        } else {
            searchCounter.textContent = searchInput.value ? '0/0' : '';
            prevMatchBtn.disabled = true;
            nextMatchBtn.disabled = true;
        }
    }

    function navigateToCurrentMatch() {
        document.querySelectorAll('tr.current-search-highlight').forEach(row => row.classList.remove('current-search-highlight'));
        
        if (currentSearchIndex !== -1 && searchMatches.length > 0) {
            const currentMatchElement = searchMatches[currentSearchIndex].element;
            const currentRow = currentMatchElement.closest('tr');
            
            if (currentRow) {
                currentRow.classList.add('current-search-highlight');
                currentMatchElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        }
        updateSearchUI();
    }
    
    async function performSearch(isNewSearch = true, focusedPedidoId = null) {
        clearSearchHighlight();
        const searchTerm = searchInput.value.trim();
        let allRows = document.querySelectorAll('#cuerpoTablaPedidos tr');

        searchMatches = [];
        allRows.forEach(row => row.classList.remove('search-match', 'current-search-highlight'));

        if (!searchTerm) {
            document.body.classList.remove('search-active');
            currentSearchIndex = -1;
            updateSearchUI();
            return;
        }

        document.body.classList.add('search-active');
        const regex = new RegExp(escapeRegExp(searchTerm), 'gi');
        const matchedRows = new Set();

        allRows.forEach(row => {
            row.querySelectorAll('td').forEach(cell => {
                highlightTextInNode(cell, regex, searchMatches, cell);
            });
            if (row.querySelector('mark.search-highlight-text')) {
                matchedRows.add(row);
            }
        });

        // Si no hay resultados locales pero hay más pedidos por cargar, cargar todos y re-buscar
        if (searchMatches.length === 0 && pedidosPagination.hasMore) {
            await fetchAllRemainingOrders();
            // Re-buscar en todas las filas ahora cargadas
            allRows = document.querySelectorAll('#cuerpoTablaPedidos tr');
            searchMatches = [];
            matchedRows.clear();
            allRows.forEach(row => {
                row.querySelectorAll('td').forEach(cell => {
                    highlightTextInNode(cell, regex, searchMatches, cell);
                });
                if (row.querySelector('mark.search-highlight-text')) {
                    matchedRows.add(row);
                }
            });
        }

        allRows.forEach(row => {
            if (matchedRows.has(row)) {
                row.classList.add('search-match');
            }
        });

        if (searchMatches.length > 0) {
            let newIndex = -1;
            if (!isNewSearch && focusedPedidoId) {
                newIndex = searchMatches.findIndex(match => match.element.closest('tr')?.dataset.id === focusedPedidoId);
            }
            currentSearchIndex = (newIndex !== -1) ? newIndex : 0;
            navigateToCurrentMatch();
        } else {
            currentSearchIndex = -1;
        }
        updateSearchUI();
    }

    function navigateMatches(direction) {
        if (searchMatches.length === 0) return;
        currentSearchIndex = (direction === 'next') 
            ? (currentSearchIndex + 1) % searchMatches.length
            : (currentSearchIndex - 1 + searchMatches.length) % searchMatches.length;
        navigateToCurrentMatch();
    }
    
    function showCopyToast(message, type = 'success') {
        if(!copyToast) return;
        copyToast.textContent = message;
        
        copyToast.className = 'copy-toast show'; 
        if (type === 'success') {
            copyToast.classList.add('success');
        } else if (type === 'error') {
            copyToast.classList.add('error');
        }

        setTimeout(() => {
            copyToast.classList.remove('show');
        }, 2000);
    }
    
    function showPhotoCopyToast() {
        if (!photoCopyToast) return;
        photoCopyToast.classList.add('show');
        setTimeout(() => {
            photoCopyToast.classList.remove('show');
        }, 2200);
    }
    
    function inicializarDatePicker() {
        datePickerInstance = flatpickr("#filtroFechaPersonalizada", {
            mode: "range",
            dateFormat: "Y-m-d",
            locale: "es",
            altInput: true,
            altFormat: "j F, Y",
            allowInput: true,
            onClose: function(selectedDates, dateStr, instance) {
                if (selectedDates.length === 1) {
                    instance.setDate([selectedDates[0], selectedDates[0]], true);
                }
            }
        });
    }

    async function actualizarContadorHoy() {
        const { startDate, endDate } = getDateRange('hoy');
        if (!startDate || !endDate) return;

        try {
            const q = query(pedidosCollectionRef, where("createdAt", ">=", startDate), where("createdAt", "<", endDate));
            const snapshot = await getCountFromServer(q);
            contadorPedidosHoy.textContent = snapshot.data().count;
        } catch (error) {
            console.error("Error getting today's orders count:", error);
            contadorPedidosHoy.textContent = 'X';
        }

        // Lightweight listener to detect new orders today and re-count
        if (unsubscribeHoy) unsubscribeHoy();
        const listenerQuery = query(pedidosCollectionRef, where("createdAt", ">=", startDate), where("createdAt", "<", endDate), orderBy("createdAt", "desc"), firestoreLimit(1));
        let isFirst = true;
        unsubscribeHoy = onSnapshot(listenerQuery, () => {
            if (isFirst) { isFirst = false; return; }
            // Re-count server-side when changes detected
            const q = query(pedidosCollectionRef, where("createdAt", ">=", startDate), where("createdAt", "<", endDate));
            getCountFromServer(q).then(snap => {
                contadorPedidosHoy.textContent = snap.data().count;
            }).catch(() => {});
        });
    }


    // --- Event Listeners & Initial Calls ---
    
    applySavedTheme();

    setupDragAndDrop(fileInputContainerProducto, pedidoFotoFileInput, orderPhotosManager, renderOrderPhotoPreviews);
    setupDragAndDrop(fileInputContainerPromocion, pedidoFotoPromocionFileInput, promoPhotosManager, renderPromoPhotoPreviews);
    setupPasteListener(fileInputContainerProducto, orderPhotosManager, renderOrderPhotoPreviews);
    setupPasteListener(fileInputContainerPromocion, promoPhotosManager, renderPromoPhotoPreviews);

    if (mismaFotoCheckbox) {
        mismaFotoCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                promoPhotosManager.length = 0; 
                const newPromoPhotos = orderPhotosManager.map(p => ({ ...p, isNew: true, file: p.file }));
                promoPhotosManager.push(...newPromoPhotos);
                renderPromoPhotoPreviews();
            } 
        });
    }

    onAuthStateChanged(auth, (user) => {
        const handleAuth = () => {
            if (user) {
                if (user.email) {
                    const emailParts = user.email.split('@');
                    const name = emailParts[0];
                    loggedInUserName = name.charAt(0).toUpperCase() + name.slice(1);
                    usuarioLogueado.textContent = `¡Hola de nuevo, ${loggedInUserName}! 👋`;
                } else {
                    loggedInUserName = 'Usuario';
                    usuarioLogueado.textContent = `¡Bienvenido, ${loggedInUserName}! 👋`;
                }

                seccionPedidos.classList.add('visible');
                seccionLogin.classList.remove('visible');

                populateStatusFilter();
                inicializarDatePicker();
                actualizarContadorHoy();

                let fechaPorDefecto = 'ultimos-10-dias';
                if (user.email === 'alex@dekoor.com') {
                    fechaPorDefecto = 'hoy';
                }
                filtroFechaSelect.value = fechaPorDefecto;
                
                cargarPedidos(filtroProductoSelect.value, filtroFechaSelect.value, filtroEstatusSelect.value);
                populateProductFilter();
            } else {
                loggedInUserName = '';
                usuarioLogueado.textContent = '';
                seccionLogin.classList.add('visible');
                seccionPedidos.classList.remove('visible');
                
                if (unsubscribePedidos) unsubscribePedidos();
                if (unsubscribeHoy) unsubscribeHoy();
                if (cuerpoTablaPedidos) cuerpoTablaPedidos.innerHTML = '';
                if (contadorPedidosHoy) contadorPedidosHoy.textContent = '0';
                if (contadorPedidosFiltrados) contadorPedidosFiltrados.classList.remove('visible');
                cerrarMenuEstatus();
            }

            loadingOverlay.style.opacity = '0';
            setTimeout(() => {
                loadingOverlay.style.display = 'none';
            }, 500);
        };
        
        const elapsedTime = Date.now() - startTime;
        const minLoadingTime = 1500;
        const remainingTime = Math.max(0, minLoadingTime - elapsedTime);

        setTimeout(handleAuth, remainingTime);
    });

    if (formularioLogin) {
         formularioLogin.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = inputEmail.value;
            const password = inputPassword.value;
            mensajeErrorLogin.textContent = '';
            const loginButton = formularioLogin.querySelector('button[type="submit"]');
            const originalButtonText = loginButton.innerHTML;
            loginButton.disabled = true;
            loginButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ingresando...';
            signInWithEmailAndPassword(auth, email, password)
              .catch((error) => {
                let errorAmigable = 'Ups! Algo salió mal.';
                if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
                    errorAmigable = 'El correo o la contraseña no coinciden.';
                } else if (error.code === 'auth/invalid-email') {
                     errorAmigable = 'El formato del correo es incorrecto.';
                }
                mensajeErrorLogin.textContent = errorAmigable;
              })
              .finally(() => {
                 loginButton.disabled = false; loginButton.innerHTML = originalButtonText;
              });
        });
    }
    
    if (formularioNuevoPedido) formularioNuevoPedido.addEventListener('submit', handleFormSubmit);

    if (btnCerrarSesion) btnCerrarSesion.addEventListener('click', () => signOut(auth).catch(e => console.error("Error al cerrar sesión.",e)));

    if (btnAplicarFiltros) {
        btnAplicarFiltros.addEventListener('click', () => {
            const producto = filtroProductoSelect.value;
            const fecha = filtroFechaSelect.value;
            const estatus = filtroEstatusSelect.value;
            let fechaInicio = null;
            let fechaFin = null;

            if (fecha === 'personalizado') {
                const selectedDates = datePickerInstance.selectedDates;
                if (selectedDates.length > 0) {
                    const start = selectedDates[0];
                    start.setHours(0, 0, 0, 0);
                    fechaInicio = Timestamp.fromDate(start);

                    const end = selectedDates.length > 1 ? selectedDates[1] : selectedDates[0];
                    end.setHours(23, 59, 59, 999);
                    fechaFin = Timestamp.fromDate(end);
                } else {
                    showCopyToast("Por favor, selecciona una fecha o un rango.", "error");
                    return;
                }
            }
            
            contadorSumaFiltrada.classList.remove('visible');
            filteredCounterClicks = 0;
            cargarPedidos(producto, fecha, estatus, fechaInicio, fechaFin);
        });
    }

    if (btnBorrarFiltros) {
        btnBorrarFiltros.addEventListener('click', () => {
            filtroProductoSelect.value = '';
            let fechaPorDefecto = 'ultimos-10-dias';
            if (auth.currentUser && auth.currentUser.email === 'alex@dekoor.com') {
                fechaPorDefecto = 'hoy';
            }
            filtroFechaSelect.value = fechaPorDefecto;
            filtroEstatusSelect.value = '';

            if(datePickerInstance) {
                datePickerInstance.clear();
            }
            rangoFechaPersonalizadoContainer.style.display = 'none';
            contadorPedidosFiltrados.classList.remove('visible');
            contadorSumaFiltrada.classList.remove('visible');
            filteredCounterClicks = 0;

            cargarPedidos('', fechaPorDefecto, '');
        });
    }

    if (filtroFechaSelect) {
        filtroFechaSelect.addEventListener('change', (e) => {
            if (e.target.value === 'personalizado') {
                rangoFechaPersonalizadoContainer.style.display = 'block';
            } else {
                rangoFechaPersonalizadoContainer.style.display = 'none';
            }
        });
    }

    if (contadorPedidosFiltrados) {
        contadorPedidosFiltrados.addEventListener('click', () => {
            const now = Date.now();
            if (now - lastFilteredCounterClickTime > 1500) { // Reset after 1.5 seconds
                filteredCounterClicks = 1;
            } else {
                filteredCounterClicks++;
            }
            lastFilteredCounterClickTime = now;

            if (filteredCounterClicks >= 5) {
                contadorSumaFiltrada.classList.toggle('visible');
            }
        });
    }


    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            darkModeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i> Modo Claro' : '<i class="fas fa-moon"></i> Modo Oscuro';
        });
    }

    if (tablaContainer && scrollToTopBtn) {
        tablaContainer.addEventListener('scroll', () => {
            scrollToTopBtn.style.display = (tablaContainer.scrollTop > 100) ? 'block' : 'none';

            // Infinite scroll: load more when near bottom
            if (tablaContainer.scrollHeight - tablaContainer.scrollTop - tablaContainer.clientHeight < 300) {
                fetchMoreOrders();
            }
        });
        scrollToTopBtn.addEventListener('click', () => {
            tablaContainer.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    if (loadAllBtn) {
        loadAllBtn.addEventListener('click', fetchAllRemainingOrders);
    }
    
    // Modal Event Listeners
    if (btnMostrarFormularioPedido) btnMostrarFormularioPedido.addEventListener('click', () => abrirModalPedido());
    if (btnCerrarModal) btnCerrarModal.addEventListener('click', cerrarModalPedido);
    if (btnCancelarPedido) btnCancelarPedido.addEventListener('click', cerrarModalPedido);

    if (modalImagenPedido) modalImagenPedido.addEventListener('click', (e) => { if (e.target === modalImagenPedido) cerrarModalImagen(); });
    if (modalConfirmarBorrado) modalConfirmarBorrado.addEventListener('click', (e) => { if (e.target === modalConfirmarBorrado) cerrarModalConfirmarBorrado(); });
    if (modalConfirmacionRegistro) modalConfirmacionRegistro.addEventListener('click', (e) => { if (e.target === modalConfirmacionRegistro) cerrarModalConfirmacionRegistro(); });
    if (modalComentario) modalComentario.addEventListener('click', (e) => { if (e.target === modalComentario) cerrarModalComentario(); });

    // Modal OXXO listeners
    const modalOxxo = document.getElementById('modalOxxo');
    const btnCerrarModalOxxo = document.getElementById('btnCerrarModalOxxo');
    const btnCancelarOxxo = document.getElementById('btnCancelarOxxo');
    const btnGenerarOxxo = document.getElementById('btnGenerarOxxo');
    const btnCerrarOxxoFinal = document.getElementById('btnCerrarOxxoFinal');
    if (modalOxxo) modalOxxo.addEventListener('click', (e) => { if (e.target === modalOxxo) cerrarModalOxxo(); });
    if (btnCerrarModalOxxo) btnCerrarModalOxxo.addEventListener('click', cerrarModalOxxo);
    if (btnCancelarOxxo) btnCancelarOxxo.addEventListener('click', cerrarModalOxxo);
    if (btnCerrarOxxoFinal) btnCerrarOxxoFinal.addEventListener('click', cerrarModalOxxo);
    if (btnGenerarOxxo) btnGenerarOxxo.addEventListener('click', generarReferenciaOxxo);
    
    if (btnCerrarModalImagen) btnCerrarModalImagen.addEventListener('click', cerrarModalImagen);
    if (btnCerrarModalConfirmarBorrado) btnCerrarModalConfirmarBorrado.addEventListener('click', cerrarModalConfirmarBorrado);
    if (btnCancelarBorrado) btnCancelarBorrado.addEventListener('click', cerrarModalConfirmarBorrado);
    if (btnConfirmarBorradoDefinitivo) btnConfirmarBorradoDefinitivo.addEventListener('click', borrarPedido);
    if (btnCerrarModalComentarioTop) btnCerrarModalComentarioTop.addEventListener('click', cerrarModalComentario);
    if (btnCerrarModalComentarioBottom) btnCerrarModalComentarioBottom.addEventListener('click', cerrarModalComentario);
    if (btnCerrarModalConfirmacionRegistro) btnCerrarModalConfirmacionRegistro.addEventListener('click', cerrarModalConfirmacionRegistro);

    if (btnCopiarNumeroPedidoConfirmacion) {
        btnCopiarNumeroPedidoConfirmacion.addEventListener('click', () => {
            navigator.clipboard.writeText(numeroPedidoConfirmacionSpan.textContent).then(() => {
                btnCopiarNumeroPedidoConfirmacion.classList.add('copied');
                btnCopiarNumeroPedidoConfirmacion.innerHTML = '<i class="fas fa-check"></i>';
                showCopyToast(`¡Copiado: ${numeroPedidoConfirmacionSpan.textContent}!`, 'success');
                setTimeout(() => {
                    btnCopiarNumeroPedidoConfirmacion.classList.remove('copied');
                    btnCopiarNumeroPedidoConfirmacion.innerHTML = '<i class="fas fa-copy"></i>';
                }, 1500);
            });
        });
    }
    // --- Delegated Event Handlers for Orders Table ---
    if (cuerpoTablaPedidos) {
        cuerpoTablaPedidos.addEventListener('dblclick', e => {
            if (e.target && e.target.classList.contains('comment-cell')) {
                abrirModalComentario(e.target.dataset.fullText);
            }
        });

        cuerpoTablaPedidos.addEventListener('click', (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                const action = actionEl.dataset.action;
                const orderId = actionEl.dataset.orderId || actionEl.closest('tr')?.dataset.id;

                if (action === 'view-photo') {
                    e.stopPropagation();
                    const photoUrls = JSON.parse(actionEl.dataset.photoUrls);
                    abrirModalImagen(photoUrls, 0, `DH${actionEl.dataset.orderNumber}`);
                } else if (action === 'copy-phone') {
                    e.stopPropagation();
                    const phone = actionEl.dataset.phone;
                    navigator.clipboard.writeText(phone).then(() => {
                        actionEl.classList.add('copied');
                        actionEl.innerHTML = '<i class="fas fa-check"></i>';
                        showCopyToast("¡Teléfono copiado!", "success");
                        setTimeout(() => {
                            actionEl.classList.remove('copied');
                            actionEl.innerHTML = '<i class="fas fa-copy"></i>';
                        }, 1500);
                    }).catch(err => console.error('Error al copiar el teléfono: ', err));
                } else if (action === 'change-status') {
                    e.stopPropagation();
                    mostrarMenuEstatus(e, orderId, actionEl.dataset.status);
                } else if (action === 'edit') {
                    e.stopPropagation();
                    const pedido = pedidosDataMap.get(orderId);
                    if (pedido) abrirModalPedido(pedido);
                } else if (action === 'delete') {
                    e.stopPropagation();
                    const pedido = pedidosDataMap.get(orderId);
                    if (pedido) abrirModalConfirmarBorrado(orderId, pedido);
                } else if (action === 'oxxo') {
                    e.stopPropagation();
                    const pedido = pedidosDataMap.get(orderId);
                    if (pedido) abrirModalOxxo(orderId, pedido);
                }
                return;
            }

            // Row selection (no action element clicked)
            const tr = e.target.closest('tr');
            if (!tr || e.target.closest('button, a, .status-display, input, select, textarea, img')) return;
            if (document.body.classList.contains('search-active')) return;

            const isCurrentlySelected = tr.classList.contains('selected-row');
            if (currentlySelectedRow) currentlySelectedRow.classList.remove('selected-row');
            if (!isCurrentlySelected) {
                tr.classList.add('selected-row');
                currentlySelectedRow = tr;
                selectedRowId = tr.dataset.id;
            } else {
                currentlySelectedRow = null;
                selectedRowId = null;
            }
        });

        cuerpoTablaPedidos.addEventListener('change', (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;
            const action = actionEl.dataset.action;
            const orderId = actionEl.dataset.orderId;

            if (action === 'toggle-phone-verified') {
                e.stopPropagation();
                actualizarVerificacionTelefono(orderId, e.target.checked);
            } else if (action === 'toggle-status-verified') {
                e.stopPropagation();
                actualizarVerificacionEstatus(orderId, e.target.checked);
            }
        });
    }
    
    // --- Centralized Keydown Handler ---
    document.addEventListener('keydown', async (e) => {
        if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
            if (modalNuevoPedido.style.display === 'flex' && selectedThumbnail.element) {
                e.preventDefault(); 

                const imgToCopy = selectedThumbnail.element.querySelector('img');
                if (!imgToCopy) return;

                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d'); // BUG-FIX: Changed 'd' to '2d'
                    
                    const image = new Image();
                    image.crossOrigin = "Anonymous";
                    image.onload = () => {
                        canvas.width = image.naturalWidth;
                        canvas.height = image.naturalHeight;
                        ctx.drawImage(image, 0, 0);

                        canvas.toBlob(async (blob) => {
                            if (blob) {
                                try {
                                    await navigator.clipboard.write([
                                        new ClipboardItem({ 'image/png': blob })
                                    ]);
                                    showPhotoCopyToast();
                                } catch (writeErr) {
                                    console.error('Error al escribir en el portapapeles: ', writeErr);
                                    showCopyToast("Error al copiar imagen", "error");
                                }
                            }
                        }, 'image/png');
                    };
                    image.onerror = () => {
                         console.error("No se pudo cargar la imagen para copiarla.");
                         showCopyToast("Error al cargar la imagen", "error");
                    };
                    image.src = imgToCopy.src;

                } catch (err) {
                    console.error('Error al procesar la imagen para copiar: ', err);
                    showCopyToast("Error al procesar la imagen", "error");
                }
            }
        }

        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            openSearch();
        }
        
        if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
            if (document.body.classList.contains('search-active') && currentSearchIndex > -1 && searchMatches.length > 0) {
                e.preventDefault(); 

                const currentMatch = searchMatches[currentSearchIndex];
                if (currentMatch && currentMatch.element) {
                    const currentRow = currentMatch.element.closest('tr');
                    if (currentRow && currentRow.cells[0]) {
                        const pedidoId = currentRow.dataset.id;
                        const orderNumberText = currentRow.cells[0].textContent;

                        if (pedidoId) {
                            const nuevoEstatus = "Foto enviada";
                            
                            await actualizarEstatusPedido(pedidoId, nuevoEstatus);
                            
                            const statusDisplay = currentRow.querySelector('.status-display');
                            if (statusDisplay) {
                                statusDisplay.textContent = nuevoEstatus;
                                statusDisplay.className = 'status-display';
                                statusDisplay.classList.add(`status-${nuevoEstatus.toLowerCase().replace(/\s+/g, '-')}`);
                            }

                            showCopyToast(`Pedido ${orderNumberText} actualizado a "${nuevoEstatus}"`, 'success');
                        }
                    }
                }
            }
        }

        if (e.key === 'Escape') {
            if (document.body.classList.contains('search-active')) closeSearch();
            else if (activeCircularMenu) cerrarMenuEstatus();
            else if (modalComentario && modalComentario.style.display === 'flex') cerrarModalComentario();
            else if (modalImagenPedido && modalImagenPedido.style.display === 'flex') cerrarModalImagen();
            else if (modalNuevoPedido && modalNuevoPedido.style.display === 'flex') cerrarModalPedido();
        }

        if (document.body.classList.contains('search-active') && searchInput === document.activeElement && e.key === 'Enter') {
            e.preventDefault();
            navigateMatches(e.shiftKey ? 'prev' : 'next');
        }
    });

    document.addEventListener('click', (e) => {
        if (selectedThumbnail.element && !e.target.closest('.previews-container')) {
            selectedThumbnail.element.classList.remove('selected');
            selectedThumbnail = { element: null, manager: null, index: -1 };
        }
    });

    let searchDebounceTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => performSearch(true), 200);
    });
    closeSearchBtn.addEventListener('click', closeSearch);
    prevMatchBtn.addEventListener('click', () => navigateMatches('prev'));
    nextMatchBtn.addEventListener('click', () => navigateMatches('next'));

    modalImagenNextBtn.addEventListener('click', () => {
        if (modalImageViewer.currentIndex < modalImageViewer.urls.length - 1) {
            modalImageViewer.currentIndex++;
            updateModalImageView();
        }
    });

    modalImagenPrevBtn.addEventListener('click', () => {
        if (modalImageViewer.currentIndex > 0) {
            modalImageViewer.currentIndex--;
            updateModalImageView();
        }
    });
});
