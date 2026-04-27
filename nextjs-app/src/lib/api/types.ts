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
}

export interface OrderFilters {
  producto?: string;
  estatus?: string;
  dateFilter?: string;
  customStart?: number | null;
  customEnd?: number | null;
}

export interface PaginationState {
  lastVisibleId: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
}
