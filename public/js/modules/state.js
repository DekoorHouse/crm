// --- State Management ---
// Este archivo define el objeto de estado global de la aplicación
// y las variables para manejar las suscripciones en tiempo real.

let state = {
    contacts: [], // Lista de contactos cargados
    messages: [], // Mensajes del chat seleccionado
    notes: [], // Notas internas del chat seleccionado
    quickReplies: [], // Respuestas rápidas disponibles
    adResponses: [], // Mensajes automáticos por Ad ID
    aiAdPrompts: [], // Prompts de IA por Ad ID
    templates: [], // Plantillas de WhatsApp aprobadas
    tags: [], // Etiquetas/Categorías de contactos
    // Lista fija de estatus de pedidos, movida aquí para consistencia
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
    knowledgeBase: [], // Entradas de la base de conocimiento para IA
    botSettings: { instructions: '' }, // Instrucciones generales para el bot IA
    awayMessageSettings: { isActive: true }, // Estado del mensaje de ausencia
    globalBotSettings: { isActive: false }, // Estado del bot IA global
    googleSheetSettings: { googleSheetId: '' }, // ID de la hoja de cálculo de cobertura
    selectedContactId: null, // ID del contacto actualmente seleccionado
    selectedContactOrders: [], // Pedidos del contacto seleccionado (para la barra lateral)
    loadingMessages: false, // Indicador de carga de mensajes
    isUploading: false, // Indicador de subida de archivos
    stagedFile: null, // Archivo local preparado para enviar
    stagedRemoteFile: null, // Archivo remoto (de QR) preparado para enviar
    activeFilter: 'all', // Filtro de etiqueta activo ('all' o key de la etiqueta)
    activeTab: 'chat', // Pestaña activa en el chat ('chat' o 'notes')
    emojiPickerOpen: false, // Estado del selector de emojis
    quickReplyPickerOpen: false, // Estado del selector de respuestas rápidas
    templatePickerOpen: false, // Estado del selector de plantillas
    contactDetailsOpen: false, // Estado de la barra lateral de detalles
    isEditingNote: null, // ID de la nota que se está editando, o null
    replyingToMessage: null, // Mensaje al que se está respondiendo, o null
    campaignMode: false, // ¿Está activo el modo campaña? (No implementado completamente)
    selectedContactIdsForCampaign: [], // IDs seleccionados para campaña (No implementado completamente)
    isTagSidebarOpen: false, // Estado de la barra lateral principal
    activeView: 'chats', // Vista principal activa ('chats', 'pipeline', 'etiquetas', etc.)
    appLoadTimestamp: null, // Momento en que se cargó la app (para listener de updates)
    isSessionExpired: false, // Indica si la ventana de 24h ha cerrado para el chat actual

    // --- Variables de Paginación para la lista de contactos ---
    pagination: {
        lastVisibleId: null, // Guarda el ID del último contacto cargado
        isLoadingMore: false, // Previene cargas múltiples simultáneas
        hasMore: true // Indica si quedan más contactos por cargar
    },

    // --- Estado para los selectores (QR, Plantillas) ---
    pickerItems: [], // Items actualmente mostrados en el selector activo
    pickerSelectedIndex: -1, // Índice del item seleccionado con flechas

    // --- INICIO DE MODIFICACIÓN: Estado para Métricas por Ad ID ---
    adIdMessageCounts: {}, // Almacena el resultado de la API { adId1: count1, ... }
    adIdMetricsDateRange: { start: null, end: null }, // Rango de fechas seleccionado para esta métrica
    // --- FIN DE MODIFICACIÓN ---
};

// --- Variables para cancelar listeners de Firestore ---
let unsubscribeMessagesListener = null,
    unsubscribeContactUpdatesListener = null,
    unsubscribeNotesListener = null,
    unsubscribeQuickRepliesListener = null,
    unsubscribeTagsListener = null,
    unsubscribeAdResponsesListener = null,
    unsubscribeKnowledgeBaseListener = null,
    unsubscribeAIAdPromptsListener = null,
    unsubscribeOrdersListener = null; // Listener para pedidos del contacto seleccionado

// --- Instancias de Gráficas (Chart.js) ---
let dailyMessagesChart = null; // Gráfica de mensajes diarios (general)
let tagsDistributionChart = null; // Gráfica de distribución por etiquetas (general)
// Aquí podrías añadir una variable para la gráfica de Ad ID si decides usar una
// let adIdMessagesChart = null;
