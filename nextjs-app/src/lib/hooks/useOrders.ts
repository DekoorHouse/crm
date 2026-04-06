"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Order, OrderFilters, PaginationState } from "../api/types";
import { fetchOrders, fetchOrderCount } from "../api/orders";
import { db } from "../firebase/config";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  getCountFromServer,
} from "firebase/firestore";

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
  refreshTodayCount: () => void;
  updateOrderStatus: (orderId: string, newStatus: string, oldStatus: string) => void;
}

function getTodayRange() {
  const mexicoDate = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Mexico_City",
  });
  const start = new Date(mexicoDate + "T00:00:00-06:00");
  const end = new Date(mexicoDate + "T23:59:59.999-06:00");
  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
  };
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
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Real-time today count via Firestore onSnapshot (same pattern as old app)
  const refreshTodayCount = useCallback(() => {
    // Cleanup previous listener
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    const { start, end } = getTodayRange();
    const pedidosRef = collection(db, "pedidos");

    // Initial count
    const countQuery = query(
      pedidosRef,
      where("createdAt", ">=", start),
      where("createdAt", "<", end)
    );
    getCountFromServer(countQuery)
      .then((snap) => setTodayCount(snap.data().count))
      .catch(() => {});

    // Lightweight listener: watch only the latest doc, re-count on changes
    const listenerQuery = query(
      pedidosRef,
      where("createdAt", ">=", start),
      where("createdAt", "<", end),
      orderBy("createdAt", "desc"),
      limit(1)
    );

    let isFirst = true;
    unsubscribeRef.current = onSnapshot(listenerQuery, () => {
      if (isFirst) {
        isFirst = false;
        return;
      }
      // Re-count when a change is detected
      getCountFromServer(countQuery)
        .then((snap) => setTodayCount(snap.data().count))
        .catch(() => {});
    });
  }, []);

  // Cleanup listener on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const loadInitial = useCallback(async (filters: OrderFilters) => {
    setLoading(true);
    setError(null);
    currentFilters.current = filters;
    allOrders.current = [];

    try {
      const [data, totalCount] = await Promise.all([
        fetchOrders(filters),
        fetchOrderCount(filters).catch(() => null),
      ]);
      allOrders.current = data.orders;
      setOrders(data.orders);
      setPagination({
        lastVisibleId: data.lastVisibleId,
        hasMore: data.hasMore,
        isLoadingMore: false,
      });

      setFilteredCount(totalCount ?? data.orders.length);
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
  }, [pagination]);

  const updateOrderStatus = useCallback(
    (orderId: string, newStatus: string, _oldStatus: string) => {
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
