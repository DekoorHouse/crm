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
    fetchInitialContacts(); // Carga inicial paginada
    
    // --- INICIO DE LA SOLUCIÓN: Activar el listener de actualizaciones ---
    listenForContactUpdates(); // Escucha cambios en tiempo real
    // --- FIN DE LA SOLUCIÓN ---

    listenForQuickReplies();
    listenForTags();
    listenForAdResponses();
    listenForAIAdPrompts();
    listenForKnowledgeBase();
    
    // Fetch initial non-realtime data
    fetchTemplates();
    fetchBotSettings();
    fetchAwayMessageSettings();
    fetchGlobalBotSettings();
    fetchGoogleSheetSettings();
    
    // Setup global event listeners
    document.addEventListener('click', handleClickOutside);
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
    if (unsubscribeAdResponsesListener) unsubscribeAdResponsesListener();
    if (unsubscribeKnowledgeBaseListener) unsubscribeKnowledgeBaseListener();
    if (unsubscribeAIAdPromptsListener) unsubscribeAIAdPromptsListener();
    
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

