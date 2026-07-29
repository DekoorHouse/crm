"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Idea } from "@/lib/api/ideas";

export const NOTE_SIZE = 176; // px — tamaño inicial de una nota
export const MIN_NOTE_SIZE = 150;
export const MAX_NOTE_SIZE = 520;

// Paleta estilo post-it (pasteles).
export const IDEA_COLORS = [
  "#FEF08A", // amarillo
  "#FED7AA", // naranja
  "#FBCFE8", // rosa
  "#FECACA", // rojo suave
  "#BBF7D0", // verde
  "#99F6E4", // turquesa
  "#BFDBFE", // azul
  "#DDD6FE", // lila
];

export const DEFAULT_IDEA_COLOR = IDEA_COLORS[0];

interface IdeaNoteProps {
  note: Idea;
  boundsRef: RefObject<HTMLDivElement | null>;
  editing: boolean;
  dimmed: boolean;
  onStartEdit: (id: string) => void;
  onEndEdit: (id: string, text: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPersistPosition: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onPersistSize: (id: string, w: number, h: number) => void;
  onChangeColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onFocus: (id: string) => void;
}

export default function IdeaNote({
  note,
  boundsRef,
  editing,
  dimmed,
  onStartEdit,
  onEndEdit,
  onMove,
  onPersistPosition,
  onResize,
  onPersistSize,
  onChangeColor,
  onDelete,
  onFocus,
}: IdeaNoteProps) {
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const offset = useRef({ dx: 0, dy: 0 });
  const posRef = useRef({ x: note.x, y: note.y });
  const sizeRef = useRef({ w: note.w, h: note.h });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Al entrar en modo edicion, sembrar el borrador con el texto actual y enfocar.
  useEffect(() => {
    if (editing) {
      setDraft(note.text);
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

  // Limpiar el timer del borrado armado al desmontar.
  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    };
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return;
    // No iniciar arrastre desde controles interactivos (botones, textarea, grip…).
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
    nx = Math.max(0, Math.min(nx, rect.width - note.w));
    ny = Math.max(0, Math.min(ny, rect.height - note.h));
    posRef.current = { x: nx, y: ny };
    onMove(note.id, nx, ny);
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    onPersistPosition(note.id, posRef.current.x, posRef.current.y);
  }

  // --- Resize desde el doblez de la esquina inferior derecha ---
  function handleResizeDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return;
    e.stopPropagation();
    sizeRef.current = { w: note.w, h: note.h };
    setResizing(true);
    setShowColors(false);
    onFocus(note.id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing) return;
    const bounds = boundsRef.current;
    if (!bounds) return;
    const rect = bounds.getBoundingClientRect();
    let w = e.clientX - rect.left - note.x;
    let h = e.clientY - rect.top - note.y;
    w = Math.max(MIN_NOTE_SIZE, Math.min(w, MAX_NOTE_SIZE, rect.width - note.x));
    h = Math.max(MIN_NOTE_SIZE, Math.min(h, MAX_NOTE_SIZE, rect.height - note.y));
    w = Math.round(w);
    h = Math.round(h);
    sizeRef.current = { w, h };
    onResize(note.id, w, h);
  }

  function handleResizeUp() {
    if (!resizing) return;
    setResizing(false);
    onPersistSize(note.id, sizeRef.current.w, sizeRef.current.h);
  }

  function commitText() {
    onEndEdit(note.id, draft);
  }

  function handleDeleteClick() {
    if (!armedDelete) {
      setArmedDelete(true);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedDelete(false), 2500);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    onDelete(note.id);
  }

  const interacting = dragging || resizing;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => !editing && onStartEdit(note.id)}
      className="group absolute select-none rounded-[3px]"
      style={{
        left: note.x,
        top: note.y,
        width: note.w,
        height: note.h,
        zIndex: interacting ? 9999 : note.z,
        transform: `rotate(${interacting || editing ? 0 : note.rotation}deg) scale(${
          dragging ? 1.04 : 1
        })`,
        transition: interacting
          ? "opacity 150ms ease"
          : "transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease",
        cursor: dragging ? "grabbing" : "grab",
        boxShadow: interacting
          ? "0 18px 36px rgba(0,0,0,0.30), 0 4px 10px rgba(0,0,0,0.16)"
          : "0 6px 14px rgba(0,0,0,0.16), 0 1px 3px rgba(0,0,0,0.10)",
        touchAction: "none",
        opacity: dimmed ? 0.18 : 1,
        filter: dimmed ? "saturate(0.4)" : undefined,
      }}
    >
      {/* Papel: color + brillo + doblez */}
      <div
        className="idea-paper idea-fold absolute inset-0 rounded-[3px] pointer-events-none"
        style={{ backgroundColor: note.color }}
      />

      {/* Controles (aparecen al hover; siempre visibles en pantallas táctiles).
          z-20: por encima del contenido de la nota, si no el texto tapa los taps. */}
      <div className="absolute -top-2.5 -right-2.5 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
        {/* Color */}
        <button
          data-no-drag
          onClick={() => {
            setShowColors((v) => !v);
            setArmedDelete(false);
          }}
          title="Cambiar color"
          className="w-7 h-7 rounded-full bg-white/95 shadow flex items-center justify-center text-gray-600 hover:text-gray-900"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>palette</span>
        </button>
        {/* Eliminar: primer clic arma, segundo confirma */}
        <button
          data-no-drag
          onClick={handleDeleteClick}
          title={armedDelete ? "Clic de nuevo para borrar" : "Eliminar"}
          className={`h-7 rounded-full shadow flex items-center justify-center transition-all ${
            armedDelete
              ? "bg-red-500 text-white px-2 gap-0.5"
              : "w-7 bg-white/95 text-gray-600 hover:text-red-600"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {armedDelete ? "delete_forever" : "close"}
          </span>
          {armedDelete && <span className="text-[10px] font-bold leading-none">¿Borrar?</span>}
        </button>
      </div>

      {/* Paleta de colores (debajo de los botones si la nota esta pegada al borde superior) */}
      {showColors && (
        <div
          data-no-drag
          className={`absolute left-1/2 -translate-x-1/2 grid grid-cols-4 gap-2 bg-white rounded-2xl shadow-lg px-3 py-2.5 z-30 ${
            note.y < 64 ? "top-8" : "-top-14"
          }`}
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
              className={`w-6 h-6 rounded-full border transition-transform hover:scale-110 ${
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
          className="relative w-full h-full bg-transparent resize-none border-none outline-none focus:ring-0 p-3.5 font-note font-medium text-[21px] leading-[1.3] text-gray-800 placeholder:text-gray-600/50"
        />
      ) : (
        <div className="relative w-full h-full p-3.5 overflow-hidden whitespace-pre-wrap break-words font-note font-medium text-[21px] leading-[1.3] text-gray-800">
          {note.text ? (
            note.text
          ) : (
            <span className="text-gray-600/50">Doble clic para editar…</span>
          )}
        </div>
      )}

      {/* Grip de resize sobre el doblez (esquina inferior derecha) */}
      {!editing && (
        <div
          data-no-drag
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
          title="Arrastra para cambiar el tamaño"
          className="absolute bottom-0 right-0 w-7 h-7"
          style={{ cursor: "nwse-resize", touchAction: "none" }}
        />
      )}
    </div>
  );
}
