"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useContacts } from "@/lib/hooks/useContacts";
import { useMessages } from "@/lib/hooks/useMessages";
import ContactList from "@/components/crm/ContactList";
import ChatWindow from "@/components/crm/ChatWindow";
import ContactDetails from "@/components/crm/ContactDetails";

export default function ChatsPage() {
  const { contacts, loading, hasMore, loadContacts, loadMore, searchQuery, search, filters, applyFilters } = useContacts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { messages, loading: messagesLoading, sessionExpired, replyTo, setReplyTo, send, loadOlder } = useMessages(selectedId);
  const [showDetails, setShowDetails] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("dekoor-chat-details") !== "false";
    }
    return true;
  });
  const [activeTag, setActiveTag] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  useEffect(() => {
    localStorage.setItem("dekoor-chat-details", String(showDetails));
  }, [showDetails]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId]
  );

  const handleTagFilter = useCallback((tag: string) => {
    setActiveTag(tag);
    applyFilters({ ...filters, tag: tag || undefined });
  }, [applyFilters, filters]);

  const handleToggleUnread = useCallback(() => {
    const next = !unreadOnly;
    setUnreadOnly(next);
    applyFilters({ ...filters, unreadOnly: next || undefined });
  }, [applyFilters, filters, unreadOnly]);

  return (
    <div className="flex h-full">
      <ContactList
        contacts={contacts} loading={loading} selectedId={selectedId} onSelect={setSelectedId}
        onLoadMore={loadMore} hasMore={hasMore} searchQuery={searchQuery} onSearch={search}
        activeTag={activeTag} onTagFilter={handleTagFilter} unreadOnly={unreadOnly} onToggleUnread={handleToggleUnread}
      />
      <ChatWindow
        contact={selectedContact} messages={messages} loading={messagesLoading} sessionExpired={sessionExpired}
        onSend={send} replyTo={replyTo} onSetReplyTo={setReplyTo} onLoadOlder={loadOlder}
        onToggleDetails={() => setShowDetails(!showDetails)} showDetails={showDetails}
      />
      {showDetails && selectedContact && (
        <ContactDetails contact={selectedContact} onClose={() => setShowDetails(false)} />
      )}
    </div>
  );
}
