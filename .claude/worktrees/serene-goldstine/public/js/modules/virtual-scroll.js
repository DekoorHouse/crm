// --- Virtual Scroll Module ---
// Renderiza solo los contactos visibles en el viewport para soportar miles de items sin lag.

const VS_ITEM_HEIGHT = 52;
const VS_BUFFER = 10;
const VS_INFINITE_SCROLL_THRESHOLD = 200;

let _vsContainer = null;
let _vsSpacer = null;
let _vsResizeObserver = null;

/**
 * Inicializa el virtual scroll en #contacts-list.
 * Debe llamarse después de que el DOM del chat view esté montado.
 */
function initVirtualScroll() {
    // Limpiar observer anterior si existe (por navegación entre vistas)
    if (_vsResizeObserver) {
        _vsResizeObserver.disconnect();
        _vsResizeObserver = null;
    }

    _vsContainer = document.getElementById('contacts-list');
    _vsSpacer = document.getElementById('contacts-scroll-spacer');
    if (!_vsContainer || !_vsSpacer) return;

    // Medir altura del contenedor
    state.virtualScroll.containerHeight = _vsContainer.clientHeight;

    // Observar cambios de tamaño del contenedor
    _vsResizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            state.virtualScroll.containerHeight = entry.contentRect.height;
            _vsRenderVisible();
        }
    });
    _vsResizeObserver.observe(_vsContainer);

    // Scroll handler con throttle por RAF
    _vsContainer.addEventListener('scroll', _vsOnScroll);
}

/**
 * Handler de scroll throttled con requestAnimationFrame.
 */
function _vsOnScroll() {
    if (state.virtualScroll.rafId) return;
    state.virtualScroll.rafId = requestAnimationFrame(() => {
        state.virtualScroll.rafId = null;
        if (!_vsContainer) return;

        state.virtualScroll.scrollTop = _vsContainer.scrollTop;
        const { startIndex, endIndex } = _vsCalcRange();

        // Solo re-renderizar si el rango visible cambió
        if (startIndex !== state.virtualScroll.startIndex || endIndex !== state.virtualScroll.endIndex) {
            state.virtualScroll.startIndex = startIndex;
            state.virtualScroll.endIndex = endIndex;
            _vsRenderVisible();
        }

        // Infinite scroll: si estamos cerca del fondo virtual
        const totalHeight = state.virtualScroll.filteredContacts.length * VS_ITEM_HEIGHT;
        if (totalHeight - _vsContainer.scrollTop - state.virtualScroll.containerHeight < VS_INFINITE_SCROLL_THRESHOLD) {
            fetchMoreContacts();
        }
    });
}

/**
 * Calcula el rango de índices visibles + buffer.
 */
function _vsCalcRange() {
    const scrollTop = state.virtualScroll.scrollTop;
    const containerHeight = state.virtualScroll.containerHeight;
    const total = state.virtualScroll.filteredContacts.length;

    const startIndex = Math.max(0, Math.floor(scrollTop / VS_ITEM_HEIGHT) - VS_BUFFER);
    const visibleCount = Math.ceil(containerHeight / VS_ITEM_HEIGHT);
    const endIndex = Math.min(total, Math.floor(scrollTop / VS_ITEM_HEIGHT) + visibleCount + VS_BUFFER);

    return { startIndex, endIndex };
}

/**
 * Renderiza solo los items visibles dentro del spacer.
 */
function _vsRenderVisible() {
    if (!_vsSpacer) return;
    const { filteredContacts, startIndex, endIndex } = state.virtualScroll;

    // Actualizar altura total del spacer
    _vsSpacer.style.height = (filteredContacts.length * VS_ITEM_HEIGHT) + 'px';

    // Generar HTML solo para items visibles
    let html = '';
    for (let i = startIndex; i < endIndex; i++) {
        const contact = filteredContacts[i];
        if (!contact) continue;
        const isSelected = contact.id === state.selectedContactId;
        const vsStyle = `position:absolute;top:${i * VS_ITEM_HEIGHT}px;left:0;right:0;height:${VS_ITEM_HEIGHT}px;`;
        html += ContactItemTemplate(contact, isSelected, vsStyle);
    }
    _vsSpacer.innerHTML = html;
}

/**
 * Actualiza la lista virtual con nuevos datos filtrados.
 * Reemplaza el uso directo de innerHTML en handleSearchContacts.
 */
function updateVirtualList(filteredContacts) {
    state.virtualScroll.filteredContacts = filteredContacts;

    if (!_vsSpacer || !_vsContainer) {
        // Si el DOM aún no está listo, intentar obtener referencias
        _vsContainer = document.getElementById('contacts-list');
        _vsSpacer = document.getElementById('contacts-scroll-spacer');
        if (!_vsSpacer || !_vsContainer) return;
        state.virtualScroll.containerHeight = _vsContainer.clientHeight;
    }

    // Recalcular rango visible desde la posición actual de scroll
    state.virtualScroll.scrollTop = _vsContainer.scrollTop;
    const { startIndex, endIndex } = _vsCalcRange();
    state.virtualScroll.startIndex = startIndex;
    state.virtualScroll.endIndex = endIndex;

    _vsRenderVisible();
}

/**
 * Hace scroll programático a un contacto específico, centrándolo en el viewport.
 */
function scrollToContact(contactId) {
    const index = state.virtualScroll.filteredContacts.findIndex(c => c.id === contactId);
    if (index === -1 || !_vsContainer) return;

    const targetTop = index * VS_ITEM_HEIGHT;
    const containerHeight = state.virtualScroll.containerHeight;

    // Solo hacer scroll si el item no está visible
    if (targetTop < _vsContainer.scrollTop || targetTop + VS_ITEM_HEIGHT > _vsContainer.scrollTop + containerHeight) {
        _vsContainer.scrollTop = targetTop - containerHeight / 2 + VS_ITEM_HEIGHT / 2;
    }
}

// Exponer funciones globalmente
window.initVirtualScroll = initVirtualScroll;
window.updateVirtualList = updateVirtualList;
window.scrollToContact = scrollToContact;
