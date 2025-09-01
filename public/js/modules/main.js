// --- START: App Initialization & Main Entry Point ---
// Este archivo inicializa la aplicación y configura los listeners globales.

/**
 * Inicia la aplicación después de que el usuario se ha autenticado.
 */
function startApp() { 
    navigateTo(state.activeView);
    // Start all data listeners
    fetchInitialContacts(); // MODIFICADO: Llama a la nueva función de carga inicial paginada
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
    // ELIMINADO: El listener de contactos ya no existe en tiempo real
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

