"use client";

import { useState, useEffect, useRef } from "react";
import type { OrderFilters } from "@/lib/api/types";
import { PRODUCT_OPTIONS } from "@/lib/utils/productConfig";
import { STATUS_OPTIONS } from "@/lib/utils/statusConfig";
import { formatCurrency } from "@/lib/utils/format";

const DATE_OPTIONS = [
  { value: "ultimos-10-dias", label: "Últimos 10 días" },
  { value: "hoy", label: "Hoy" },
  { value: "ayer", label: "Ayer" },
  { value: "este-mes", label: "Este mes" },
];

interface FilterBarProps {
  onApply: (filters: OrderFilters) => void;
  todayCount: number;
  filteredCount: number;
  filteredSum: number;
  defaultDateFilter?: string;
}

export default function FilterBar({
  onApply,
  todayCount,
  filteredCount,
  filteredSum,
  defaultDateFilter = "ultimos-10-dias",
}: FilterBarProps) {
  const [producto, setProducto] = useState("");
  const [dateFilter, setDateFilter] = useState(defaultDateFilter);
  const [estatus, setEstatus] = useState("");
  const didMount = useRef(false);

  // Auto-apply filters on mount
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      onApply({ dateFilter: defaultDateFilter });
    }
  }, [defaultDateFilter, onApply]);

  function handleApply() {
    onApply({
      producto: producto || undefined,
      estatus: estatus || undefined,
      dateFilter: dateFilter || undefined,
    });
  }

  function handleClear() {
    setProducto("");
    setDateFilter("ultimos-10-dias");
    setEstatus("");
    onApply({ dateFilter: "ultimos-10-dias" });
  }

  return (
    <section className="px-8 py-6 bg-background">
      <div className="flex flex-wrap items-end justify-between gap-6 bg-surface-container-lowest p-6 rounded-3xl shadow-sm border border-outline-variant/10">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Product */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
              Productos
            </label>
            <select
              value={producto}
              onChange={(e) => setProducto(e.target.value)}
              className="block w-48 bg-surface-container-low border-none rounded-xl text-sm font-medium text-on-surface focus:ring-primary/20"
            >
              <option value="">Todos los productos</option>
              {PRODUCT_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
              Rango de Fecha
            </label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="block w-48 bg-surface-container-low border-none rounded-xl text-sm font-medium text-on-surface focus:ring-primary/20"
            >
              {DATE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
              Estatus
            </label>
            <select
              value={estatus}
              onChange={(e) => setEstatus(e.target.value)}
              className="block w-40 bg-surface-container-low border-none rounded-xl text-sm font-medium text-on-surface focus:ring-primary/20"
            >
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.id} value={s.label}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleApply}
              className="bg-primary text-on-primary px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition-all"
            >
              Aplicar
            </button>
            <button
              onClick={handleClear}
              className="bg-surface-container-high text-on-surface-variant px-4 py-2 rounded-xl text-sm font-bold hover:bg-surface-container-highest transition-all"
            >
              Limpiar
            </button>
          </div>
        </div>

        {/* Counters */}
        <div className="flex gap-8 items-center border-l border-outline-variant/30 pl-8">
          <div className="text-center">
            <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">Hoy</p>
            <p className="text-xl font-black text-primary">{todayCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">Filtrados</p>
            <p className="text-xl font-black text-secondary">{filteredCount}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase text-on-surface-variant mb-1">Total MXN</p>
            <p className="text-2xl font-black text-on-surface tracking-tight">
              {formatCurrency(filteredSum)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
