"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/hooks/useAuth";
import { fetchDesglose, fetchDesgloseCampanas } from "@/lib/api/orders";
import type {
  CampanaDesglose,
  DesgloseCampanasResponse,
  DesgloseResponse,
  OrderFilters,
  PedidoDesglose,
  ProductoDesglose,
} from "@/lib/api/types";
import { STATUS_OPTIONS, getStatusConfig } from "@/lib/utils/statusConfig";
import Select from "@/components/ui/Select";
import type { SelectOption } from "@/components/ui/Select";
import ThemeMenu from "@/components/layout/ThemeMenu";
import LoadingOverlay from "@/components/layout/LoadingOverlay";

const DATE_OPTIONS: SelectOption[] = [
  { value: "ultimos-10-dias", label: "Últimos 10 días" },
  { value: "hoy", label: "Hoy" },
  { value: "ayer", label: "Ayer" },
  { value: "este-mes", label: "Este mes" },
];

const STATUS_SELECT_OPTIONS: SelectOption[] = [
  { value: "", label: "Todos" },
  ...STATUS_OPTIONS.map((s) => ({ value: s.label, label: s.label })),
];

type Agrupacion = "producto" | "campana";

const AGRUPACIONES: { value: Agrupacion; label: string; icon: string }[] = [
  { value: "producto", label: "Producto", icon: "inventory_2" },
  { value: "campana", label: "Campaña", icon: "campaign" },
];

// IDs de las cubetas que no son una campaña real (los pone el backend).
const ID_ORGANICO = "__organico__";
const ID_SIN_CAMPANA = "__sin_campana__";

// Las campañas necesitan tarjeta más ancha: sus nombres son del estilo
// "Ventas 1407//Corazones//4ads//" y en 220px no se alcanza a leer ninguno.
const GRID: Record<Agrupacion, string> = {
  producto: "[grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]",
  campana: "[grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]",
};

// Color fijo por producto (no del tema): la tarjeta tiene que verse igual en los
// cinco temas y el color solo sirve para distinguir un producto de otro.
const COLOR_PRODUCTO: Record<string, string> = {
  Corazón: "#d4537e",
  Especial: "#7f77dd",
  Guerreras: "#1d9e75",
  Spiderman: "#d85a30",
  Rex: "#378add",
  Muerto: "#ba7517",
};

const PALETA_FALLBACK = ["#6f42c1", "#0ea5e9", "#2e9e6b", "#fd7e14", "#c0392b", "#20c997"];

