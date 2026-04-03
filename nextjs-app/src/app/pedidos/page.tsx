"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { useOrders } from "@/lib/hooks/useOrders";
import type { Order, OrderFilters } from "@/lib/api/types";
import { deleteOrder as deleteOrderFromDb } from "@/lib/firebase/firestore";
import { deletePhoto } from "@/lib/firebase/storage";
import Navbar from "@/components/layout/Navbar";
import LoadingOverlay from "@/components/layout/LoadingOverlay";
import FilterBar from "@/components/pedidos/FilterBar";
import OrdersTable from "@/components/pedidos/OrdersTable";
import OrdersKanban from "@/components/pedidos/OrdersKanban";
import OrderModal from "@/components/pedidos/OrderModal";
import ImageViewer from "@/components/pedidos/ImageViewer";
import DeleteConfirmModal from "@/components/pedidos/DeleteConfirmModal";
import SearchBar from "@/components/pedidos/SearchBar";
import StatusPicker from "@/components/pedidos/StatusPicker";
import { changeOrderStatus } from "@/lib/api/orders";
import { exportOrdersToCsv } from "@/lib/utils/exportCsv";
import toast from "react-hot-toast";

export default function PedidosPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const {
    orders,
    loading,
    pagination,
    todayCount,
    filteredCount,
    filteredSum,
    loadInitial,
    loadMore,
    loadAll,
    refreshTodayCount,
    updateOrderStatus,
  } = useOrders();

  const [viewMode, setViewMode] = useState<"tabla" | "kanban">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("dekoor-view-mode") as "tabla" | "kanban") || "kanban";
    }
    return "kanban";
  });

  // Modal states
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [imageViewer, setImageViewer] = useState<{ urls: string[]; index: number; orderNum: number | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusPicker, setStatusPicker] = useState<{ order: Order; rect: DOMRect } | null>(null);
  const [currentFilters, setCurrentFilters] = useState<OrderFilters>({});

  // Keyboard shortcuts: Ctrl+F for search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem("dekoor-view-mode", viewMode);
  }, [viewMode]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Load initial data when user is authenticated
  useEffect(() => {
    if (user) {
      const defaultDateFilter =
        user.email === "alex@dekoor.com" ? "hoy" : "ultimos-10-dias";
      const filters = { dateFilter: defaultDateFilter };
      setCurrentFilters(filters);
      loadInitial(filters);
      refreshTodayCount();
    }
  }, [user, loadInitial, refreshTodayCount]);

  const handleFilterApply = useCallback(
    (filters: OrderFilters) => {
      setCurrentFilters(filters);
      loadInitial(filters);
    },
    [loadInitial]
  );

  function handleNewOrder() {
    setEditingOrder(null);
    setOrderModalOpen(true);
  }

  function handleEditOrder(order: Order) {
    setEditingOrder(order);
    setOrderModalOpen(true);
  }

  function handleOrderSaved() {
    // Reload orders with current filters
    loadInitial(currentFilters);
    refreshTodayCount();
  }

  async function handleDeleteOrder() {
    if (!deleteTarget) return;
    try {
      // Delete photos from storage
      const allPhotos = [...(deleteTarget.fotoUrls || []), ...(deleteTarget.fotoPromocionUrls || [])];
      await Promise.all(allPhotos.map(deletePhoto));
      // Delete document
      await deleteOrderFromDb(deleteTarget.id);
      toast.success("Pedido eliminado");
      setDeleteTarget(null);
      loadInitial(currentFilters);
      refreshTodayCount();
    } catch (err) {
      toast.error("Error al eliminar pedido");
      throw err; // Let DeleteConfirmModal handle loading state
    }
  }

  if (authLoading) {
    return <LoadingOverlay />;
  }

  if (!user) {
    return <LoadingOverlay />;
  }

  return (
    <div className="flex h-screen bg-background">
      <main className="flex-1 flex flex-col overflow-hidden">
        <Navbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onNewOrder={handleNewOrder}
          onExport={() => exportOrdersToCsv(orders)}
        />

        <FilterBar
          onApply={handleFilterApply}
          todayCount={todayCount}
          filteredCount={filteredCount}
          filteredSum={filteredSum}
        />

        {/* Content Area */}
        <section className="flex-1 px-8 pb-8 overflow-auto" data-search-scope>
          {viewMode === "tabla" ? (
            <OrdersTable
              orders={orders}
              loading={loading}
              hasMore={pagination.hasMore}
              isLoadingMore={pagination.isLoadingMore}
              onLoadMore={loadMore}
              onStatusClick={(order, event) => {
                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                setStatusPicker({ order, rect });
              }}
              onEdit={handleEditOrder}
              onDelete={(order) => setDeleteTarget(order)}
              onPhotoClick={(urls, index, orderNum) =>
                setImageViewer({ urls, index, orderNum })
              }
            />
          ) : (
            <OrdersKanban
              orders={orders}
              loading={loading}
              onOrderStatusChanged={updateOrderStatus}
            />
          )}
        </section>
      </main>

      {/* FAB mobile */}
      <button
        onClick={handleNewOrder}
        className="fixed bottom-10 right-10 w-16 h-16 bg-primary text-on-primary rounded-2xl shadow-2xl flex items-center justify-center group hover:scale-110 transition-all z-50 xl:hidden"
      >
        <span className="material-symbols-outlined text-3xl group-hover:rotate-90 transition-transform">
          add
        </span>
      </button>

      {/* Modals */}
      {orderModalOpen && (
        <OrderModal
          order={editingOrder}
          onClose={() => { setOrderModalOpen(false); setEditingOrder(null); }}
          onSaved={handleOrderSaved}
        />
      )}

      {imageViewer && (
        <ImageViewer
          urls={imageViewer.urls}
          initialIndex={imageViewer.index}
          orderNumber={imageViewer.orderNum}
          onClose={() => setImageViewer(null)}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          orderNumber={deleteTarget.consecutiveOrderNumber}
          onConfirm={handleDeleteOrder}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {statusPicker && (
        <StatusPicker
          currentStatus={statusPicker.order.estatus}
          anchorRect={statusPicker.rect}
          onSelect={async (newStatus) => {
            const order = statusPicker.order;
            updateOrderStatus(order.id, newStatus, order.estatus);
            try {
              await changeOrderStatus(order.id, newStatus);
              toast.success(`Estatus → "${newStatus}"`, { duration: 2000 });
            } catch {
              updateOrderStatus(order.id, order.estatus, newStatus);
              toast.error("Error al cambiar estatus");
            }
          }}
          onClose={() => setStatusPicker(null)}
        />
      )}

      {/* Search Bar */}
      <SearchBar
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onLoadAll={loadAll}
      />
    </div>
  );
}
