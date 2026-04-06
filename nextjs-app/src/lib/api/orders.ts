import type { Order, OrderFilters } from "./types";

interface OrdersResponse {
  success: boolean;
  orders: Order[];
  lastVisibleId: string | null;
  hasMore: boolean;
  message?: string;
}

interface TodayResponse {
  success: boolean;
  orders: Order[];
}

function buildApiUrl(filters: OrderFilters, startAfterId?: string | null): string {
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (filters.producto) params.set("producto", filters.producto);
  if (filters.estatus) params.set("estatus", filters.estatus);
  if (filters.dateFilter) params.set("dateFilter", filters.dateFilter);
  if (filters.customStart) params.set("customStart", String(filters.customStart));
  if (filters.customEnd) params.set("customEnd", String(filters.customEnd));
  if (startAfterId) params.set("startAfterId", startAfterId);
  return `/api/orders/list?${params.toString()}`;
}

export async function fetchOrders(
  filters: OrderFilters,
  startAfterId?: string | null
): Promise<OrdersResponse> {
  const response = await fetch(buildApiUrl(filters, startAfterId));
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "Error fetching orders");
  return data;
}

export async function fetchTodayOrders(): Promise<TodayResponse> {
  const response = await fetch("/api/orders/today");
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "Error fetching today orders");
  return data;
}

export async function fetchOrderCount(
  filters: OrderFilters
): Promise<number> {
  const params = new URLSearchParams();
  if (filters.producto) params.set("producto", filters.producto);
  if (filters.estatus) params.set("estatus", filters.estatus);
  if (filters.dateFilter) params.set("dateFilter", filters.dateFilter);
  if (filters.customStart) params.set("customStart", String(filters.customStart));
  if (filters.customEnd) params.set("customEnd", String(filters.customEnd));
  const response = await fetch(`/api/orders/count?${params.toString()}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "Error counting orders");
  return data.count;
}

export async function changeOrderStatus(
  orderId: string,
  newStatus: string
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/orders/${orderId}/change-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newStatus }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Error changing status");
  return data;
}
