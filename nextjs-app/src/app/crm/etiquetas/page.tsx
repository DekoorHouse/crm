"use client";

import { useState, useCallback } from "react";
import CrudPage from "@/components/crm/CrudPage";
import CrudModal from "@/components/crm/CrudModal";
import { createTag, updateTag, deleteTag } from "@/lib/api/crm";
import type { Tag } from "@/lib/api/crm";
import toast from "react-hot-toast";

function TagModal({ item, onClose, onSaved }: { item: Tag | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(item?.label ?? "");
  const [color, setColor] = useState(item?.color ?? "#6c757d");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!label.trim()) return;
    setSaving(true);
    try {
      const key = label.trim().toLowerCase().replace(/\s+/g, "_");
      if (item) {
        await updateTag(item.id, { label: label.trim(), color, key });
      } else {
        await createTag({ label: label.trim(), color, key, order: 999 });
      }
      toast.success(item ? "Etiqueta actualizada" : "Etiqueta creada");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrudModal title={item ? "Editar Etiqueta" : "Nueva Etiqueta"} onClose={onClose} onSubmit={handleSave} saving={saving} canSave={!!label.trim()}>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Nombre *</label>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej: Seguimiento" required className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
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
    </CrudModal>
  );
}

export default function EtiquetasPage() {
  const mapDoc = useCallback((id: string, d: Record<string, unknown>) => ({
    id, label: (d.label as string) || "", color: (d.color as string) || "#6c757d", key: (d.key as string) || "", order: (d.order as number) || 0,
  }), []);

  return (
    <CrudPage<Tag>
      title="Etiquetas"
      description="Etiquetas para categorizar conversaciones"
      icon="label"
      firestoreCollection="crm_tags"
      firestoreOrderBy="order"
      mapDoc={mapDoc}
      columns={[
        { key: "label", label: "Nombre", render: (t) => <span className="text-sm font-semibold text-on-surface">{t.label}</span> },
        { key: "color", label: "Color", render: (t) => (
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md" style={{ backgroundColor: t.color }} />
            <span className="text-xs font-mono text-on-surface-variant">{t.color}</span>
          </div>
        )},
      ]}
      renderForm={(item, onClose, onSaved) => <TagModal item={item} onClose={onClose} onSaved={onSaved} />}
      onDelete={(t) => deleteTag(t.id)}
    />
  );
}
