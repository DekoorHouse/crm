"use client";

import { useTheme } from "@/lib/theme/ThemeProvider";
import type { ThemeMeta } from "@/lib/theme/themes";

// Mini maqueta del CRM con los colores del tema (sidebar + tarjeta + botón).
function ThemePreview({ meta }: { meta: ThemeMeta }) {
  const s = meta.swatches;
  return (
    <div
      className="h-24 w-full rounded-xl overflow-hidden flex ring-1 ring-black/5"
      style={{ background: s.bg }}
    >
      {/* Sidebar simulada */}
      <div className="w-1/4 h-full flex flex-col items-center gap-1.5 py-2.5" style={{ background: s.surface }}>
        <span className="w-5 h-5 rounded-md" style={{ background: s.primary }} />
        <span className="w-3.5 h-1 rounded-full" style={{ background: s.primary, opacity: 0.5 }} />
        <span className="w-3.5 h-1 rounded-full" style={{ background: s.text, opacity: 0.18 }} />
        <span className="w-3.5 h-1 rounded-full" style={{ background: s.text, opacity: 0.18 }} />
      </div>
      {/* Contenido */}
      <div className="flex-1 h-full p-2.5 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-10 rounded-full" style={{ background: s.text, opacity: 0.7 }} />
          <span className="ml-auto h-3.5 w-3.5 rounded-full" style={{ background: s.accent }} />
        </div>
        <div className="flex-1 rounded-lg p-1.5 flex flex-col gap-1" style={{ background: s.surface }}>
          <span className="h-1 w-3/4 rounded-full" style={{ background: s.text, opacity: 0.35 }} />
          <span className="h-1 w-1/2 rounded-full" style={{ background: s.text, opacity: 0.2 }} />
          <span
            className="mt-auto h-3.5 w-12 rounded-md"
            style={{ background: s.primary }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ThemePicker() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {themes.map((t) => {
        const active = t.id === theme;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            aria-pressed={active}
            className={`text-left rounded-2xl p-2.5 transition-all border-2 ${
              active
                ? "border-primary shadow-sm"
                : "border-outline-variant/20 hover:border-outline-variant/50"
            }`}
          >
            <ThemePreview meta={t} />
            <div className="flex items-center gap-2 mt-2.5 px-0.5">
              <span className="text-sm font-bold text-on-surface flex-1">{t.name}</span>
              {active ? (
                <span className="flex items-center gap-1 text-[11px] font-bold text-primary">
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                  Activo
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-on-surface-variant">Elegir</span>
              )}
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5 px-0.5 leading-snug">{t.description}</p>
          </button>
        );
      })}
    </div>
  );
}
