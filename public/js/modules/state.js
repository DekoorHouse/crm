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
    knowledgeBase: [],
    botSettings: { instructions: '' },
    awayMessageSettings: { isActive: true },
    globalBotSettings: { isActive: false },
    googleSheetSettings: { googleSheetId: '' },
    selectedContactId: null, 
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
    isTagSidebarOpen: true,
    activeView: 'chats',
};

// --- Listener Unsubscribers ---
let unsubscribeMessagesListener = null, 
    unsubscribeContactsListener = null, 
    unsubscribeNotesListener = null, 
    unsubscribeQuickRepliesListener = null, 
    unsubscribeTagsListener = null, 
    unsubscribeAdResponsesListener = null, 
    unsubscribeKnowledgeBaseListener = null, 
    unsubscribeAIAdPromptsListener = null;

// --- Chart instances ---
let dailyMessagesChart = null;
let tagsDistributionChart = null;
