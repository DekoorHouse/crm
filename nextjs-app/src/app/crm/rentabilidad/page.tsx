"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import {
  fetchProfitability,
  type ProfitabilityResponse,
  type ProfitabilityRow,
} from "@/lib/api/profitability";

type SortKey = "profit" | "spend" | "ingresos" | "pagados" | "roas" | "tasaPago";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
function firstOfMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const PRESETS: { id: string; label: string; from: () => string; to: () => string }[] = [
  { id: "today", label: "Hoy", from: () => todayStr(), to: () => todayStr() },
  { id: "7d", label: "7 días", from: () => daysAgoStr(6), to: () => todayStr() },
  { id: "30d", label: "30 días", from: () => daysAgoStr(29), to: () => todayStr() },
  { id: "month", label: "Este mes", from: () => firstOfMonthStr(), to: () => todayStr() },
  { id: "ytd", label: "Año", from: () => `${new Date().getFullYear()}-01-01`, to: () => todayStr() },
];

function fmtMoney(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(1)}k`;
  }
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function fmtNum(n: number | null, suffix = ""): string {
  if (n === null || n === undefined) return "—";
  return `${n.toLocaleString("es-MX", { maximumFractionDigits: 2 })}${suffix}`;
}

export default function RentabilidadPage() {
  const [data, setData] = useState<ProfitabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState<string>(firstOfMonthStr());
  const [to, setTo] = useState<string>(todayStr());
  const [groupBy, setGroupBy] = useState<"ad" | "campaign">("ad");
  const [sortBy, setSortBy] = useState<SortKey>("profit");
  const [activePreset, setActivePreset] = useState<string>("month");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchProfitability({ from, to, groupBy });
      setData(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [from, to, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setActivePreset(id);
    setFrom(p.from());
    setTo(p.to());
  };

  const sortedFilas = useMemo(() => {
    if (!data) return [];
    return [...data.filas].sort((a, b) => {
      const av = (a[sortBy] ?? 0) as number;
      const bv = (b[sortBy] ?? 0) as number;
      return bv - av;
    });
  }, [data, sortBy]);

  const maxDailyValue = useMemo(() => {
    if (!data) return 1;
    return Math.max(
      1,
      ...data.curvaDiaria.map((d) => Math.max(d.spend, d.ingresos, d.pipeline))
    );
  }, [data]);

  const maxHistogram = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.histogramaTiempoAPago.map((b) => b.count));
  }, [data]);

  return (
    <div className="p-6 space-y-6 bg-surface min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Rentabilidad</h1>
          <p className="text-sm text-on-surface-variant">
            {data ? `${data.range.from} → ${data.range.to}` : "Cargando..."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Presets */}
          <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activePreset === p.id
                    ? "bg-primary text-white shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setActivePreset("");
            }}
            className="bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-1.5 text-xs text-on-surface"
          />
          <span className="text-on-surface-variant text-xs">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setActivePreset("");
            }}
            className="bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-1.5 text-xs text-on-surface"
          />

          {/* Toggle ad/campaign */}
          <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1">
            <button
              onClick={() => setGroupBy("ad")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                groupBy === "ad"
                  ? "bg-primary text-white shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              Anuncio
            </button>
            <button
              onClick={() => setGroupBy("campaign")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                groupBy === "campaign"
                  ? "bg-primary text-white shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              Campaña
            </button>
          </div>

          <button
            onClick={load}
            disabled={loading}
            className="bg-primary/10 text-primary hover:bg-primary/20 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50"
            title="Refrescar"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {loading ? "hourglass_empty" : "refresh"}
            </span>
          </button>
        </div>
      </div>

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Spend" value={fmtMoney(data.totals.spend)} icon="payments" tone="neutral" />
            <KpiCard label="Ingresos" value={fmtMoney(data.totals.ingresos)} icon="trending_up" tone="success" />
            <KpiCard label="Costos" value={fmtMoney(data.totals.costos)} icon="inventory" tone="neutral" />
            <KpiCard
              label="Profit neto"
              value={fmtMoney(data.totals.profit)}
              icon="account_balance"
              tone={data.totals.profit >= 0 ? "success" : "danger"}
              big
            />
            <KpiCard label="Pedidos" value={String(data.totals.pedidos)} icon="receipt_long" tone="neutral" />
            <KpiCard
              label="Pagados"
              value={`${data.totals.pagados} (${fmtPct(data.totals.tasaPago)})`}
              icon="check_circle"
              tone="success"
            />
            <KpiCard
              label="ROAS"
              value={data.totals.roas !== null ? `${data.totals.roas.toFixed(2)}x` : "—"}
              icon="show_chart"
              tone={data.totals.roas && data.totals.roas >= 1 ? "success" : "danger"}
            />
            <KpiCard
              label="Días lead → pago"
              value={data.totals.diasPromedioLeadAPago !== null ? `${data.totals.diasPromedioLeadAPago}d` : "—"}
              icon="schedule"
              tone="neutral"
            />
          </div>

          {/* Pipeline */}
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 flex items-center gap-4 flex-wrap">
            <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 32 }}>
              pending_actions
            </span>
            <div className="flex-1 min-w-[200px]">
              <p className="text-xs text-on-surface-variant uppercase tracking-wide font-bold">
                Pipeline pendiente
              </p>
              <p className="text-lg text-on-surface mt-1">
                <span className="font-bold text-amber-700">{data.pipeline.pedidosPendientes}</span> pedidos
                sin cobrar por <span className="font-bold text-amber-700">{fmtMoney(data.pipeline.valorPendiente)}</span>
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Esperado cobrar (a tasa histórica de {fmtPct(data.totals.tasaPago)}):{" "}
                <span className="font-semibold">{fmtMoney(data.pipeline.esperadoCobrar)}</span>
              </p>
            </div>
          </div>

          {/* Curva diaria */}
          <div className="rounded-2xl bg-surface-container-low p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-on-surface uppercase tracking-wide">Curva diaria</h2>
              <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                <Legend color="bg-blue-500" label="Spend" />
                <Legend color="bg-green-500" label="Ingresos" />
                <Legend color="bg-amber-400" label="Pipeline" />
              </div>
            </div>
            {data.curvaDiaria.length === 0 ? (
              <p className="text-xs text-on-surface-variant py-8 text-center">Sin datos para este rango.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1 h-48 min-w-max">
                  {data.curvaDiaria.map((d) => (
                    <div
                      key={d.date}
                      className="flex flex-col items-center gap-1 group relative"
                      style={{ minWidth: 40 }}
                    >
                      <div className="flex items-end gap-0.5 h-40">
                        <div
                          className="w-2 bg-blue-500 rounded-sm"
                          style={{ height: `${(d.spend / maxDailyValue) * 100}%` }}
                          title={`Spend: ${fmtMoney(d.spend)}`}
                        />
                        <div
                          className="w-2 bg-green-500 rounded-sm"
                          style={{ height: `${(d.ingresos / maxDailyValue) * 100}%` }}
                          title={`Ingresos: ${fmtMoney(d.ingresos)}`}
                        />
                        <div
                          className={`w-2 rounded-sm ${
                            d.incompleto ? "bg-amber-400 opacity-60" : "bg-amber-400"
                          }`}
                          style={{ height: `${(d.pipeline / maxDailyValue) * 100}%` }}
                          title={`Pipeline: ${fmtMoney(d.pipeline)}`}
                        />
                      </div>
                      <span className="text-[9px] text-on-surface-variant">
                        {d.date.slice(5)}
                        {d.incompleto && (
                          <span className="text-amber-600" title="Datos aún cocinándose">
                            *
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-on-surface-variant mt-3">
                  * Días con pipeline aún cocinándose (últimos 7d) — esperan cobros.
                </p>
              </div>
            )}
          </div>

          {/* Histograma + Tabla side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Histograma tiempo a pago */}
            <div className="rounded-2xl bg-surface-container-low p-5 lg:col-span-1">
              <h2 className="text-sm font-bold text-on-surface uppercase tracking-wide mb-4">
                Tiempo lead → pago
              </h2>
              <div className="space-y-2">
                {data.histogramaTiempoAPago.map((b) => (
                  <div key={b.bucket} className="flex items-center gap-3">
                    <span className="text-xs text-on-surface-variant font-mono w-12">{b.bucket}</span>
                    <div className="flex-1 bg-surface-container rounded-md h-6 overflow-hidden relative">
                      <div
                        className="bg-primary h-full rounded-md transition-all"
                        style={{ width: `${(b.count / maxHistogram) * 100}%` }}
                      />
                      <span className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-on-surface">
                        {b.count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {data.totals.diasPromedioLeadAPago !== null && (
                <p className="text-[11px] text-on-surface-variant mt-4">
                  Promedio: <span className="font-bold text-on-surface">{data.totals.diasPromedioLeadAPago} días</span>
                </p>
              )}
            </div>

            {/* Tabla */}
            <div className="rounded-2xl bg-surface-container-low p-5 lg:col-span-2 overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-on-surface uppercase tracking-wide">
                  Por {groupBy === "ad" ? "anuncio" : "campaña"} ({sortedFilas.length})
                </h2>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className="bg-surface-container border border-outline-variant/20 rounded-lg px-2 py-1 text-xs text-on-surface"
                >
                  <option value="profit">Ordenar por: Profit</option>
                  <option value="spend">Spend</option>
                  <option value="ingresos">Ingresos</option>
                  <option value="pagados">Pagados</option>
                  <option value="roas">ROAS</option>
                  <option value="tasaPago">Tasa pago</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-on-surface-variant border-b border-outline-variant/20">
                      <th className="py-2 pr-2 font-semibold">{groupBy === "ad" ? "Anuncio" : "Campaña"}</th>
                      <th className="py-2 px-2 font-semibold text-right">Spend</th>
                      <th className="py-2 px-2 font-semibold text-right">Pedidos</th>
                      <th className="py-2 px-2 font-semibold text-right">Pagados</th>
                      <th className="py-2 px-2 font-semibold text-right">Ingresos</th>
                      <th className="py-2 px-2 font-semibold text-right">Profit</th>
                      <th className="py-2 px-2 font-semibold text-right">ROAS</th>
                      <th className="py-2 pl-2 font-semibold text-right">Días</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFilas.map((f) => (
                      <RowItem key={f.id} f={f} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {!data && loading && (
        <div className="text-center text-on-surface-variant py-12">Cargando...</div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  tone,
  big,
}: {
  label: string;
  value: string;
  icon: string;
  tone: "neutral" | "success" | "danger";
  big?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-green-600"
      : tone === "danger"
      ? "text-red-600"
      : "text-on-surface";
  const bgClass = big
    ? "bg-primary/10 border border-primary/30"
    : "bg-surface-container-low";
  return (
    <div className={`rounded-2xl p-4 ${bgClass}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-bold">{label}</p>
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 16 }}>
          {icon}
        </span>
      </div>
      <p className={`${big ? "text-xl" : "text-base"} font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function RowItem({ f }: { f: ProfitabilityRow }) {
  const isOrganic = f.id === "__organic__";
  return (
    <tr className="border-b border-outline-variant/10 hover:bg-surface-container/50 transition-colors">
      <td className="py-2 pr-2">
        <p className={`font-semibold ${isOrganic ? "text-on-surface-variant italic" : "text-on-surface"} truncate max-w-[200px]`} title={f.name}>
          {f.name}
        </p>
        {f.campaignName && (
          <p className="text-[10px] text-on-surface-variant truncate max-w-[200px]">{f.campaignName}</p>
        )}
      </td>
      <td className="py-2 px-2 text-right text-on-surface tabular-nums">{f.spend > 0 ? fmtMoney(f.spend) : "—"}</td>
      <td className="py-2 px-2 text-right text-on-surface tabular-nums">{f.pedidos}</td>
      <td className="py-2 px-2 text-right text-on-surface tabular-nums">
        {f.pagados}{" "}
        <span className="text-[10px] text-on-surface-variant">({fmtPct(f.tasaPago)})</span>
      </td>
      <td className="py-2 px-2 text-right text-on-surface tabular-nums">{fmtMoney(f.ingresos)}</td>
      <td
        className={`py-2 px-2 text-right tabular-nums font-bold ${
          f.profit >= 0 ? "text-green-600" : "text-red-600"
        }`}
      >
        {fmtMoney(f.profit)}
      </td>
      <td className="py-2 px-2 text-right text-on-surface tabular-nums">
        {f.roas !== null ? `${f.roas.toFixed(2)}x` : "—"}
      </td>
      <td className="py-2 pl-2 text-right text-on-surface-variant tabular-nums">
        {f.diasProm !== null ? `${f.diasProm}d` : "—"}
      </td>
    </tr>
  );
}
