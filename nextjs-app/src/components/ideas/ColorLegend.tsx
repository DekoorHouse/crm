"use client";

import { useState } from "react";
import { IDEA_COLORS } from "@/components/ideas/IdeaNote";

interface ColorLegendProps {
  /** Etiquetas por color hex, p. ej. { "#FEF08A": "Negocio" }. */
  legend: Record<string, string>;
  /** Cuántas notas hay de cada color. */
  counts: Record<string, number>;
  /** Color activo como filtro, o null. */
  activeColor: string | null;
  onToggleFilter: (hex: string) => void;
  onRename: (hex: string, label: string) => void;
}

/**
 * Categorías del mural: botón que abre una lista vertical de colores.
 * - Tocar una fila filtra el mural por ese color (tocarla de nuevo quita el filtro).
 * - El lápiz permite nombrar cada color inline.
 */
export default function ColorLegend({ legend, counts, activeColor, onToggleFilter, onRename }: ColorLegendProps) {
  const [open, setOpen] = useState(false);
  const [editingHex, setEditingHex] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(hex: string) {
    setEditingHex(hex);
    setDraft(legend[hex] || "");
  }

  function commit(hex: string) {
    setEditingHex(null);
    const label = draft.trim();
    if (label !== (legend[hex] || "")) onRename(hex, label);
  }

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Categorías por color"
        className={`h-8 pl-2.5 pr-3 rounded-full border flex items-center gap-1.5 text-xs font-bold transition-all ${
          activeColor
            ? "border-primary/60 bg-primary/10 text-on-surface"
            : "border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
        }`}
      >
        {activeColor ? (
          <span
            className="w-4 h-4 rounded-full border border-black/10 flex-shrink-0"
            style={{ backgroundColor: activeColor }}
          />
        ) : (
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>category</span>
        )}
        <span className="max-w-24 truncate">
          {activeColor ? legend[activeColor] || "Filtrando" : "Categorías"}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
          {open ? "expand_more" : "expand_less"}
        </span>
      </button>

      {open && (
        <>
          {/* Backdrop para cerrar al tocar fuera */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Lista de categorías (abre hacia arriba) */}
          <div className="absolute bottom-10 left-0 z-50 w-64 bg-surface-container-lowest border border-outline-variant/25 rounded-2xl shadow-xl py-1.5 max-h-80 overflow-y-auto">
            {IDEA_COLORS.map((hex) => {
              const label = legend[hex] || "";
              const active = activeColor === hex;
              const editing = editingHex === hex;
              const count = counts[hex] || 0;
              return (
                <div
                  key={hex}
                  onClick={() => {
                    if (!editing) onToggleFilter(hex);
                  }}
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                    active ? "bg-primary/10" : "hover:bg-surface-container-low"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full border border-black/10 flex-shrink-0 ${
                      active ? "ring-2 ring-primary/50" : ""
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                  {editing ? (
                    <input
                      autoFocus
                      value={draft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(hex)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditingHex(null);
                      }}
                      placeholder="nombre de la categoría…"
                      maxLength={30}
                      className="flex-1 min-w-0 bg-transparent text-sm text-on-surface outline-none border-b border-primary/40"
                    />
                  ) : (
                    <span
                      className={`flex-1 min-w-0 truncate text-sm ${
                        label ? "text-on-surface font-medium" : "text-on-surface-variant/50"
                      }`}
                    >
                      {label || "Sin nombre"}
                    </span>
                  )}
                  {count > 0 && !editing && (
                    <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container rounded-full px-1.5 py-0.5 flex-shrink-0">
                      {count}
                    </span>
                  )}
                  {!editing && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(hex);
                      }}
                      title="Nombrar esta categoría"
                      className="p-1 rounded-lg text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container flex-shrink-0"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>edit</span>
                    </button>
                  )}
                </div>
              );
            })}
            {activeColor && (
              <button
                onClick={() => onToggleFilter(activeColor)}
                className="w-full text-center text-xs font-bold text-primary py-2 hover:bg-surface-container-low transition-colors"
              >
                Quitar filtro
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
