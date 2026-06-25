// --- START: App Initialization & Main Entry Point ---
// Este archivo inicializa la aplicación y configura los listeners globales.

/**
 * Inicia la aplicación después de que el usuario se ha autenticado.
 */
function startApp() { 
    // --- INICIO DE LA SOLUCIÓN: Guardar el timestamp de carga ---
    state.appLoadTimestamp = new Date();
    // --- FIN DE LA SOLUCIÓN ---

    // Forzar la navegación a la vista de chats para asegurar la carga inicial.
    navigateTo('chats', true); 

    // Start all data listeners
    fetchAllUsers(); // Carga todos los usuarios del sistema
    fetchInitialContacts(); // Carga inicial paginada de contactos
    
    // --- INICIO DE LA SOLUCIÓN: Activar el listener de actualizaciones ---
    listenForContactUpdates(); // Escucha cambios en tiempo real en contactos
    // --- FIN DE LA SOLUCIÓN ---

    listenForUsers(); // Escucha cambios en los usuarios
    listenForQuickReplies();
    listenForTags();
    listenForProducts(); // Lista de productos configurables para el modal de pedidos
    listenForAdResponses();
    listenForCampanas(); // Tracking de campañas — modal de pedido necesita campañas activas

    
    // --- NUEVOS LISTENERS PARA DEPARTAMENTOS Y REGLAS ---
    listenForDepartments();
    listenForAdRoutingRules();
    listenForPendingAiCount(); // Listener en tiempo real para el conteo de IA
    listenForDailyOrderCount(); // Listener en tiempo real para el conteo de pedidos de hoy
    // ----------------------------------------------------

    // Fetch initial non-realtime data
    fetchTemplates();

    fetchGoogleSheetSettings();
    
    // Setup global event listeners
    document.addEventListener('click', handleClickOutside);

    // Limpiar estado mobile-only al rotar / cambiar a desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            document.body.classList.remove('chat-open');
            const sidebar = document.getElementById('main-sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar) sidebar.classList.remove('mobile-open');
            if (overlay) overlay.classList.remove('active');
        }
    });

    // Mobile keyboard handling: cuando el teclado aparece en Chrome móvil
    // el visual viewport se reduce pero #app-container con position:fixed
    // queda anclado al layout viewport, lo que hace desaparecer el header.
    // Sincronizamos la altura del app-container con el visual viewport real.
    if (window.visualViewport) {
        const syncViewportHeight = () => {
            if (window.innerWidth > 768) {
                document.documentElement.style.removeProperty('--mobile-vh');
                return;
            }
            const vh = window.visualViewport.height;
            document.documentElement.style.setProperty('--mobile-vh', vh + 'px');
        };
        window.visualViewport.addEventListener('resize', syncViewportHeight);
        window.visualViewport.addEventListener('scroll', syncViewportHeight);
        syncViewportHeight();
    }
}

/**
 * Detiene los listeners de la aplicación y resetea el estado
 * cuando el usuario cierra sesión.
 */
function stopApp() { 
    // Unsubscribe from all listeners
    // --- INICIO DE LA SOLUCIÓN: Detener el nuevo listener ---
    if (unsubscribeContactUpdatesListener) unsubscribeContactUpdatesListener(); 
    // --- FIN DE LA SOLUCIÓN ---
    if (unsubscribeMessagesListener) unsubscribeMessagesListener(); 
    if (unsubscribeNotesListener) unsubscribeNotesListener();
    if (unsubscribeQuickRepliesListener) unsubscribeQuickRepliesListener();
    if (unsubscribeTagsListener) unsubscribeTagsListener();
    if (unsubscribeProductsListener) unsubscribeProductsListener();
    if (unsubscribeAdResponsesListener) unsubscribeAdResponsesListener();

    
    // --- DETENER NUEVOS LISTENERS ---
    if (unsubscribeDepartmentsListener) unsubscribeDepartmentsListener();
    if (unsubscribeAdRoutingRulesListener) unsubscribeAdRoutingRulesListener();
    if (unsubscribeContactListener) unsubscribeContactListener();
    if (unsubscribePendingAiCountListener) unsubscribePendingAiCountListener();
    if (unsubscribeDailyOrdersListener) unsubscribeDailyOrdersListener();
    // -------------------------------

    // Remove global listeners
    document.removeEventListener('click', handleClickOutside);
    
    // Reset state
    // (A new state object is created on the next login)
    document.getElementById('main-view-container').innerHTML = '';
}

/**
 * Configura los listeners de eventos iniciales que solo necesitan
 * ser configurados una vez, como el formulario de login.
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- INICIO DE MODIFICACIÓN: Inicializar Tema ---
    if (window.initTheme) {
        window.initTheme();
    }
    // --- FIN DE MODIFICACIÓN ---

    setupAuthEventListeners();

    // --- INICIO DE LA SOLUCIÓN ---
    // Adjuntar listeners para los formularios de los modales que existen al cargar la página
    const adResponseForm = document.getElementById('ad-response-form');
    if (adResponseForm) {
        adResponseForm.addEventListener('submit', handleSaveAdResponse);
    }

    const quickReplyForm = document.getElementById('quick-reply-form');
    if (quickReplyForm) {
        quickReplyForm.addEventListener('submit', handleSaveQuickReply);
    }


    // --- FIN DE LA SOLUCIÓN ---

    // --- NUEVOS LISTENERS PARA DEPARTAMENTOS, REGLAS Y TRANSFERENCIA ---
    const deptForm = document.getElementById('department-form');
    if (deptForm) {
        deptForm.addEventListener('submit', handleSaveDepartment);
    }

    const routingForm = document.getElementById('ad-routing-form');
    if (routingForm) {
        routingForm.addEventListener('submit', handleSaveAdRoutingRule);
    }

    const transferForm = document.getElementById('transfer-form');
    if (transferForm) {
        transferForm.addEventListener('submit', handleTransferChat);
    }

    const userForm = document.getElementById('user-form');
    if (userForm) {
        userForm.addEventListener('submit', handleSaveUser);
    }
    // ------------------------------------------------------------------
});

/**
 * Maneja los clics fuera de los elementos "picker" (emojis, plantillas)
 * para cerrarlos.
 * @param {Event} event El objeto del evento de clic.
 */
function handleClickOutside(event) {
    const emojiPicker = document.getElementById('emoji-picker');
    const emojiToggleBtn = document.getElementById('emoji-toggle-btn');
    if (state.emojiPickerOpen && emojiPicker && emojiToggleBtn && !emojiPicker.contains(event.target) && !emojiToggleBtn.contains(event.target)) {
        toggleEmojiPicker();
    }

    const templatePicker = document.getElementById('template-picker');
    const templateToggleBtn = document.getElementById('template-toggle-btn');
    if (state.templatePickerOpen && templatePicker && templateToggleBtn && !templatePicker.contains(event.target) && !templateToggleBtn.contains(event.target)) {
        toggleTemplatePicker();
    }
}
