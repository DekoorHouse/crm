"use client";

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { fetchAbandonedCarts, updateAbandonedCart, type AbandonedCart } from "@/lib/api/abandonedCarts";

type StatusFilter = "pending" | "converted" | "messaged" | "discarded";

const STATUS_TABS: { id: StatusFilter; label: string; color: string }[] = [
  { id: "pending", label: "Pendientes", color: "text-amber-600" },
  { id: "messaged", label: "Contactados", color: "text-blue-600" },
  { id: "converted", label: "Convertidos", color: "text-green-600" },
  { id: "discarded", label: "Descartados", color: "text-gray-500" },
];

function formatDate(raw: AbandonedCart["createdAt"]): string {
  if (!raw) return "—";
  try {
    const date = typeof raw === "string"
      ? new Date(raw)
      : new Date(raw._seconds * 1000);
    const diffMs = Date.now() - date.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return `hace ${Math.floor(diffMs / 60000)} min`;
    if (diffH < 24) return `hace ${diffH}h`;
    return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function buildWhatsAppLink(phone: string, customerName: string, items: AbandonedCart["items"]): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  const full = "521" + digits;
  const itemsTxt = items.map(i => `- ${i.name} (${i.collection})${i.qty > 1 ? " x" + i.qty : ""}`).join("\n");
  const msg = [
    `Hola ${customerName.split(" ")[0]}!`,
    ``,
    `Te contactamos de Dekoor. Notamos que dejaste tu pedido a medias:`,
    itemsTxt,
    ``,
    `Queremos ayudarte a completarlo. Tienes alguna pregunta?`,
  ].join("\n");
  return `https://wa.me/${full}?text=${encodeURIComponent(msg)}`;
}

export default function CarritosAbandonadosPage() {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [carts, setCarts] = useState<AbandonedCart[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (s: StatusFilter) => {
    setLoading(true);
    try {
      const data = await fetchAbandonedCarts(s);
      setCarts(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(status);
  }, [status, load]);

  async function handleAction(cart: AbandonedCart, newStatus: AbandonedCart["status"]) {
    try {
      await updateAbandonedCart(cart.id, { status: newStatus });
      toast.success("Carrito actualizado");
      load(status);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  const counts = { pending: 0 }; // Opcional: cargar conteos

  return (
    <div className="p-6 h-full flex flex-col">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-on-surface">Carritos abandonados</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Clientes que llenaron el carrito pero no completaron la compra. Contactalos por WhatsApp para recuperar la venta.
        </p>
      </header>

      <div className="flex gap-2 border-b border-outline-variant mb-4">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setStatus(tab.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              status === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-center py-12 text-on-surface-variant">Cargando...</div>
        ) : carts.length === 0 ? (
          <div className="text-center py-12 text-on-surface-variant">
            <p className="text-lg">Sin carritos en esta categoria</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {carts.map(cart => (
              <div key={cart.id} className="bg-surface-container rounded-xl p-4 border border-outline-variant">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-bold text-on-surface">{cart.customerName}</div>
                    <div className="text-sm text-on-surface-variant flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm">call</span>
                      {cart.customerPhone}
                    </div>
                    {cart.customerEmail && (
                      <div className="text-xs text-on-surface-variant mt-1 truncate">{cart.customerEmail}</div>
                    )}
                  </div>
                  <div className="text-xs text-on-surface-variant text-right">
                    {formatDate(cart.createdAt)}
                  </div>
                </div>

                <div className="mb-3">
                  {cart.items.map((item, i) => (
                    <div key={i} className="text-sm text-on-surface-variant">
                      • {item.name} ({item.collection}){item.qty > 1 ? ` x${item.qty}` : ""}
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center text-sm mb-3 py-2 border-t border-outline-variant">
                  <span className="text-on-surface-variant">Total</span>
                  <span className="font-bold text-primary">${cart.subtotal.toLocaleString("en")} MXN</span>
                </div>

                {cart.address.street && (
                  <div className="text-xs text-on-surface-variant mb-3">
                    <div className="flex items-start gap-1">
                      <span className="material-symbols-outlined text-xs mt-0.5">location_on</span>
                      <span>{cart.address.street}, {cart.address.colonia}, {cart.address.city}, {cart.address.state} C.P. {cart.address.zip}</span>
                    </div>
                  </div>
                )}

                {cart.orderNumber && (
                  <div className="text-xs text-green-700 mb-2">
                    ✓ Pedido: <strong>{cart.orderNumber}</strong>
                  </div>
                )}

                {status === "pending" && (
                  <div className="flex gap-2 flex-wrap">
                    <a
                      href={buildWhatsAppLink(cart.customerPhone, cart.customerName, cart.items)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleAction(cart, "messaged")}
                      className="flex-1 text-center text-xs font-semibold bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Enviar WhatsApp
                    </a>
                    <button
                      onClick={() => handleAction(cart, "discarded")}
                      className="text-xs font-semibold bg-surface-container-high text-on-surface-variant px-3 py-2 rounded-lg hover:bg-surface-container-highest"
                    >
                      Descartar
                    </button>
                  </div>
                )}

                {status === "messaged" && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleAction(cart, "pending")}
                      className="text-xs font-semibold bg-surface-container-high text-on-surface-variant px-3 py-2 rounded-lg hover:bg-surface-container-highest"
                    >
                      Volver a pendiente
                    </button>
                    <button
                      onClick={() => handleAction(cart, "discarded")}
                      className="text-xs font-semibold bg-surface-container-high text-on-surface-variant px-3 py-2 rounded-lg hover:bg-surface-container-highest"
                    >
                      Descartar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
