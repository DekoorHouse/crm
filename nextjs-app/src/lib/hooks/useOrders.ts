"use client";

import { useState, useCallback, useRef } from "react";
import type { Order, OrderFilters, PaginationState } from "../api/types";
import { fetchOrders, fetchTodayOrders } from "../api/orders";

interface UseOrdersReturn {
  orders: Order[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  todayCount: number;
  filteredCount: number;
  filteredSum: number;
  loadInitial: (filters: OrderFilters) => Promise<void>;
  loadMore: () => Promise<void>;
  loadAll: () => Promise<void>;
  refreshTodayCount: () => Promise<void>;
  updateOrderStatus: (orderId: string, newStatus: string, oldStatus: string) => void;
}

export function useOrders(): UseOrdersReturn {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todayCount, setTodayCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [filteredSum, setFilteredSum] = useState(0);
  const [pagination, setPagination] = useState<PaginationState>({
    lastVisibleId: null,
    hasMore: true,
    isLoadingMore: false,
  });

  const currentFilters = useRef<OrderFilters>({});
  const allOrders = useRef<Order[]>([]);

  const refreshTodayCount = useCallback(async () => {
    try {
      const data = await fetchTodayOrders();
      setTodayCount(data.orders.length);
    } catch {
      // silently fail
    }
  }, []);

  const loadInitial = useCallback(async (filters: OrderFilters) => {
    setLoading(true);
    setError(null);
    currentFilters.current = filters;
    allOrders.current = [];

    try {
      const data = await fetchOrders(filters);
      allOrders.current = data.orders;
      setOrders(data.orders);
      setPagination({
        lastVisibleId: data.lastVisibleId,
        hasMore: data.hasMore,
        isLoadingMore: false,
      });

      // Calculate counters
      setFilteredCount(data.orders.length + (data.hasMore ? 1 : 0)); // approximate, will refine
      const sum = data.orders.reduce((acc, o) => acc + (Number(o.precio) || 0), 0);
      setFilteredSum(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar pedidos");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (pagination.isLoadingMore || !pagination.hasMore || !pagination.lastVisibleId) return;

    setPagination((prev) => ({ ...prev, isLoadingMore: true }));

    try {
      const data = await fetchOrders(currentFilters.current, pagination.lastVisibleId);
      allOrders.current = [...allOrders.current, ...data.orders];
      setOrders(allOrders.current);
      setPagination({
        lastVisibleId: data.lastVisibleId,
        hasMore: data.hasMore,
        isLoadingMore: false,
      });

      const sum = allOrders.current.reduce((acc, o) => acc + (Number(o.precio) || 0), 0);
      setFilteredSum(sum);
      setFilteredCount(allOrders.current.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar más pedidos");
      setPagination((prev) => ({ ...prev, isLoadingMore: false }));
    }
  }, [pagination]);

  const loadAll = useCallback(async () => {
    let currentLastId = pagination.lastVisibleId;
    let hasMorePages = pagination.hasMore;

    while (hasMorePages && currentLastId) {
      try {
        const data = await fetchOrders(currentFilters.current, currentLastId);
        allOrders.current = [...allOrders.current, ...data.orders];
        currentLastId = data.lastVisibleId;
        hasMorePages = data.hasMore;
      } catch {
        break;
      }
    }

    setOrders(allOrders.current);
    setPagination({ lastVisibleId: currentLastId, hasMore: false, isLoadingMore: false });
    const sum = allOrders.current.reduce((acc, o) => acc + (Number(o.precio) || 0), 0);
    setFilteredSum(sum);
    setFilteredCount(allOrders.current.length);
  }, [pagination]);

  const updateOrderStatus = useCallback(
    (orderId: string, newStatus: string, _oldStatus: string) => {
      // Optimistic update in local state
      const updated = allOrders.current.map((o) =>
        o.id === orderId ? { ...o, estatus: newStatus } : o
      );
      allOrders.current = updated;
      setOrders(updated);
    },
    []
  );

  return {
    orders,
    loading,
    error,
    pagination,
    todayCount,
    filteredCount,
    filteredSum,
    loadInitial,
    loadMore,
    loadAll,
    refreshTodayCount,
    updateOrderStatus,
  };
}
