export interface StatusConfig {
  id: string;
  label: string;
  icon: string;
  color: string;
  bgClass: string;
}

export const STATUS_OPTIONS: StatusConfig[] = [
  { id: "sin_estatus", label: "Sin estatus", icon: "help", color: "#6c757d", bgClass: "bg-gray-500" },
  { id: "pendiente_transferencia", label: "Pendiente Transferencia", icon: "account_balance", color: "#0ea5e9", bgClass: "bg-sky-500" },
  { id: "foto_enviada", label: "Foto enviada", icon: "photo_camera", color: "#007bff", bgClass: "bg-blue-500" },
  { id: "esperando_pago", label: "Esperando pago", icon: "hourglass_top", color: "#ffc107", bgClass: "bg-yellow-500" },
  { id: "pagado", label: "Pagado", icon: "check_circle", color: "#28a745", bgClass: "bg-green-500" },
  { id: "disenado", label: "Diseñado", icon: "palette", color: "#6f42c1", bgClass: "bg-purple-500" },
  { id: "fabricar", label: "Fabricar", icon: "settings", color: "#17a2b8", bgClass: "bg-teal-500" },
  { id: "corregir", label: "Corregir", icon: "edit", color: "#fd7e14", bgClass: "bg-orange-500" },
  { id: "corregido", label: "Corregido", icon: "done_all", color: "#20c997", bgClass: "bg-emerald-500" },
  { id: "mns_amenazador", label: "Mns Amenazador", icon: "warning", color: "#dc3545", bgClass: "bg-red-500" },
  { id: "cancelado", label: "Cancelado", icon: "cancel", color: "#6c757d", bgClass: "bg-gray-500" },
];

export function getStatusConfig(statusLabel: string): StatusConfig {
  return STATUS_OPTIONS.find((s) => s.label === statusLabel) ?? STATUS_OPTIONS[0];
}
