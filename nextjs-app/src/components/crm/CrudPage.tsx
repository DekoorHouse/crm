"use client";

import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/firebase/config";
import { collection, orderBy, query, onSnapshot } from "firebase/firestore";
import toast from "react-hot-toast";

interface Column<T> {
  key: string;
  label: string;
  render: (item: T) => React.ReactNode;
}

interface CrudPageProps<T extends { id: string }> {
  title: string;
  description: string;
  icon: string;
  firestoreCollection: string;
  firestoreOrderBy?: string;
  columns: Column<T>[];
  mapDoc: (id: string, data: Record<string, unknown>) => T;
  renderForm: (item: T | null, onClose: () => void, onSaved: () => void) => React.ReactNode;
  onDelete: (item: T) => Promise<void>;
}

export default function CrudPage<T extends { id: string }>({
  title,
  description,
  icon,
  firestoreCollection,
  firestoreOrderBy: orderField,
  columns,
  mapDoc,
  renderForm,
  onDelete,
}: CrudPageProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const q = orderField
      ? query(collection(db, firestoreCollection), orderBy(orderField))
      : query(collection(db, firestoreCollection));

    unsubRef.current = onSnapshot(q, (snap) => {
      const data = snap.docs.map((doc) => mapDoc(doc.id, doc.data() as Record<string, unknown>));
      setItems(data);
      setLoading(false);
    });

    return () => unsubRef.current?.();
  }, [firestoreCollection, orderField, mapDoc]);

  function handleNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function handleEdit(item: T) {
    setEditing(item);
    setModalOpen(true);
  }

  async function handleDelete(item: T) {
    if (!confirm("¿Eliminar este elemento?")) return;
    try {
      await onDelete(item);
      toast.success("Eliminado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold font-headline text-on-surface">{title}</h1>
          <p className="text-sm text-on-surface-variant mt-1">{description}</p>
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
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 mb-2 block">{icon}</span>
            <p className="text-sm text-on-surface-variant">No hay elementos</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-surface-container-low/50 border-b border-outline-variant/10">
                {columns.map((col) => (
                  <th key={col.key} className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                    {col.label}
                  </th>
                ))}
                <th className="text-right px-5 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-outline-variant/5 hover:bg-surface-container-low/30 transition-colors">
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-3">
                      {col.render(item)}
                    </td>
                  ))}
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => handleEdit(item)} className="p-1.5 text-on-surface-variant/60 hover:text-primary hover:bg-primary/10 rounded-lg transition-all" title="Editar">
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                      </button>
                      <button onClick={() => handleDelete(item)} className="p-1.5 text-on-surface-variant/60 hover:text-error hover:bg-error-container/20 rounded-lg transition-all" title="Eliminar">
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
      {modalOpen && renderForm(editing, () => setModalOpen(false), () => {})}
    </div>
  );
}
