"use client";

import { useMemo } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import type { Order } from "@/lib/api/types";
import { STATUS_OPTIONS } from "@/lib/utils/statusConfig";
import { changeOrderStatus } from "@/lib/api/orders";
import KanbanColumn from "./KanbanColumn";
import toast from "react-hot-toast";

interface OrdersKanbanProps {
  orders: Order[];
  loading: boolean;
  onOrderStatusChanged: (orderId: string, newStatus: string, oldStatus: string) => void;
}

export default function OrdersKanban({
  orders,
  loading,
  onOrderStatusChanged,
}: OrdersKanbanProps) {
  // Group orders by status
  const ordersByStatus = useMemo(() => {
    const map = new Map<string, Order[]>();
    STATUS_OPTIONS.forEach((s) => map.set(s.label, []));
    orders.forEach((order) => {
      const key = map.has(order.estatus) ? order.estatus : "Sin estatus";
      map.get(key)!.push(order);
    });
    return map;
  }, [orders]);

  async function handleDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;

    // Dropped outside or in same column
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;

    const oldStatus = source.droppableId;
    const newStatus = destination.droppableId;
    const orderId = draggableId;

    // Optimistic update
    onOrderStatusChanged(orderId, newStatus, oldStatus);

    try {
      await changeOrderStatus(orderId, newStatus);
      toast.success(
        `Pedido movido a "${newStatus}"`,
        { duration: 2000, icon: "✓" }
      );
    } catch (error) {
      // Revert on failure
      onOrderStatusChanged(orderId, oldStatus, newStatus);
      toast.error("Error al cambiar estatus. Se revirtió el cambio.");
    }
  }

  if (loading && orders.length === 0) {
    return (
      <div className="flex gap-4 overflow-x-auto kanban-scroll pb-4 h-full">
        {STATUS_OPTIONS.slice(0, 5).map((status) => (
          <div
            key={status.id}
            className="flex-shrink-0 w-72 bg-surface-container-low/50 rounded-2xl p-3 border border-outline-variant/10 animate-pulse"
          >
            <div className="flex items-center gap-2 mb-4 px-2">
              <div className="w-2 h-2 rounded-full bg-surface-container-high" />
              <div className="h-3 w-24 bg-surface-container-high rounded" />
            </div>
            <div className="space-y-3">
              <div className="h-28 bg-surface-container-high/50 rounded-xl" />
              <div className="h-28 bg-surface-container-high/30 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto kanban-scroll pb-4 h-full">
        {STATUS_OPTIONS.map((status) => (
          <KanbanColumn
            key={status.id}
            status={status}
            orders={ordersByStatus.get(status.label) ?? []}
          />
        ))}
      </div>
    </DragDropContext>
  );
}
