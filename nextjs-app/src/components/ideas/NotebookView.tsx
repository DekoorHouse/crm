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
const SWIPE_MIN = 70; // px de deslizamiento para pasar de hoja
const VACIO = "☐";
const PALOMEADO = "☑";

/** A qué le aplica la pluma que elijas. */
type InkTarget = "cuerpo" | "titulo" | "fecha";

function mapPage(id: string, d: Record<string, unknown>): Page {
  const written = d.writtenAt as { toMillis?: () => number } | undefined;
  return {
    id,
    title: typeof d.title === "string" ? d.title : "",
    text: typeof d.text === "string" ? d.text : "",
    html: typeof d.html === "string" ? d.html : "",
    ink: typeof d.ink === "string" ? d.ink : DEFAULT_INK,
    pen: typeof d.pen === "string" ? d.pen : undefined,
    titleInk: typeof d.titleInk === "string" ? d.titleInk : undefined,
    dateInk: typeof d.dateInk === "string" ? d.dateInk : undefined,
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

// URLs dentro del texto de la hoja: http(s):// o www., sin puntuación al final.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]}"'])/gi;

/**
 * Solo deja pasar enlaces seguros (http/https/mailto). Cualquier otra cosa
 * —sobre todo `javascript:`— devuelve null, porque el HTML de la hoja se
 * vuelve a inyectar con innerHTML y un href malicioso sería un XSS.
 */
function safeHref(raw: string): string | null {
  const v = raw.trim();
  try {
    const u = new URL(/^www\./i.test(v) ? `https://${v}` : v, window.location.origin);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") return u.href;
  } catch {
    /* href inválido */
  }
  return null;
}

/**
 * Convierte en <a> las URLs escritas como texto plano dentro del editor.
 * Idempotente: salta el texto que ya vive dentro de un <a>. No se usa mientras
 * escribes (movería el cursor); se aplica al cargar la hoja y al salir de ella.
 */
function linkify(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const objetivo: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    if ((t.parentElement as HTMLElement | null)?.closest("a")) continue;
    URL_RE.lastIndex = 0;
    if (URL_RE.test(t.textContent || "")) objetivo.push(t);
  }
  for (const node of objetivo) {
    const txt = node.textContent || "";
    const frag = document.createDocumentFragment();
    let last = 0;
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(txt))) {
      const href = safeHref(m[0]);
      if (m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
      if (href) {
        const a = document.createElement("a");
        a.setAttribute("href", href);
        a.textContent = m[0];
        frag.appendChild(a);
      } else {
        frag.appendChild(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

/** Punto del texto bajo un clic, para saber si tocaste una casilla. */
function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  return null;
}

/**
 * Deja pasar solo lo que produce el editor: texto, saltos de línea y tramos de
 * color. Todo lo demás (scripts, estilos, atributos) se descarta.
 *
 * Además le pone color explícito al texto que aún no lo tiene (`baseColor`):
 * así cada tramo guarda su tinta y ningún cambio de pluma posterior repinta lo
 * que ya estaba escrito.
 */
function sanitizeInkHtml(html: string, baseColor: string): string {
  if (typeof window === "undefined") return "";
  const src = document.createElement("div");
  src.innerHTML = html;
  const out = document.createElement("div");

  const walk = (from: Node, to: HTMLElement, teñido: boolean) => {
    from.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const txt = node.textContent || "";
        if (!txt) return;
        if (teñido) {
          to.appendChild(document.createTextNode(txt));
        } else {
          const span = document.createElement("span");
          span.style.color = baseColor;
          span.appendChild(document.createTextNode(txt));
          to.appendChild(span);
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style") return; // ni su contenido
      if (tag === "br") {
        to.appendChild(document.createElement("br"));
        return;
      }
      if (tag === "div" || tag === "p") {
        // Un bloque nuevo equivale a un salto de línea.
        if (to.lastChild) to.appendChild(document.createElement("br"));
        walk(el, to, teñido);
        return;
      }
      if (tag === "a") {
        const href = safeHref(el.getAttribute("href") || "");
        if (href) {
          const a = document.createElement("a");
          a.setAttribute("href", href);
          a.textContent = el.textContent || href; // el link lleva su color por CSS
          to.appendChild(a);
        } else {
          walk(el, to, teñido); // href inseguro: se conserva solo el texto
        }
        return;
      }
      const color = el.style?.color || "";
      if (color) {
        const span = document.createElement("span");
        span.style.color = color;
        walk(el, span, true);
        to.appendChild(span);
        return;
      }
      walk(el, to, teñido); // otra etiqueta: se conserva solo su contenido
    });
  };

  walk(src, out, false);
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
  const [turnDir, setTurnDir] = useState<"next" | "prev">("next");
  const [pageTitle, setPageTitle] = useState("");
  // `ink` es la pluma en la mano; `baseInk` es el color del texto que aún no
  // tiene tinta propia. El título y la fecha llevan la suya aparte.
  const [ink, setInk] = useState(DEFAULT_INK);
  const [baseInk, setBaseInk] = useState(DEFAULT_INK);
  const [titleInk, setTitleInk] = useState(DEFAULT_INK);
  const [dateInk, setDateInk] = useState(DEFAULT_INK);
  const [inkTarget, setInkTarget] = useState<InkTarget>("cuerpo");
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
    if (editorRef.current) {
      // Sanear en la CARGA también: el html viene de Firestore y podría traer
      // un href peligroso metido por fuera del editor. Luego linkificar las
      // URLs que quedaron como texto plano (hojas viejas o dictadas).
      editorRef.current.innerHTML = sanitizeInkHtml(html, page.ink);
      linkify(editorRef.current);
    }
    setVacia(!page.text.trim());
    setPageTitle(page.title);
    titleRef.current = page.title;
    setBaseInk(page.ink);
    setInk(page.pen || page.ink);
    setTitleInk(page.titleInk || page.ink);
    setDateInk(page.dateInk || page.ink);
    setInkTarget("cuerpo");
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
        html: sanitizeInkHtml(el?.innerHTML ?? "", baseInk),
      });
      setSavedAt(Date.now());
    } catch {
      dirtyRef.current = true;
      toast.error("No se pudo guardar la hoja");
    }
  }, [notebook.id, baseInk]);

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
      setTurnDir(next > index ? "next" : "prev");
      setIndex(next);
    },
    [pages.length, index, flush]
  );

  const handleAddPage = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await flush();
    try {
      await addPage(notebook.id, ink);
      setTurnDir("next");
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
   * La pluma pinta lo que estés tocando: el título, la fecha, o el cuerpo. En
   * el cuerpo aplica a lo seleccionado, o tiñe lo que sigas escribiendo, así
   * conviven varios colores en una misma hoja.
   */
  const handleInk = useCallback(
    (hex: string) => {
      setInkOpen(false);
      if (!page) return;

      if (inkTarget === "titulo") {
        setTitleInk(hex);
        updatePage(notebook.id, page.id, { titleInk: hex }).catch(() => {});
        return;
      }
      if (inkTarget === "fecha") {
        setDateInk(hex);
        updatePage(notebook.id, page.id, { dateInk: hex }).catch(() => {});
        return;
      }

      setInk(hex);
      const el = editorRef.current;
      const hojaEnBlanco = !el?.innerText.trim();
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
          /* si el navegador no lo soporta, la tinta aplica desde la próxima hoja */
        }
        if (sel && !sel.isCollapsed) touch();
      }
      // El color base solo se mueve si la hoja está en blanco: si ya hay texto,
      // se queda como está para no repintar lo escrito.
      if (hojaEnBlanco) {
        setBaseInk(hex);
        updatePage(notebook.id, page.id, { ink: hex, pen: hex }).catch(() => {});
      } else {
        updatePage(notebook.id, page.id, { pen: hex }).catch(() => {});
      }
    },
    [notebook.id, page, inkTarget, touch]
  );

  // --- Lista de pendientes: casillas de texto que se palomean al tocarlas ---
  const insertarCasilla = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    // Si ya hay algo escrito en la línea, la casilla empieza en una nueva.
    const node = sel?.anchorNode;
    const antes =
      node?.nodeType === Node.TEXT_NODE
        ? (node.textContent || "").slice(0, sel?.anchorOffset ?? 0)
        : "";
    const lineaActual = antes.split("\n").pop() || "";
    const prefijo = el.innerText.trim() && lineaActual.trim() ? "<br>" : "";
    document.execCommand("insertHTML", false, `${prefijo}${VACIO}&nbsp;`);
    touch();
  }, [touch]);

  const onEditorClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Tocar un enlace lo abre (el link lo escribiste tú en tu libreta).
      const link = (e.target as HTMLElement).closest?.("a") as HTMLAnchorElement | null;
      if (link?.href) {
        e.preventDefault();
        window.open(link.href, "_blank", "noopener,noreferrer");
        return;
      }
      const pos = caretFromPoint(e.clientX, e.clientY);
      if (!pos || pos.node.nodeType !== Node.TEXT_NODE) return;
      const txt = pos.node.textContent || "";
      // La casilla puede quedar justo bajo el clic o un carácter antes.
      for (const off of [pos.offset, pos.offset - 1]) {
        if (off < 0 || off >= txt.length) continue;
        const ch = txt[off];
        if (ch === VACIO || ch === PALOMEADO) {
          pos.node.textContent = txt.slice(0, off) + (ch === VACIO ? PALOMEADO : VACIO) + txt.slice(off + 1);
          touch();
          return;
        }
      }
    },
    [touch]
  );

  const onEditorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const antes =
        node?.nodeType === Node.TEXT_NODE
          ? (node.textContent || "").slice(0, sel?.anchorOffset ?? 0)
          : "";
      const linea = antes.split("\n").pop() || "";
      if (!/^\s*[☐☑]/.test(linea)) return;
      e.preventDefault();
      // Enter en una casilla vacía cierra la lista; si no, continúa con otra.
      if (/^\s*[☐☑]\s*$/.test(linea)) {
        document.execCommand("delete", false);
        for (let i = 0; i < linea.trim().length; i++) document.execCommand("delete", false);
        document.execCommand("insertHTML", false, "<br>");
      } else {
        document.execCommand("insertHTML", false, `<br>${VACIO}&nbsp;`);
      }
      touch();
    },
    [touch]
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

  // Deslizar con el dedo para pasar de hoja. Si hay texto seleccionado se
  // respeta la selección (el gesto era para elegir texto, no para hojear).
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return;
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

  const tintaMostrada = inkTarget === "titulo" ? titleInk : inkTarget === "fecha" ? dateInk : ink;
  const nombreDestino = inkTarget === "titulo" ? "el título" : inkTarget === "fecha" ? "la fecha" : "el texto";

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
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-6 py-4"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div
            key={page?.id || "vacia"}
            className={`nb-paper mx-auto w-full max-w-2xl min-h-full rounded-lg overflow-hidden ${
              turnDir === "next" ? "nb-turn-next" : "nb-turn-prev"
            }`}
          >
            {/* Encabezado de la hoja: título a la izquierda, fecha a la derecha */}
            <div className="nb-paper-head flex items-baseline gap-3">
              <input
                value={pageTitle}
                onFocus={() => setInkTarget("titulo")}
                onChange={(e) => {
                  setPageTitle(e.target.value);
                  titleRef.current = e.target.value;
                  touch();
                }}
                onBlur={() => void flush()}
                placeholder="Título de la hoja…"
                maxLength={80}
                className="nb-title flex-1 min-w-0"
                style={{ color: titleInk }}
              />
              <button
                onClick={() => setInkTarget((t) => (t === "fecha" ? "cuerpo" : "fecha"))}
                title="Tocar para pintar la fecha con otra tinta"
                className={`nb-date flex-shrink-0 ${inkTarget === "fecha" ? "nb-date-sel" : ""}`}
                style={{ color: dateInk }}
              >
                {fechaHora || "—"}
              </button>
            </div>

            <div className="nb-lines">
              {/* Editor con varias tintas: cada tramo guarda su color */}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={touch}
                onFocus={() => setInkTarget("cuerpo")}
                onClick={onEditorClick}
                onKeyDown={onEditorKeyDown}
                onBlur={() => {
                  // Al salir del editor, las URLs escritas se vuelven enlaces
                  // (durante la escritura no, para no mover el cursor).
                  if (editorRef.current) {
                    linkify(editorRef.current);
                    dirtyRef.current = true;
                  }
                  void flush();
                }}
                data-placeholder="Escribe aquí…"
                spellCheck={false}
                className="nb-text"
                style={{ color: baseInk }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Barra inferior: tinta, lista y navegación de hojas */}
      <div
        className="flex items-center gap-2 px-3 md:px-6 pt-2 bg-surface-container-lowest border-t border-outline-variant/20 flex-shrink-0"
        style={{ paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))" }}
      >
        {/* Tinta */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setInkOpen((v) => !v)}
            title={`Cambiar la tinta de ${nombreDestino}`}
            className="h-9 pl-2 pr-3 rounded-full border border-outline-variant/40 flex items-center gap-1.5 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
          >
            <span
              className="w-4 h-4 rounded-full border border-black/15"
              style={{ backgroundColor: tintaMostrada }}
            />
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>ink_pen</span>
          </button>
          {inkOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setInkOpen(false)} />
              <div className="absolute bottom-11 left-0 z-50 bg-surface-container-lowest border border-outline-variant/25 rounded-2xl shadow-xl p-2.5">
                <p className="text-[10px] text-on-surface-variant/80 mb-2 px-0.5 leading-tight max-w-44">
                  Pinta <span className="font-bold">{nombreDestino}</span>. Toca el título o la fecha
                  para cambiarles la tinta por separado.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {INKS.map((c) => (
                    <button
                      key={c.hex}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleInk(c.hex)}
                      title={c.name}
                      className={`w-8 h-8 rounded-full border transition-transform hover:scale-110 ${
                        c.hex === tintaMostrada ? "border-gray-700 ring-2 ring-primary/40" : "border-black/10"
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Lista de pendientes */}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertarCasilla}
          title="Agregar casilla de pendiente (tócala para palomearla)"
          className="w-9 h-9 rounded-full border border-outline-variant/40 flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors flex-shrink-0"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>checklist</span>
        </button>

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
