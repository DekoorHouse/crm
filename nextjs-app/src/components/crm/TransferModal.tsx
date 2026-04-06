"use client";

import { useState } from "react";
import { useDepartments } from "@/lib/hooks/useDepartments";
import { transferContact } from "@/lib/api/contacts";
import CrudModal from "./CrudModal";
import toast from "react-hot-toast";

interface TransferModalProps {
  contactId: string;
  contactName: string;
  onClose: () => void;
}

export default function TransferModal({ contactId, contactName, onClose }: TransferModalProps) {
  const { departments } = useDepartments();
  const [selectedDept, setSelectedDept] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleTransfer() {
    if (!selectedDept) return;
    setSaving(true);
    try {
      await transferContact(contactId, selectedDept);
      toast.success("Chat transferido");
      onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); }
  }

  return (
    <CrudModal title={`Transferir: ${contactName}`} onClose={onClose} onSubmit={handleTransfer} saving={saving} canSave={!!selectedDept}>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Departamento destino</label>
        <div className="space-y-1">
          {departments.map((dept) => (
            <button key={dept.id} onClick={() => setSelectedDept(dept.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                selectedDept === dept.id ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-surface-container-low"
              }`}>
              <div className="w-4 h-4 rounded-md flex-shrink-0" style={{ backgroundColor: dept.color }} />
              <span className="text-sm font-medium text-on-surface">{dept.name}</span>
            </button>
          ))}
        </div>
      </div>
    </CrudModal>
  );
}
