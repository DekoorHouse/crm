"use client";

import { memo } from "react";
import { Draggable } from "@hello-pangea/dnd";
import type { Order } from "@/lib/api/types";

interface KanbanCardProps {
  order: Order;
  index: number;
  statusColor: string;
}

export default memo(function KanbanCard({ order, index, statusColor }: KanbanCardProps) {
  return (
    <Draggable draggableId={order.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`bg-surface-container-lowest p-4 rounded-xl shadow-sm transition-all cursor-grab active:cursor-grabbing ${
            snapshot.isDragging
              ? "shadow-lg scale-105 rotate-1 opacity-90"
              : "hover:scale-[1.02]"
          }`}
          style={{
            borderLeft: `4px solid ${statusColor}`,
            ...provided.draggableProps.style,
          }}
        >
          {/* Order number */}
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-on-surface-variant">
              DH{order.consecutiveOrderNumber ?? "--"}
            </span>
            <span className="material-symbols-outlined text-sm text-on-surface-variant/40">
              more_vert
            </span>
          </div>

          {/* Product info */}
          <div className="flex gap-3 mb-2">
            {order.fotoUrls[0] ? (
              <img
                src={order.fotoUrls[0]}
                alt="Producto"
                className="w-10 h-10 rounded-lg object-cover bg-surface-container-low flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-on-surface-variant/30 text-lg">
                  image
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-on-surface leading-tight truncate">
                {order.producto || "Sin producto"}
              </p>
              <p className="text-[10px] text-on-surface-variant font-medium">
                {order.telefono || "--"}
              </p>
            </div>
          </div>

          {/* Price + Comment + Seller */}
          <div className="flex justify-between items-end">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-primary">
                {order.precio
                  ? `$${Number(order.precio).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`
                  : "--"}
              </p>
              {order.comentarios && (
                <p className="text-[10px] text-on-surface-variant mt-1 italic truncate max-w-[140px]">
                  &ldquo;{order.comentarios}&rdquo;
                </p>
              )}
            </div>
            {order.vendedor && (
              <div className="text-right flex-shrink-0 ml-2">
                <p className="text-[10px] font-bold text-on-surface-variant">Vendedor</p>
                <p className="text-[10px] font-medium">{order.vendedor}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
});
