"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/lib/hooks/useAuth";
import LoadingOverlay from "@/components/layout/LoadingOverlay";
import { createIdea, updateIdea, deleteIdea, type Idea } from "@/lib/api/ideas";
import IdeaNote, { DEFAULT_IDEA_COLOR, NOTE_SIZE } from "@/components/ideas/IdeaNote";
import toast from "react-hot-toast";

const BOARD_MAX_H = 4000; // tope de crecimiento vertical del lienzo
const BOARD_PAD = 20;

function mapDoc(id: string, d: Record<string, unknown>): Idea {
  return {
    id,
    text: typeof d.text === "string" ? d.text : "",
    color: typeof d.color === "string" ? d.color : DEFAULT_IDEA_COLOR,
    x: typeof d.x === "number" ? d.x : 40,
    y: typeof d.y === "number" ? d.y : 40,
    w: typeof d.w === "number" ? d.w : NOTE_SIZE,
    h: typeof d.h === "number" ? d.h : NOTE_SIZE,
    rotation: typeof d.rotation === "number" ? d.rotation : 0,
    z: typeof d.z === "number" ? d.z : 1,
  };
}

// Busqueda sin distinguir mayusculas ni acentos.
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export default function IdeasPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [notes, setNotes] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const resizingIdRef = useRef<string | null>(null);
  const newIdRef = useRef<string | null>(null);

  // Pizarra personal: requiere sesion (misma cuenta que el resto de la app).
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?redirect=${encodeURIComponent("/ideas")}`);
    }
  }, [user, authLoading, router]);

  // Lectura en tiempo real desde Firestore (sincroniza entre dispositivos).
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "ideas"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const remote = snap.docs.map((doc) => mapDoc(doc.id, doc.data() as Record<string, unknown>));
        setNotes((prev) => {
          // Conservar posicion/tamano locales de la nota que se esta manipulando.
          const dragId = draggingIdRef.current;
          const sizeId = resizingIdRef.current;
          if (!dragId && !sizeId) return remote;
          return remote.map((n) => {
            const local = prev.find((p) => p.id === n.id);
            if (!local) return n;
            if (n.id === dragId) return { ...n, x: local.x, y: local.y };
            if (n.id === sizeId) return { ...n, w: local.w, h: local.h };
            return n;
          });
        });
        setLoading(false);
        // Nota recien creada: entrar en modo edicion cuando aparezca.
        if (newIdRef.current && remote.some((n) => n.id === newIdRef.current)) {
          setEditingId(newIdRef.current);
          newIdRef.current = null;
        }
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [user]);

  // Medir el viewport del lienzo (para centrar notas nuevas y crecer hacia abajo).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [authLoading, user]);

  // El lienzo crece hacia abajo cuando empujas notas al fondo.
  const contentH = useMemo(() => {
    const needed = notes.reduce((m, n) => Math.max(m, n.y + n.h + 60), 0);
    return Math.min(BOARD_MAX_H, Math.max(viewSize.h, needed));
  }, [notes, viewSize.h]);

  const maxZ = notes.reduce((m, n) => Math.max(m, n.z), 0);

  const q = norm(search.trim());
  const isDimmed = useCallback(
    (n: Idea) => q !== "" && !norm(n.text).includes(q),
    [q]
  );
  const matchCount = q ? notes.filter((n) => !isDimmed(n)).length : notes.length;

  const handleAdd = useCallback(
    async (atX?: number, atY?: number) => {
      const scroller = scrollerRef.current;
      const w = scroller?.clientWidth ?? 800;
      const h = scroller?.clientHeight ?? 600;
      const scrollTop = scroller?.scrollTop ?? 0;
      const rand = (spread: number) => Math.round(Math.random() * spread - spread / 2);
      // Sin coordenadas: centrado en la parte visible del lienzo, con algo de azar.
      let x = atX ?? Math.round(w / 2 - NOTE_SIZE / 2 + rand(140));
      let y = atY ?? Math.round(scrollTop + h / 2.6 + rand(120));
      x = Math.max(0, Math.min(w - NOTE_SIZE - 8, x));
      y = Math.max(0, Math.min(Math.max(contentH, h) - NOTE_SIZE - 8, y));
      const rotation = rand(8); // entre -4 y 4 grados aprox.
      try {
        const id = await createIdea({
          text: "",
          color: DEFAULT_IDEA_COLOR,
          x,
          y,
          w: NOTE_SIZE,
          h: NOTE_SIZE,
          rotation,
          z: maxZ + 1,
        });
        newIdRef.current = id;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al crear la idea");
      }
    },
    [maxZ, contentH]
  );

  // Doble clic en el lienzo vacio crea una nota en ese punto.
  const handleBoardDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      handleAdd(
        Math.round(e.clientX - rect.left - NOTE_SIZE / 2),
        Math.round(e.clientY - rect.top - NOTE_SIZE / 2)
      );
    },
    [handleAdd]
  );

  // Atajo: N crea una nota nueva.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      handleAdd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleAdd]);

  const handleMove = useCallback((id: string, x: number, y: number) => {
    draggingIdRef.current = id;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, []);

  const handlePersistPosition = useCallback((id: string, x: number, y: number) => {
    draggingIdRef.current = null;
    updateIdea(id, { x, y }).catch((err) =>
      toast.error(err instanceof Error ? err.message : "Error al mover")
    );
  }, []);

  const handleResize = useCallback((id: string, w: number, h: number) => {
    resizingIdRef.current = id;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, w, h } : n)));
  }, []);

  const handlePersistSize = useCallback((id: string, w: number, h: number) => {
    resizingIdRef.current = null;
    updateIdea(id, { w, h }).catch((err) =>
      toast.error(err instanceof Error ? err.message : "Error al cambiar el tamaño")
    );
  }, []);

  const handleFocus = useCallback((id: string) => {
    setNotes((prev) => {
      const top = prev.reduce((m, n) => Math.max(m, n.z), 0);
      const current = prev.find((n) => n.id === id);
      if (current && current.z === top) return prev; // ya esta al frente
      const newZ = top + 1;
      updateIdea(id, { z: newZ }).catch(() => {});
      return prev.map((n) => (n.id === id ? { ...n, z: newZ } : n));
    });
  }, []);

  const handleEndEdit = useCallback((id: string, text: string) => {
    setEditingId((cur) => (cur === id ? null : cur));
    setNotes((prev) => {
      const current = prev.find((n) => n.id === id);
      if (current && current.text !== text) {
        updateIdea(id, { text }).catch((err) =>
          toast.error(err instanceof Error ? err.message : "Error al guardar")
        );
      }
      return prev.map((n) => (n.id === id ? { ...n, text } : n));
    });
  }, []);

  const handleChangeColor = useCallback((id: string, color: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, color } : n)));
    updateIdea(id, { color }).catch((err) =>
      toast.error(err instanceof Error ? err.message : "Error al cambiar color")
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setEditingId((cur) => (cur === id ? null : cur));
    deleteIdea(id).catch((err) =>
      toast.error(err instanceof Error ? err.message : "Error al eliminar")
    );
  }, []);

  // Acomodar todas las notas en una cuadricula (orden de lectura actual).
  const handleArrange = useCallback(async () => {
    const scroller = scrollerRef.current;
    if (!scroller || notes.length === 0) return;
    const W = scroller.clientWidth;
    const GAP = 18;
    const sorted = [...notes].sort((a, b) => a.y - b.y || a.x - b.x);
    let cx = BOARD_PAD;
    let cy = BOARD_PAD;
    let rowH = 0;
    const moves: { id: string; x: number; y: number; rotation: number }[] = [];
    for (const n of sorted) {
      if (cx + n.w > W - BOARD_PAD && cx > BOARD_PAD) {
        cx = BOARD_PAD;
        cy += rowH + GAP;
        rowH = 0;
      }
      moves.push({
        id: n.id,
        x: cx,
        y: cy,
        rotation: Math.round(Math.random() * 6 - 3),
      });
      cx += n.w + GAP;
      rowH = Math.max(rowH, n.h);
    }
    setNotes((prev) =>
      prev.map((n) => {
        const m = moves.find((mv) => mv.id === n.id);
        return m ? { ...n, x: m.x, y: m.y, rotation: m.rotation } : n;
      })
    );
    scroller.scrollTo({ top: 0, behavior: "smooth" });
    try {
      await Promise.all(moves.map((m) => updateIdea(m.id, { x: m.x, y: m.y, rotation: m.rotation })));
      toast.success("Pizarra ordenada");
    } catch {
      toast.error("No se pudieron guardar todas las posiciones");
    }
  }, [notes]);

  // Copiar todas las ideas como Markdown (orden de lectura).
  const handleCopyAll = useCallback(async () => {
    const visible = notes.filter((n) => n.text.trim() !== "" && !isDimmed(n));
    if (visible.length === 0) {
      toast("No hay ideas con texto para copiar");
      return;
    }
    const sorted = [...visible].sort((a, b) => a.y - b.y || a.x - b.x);
    const today = new Date().toLocaleDateString("es-MX", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const md =
      `# Ideas — ${today}\n\n` +
      sorted.map((n) => `- ${n.text.trim().replace(/\n/g, "\n  ")}`).join("\n");
    try {
      await navigator.clipboard.writeText(md);
      toast.success(`${sorted.length} idea${sorted.length === 1 ? "" : "s"} copiada${sorted.length === 1 ? "" : "s"} como Markdown`);
    } catch {
      toast.error("No se pudo copiar al portapapeles");
    }
  }, [notes, isDimmed]);

  if (authLoading || !user) {
    return <LoadingOverlay />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header / toolbar */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-6 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3 mr-auto">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ backgroundColor: DEFAULT_IDEA_COLOR, transform: "rotate(-4deg)" }}
          >
            <span className="material-symbols-outlined text-gray-800" style={{ fontSize: 20 }}>
              sticky_note_2
            </span>
          </div>
          <div>
            <h1 className="text-xl font-bold font-headline text-on-surface leading-tight">Ideas</h1>
            <p className="text-xs text-on-surface-variant">
              {q
                ? `${matchCount} de ${notes.length} nota${notes.length === 1 ? "" : "s"}`
                : `${notes.length} nota${notes.length === 1 ? "" : "s"} · tu pizarra personal`}
            </p>
          </div>
        </div>

        {/* Buscador */}
        <div className="relative order-3 w-full sm:order-none sm:w-56 md:w-64">
          <span
            className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
            style={{ fontSize: 18 }}
          >
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar en tus ideas…"
            className="w-full bg-surface-container-low border border-outline-variant/30 rounded-full pl-9 pr-8 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:border-primary/50 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
              title="Limpiar busqueda"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          )}
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleArrange}
            disabled={notes.length === 0}
            title="Acomodar todas las notas en cuadricula"
            className="h-9 px-3 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low text-sm font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>grid_view</span>
            <span className="hidden md:inline">Ordenar</span>
          </button>
          <button
            onClick={handleCopyAll}
            disabled={notes.length === 0}
            title="Copiar todas las ideas como Markdown"
            className="h-9 px-3 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low text-sm font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>content_copy</span>
            <span className="hidden md:inline">Copiar</span>
          </button>
          <button
            onClick={() => handleAdd()}
            title="Nueva idea (atajo: N)"
            className="h-9 bg-primary text-on-primary px-4 rounded-full text-sm font-bold flex items-center gap-1.5 hover:opacity-90 transition-all shadow-sm"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            <span className="hidden sm:inline">Nueva idea</span>
          </button>
        </div>
      </header>

      {/* Lienzo (scrollea hacia abajo cuando empujas notas al fondo) */}
      <div
        ref={scrollerRef}
        className="relative flex-1 mx-3 md:mx-6 mb-3 md:mb-6 rounded-2xl border border-outline-variant/20 overflow-y-auto overflow-x-hidden bg-surface-container-lowest"
      >
        <div
          ref={boardRef}
          onDoubleClick={handleBoardDoubleClick}
          className="ideas-board relative w-full"
          style={{ height: contentH || "100%" }}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : notes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
              <div
                className="w-24 h-24 rounded-md shadow-lg flex items-center justify-center mb-5"
                style={{ backgroundColor: DEFAULT_IDEA_COLOR, transform: "rotate(-5deg)" }}
              >
                <span className="material-symbols-outlined text-gray-700/60" style={{ fontSize: 44 }}>
                  lightbulb
                </span>
              </div>
              <p className="text-base font-semibold text-on-surface mb-1">Tu pizarra esta vacia</p>
              <p className="text-sm text-on-surface-variant max-w-xs">
                Toca <span className="font-semibold">“Nueva idea”</span>, pulsa{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-surface-container text-xs font-bold">N</kbd> o haz doble
                clic en cualquier parte del lienzo.
              </p>
            </div>
          ) : (
            notes.map((note) => (
              <IdeaNote
                key={note.id}
                note={note}
                boundsRef={boardRef}
                editing={editingId === note.id}
                dimmed={isDimmed(note)}
                onStartEdit={setEditingId}
                onEndEdit={handleEndEdit}
                onMove={handleMove}
                onPersistPosition={handlePersistPosition}
                onResize={handleResize}
                onPersistSize={handlePersistSize}
                onChangeColor={handleChangeColor}
                onDelete={handleDelete}
                onFocus={handleFocus}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
