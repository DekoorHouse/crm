// === Libretas personales (/ideas, fuera del CRM) ===
// Lecturas: listeners de Firestore en `notebooks` y su subcoleccion `pages`.
// Escrituras: endpoints Express /api/notebooks (firebase-admin).

export interface Notebook {
  id: string;
  title: string;
  cover: string;
  x: number;
  y: number;
  rotation: number;
  z: number;
  pageCount: number;
  /** Texto de todas las hojas junto (lo mantiene el servidor) — sirve para buscar. */
  searchText: string;
  /** Ultima modificacion en ms; solo lectura. */
  updatedAtMs?: number;
}

export type NotebookInput = Pick<Notebook, "title" | "cover" | "x" | "y" | "rotation" | "z">;

export interface Page {
  id: string;
  /** Titulo de la hoja (arriba a la izquierda). */
  title: string;
  /** Texto plano: para buscar y para la IA. */
  text: string;
  /** El mismo contenido con los tramos de tinta (varios colores por hoja). */
  html: string;
  /** Ultima pluma usada en la hoja. */
  ink: string;
  order: number;
  /** Momento en que se empezo a escribir la hoja; lo sella el servidor. */
  writtenAtMs?: number;
}

export interface RepasoResult {
  grupos: { nombre: string; ideas: string[] }[];
  olvidadas: { texto: string; dias: number }[];
  sugerencia: string;
  total: number;
}

async function send<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Algo salió mal");
  return data as T;
}

// --- Libretas ---

export async function createNotebook(nb: NotebookInput): Promise<string> {
  const data = await send<{ id: string }>("/api/notebooks", "POST", nb);
  return data.id;
}

export function updateNotebook(id: string, patch: Partial<NotebookInput>): Promise<unknown> {
  return send(`/api/notebooks/${id}`, "PUT", patch);
}

export function deleteNotebook(id: string): Promise<unknown> {
  return send(`/api/notebooks/${id}`, "DELETE");
}

// --- Hojas ---

export async function addPage(notebookId: string, ink: string): Promise<string> {
  const data = await send<{ id: string }>(`/api/notebooks/${notebookId}/pages`, "POST", { ink });
  return data.id;
}

export function updatePage(
  notebookId: string,
  pageId: string,
  patch: { title?: string; text?: string; html?: string; ink?: string }
): Promise<unknown> {
  return send(`/api/notebooks/${notebookId}/pages/${pageId}`, "PUT", patch);
}

export function deletePage(notebookId: string, pageId: string): Promise<unknown> {
  return send(`/api/notebooks/${notebookId}/pages/${pageId}`, "DELETE");
}

// --- IA ---

export async function repasoEscritorio(): Promise<RepasoResult> {
  const d = await send<RepasoResult>("/api/notebooks/repaso", "POST");
  return { grupos: d.grupos, olvidadas: d.olvidadas, sugerencia: d.sugerencia, total: d.total };
}

export async function desarrollarHoja(notebookId: string, pageId: string): Promise<string[]> {
  const d = await send<{ pasos: string[] }>(
    `/api/notebooks/${notebookId}/pages/${pageId}/desarrollar`,
    "POST"
  );
  return d.pasos;
}

// --- Config del escritorio ---

export function saveDeskConfig(patch: { fondo?: string }): Promise<unknown> {
  return send("/api/ideas-config", "PUT", patch);
}
