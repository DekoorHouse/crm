"use client";

import { useState } from "react";
import { IDEA_COLORS } from "@/components/ideas/IdeaNote";

interface ColorLegendProps {
  /** Etiquetas por color hex, p. ej. { "#FEF08A": "Negocio" }. */
  legend: Record<string, string>;
  /** Color activo como filtro, o null. */
  activeColor: string | null;
  onToggleFilter: (hex: string) => void;
  onRename: (hex: string, label: string) => void;
}

/**
 * Leyenda de colores: cada color puede tener un significado propio.
 * - Tocar el circulo filtra el mural por ese color.
 * - Tocar el texto (o "…") permite nombrarlo inline.
 */
export default function ColorLegend({ legend, activeColor, onToggleFilter, onRename }: ColorLegendProps) {
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
    <div className="ideas-legend flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0">
      {IDEA_COLORS.map((hex) => {
        const label = legend[hex] || "";
        const active = activeColor === hex;
        const editing = editingHex === hex;
        return (
          <div
            key={hex}
            className={`flex items-center gap-1.5 rounded-full border pl-1 pr-2 py-1 flex-shrink-0 transition-all ${
              active
                ? "border-primary/60 bg-primary/10"
                : "border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low"
            }`}
          >
            <button
              onClick={() => onToggleFilter(hex)}
              title={active ? "Quitar filtro" : `Ver solo ${label || "este color"}`}
              className={`w-5 h-5 rounded-full border border-black/10 flex-shrink-0 transition-transform hover:scale-110 ${
                active ? "ring-2 ring-primary/50" : ""
              }`}
              style={{ backgroundColor: hex }}
            />
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(hex)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingHex(null);
                }}
                placeholder="nombre…"
                maxLength={30}
                className="w-20 bg-transparent text-xs text-on-surface outline-none border-b border-primary/40"
              />
            ) : (
              <button
                onClick={() => startEdit(hex)}
                title="Tocar para nombrar este color"
                className={`text-xs whitespace-nowrap ${
                  label ? "text-on-surface font-medium" : "text-on-surface-variant/50"
                }`}
              >
                {label || "…"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
