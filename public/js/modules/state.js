// --- State Management ---
// Este archivo define el objeto de estado global de la aplicación
// y las variables para manejar las suscripciones en tiempo real.

let state = {
    contacts: [],
    messages: [],
    notes: [],
    quickReplies: [],
    adResponses: [],
    aiAdPrompts: [],
    templates: [],
    tags: [],
    // INICIO DE LA MODIFICACIÓN: Se añade una lista dedicada para los estados de los pedidos.
    orderStatuses: [
        { key: "Sin estatus", label: "Sin Estatus", color: "#6c757d" },
        { key: "Foto enviada", label: "Foto Enviada", color: "#007bff" },
        { key: "Esperando pago", label: "Esperando Pago", color: "#ffc107" },
        { key: "Pagado", label: "Pagado", color: "#28a745" },
        { key: "Diseñado", label: "Diseñado", color: "#6f42c1" },
        { key: "Fabricar", label: "Fabricar", color: "#17a2b8" },
        { key: "Corregir", label: "Corregir", color: "#fd7e14" },
        { key: "Corregido", label: "Corregido", color: "#20c997" },
        { key: "Mns Amenazador", label: "Mns Amenazador", color: "#dc3545" },
        { key: "Cancelado", label: "Cancelado", color: "#6c757d" }
    ],
    // FIN DE LA MODIFICACIÓN
    knowledgeBase: [],
    botSettings: { instructions: '' },
    awayMessageSettings: { isActive: true },
    globalBotSettings: { isActive: false },
    googleSheetSettings: { googleSheetId: '' },
    selectedContactId: null,
    selectedContactOrders: [],
    loadingMessages: false,
    isUploading: false,
    stagedFile: null,
    stagedRemoteFile: null,
    activeFilter: 'all',
    activeTab: 'chat',
    emojiPickerOpen: false,
    quickReplyPickerOpen: false,
    templatePickerOpen: false,
    contactDetailsOpen: false,
    isEditingNote: null,
    replyingToMessage: null,
    campaignMode: false,
    selectedContactIdsForCampaign: [],
    isTagSidebarOpen: false, 
    activeView: 'chats',
    appLoadTimestamp: null,

    // --- NUEVAS VARIABLES PARA PAGINACIÓN ---
    pagination: {
        lastVisibleId: null, // Guarda el ID del último contacto cargado
        isLoadingMore: false, // Previene cargas múltiples simultáneas
        hasMore: true // Indica si quedan más contactos por cargar
    },
    pickerItems: [],
    pickerSelectedIndex: -1
};

// --- Listener Unsubscribers ---
let unsubscribeMessagesListener = null,
    unsubscribeContactUpdatesListener = null,
    unsubscribeNotesListener = null,
    unsubscribeQuickRepliesListener = null,
    unsubscribeTagsListener = null,
    unsubscribeAdResponsesListener = null,
    unsubscribeKnowledgeBaseListener = null,
    unsubscribeAIAdPromptsListener = null,
    unsubscribeOrdersListener = null;

// --- Chart instances ---
let dailyMessagesChart = null;
let tagsDistributionChart = null;
