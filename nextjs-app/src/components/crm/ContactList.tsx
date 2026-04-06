"use client";

import { useEffect } from "react";
import type { Contact } from "@/lib/api/contacts";
import ContactItem from "./ContactItem";

interface ContactListProps {
  contacts: Contact[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
}

export default function ContactList({
  contacts,
  loading,
  selectedId,
  onSelect,
  onLoadMore,
  hasMore,
}: ContactListProps) {
  // Load more on scroll to bottom
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200 && hasMore) {
      onLoadMore();
    }
  }

  return (
    <aside className="w-80 h-full flex flex-col border-r border-outline-variant/15 bg-surface-container-lowest flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-4 border-b border-outline-variant/10">
        <h2 className="text-lg font-bold font-headline text-on-surface">Chats</h2>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {loading && contacts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 mb-2 block">
              chat_bubble_outline
            </span>
            <p className="text-sm text-on-surface-variant">No hay conversaciones</p>
          </div>
        ) : (
          <>
            {contacts.map((contact) => (
              <ContactItem
                key={contact.id}
                contact={contact}
                isActive={selectedId === contact.id}
                onClick={() => onSelect(contact.id)}
              />
            ))}
            {hasMore && (
              <div className="flex justify-center py-3">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
