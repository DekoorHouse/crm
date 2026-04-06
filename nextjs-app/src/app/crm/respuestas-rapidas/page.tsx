"use client";

import { useState, useCallback } from "react";
import CrudPage from "@/components/crm/CrudPage";
import CrudModal from "@/components/crm/CrudModal";
import { createQuickReply, updateQuickReply, deleteQuickReply } from "@/lib/api/crm";
import type { QuickReply } from "@/lib/api/crm";
import toast from "react-hot-toast";

function QrModal({ item, onClose, onSaved }: { item: QuickReply | null; onClose: () => void; onSaved: () => void }) {
  const [shortcut, setShortcut] = useState(item?.shortcut ?? "");
  const [message, setMessage] = useState(item?.message ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!shortcut.trim()) return;
    setSaving(true);
    try {
      const payload = { shortcut: shortcut.trim(), message };
      if (item) await updateQuickReply(item.id, payload);
      else await createQuickReply(payload);
      toast.success(item ? "Respuesta actualizada" : "Respuesta creada");
      onSaved(); onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); }
  }

  return (
    <CrudModal title={item ? "Editar Respuesta" : "Nueva Respuesta"} onClose={onClose} onSubmit={handleSave} saving={saving} canSave={!!shortcut.trim()}>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Atajo *</label>
        <input type="text" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="Ej: hola" className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Mensaje</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hola! En que te puedo ayudar?" rows={4} className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 resize-none" />
      </div>
    </CrudModal>
  );
}

export default function RespuestasRapidasPage() {
  const mapDoc = useCallback((id: string, d: Record<string, unknown>) => ({
    id, shortcut: (d.shortcut as string) || "", message: (d.message as string) || "",
  }), []);

  return (
    <CrudPage<QuickReply>
      title="Respuestas Rapidas"
      description="Atajos de texto para responder rapidamente en el chat"
      icon="quickreply"
      firestoreCollection="quick_replies"
      mapDoc={mapDoc}
      columns={[
        { key: "shortcut", label: "Atajo", render: (q) => <span className="text-sm font-semibold text-primary font-mono">/{q.shortcut}</span> },
        { key: "message", label: "Mensaje", render: (q) => <p className="text-sm text-on-surface-variant truncate max-w-[300px]">{q.message || "—"}</p> },
      ]}
      renderForm={(item, onClose, onSaved) => <QrModal item={item} onClose={onClose} onSaved={onSaved} />}
      onDelete={(q) => deleteQuickReply(q.id)}
    />
  );
}
