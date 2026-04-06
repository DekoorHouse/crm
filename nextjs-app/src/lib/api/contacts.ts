export interface Contact {
  id: string;
  name: string;
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
  startAfterId?: string | null,
  limit = 30
): Promise<ContactsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (startAfterId) params.set("startAfterId", startAfterId);
  const res = await fetch(`/api/contacts?${params.toString()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error fetching contacts");
  return data;
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
  text: string
): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error sending message");
}
