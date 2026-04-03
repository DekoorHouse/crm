import type { Order } from "../api/types";

function formatDateForExport(createdAt: Order["createdAt"]): string {
  if (!createdAt) return "";
  const date = new Date(createdAt._seconds * 1000);
  return date.toLocaleString("es-MX");
}

export function exportOrdersToCsv(orders: Order[], filename = "pedidos-dekoor.csv") {
  const headers = [
    "#Pedido",
    "Fecha",
    "Vendedor",
    "Teléfono",
    "Estatus",
    "Producto",
    "Datos Producto",
    "Promoción",
    "Comentarios",
    "Precio",
  ];

  const rows = orders.map((o) => [
    `DH${o.consecutiveOrderNumber ?? ""}`,
    formatDateForExport(o.createdAt),
    o.vendedor,
    o.telefono,
    o.estatus,
    o.producto,
    o.datosProducto,
    o.datosPromocion,
    o.comentarios,
    String(o.precio || 0),
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${(cell || "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
