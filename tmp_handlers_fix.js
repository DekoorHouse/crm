
// --- START: Bot Toggle Logic ---
async function handleBotToggle(contactId, isActive) {
    try {
        // 1. Actualización optimista de la UI
        const contactIndex = state.contacts.findIndex(c => c.id === contactId);
        if (contactIndex > -1) {
            state.contacts[contactIndex].botActive = isActive;
            
            // Refrescar lista de contactos para ver el aro pulsante/icono
            handleSearchContacts();
            
            // Si el chat está abierto, refrescar cabecera
            if (state.selectedContactId === contactId) {
                renderChatWindow();
            }
        }

        // 2. Actualizar en Firestore
        await db.collection("contacts_whatsapp").doc(contactId).update({ 
            botActive: isActive 
        });

    } catch (error) {
        console.error("Error al cambiar estado de la IA:", error);
        if (window.showError) showError("No se pudo cambiar el estado de la IA.");
        // Revertir cambio optimista si falla
        const contactIndex = state.contacts.findIndex(c => c.id === contactId);
        if (contactIndex > -1) {
            state.contacts[contactIndex].botActive = !isActive;
            if (state.selectedContactId === contactId) {
                renderChatWindow();
            }
        }
    }
}
// --- END: Bot Toggle Logic ---

// Exportar las funciones globalmente
window.handleMarkAsUnread = handleMarkAsUnread;
window.handleBotToggle = handleBotToggle;


/**
 * Maneja el borrado del historial de chat después de la confirmación del usuario.
 * @param {string} contactId ID del contacto.
 */
async function handleClearChatHistory(contactId) {
    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact) return;

    const confirmed = confirm(`¿Estás seguro de que deseas borrar TODO el historial de chat con ${contact.name || contactId}? Esta acción NO se puede deshacer.`);
    
    if (confirmed) {
        try {
            if (window.showError) showError("Iniciando borrado de historial...", "info");
            
            await deleteContactMessagesAPI(contactId);
            
            // Si el contacto borrado es el actual, limpiar los mensajes en el estado y UI
            if (state.selectedContactId === contactId) {
                state.messages = [];
                renderChatWindow({ preserveScroll: false });
            }
            
            if (window.showError) showError("Historial borrado con éxito.", "success");
        } catch (error) {
            console.error("Error al borrar historial:", error);
            if (window.showError) showError("No se pudo borrar el historial: " + error.message);
            else alert("No se pudo borrar el historial: " + error.message);
        }
    }
}

window.handleClearChatHistory = handleClearChatHistory;