function hash(texto: string): number {
  let h = 0;
  for (let i = 0; i < texto.length; i++) {
    h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Los productos fuera del catálogo (pedidos viejos, nombres a mano) también
// necesitan color, y tiene que ser el mismo entre recargas.
function colorProducto(nombre: string): string {
  if (COLOR_PRODUCTO[nombre]) return COLOR_PRODUCTO[nombre];
  return PALETA_FALLBACK[hash(nombre) % PALETA_FALLBACK.length];
}

// Las campañas van por ID (no por nombre): si la renombran en Ads Manager, la
// tarjeta conserva su color y se sigue reconociendo de un vistazo.
function colorCampana(id: string): string {
  if (id === ID_ORGANICO) return "#6b7280";
  if (id === ID_SIN_CAMPANA) return "#9ca3af";
  return PALETA_FALLBACK[hash(id) % PALETA_FALLBACK.length];
}

const pesos = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export default function DesglosePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [dateFilter, setDateFilter] = useState("ultimos-10-dias");
  const [estatus, setEstatus] = useState("");
  const [agrupar, setAgrupar] = useState<Agrupacion>("producto");
  const [data, setData] = useState<DesgloseResponse | null>(null);
  const [dataCampanas, setDataCampanas] = useState<DesgloseCampanasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const cargar = useCallback(async (filters: OrderFilters, modo: Agrupacion) => {
    setLoading(true);
    setError(null);
    try {
      if (modo === "campana") {
        setDataCampanas(await fetchDesgloseCampanas(filters));
      } else {
        setData(await fetchDesglose(filters));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar el desglose");
      setData(null);
      setDataCampanas(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    cargar({ dateFilter, estatus: estatus || undefined }, agrupar);
  }, [user, dateFilter, estatus, agrupar, cargar]);

  if (authLoading || !user) return <LoadingOverlay />;

  const porCampana = agrupar === "campana";
  const actual = porCampana ? dataCampanas : data;

  const productos = data?.productos ?? [];
  const campanas = dataCampanas?.campanas ?? [];
  const totalPiezas = actual?.totalPiezas ?? 0;
  const filas = porCampana ? campanas : productos;
  const maxPiezas = filas.length > 0 ? filas[0].piezas : 0;

  // Los anuncios que la Graph API no pudo traducir se juntan en una tarjeta
  // "Campaña no identificada": hay que decir por qué, o parece un dato perdido.
  const anunciosSinResolver = dataCampanas
    ? dataCampanas.anunciosTotales - dataCampanas.anunciosResueltos
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-background/80 backdrop-blur-md sticky top-0 z-50 flex justify-between items-center px-8 py-4 border-b border-outline-variant/20">
        <nav className="flex items-center gap-2 text-sm font-medium text-on-surface-variant">
          <Link href="/pedidos" className="hover:text-on-surface transition-colors">
            Pedidos
          </Link>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-primary font-bold border-b-2 border-primary pb-1">Desglose</span>
        </nav>

        <div className="flex items-center gap-4">
          <ThemeMenu variant="icon" />
          <Link
            href="/pedidos"
            className="bg-surface-container-high text-on-surface-variant px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-surface-container-highest transition-all"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Volver a pedidos
          </Link>
        </div>
      </header>

      <section className="px-8 py-6">
        <div className="flex flex-wrap items-end justify-between gap-6 bg-surface-container-lowest p-6 rounded-3xl shadow-sm border border-outline-variant/10">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
                Rango de Fecha
              </label>
              <Select
                value={dateFilter}
                onChange={setDateFilter}
                options={DATE_OPTIONS}
                className="w-48"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
                Estatus
              </label>
              <Select
                value={estatus}
                onChange={setEstatus}
                options={STATUS_SELECT_OPTIONS}
                className="w-52"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
                Agrupar por
              </label>
              <div className="inline-flex gap-1 bg-surface-container-low rounded-xl p-1">
                {AGRUPACIONES.map((op) => (
                  <button
                    key={op.value}
                    type="button"
                    onClick={() => {
                      setAgrupar(op.value);
                      setExpandido(null);
                    }}
                    aria-pressed={agrupar === op.value}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                      agrupar === op.value
                        ? "bg-primary text-on-primary"
                        : "text-on-surface-variant hover:bg-surface-container"
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">{op.icon}</span>
                    {op.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-8 items-center border-l border-outline-variant/30 pl-8">
            <div className="text-center">
              <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">Piezas</p>
              <p className="text-xl font-black text-primary">{totalPiezas}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">Pedidos</p>
              <p className="text-xl font-black text-secondary">{actual?.totalPedidos ?? 0}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">Monto</p>
              <p className="text-xl font-black text-on-surface">
                {pesos.format(actual?.totalMonto ?? 0)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-8 pb-10">
        {actual?.truncado && (
          <div className="mb-4 px-4 py-3 rounded-2xl bg-error-container/40 border border-error/20 text-sm text-on-surface">
            El rango supera los {actual.max} pedidos. Se están contando los{" "}
            {actual.max} más recientes; acorta el rango para ver el total exacto.
          </div>
        )}

        {porCampana && !loading && !error && anunciosSinResolver > 0 && (
          <div className="mb-4 px-4 py-3 rounded-2xl bg-surface-container-high border border-outline-variant/20 text-sm text-on-surface-variant">
            <span className="font-bold text-on-surface">
              {anunciosSinResolver} de {dataCampanas?.anunciosTotales} anuncios
            </span>{" "}
            no se pudieron ligar a su campaña
            {dataCampanas?.metaError ? ` (${dataCampanas.metaError})` : " (anuncio borrado o sin acceso desde el token de Meta)"}
            . Sus pedidos están en la tarjeta «Campaña no identificada».
          </div>
        )}

        {error && (
          <div className="px-4 py-3 rounded-2xl bg-error-container/40 border border-error/20 text-sm text-on-surface">
            {error}
          </div>
        )}

        {loading && !error && (
          <div className={`grid gap-4 items-start ${GRID[agrupar]}`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-36 rounded-3xl bg-surface-container-lowest border border-outline-variant/10 animate-pulse"
              />
            ))}
          </div>
        )}

        {!loading && !error && filas.length === 0 && (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
              {porCampana ? "campaign" : "inventory_2"}
            </span>
            <p className="mt-3 text-sm text-on-surface-variant">
              No hay pedidos en este filtro.
            </p>
          </div>
        )}

        {!loading && !error && filas.length > 0 && (
          <div className={`grid gap-4 items-start ${GRID[agrupar]}`}>
            {porCampana
              ? campanas.map((c) => (
                  <TarjetaCampana
                    key={c.id}
                    campana={c}
                    totalPiezas={totalPiezas}
                    maxPiezas={maxPiezas}
                    abierto={expandido === c.id}
                    onToggle={() =>
                      setExpandido((abierta) => (abierta === c.id ? null : c.id))
                    }
                  />
                ))
              : productos.map((p) => (
                  <TarjetaProducto
                    key={p.producto}
                    producto={p}
                    totalPiezas={totalPiezas}
                    maxPiezas={maxPiezas}
                    abierto={expandido === p.producto}
                    onToggle={() =>
                      setExpandido((abierto) => (abierto === p.producto ? null : p.producto))
                    }
                  />
                ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface TarjetaProductoProps {
  producto: ProductoDesglose;
  totalPiezas: number;
  maxPiezas: number;
  abierto: boolean;
  onToggle: () => void;
}

function TarjetaProducto({
  producto,
  totalPiezas,
  maxPiezas,
  abierto,
  onToggle,
}: TarjetaProductoProps) {
  const color = colorProducto(producto.producto);
  const porcentaje = totalPiezas > 0 ? Math.round((producto.piezas / totalPiezas) * 100) : 0;
  // La barra se mide contra el producto más vendido, no contra el total: con seis
  // productos ninguna barra pasaría del 40% y todas se verían igual de cortas.
  const ancho = maxPiezas > 0 ? Math.round((producto.piezas / maxPiezas) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={abierto}
      className="text-left bg-surface-container-lowest rounded-3xl border border-outline-variant/10 shadow-sm p-5 hover:shadow-md hover:border-outline-variant/30 transition-all cursor-pointer"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-sm font-bold text-on-surface truncate">
            {producto.producto}
          </span>
        </div>
        <span className="text-xs font-bold text-on-surface-variant shrink-0">{porcentaje}%</span>
      </div>

      <p className="text-4xl font-black text-on-surface leading-none">{producto.piezas}</p>
      <p className="text-xs text-on-surface-variant mt-1.5">
        piezas · {producto.pedidos} {producto.pedidos === 1 ? "pedido" : "pedidos"} ·{" "}
        {pesos.format(producto.monto)}
      </p>

      <div className="mt-4 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${ancho}%`, backgroundColor: color }}
        />
      </div>

      <div className="flex items-center gap-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
        <span className="material-symbols-outlined text-sm">
          {abierto ? "expand_less" : "expand_more"}
        </span>
        {abierto ? "Ocultar detalle" : "Ver detalle"}
      </div>

      {abierto && (
        <div className="mt-3 pt-3 border-t border-outline-variant/20 space-y-4">
          <ListaEstatus porEstatus={producto.porEstatus} />
          <ListaFolios pedidos={producto.listaPedidos} total={producto.pedidos} />
        </div>
      )}
    </button>
  );
}

interface TarjetaCampanaProps {
  campana: CampanaDesglose;
  totalPiezas: number;
  maxPiezas: number;
  abierto: boolean;
  onToggle: () => void;
}

function TarjetaCampana({
  campana,
  totalPiezas,
  maxPiezas,
  abierto,
  onToggle,
}: TarjetaCampanaProps) {
  const color = colorCampana(campana.id);
  const porcentaje = totalPiezas > 0 ? Math.round((campana.piezas / totalPiezas) * 100) : 0;
  const ancho = maxPiezas > 0 ? Math.round((campana.piezas / maxPiezas) * 100) : 0;
  const esCampanaReal = campana.id !== ID_ORGANICO && campana.id !== ID_SIN_CAMPANA;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={abierto}
      className="text-left bg-surface-container-lowest rounded-3xl border border-outline-variant/10 shadow-sm p-5 hover:shadow-md hover:border-outline-variant/30 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
            style={{ backgroundColor: color }}
          />
          {/* El nombre completo va en el title: en la tarjeta se corta a dos
              líneas porque los nombres de campaña son larguísimos. */}
          <span className="text-sm font-bold text-on-surface line-clamp-2" title={campana.nombre}>
            {campana.nombre}
          </span>
        </div>
        <span className="text-xs font-bold text-on-surface-variant shrink-0">{porcentaje}%</span>
      </div>

      <p className="text-4xl font-black text-on-surface leading-none">{campana.piezas}</p>
      <p className="text-xs text-on-surface-variant mt-1.5">
        piezas · {campana.pedidos} {campana.pedidos === 1 ? "pedido" : "pedidos"} ·{" "}
        {pesos.format(campana.monto)}
      </p>

      <div className="mt-4 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${ancho}%`, backgroundColor: color }}
        />
      </div>

      <div className="flex items-center gap-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
        <span className="material-symbols-outlined text-sm">
          {abierto ? "expand_less" : "expand_more"}
        </span>
        {abierto ? "Ocultar detalle" : "Ver detalle"}
      </div>

      {abierto && (
        <div className="mt-3 pt-3 border-t border-outline-variant/20 space-y-4">
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
              Por producto
            </p>
            {campana.porProducto.map((pr) => (
              <div key={pr.producto} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 min-w-0 text-on-surface-variant">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: colorProducto(pr.producto) }}
                  />
                  <span className="truncate">{pr.producto}</span>
                </span>
                <span className="font-bold text-on-surface shrink-0">{pr.piezas}</span>
              </div>
            ))}
          </div>

          <ListaEstatus porEstatus={campana.porEstatus} />

          {campana.ads.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                {esCampanaReal
                  ? `Anuncios · ${campana.ads.length}`
                  : `IDs de anuncio sin campaña · ${campana.ads.length}`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {campana.ads.map((adId) => (
                  <span
                    key={adId}
                    className="rounded-lg bg-surface-container-high px-2 py-0.5 text-[11px] font-mono text-on-surface-variant"
                  >
                    {adId}
                  </span>
                ))}
              </div>
            </div>
          )}

          <ListaFolios pedidos={campana.listaPedidos} total={campana.pedidos} />
        </div>
      )}
    </button>
  );
}

function ListaEstatus({ porEstatus }: { porEstatus: Record<string, number> }) {
  const ordenado = Object.entries(porEstatus).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
        Por estatus
      </p>
      {ordenado.map(([nombre, piezas]) => (
        <div key={nombre} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-on-surface-variant truncate">{nombre}</span>
          <span className="font-bold text-on-surface shrink-0">{piezas}</span>
        </div>
      ))}
    </div>
  );
}

function ListaFolios({ pedidos, total }: { pedidos: PedidoDesglose[]; total: number }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
        Números de pedido · {total}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {pedidos.map((pd, i) => (
          <span
            key={`${pd.numero ?? "s"}-${i}`}
            title={pd.estatus}
            className="inline-flex items-center gap-1 rounded-lg bg-surface-container-high px-2 py-0.5 text-[11px] font-bold text-on-surface"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: getStatusConfig(pd.estatus).color }}
            />
            DH{pd.numero ?? "--"}
            {pd.piezas > 1 && (
              <span className="text-on-surface-variant font-normal">×{pd.piezas}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
