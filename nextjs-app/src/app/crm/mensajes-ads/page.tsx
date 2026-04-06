"use client";

import { useState, useCallback } from "react";
import CrudPage from "@/components/crm/CrudPage";
import CrudModal from "@/components/crm/CrudModal";
import { createAdResponse, updateAdResponse, deleteAdResponse } from "@/lib/api/crm";
import type { AdResponse } from "@/lib/api/crm";
import toast from "react-hot-toast";

function AdResponseModal({ item, onClose, onSaved }: { item: AdResponse | null; onClose: () => void; onSaved: () => void }) {
  const [adName, setAdName] = useState(item?.adName ?? "");
  const [adIds, setAdIds] = useState(item?.adIds.join(", ") ?? "");
  const [message, setMessage] = useState(item?.message ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!adName.trim()) return;
    setSaving(true);
    try {
      const payload = { adName: adName.trim(), adIds: adIds.split(",").map((s) => s.trim()).filter(Boolean), message };
      if (item) await updateAdResponse(item.id, payload);
      else await createAdResponse(payload);
      toast.success(item ? "Mensaje actualizado" : "Mensaje creado");
      onSaved(); onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); }
  }

  return (
    <CrudModal title={item ? "Editar Mensaje" : "Nuevo Mensaje"} onClose={onClose} onSubmit={handleSave} saving={saving} canSave={!!adName.trim()}>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Nombre del anuncio *</label>
        <input type="text" value={adName} onChange={(e) => setAdName(e.target.value)} placeholder="Ej: Promo Navidad" className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Ad IDs (separados por coma)</label>
        <input type="text" value={adIds} onChange={(e) => setAdIds(e.target.value)} placeholder="123456, 789012" className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Mensaje de respuesta</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hola! Gracias por tu interes..." rows={3} className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 resize-none" />
      </div>
    </CrudModal>
  );
}

export default function MensajesAdsPage() {
  const mapDoc = useCallback((id: string, d: Record<string, unknown>) => ({
    id, adName: (d.adName as string) || "", adIds: (d.adIds as string[]) || [], message: (d.message as string) || "", fileUrl: d.fileUrl as string | undefined, fileType: d.fileType as string | undefined,
  }), []);

  return (
    <CrudPage<AdResponse>
      title="Mensajes Ads"
      description="Respuestas automaticas por anuncio"
      icon="chat_bubble"
      firestoreCollection="ad_responses"
      firestoreOrderBy="adName"
      mapDoc={mapDoc}
      columns={[
        { key: "adName", label: "Anuncio", render: (r) => <span className="text-sm font-semibold text-on-surface">{r.adName}</span> },
        { key: "adIds", label: "Ad IDs", render: (r) => <span className="text-xs text-on-surface-variant">{r.adIds.length} IDs</span> },
        { key: "message", label: "Mensaje", render: (r) => <p className="text-xs text-on-surface-variant truncate max-w-[200px]">{r.message || "—"}</p> },
      ]}
      renderForm={(item, onClose, onSaved) => <AdResponseModal item={item} onClose={onClose} onSaved={onSaved} />}
      onDelete={(r) => deleteAdResponse(r.id)}
    />
  );
}
