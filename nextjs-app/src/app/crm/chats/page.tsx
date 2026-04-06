"use client";

import { useState, useEffect, useMemo } from "react";
import { useContacts } from "@/lib/hooks/useContacts";
import { useMessages } from "@/lib/hooks/useMessages";
import ContactList from "@/components/crm/ContactList";
import ChatWindow from "@/components/crm/ChatWindow";

export default function ChatsPage() {
  const { contacts, loading, hasMore, loadContacts, loadMore } = useContacts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { messages, loading: messagesLoading, sessionExpired, sendText } = useMessages(selectedId);

  // Load contacts on mount
  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Find selected contact object
  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId]
  );

  return (
    <div className="flex h-full">
      <ContactList
        contacts={contacts}
        loading={loading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onLoadMore={loadMore}
        hasMore={hasMore}
      />
      <ChatWindow
        contact={selectedContact}
        messages={messages}
        loading={messagesLoading}
        sessionExpired={sessionExpired}
        onSend={sendText}
      />
    </div>
  );
}
