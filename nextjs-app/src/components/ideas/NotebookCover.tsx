"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import CoverArt from "@/components/ideas/covers";
import type { Notebook } from "@/lib/api/notebooks";

export const NB_W = 168; // ancho de la libreta en el escritorio
export const NB_H = 224; // alto (proporcion ~3:4)

interface NotebookCoverProps {
  notebook: Notebook;
  boundsRef: RefObject<HTMLDivElement | null>;
  /** Zoom del escritorio: los eventos llegan en px de pantalla. */
  zoom: number;
  dimmed: boolean;
  selected: boolean;
  /** Dias sin abrir, cuando es la libreta mas olvidada; null si no aplica. */
  echoDays: number | null;
  justBorn: boolean;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPersistPosition: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  onFocus: (id: string) => void;
}

export default function NotebookCover({
  notebook,
  boundsRef,
  zoom,
  dimmed,
  selected,
  echoDays,
  justBorn,
  onOpen,
  onSelect,
  onMove,
  onPersistPosition,
  onDelete,
  onFocus,
}: NotebookCoverProps) {
  const [dragging, setDragging] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const offset = useRef({ dx: 0, dy: 0 });
  const posRef = useRef({ x: notebook.x, y: notebook.y });
  const movedRef = useRef(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!selected) setArmedDelete(false);
  }, [selected]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    const bounds = boundsRef.current;
    if (!bounds) return;
    const rect = bounds.getBoundingClientRect();
    offset.current = {
      dx: (e.clientX - rect.left) / zoom - notebook.x,
      dy: (e.clientY - rect.top) / zoom - notebook.y,
    };
    posRef.current = { x: notebook.x, y: notebook.y };
    movedRef.current = false;
    setDragging(true);
    onFocus(notebook.id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const bounds = boundsRef.current;
    if (!bounds) return;
    const rect = bounds.getBoundingClientRect();
    let nx = (e.clientX - rect.left) / zoom - offset.current.dx;
    let ny = (e.clientY - rect.top) / zoom - offset.current.dy;
    nx = Math.max(0, Math.min(nx, rect.width / zoom - NB_W));
    ny = Math.max(0, Math.min(ny, rect.height / zoom - NB_H));
    if (Math.abs(nx - posRef.current.x) > 3 || Math.abs(ny - posRef.current.y) > 3) {
      movedRef.current = true;
    }
    posRef.current = { x: nx, y: ny };
    onMove(notebook.id, nx, ny);
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (movedRef.current) {
      onPersistPosition(notebook.id, posRef.current.x, posRef.current.y);
    } else {
      // Toque sin arrastre: seleccionar (los controles aparecen en la selección).
      onSelect(notebook.id);
    }
  }

  function handleDeleteClick() {
    if (!armedDelete) {
      setArmedDelete(true);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedDelete(false), 2600);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    onDelete(notebook.id);
  }

  const hojas = notebook.pageCount || 1;

  return (
    <div
      data-notebook=""
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => onOpen(notebook.id)}
      className={`group absolute select-none ${justBorn ? "idea-pop" : ""} ${
        echoDays !== null && !dragging ? "idea-echo" : ""
      }`}
      style={{
        left: notebook.x,
        top: notebook.y,
        width: NB_W,
        height: NB_H,
        zIndex: dragging ? 9999 : notebook.z,
        transform: `rotate(${dragging ? 0 : notebook.rotation}deg) scale(${dragging ? 1.05 : 1})`,
        transition: dragging
          ? "opacity 150ms ease"
          : "transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease",
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
        opacity: dimmed ? 0.2 : 1,
        filter: dimmed ? "saturate(0.35)" : undefined,
      }}
    >
      {/* Cuerpo de la libreta: hojas apiladas detrás + portada */}
      <div className="relative w-full h-full">
        {/* Canto de las hojas */}
        <div
          className="absolute rounded-r-[3px] bg-[#F3EFE6]"
          style={{ top: "1.5%", left: "2.5%", right: "-1.8%", bottom: "1.2%", boxShadow: "0 2px 6px rgba(0,0,0,0.12)" }}
        />
        <div
          className="absolute rounded-r-[3px] bg-[#FBF8F1]"
          style={{ top: "0.8%", left: "1.5%", right: "-0.9%", bottom: "0.6%" }}
        />
        {/* Portada */}
        <div
          className="absolute inset-0 rounded-[4px] overflow-hidden"
          style={{
            boxShadow: dragging
              ? "0 20px 40px rgba(0,0,0,0.34), 0 5px 12px rgba(0,0,0,0.2)"
              : "0 8px 18px rgba(0,0,0,0.20), 0 2px 5px rgba(0,0,0,0.12)",
            outline: selected ? "2px solid var(--color-primary)" : "none",
            outlineOffset: 3,
          }}
        >
          <CoverArt
            cover={notebook.cover}
            title={notebook.title}
            subtitle={`${hojas} hoja${hojas === 1 ? "" : "s"}`}
          />
        </div>
      </div>

      {/* Chip de libreta olvidada */}
      {echoDays !== null && (
        <div className="absolute -bottom-2.5 left-3 z-20 bg-white/95 rounded-full shadow px-2 py-0.5 text-[10px] font-bold text-gray-600 pointer-events-none">
          💤 hace {echoDays} día{echoDays === 1 ? "" : "s"}
        </div>
      )}

      {/* Controles: al seleccionar (touch) o al hover (desktop) */}
      <div
        className={`absolute -top-2.5 -right-2.5 z-20 flex items-center gap-1 transition-opacity ${
          selected
            ? "opacity-100"
            : "opacity-0 pointer-events-none pointer-fine:group-hover:opacity-100 pointer-fine:group-hover:pointer-events-auto"
        }`}
      >
        <button
          data-no-drag
          onClick={() => onOpen(notebook.id)}
          title="Abrir libreta"
          className="h-7 px-2.5 rounded-full bg-primary text-on-primary shadow flex items-center gap-1 text-[11px] font-bold"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>menu_book</span>
          Abrir
        </button>
        <button
          data-no-drag
          onClick={handleDeleteClick}
          title={armedDelete ? "Toca de nuevo para borrar la libreta" : "Eliminar libreta"}
          className={`h-7 rounded-full shadow flex items-center justify-center transition-all ${
            armedDelete ? "bg-red-500 text-white px-2 gap-0.5" : "w-7 bg-white/95 text-gray-600 hover:text-red-600"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {armedDelete ? "delete_forever" : "close"}
          </span>
          {armedDelete && <span className="text-[10px] font-bold leading-none">¿Borrar?</span>}
        </button>
      </div>
    </div>
  );
}
