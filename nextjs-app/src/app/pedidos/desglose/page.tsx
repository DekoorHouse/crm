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
import ConversationPreview from "@/components/crm/ConversationPreview";
import toast from "react-hot-toast";

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

// El costo por pedido sí lleva centavos: la diferencia entre $92 y $92.60 sí
// importa cuando lo estás comparando contra el margen.
const pesosExactos = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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
  // Contacto cuya conversación se está viendo en el modal (se abre desde un folio).
  const [chatAbierto, setChatAbierto] = useState<string | null>(null);

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
  const totalPedidos = actual?.totalPedidos ?? 0;
  const filas = porCampana ? campanas : productos;
  // El backend ya ordena por pedidos, así que el primero es el máximo.
  const maxPedidos = filas.length > 0 ? filas[0].pedidos : 0;

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
              <p className="text-xl font-black text-primary">{actual?.totalPiezas ?? 0}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">Pedidos</p>
              <p className="text-xl font-black text-secondary">{totalPedidos}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">Monto</p>
              <p className="text-xl font-black text-on-surface">
                {pesos.format(actual?.totalMonto ?? 0)}
              </p>
            </div>
            {porCampana && dataCampanas?.costoPorPedidoGlobal != null && (
              <div
                className="text-center"
                title={`${pesos.format(dataCampanas.gastoTotal ?? 0)} gastados en publicidad ÷ ${totalPedidos} pedidos`}
              >
                <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">
                  Costo/pedido
                </p>
                <p className="text-xl font-black text-warning">
                  {pesosExactos.format(dataCampanas.costoPorPedidoGlobal)}
                </p>
              </div>
            )}
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

        {porCampana && !loading && !error && dataCampanas?.gastoError && (
          <div className="mb-4 px-4 py-3 rounded-2xl bg-surface-container-high border border-outline-variant/20 text-sm text-on-surface-variant">
            No se pudo traer el gasto de Meta ({dataCampanas.gastoError}), así que las
            tarjetas van sin costo por pedido. No es que las campañas no hayan gastado.
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
                    totalPedidos={totalPedidos}
                    maxPedidos={maxPedidos}
                    abierto={expandido === c.id}
                    onToggle={() =>
                      setExpandido((abierta) => (abierta === c.id ? null : c.id))
                    }
                    onAbrirChat={setChatAbierto}
                  />
                ))
              : productos.map((p) => (
                  <TarjetaProducto
                    key={p.producto}
                    producto={p}
                    totalPedidos={totalPedidos}
                    maxPedidos={maxPedidos}
                    abierto={expandido === p.producto}
                    onToggle={() =>
                      setExpandido((abierto) => (abierto === p.producto ? null : p.producto))
                    }
                    onAbrirChat={setChatAbierto}
                  />
                ))}
          </div>
        )}
      </section>

      {chatAbierto && (
        <ConversationPreview
          // El desglose no carga contactos: el modal lee la conversación de
          // Firestore con el puro id, y el nombre lo pinta el propio chat.
          contact={{ id: chatAbierto, name: "" }}
          onClose={() => setChatAbierto(null)}
          onOpenChat={() => router.push(`/crm/chats?contacto=${encodeURIComponent(chatAbierto)}`)}
        />
      )}
    </div>
  );
}

/**
 * Caparazón de las dos tarjetas. El detalle va FUERA del botón que abre y
 * cierra: dentro hay folios que a su vez son botones (abrir chat / copiar), y
 * un botón dentro de otro botón ni es HTML válido ni deja hacer clic en el de
 * adentro sin cerrar la tarjeta.
 */
function Tarjeta({
  abierto,
  onToggle,
  detalle,
  children,
}: {
  abierto: boolean;
  onToggle: () => void;
  detalle: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 shadow-sm p-5 hover:shadow-md hover:border-outline-variant/30 transition-all">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierto}
        className="w-full text-left cursor-pointer"
      >
        {children}
        <div className="flex items-center gap-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
          <span className="material-symbols-outlined text-sm">
            {abierto ? "expand_less" : "expand_more"}
          </span>
          {abierto ? "Ocultar detalle" : "Ver detalle"}
        </div>
      </button>

      {abierto && (
        <div className="mt-3 pt-3 border-t border-outline-variant/20 space-y-4">{detalle}</div>
      )}
    </div>
  );
}

function BarraProporcion({ ancho, color }: { ancho: number; color: string }) {
  return (
    <div className="mt-4 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${ancho}%`, backgroundColor: color }}
      />
    </div>
  );
}

interface TarjetaProductoProps {
  producto: ProductoDesglose;
  totalPedidos: number;
  maxPedidos: number;
  abierto: boolean;
  onToggle: () => void;
  onAbrirChat: (contactId: string) => void;
}

