"use client";

import type { Contact } from "@/lib/api/contacts";

interface ContactItemProps {
  contact: Contact;
  isActive: boolean;
  onClick: () => void;
}

function timeAgo(ts: { _seconds: number } | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts._seconds * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function ContactItem({ contact, isActive, onClick }: ContactItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
        isActive
          ? "bg-primary/10"
          : "hover:bg-surface-container-low"
      }`}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-sm">
          {(contact.name || contact.id).charAt(0).toUpperCase()}
        </div>
        {contact.purchaseStatus && (
          <div className={`absolute -top-0.5 -right-0.5 w-4.5 h-4.5 rounded-full flex items-center justify-center ${
            contact.purchaseStatus === "completed" ? "bg-primary" : "bg-surface-container-high"
          }`} style={{ width: 18, height: 18 }}>
            <span className="material-symbols-outlined text-on-primary" style={{ fontSize: 11, fontVariationSettings: "'FILL' 1" }}>
              workspace_premium
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-semibold truncate ${isActive ? "text-primary" : "text-on-surface"}`}>
            {contact.name || contact.id}
          </span>
          <span className="text-[10px] text-on-surface-variant flex-shrink-0">
            {timeAgo(contact.lastMessageTimestamp)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-xs text-on-surface-variant truncate">
            {contact.lastMessage || "Sin mensajes"}
          </p>
          {contact.unreadCount > 0 && (
            <span className="bg-primary text-on-primary text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 flex-shrink-0">
              {contact.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
