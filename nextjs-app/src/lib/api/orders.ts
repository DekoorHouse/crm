import type {
  DesgloseCampanasResponse,
  DesgloseResponse,
  Order,
  OrderFilters,
} from "./types";

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

function buildFilterParams(filters: OrderFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.producto) params.set("producto", filters.producto);
  if (filters.estatus) params.set("estatus", filters.estatus);
  if (filters.dateFilter) params.set("dateFilter", filters.dateFilter);
  if (filters.customStart) params.set("customStart", String(filters.customStart));
  if (filters.customEnd) params.set("customEnd", String(filters.customEnd));
  return params;
}

function buildApiUrl(filters: OrderFilters, startAfterId?: string | null): string {
  const params = buildFilterParams(filters);
  params.set("limit", "50");
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
  const params = buildFilterParams(filters);
  const response = await fetch(`/api/orders/count?${params.toString()}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "Error counting orders");
  return data.count;
}

export async function fetchDesglose(
  filters: OrderFilters
): Promise<DesgloseResponse> {
  const params = buildFilterParams(filters);
  const response = await fetch(`/api/orders/desglose?${params.toString()}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "Error al obtener el desglose");
  return data;
}

export async function fetchDesgloseCampanas(
  filters: OrderFilters
): Promise<DesgloseCampanasResponse> {
  const params = buildFilterParams(filters);
  params.set("agrupar", "campana");
  const response = await fetch(`/api/orders/desglose?${params.toString()}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "Error al obtener el desglose");
  return data;
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
