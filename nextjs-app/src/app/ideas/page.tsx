"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/lib/hooks/useAuth";
import LoadingOverlay from "@/components/layout/LoadingOverlay";
import {
  createIdea,
  updateIdea,
  deleteIdea,
  saveIdeasConfig,
  repasoMural,
  desarrollarIdea,
  type Idea,
  type RepasoResult,
} from "@/lib/api/ideas";
import IdeaNote, { DEFAULT_IDEA_COLOR, NOTE_SIZE } from "@/components/ideas/IdeaNote";
import ColorLegend from "@/components/ideas/ColorLegend";
import RepasoSheet from "@/components/ideas/RepasoSheet";
import toast from "react-hot-toast";

const BOARD_MAX_W = 4000; // tope de crecimiento horizontal del lienzo
const BOARD_MAX_H = 4000; // tope de crecimiento vertical del lienzo
const BOARD_PAD = 20;
const ECHO_MIN_DAYS = 3; // a partir de cuántos días una idea "olvidada" pide atención
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.5;

const FONDOS = [
  { id: "puntos", label: "Puntos" },
  { id: "cuadricula", label: "Cuadrícula" },
  { id: "renglones", label: "Renglones" },
  { id: "liso", label: "Liso" },
];

function mapDoc(id: string, d: Record<string, unknown>): Idea {
  const updatedAt = d.updatedAt as { toMillis?: () => number } | undefined;
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
    updatedAtMs: updatedAt && typeof updatedAt.toMillis === "function" ? updatedAt.toMillis() : undefined,
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
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const [legend, setLegend] = useState<Record<string, string>>({});
  const [fondo, setFondo] = useState("puntos");
  const [fondoOpen, setFondoOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [dictatingId, setDictatingId] = useState<string | null>(null);
  const [speechOk, setSpeechOk] = useState(false);
  const [repaso, setRepaso] = useState<{ open: boolean; loading: boolean; data: RepasoResult | null }>({
    open: false,
    loading: false,
    data: null,
  });

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const resizingIdRef = useRef<string | null>(null);
  const dictatingIdRef = useRef<string | null>(null);
  const newIdRef = useRef<string | null>(null);
  const initialIdsRef = useRef<Set<string> | null>(null);
  const autoCreatedRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const zoomRef = useRef(1);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  // Pizarra personal: requiere sesion (misma cuenta que el resto de la app).
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?redirect=${encodeURIComponent("/ideas")}`);
    }
  }, [user, authLoading, router]);

  // PWA propia de la pizarra: manifest + service worker minimo (instalable en el cel).
  useEffect(() => {
    let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.href = "/ideas-manifest.json";
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/ideas-sw.js", { scope: "/ideas" }).catch(() => {});
    }
    // Dictado por voz disponible?
    const w = window as unknown as Record<string, unknown>;
    setSpeechOk(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // Lectura en tiempo real desde Firestore (sincroniza entre dispositivos).
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "ideas"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const remote = snap.docs.map((doc) => mapDoc(doc.id, doc.data() as Record<string, unknown>));
        // Recordar las ideas presentes en la primera carga (no animan su nacimiento).
        if (initialIdsRef.current === null) {
          initialIdsRef.current = new Set(remote.map((n) => n.id));
        }
        setNotes((prev) => {
          // Conservar estado local de la nota que se esta manipulando (drag/resize/dictado).
          const dragId = draggingIdRef.current;
          const sizeId = resizingIdRef.current;
          const dictId = dictatingIdRef.current;
          if (!dragId && !sizeId && !dictId) return remote;
          return remote.map((n) => {
            const local = prev.find((p) => p.id === n.id);
            if (!local) return n;
            if (n.id === dragId) return { ...n, x: local.x, y: local.y };
            if (n.id === sizeId) return { ...n, w: local.w, h: local.h };
            if (n.id === dictId) return { ...n, text: local.text };
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

  // Config compartida (leyenda de colores + fondo) — sincroniza entre dispositivos.
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "ideas_config", "main"), (snap) => {
      const d = snap.data();
      if (!d) return;
      if (d.legend && typeof d.legend === "object") setLegend(d.legend as Record<string, string>);
      if (typeof d.fondo === "string" && FONDOS.some((f) => f.id === d.fondo)) setFondo(d.fondo);
    });
    return () => unsub();
  }, [user]);

  // Medir el viewport del lienzo (para centrar notas nuevas y crecer el lienzo).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [authLoading, user]);

  // --- Zoom del lienzo (pellizco con dos dedos, Ctrl+rueda, botones) ---
  const applyZoom = useCallback((target: number, clientX: number, clientY: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const z0 = zoomRef.current;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target));
    if (z === z0) return;
    const rect = scroller.getBoundingClientRect();
    // Punto lógico bajo el foco (dedos/cursor) que debe quedarse quieto al escalar.
    const px = (scroller.scrollLeft + clientX - rect.left) / z0;
    const py = (scroller.scrollTop + clientY - rect.top) / z0;
    zoomRef.current = z;
    pendingScrollRef.current = {
      left: px * z - (clientX - rect.left),
      top: py * z - (clientY - rect.top),
    };
    setZoom(z);
  }, []);

  // El ajuste de scroll se aplica despues de que el DOM tome el nuevo tamano (sin brinco).
  useLayoutEffect(() => {
    const p = pendingScrollRef.current;
    const scroller = scrollerRef.current;
    if (p && scroller) {
      scroller.scrollLeft = p.left;
      scroller.scrollTop = p.top;
      pendingScrollRef.current = null;
    }
  }, [zoom]);

  const zoomFromCenter = useCallback(
    (factor: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      applyZoom(zoomRef.current * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    [applyZoom]
  );

  const resetZoom = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    applyZoom(1, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [applyZoom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { d0: number; z0: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // Un dedo sobre una nota es arrastre de nota, no pellizco.
      if ((e.target as HTMLElement).closest("[data-idea-note]")) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: zoomRef.current };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 0 && pinch.d0 > 0) {
          applyZoom(pinch.z0 * (d / pinch.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    // Con dos dedos bloqueamos el pan nativo para que el pellizco sea nuestro.
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    // Ctrl+rueda (y pellizco de trackpad, que llega como ctrl+wheel) hace zoom en desktop.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom(zoomRef.current * Math.pow(2, -e.deltaY / 400), e.clientX, e.clientY);
    };

    scroller.addEventListener("pointerdown", onDown);
    scroller.addEventListener("pointermove", onMove);
    scroller.addEventListener("pointerup", onUp);
    scroller.addEventListener("pointercancel", onUp);
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      scroller.removeEventListener("pointerdown", onDown);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerup", onUp);
      scroller.removeEventListener("pointercancel", onUp);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("wheel", onWheel);
    };
  }, [authLoading, user, applyZoom]);

  // El lienzo crece hacia la derecha y hacia abajo cuando empujas notas a los bordes.
  const contentW = useMemo(() => {
    const needed = notes.reduce((m, n) => Math.max(m, n.x + n.w + 60), 0);
    return Math.min(BOARD_MAX_W, Math.max(viewSize.w / zoom, needed));
  }, [notes, viewSize.w, zoom]);

  const contentH = useMemo(() => {
    const needed = notes.reduce((m, n) => Math.max(m, n.y + n.h + 60), 0);
    return Math.min(BOARD_MAX_H, Math.max(viewSize.h / zoom, needed));
  }, [notes, viewSize.h, zoom]);

  const maxZ = notes.reduce((m, n) => Math.max(m, n.z), 0);

  const q = norm(search.trim());
  const isDimmed = useCallback(
    (n: Idea) =>
      (q !== "" && !norm(n.text).includes(q)) || (colorFilter !== null && n.color !== colorFilter),
    [q, colorFilter]
  );
  const visibleCount = notes.filter((n) => !isDimmed(n)).length;
  const filtering = q !== "" || colorFilter !== null;

  // La idea mas olvidada del mural pide atencion con un halo sutil.
  const echo = useMemo(() => {
    const ahora = Date.now();
    let oldest: Idea | null = null;
    for (const n of notes) {
      if (!n.text.trim() || n.updatedAtMs === undefined) continue;
      if (!oldest || n.updatedAtMs < (oldest.updatedAtMs as number)) oldest = n;
    }
    if (!oldest) return null;
    const dias = Math.floor((ahora - (oldest.updatedAtMs as number)) / 86400000);
    return dias >= ECHO_MIN_DAYS ? { id: oldest.id, dias } : null;
  }, [notes]);

  const handleAdd = useCallback(
    async (atX?: number, atY?: number, opts?: { edit?: boolean }): Promise<string | null> => {
      const scroller = scrollerRef.current;
      const z = zoomRef.current;
      // Viewport visible en coordenadas lógicas del lienzo.
      const w = (scroller?.clientWidth ?? 800) / z;
      const h = (scroller?.clientHeight ?? 600) / z;
      const sx = (scroller?.scrollLeft ?? 0) / z;
      const sy = (scroller?.scrollTop ?? 0) / z;
      const rand = (spread: number) => Math.round(Math.random() * spread - spread / 2);
      // Sin coordenadas: centrado en la parte visible del lienzo, con algo de azar.
      let x = atX ?? Math.round(sx + w / 2 - NOTE_SIZE / 2 + rand(140));
      let y = atY ?? Math.round(sy + h / 2.6 + rand(120));
      x = Math.max(0, Math.min(Math.max(contentW, sx + w) - NOTE_SIZE - 8, x));
      y = Math.max(0, Math.min(Math.max(contentH, sy + h) - NOTE_SIZE - 8, y));
      const rotation = rand(8); // entre -4 y 4 grados aprox.
      try {
        const id = await createIdea({
          text: "",
          color: colorFilter ?? DEFAULT_IDEA_COLOR,
          x,
          y,
          w: NOTE_SIZE,
          h: NOTE_SIZE,
          rotation,
          z: maxZ + 1,
        });
        if (opts?.edit !== false) newIdRef.current = id;
        return id;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al crear la idea");
        return null;
      }
    },
    [maxZ, contentW, contentH, colorFilter]
  );

  // ?nueva=1 (acceso directo de la PWA): abrir creando una nota.
  useEffect(() => {
    if (authLoading || !user || autoCreatedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("nueva") === "1") {
      autoCreatedRef.current = true;
      handleAdd();
      params.delete("nueva");
      const rest = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  // Doble clic en el lienzo vacio crea una nota en ese punto.
  const handleBoardDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const z = zoomRef.current;
      handleAdd(
        Math.round((e.clientX - rect.left) / z - NOTE_SIZE / 2),
        Math.round((e.clientY - rect.top) / z - NOTE_SIZE / 2)
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

  // --- Dictado por voz: crea una nota y escribe lo que digas ---
  const stopDictation = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const startDictation = useCallback(async () => {
    if (dictatingIdRef.current) {
      stopDictation();
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
    const id = await handleAdd(undefined, undefined, { edit: false });
    if (!id) return;
    dictatingIdRef.current = id;
    setDictatingId(id);

    const rec = new SR();
    recognitionRef.current = rec;
    rec.lang = "es-MX";
    rec.continuous = true;
    rec.interimResults = true;
    let finals = "";
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      dictatingIdRef.current = null;
      setDictatingId(null);
      recognitionRef.current = null;
      const texto = finals.trim();
      if (texto) {
        updateIdea(id, { text: texto }).catch(() => toast.error("No se pudo guardar el dictado"));
      } else {
        // Nada reconocido: no dejar una nota fantasma.
        deleteIdea(id).catch(() => {});
      }
    };

    rec.onresult = (e) => {
      const ev = e as { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
      let interim = "";
      finals = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      const textoVivo = (finals + interim).trim();
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text: textoVivo } : n)));
    };
    rec.onend = finish;
    rec.onerror = finish;
    try {
      rec.start();
    } catch {
      finish();
    }
  }, [handleAdd, stopDictation]);

  // Detener el dictado si se desmonta la pagina.
  useEffect(() => () => recognitionRef.current?.stop(), []);

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

  // Desarrollar una idea con IA (el servidor actualiza la nota; llega por el listener).
  const handleDevelop = useCallback(async (id: string) => {
    try {
      const pasos = await desarrollarIdea(id);
      toast.success(`✨ ${pasos.length} pasos agregados`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo desarrollar la idea");
    }
  }, []);

  // Repaso del mural con IA.
  const handleRepaso = useCallback(async () => {
    setRepaso({ open: true, loading: true, data: null });
    try {
      const data = await repasoMural();
      setRepaso({ open: true, loading: false, data });
    } catch (err) {
      setRepaso({ open: false, loading: false, data: null });
      toast.error(err instanceof Error ? err.message : "No se pudo generar el repaso");
    }
  }, []);

  // Leyenda: renombrar un color (optimista + persistencia).
  const handleRenameColor = useCallback(
    (hex: string, label: string) => {
      const next = { ...legend };
      if (label) next[hex] = label;
      else delete next[hex];
      setLegend(next);
      saveIdeasConfig({ legend: next }).catch(() => toast.error("No se pudo guardar la leyenda"));
    },
    [legend]
  );

  // Fondo del tablero (optimista + persistencia).
  const handleFondo = useCallback((id: string) => {
    setFondo(id);
    setFondoOpen(false);
    saveIdeasConfig({ fondo: id }).catch(() => toast.error("No se pudo guardar el fondo"));
  }, []);

  // Acomodar todas las notas en una cuadricula (orden de lectura actual).
  const handleArrange = useCallback(async () => {
    const scroller = scrollerRef.current;
    if (!scroller || notes.length === 0) return;
    const W = scroller.clientWidth / zoomRef.current;
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
    scroller.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    try {
      await Promise.all(moves.map((m) => updateIdea(m.id, { x: m.x, y: m.y, rotation: m.rotation })));
      toast.success("Pizarra ordenada");
    } catch {
      toast.error("No se pudieron guardar todas las posiciones");
    }
  }, [notes]);

  // Copiar todas las ideas visibles como Markdown (orden de lectura).
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

  const filterLabel = colorFilter ? legend[colorFilter] || "un color" : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-6 pt-4 pb-2.5 flex-shrink-0">
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
              {filtering
                ? `${visibleCount} de ${notes.length} nota${notes.length === 1 ? "" : "s"}${filterLabel ? ` · ${filterLabel}` : ""}`
                : `${notes.length} nota${notes.length === 1 ? "" : "s"} · tu pizarra personal`}
            </p>
          </div>
        </div>

        {/* Buscador */}
        <div className="relative order-3 w-full sm:order-none sm:w-52 md:w-64">
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

        {/* Capturar */}
        <div className="flex items-center gap-2">
          {speechOk && (
            <button
              onClick={startDictation}
              title={dictatingId ? "Detener dictado" : "Dictar una idea por voz"}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                dictatingId
                  ? "bg-red-500 text-white idea-mic-active"
                  : "border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {dictatingId ? "stop" : "mic"}
              </span>
            </button>
          )}
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

      {/* Lienzo (crece a la derecha y hacia abajo; pellizca para hacer zoom) */}
      <div
        ref={scrollerRef}
        className="relative flex-1 mx-3 md:mx-6 rounded-2xl border border-outline-variant/20 overflow-auto bg-surface-container-lowest"
        style={{ touchAction: "pan-x pan-y" }}
      >
        {/* Sizer: reserva el área scrolleable ya escalada */}
        <div style={{ width: Math.round(contentW * zoom), height: Math.round(contentH * zoom) }}>
          <div
            ref={boardRef}
            onDoubleClick={handleBoardDoubleClick}
            className={`ideas-board-${fondo} relative`}
            style={{
              width: contentW,
              height: contentH,
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
            }}
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
                  <kbd className="px-1.5 py-0.5 rounded bg-surface-container text-xs font-bold">N</kbd>, dicta
                  con el micrófono o haz doble clic en el lienzo.
                </p>
              </div>
            ) : (
              notes.map((note) => (
                <IdeaNote
                  key={note.id}
                  note={note}
                  boundsRef={boardRef}
                  zoom={zoom}
                  editing={editingId === note.id}
                  dimmed={isDimmed(note)}
                  echoDays={echo && echo.id === note.id && !filtering ? echo.dias : null}
                  justBorn={initialIdsRef.current !== null && !initialIdsRef.current.has(note.id)}
                  onStartEdit={setEditingId}
                  onEndEdit={handleEndEdit}
                  onMove={handleMove}
                  onPersistPosition={handlePersistPosition}
                  onResize={handleResize}
                  onPersistSize={handlePersistSize}
                  onChangeColor={handleChangeColor}
                  onDelete={handleDelete}
                  onFocus={handleFocus}
                  onDevelop={handleDevelop}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Barra inferior: leyenda de colores + zoom + acciones del tablero */}
      <div className="flex items-center gap-2 px-4 md:px-6 pt-2.5 pb-3 flex-shrink-0">
        <ColorLegend
          legend={legend}
          activeColor={colorFilter}
          onToggleFilter={(hex) => setColorFilter((cur) => (cur === hex ? null : hex))}
          onRename={handleRenameColor}
        />
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Zoom */}
          <div className="hidden sm:flex items-center gap-0.5 mr-1">
            <button
              onClick={() => zoomFromCenter(1 / 1.25)}
              title="Alejar"
              className="w-8 h-8 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-all"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>remove</span>
            </button>
            <button
              onClick={resetZoom}
              title="Restablecer zoom"
              className="h-8 px-2 rounded-full text-xs font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-all min-w-12"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => zoomFromCenter(1.25)}
              title="Acercar"
              className="w-8 h-8 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-all"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>add</span>
            </button>
          </div>
          {/* En móvil: chip de zoom solo cuando no está al 100% (pellizca para ajustar) */}
          {zoom !== 1 && (
            <button
              onClick={resetZoom}
              title="Restablecer zoom"
              className="sm:hidden h-8 px-2.5 rounded-full bg-surface-container text-xs font-bold text-on-surface transition-all"
            >
              {Math.round(zoom * 100)}%
            </button>
          )}
          {/* Fondo */}
          <div className="relative">
            <button
              onClick={() => setFondoOpen((v) => !v)}
              title="Cambiar el fondo del tablero"
              className="w-8 h-8 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-all"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>texture</span>
            </button>
            {fondoOpen && (
              <div className="absolute right-0 bottom-10 z-50 bg-surface-container-lowest border border-outline-variant/25 rounded-2xl shadow-xl p-2 flex gap-2">
                {FONDOS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => handleFondo(f.id)}
                    title={f.label}
                    className={`w-12 h-12 rounded-xl border overflow-hidden ideas-board-${f.id} bg-surface-container-lowest ${
                      fondo === f.id ? "border-primary ring-2 ring-primary/30" : "border-outline-variant/30"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
          {/* Ordenar */}
          <button
            onClick={handleArrange}
            disabled={notes.length === 0}
            title="Acomodar todas las notas en cuadricula"
            className="w-8 h-8 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>grid_view</span>
          </button>
          {/* Copiar */}
          <button
            onClick={handleCopyAll}
            disabled={notes.length === 0}
            title="Copiar las ideas visibles como Markdown"
            className="w-8 h-8 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>content_copy</span>
          </button>
          {/* Repaso IA */}
          <button
            onClick={handleRepaso}
            disabled={notes.length < 2}
            title="Repaso del mural con IA"
            className="h-8 px-3 rounded-full bg-secondary/15 text-secondary hover:bg-secondary/25 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span>
            <span className="hidden md:inline">Repaso</span>
          </button>
        </div>
      </div>

      {/* Panel de repaso IA */}
      <RepasoSheet
        open={repaso.open}
        loading={repaso.loading}
        data={repaso.data}
        onClose={() => setRepaso((r) => ({ ...r, open: false }))}
      />
    </div>
  );
}
