"use client";

import { useRef, useEffect, useCallback } from "react";
import type { Order } from "@/lib/api/types";
import StatusBadge from "./StatusBadge";
import { formatCurrency } from "@/lib/utils/format";
import toast from "react-hot-toast";

interface OrdersTableProps {
  orders: Order[];
  loading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onStatusClick?: (order: Order, event: React.MouseEvent) => void;
  onEdit?: (order: Order) => void;
  onDelete?: (order: Order) => void;
  onPhotoClick?: (urls: string[], index: number, orderNumber: number | null) => void;
}

function formatDate(createdAt: Order["createdAt"]): string {
  if (!createdAt) return "--";
  const date = new Date(createdAt._seconds * 1000);
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  toast.success("Copiado al portapapeles", { duration: 1500 });
}

export default function OrdersTable({
  orders,
  loading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onStatusClick,
  onEdit,
  onDelete,
  onPhotoClick,
}: OrdersTableProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll with IntersectionObserver
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const target = entries[0];
      if (target.isIntersecting && hasMore && !isLoadingMore) {
        onLoadMore();
      }
    },
    [hasMore, isLoadingMore, onLoadMore]
  );

  useEffect(() => {
    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "200px",
      threshold: 0,
    });
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);

  if (loading && orders.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-12 text-center">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-on-surface-variant">Cargando pedidos...</p>
      </div>
    );
  }

  if (!loading && orders.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-12 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-2">
          inbox
        </span>
        <p className="text-sm text-on-surface-variant">No se encontraron pedidos</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
      {/* Mobile card layout */}
      <div className="md:hidden space-y-3 p-4">
        {orders.map((order) => (
          <div key={order.id} className="bg-surface-container-low/50 p-4 rounded-xl border border-outline-variant/10">
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="text-xs font-bold text-primary">DH{order.consecutiveOrderNumber ?? "--"}</span>
                <span className="text-[10px] text-on-surface-variant ml-2">{formatDate(order.createdAt)}</span>
              </div>
              <StatusBadge status={order.estatus} onClick={(e) => onStatusClick?.(order, e)} />
            </div>
            <p className="text-sm font-bold mb-1">{order.producto || "--"}</p>
            <div className="flex items-center gap-2 text-xs text-on-surface-variant mb-2">
              <span>{order.telefono || "--"}</span>
              <span>·</span>
              <span>{order.vendedor || "--"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-primary">{order.precio ? formatCurrency(order.precio) : "--"}</span>
              <div className="flex gap-1">
                <button onClick={() => onEdit?.(order)} className="p-1.5 text-on-surface-variant/60 hover:text-primary rounded-lg">
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>edit</span>
                </button>
                <button onClick={() => onDelete?.(order)} className="p-1.5 text-on-surface-variant/60 hover:text-error rounded-lg">
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>delete</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table layout */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-container-low/50 border-b border-outline-variant/10">
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                #Pedido
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Fecha
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Vendedor
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Teléfono
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Estatus
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Comentarios
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Producto
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Datos Producto
              </th>
              <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Promoción
              </th>
              <th className="text-right px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Precio
              </th>
              <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order, idx) => (
              <tr
                key={order.id}
                className={`border-b border-outline-variant/5 hover:bg-surface-container-low/30 transition-colors ${
                  idx % 2 === 0 ? "" : "bg-surface-container-low/10"
                }`}
              >
                {/* #Pedido */}
                <td className="px-4 py-3">
                  <span className="font-bold text-primary text-xs">
                    DH{order.consecutiveOrderNumber ?? "--"}
                  </span>
                </td>

                {/* Fecha */}
                <td className="px-4 py-3 text-xs text-on-surface-variant whitespace-nowrap">
                  {formatDate(order.createdAt)}
                </td>

                {/* Vendedor */}
                <td className="px-4 py-3 text-xs font-medium">
                  {order.vendedor || "--"}
                </td>

                {/* Teléfono */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{order.telefono || "--"}</span>
                    {order.telefono && (
                      <button
                        onClick={() => copyToClipboard(order.telefono)}
                        className="p-0.5 text-on-surface-variant/50 hover:text-primary transition-colors"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                          content_copy
                        </span>
                      </button>
                    )}
                    {order.telefonoVerificado && (
                      <span
                        className="material-symbols-outlined text-green-500"
                        style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}
                      >
                        verified
                      </span>
                    )}
                  </div>
                </td>

                {/* Estatus */}
                <td className="px-4 py-3">
                  <StatusBadge
                    status={order.estatus}
                    onClick={(e) => onStatusClick?.(order, e)}
                  />
                </td>

                {/* Comentarios */}
                <td className="px-4 py-3 max-w-[150px]">
                  <p className="text-xs text-on-surface-variant truncate" title={order.comentarios}>
                    {order.comentarios || "--"}
                  </p>
                </td>

                {/* Producto */}
                <td className="px-4 py-3">
                  <span className="text-xs font-medium">{order.producto || "--"}</span>
                </td>

                {/* Datos Producto */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {order.fotoUrls.length > 0 && (
                      <button
                        onClick={() =>
                          onPhotoClick?.(order.fotoUrls, 0, order.consecutiveOrderNumber)
                        }
                        className="flex-shrink-0"
                      >
                        <img
                          src={order.fotoUrls[0]}
                          alt="Producto"
                          className="w-10 h-10 rounded-lg object-cover bg-surface-container-low hover:ring-2 ring-primary/30 transition-all cursor-pointer"
                        />
                      </button>
                    )}
                    <p className="text-xs text-on-surface-variant truncate max-w-[100px]" title={order.datosProducto}>
                      {order.datosProducto || "--"}
                    </p>
                  </div>
                </td>

                {/* Promoción */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {order.fotoPromocionUrls.length > 0 && (
                      <button
                        onClick={() =>
                          onPhotoClick?.(
                            order.fotoPromocionUrls,
                            0,
                            order.consecutiveOrderNumber
                          )
                        }
                        className="flex-shrink-0"
                      >
                        <img
                          src={order.fotoPromocionUrls[0]}
                          alt="Promoción"
                          className="w-10 h-10 rounded-lg object-cover bg-surface-container-low hover:ring-2 ring-primary/30 transition-all cursor-pointer"
                        />
                      </button>
                    )}
                    <p className="text-xs text-on-surface-variant truncate max-w-[100px]" title={order.datosPromocion}>
                      {order.datosPromocion || "--"}
                    </p>
                  </div>
                </td>

                {/* Precio */}
                <td className="px-4 py-3 text-right">
                  <span className="text-xs font-bold text-primary">
                    {order.precio ? formatCurrency(order.precio) : "--"}
                  </span>
                </td>

                {/* Acciones */}
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => onEdit?.(order)}
                      className="p-1.5 text-on-surface-variant/60 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                      title="Editar"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                        edit
                      </span>
                    </button>
                    <button
                      onClick={() => onDelete?.(order)}
                      className="p-1.5 text-on-surface-variant/60 hover:text-error hover:bg-error-container/20 rounded-lg transition-all"
                      title="Eliminar"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                        delete
                      </span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" />

      {/* Loading more indicator */}
      {isLoadingMore && (
        <div className="flex items-center justify-center py-4 gap-2 border-t border-outline-variant/10">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-on-surface-variant">Cargando más...</span>
        </div>
      )}

      {/* No more results */}
      {!hasMore && orders.length > 0 && (
        <div className="text-center py-3 border-t border-outline-variant/10">
          <span className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest font-bold">
            {orders.length} pedidos cargados
          </span>
        </div>
      )}
    </div>
  );
}
