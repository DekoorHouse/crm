"use client";

import { useState } from "react";

interface DeleteConfirmModalProps {
  orderNumber: number | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function DeleteConfirmModal({ orderNumber, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6 border border-outline-variant/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center">
            <span className="material-symbols-outlined text-error">delete</span>
          </div>
          <h3 className="text-lg font-bold font-headline text-on-surface">Eliminar pedido</h3>
        </div>

        <p className="text-sm text-on-surface-variant mb-6">
          ¿Estás seguro de que deseas eliminar el pedido{" "}
          <strong className="text-on-surface">DH{orderNumber ?? "--"}</strong>?
          Esta acción no se puede deshacer.
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container-high hover:bg-surface-container-highest transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-bold text-on-error bg-error hover:opacity-90 transition-all disabled:opacity-60 flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-on-error border-t-transparent rounded-full animate-spin" />
                Borrando...
              </>
            ) : (
              "Eliminar"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
