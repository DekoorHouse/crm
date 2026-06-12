// === Reactivación de leads ===
// Config en Firestore: crm_settings/lead_reactivation (API: /api/leads/reactivacion)

export interface LeadFollowup {
  delayMinutes: number;
  text: string;
}

export interface LeadReactivationConfig {
  enabled: boolean;
  followups: LeadFollowup[];
  minDaysSinceLastOrder: number;
  cooldownHours: number;
  maxPerSweep: number;
}

export async function getLeadReactivationConfig(): Promise<LeadReactivationConfig> {
  const res = await fetch("/api/leads/reactivacion/config");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error al cargar la configuración");
  return data;
}

export async function saveLeadReactivationConfig(
  partial: Partial<Omit<LeadReactivationConfig, "maxPerSweep">>
): Promise<LeadReactivationConfig> {
  const res = await fetch("/api/leads/reactivacion/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error al guardar la configuración");
  return data;
}

export async function getLeadFollowupsCount(status = "pending"): Promise<number> {
  const res = await fetch(`/api/leads/reactivacion/seguimientos?status=${encodeURIComponent(status)}&limit=500`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error al listar seguimientos");
  return data.count || 0;
}
