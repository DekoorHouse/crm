export interface OrderItem {
  producto: string;
  cantidad: number;
  precio: number;
  datosProducto: string;
}

export interface Order {
  id: string;
  consecutiveOrderNumber: number | null;
  telefono: string;
  estatus: string;
  producto: string;
  datosProducto: string;
  datosPromocion: string;
  comentarios: string;
  fotoUrls: string[];
  fotoPromocionUrls: string[];
  precio: number;
  vendedor: string;
  telefonoVerificado: boolean;
  estatusVerificado: boolean;
  createdAt: { _seconds: number; _nanoseconds: number } | null;
  contactId: string | null;
  items?: OrderItem[];
  campana_id?: string | null;
  plantilla_origen?: string | null;
}

export interface OrderFilters {
  producto?: string;
  estatus?: string;
  dateFilter?: string;
  customStart?: number | null;
  customEnd?: number | null;
}

export interface PedidoDesglose {
  numero: number | null;
  estatus: string;
  piezas: number;
  /** Contacto del pedido, para abrir su conversación desde el folio. */
  contactId: string | null;
}

export interface ProductoDesglose {
  producto: string;
  piezas: number;
  pedidos: number;
  monto: number;
  porEstatus: Record<string, number>;
  listaPedidos: PedidoDesglose[];
}

export interface DesgloseResponse {
  productos: ProductoDesglose[];
  totalPiezas: number;
  totalPedidos: number;
  totalMonto: number;
  truncado: boolean;
  max: number;
}

export interface CampanaDesglose {
  /** campaignId de Meta, o `__organico__` / `__sin_campana__`. */
  id: string;
  nombre: string;
  piezas: number;
  pedidos: number;
  monto: number;
  porEstatus: Record<string, number>;
  porProducto: { producto: string; piezas: number }[];
  listaPedidos: PedidoDesglose[];
  /** Ad IDs que alimentaron la campaña (vacío en el orgánico). */
  ads: string[];
}

export interface DesgloseCampanasResponse {
  campanas: CampanaDesglose[];
  totalPiezas: number;
  totalPedidos: number;
  totalMonto: number;
  truncado: boolean;
  max: number;
  /** Anuncios que sí se pudieron traducir a campaña, de los que había. */
  anunciosResueltos: number;
  anunciosTotales: number;
  /** Motivo por el que Meta no contestó (token vencido, etc.), si aplica. */
  metaError: string | null;
}

export interface PaginationState {
  lastVisibleId: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
}
