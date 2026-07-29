// === Ideas / Pizarra de post-its ===
// Lecturas: listener de Firestore en la coleccion `crm_ideas` (ver page.tsx).
// Escrituras: endpoints Express /api/ideas (firebase-admin), igual que /api/tags.

export interface Idea {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  rotation: number;
  z: number;
}

export type IdeaInput = Omit<Idea, "id">;

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
