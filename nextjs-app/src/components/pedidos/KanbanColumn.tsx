"use client";

import { Droppable } from "@hello-pangea/dnd";
import type { Order } from "@/lib/api/types";
import type { StatusConfig } from "@/lib/utils/statusConfig";
import KanbanCard from "./KanbanCard";

interface KanbanColumnProps {
  status: StatusConfig;
  orders: Order[];
}

export default function KanbanColumn({ status, orders }: KanbanColumnProps) {
  return (
    <div className="flex-shrink-0 w-72 flex flex-col bg-surface-container-low/50 rounded-2xl p-3 border border-outline-variant/10">
      {/* Column header */}
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: status.color }}
          />
          <h3 className="text-xs font-black uppercase tracking-widest">
            {status.label}
          </h3>
        </div>
        <span className="bg-surface-container-high px-2 py-0.5 rounded text-[10px] font-bold text-on-surface-variant">
          {orders.length}
        </span>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={status.label}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 space-y-3 overflow-y-auto pr-1 min-h-[120px] rounded-xl transition-colors ${
              snapshot.isDraggingOver
                ? "bg-primary/5 ring-2 ring-primary/20 ring-dashed"
                : ""
            }`}
          >
            {orders.length === 0 && !snapshot.isDraggingOver && (
              <div className="bg-surface-container-lowest/50 p-4 rounded-xl border border-dashed border-outline-variant/30 text-center">
                <p className="text-[10px] text-on-surface-variant italic">
                  Arrastra un pedido aquí
                </p>
              </div>
            )}

            {orders.map((order, index) => (
              <KanbanCard
                key={order.id}
                order={order}
                index={index}
                statusColor={status.color}
              />
            ))}

            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
