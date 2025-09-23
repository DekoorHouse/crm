import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, onSnapshot, serverTimestamp, orderBy, doc, updateDoc, where, getDocs, runTransaction, getDoc, deleteDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
    const copyToast = document.getElementById('copy-toast');
    const photoCopyToast = document.getElementById('photo-copy-toast');


    // Form inputs for pedido
    const pedidoProductoSelect = document.getElementById('pedidoProductoSelect');
    const pedidoProductoOtroInput = document.getElementById('pedidoProductoOtro');
    const pedidoTelefonoInput = document.getElementById('pedidoTelefono');
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
    
    function formatFirebaseTimestamp(timestamp) {
         if (!timestamp || typeof timestamp.toDate !== 'function') return 'Fecha inválida';
         try {
             return timestamp.toDate().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
         } catch (e) { return 'Fecha inválida'; }
    }
    function formatCurrency(value) {
        const number = Number(value);
        if (isNaN(number)) return '-';
        return number.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
    }

    function preloadImage(src) {
        const img = new Image();
        img.src = src;
    }

    function preloadAllImagesInBackground(pedidos) {
        let imagesToPreloadCount = 0;
        pedidos.forEach(pedido => {
            if (pedido.fotoUrls && pedido.fotoUrls.length > 1) {
                for (let i = 1; i < pedido.fotoUrls.length; i++) {
                    preloadImage(pedido.fotoUrls[i]);
                    imagesToPreloadCount++;
                }
            }
            if (pedido.fotoPromocionUrls && pedido.fotoPromocionUrls.length > 1) {
                for (let i = 1; i < pedido.fotoPromocionUrls.length; i++) {
                    preloadImage(pedido.fotoPromocionUrls[i]);
                    imagesToPreloadCount++;
                }
            }
        });
        if (imagesToPreloadCount > 0) {
            console.log(`Pre-cargando ${imagesToPreloadCount} imágenes adicionales en segundo plano...`);
        }
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
        
        pedidoProductoOtroInput.style.display = 'none';
        pedidoProductoOtroInput.required = false;

        if (pedidoData) { // EDIT MODE
            modalTitle.innerHTML = '<i class="fas fa-edit"></i> Editar Pedido';
            btnGuardarPedido.innerHTML = '<i class="fas fa-save"></i> Guardar Cambios';
            editingPedidoId = pedidoData.id;

            const producto = pedidoData.producto || '';
            const esOpcionPredeterminada = Array.from(pedidoProductoSelect.options).some(opt => opt.value === producto);
            if (esOpcionPredeterminada) {
                pedidoProductoSelect.value = producto;
            } else {
                pedidoProductoSelect.value = 'Otro';
                pedidoProductoOtroInput.value = producto;
                pedidoProductoOtroInput.style.display = 'block';
                pedidoProductoOtroInput.required = true;
            }

            pedidoTelefonoInput.value = pedidoData.telefono || '';
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
            pedidoPrecioInput.value = '275';
            pedidoProductoSelect.value = 'Modelo 7';
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
    
    function cargarPedidos(productoFilter = '', dateFilter = '', statusFilter = '', customStartDate = null, customEndDate = null) {
        if (!cuerpoTablaPedidos) return;
        if (unsubscribePedidos) unsubscribePedidos();

        cuerpoTablaPedidos.innerHTML = `<tr><td colspan="11" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Cargando pedidos lindos...</td></tr>`;
        
        let q = query(pedidosCollectionRef, orderBy("createdAt", "desc"));
        if (productoFilter) q = query(q, where("producto", "==", productoFilter));
        if (statusFilter) q = query(q, where("estatus", "==", statusFilter));

        if (dateFilter === 'personalizado' && customStartDate && customEndDate) {
            q = query(q, where("createdAt", ">=", customStartDate), where("createdAt", "<=", customEndDate));
        } else {
            const { startDate: filterStartDate, endDate: filterEndDate } = getDateRange(dateFilter);
            if (filterStartDate && filterEndDate) {
                 q = query(q, where("createdAt", ">=", filterStartDate), where("createdAt", "<", filterEndDate));
            }
        }

        unsubscribePedidos = onSnapshot(q, (snapshot) => {
            let focusedPedidoId = null;
            if (document.body.classList.contains('search-active') && currentSearchIndex > -1 && searchMatches[currentSearchIndex]) {
                const oldRow = searchMatches[currentSearchIndex].element.closest('tr');
                if (oldRow) {
                    focusedPedidoId = oldRow.dataset.id;
                }
            }

            cuerpoTablaPedidos.innerHTML = '';

            const totalFiltrados = snapshot.size;
            let sumaFiltradaTotal = 0;
            snapshot.docs.forEach(doc => {
                sumaFiltradaTotal += Number(doc.data().precio) || 0;
            });

            contadorPedidosFiltrados.textContent = `${totalFiltrados} filtrados`;
            contadorSumaFiltrada.textContent = formatCurrency(sumaFiltradaTotal);
            
            const defaultDateFilter = (auth.currentUser && auth.currentUser.email === 'alex@dekoor.com') ? 'hoy' : 'ultimos-10-dias';
            const isDefaultView = !productoFilter && !statusFilter && dateFilter === defaultDateFilter && !customStartDate;
            
            contadorPedidosFiltrados.classList.toggle('visible', !isDefaultView);
            if(isDefaultView) {
                contadorSumaFiltrada.classList.remove('visible');
                filteredCounterClicks = 0;
            }

            if (snapshot.empty) {
                cuerpoTablaPedidos.innerHTML = `<tr><td colspan="11" class="empty-cell">Aún no hay pedidos registrados que coincidan con los filtros. 😊</td></tr>`;
                return;
            }

            const allPedidosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const ordersToHighlight = new Set();

            for (let i = 0; i < allPedidosData.length; i++) {
                const orderA = allPedidosData[i];
                if (!orderA.telefono || !orderA.createdAt || typeof orderA.createdAt.toDate !== 'function') continue;
                for (let j = 0; j < allPedidosData.length; j++) {
                    if (i === j) continue;
                    const orderB = allPedidosData[j];
                    if (!orderB.telefono || !orderB.createdAt || typeof orderB.createdAt.toDate !== 'function') continue;
                    if (orderA.telefono === orderB.telefono) {
                        try {
                            const dateA = orderA.createdAt.toDate();
                            const dateB = orderB.createdAt.toDate();
                            const diffInHours = Math.abs(dateA.getTime() - dateB.getTime()) / 36e5;

                            if (diffInHours < 24) {
                                ordersToHighlight.add(orderA.id);
                                ordersToHighlight.add(orderB.id);
                            }
                        } catch (e) {
                            console.warn("Error comparing dates for phone highlighting:", e, orderA, orderB);
                        }
                    }
                }
            }

            allPedidosData.forEach((pedido) => {
                const tr = document.createElement('tr');
                tr.dataset.id = pedido.id;

                tr.addEventListener('click', (event) => {
                    if (event.target.closest('button, a, .status-display, input, select, textarea, img')) return;
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

                const consecutiveOrderNumber = pedido.consecutiveOrderNumber || 'N/A';
                const fechaFormateada = formatFirebaseTimestamp(pedido.createdAt);
                const precioFormateado = formatCurrency(pedido.precio);
                const vendedor = pedido.vendedor || '<em>N/A</em>';
                const telefonoOriginal = pedido.telefono || '-';
                const estatus = pedido.estatus || 'Sin estatus';
                const comentarios = pedido.comentarios || '-';
                const productoNombre = pedido.producto || '<em>N/A</em>';
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
                
                            // Create a placeholder icon instead of an img tag
                            const placeholder = document.createElement('div');
                            placeholder.className = 'foto-placeholder-icon'; // A new class for styling
                            placeholder.innerHTML = '<i class="fas fa-camera"></i>';
                            placeholder.title = 'Ver foto(s)';
                            
                            placeholder.addEventListener('click', (e) => {
                                e.stopPropagation();
                                abrirModalImagen(photoUrls, 0, `DH${orderId}`);
                            });
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
                
                // MODIFIED: Phone Column with Checkbox on the left
                const telefonoTd = document.createElement('td');
                const phoneActionsContainer = document.createElement('div');
                phoneActionsContainer.className = 'phone-actions-container';

                if (telefonoOriginal !== '-') {
                    // Checkbox (now first)
                    const checkboxContainer = document.createElement('label');
                    checkboxContainer.className = 'phone-checkbox-container';
                    checkboxContainer.title = 'Marcar como verificado';

                    const checkboxInput = document.createElement('input');
                    checkboxInput.type = 'checkbox';
                    checkboxInput.checked = pedido.telefonoVerificado === true;
                    checkboxInput.addEventListener('change', (e) => {
                        e.stopPropagation();
                        actualizarVerificacionTelefono(pedido.id, e.target.checked);
                    });

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
                    // Copy Button (now last)
                    const copyButton = document.createElement('button');
                    copyButton.className = 'copy-phone-button';
                    copyButton.title = 'Copiar teléfono';
                    copyButton.innerHTML = '<i class="fas fa-copy"></i>';
                    copyButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(telefonoOriginal).then(() => {
                            copyButton.classList.add('copied');
                            copyButton.innerHTML = '<i class="fas fa-check"></i>';
                            showCopyToast("¡Teléfono copiado!", "success");
                            setTimeout(() => {
                                copyButton.classList.remove('copied');
                                copyButton.innerHTML = '<i class="fas fa-copy"></i>';
                            }, 1500);
                        }).catch(err => console.error('Error al copiar el teléfono: ', err));
                    });
                    phoneActionsContainer.appendChild(copyButton);
                }
                telefonoTd.appendChild(phoneActionsContainer);
                tr.appendChild(telefonoTd);
                // END MODIFICATION
                
                // MODIFIED: Estatus Column with Checkbox
                const estatusTdCell = createTd('');
                const statusActionsContainer = document.createElement('div');
                statusActionsContainer.className = 'status-actions-container';

                // Checkbox
                const checkboxContainerEstatus = document.createElement('label');
                checkboxContainerEstatus.className = 'status-checkbox-container';
                checkboxContainerEstatus.title = 'Marcar como verificado';

                const checkboxInputEstatus = document.createElement('input');
                checkboxInputEstatus.type = 'checkbox';
                checkboxInputEstatus.checked = pedido.estatusVerificado === true;
                checkboxInputEstatus.addEventListener('change', (e) => {
                    e.stopPropagation();
                    actualizarVerificacionEstatus(pedido.id, e.target.checked);
                });

                const checkmarkSpanEstatus = document.createElement('span');
                checkmarkSpanEstatus.className = 'checkmark';

                checkboxContainerEstatus.appendChild(checkboxInputEstatus);
                checkboxContainerEstatus.appendChild(checkmarkSpanEstatus);
                statusActionsContainer.appendChild(checkboxContainerEstatus);

                // Estatus display (existing logic)
                const estatusSpan = document.createElement('span');
                estatusSpan.className = `status-display status-${estatus.toLowerCase().replace(/\s+/g, '-')}`;
                estatusSpan.textContent = estatus;
                estatusSpan.title = "Clic para cambiar estatus";
                estatusSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    mostrarMenuEstatus(e, pedido.id, estatus)
                });
                statusActionsContainer.appendChild(estatusSpan);
                
                estatusTdCell.appendChild(statusActionsContainer);
                tr.appendChild(estatusTdCell);
                // END MODIFICATION

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
                editButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    abrirModalPedido(pedido);
                });
                accionesTd.appendChild(editButton);

                const deleteButton = document.createElement('button');
                deleteButton.className = 'action-button delete-button';
                deleteButton.innerHTML = '<i class="fas fa-trash-alt"></i> Borrar';
                deleteButton.title = 'Borrar Pedido';
                deleteButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    abrirModalConfirmarBorrado(pedido.id, pedido)
                });
                accionesTd.appendChild(deleteButton);
                tr.appendChild(accionesTd);

                cuerpoTablaPedidos.appendChild(tr);
            });
            
            preloadAllImagesInBackground(allPedidosData);

            if (selectedRowId) {
                const rowToReselect = cuerpoTablaPedidos.querySelector(`tr[data-id="${selectedRowId}"]`);
                if (rowToReselect) {
                    rowToReselect.classList.add('selected-row');
                    currentlySelectedRow = rowToReselect;
                } else {
                    selectedRowId = null;
                    currentlySelectedRow = null;
                }
            }

            if(document.body.classList.contains('search-active')) {
                performSearch(false, focusedPedidoId);
            }

        }, (error) => {
            console.error("Error al obtener pedidos:", error);
            cuerpoTablaPedidos.innerHTML = `<tr><td colspan="11" class="empty-cell" style="color: #d9534f;">Hubo un error al cargar los pedidos.</td></tr>`;
        });
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
         if (!filtroProductoSelect) return;
         const currentValue = filtroProductoSelect.value;
         filtroProductoSelect.innerHTML = '<option value="">Todos los productos</option>';
         getDocs(collection(db, "pedidos")).then((querySnapshot) => {
             const productNames = new Set();
             querySnapshot.forEach((doc) => { if (doc.data().producto) productNames.add(doc.data().producto); });
             Array.from(productNames).sort().forEach(product => {
                 const option = document.createElement('option');
                 option.value = product; option.textContent = product;
                 filtroProductoSelect.appendChild(option);
             });
             if (Array.from(productNames).includes(currentValue)) {
                filtroProductoSelect.value = currentValue;
             }
         }).catch(error => console.error("Error fetching product names for filter:", error));
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

        const clickedElement = event.currentTarget;
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
            item.addEventListener('click', () => {
                actualizarEstatusPedido(pedidoId, option.value);
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

    async function actualizarEstatusPedido(pedidoId, nuevoEstatus) {
        if (!auth.currentUser) return;
        const pedidoRef = doc(db, "pedidos", pedidoId);
        try { await updateDoc(pedidoRef, { estatus: nuevoEstatus }); }
        catch (error) {
            console.error("Error al actualizar estatus: ", error);
        }
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
        if (productoFinal === 'Otro') {
            productoFinal = pedidoProductoOtroInput.value.trim();
            if (!productoFinal) {
                if(mensajeErrorPedido) mensajeErrorPedido.textContent = '¡El nombre del producto (Otro) es obligatorio!';
                pedidoProductoOtroInput.focus(); return;
            }
        } else if (!productoFinal) {
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
            
            const pedidoData = {
                producto: productoFinal,
                vendedor: loggedInUserName,
                telefono: telefono,
                fotoUrls: finalOrderPhotoUrls,
                fotoPromocionUrls: finalPromoPhotoUrls,
                comentarios: pedidoComentariosInput.value.trim(),
                datosProducto: pedidoDatosProductoInput.value.trim(),
                datosPromocion: pedidoDatosPromocionInput.value.trim(),
                precio: Number(pedidoPrecioInput.value) || 0,
                userEmail: auth.currentUser.email
            };

            if (editingPedidoId) {
                btnGuardarPedido.innerHTML = '<i class="fas fa-database"></i> Actualizando...';
                const docRef = doc(db, "pedidos", editingPedidoId);
                Object.keys(pedidoData).forEach(key => pedidoData[key] === undefined && delete pedidoData[key]);
                await updateDoc(docRef, pedidoData);
                cerrarModalPedido();
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
    
    function performSearch(isNewSearch = true, focusedPedidoId = null) {
        clearSearchHighlight();
        const searchTerm = searchInput.value.trim();
        const allRows = document.querySelectorAll('#cuerpoTablaPedidos tr');

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

    function actualizarContadorHoy() {
        if (unsubscribeHoy) unsubscribeHoy();

        const { startDate, endDate } = getDateRange('hoy');
        if (!startDate || !endDate) return;

        const q = query(pedidosCollectionRef, where("createdAt", ">=", startDate), where("createdAt", "<", endDate));
        
        unsubscribeHoy = onSnapshot(q, (snapshot) => {
            contadorPedidosHoy.textContent = snapshot.size;
        }, (error) => {
            console.error("Error getting today's orders count:", error);
            contadorPedidosHoy.textContent = 'X';
        });
    }


    // --- Event Listeners & Initial Calls ---
    
    applySavedTheme();

    if (pedidoProductoSelect) {
        pedidoProductoSelect.addEventListener('change', () => {
            const esOtro = pedidoProductoSelect.value === 'Otro';
            pedidoProductoOtroInput.style.display = esOtro ? 'block' : 'none';
            pedidoProductoOtroInput.required = esOtro;
            if (esOtro) {
                pedidoProductoOtroInput.value = '';
                pedidoProductoOtroInput.focus();
            }
        });
    }
    
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
        });
        scrollToTopBtn.addEventListener('click', () => {
            tablaContainer.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    
    // Modal Event Listeners
    if (btnMostrarFormularioPedido) btnMostrarFormularioPedido.addEventListener('click', () => abrirModalPedido());
    if (btnCerrarModal) btnCerrarModal.addEventListener('click', cerrarModalPedido);
    if (btnCancelarPedido) btnCancelarPedido.addEventListener('click', cerrarModalPedido);

    if (modalImagenPedido) modalImagenPedido.addEventListener('click', (e) => { if (e.target === modalImagenPedido) cerrarModalImagen(); });
    if (modalConfirmarBorrado) modalConfirmarBorrado.addEventListener('click', (e) => { if (e.target === modalConfirmarBorrado) cerrarModalConfirmarBorrado(); });
    if (modalConfirmacionRegistro) modalConfirmacionRegistro.addEventListener('click', (e) => { if (e.target === modalConfirmacionRegistro) cerrarModalConfirmacionRegistro(); });
    if (modalComentario) modalComentario.addEventListener('click', (e) => { if (e.target === modalComentario) cerrarModalComentario(); });
    
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
    if (cuerpoTablaPedidos) {
        cuerpoTablaPedidos.addEventListener('dblclick', e => {
            if (e.target && e.target.classList.contains('comment-cell')) {
                abrirModalComentario(e.target.dataset.fullText);
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

    searchInput.addEventListener('input', () => performSearch(true));
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
