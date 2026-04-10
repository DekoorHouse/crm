export interface AppModule {
  id: string;
  name: string;
  description: string;
  icon: string;
  url: string;
  color: string;
  category: "ventas" | "operaciones" | "equipo" | "marketing";
}

const BASE_URL = "https://app.dekoormx.com";

export const MODULES: AppModule[] = [
  // --- Ventas ---
  {
    id: "pedidos",
    name: "Pedidos",
    description: "Gestión de pedidos",
    icon: "shopping-bag",
    url: `${BASE_URL}/pedidos/`,
    color: "#4CAF50",
    category: "ventas",
  },
  {
    id: "crm",
    name: "CRM",
    description: "Chats y clientes",
    icon: "message-circle",
    url: `${BASE_URL}/crm/chats`,
    color: "#2196F3",
    category: "ventas",
  },
  {
    id: "clientes",
    name: "Clientes",
    description: "Base de clientes",
    icon: "users",
    url: `${BASE_URL}/clientes/`,
    color: "#9C27B0",
    category: "ventas",
  },
  {
    id: "cobranza",
    name: "Cobranza",
    description: "Seguimiento de cobros",
    icon: "dollar-sign",
    url: `${BASE_URL}/cobranza/`,
    color: "#FF9800",
    category: "ventas",
  },

  // --- Operaciones ---
  {
    id: "laser",
    name: "Laser",
    description: "Producción láser",
    icon: "zap",
    url: `${BASE_URL}/laser/`,
    color: "#F44336",
    category: "operaciones",
  },
  {
    id: "envios",
    name: "Envios",
    description: "Gestión de envíos",
    icon: "truck",
    url: `${BASE_URL}/envios/`,
    color: "#795548",
    category: "operaciones",
  },
  {
    id: "guias",
    name: "Guias",
    description: "Guías de paquetería",
    icon: "file-text",
    url: `${BASE_URL}/guias/`,
    color: "#607D8B",
    category: "operaciones",
  },
  {
    id: "rastreo",
    name: "Rastreo",
    description: "Rastreo J&T",
    icon: "map-pin",
    url: `${BASE_URL}/jt-rastreo/`,
    color: "#00BCD4",
    category: "operaciones",
  },

  // --- Equipo ---
  {
    id: "checador",
    name: "Checador",
    description: "Asistencia del equipo",
    icon: "clock",
    url: `${BASE_URL}/checador/panel`,
    color: "#3F51B5",
    category: "equipo",
  },
  {
    id: "admon",
    name: "Admin",
    description: "Panel administrativo",
    icon: "settings",
    url: `${BASE_URL}/admon/`,
    color: "#455A64",
    category: "equipo",
  },

  // --- Marketing ---
  {
    id: "sitio",
    name: "Sitio Web",
    description: "Tienda online",
    icon: "globe",
    url: `${BASE_URL}/sitio/`,
    color: "#1B4D5C",
    category: "marketing",
  },
  {
    id: "autopost",
    name: "Autopost",
    description: "Publicación en redes",
    icon: "share-2",
    url: `${BASE_URL}/autopost/`,
    color: "#E91E63",
    category: "marketing",
  },
  {
    id: "editor",
    name: "Editor",
    description: "Diseño de mockups",
    icon: "edit-3",
    url: `${BASE_URL}/editor/`,
    color: "#FF5722",
    category: "marketing",
  },
  {
    id: "ads",
    name: "Anuncios",
    description: "Mensajes de ads",
    icon: "megaphone",
    url: `${BASE_URL}/ads/`,
    color: "#8BC34A",
    category: "marketing",
  },
];

export const CATEGORIES = [
  { key: "ventas" as const, label: "Ventas" },
  { key: "operaciones" as const, label: "Operaciones" },
  { key: "equipo" as const, label: "Equipo" },
  { key: "marketing" as const, label: "Marketing" },
];
