"use client";

import { useEffect } from "react";

interface CrudModalProps {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  saving: boolean;
  canSave: boolean;
  children: React.ReactNode;
}

export default function CrudModal({ title, onClose, onSubmit, saving, canSave, children }: CrudModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/15 w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
          <h2 className="text-lg font-bold font-headline text-on-surface">{title}</h2>
          <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface rounded-lg transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {/* Body */}
        <div className="px-6 py-5 space-y-4">{children}</div>
        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-outline-variant/10">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-on-surface-variant bg-surface-container-high rounded-xl hover:bg-surface-container-highest transition-all">
            Cancelar
          </button>
          <button onClick={onSubmit} disabled={!canSave || saving} className="px-4 py-2 text-sm font-bold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-40 transition-all">
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
