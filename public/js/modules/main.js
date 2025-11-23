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
    
    // --- NUEVOS LISTENERS PARA DEPARTAMENTOS Y REGLAS ---
    listenForDepartments();
    listenForAdRoutingRules();
    // ----------------------------------------------------

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
    
    // --- DETENER NUEVOS LISTENERS ---
    if (unsubscribeDepartmentsListener) unsubscribeDepartmentsListener();
    if (unsubscribeAdRoutingRulesListener) unsubscribeAdRoutingRulesListener();
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

    const kbForm = document.getElementById('kb-form');
    if (kbForm) {
        kbForm.addEventListener('submit', handleSaveKnowledgeBaseEntry);
    }

    // --- AÑADIDO: Listeners para los nuevos modales de IA ---
    const aiAdPromptForm = document.getElementById('ai-ad-prompt-form');
    if (aiAdPromptForm) {
        aiAdPromptForm.addEventListener('submit', handleSaveAIAdPrompt);
    }

    const botSettingsForm = document.getElementById('bot-settings-form');
    if (botSettingsForm) {
        botSettingsForm.addEventListener('submit', handleSaveBotSettings);
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
