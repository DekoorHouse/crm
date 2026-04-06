"use client";

import { useState } from "react";
import { useDepartments } from "@/lib/hooks/useDepartments";
import { deleteDepartment } from "@/lib/api/departments";
import DepartmentModal from "@/components/crm/DepartmentModal";
import type { Department } from "@/lib/api/departments";
import toast from "react-hot-toast";

export default function DepartamentosPage() {
  const { departments, loading, refresh } = useDepartments();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);

  function handleNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function handleEdit(dept: Department) {
    setEditing(dept);
    setModalOpen(true);
  }

  async function handleDelete(dept: Department) {
    if (!confirm(`¿Eliminar "${dept.name}"?`)) return;
    try {
      await deleteDepartment(dept.id);
      toast.success("Departamento eliminado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold font-headline text-on-surface">Departamentos</h1>
          <p className="text-sm text-on-surface-variant mt-1">Gestiona los departamentos de tu equipo</p>
        </div>
        <button
          onClick={handleNew}
          className="bg-primary text-on-primary px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-all"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Nuevo
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : departments.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 mb-2 block">corporate_fare</span>
            <p className="text-sm text-on-surface-variant">No hay departamentos</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-surface-container-low/50 border-b border-outline-variant/10">
                <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Nombre</th>
                <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Color</th>
                <th className="text-right px-5 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr key={dept.id} className="border-b border-outline-variant/5 hover:bg-surface-container-low/30 transition-colors">
                  <td className="px-5 py-3">
                    <span className="text-sm font-semibold text-on-surface">{dept.name}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md flex-shrink-0" style={{ backgroundColor: dept.color }} />
                      <span className="text-xs font-mono text-on-surface-variant">{dept.color}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleEdit(dept)}
                        className="p-1.5 text-on-surface-variant/60 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                        title="Editar"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                      </button>
                      <button
                        onClick={() => handleDelete(dept)}
                        className="p-1.5 text-on-surface-variant/60 hover:text-error hover:bg-error-container/20 rounded-lg transition-all"
                        title="Eliminar"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <DepartmentModal
          department={editing}
          onClose={() => setModalOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
