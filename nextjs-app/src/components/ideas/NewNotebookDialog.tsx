"use client";

import { useEffect, useState } from "react";
import CoverArt, { COVERS, DEFAULT_COVER } from "@/components/ideas/covers";

interface NewNotebookDialogProps {
  open: boolean;
  saving: boolean;
  onCancel: () => void;
  onCreate: (title: string, cover: string) => void;
}

/** Diálogo para crear una libreta: título + elección de portada. */
export default function NewNotebookDialog({ open, saving, onCancel, onCreate }: NewNotebookDialogProps) {
  const [title, setTitle] = useState("");
  const [cover, setCover] = useState(DEFAULT_COVER);

  // Cada vez que se abre, empezar limpio.
  useEffect(() => {
    if (open) {
      setTitle("");
      setCover(DEFAULT_COVER);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const puedeCrear = title.trim().length > 0 && !saving;

  return (
    <div className="fixed inset-0 z-[130] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      <div className="relative w-full md:w-[560px] max-h-[92dvh] bg-surface-container-lowest rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Encabezado */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-outline-variant/15 flex-shrink-0">
          <h2 className="flex-1 text-lg font-bold font-headline text-on-surface">Nueva libreta</h2>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low"
            title="Cancelar"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Vista previa + título */}
          <div className="flex gap-4 items-center mb-5">
            <div className="w-[104px] h-[139px] rounded-[4px] overflow-hidden shadow-lg flex-shrink-0">
              <CoverArt cover={cover} title={title || "Tu tema"} />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 mb-1.5">
                ¿De qué trata?
              </label>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && puedeCrear) onCreate(title.trim(), cover);
                }}
                placeholder="Ej. Productos nuevos"
                maxLength={60}
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:border-primary/50 transition-colors"
              />
              <p className="text-[11px] text-on-surface-variant/70 mt-2 leading-snug">
                Cada libreta es un tema. El título va impreso en la portada.
              </p>
            </div>
          </div>

          {/* Portadas */}
          <p className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 mb-2">
            Elige la portada
          </p>
          <div className="grid grid-cols-4 gap-3">
            {COVERS.map((c) => (
              <button
                key={c.id}
                onClick={() => setCover(c.id)}
                title={c.name}
                className="group text-left"
              >
                <div
                  className={`aspect-3/4 rounded-[3px] overflow-hidden transition-all ${
                    cover === c.id
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest shadow-lg"
                      : "shadow group-hover:shadow-md group-hover:-translate-y-0.5"
                  }`}
                >
                  <CoverArt cover={c.id} hideTitle />
                </div>
                <span
                  className={`block text-[10px] mt-1 truncate ${
                    cover === c.id ? "text-primary font-bold" : "text-on-surface-variant"
                  }`}
                >
                  {c.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Acciones */}
        <div
          className="flex items-center gap-2 px-5 pt-3 border-t border-outline-variant/15 flex-shrink-0"
          style={{ paddingBottom: "max(0.85rem, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={onCancel}
            className="flex-1 h-11 rounded-full border border-outline-variant/40 text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => puedeCrear && onCreate(title.trim(), cover)}
            disabled={!puedeCrear}
            className="flex-1 h-11 rounded-full bg-primary text-on-primary text-sm font-bold flex items-center justify-center gap-1.5 hover:opacity-90 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {saving ? (
              <span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>auto_stories</span>
            )}
            Crear libreta
          </button>
        </div>
      </div>
    </div>
  );
}
