"use client";

import { useState, useEffect } from "react";
import type { Department } from "@/lib/api/departments";
import { createDepartment, updateDepartment } from "@/lib/api/departments";
import toast from "react-hot-toast";

interface DepartmentModalProps {
  department: Department | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

export default function DepartmentModal({ department, onClose, onSaved }: DepartmentModalProps) {
  const isEditing = !!department;
  const [name, setName] = useState(department?.name ?? "");
  const [color, setColor] = useState(department?.color ?? "#6c757d");
  const [saving, setSaving] = useState(false);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEditing) {
        await updateDepartment(department.id, name.trim(), color);
        toast.success("Departamento actualizado");
      } else {
        await createDepartment(name.trim(), color);
        toast.success("Departamento creado");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/15 w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
          <h2 className="text-lg font-bold font-headline text-on-surface">
            {isEditing ? "Editar Departamento" : "Nuevo Departamento"}
          </h2>
          <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface rounded-lg transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
              Nombre *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Ventas"
              required
              className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50"
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
              Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg border-none cursor-pointer bg-transparent"
              />
              <div
                className="flex-1 h-10 rounded-xl flex items-center px-4"
                style={{ backgroundColor: color + "20", border: `2px solid ${color}` }}
              >
                <span className="text-sm font-mono font-bold" style={{ color }}>{color}</span>
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-outline-variant/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-on-surface-variant bg-surface-container-high rounded-xl hover:bg-surface-container-highest transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
            className="px-4 py-2 text-sm font-bold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-40 transition-all"
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
