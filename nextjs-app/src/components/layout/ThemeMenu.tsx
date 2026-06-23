"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme/ThemeProvider";
import type { ThemeMeta } from "@/lib/theme/themes";

function Swatches({ meta }: { meta: ThemeMeta }) {
  const dots = [meta.swatches.primary, meta.swatches.accent, meta.swatches.surface];
  return (
    <span className="flex -space-x-1 flex-shrink-0">
      {dots.map((c, i) => (
        <span
          key={i}
          className="w-3.5 h-3.5 rounded-full ring-1 ring-black/10"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

interface ThemeMenuProps {
  /** "sidebar" = fila ancha con texto; "icon" = botón circular compacto. */
  variant?: "sidebar" | "icon";
  /** En la sidebar colapsada solo se muestra el icono. */
  collapsed?: boolean;
}

export default function ThemeMenu({ variant = "icon", collapsed = false }: ThemeMenuProps) {
  const { theme, meta, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const panel = (
    <div
      className={`absolute z-50 w-60 bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/20 p-1.5 ${
        variant === "sidebar" ? "bottom-full mb-2 left-0" : "right-0 top-12"
      }`}
    >
      <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/60">
        Tema
      </p>
      {themes.map((t) => {
        const active = t.id === theme;
        return (
          <button
            key={t.id}
            onClick={() => {
              setTheme(t.id);
              setOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${
              active ? "bg-primary/10" : "hover:bg-surface-container-low"
            }`}
          >
            <Swatches meta={t} />
            <span className={`flex-1 text-[13px] font-semibold ${active ? "text-primary" : "text-on-surface"}`}>
              {t.name}
            </span>
            {active && (
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>
                check
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  if (variant === "sidebar") {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          title={collapsed ? `Tema: ${meta.name}` : undefined}
          className={`w-full flex items-center rounded-xl text-[13px] font-medium text-on-surface-variant hover:bg-surface-container-low transition-all ${
            collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>palette</span>
          {!collapsed && <span className="flex-1 text-left">Tema</span>}
          {!collapsed && <Swatches meta={meta} />}
        </button>
        {open && panel}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Tema: ${meta.name}`}
        className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-all"
      >
        <span className="material-symbols-outlined">palette</span>
      </button>
      {open && panel}
    </div>
  );
}
