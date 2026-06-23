// ============================================================
// DEKOOR CRM - Registro central de temas
// ============================================================
// La definicion de colores vive en globals.css como bloques
// [data-theme="<id>"]. Aqui solo va la metadata que necesita la
// UI (nombre, descripcion, si es oscuro y los swatches del preview).
// El "id" debe coincidir con el atributo data-theme del CSS.

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  isDark: boolean;
  /** Colores representativos para la tarjeta de seleccion (preview). */
  swatches: {
    bg: string;
    surface: string;
    primary: string;
    accent: string;
    text: string;
  };
}

export type ThemeId = "dekoor" | "obsidian" | "lila" | "elegante" | "minimal";

export const DEFAULT_THEME: ThemeId = "dekoor";

export const THEMES: ThemeMeta[] = [
  {
    id: "dekoor",
    name: "Tradicional Dekoor",
    description: "Azul y naranja de la marca. Limpio y profesional.",
    isDark: false,
    swatches: { bg: "#f7f9fa", surface: "#ffffff", primary: "#1b4d5c", accent: "#d4722c", text: "#16252a" },
  },
  {
    id: "obsidian",
    name: "Obsidiana",
    description: "Modo oscuro elegante, fondo negro con acentos vivos.",
    isDark: true,
    swatches: { bg: "#0c0d10", surface: "#1b1e24", primary: "#6e8bff", accent: "#f0985a", text: "#f2f3f5" },
  },
  {
    id: "lila",
    name: "Lila",
    description: "Lavanda suave y delicado, con toques rosa.",
    isDark: false,
    swatches: { bg: "#faf7fe", surface: "#ffffff", primary: "#8a5cd1", accent: "#d6608f", text: "#2b2238" },
  },
  {
    id: "elegante",
    name: "Elegante",
    description: "Marfil cálido con verde salvia y dorado. Sobrio.",
    isDark: false,
    swatches: { bg: "#faf8f4", surface: "#ffffff", primary: "#47634f", accent: "#b08d57", text: "#2a2722" },
  },
  {
    id: "minimal",
    name: "Minimalista",
    description: "Blanco y negro moderno, con un único acento azul.",
    isDark: false,
    swatches: { bg: "#ffffff", surface: "#ffffff", primary: "#18181b", accent: "#2563eb", text: "#18181b" },
  },
];

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.has(value);
}

export function getTheme(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Mapea valores antiguos ("light"/"dark") al nuevo id de tema. */
export function migrateThemeValue(raw: string | null | undefined): ThemeId {
  if (isThemeId(raw)) return raw;
  if (raw === "dark") return "obsidian";
  if (raw === "light") return "dekoor";
  return DEFAULT_THEME;
}

export const THEME_STORAGE_KEY = "dekoor-theme";