function TarjetaProducto({
  producto,
  totalPedidos,
  maxPedidos,
  abierto,
  onToggle,
  onAbrirChat,
}: TarjetaProductoProps) {
  const color = colorProducto(producto.producto);
  // OJO: en el desglose por producto los pedidos NO suman el total (uno con dos
  // productos cuenta en las dos tarjetas), así que los porcentajes pueden pasar
  // de 100 por un par de puntos. Aun así se mide contra pedidos, para que el %
  // corresponda al número grande de la tarjeta.
  const porcentaje = totalPedidos > 0 ? Math.round((producto.pedidos / totalPedidos) * 100) : 0;
  // La barra se mide contra el producto más vendido, no contra el total: con seis
  // productos ninguna barra pasaría del 40% y todas se verían igual de cortas.
  const ancho = maxPedidos > 0 ? Math.round((producto.pedidos / maxPedidos) * 100) : 0;

  return (
    <Tarjeta
      abierto={abierto}
      onToggle={onToggle}
      detalle={
        <>
          <ListaEstatus porEstatus={producto.porEstatus} />
          <ListaFolios
            pedidos={producto.listaPedidos}
            total={producto.pedidos}
            onAbrirChat={onAbrirChat}
          />
        </>
      }
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

      <p className="text-4xl font-black text-on-surface leading-none">{producto.pedidos}</p>
      <p className="text-xs text-on-surface-variant mt-1.5">
        {producto.pedidos === 1 ? "pedido" : "pedidos"} · {producto.piezas}{" "}
        {producto.piezas === 1 ? "pieza" : "piezas"} · {pesos.format(producto.monto)}
      </p>

      <BarraProporcion ancho={ancho} color={color} />
    </Tarjeta>
  );
}

interface TarjetaCampanaProps {
  campana: CampanaDesglose;
  totalPedidos: number;
  maxPedidos: number;
  abierto: boolean;
  onToggle: () => void;
  onAbrirChat: (contactId: string) => void;
}

function TarjetaCampana({
  campana,
  totalPedidos,
  maxPedidos,
  abierto,
  onToggle,
  onAbrirChat,
}: TarjetaCampanaProps) {
  const color = colorCampana(campana.id);
  const porcentaje = totalPedidos > 0 ? Math.round((campana.pedidos / totalPedidos) * 100) : 0;
  const ancho = maxPedidos > 0 ? Math.round((campana.pedidos / maxPedidos) * 100) : 0;
  const esCampanaReal = campana.id !== ID_ORGANICO && campana.id !== ID_SIN_CAMPANA;

  return (
    <Tarjeta
      abierto={abierto}
      onToggle={onToggle}
      detalle={
        <>
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

          <ListaFolios
            pedidos={campana.listaPedidos}
            total={campana.pedidos}
            onAbrirChat={onAbrirChat}
          />
        </>
      }
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

      <p className="text-4xl font-black text-on-surface leading-none">{campana.pedidos}</p>
      <p className="text-xs text-on-surface-variant mt-1.5">
        {campana.pedidos === 1 ? "pedido" : "pedidos"} · {campana.piezas}{" "}
        {campana.piezas === 1 ? "pieza" : "piezas"} · {pesos.format(campana.monto)}
      </p>

      {campana.costoPorPedido != null && (
        <p className="text-xs mt-1 flex items-center gap-1">
          <span
            className="material-symbols-outlined text-on-surface-variant"
            style={{ fontSize: 14 }}
          >
            sell
          </span>
          <span className="font-bold text-on-surface">
            {pesosExactos.format(campana.costoPorPedido)}
          </span>
          <span className="text-on-surface-variant">
            por pedido · {pesos.format(campana.gasto ?? 0)} gastados
          </span>
        </p>
      )}

      <BarraProporcion ancho={ancho} color={color} />
    </Tarjeta>
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

function ListaFolios({
  pedidos,
  total,
  onAbrirChat,
}: {
  pedidos: PedidoDesglose[];
  total: number;
  onAbrirChat: (contactId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
        Números de pedido · {total}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {pedidos.map((pd, i) => (
          <ChipFolio key={`${pd.numero ?? "s"}-${i}`} pedido={pd} onAbrirChat={onAbrirChat} />
        ))}
      </div>
    </div>
  );
}

function ChipFolio({
  pedido,
  onAbrirChat,
}: {
  pedido: PedidoDesglose;
  onAbrirChat: (contactId: string) => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const folio = `DH${pedido.numero ?? "--"}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(folio);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1200);
      toast.success(`${folio} copiado`);
    } catch {
      toast.error("El navegador no dejó copiar");
    }
  }

  return (
    <span className="inline-flex items-stretch rounded-lg bg-surface-container-high overflow-hidden text-[11px] font-bold text-on-surface">
      <button
        type="button"
        onClick={() => pedido.contactId && onAbrirChat(pedido.contactId)}
        disabled={!pedido.contactId}
        title={
          pedido.contactId
            ? `${pedido.estatus} · ver la conversación`
            : `${pedido.estatus} · sin conversación ligada`
        }
        className="inline-flex items-center gap-1 px-2 py-0.5 transition-colors enabled:hover:bg-primary/15 enabled:cursor-pointer disabled:opacity-60"
      >
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: getStatusConfig(pedido.estatus).color }}
        />
        {folio}
        {pedido.piezas > 1 && (
          <span className="text-on-surface-variant font-normal">×{pedido.piezas}</span>
        )}
      </button>
      <button
        type="button"
        onClick={copiar}
        title={`Copiar ${folio}`}
        aria-label={`Copiar ${folio}`}
        className="flex items-center px-1.5 border-l border-outline-variant/25 text-on-surface-variant hover:bg-primary/15 hover:text-on-surface transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
          {copiado ? "check" : "content_copy"}
        </span>
      </button>
    </span>
  );
}
