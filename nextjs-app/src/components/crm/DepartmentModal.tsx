"use client";

import { useState, useEffect } from "react";
import type { Department } from "@/lib/api/departments";
import { createDepartment, updateDepartment } from "@/lib/api/departments";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import toast from "react-hot-toast";

interface User { id: string; email: string; name: string; assignedDepartments: string[]; }

interface DepartmentModalProps {
  department: Department | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function DepartmentModal({ department, onClose, onSaved }: DepartmentModalProps) {
  const isEditing = !!department;
  const [name, setName] = useState(department?.name ?? "");
  const [color, setColor] = useState(department?.color ?? "#6c757d");
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  // Load users
  useEffect(() => {
    getDocs(collection(db, "users")).then((snap) => {
      const allUsers = snap.docs.map((d) => ({
        id: d.id,
        email: d.data().email || d.id,
        name: d.data().name || d.data().email || d.id,
        assignedDepartments: d.data().assignedDepartments || [],
      }));
      setUsers(allUsers);
      if (department) {
        setSelectedUsers(allUsers.filter((u) => u.assignedDepartments.includes(department.id)).map((u) => u.email));
      }
    }).catch(() => {});
  }, [department]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleUser(email: string) {
    setSelectedUsers((prev) => prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]);
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEditing) {
        await updateDepartment(department.id, name.trim(), color, selectedUsers);
        toast.success("Departamento actualizado");
      } else {
        await createDepartment(name.trim(), color, selectedUsers);
        toast.success("Departamento creado");
      }
      onSaved(); onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error al guardar"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/15 w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
          <h2 className="text-lg font-bold font-headline text-on-surface">{isEditing ? "Editar Departamento" : "Nuevo Departamento"}</h2>
          <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface rounded-lg transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Nombre *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Ventas" required
              className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Color</label>
            <div className="flex items-center gap-3">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded-lg border-none cursor-pointer bg-transparent" />
              <div className="flex-1 h-10 rounded-xl flex items-center px-4" style={{ backgroundColor: color + "20", border: `2px solid ${color}` }}>
                <span className="text-sm font-mono font-bold" style={{ color }}>{color}</span>
              </div>
            </div>
          </div>
          {users.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Usuarios asignados</label>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {users.map((user) => (
                  <label key={user.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-container-low cursor-pointer transition-colors">
                    <input type="checkbox" checked={selectedUsers.includes(user.email)}
                      onChange={() => toggleUser(user.email)}
                      className="w-4 h-4 rounded text-primary focus:ring-primary/20" />
                    <div>
                      <p className="text-xs font-semibold text-on-surface">{user.name}</p>
                      <p className="text-[10px] text-on-surface-variant">{user.email}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </form>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-outline-variant/10">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-on-surface-variant bg-surface-container-high rounded-xl hover:bg-surface-container-highest transition-all">Cancelar</button>
          <button onClick={() => handleSubmit()} disabled={!name.trim() || saving}
            className="px-4 py-2 text-sm font-bold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-40 transition-all">
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
