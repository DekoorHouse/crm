export interface Contact {
  id: string;
  name: string;
  email?: string;
  nickname?: string;
  lastMessage: string;
  lastMessageTimestamp: { _seconds: number; _nanoseconds: number } | null;
  unreadCount: number;
  status: string;
  channel: string;
  botActive: boolean;
  lastOrderNumber: number | null;
  assignedDepartmentId: string | null;
  purchaseStatus: string | null;
  inDesignReview: boolean;
}

export interface Message {
  docId: string;
  id: string;
  from: string;
  text: string;
  timestamp: { seconds: number; nanoseconds: number } | null;
  status: string;
  fileUrl?: string;
  fileType?: string;
  type?: string;
  reaction?: string;
  context?: { id: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  messagingType?: string;
  tag?: string;
}

interface ContactsResponse {
  success: boolean;
  contacts: Contact[];
  lastVisibleId: string | null;
}

interface MessagesResponse {
  success: boolean;
  messages: Message[];
}

export async function fetchContacts(
  opts: {
    startAfterId?: string | null;
    limit?: number;
    tag?: string;
    unreadOnly?: boolean;
    departmentId?: string;
    purchaseStatus?: string;
    designReview?: boolean;
    channel?: string;
  } = {}
): Promise<ContactsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 50));
  if (opts.startAfterId) params.set("startAfterId", opts.startAfterId);
  if (opts.tag) params.set("tag", opts.tag);
  if (opts.unreadOnly) params.set("unreadOnly", "true");
  if (opts.departmentId) params.set("departmentId", opts.departmentId);
  if (opts.purchaseStatus) params.set("purchaseStatus", opts.purchaseStatus);
  if (opts.designReview) params.set("designReview", "true");
  if (opts.channel) params.set("channel", opts.channel);
  const res = await fetch(`/api/contacts?${params.toString()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error fetching contacts");
  return data;
}

export async function searchContacts(query: string): Promise<Contact[]> {
  const res = await fetch(`/api/contacts/search?query=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error searching contacts");
  return data.contacts;
}

export async function fetchMessages(
  contactId: string,
  limit = 30,
  before?: number
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (before) params.set("before", String(before));
  const res = await fetch(`/api/contacts/${contactId}/messages-paginated?${params.toString()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error fetching messages");
  return data;
}

export async function sendMessage(
  contactId: string,
  body: { text?: string; fileUrl?: string; fileType?: string; reply_to_wamid?: string }
): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error sending message");
}

export async function updateContactStatus(contactId: string, status: string): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating status");
}

export async function transferContact(contactId: string, departmentId: string): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/transfer`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ departmentId }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error transferring contact");
}

export async function skipAi(contactId: string): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/skip-ai`, { method: "POST" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error");
}

export async function cancelAi(contactId: string): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/cancel-ai`, { method: "POST" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error");
}

export async function markAsPurchase(contactId: string, value: number): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/mark-as-purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error");
}

export async function pedirDatosEnvio(contactId: string): Promise<{ orderNumber: string }> {
  const res = await fetch(`/api/jt-guias/pedir-datos/${contactId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortcut: "Datos J&T" }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error al enviar solicitud de datos");
  return { orderNumber: data.orderNumber };
}

export async function updateContact(contactId: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating contact");
}

export async function getSignedUploadUrl(filename: string, contentType: string): Promise<string> {
  const res = await fetch("/api/storage/generate-signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error getting upload URL");
  return data.url;
}

export async function markContactUnread(contactId: string): Promise<void> {
  const { doc, updateDoc } = await import("firebase/firestore");
  const { db } = await import("../firebase/config");
  await updateDoc(doc(db, "contacts_whatsapp", contactId), { unreadCount: 1 });
}

export async function sendUtilityMessage(
  contactId: string,
  text: string,
  tag: "POST_PURCHASE_UPDATE" | "CONFIRMED_EVENT_UPDATE" | "ACCOUNT_UPDATE" = "POST_PURCHASE_UPDATE",
): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/utility-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, tag }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error enviando actualizacion");
}

export async function reactToMessage(contactId: string, messageDocId: string, emoji: string): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/messages/${messageDocId}/react`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error reacting");
}

export async function fetchContactOrders(contactId: string): Promise<unknown[]> {
  const res = await fetch(`/api/contacts/${contactId}/orders`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error fetching orders");
  return data.orders;
}
