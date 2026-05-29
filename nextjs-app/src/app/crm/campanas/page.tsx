"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  mapCampanaDoc,
  formatRangoFechas,
  closeCampana,
  reopenCampana,
  deleteCampana,
  type Campana,
} from "@/lib/api/campanas";
import CampanaFormModal from "@/components/crm/campanas/CampanaFormModal";
import toast from "react-hot-toast";

interface PedidoLite {
  id: string;
  campana_id: string;
  plantilla_origen: string;
  estatus: string;
  precio: number;
  orderNumber: string | null;
  telefono: string;
  fechaMs: number;
  producto: string;
}

interface PlantillaKPI {
  plantilla: string;
  contactados: number;
  pedidos: number;
  pagados: number;
  monto: number;
}

const ESTATUS_PAGADO = "Pagado";

function formatMoney(n: number): string {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

function formatPct(num: number, den: number): string {
  if (!den) return "—";
  const v = (num / den) * 100;
  return `${v.toFixed(1)}%`;
}

export default function CampanasPage() {
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [loadingCampanas, setLoadingCampanas] = useState(true);

  // Solo cargamos pedidos que tengan campana_id asignado (filtro server-side)
  const [pedidos, setPedidos] = useState<PedidoLite[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Campana | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const q = query(collection(db, "campanas"), orderBy("creada_en", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => mapCampanaDoc(d.id, d.data()));
        setCampanas(list);
        // Auto-expandir activas por default la primera vez
        setExpanded((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          const next: Record<string, boolean> = {};
          list.forEach((c) => {
            if (c.estatus === "activa") next[c.id] = true;
          });
          return next;
        });
        setLoadingCampanas(false);
      },
      (err) => {
        console.error("[Campanas] Error cargando campañas:", err);
        toast.error("Error cargando campañas");
        setLoadingCampanas(false);
      }
    );
    return () => unsub();
  }, []);

  // Listener de pedidos con campana_id != null (índice cubre campana_id + plantilla_origen)
  useEffect(() => {
    const q = query(collection(db, "pedidos"), where("campana_id", "!=", null));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PedidoLite[] = snap.docs.map((d) => {
          const v = d.data() as Record<string, unknown>;
          const consec = v.consecutiveOrderNumber;
          const created = v.createdAt as { toMillis?: () => number } | undefined;
          return {
            id: d.id,
            campana_id: (v.campana_id as string) || "",
            plantilla_origen: (v.plantilla_origen as string) || "",
            estatus: (v.estatus as string) || "",
            precio: typeof v.precio === "number" ? v.precio : (parseFloat(v.precio as string) || 0),
            orderNumber: consec ? `DH${consec}` : null,
            telefono: (v.telefono as string) || "",
            fechaMs: created?.toMillis ? created.toMillis() : 0,
            producto: (v.producto as string) || "",
          };
        });
        setPedidos(list);
      },
      (err) => {
        console.warn("[Campanas] Error cargando pedidos con campaña:", err);
      }
    );
    return () => unsub();
  }, []);

  // Index pedidos por campana_id + plantilla_origen para KPIs O(1)
  const pedidosIndex = useMemo(() => {
    const idx: Record<string, Record<string, PedidoLite[]>> = {};
    for (const p of pedidos) {
      if (!p.campana_id) continue;
      const plantilla = p.plantilla_origen || "(sin plantilla)";
      if (!idx[p.campana_id]) idx[p.campana_id] = {};
      if (!idx[p.campana_id][plantilla]) idx[p.campana_id][plantilla] = [];
      idx[p.campana_id][plantilla].push(p);
    }
    return idx;
  }, [pedidos]);

  // Campañas virtuales: campana_ids presentes en pedidos pero sin doc en la colección.
  // Tipicamente "tpl:<templateName>" — pedidos taggeados con plantilla de Meta directamente.
  const campanasVirtuales = useMemo<Campana[]>(() => {
    const realIds = new Set(campanas.map((c) => c.id));
    const virtualIds = Object.keys(pedidosIndex).filter((id) => !realIds.has(id));
    return virtualIds.map((id) => {
      // Cada plantilla_origen única que aparezca en pedidos de esta campana_id
      const plantillas: Record<string, { contactados: number; notas: string }> = {};
      Object.keys(pedidosIndex[id] || {}).forEach((p) => {
        plantillas[p] = { contactados: 0, notas: "" };
      });
      const isTpl = id.startsWith("tpl:");
      return {
        id,
        nombre: isTpl ? `📨 ${id.slice(4)}` : `Campaña ${id.slice(0, 8)}`,
        fecha_inicio: null,
        fecha_fin: null,
        estatus: "activa",
        plantillas,
        notas: "",
        creada_por: "",
        creada_en: null,
      } as Campana;
    });
  }, [campanas, pedidosIndex]);

  // Lista combinada (reales + virtuales) para renderizar
  const allCampanas = useMemo(() => [...campanas, ...campanasVirtuales], [campanas, campanasVirtuales]);

  function getKPIsForCampana(c: Campana): {
    plantillas: PlantillaKPI[];
    totalContactados: number;
    totalPedidos: number;
    totalPagados: number;
    totalMonto: number;
  } {
    const campanaPedidos = pedidosIndex[c.id] ?? {};
    const plantillasDeclaradas = Object.keys(c.plantillas);
    const plantillasUsadas = Object.keys(campanaPedidos);
    // Unión de plantillas declaradas + las que aparezcan en pedidos (por si alguien tagueó con un nombre no declarado)
    const allPlantillas = Array.from(new Set([...plantillasDeclaradas, ...plantillasUsadas]));

    const kpis: PlantillaKPI[] = allPlantillas.map((p) => {
      const pedidosDeEsta = campanaPedidos[p] ?? [];
      const pagados = pedidosDeEsta.filter((x) => x.estatus === ESTATUS_PAGADO);
      const monto = pagados.reduce((sum, x) => sum + (x.precio || 0), 0);
      const contactados = c.plantillas[p]?.contactados ?? 0;
      return {
        plantilla: p,
        contactados,
        pedidos: pedidosDeEsta.length,
        pagados: pagados.length,
        monto,
      };
    });

    return {
      plantillas: kpis,
      totalContactados: kpis.reduce((s, k) => s + k.contactados, 0),
      totalPedidos: kpis.reduce((s, k) => s + k.pedidos, 0),
      totalPagados: kpis.reduce((s, k) => s + k.pagados, 0),
      totalMonto: kpis.reduce((s, k) => s + k.monto, 0),
    };
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleNueva() {
    setEditing(null);
    setModalOpen(true);
  }

  function handleEditar(c: Campana) {
    setEditing(c);
    setModalOpen(true);
  }

  async function handleToggleEstatus(c: Campana) {
    try {
      if (c.estatus === "activa") {
        if (!confirm(`¿Cerrar la campaña "${c.nombre}"? Ya no aparecerá en el selector de pedidos nuevos.`)) return;
        await closeCampana(c.id);
        toast.success("Campaña cerrada");
      } else {
        await reopenCampana(c.id);
        toast.success("Campaña reabierta");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  async function handleEliminar(c: Campana) {
    if (!confirm(`¿Eliminar la campaña "${c.nombre}"? Los pedidos tagueados con ella conservan el tag pero ya no se podrán reportar.`)) return;
    try {
      await deleteCampana(c.id);
      toast.success("Campaña eliminada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  function handleExportCSV(c: Campana) {
    const kpis = getKPIsForCampana(c);
    const rows: string[] = [];
    rows.push(["Plantilla", "Contactados", "Pedidos", "Pagados", "Conversion", "Monto MXN", "Ticket promedio"].join(","));
    for (const k of kpis.plantillas) {
      const conv = k.contactados > 0 ? ((k.pagados / k.contactados) * 100).toFixed(2) + "%" : "";
      const ticket = k.pagados > 0 ? (k.monto / k.pagados).toFixed(2) : "";
      rows.push([
        `"${k.plantilla.replace(/"/g, '""')}"`,
        k.contactados,
        k.pedidos,
        k.pagados,
        conv,
        k.monto.toFixed(2),
        ticket,
      ].join(","));
    }
    rows.push("");
    rows.push([
      "TOTAL",
      kpis.totalContactados,
      kpis.totalPedidos,
      kpis.totalPagados,
      kpis.totalContactados > 0 ? ((kpis.totalPagados / kpis.totalContactados) * 100).toFixed(2) + "%" : "",
      kpis.totalMonto.toFixed(2),
      "",
    ].join(","));

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${c.nombre.replace(/[^a-z0-9]+/gi, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="px-4 sm:px-6 py-5 max-w-7xl mx-auto">
      {/* Barra de tabs de comunicación masiva (mismo set que /audiencias, /cobranza, etc.) */}
      <div className="inline-flex flex-wrap gap-1 mb-4 p-1 rounded-lg" style={{ background: "#e8eeed" }}>
        <a href="/audiencias/" className="px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors hover:bg-black/5" style={{ color: "#1B4D5C" }}>Audiencias</a>
        <a href="/cobranza/" className="px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors hover:bg-black/5" style={{ color: "#1B4D5C" }}>Cobranza</a>
        <a href="/retargeting/" className="px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors hover:bg-black/5" style={{ color: "#1B4D5C" }}>Retargeting (Pagados)</a>
        <a href="/retargeting/nuevos/" className="px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors hover:bg-black/5" style={{ color: "#1B4D5C" }}>Retargeting (Nuevos)</a>
        <a href="/retargeting/#calculadora" className="px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors hover:bg-black/5" style={{ color: "#1B4D5C" }}>Calculadora</a>
        <span className="px-3.5 py-1.5 rounded-md text-[13px] font-semibold shadow-sm" style={{ background: "#1B4D5C", color: "#fff" }}>Campañas</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold font-headline text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 28 }}>campaign</span>
            Campañas
          </h1>
          <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5">
            Tracking de conversión por plantilla. Los pedidos se taguean desde el modal de pedido.
          </p>
        </div>
        <button
          onClick={handleNueva}
          className="px-4 py-2 rounded-xl text-sm font-bold text-on-primary bg-primary hover:opacity-90 transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Nueva campaña
        </button>
      </div>

      {loadingCampanas ? (
        <div className="bg-surface-container-low/50 rounded-2xl p-12 text-center text-sm text-on-surface-variant">
          Cargando campañas...
        </div>
      ) : allCampanas.length === 0 ? (
        <div className="bg-surface-container-low/50 rounded-2xl p-12 text-center">
          <span className="material-symbols-outlined text-on-surface-variant/40" style={{ fontSize: 48 }}>campaign</span>
          <p className="text-sm text-on-surface-variant mt-2">No hay campañas todavía.</p>
          <p className="text-xs text-on-surface-variant/70 mt-1">Crea una para empezar a medir conversión por plantilla.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {allCampanas.map((c) => {
            const kpis = getKPIsForCampana(c);
            const isOpen = expanded[c.id] ?? false;
            return (
              <div key={c.id} className="bg-surface-container-lowest border border-outline-variant/15 rounded-2xl overflow-hidden">
                {/* Header de la campaña */}
                <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
                  <button
                    onClick={() => toggleExpand(c.id)}
                    className="p-1 hover:bg-surface-container-low rounded-lg transition-all flex-shrink-0"
                    title={isOpen ? "Colapsar" : "Expandir"}
                  >
                    <span
                      className="material-symbols-outlined text-on-surface-variant"
                      style={{ fontSize: 22, transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                    >
                      chevron_right
                    </span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-on-surface truncate">{c.nombre}</h3>
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          c.estatus === "activa"
                            ? "bg-primary/15 text-primary"
                            : "bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        {c.estatus}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-0.5">{formatRangoFechas(c)}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 text-xs text-on-surface-variant flex-shrink-0">
                    <div className="text-right">
                      <div className="font-bold text-on-surface">{kpis.totalPagados} / {kpis.totalContactados}</div>
                      <div className="text-[10px]">Pagados / Contactados</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-primary">{formatPct(kpis.totalPagados, kpis.totalContactados)}</div>
                      <div className="text-[10px]">Conversión</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-on-surface">{formatMoney(kpis.totalMonto)}</div>
                      <div className="text-[10px]">Cobrado</div>
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-outline-variant/10 px-4 sm:px-5 py-4 bg-surface-container-low/30">
                    {/* KPIs por plantilla */}
                    {kpis.plantillas.length === 0 ? (
                      <p className="text-xs text-on-surface-variant italic py-2">
                        Esta campaña no tiene plantillas configuradas todavía.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/15">
                              <th className="text-left py-2 px-2">Plantilla</th>
                              <th className="text-right py-2 px-2">Contactados</th>
                              <th className="text-right py-2 px-2">Pedidos</th>
                              <th className="text-right py-2 px-2">Pagados</th>
                              <th className="text-right py-2 px-2">Conversión</th>
                              <th className="text-right py-2 px-2">Cobrado</th>
                              <th className="text-right py-2 px-2">Ticket prom.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kpis.plantillas.map((k) => {
                              const ticket = k.pagados > 0 ? k.monto / k.pagados : 0;
                              return (
                                <tr key={k.plantilla} className="border-b border-outline-variant/5 last:border-b-0">
                                  <td className="py-2 px-2 text-on-surface font-medium">{k.plantilla}</td>
                                  <td className="py-2 px-2 text-right text-on-surface-variant">{k.contactados}</td>
                                  <td className="py-2 px-2 text-right text-on-surface-variant">{k.pedidos}</td>
                                  <td className="py-2 px-2 text-right text-on-surface font-semibold">{k.pagados}</td>
                                  <td className="py-2 px-2 text-right">
                                    <span className="text-primary font-bold">{formatPct(k.pagados, k.contactados)}</span>
                                  </td>
                                  <td className="py-2 px-2 text-right text-on-surface font-semibold">{formatMoney(k.monto)}</td>
                                  <td className="py-2 px-2 text-right text-on-surface-variant">
                                    {ticket > 0 ? formatMoney(ticket) : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                            <tr className="bg-surface-container-low/50 font-bold">
                              <td className="py-2.5 px-2 text-on-surface">TOTAL</td>
                              <td className="py-2.5 px-2 text-right text-on-surface">{kpis.totalContactados}</td>
                              <td className="py-2.5 px-2 text-right text-on-surface">{kpis.totalPedidos}</td>
                              <td className="py-2.5 px-2 text-right text-on-surface">{kpis.totalPagados}</td>
                              <td className="py-2.5 px-2 text-right">
                                <span className="text-primary">{formatPct(kpis.totalPagados, kpis.totalContactados)}</span>
                              </td>
                              <td className="py-2.5 px-2 text-right text-on-surface">{formatMoney(kpis.totalMonto)}</td>
                              <td className="py-2.5 px-2 text-right text-on-surface-variant">
                                {kpis.totalPagados > 0 ? formatMoney(kpis.totalMonto / kpis.totalPagados) : "—"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Lista de pedidos pagados */}
                    {(() => {
                      const pagados = Object.values(pedidosIndex[c.id] ?? {})
                        .flat()
                        .filter((p) => p.estatus === ESTATUS_PAGADO)
                        .sort((a, b) => b.fechaMs - a.fechaMs);
                      if (pagados.length === 0) return null;
                      return (
                        <div className="mt-4">
                          <h4 className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant mb-2 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-primary" style={{ fontSize: 16 }}>paid</span>
                            Pedidos pagados ({pagados.length})
                          </h4>
                          <div className="overflow-x-auto rounded-xl border border-outline-variant/15 bg-surface-container-lowest">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-[10px] font-black uppercase tracking-wider text-on-surface-variant bg-surface-container-low/50">
                                  <th className="text-left py-2 px-3">Pedido</th>
                                  <th className="text-left py-2 px-3">Teléfono</th>
                                  <th className="text-left py-2 px-3">Producto</th>
                                  <th className="text-right py-2 px-3">Monto</th>
                                  <th className="text-right py-2 px-3">Fecha</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pagados.map((p) => (
                                  <tr key={p.id} className="border-t border-outline-variant/8 hover:bg-surface-container-low/40">
                                    <td className="py-2 px-3 font-bold text-primary">{p.orderNumber || "—"}</td>
                                    <td className="py-2 px-3 font-mono text-xs text-on-surface-variant">{p.telefono || "—"}</td>
                                    <td className="py-2 px-3 text-on-surface">{p.producto || "—"}</td>
                                    <td className="py-2 px-3 text-right font-semibold text-on-surface">{formatMoney(p.precio)}</td>
                                    <td className="py-2 px-3 text-right text-on-surface-variant text-xs">
                                      {p.fechaMs ? new Date(p.fechaMs).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}

                    {c.notas && (
                      <div className="mt-3 text-xs text-on-surface-variant italic px-2">
                        <span className="font-bold not-italic">Notas:</span> {c.notas}
                      </div>
                    )}

                    {/* Acciones */}
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      {!c.id.startsWith("tpl:") && (
                        <>
                          <button
                            onClick={() => handleEditar(c)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-on-surface bg-surface-container-high hover:bg-surface-container-highest transition-all flex items-center gap-1.5"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span>
                            Editar
                          </button>
                          <button
                            onClick={() => handleToggleEstatus(c)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-on-surface bg-surface-container-high hover:bg-surface-container-highest transition-all flex items-center gap-1.5"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                              {c.estatus === "activa" ? "lock" : "lock_open"}
                            </span>
                            {c.estatus === "activa" ? "Cerrar campaña" : "Reabrir"}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleExportCSV(c)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-on-surface bg-surface-container-high hover:bg-surface-container-highest transition-all flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
                        Exportar CSV
                      </button>
                      {!c.id.startsWith("tpl:") && (
                        <button
                          onClick={() => handleEliminar(c)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-error hover:bg-error/10 transition-all flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                          Eliminar
                        </button>
                      )}
                      {c.id.startsWith("tpl:") && (
                        <span className="px-3 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant bg-surface-container-low flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>auto_awesome</span>
                          Campaña automática (basada en plantilla)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <CampanaFormModal
          campana={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            /* onSnapshot ya refresca */
          }}
        />
      )}
    </div>
  );
}
