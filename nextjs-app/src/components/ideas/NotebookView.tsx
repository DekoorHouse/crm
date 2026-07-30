"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import CoverArt from "@/components/ideas/covers";
import {
  addPage,
  deletePage,
  desarrollarHoja,
  updateNotebook,
  updatePage,
  type Notebook,
  type Page,
} from "@/lib/api/notebooks";
import toast from "react-hot-toast";

/** Tintas disponibles para escribir. */
export const INKS = [
  { hex: "#1E3A8A", name: "Azul" },
  { hex: "#1F2937", name: "Negro" },
  { hex: "#B91C1C", name: "Rojo" },
  { hex: "#166534", name: "Verde" },
  { hex: "#6B21A8", name: "Morado" },
  { hex: "#0E7490", name: "Turquesa" },
];

export const DEFAULT_INK = INKS[0].hex;

const AUTOSAVE_MS = 1200;

function mapPage(id: string, d: Record<string, unknown>): Page {
  const written = d.writtenAt as { toMillis?: () => number } | undefined;
  return {
    id,
    text: typeof d.text === "string" ? d.text : "",
    ink: typeof d.ink === "string" ? d.ink : DEFAULT_INK,
    order: typeof d.order === "number" ? d.order : 1,
    writtenAtMs: written && typeof written.toMillis === "function" ? written.toMillis() : undefined,
  };
}

function formatWritten(ms: number): string {
  const d = new Date(ms);
  const fecha = d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  const hora = d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  return `${fecha} · ${hora}`;
}

interface NotebookViewProps {
  notebook: Notebook;
  onClose: () => void;
}

