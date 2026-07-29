"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { createIdea, updateIdea, deleteIdea, type Idea } from "@/lib/api/ideas";
import IdeaNote, { DEFAULT_IDEA_COLOR, NOTE_SIZE } from "@/components/crm/IdeaNote";
import toast from "react-hot-toast";

function mapDoc(id: string, d: Record<string, unknown>): Idea {
  return {
    id,
    text: typeof d.text === "string" ? d.text : "",
    color: typeof d.color === "string" ? d.color : DEFAULT_IDEA_COLOR,
    x: typeof d.x === "number" ? d.x : 40,
    y: typeof d.y === "number" ? d.y : 40,
    rotation: typeof d.rotation === "number" ? d.rotation : 0,
    z: typeof d.z === "number" ? d.z : 1,
  };
}

export default function IdeasPage() {
  const [notes, setNotes] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const newIdRef = useRef<string | null>(null);

  // Lectura en tiempo real desde Firestore (sincroniza entre dispositivos).
  useEffect(() => {
    const q = query(collection(db, "crm_ideas"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const remote = snap.docs.map((doc) => mapDoc(doc.id, doc.data() as Record<string, unknown>));
        setNotes((prev) => {
          const dragId = draggingIdRef.current;
          if (!dragId) return remote;
          // Conservar la posicion local de la nota que se esta arrastrando.
          const local = prev.find((n) => n.id === dragId);
          if (!local) return remote;
          return remote.map((n) => (n.id === dragId ? { ...n, x: local.x, y: local.y } : n));
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
  }, []);

  const maxZ = notes.reduce((m, n) => Math.max(m, n.z), 0);

  const handleAdd = useCallback(async () => {
    const board = boardRef.current;
    const w = board?.clientWidth ?? 800;
    const h = board?.clientHeight ?? 600;
    const rand = (spread: number) => Math.round(Math.random() * spread - spread / 2);
    const x = Math.max(0, Math.min(w - NOTE_SIZE, Math.round(w / 2 - NOTE_SIZE / 2 + rand(120))));
    const y = Math.max(0, Math.min(h - NOTE_SIZE, Math.round(h / 3 + rand(120))));
    const rotation = rand(8); // entre -4 y 4 grados aprox.
    try {
      const id = await createIdea({ text: "", color: DEFAULT_IDEA_COLOR, x, y, rotation, z: maxZ + 1 });
      newIdRef.current = id;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear la idea");
    }
  }, [maxZ]);

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

  const handleFocus = useCallback(
    (id: string) => {
      draggingIdRef.current = id;
      setNotes((prev) => {
        const top = prev.reduce((m, n) => Math.max(m, n.z), 0);
        const current = prev.find((n) => n.id === id);
        if (current && current.z === top) return prev; // ya esta al frente
        const newZ = top + 1;
        updateIdea(id, { z: newZ }).catch(() => {});
        return prev.map((n) => (n.id === id ? { ...n, z: newZ } : n));
      });
    },
    []
  );

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
    if (!confirm("¿Eliminar esta idea?")) return;
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setEditingId((cur) => (cur === id ? null : cur));
    deleteIdea(id).catch((err) =>
      toast.error(err instanceof Error ? err.message : "Error al eliminar")
    );
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pr-6 md:pr-8 pt-5 pb-3 pl-16 md:pl-8 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold font-headline text-on-surface">Ideas</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Pizarra libre de post-its. Doble clic para editar, arrastra para mover.
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="bg-primary text-on-primary px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-all flex-shrink-0"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Nueva idea
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={boardRef}
        className="relative flex-1 mx-4 md:mx-6 mb-4 md:mb-6 rounded-2xl border border-outline-variant/15 overflow-hidden bg-surface-container-lowest"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/25 mb-2">
              sticky_note_2
            </span>
            <p className="text-sm text-on-surface-variant/70">
              Aun no hay ideas. Toca <span className="font-semibold">“Nueva idea”</span> para empezar.
            </p>
          </div>
        ) : (
          notes.map((note) => (
            <IdeaNote
              key={note.id}
              note={note}
              boundsRef={boardRef}
              editing={editingId === note.id}
              onStartEdit={setEditingId}
              onEndEdit={handleEndEdit}
              onMove={handleMove}
              onPersistPosition={handlePersistPosition}
              onChangeColor={handleChangeColor}
              onDelete={handleDelete}
              onFocus={handleFocus}
            />
          ))
        )}
      </div>
    </div>
  );
}
