"use client";

import { useState, useCallback } from "react";
import CrudPage from "@/components/crm/CrudPage";
import CrudModal from "@/components/crm/CrudModal";
import { createAdRoutingRule, updateAdRoutingRule, deleteAdRoutingRule } from "@/lib/api/crm";
import type { AdRoutingRule } from "@/lib/api/crm";
import toast from "react-hot-toast";

function RuleModal({ item, onClose, onSaved }: { item: AdRoutingRule | null; onClose: () => void; onSaved: () => void }) {
  const [ruleName, setRuleName] = useState(item?.ruleName ?? "");
  const [adIds, setAdIds] = useState(item?.adIds.join(", ") ?? "");
  const [targetDepartmentId, setTargetDepartmentId] = useState(item?.targetDepartmentId ?? "");
  const [enableAi, setEnableAi] = useState(item?.enableAi ?? false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!ruleName.trim()) return;
    setSaving(true);
    try {
      const payload = { ruleName: ruleName.trim(), adIds: adIds.split(",").map((s) => s.trim()).filter(Boolean), targetDepartmentId, enableAi };
      if (item) await updateAdRoutingRule(item.id, payload);
      else await createAdRoutingRule(payload);
      toast.success(item ? "Regla actualizada" : "Regla creada");
      onSaved(); onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); }
  }

  return (
    <CrudModal title={item ? "Editar Regla" : "Nueva Regla"} onClose={onClose} onSubmit={handleSave} saving={saving} canSave={!!ruleName.trim()}>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Nombre *</label>
        <input type="text" value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Ej: Campana Facebook" className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Ad IDs (separados por coma)</label>
        <input type="text" value={adIds} onChange={(e) => setAdIds(e.target.value)} placeholder="123456, 789012" className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Departamento ID</label>
        <input type="text" value={targetDepartmentId} onChange={(e) => setTargetDepartmentId(e.target.value)} placeholder="ID del departamento" className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={enableAi} onChange={(e) => setEnableAi(e.target.checked)} className="w-5 h-5 rounded-lg text-primary focus:ring-primary/20" />
        <span className="text-sm text-on-surface">Activar IA automatica</span>
      </label>
    </CrudModal>
  );
}

export default function ReglasAdsPage() {
  const mapDoc = useCallback((id: string, d: Record<string, unknown>) => ({
    id, ruleName: (d.ruleName as string) || "", adIds: (d.adIds as string[]) || [], targetDepartmentId: (d.targetDepartmentId as string) || "", enableAi: (d.enableAi as boolean) || false,
  }), []);

  return (
    <CrudPage<AdRoutingRule>
      title="Reglas de Ads"
      description="Enrutar anuncios a departamentos automaticamente"
      icon="alt_route"
      firestoreCollection="ad_routing_rules"
      firestoreOrderBy="createdAt"
      mapDoc={mapDoc}
      columns={[
        { key: "ruleName", label: "Nombre", render: (r) => <span className="text-sm font-semibold text-on-surface">{r.ruleName}</span> },
        { key: "adIds", label: "Ad IDs", render: (r) => <span className="text-xs text-on-surface-variant">{r.adIds.length} IDs</span> },
        { key: "enableAi", label: "IA", render: (r) => (
          <span className={`text-xs font-bold ${r.enableAi ? "text-primary" : "text-on-surface-variant/40"}`}>
            {r.enableAi ? "Activa" : "Inactiva"}
          </span>
        )},
      ]}
      renderForm={(item, onClose, onSaved) => <RuleModal item={item} onClose={onClose} onSaved={onSaved} />}
      onDelete={(r) => deleteAdRoutingRule(r.id)}
    />
  );
}