export default function NotebookView({ notebook, onClose }: NotebookViewProps) {
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [ink, setInk] = useState(DEFAULT_INK);
  const [inkOpen, setInkOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(notebook.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [developing, setDeveloping] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [localWrittenMs, setLocalWrittenMs] = useState<number | null>(null);

  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const draftRef = useRef("");
  const pageIdRef = useRef<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const page = pages[index];

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setSpeechOk(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // Hojas en tiempo real.
  useEffect(() => {
    const q = query(collection(db, "notebooks", notebook.id, "pages"), orderBy("order", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const remote = snap.docs.map((d) => mapPage(d.id, d.data() as Record<string, unknown>));
        setPages(remote);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [notebook.id]);

  // Al cambiar de hoja, cargar su texto y su tinta (sin pisar lo que estas escribiendo).
  useEffect(() => {
    if (!page) return;
    if (pageIdRef.current === page.id) return;
    pageIdRef.current = page.id;
    setDraft(page.text);
    draftRef.current = page.text;
    setInk(page.ink);
    setLocalWrittenMs(null);
    dirtyRef.current = false;
  }, [page]);

  // Guardado: se dispara solo al dejar de escribir y al salir de la hoja.
  const flush = useCallback(async () => {
    if (!dirtyRef.current || !pageIdRef.current) return;
    const id = pageIdRef.current;
    const text = draftRef.current;
    dirtyRef.current = false;
    try {
      await updatePage(notebook.id, id, { text });
      setSavedAt(Date.now());
    } catch {
      dirtyRef.current = true;
      toast.error("No se pudo guardar la hoja");
    }
  }, [notebook.id]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  // Guardar al desmontar (cerrar la libreta).
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void flush();
      recognitionRef.current?.stop();
    };
  }, [flush]);

  function handleChange(value: string) {
    setDraft(value);
    draftRef.current = value;
    dirtyRef.current = true;
    // La fecha/hora aparece en cuanto empiezas a escribir.
    if (value.trim() && !page?.writtenAtMs && localWrittenMs === null) {
      setLocalWrittenMs(Date.now());
    }
    scheduleSave();
  }

  const goTo = useCallback(
    async (next: number) => {
      if (next < 0 || next >= pages.length || next === index) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await flush();
      setIndex(next);
    },
    [pages.length, index, flush]
  );

  const handleAddPage = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await flush();
    try {
      await addPage(notebook.id, ink);
      // El listener trae la hoja nueva al final; nos movemos ahí.
      setIndex(pages.length);
      requestAnimationFrame(() => textRef.current?.focus());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo agregar la hoja");
    }
  }, [notebook.id, ink, pages.length, flush]);

  const handleDeletePage = useCallback(async () => {
    if (!page) return;
    if (!confirm("¿Arrancar esta hoja de la libreta?")) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dirtyRef.current = false;
    try {
      await deletePage(notebook.id, page.id);
      pageIdRef.current = null;
      setIndex((i) => Math.max(0, Math.min(i, pages.length - 2)));
      toast.success("Hoja arrancada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo borrar la hoja");
    }
  }, [notebook.id, page, pages.length]);

  const handleInk = useCallback(
    (hex: string) => {
      setInk(hex);
      setInkOpen(false);
      if (page) updatePage(notebook.id, page.id, { ink: hex }).catch(() => {});
    },
    [notebook.id, page]
  );

  const handleTitleCommit = useCallback(() => {
    setEditingTitle(false);
    const t = titleDraft.trim();
    if (t && t !== notebook.title) {
      updateNotebook(notebook.id, { title: t }).catch(() => toast.error("No se pudo cambiar el título"));
    } else if (!t) {
      setTitleDraft(notebook.title);
    }
  }, [titleDraft, notebook.id, notebook.title]);

  const handleDevelop = useCallback(async () => {
    if (!page || developing) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await flush();
    setDeveloping(true);
    try {
      const pasos = await desarrollarHoja(notebook.id, page.id);
      pageIdRef.current = null; // deja que el listener recargue el texto nuevo
      toast.success(`✨ ${pasos.length} pasos agregados`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo desarrollar");
    } finally {
      setDeveloping(false);
    }
  }, [notebook.id, page, developing, flush]);

  // Dictado por voz sobre la hoja actual.
  const handleDictate = useCallback(() => {
    if (dictating) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const SR = (w.SpeechRecognition || w.webkitSpeechRecognition) as
      | (new () => {
          lang: string;
          continuous: boolean;
          interimResults: boolean;
          onresult: ((e: unknown) => void) | null;
          onend: (() => void) | null;
          onerror: (() => void) | null;
          start: () => void;
          stop: () => void;
        })
      | undefined;
    if (!SR) return;
    const rec = new SR();
    recognitionRef.current = rec;
    rec.lang = "es-MX";
    rec.continuous = true;
    rec.interimResults = true;
    const base = draftRef.current;
    let finals = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setDictating(false);
      recognitionRef.current = null;
      void flush();
    };
    rec.onresult = (e) => {
      const ev = e as { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
      let interim = "";
      finals = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      const dicho = (finals + interim).trim();
      const nuevo = base ? `${base}\n${dicho}` : dicho;
      handleChange(nuevo);
    };
    rec.onend = finish;
    rec.onerror = finish;
    try {
      rec.start();
      setDictating(true);
    } catch {
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictating, flush]);

  // Deslizar para cambiar de hoja (solo si no estás escribiendo).
  function onTouchStart(e: React.TouchEvent) {
    if (document.activeElement === textRef.current) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    void goTo(dx < 0 ? index + 1 : index - 1);
  }

  // Teclado: flechas para cambiar de hoja, Escape para cerrar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");
      if (e.key === "Escape" && !typing) onClose();
      if (typing) return;
      if (e.key === "ArrowRight") void goTo(index + 1);
      if (e.key === "ArrowLeft") void goTo(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, index, onClose]);

  const fechaHora = useMemo(() => {
    const ms = page?.writtenAtMs ?? localWrittenMs;
    return ms ? formatWritten(ms) : null;
  }, [page?.writtenAtMs, localWrittenMs]);

  return (
    <div className="fixed inset-0 z-[120] bg-surface-container-low flex flex-col">
      {/* Barra superior */}
      <header className="flex items-center gap-3 px-3 md:px-5 pt-3 pb-2.5 flex-shrink-0 bg-surface-container-lowest border-b border-outline-variant/20">
        <button
          onClick={onClose}
          title="Cerrar libreta"
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-colors flex-shrink-0"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>arrow_back</span>
        </button>

        {/* Miniatura de la portada */}
        <div className="w-8 h-11 rounded-[3px] overflow-hidden shadow flex-shrink-0">
          <CoverArt cover={notebook.cover} hideTitle spiral={false} />
        </div>

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setTitleDraft(notebook.title);
                  setEditingTitle(false);
                }
              }}
              maxLength={60}
              className="w-full bg-transparent text-base font-bold font-headline text-on-surface outline-none border-b border-primary/50"
            />
          ) : (
            <button
              onClick={() => {
                setTitleDraft(notebook.title);
                setEditingTitle(true);
              }}
              className="block max-w-full truncate text-base font-bold font-headline text-on-surface text-left"
              title="Tocar para renombrar"
            >
              {notebook.title || "Sin título"}
            </button>
          )}
          <p className="text-[11px] text-on-surface-variant">
            Hoja {pages.length ? index + 1 : 0} de {pages.length}
            {savedAt && <span className="ml-2 opacity-70">· guardado</span>}
          </p>
        </div>

        {speechOk && (
          <button
            onClick={handleDictate}
            title={dictating ? "Detener dictado" : "Dictar en esta hoja"}
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
              dictating
                ? "bg-red-500 text-white idea-mic-active"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              {dictating ? "stop" : "mic"}
            </span>
          </button>
        )}
        <button
          onClick={handleDevelop}
          disabled={developing || !draft.trim()}
          title="Desarrollar con IA: primeros pasos"
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-secondary hover:bg-secondary/10 transition-colors disabled:opacity-35 disabled:pointer-events-none"
        >
          <span
            className={`material-symbols-outlined ${developing ? "animate-spin" : ""}`}
            style={{ fontSize: 20 }}
          >
            {developing ? "progress_activity" : "auto_fix_high"}
          </span>
        </button>
      </header>

      {/* Hoja */}
      <div
        className="flex-1 overflow-y-auto px-3 md:px-6 py-4"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="nb-paper mx-auto w-full max-w-2xl min-h-full rounded-lg overflow-hidden">
            {/* Encabezado de la hoja: fecha y hora automáticas */}
            <div className="nb-paper-head flex items-center justify-between">
              <span className="nb-date" style={{ color: ink }}>
                {fechaHora || "—"}
              </span>
              <span className="nb-folio" style={{ color: ink }}>
                {index + 1}
              </span>
            </div>

            <div className="nb-lines">
              <textarea
                ref={textRef}
                value={draft}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={() => void flush()}
                placeholder="Escribe aquí…"
                spellCheck={false}
                className="nb-text"
                style={{ color: ink }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Barra inferior: tinta + navegación de hojas */}
      <div
        className="flex items-center gap-2 px-3 md:px-6 pt-2 bg-surface-container-lowest border-t border-outline-variant/20 flex-shrink-0"
        style={{ paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))" }}
      >
        {/* Tinta */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setInkOpen((v) => !v)}
            title="Color de tinta"
            className="h-9 pl-2 pr-3 rounded-full border border-outline-variant/40 flex items-center gap-1.5 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
          >
            <span
              className="w-4 h-4 rounded-full border border-black/15"
              style={{ backgroundColor: ink }}
            />
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>ink_pen</span>
          </button>
          {inkOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setInkOpen(false)} />
              <div className="absolute bottom-11 left-0 z-50 bg-surface-container-lowest border border-outline-variant/25 rounded-2xl shadow-xl p-2 grid grid-cols-3 gap-2">
                {INKS.map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => handleInk(c.hex)}
                    title={c.name}
                    className={`w-8 h-8 rounded-full border transition-transform hover:scale-110 ${
                      c.hex === ink ? "border-gray-700 ring-2 ring-primary/40" : "border-black/10"
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleDeletePage}
          title="Arrancar esta hoja"
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-surface-container-low transition-colors flex-shrink-0"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 19 }}>delete</span>
        </button>

        <div className="flex-1" />

        {/* Navegación entre hojas */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => void goTo(index - 1)}
            disabled={index <= 0}
            title="Hoja anterior"
            className="w-9 h-9 rounded-full border border-outline-variant/40 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-all disabled:opacity-30 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 19 }}>chevron_left</span>
          </button>
          <span className="text-xs font-bold text-on-surface-variant tabular-nums px-1 min-w-14 text-center">
            {pages.length ? index + 1 : 0} / {pages.length}
          </span>
          <button
            onClick={() => void goTo(index + 1)}
            disabled={index >= pages.length - 1}
            title="Hoja siguiente"
            className="w-9 h-9 rounded-full border border-outline-variant/40 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-all disabled:opacity-30 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 19 }}>chevron_right</span>
          </button>
          <button
            onClick={handleAddPage}
            title="Nueva hoja"
            className="h-9 px-3 ml-1 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center gap-1 hover:opacity-90 transition-all"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>note_add</span>
            <span className="hidden sm:inline">Hoja</span>
          </button>
        </div>
      </div>
    </div>
  );
}
