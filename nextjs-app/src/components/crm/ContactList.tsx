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
  designReview: boolean;
  onToggleDesignReview: () => void;
  pendingAi: boolean;
  onTogglePendingAi: () => void;
  channelFilter: string;
  onChannelFilter: (channel: string) => void;
  onPreview?: (contactId: string) => void;
  onMarkUnread?: (contactId: string) => void;
}

export default function ContactList({
  contacts, loading, selectedId, onSelect, onLoadMore, hasMore,
  searchQuery, onSearch, activeTag, onTagFilter, unreadOnly, onToggleUnread,
  designReview, onToggleDesignReview, pendingAi, onTogglePendingAi,
  channelFilter, onChannelFilter, onPreview, onMarkUnread,
}: ContactListProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "crm_tags"), orderBy("order")), (snap) => {
      setTags(snap.docs.map((d) => ({ id: d.id, label: d.data().label || "", color: d.data().color || "#6c757d", key: d.data().key || "" })));
    });
    return unsub;
  }, []);

  // Close tag menu on click outside
  useEffect(() => {
    if (!showTagMenu) return;
    function handleClick(e: MouseEvent) {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) setShowTagMenu(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowTagMenu(false);
    }
    setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showTagMenu]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200 && hasMore) onLoadMore();
  }

  // Find the active tag object for display
  const activeTagObj = tags.find((t) => t.key === activeTag);

  return (
    <aside className="w-full md:w-80 h-full flex flex-col border-r border-outline-variant/15 bg-surface-container-lowest md:flex-shrink-0">
      {/* Header + Search (con padding-left extra en mobile para el hamburger button) */}
      <div className="px-3 pl-16 md:pl-3 pt-3 pb-2 space-y-2.5 border-b border-outline-variant/10">
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
              className="w-full pl-8 pr-3 py-2 bg-surface-container-low rounded-xl text-xs text-on-surface border border-outline-variant/10 focus:border-primary/30 focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 transition-colors"
            />
            {searchQuery && (
              <button onClick={() => onSearch("")} className="absolute inset-y-0 right-2 flex items-center text-on-surface-variant/50 hover:text-on-surface">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
            )}
          </div>
          <button onClick={onToggleUnread} title="Solo no leidos"
            className={`p-1.5 rounded-lg transition-all ${unreadOnly ? "bg-primary/10 text-primary" : "text-on-surface-variant/50 hover:text-on-surface"}`}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{unreadOnly ? "mark_email_unread" : "mail"}</span>
          </button>
        </div>

        {/* Filters row */}
        {!searchQuery && (
          <div className="flex items-center gap-1.5 relative">
            <button
              onClick={() => { onTagFilter(""); setShowTagMenu(false); }}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${
                !activeTag && !designReview && !pendingAi ? "bg-primary text-on-primary border-primary shadow-sm" : "bg-surface-container-low text-on-surface-variant border-outline-variant/15 hover:text-on-surface hover:border-outline-variant/30"
              }`}
            >
              Todos
            </button>

            {/* Design review filter */}
            <button
              onClick={onToggleDesignReview}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all flex items-center gap-1 border ${
                designReview ? "bg-secondary/15 text-secondary border-secondary/25 shadow-sm" : "bg-surface-container-low text-on-surface-variant border-outline-variant/15 hover:text-on-surface hover:border-outline-variant/30"
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>palette</span>
              Diseno
            </button>

            {/* Pending AI filter */}
            <button
              onClick={onTogglePendingAi}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all flex items-center gap-1 border ${
                pendingAi ? "bg-primary/15 text-primary border-primary/25 shadow-sm" : "bg-surface-container-low text-on-surface-variant border-outline-variant/15 hover:text-on-surface hover:border-outline-variant/30"
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>smart_toy</span>
              Pend. IA
            </button>

            {/* Channel filters */}
            <button
              onClick={() => onChannelFilter(channelFilter === "messenger" ? "" : "messenger")}
              className={`flex-shrink-0 px-2 py-1 rounded-full text-[10px] font-bold transition-all border ${
                channelFilter === "messenger" ? "bg-blue-500/15 text-blue-600 border-blue-500/25 shadow-sm" : "bg-surface-container-low text-on-surface-variant border-outline-variant/15 hover:text-on-surface hover:border-outline-variant/30"
              }`}
            >
              FB
            </button>
            <button
              onClick={() => onChannelFilter(channelFilter === "instagram" ? "" : "instagram")}
              className={`flex-shrink-0 px-2 py-1 rounded-full text-[10px] font-bold transition-all border ${
                channelFilter === "instagram" ? "bg-pink-500/15 text-pink-600 border-pink-500/25 shadow-sm" : "bg-surface-container-low text-on-surface-variant border-outline-variant/15 hover:text-on-surface hover:border-outline-variant/30"
              }`}
            >
              IG
            </button>

            {/* Show active tag chip if one is selected */}
            {activeTagObj && (
              <button
                onClick={() => onTagFilter("")}
                className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold text-white flex items-center gap-1"
                style={{ backgroundColor: activeTagObj.color }}
              >
                {activeTagObj.label}
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>close</span>
              </button>
            )}

            {/* More tags button */}
            {tags.length > 0 && (
              <div ref={tagMenuRef} className="relative">
                <button
                  onClick={() => setShowTagMenu(!showTagMenu)}
                  className={`p-1 rounded-lg transition-all ${showTagMenu ? "bg-primary/10 text-primary" : "text-on-surface-variant/50 hover:text-on-surface"}`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>more_horiz</span>
                </button>

                {/* Dropdown menu */}
                {showTagMenu && (
                  <div className="absolute top-full left-0 mt-1.5 z-50 bg-surface-container-lowest rounded-xl shadow-2xl dark:shadow-[0_0_20px_rgba(122,162,247,0.15)] border border-outline-variant/20 py-1.5 w-48 max-h-64 overflow-y-auto">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => { onTagFilter(tag.key === activeTag ? "" : tag.key); setShowTagMenu(false); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                          activeTag === tag.key ? "bg-primary/10" : "hover:bg-surface-container-low"
                        }`}
                      >
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                        <span className="text-xs font-medium text-on-surface">{tag.label}</span>
                        {activeTag === tag.key && (
                          <span className="material-symbols-outlined ml-auto text-primary" style={{ fontSize: 14 }}>check</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
              <ContactItem key={contact.id} contact={contact} isActive={selectedId === contact.id} onClick={() => onSelect(contact.id)} onPreview={onPreview} onMarkUnread={onMarkUnread} />
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
