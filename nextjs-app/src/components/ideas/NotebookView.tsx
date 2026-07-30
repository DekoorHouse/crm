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
    title: typeof d.title === "string" ? d.title : "",
    text: typeof d.text === "string" ? d.text : "",
    html: typeof d.html === "string" ? d.html : "",
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Deja pasar solo lo que produce el editor: texto, saltos de línea y tramos de
 * color. Todo lo demás (scripts, estilos, atributos) se descarta.
 */
function sanitizeInkHtml(html: string): string {
  if (typeof window === "undefined") return "";
  const src = document.createElement("div");
  src.innerHTML = html;
  const out = document.createElement("div");

  const walk = (from: Node, to: HTMLElement) => {
    from.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(node.textContent || ""));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        to.appendChild(document.createElement("br"));
        return;
      }
      if (tag === "div" || tag === "p") {
        // Un bloque nuevo equivale a un salto de línea.
        if (to.lastChild) to.appendChild(document.createElement("br"));
        walk(el, to);
        return;
      }
      const color = el.style?.color || "";
      if (color) {
        const span = document.createElement("span");
        span.style.color = color;
        walk(el, span);
        to.appendChild(span);
        return;
      }
      walk(el, to); // cualquier otra etiqueta: se conserva solo su contenido
    });
  };

  walk(src, out);
  return out.innerHTML;
}

interface NotebookViewProps {
  notebook: Notebook;
  onClose: () => void;
}

