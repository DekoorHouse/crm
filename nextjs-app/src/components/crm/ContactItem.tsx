"use client";

import type { Contact } from "@/lib/api/contacts";

interface ContactItemProps {
  contact: Contact;
  isActive: boolean;
  onClick: () => void;
  onPreview?: (contactId: string) => void;
  onMarkUnread?: (contactId: string) => void;
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

export default function ContactItem({ contact, isActive, onClick, onPreview, onMarkUnread }: ContactItemProps) {
  return (
    <div
      className={`relative w-full flex items-start gap-3 px-4 py-3 text-left transition-colors cursor-pointer group ${
        isActive ? "bg-primary/10" : "hover:bg-surface-container-low"
      }`}
      onClick={onClick}
    >
      {/* Avatar */}
      <div className="flex-shrink-0">
        {contact.purchaseStatus === "completed" ? (
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-on-primary" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
              workspace_premium
            </span>
          </div>
        ) : contact.purchaseStatus === "registered" ? (
          <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
              workspace_premium
            </span>
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant font-bold text-sm">
            {(contact.name || contact.id).charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-semibold truncate ${isActive ? "text-primary" : "text-on-surface"}`}>
            {contact.name || contact.id}
          </span>
          <span className="text-[10px] text-on-surface-variant flex-shrink-0 group-hover:hidden">
            {timeAgo(contact.lastMessageTimestamp)}
          </span>
          {/* Hover actions — replace time */}
          <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
            {onPreview && (
              <button
                onClick={(e) => { e.stopPropagation(); onPreview(contact.id); }}
                title="Previsualizar"
                className="p-0.5 text-on-surface-variant/40 hover:text-primary rounded transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span>
              </button>
            )}
            {onMarkUnread && (
              <button
                onClick={(e) => { e.stopPropagation(); onMarkUnread(contact.id); }}
                title="Marcar como no leido"
                className="p-0.5 text-on-surface-variant/40 hover:text-primary rounded transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>mark_email_unread</span>
              </button>
            )}
          </div>
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
    </div>
  );
}
