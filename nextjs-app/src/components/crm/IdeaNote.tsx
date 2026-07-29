"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Idea } from "@/lib/api/ideas";

export const NOTE_SIZE = 176; // px (w-44 / h-44)

// Paleta estilo post-it (pasteles).
export const IDEA_COLORS = [
  "#FEF08A", // amarillo
  "#FBCFE8", // rosa
  "#BBF7D0", // verde
  "#BFDBFE", // azul
  "#FED7AA", // naranja
  "#DDD6FE", // morado
];

export const DEFAULT_IDEA_COLOR = IDEA_COLORS[0];

interface IdeaNoteProps {
  note: Idea;
  boundsRef: RefObject<HTMLDivElement | null>;
  editing: boolean;
  onStartEdit: (id: string) => void;
  onEndEdit: (id: string, text: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPersistPosition: (id: string, x: number, y: number) => void;
  onChangeColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onFocus: (id: string) => void;
}

export default function IdeaNote({
  note,
  boundsRef,
  editing,
  onStartEdit,
  onEndEdit,
  onMove,
  onPersistPosition,
  onChangeColor,
  onDelete,
  onFocus,
}: IdeaNoteProps) {
  const [dragging, setDragging] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const offset = useRef({ dx: 0, dy: 0 });
  const posRef = useRef({ x: note.x, y: note.y });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Al entrar en modo edicion, sembrar el borrador con el texto actual y enfocar.
  useEffect(() => {
    if (editing) {
      setDraft(note.text);
      // Enfocar al final del texto en el siguiente frame.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return;
    // No iniciar arrastre desde controles interactivos (botones, textarea…).
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    const bounds = boundsRef.current;
    if (!bounds) return;
    const rect = bounds.getBoundingClientRect();
    offset.current = {
      dx: e.clientX - rect.left - note.x,
      dy: e.clientY - rect.top - note.y,
    };
    posRef.current = { x: note.x, y: note.y };
    setDragging(true);
    setShowColors(false);
    onFocus(note.id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const bounds = boundsRef.current;
    if (!bounds) return;
    const rect = bounds.getBoundingClientRect();
    let nx = e.clientX - rect.left - offset.current.dx;
    let ny = e.clientY - rect.top - offset.current.dy;
    nx = Math.max(0, Math.min(nx, rect.width - NOTE_SIZE));
    ny = Math.max(0, Math.min(ny, rect.height - NOTE_SIZE));
    posRef.current = { x: nx, y: ny };
    onMove(note.id, nx, ny);
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    onPersistPosition(note.id, posRef.current.x, posRef.current.y);
  }

  function commitText() {
    onEndEdit(note.id, draft);
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => !editing && onStartEdit(note.id)}
      className="group absolute select-none rounded-sm shadow-lg"
      style={{
        left: note.x,
        top: note.y,
        width: NOTE_SIZE,
        height: NOTE_SIZE,
        zIndex: dragging ? 9999 : note.z,
        backgroundColor: note.color,
        transform: `rotate(${dragging ? 0 : note.rotation}deg)`,
        transition: dragging ? "none" : "transform 120ms ease, box-shadow 120ms ease",
        cursor: dragging ? "grabbing" : "grab",
        boxShadow: dragging
          ? "0 12px 28px rgba(0,0,0,0.28)"
          : "0 4px 10px rgba(0,0,0,0.18)",
        touchAction: "none",
      }}
    >
      {/* Controles (aparecen al hover) */}
      <div className="absolute -top-2 -right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {/* Color */}
        <button
          data-no-drag
          onClick={() => setShowColors((v) => !v)}
          title="Cambiar color"
          className="w-6 h-6 rounded-full bg-white/90 shadow flex items-center justify-center text-gray-600 hover:text-gray-900"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>palette</span>
        </button>
        {/* Eliminar */}
        <button
          data-no-drag
          onClick={() => onDelete(note.id)}
          title="Eliminar"
          className="w-6 h-6 rounded-full bg-white/90 shadow flex items-center justify-center text-gray-600 hover:text-red-600"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
        </button>
      </div>

      {/* Paleta de colores */}
      {showColors && (
        <div
          data-no-drag
          className="absolute -top-11 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-white rounded-full shadow-lg px-2 py-1.5 z-10"
        >
          {IDEA_COLORS.map((c) => (
            <button
              key={c}
              data-no-drag
              onClick={() => {
                onChangeColor(note.id, c);
                setShowColors(false);
              }}
              title={c}
              className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${
                c === note.color ? "border-gray-700 ring-2 ring-gray-300" : "border-black/10"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}

      {/* Contenido */}
      {editing ? (
        <textarea
          data-no-drag
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.blur();
            }
          }}
          placeholder="Escribe tu idea…"
          className="w-full h-full bg-transparent resize-none border-none outline-none focus:ring-0 p-3 text-[15px] leading-snug text-gray-800 placeholder:text-gray-500/60"
        />
      ) : (
        <div className="w-full h-full p-3 overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-snug text-gray-800">
          {note.text ? (
            note.text
          ) : (
            <span className="text-gray-500/60">Doble clic para editar…</span>
          )}
        </div>
      )}
    </div>
  );
}