export default function NotebookView({ notebook, onClose }: NotebookViewProps) {
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [pageTitle, setPageTitle] = useState("");
  const [ink, setInk] = useState(DEFAULT_INK);
  const [inkOpen, setInkOpen] = useState(false);
  const [vacia, setVacia] = useState(true);
  const [titleDraft, setTitleDraft] = useState(notebook.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [developing, setDeveloping] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [localWrittenMs, setLocalWrittenMs] = useState<number | null>(null);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const pageIdRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const savedRange = useRef<Range | null>(null);

  const page = pages[index];

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setSpeechOk(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // Recordar dónde estaba el cursor/selección: al tocar el botón de tinta el
  // editor pierde el foco, y sin esto no habría a qué aplicarle el color.
  useEffect(() => {
    const onSelChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (editorRef.current?.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, []);

  // Hojas en tiempo real.
  useEffect(() => {
    const q = query(collection(db, "notebooks", notebook.id, "pages"), orderBy("order", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPages(snap.docs.map((d) => mapPage(d.id, d.data() as Record<string, unknown>)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [notebook.id]);

  // Al cambiar de hoja, cargar su contenido (sin pisar lo que estás escribiendo).
  useEffect(() => {
    if (!page) return;
    if (pageIdRef.current === page.id) return;
    pageIdRef.current = page.id;
    const html = page.html || escapeHtml(page.text).replace(/\n/g, "<br>");
    if (editorRef.current) editorRef.current.innerHTML = html;
    setVacia(!page.text.trim());
    setPageTitle(page.title);
    titleRef.current = page.title;
    setInk(page.ink);
    setLocalWrittenMs(null);
    dirtyRef.current = false;
  }, [page]);

  // Guardado: al dejar de escribir, al cambiar de hoja y al cerrar.
  const flush = useCallback(async () => {
    if (!dirtyRef.current || !pageIdRef.current) return;
    const id = pageIdRef.current;
    const el = editorRef.current;
    dirtyRef.current = false;
    try {
      await updatePage(notebook.id, id, {
        title: titleRef.current,
        text: el?.innerText ?? "",
        html: sanitizeInkHtml(el?.innerHTML ?? ""),
      });
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

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void flush();
      recognitionRef.current?.stop();
    };
  }, [flush]);

  // Marca que hay cambios y despierta la fecha/hora en cuanto hay contenido.
  const touch = useCallback(() => {
    dirtyRef.current = true;
    const hayAlgo = Boolean(editorRef.current?.innerText.trim() || titleRef.current.trim());
    setVacia(!editorRef.current?.innerText.trim());
    if (hayAlgo && !page?.writtenAtMs && localWrittenMs === null) setLocalWrittenMs(Date.now());
    scheduleSave();
  }, [page?.writtenAtMs, localWrittenMs, scheduleSave]);

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
      setIndex(pages.length);
      requestAnimationFrame(() => editorRef.current?.focus());
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

  /**
   * Cambiar de pluma: si hay texto seleccionado se le aplica el color; si no,
   * la tinta nueva aplica a lo que escribas a partir de ahí (misma hoja, varios
   * colores). execCommand es lo único que soporta esto en todos los navegadores.
   */
  const handleInk = useCallback(
    (hex: string) => {
      setInk(hex);
      setInkOpen(false);
      const el = editorRef.current;
      if (el) {
        el.focus();
        // Devolver el cursor/selección a donde estaba antes de tocar el botón.
        const sel = window.getSelection();
        if (savedRange.current && sel) {
          sel.removeAllRanges();
          sel.addRange(savedRange.current);
        }
        try {
          document.execCommand("styleWithCSS", false, "true");
          document.execCommand("foreColor", false, hex);
        } catch {
          /* si el navegador no lo soporta, la tinta aplica a la hoja completa */
        }
        if (sel && !sel.isCollapsed) touch();
      }
      if (page) updatePage(notebook.id, page.id, { ink: hex }).catch(() => {});
    },
    [notebook.id, page, touch]
  );

  const handleNotebookTitleCommit = useCallback(() => {
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
      pageIdRef.current = null; // recargar el contenido nuevo desde el listener
      toast.success(`✨ ${pasos.length} pasos agregados`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo desarrollar");
    } finally {
      setDeveloping(false);
    }
  }, [notebook.id, page, developing, flush]);

  // Dictado por voz: escribe al final de la hoja, con la tinta actual.
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
    const baseHtml = editorRef.current?.innerHTML ?? "";
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
      let dicho = "";
      for (let i = 0; i < ev.results.length; i++) dicho += ev.results[i][0].transcript;
      const el = editorRef.current;
      if (!el) return;
      const trozo = `<span style="color:${ink}">${escapeHtml(dicho.trim())}</span>`;
      el.innerHTML = baseHtml ? `${baseHtml}<br>${trozo}` : trozo;
      touch();
    };
    rec.onend = finish;
    rec.onerror = finish;
    try {
      rec.start();
      setDictating(true);
    } catch {
      finish();
    }
  }, [dictating, flush, ink, touch]);

  // Deslizar para cambiar de hoja (solo si no estás escribiendo).
  function onTouchStart(e: React.TouchEvent) {
    const activo = document.activeElement;
    if (activo === editorRef.current || activo?.tagName === "INPUT") return;
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
      const typing = el && (el.tagName === "INPUT" || el.isContentEditable);
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

        <div className="w-8 h-11 rounded-[3px] overflow-hidden shadow flex-shrink-0">
          <CoverArt cover={notebook.cover} hideTitle spiral={false} />
        </div>

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleNotebookTitleCommit}
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
              title="Tocar para renombrar la libreta"
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
          disabled={developing || vacia}
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
            {/* Encabezado de la hoja: título a la izquierda, fecha a la derecha */}
            <div className="nb-paper-head flex items-baseline gap-3">
              <input
                value={pageTitle}
                onChange={(e) => {
                  setPageTitle(e.target.value);
                  titleRef.current = e.target.value;
                  touch();
                }}
                onBlur={() => void flush()}
                placeholder="Título de la hoja…"
                maxLength={80}
                className="nb-title flex-1 min-w-0"
                style={{ color: ink }}
              />
              <span className="nb-date flex-shrink-0" style={{ color: ink }}>
                {fechaHora || "—"}
              </span>
            </div>

            <div className="nb-lines">
              {/* Editor con varias tintas: cada tramo guarda su color */}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={touch}
                onBlur={() => void flush()}
                data-placeholder="Escribe aquí…"
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
            title="Cambiar de pluma (aplica a lo seleccionado o a lo que sigas escribiendo)"
            className="h-9 pl-2 pr-3 rounded-full border border-outline-variant/40 flex items-center gap-1.5 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
          >
            <span className="w-4 h-4 rounded-full border border-black/15" style={{ backgroundColor: ink }} />
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>ink_pen</span>
          </button>
          {inkOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setInkOpen(false)} />
              <div className="absolute bottom-11 left-0 z-50 bg-surface-container-lowest border border-outline-variant/25 rounded-2xl shadow-xl p-2.5">
                <p className="text-[10px] text-on-surface-variant/70 mb-2 px-0.5 leading-tight max-w-40">
                  Pinta lo seleccionado, o sigue escribiendo con la pluma nueva.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {INKS.map((c) => (
                    <button
                      key={c.hex}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleInk(c.hex)}
                      title={c.name}
                      className={`w-8 h-8 rounded-full border transition-transform hover:scale-110 ${
                        c.hex === ink ? "border-gray-700 ring-2 ring-primary/40" : "border-black/10"
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
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
