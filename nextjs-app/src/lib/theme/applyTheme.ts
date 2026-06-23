import { getTheme, type ThemeId } from "./themes";

/**
 * Aplica un tema al documento: fija data-theme en <html>, alterna la clase
 * .dark (para utilidades dark: y fondos .dark .chat-bg) y actualiza el
 * <meta name="theme-color"> (barra del navegador en móvil). No toca storage
 * ni estado de React — eso lo maneja el ThemeProvider.
 */
export function applyThemeToDom(id: ThemeId) {
  if (typeof document === "undefined") return;
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.classList.toggle("dark", theme.isDark);

  // Barra de estado/navegador: fondo en temas oscuros, primario en claros.
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = theme.isDark ? theme.swatches.bg : theme.swatches.primary;
}
