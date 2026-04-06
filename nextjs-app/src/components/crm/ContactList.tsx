"use client";

import { useState, useEffect, useRef } from "react";
import type { Contact } from "@/lib/api/contacts";
import ContactItem from "./ContactItem";
import { db } from "@/lib/firebase/config";
import { collection, orderBy, query, onSnapshot } from "firebase/firestore";

interface Tag { id: string; label: string; color: string; key: string; }

interface ContactListProps {
  contacts: Contact[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  searchQuery: string;
  onSearch: (q: string) => void;
  activeTag: string;
  onTagFilter: (tag: string) => void;
  unreadOnly: boolean;
  onToggleUnread: () => void;
}

export default function ContactList({
  contacts, loading, selectedId, onSelect, onLoadMore, hasMore,
  searchQuery, onSearch, activeTag, onTagFilter, unreadOnly, onToggleUnread,
}: ContactListProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load tags from Firestore
  useEffect(() => {
    const q = query(collection(db, "crm_tags"), orderBy("order"));
    const unsub = onSnapshot(q, (snap) => {
      setTags(snap.docs.map((d) => ({ id: d.id, label: d.data().label || "", color: d.data().color || "#6c757d", key: d.data().key || "" })));
    });
    return unsub;
  }, []);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200 && hasMore) onLoadMore();
  }

  return (
    <aside className="w-80 h-full flex flex-col border-r border-outline-variant/15 bg-surface-container-lowest flex-shrink-0">
      {/* Header + Search */}
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-outline-variant/10">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <span className="absolute inset-y-0 left-2.5 flex items-center text-on-surface-variant/50">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
            </span>
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar..."
              className="w-full pl-8 pr-3 py-1.5 bg-surface-container-low rounded-lg text-xs text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50"
            />
            {searchQuery && (
              <button onClick={() => onSearch("")} className="absolute inset-y-0 right-2 flex items-center text-on-surface-variant/50 hover:text-on-surface">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
            )}
          </div>
          <button
            onClick={onToggleUnread}
            title="Solo no leidos"
            className={`p-1.5 rounded-lg transition-all ${unreadOnly ? "bg-primary/10 text-primary" : "text-on-surface-variant/50 hover:text-on-surface"}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              {unreadOnly ? "mark_email_unread" : "mail"}
            </span>
          </button>
        </div>

        {/* Tag filters */}
        {tags.length > 0 && !searchQuery && (
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => onTagFilter("")}
              className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                !activeTag ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Todos
            </button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => onTagFilter(tag.key)}
                className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold transition-all whitespace-nowrap ${
                  activeTag === tag.key ? "text-white" : "text-on-surface-variant hover:text-on-surface"
                }`}
                style={{
                  backgroundColor: activeTag === tag.key ? tag.color : `${tag.color}15`,
                  ...(activeTag !== tag.key && { color: tag.color }),
                }}
              >
                {tag.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {loading && contacts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 mb-2 block">chat_bubble_outline</span>
            <p className="text-sm text-on-surface-variant">{searchQuery ? "Sin resultados" : "No hay conversaciones"}</p>
          </div>
        ) : (
          <>
            {contacts.map((contact) => (
              <ContactItem key={contact.id} contact={contact} isActive={selectedId === contact.id} onClick={() => onSelect(contact.id)} />
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
