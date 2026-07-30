"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/lib/hooks/useAuth";
import LoadingOverlay from "@/components/layout/LoadingOverlay";
import {
  createNotebook,
  deleteNotebook,
  repasoEscritorio,
  saveDeskConfig,
  updateNotebook,
  type Notebook,
  type RepasoResult,
} from "@/lib/api/notebooks";
import NotebookCover, { NB_H, NB_W } from "@/components/ideas/NotebookCover";
import NotebookView from "@/components/ideas/NotebookView";
import NewNotebookDialog from "@/components/ideas/NewNotebookDialog";
import RepasoSheet from "@/components/ideas/RepasoSheet";
import { DEFAULT_COVER } from "@/components/ideas/covers";
import toast from "react-hot-toast";

const BOARD_MAX_W = 4000; // tope de crecimiento horizontal del escritorio
const BOARD_MAX_H = 4000; // tope de crecimiento vertical
const BOARD_PAD = 24;
const ECHO_MIN_DAYS = 3; // días sin abrir para que una libreta pida atención
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.5;

const FONDOS = [
  { id: "puntos", label: "Puntos" },
  { id: "cuadricula", label: "Cuadrícula" },
  { id: "renglones", label: "Renglones" },
  { id: "liso", label: "Liso" },
];

function mapDoc(id: string, d: Record<string, unknown>): Notebook {
  const updatedAt = d.updatedAt as { toMillis?: () => number } | undefined;
  return {
    id,
    title: typeof d.title === "string" ? d.title : "",
    cover: typeof d.cover === "string" ? d.cover : DEFAULT_COVER,
    x: typeof d.x === "number" ? d.x : 40,
    y: typeof d.y === "number" ? d.y : 40,
    rotation: typeof d.rotation === "number" ? d.rotation : 0,
    z: typeof d.z === "number" ? d.z : 1,
    pageCount: typeof d.pageCount === "number" ? d.pageCount : 1,
    searchText: typeof d.searchText === "string" ? d.searchText : "",
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

  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const [fondo, setFondo] = useState("puntos");
  const [fondoOpen, setFondoOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [exploredW, setExploredW] = useState(0);
  const [exploredH, setExploredH] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [repaso, setRepaso] = useState<{ open: boolean; loading: boolean; data: RepasoResult | null }>({
    open: false,
    loading: false,
    data: null,
  });

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const initialIdsRef = useRef<Set<string> | null>(null);
  const autoOpenedRef = useRef(false);
  const zoomRef = useRef(1);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const contentWRef = useRef(0);
  const contentHRef = useRef(0);

  // Requiere sesión (misma cuenta que el resto de la app).
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?redirect=${encodeURIComponent("/ideas")}`);
    }
  }, [user, authLoading, router]);

  // PWA propia: manifest + service worker mínimo (instalable en el cel).
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
  }, []);

  // Libretas en tiempo real (sincroniza entre dispositivos).
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "notebooks"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const remote = snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
        if (initialIdsRef.current === null) {
          initialIdsRef.current = new Set(remote.map((n) => n.id));
        }
        setNotebooks((prev) => {
          const dragId = draggingIdRef.current;
          if (!dragId) return remote;
          // Conservar la posición local de la libreta que se está arrastrando.
          const local = prev.find((p) => p.id === dragId);
          if (!local) return remote;
          return remote.map((n) => (n.id === dragId ? { ...n, x: local.x, y: local.y } : n));
        });
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [user]);

  // Config del escritorio (fondo).
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "ideas_config", "main"), (snap) => {
      const d = snap.data();
      if (d && typeof d.fondo === "string" && FONDOS.some((f) => f.id === d.fondo)) setFondo(d.fondo);
    });
    return () => unsub();
  }, [user]);

  // Medir el viewport del escritorio.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [authLoading, user]);

  // --- Zoom del escritorio (pellizco, Ctrl+rueda, botones) ---
  const applyZoom = useCallback((target: number, clientX: number, clientY: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const z0 = zoomRef.current;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target));
    if (z === z0) return;
    const rect = scroller.getBoundingClientRect();
    const px = (scroller.scrollLeft + clientX - rect.left) / z0;
    const py = (scroller.scrollTop + clientY - rect.top) / z0;
    zoomRef.current = z;
    pendingScrollRef.current = {
      left: px * z - (clientX - rect.left),
      top: py * z - (clientY - rect.top),
    };
    setZoom(z);
  }, []);

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
    // El punto medio del gesto ancla el contenido: separar dedos hace zoom,
    // moverlos juntos panea (lados, arriba/abajo y diagonal).
    let pinch: { d0: number; z0: number; midX: number; midY: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if ((e.target as HTMLElement).closest("[data-notebook]")) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const rect = scroller.getBoundingClientRect();
        pinch = {
          d0: Math.hypot(a.x - b.x, a.y - b.y),
          z0: zoomRef.current,
          midX: (a.x + b.x) / 2 - rect.left,
          midY: (a.y + b.y) / 2 - rect.top,
        };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = scroller.getBoundingClientRect();
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        const zPrev = zoomRef.current;
        const zNew =
          d > 0 && pinch.d0 > 0
            ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.z0 * (d / pinch.d0)))
            : zPrev;
        const px = (scroller.scrollLeft + pinch.midX) / zPrev;
        const py = (scroller.scrollTop + pinch.midY) / zPrev;
        const newLeft = px * zNew - midX;
        const newTop = py * zNew - midY;
        pinch.midX = midX;
        pinch.midY = midY;
        if (zNew !== zPrev) {
          zoomRef.current = zNew;
          pendingScrollRef.current = { left: newLeft, top: newTop };
          setZoom(zNew);
        } else {
          scroller.scrollLeft = newLeft;
          scroller.scrollTop = newTop;
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
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

  // El escritorio crece al mover libretas a los bordes y al panear hacia ellos.
  const contentW = useMemo(() => {
    const needed = notebooks.reduce((m, n) => Math.max(m, n.x + NB_W + 80), 0);
    return Math.min(BOARD_MAX_W, Math.max(viewSize.w / zoom, needed, exploredW));
  }, [notebooks, viewSize.w, zoom, exploredW]);

  const contentH = useMemo(() => {
    const needed = notebooks.reduce((m, n) => Math.max(m, n.y + NB_H + 80), 0);
    return Math.min(BOARD_MAX_H, Math.max(viewSize.h / zoom, needed, exploredH));
  }, [notebooks, viewSize.h, zoom, exploredH]);

  useEffect(() => {
    contentWRef.current = contentW;
    contentHRef.current = contentH;
  }, [contentW, contentH]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const GROW = 400;
    const EDGE = 60;
    const onScroll = () => {
      const z = zoomRef.current;
      if (scroller.scrollLeft + scroller.clientWidth >= contentWRef.current * z - EDGE) {
        setExploredW((w) => Math.min(BOARD_MAX_W, Math.max(w, contentWRef.current) + GROW));
      }
      if (scroller.scrollTop + scroller.clientHeight >= contentHRef.current * z - EDGE) {
        setExploredH((h) => Math.min(BOARD_MAX_H, Math.max(h, contentHRef.current) + GROW));
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [authLoading, user]);

  const maxZ = notebooks.reduce((m, n) => Math.max(m, n.z), 0);

  const q = norm(search.trim());
  // Busca en el título y en el texto de todas las hojas.
  const isDimmed = useCallback(
    (n: Notebook) => q !== "" && !norm(`${n.title} ${n.searchText}`).includes(q),
    [q]
  );
  const visibleCount = notebooks.filter((n) => !isDimmed(n)).length;

  // La libreta más olvidada pide atención con un halo sutil.
  const echo = useMemo(() => {
    const ahora = Date.now();
    let oldest: Notebook | null = null;
    for (const n of notebooks) {
      if (n.updatedAtMs === undefined) continue;
      if (!oldest || n.updatedAtMs < (oldest.updatedAtMs as number)) oldest = n;
    }
    if (!oldest) return null;
    const dias = Math.floor((ahora - (oldest.updatedAtMs as number)) / 86400000);
    return dias >= ECHO_MIN_DAYS ? { id: oldest.id, dias } : null;
  }, [notebooks]);

  const openNotebook = useMemo(
    () => notebooks.find((n) => n.id === openId) || null,
    [notebooks, openId]
  );

  // El botón atrás del teléfono cierra la libreta abierta en vez de salir de la app.
  useEffect(() => {
    if (!openId) return;
    window.history.pushState({ libreta: openId }, "");
    const onPop = () => setOpenId(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openId]);

  const closeNotebook = useCallback(() => {
    if (window.history.state?.libreta) window.history.back();
    else setOpenId(null);
  }, []);

  const handleCreate = useCallback(
    async (title: string, cover: string) => {
      const scroller = scrollerRef.current;
      const z = zoomRef.current;
      const w = (scroller?.clientWidth ?? 800) / z;
      const h = (scroller?.clientHeight ?? 600) / z;
      const sx = (scroller?.scrollLeft ?? 0) / z;
      const sy = (scroller?.scrollTop ?? 0) / z;
      const rand = (spread: number) => Math.round(Math.random() * spread - spread / 2);
      const x = Math.max(0, Math.min(sx + w - NB_W - 12, Math.round(sx + w / 2 - NB_W / 2 + rand(150))));
      const y = Math.max(0, Math.min(sy + h - NB_H - 12, Math.round(sy + h / 2 - NB_H / 2 + rand(90))));
      setCreating(true);
      try {
        const id = await createNotebook({
          title,
          cover,
          x,
          y,
          rotation: rand(7),
          z: maxZ + 1,
        });
        setDialogOpen(false);
        setSelectedId(id);
        setOpenId(id); // se abre lista para escribir
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo crear la libreta");
      } finally {
        setCreating(false);
      }
    },
    [maxZ]
  );

  // ?nueva=1 (acceso directo de la PWA): abrir el diálogo de nueva libreta.
  useEffect(() => {
    if (authLoading || !user || autoOpenedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("nueva") === "1") {
      autoOpenedRef.current = true;
      setDialogOpen(true);
      params.delete("nueva");
      const rest = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  }, [authLoading, user]);

  // Atajos: N nueva libreta, Escape deselecciona.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (openId || dialogOpen) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape" && !typing) {
        setSelectedId(null);
        return;
      }
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey || typing) return;
      e.preventDefault();
      setDialogOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, dialogOpen]);

  const handleMove = useCallback((id: string, x: number, y: number) => {
    draggingIdRef.current = id;
    setNotebooks((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, []);

  const handlePersistPosition = useCallback((id: string, x: number, y: number) => {
    draggingIdRef.current = null;
    updateNotebook(id, { x, y }).catch((err) =>
      toast.error(err instanceof Error ? err.message : "Error al mover")
    );
  }, []);

  const handleFocus = useCallback((id: string) => {
    setNotebooks((prev) => {
      const top = prev.reduce((m, n) => Math.max(m, n.z), 0);
      const current = prev.find((n) => n.id === id);
      if (current && current.z === top) return prev;
      const newZ = top + 1;
      updateNotebook(id, { z: newZ }).catch(() => {});
      return prev.map((n) => (n.id === id ? { ...n, z: newZ } : n));
    });
  }, []);

  const handleDelete = useCallback((id: string) => {
    setNotebooks((prev) => prev.filter((n) => n.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    deleteNotebook(id)
      .then(() => toast.success("Libreta eliminada"))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Error al eliminar"));
  }, []);

  const handleRepaso = useCallback(async () => {
    setRepaso({ open: true, loading: true, data: null });
    try {
      const data = await repasoEscritorio();
      setRepaso({ open: true, loading: false, data });
    } catch (err) {
      setRepaso({ open: false, loading: false, data: null });
      toast.error(err instanceof Error ? err.message : "No se pudo generar el repaso");
    }
  }, []);

  const handleFondo = useCallback((id: string) => {
    setFondo(id);
    setFondoOpen(false);
    saveDeskConfig({ fondo: id }).catch(() => toast.error("No se pudo guardar el fondo"));
  }, []);

  // Acomodar las libretas en una cuadrícula.
  const handleArrange = useCallback(async () => {
    const scroller = scrollerRef.current;
    if (!scroller || notebooks.length === 0) return;
    const W = scroller.clientWidth / zoomRef.current;
    const GAP = 26;
    const sorted = [...notebooks].sort((a, b) => a.y - b.y || a.x - b.x);
    let cx = BOARD_PAD;
    let cy = BOARD_PAD;
    const moves: { id: string; x: number; y: number; rotation: number }[] = [];
    for (const n of sorted) {
      if (cx + NB_W > W - BOARD_PAD && cx > BOARD_PAD) {
        cx = BOARD_PAD;
        cy += NB_H + GAP;
      }
      moves.push({ id: n.id, x: cx, y: cy, rotation: Math.round(Math.random() * 5 - 2.5) });
      cx += NB_W + GAP;
    }
    setNotebooks((prev) =>
      prev.map((n) => {
        const m = moves.find((mv) => mv.id === n.id);
        return m ? { ...n, x: m.x, y: m.y, rotation: m.rotation } : n;
      })
    );
    setExploredW(0);
    setExploredH(0);
    scroller.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    try {
      await Promise.all(moves.map((m) => updateNotebook(m.id, { x: m.x, y: m.y, rotation: m.rotation })));
      toast.success("Escritorio ordenado");
    } catch {
      toast.error("No se pudieron guardar todas las posiciones");
    }
  }, [notebooks]);

  // Copiar el contenido de las libretas visibles como Markdown.
  const handleCopyAll = useCallback(async () => {
    const visibles = notebooks.filter((n) => !isDimmed(n));
    if (visibles.length === 0) {
      toast("No hay libretas para copiar");
      return;
    }
    const hoy = new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    const md =
      `# Mis libretas — ${hoy}\n\n` +
      visibles
        .map((n) => `## ${n.title || "Sin título"}\n\n${n.searchText.trim() || "_(sin texto aún)_"}`)
        .join("\n\n");
    try {
      await navigator.clipboard.writeText(md);
      toast.success(`${visibles.length} libreta${visibles.length === 1 ? "" : "s"} copiada${visibles.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("No se pudo copiar al portapapeles");
    }
  }, [notebooks, isDimmed]);

  if (authLoading || !user) {
    return <LoadingOverlay />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Encabezado */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-6 pt-4 pb-2.5 flex-shrink-0">
        <div className="flex items-center gap-3 mr-auto">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ backgroundColor: "#FEF08A", transform: "rotate(-4deg)" }}
          >
            <span className="material-symbols-outlined text-gray-800" style={{ fontSize: 20 }}>
              auto_stories
            </span>
          </div>
          <div>
            <h1 className="text-xl font-bold font-headline text-on-surface leading-tight">Ideas</h1>
            <p className="text-xs text-on-surface-variant">
              {q
                ? `${visibleCount} de ${notebooks.length} libreta${notebooks.length === 1 ? "" : "s"}`
                : `${notebooks.length} libreta${notebooks.length === 1 ? "" : "s"} · tu escritorio`}
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
            placeholder="Buscar en tus libretas…"
            className="w-full bg-surface-container-low border border-outline-variant/30 rounded-full pl-9 pr-8 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:border-primary/50 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
              title="Limpiar búsqueda"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          )}
        </div>

        <button
          onClick={() => setDialogOpen(true)}
          title="Nueva libreta (atajo: N)"
          className="h-9 bg-primary text-on-primary px-4 rounded-full text-sm font-bold flex items-center gap-1.5 hover:opacity-90 transition-all shadow-sm flex-shrink-0"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          <span className="hidden sm:inline">Nueva libreta</span>
        </button>
      </header>

      {/* Escritorio */}
      <div
        ref={scrollerRef}
        className="relative flex-1 mx-3 md:mx-6 rounded-2xl border border-outline-variant/20 overflow-auto bg-surface-container-lowest"
        style={{ touchAction: "pan-x pan-y" }}
      >
        <div style={{ width: Math.round(contentW * zoom), height: Math.round(contentH * zoom) }}>
          <div
            ref={boardRef}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
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
            ) : notebooks.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
                <div className="w-24 h-32 rounded-[4px] overflow-hidden shadow-xl mb-5" style={{ transform: "rotate(-5deg)" }}>
                  <div className="w-full h-full bg-[#F7E3D4] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[#C4562C]" style={{ fontSize: 40 }}>
                      auto_stories
                    </span>
                  </div>
                </div>
                <p className="text-base font-semibold text-on-surface mb-1">Tu escritorio está vacío</p>
                <p className="text-sm text-on-surface-variant max-w-xs">
                  Crea tu primera libreta con{" "}
                  <span className="font-semibold">“Nueva libreta”</span> o la tecla{" "}
                  <kbd className="px-1.5 py-0.5 rounded bg-surface-container text-xs font-bold">N</kbd>. Cada
                  libreta es un tema.
                </p>
              </div>
            ) : (
              notebooks.map((nb) => (
                <NotebookCover
                  key={nb.id}
                  notebook={nb}
                  boundsRef={boardRef}
                  zoom={zoom}
                  dimmed={isDimmed(nb)}
                  selected={selectedId === nb.id}
                  echoDays={echo && echo.id === nb.id && !q ? echo.dias : null}
                  justBorn={initialIdsRef.current !== null && !initialIdsRef.current.has(nb.id)}
                  onOpen={setOpenId}
                  onSelect={setSelectedId}
                  onMove={handleMove}
                  onPersistPosition={handlePersistPosition}
                  onDelete={handleDelete}
                  onFocus={handleFocus}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Barra inferior: zoom + acciones del escritorio */}
      <div
        className="flex items-center gap-1.5 px-4 md:px-6 pt-2.5 flex-shrink-0"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {/* Zoom */}
        <div className="hidden sm:flex items-center gap-0.5">
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
        {zoom !== 1 && (
          <button
            onClick={resetZoom}
            title="Restablecer zoom"
            className="sm:hidden h-8 px-2.5 rounded-full bg-surface-container text-xs font-bold text-on-surface"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}

        <div className="flex-1" />

        {/* Fondo */}
        <div className="relative">
          <button
            onClick={() => setFondoOpen((v) => !v)}
            title="Cambiar el fondo del escritorio"
            className="w-8 h-8 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-all"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>texture</span>
          </button>
          {fondoOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFondoOpen(false)} />
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
            </>
          )}
        </div>
        {/* Ordenar */}
        <button
          onClick={handleArrange}
          disabled={notebooks.length === 0}
          title="Acomodar las libretas"
          className="w-8 h-8 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-all disabled:opacity-40 disabled:pointer-events-none"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>grid_view</span>
        </button>
        {/* Copiar */}
        <button
          onClick={handleCopyAll}
          disabled={notebooks.length === 0}
          title="Copiar las libretas visibles como Markdown"
          className="w-8 h-8 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-all disabled:opacity-40 disabled:pointer-events-none"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>content_copy</span>
        </button>
        {/* Repaso IA */}
        <button
          onClick={handleRepaso}
          disabled={notebooks.length < 2}
          title="Repaso del escritorio con IA"
          className="h-8 px-3 rounded-full bg-secondary/15 text-secondary hover:bg-secondary/25 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span>
          <span className="hidden md:inline">Repaso</span>
        </button>
      </div>

      {/* Libreta abierta */}
      {openNotebook && <NotebookView notebook={openNotebook} onClose={closeNotebook} />}

      {/* Nueva libreta */}
      <NewNotebookDialog
        open={dialogOpen}
        saving={creating}
        onCancel={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />

      {/* Repaso IA */}
      <RepasoSheet
        open={repaso.open}
        loading={repaso.loading}
        data={repaso.data}
        onClose={() => setRepaso((r) => ({ ...r, open: false }))}
      />
    </div>
  );
}
