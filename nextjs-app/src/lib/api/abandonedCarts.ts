export interface AbandonedCartItem {
  name: string;
  collection: string;
  qty: number;
  price: number;
  img?: string;
}

export interface AbandonedCart {
  id: string;
  customerName: string;
  customerPhone: string;
  phone10: string;
  customerEmail?: string | null;
  items: AbandonedCartItem[];
  subtotal: number;
  shipping: string;
  address: {
    street: string;
    colonia: string;
    city: string;
    state: string;
    zip: string;
  };
  status: "pending" | "converted" | "messaged" | "discarded";
  notes?: string;
  orderNumber?: string | null;
  createdAt: { _seconds: number; _nanoseconds: number } | string;
  updatedAt?: { _seconds: number; _nanoseconds: number } | string;
  convertedAt?: { _seconds: number; _nanoseconds: number } | string;
}

export async function fetchAbandonedCarts(status = "pending"): Promise<AbandonedCart[]> {
  const res = await fetch(`/api/carritos-abandonados?status=${encodeURIComponent(status)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error al listar carritos");
  return data.carts || [];
}

export async function updateAbandonedCart(
  id: string,
  update: { status?: AbandonedCart["status"]; notes?: string }
): Promise<void> {
  const res = await fetch(`/api/carritos-abandonados/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Error al actualizar carrito");
  }
}
