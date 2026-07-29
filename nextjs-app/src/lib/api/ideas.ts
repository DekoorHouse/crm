// === Ideas / Pizarra personal de post-its (/ideas, fuera del CRM) ===
// Lecturas: listener de Firestore en la coleccion `ideas` (ver app/ideas/page.tsx).
// Escrituras: endpoints Express /api/ideas (firebase-admin), igual que /api/tags.

export interface Idea {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  /** Última edición en ms (viene de Firestore); solo lectura. */
  updatedAtMs?: number;
}

export type IdeaInput = Omit<Idea, "id" | "updatedAtMs">;

export interface IdeasConfig {
  /** Etiqueta por color hex, p. ej. { "#FEF08A": "Negocio" }. */
  legend: Record<string, string>;
  /** Fondo del tablero: puntos | cuadricula | renglones | liso. */
  fondo: string;
}

export interface RepasoResult {
  grupos: { nombre: string; ideas: string[] }[];
  olvidadas: { texto: string; dias: number }[];
  sugerencia: string;
  total: number;
}

export async function createIdea(idea: IdeaInput): Promise<string> {
  const res = await fetch("/api/ideas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(idea),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error creating idea");
  return data.id as string;
}

export async function updateIdea(id: string, patch: Partial<IdeaInput>): Promise<void> {
  const res = await fetch(`/api/ideas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating idea");
}

export async function deleteIdea(id: string): Promise<void> {
  const res = await fetch(`/api/ideas/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error deleting idea");
}

export async function saveIdeasConfig(patch: Partial<IdeasConfig>): Promise<void> {
  const res = await fetch("/api/ideas-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error guardando configuración");
}

export async function repasoMural(): Promise<RepasoResult> {
  const res = await fetch("/api/ideas/repaso", { method: "POST" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "No se pudo generar el repaso");
  return { grupos: data.grupos, olvidadas: data.olvidadas, sugerencia: data.sugerencia, total: data.total };
}

export async function desarrollarIdea(id: string): Promise<string[]> {
  const res = await fetch(`/api/ideas/${id}/desarrollar`, { method: "POST" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "No se pudo desarrollar la idea");
  return data.pasos as string[];
}
