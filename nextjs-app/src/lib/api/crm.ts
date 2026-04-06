// === Tags ===
export interface Tag {
  id: string;
  label: string;
  color: string;
  key: string;
  order: number;
}

export async function fetchTags(): Promise<Tag[]> {
  // Tags come from Firestore listener, but we can also get via contacts endpoint tags
  // Using Firestore directly in the hook
  return [];
}

export async function createTag(tag: { label: string; color: string; key: string; order: number }): Promise<void> {
  const res = await fetch("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tag),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error creating tag");
}

export async function updateTag(id: string, tag: { label: string; color: string; key: string }): Promise<void> {
  const res = await fetch(`/api/tags/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tag),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating tag");
}

export async function deleteTag(id: string): Promise<void> {
  const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error deleting tag");
}

// === Ad Routing Rules ===
export interface AdRoutingRule {
  id: string;
  ruleName: string;
  adIds: string[];
  targetDepartmentId: string;
  enableAi: boolean;
}

export async function fetchAdRoutingRules(): Promise<AdRoutingRule[]> {
  const res = await fetch("/api/ad-routing-rules");
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error fetching rules");
  return data.rules;
}

export async function createAdRoutingRule(rule: Omit<AdRoutingRule, "id">): Promise<void> {
  const res = await fetch("/api/ad-routing-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error creating rule");
}

export async function updateAdRoutingRule(id: string, rule: Omit<AdRoutingRule, "id">): Promise<void> {
  const res = await fetch(`/api/ad-routing-rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating rule");
}

export async function deleteAdRoutingRule(id: string): Promise<void> {
  const res = await fetch(`/api/ad-routing-rules/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error deleting rule");
}

// === Ad Responses ===
export interface AdResponse {
  id: string;
  adName: string;
  adIds: string[];
  message: string;
  fileUrl?: string;
  fileType?: string;
}

export async function createAdResponse(resp: Omit<AdResponse, "id">): Promise<void> {
  const res = await fetch("/api/ad-responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resp),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error creating ad response");
}

export async function updateAdResponse(id: string, resp: Omit<AdResponse, "id">): Promise<void> {
  const res = await fetch(`/api/ad-responses/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resp),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating ad response");
}

export async function deleteAdResponse(id: string): Promise<void> {
  const res = await fetch(`/api/ad-responses/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error deleting ad response");
}

// === Quick Replies ===
export interface QuickReply {
  id: string;
  shortcut: string;
  message: string;
  fileUrl?: string;
  fileType?: string;
}

export async function createQuickReply(qr: Omit<QuickReply, "id">): Promise<void> {
  const res = await fetch("/api/quick-replies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(qr),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error creating quick reply");
}

export async function updateQuickReply(id: string, qr: Omit<QuickReply, "id">): Promise<void> {
  const res = await fetch(`/api/quick-replies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(qr),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating quick reply");
}

export async function deleteQuickReply(id: string): Promise<void> {
  const res = await fetch(`/api/quick-replies/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error deleting quick reply");
}

// === AI Simulator ===
export interface SimulateAiResponse {
  success: boolean;
  response: string;
  inputTokens: number;
  outputTokens: number;
}

export async function simulateAi(message: string, history: { role: string; content: string }[] = []): Promise<SimulateAiResponse> {
  const res = await fetch("/api/simulate-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, source: "crm" }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error simulating AI");
  return data;
}

// === Settings ===
export async function getAwayMessage(): Promise<{ isActive: boolean }> {
  const res = await fetch("/api/settings/away-message");
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error fetching settings");
  return data.settings;
}

export async function setAwayMessage(isActive: boolean): Promise<void> {
  const res = await fetch("/api/settings/away-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating settings");
}

export async function getGoogleSheet(): Promise<{ googleSheetId: string }> {
  const res = await fetch("/api/settings/google-sheet");
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error fetching settings");
  return data.settings;
}

export async function setGoogleSheet(googleSheetId: string): Promise<void> {
  const res = await fetch("/api/settings/google-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ googleSheetId }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Error updating settings");
}
