"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useContacts } from "@/lib/hooks/useContacts";
import { useMessages } from "@/lib/hooks/useMessages";
import { changeOrderStatus } from "@/lib/api/orders";
import { markContactUnread } from "@/lib/api/contacts";
import ContactList from "@/components/crm/ContactList";
import ChatWindow from "@/components/crm/ChatWindow";
import ContactDetails from "@/components/crm/ContactDetails";
import ConversationPreview from "@/components/crm/ConversationPreview";
import OrderModal from "@/components/pedidos/OrderModal";
import { db } from "@/lib/firebase/config";
import { doc, updateDoc } from "firebase/firestore";
import toast from "react-hot-toast";

export default function ChatsPage() {
  const { contacts, loading, hasMore, loadContacts, loadMore, searchQuery, search, filters, applyFilters, updateContactLocal } = useContacts();
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
  const [designReview, setDesignReview] = useState(false);
  const [pendingAi, setPendingAi] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

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
    setDesignReview(false);
    setPendingAi(false);
    applyFilters({ tag: tag || undefined });
  }, [applyFilters]);

  const handleToggleUnread = useCallback(() => {
    const next = !unreadOnly;
    setUnreadOnly(next);
    applyFilters({ ...filters, unreadOnly: next || undefined });
  }, [applyFilters, filters, unreadOnly]);

  const handleToggleDesignReview = useCallback(() => {
    const next = !designReview;
    setDesignReview(next);
    setPendingAi(false);
    setActiveTag("");
    applyFilters({ designReview: next || undefined });
  }, [applyFilters, designReview]);

  const handleTogglePendingAi = useCallback(() => {
    const next = !pendingAi;
    setPendingAi(next);
    setDesignReview(false);
    setActiveTag(next ? "pendientes_ia" : "");
    applyFilters({ tag: next ? "pendientes_ia" : undefined });
  }, [applyFilters, pendingAi]);

  const handleToggleBot = useCallback(async () => {
    if (!selectedContact) return;
    const newVal = !selectedContact.botActive;
    updateContactLocal(selectedContact.id, { botActive: newVal });
    try {
      await updateDoc(doc(db, "contacts_whatsapp", selectedContact.id), { botActive: newVal });
      toast.success(newVal ? "IA activada" : "IA desactivada");
    } catch (err) {
      updateContactLocal(selectedContact.id, { botActive: !newVal });
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }, [selectedContact, updateContactLocal]);

  return (
    <div className="flex h-full">
      <ContactList
        contacts={contacts} loading={loading} selectedId={selectedId} onSelect={setSelectedId}
        onLoadMore={loadMore} hasMore={hasMore} searchQuery={searchQuery} onSearch={search}
        activeTag={activeTag} onTagFilter={handleTagFilter} unreadOnly={unreadOnly} onToggleUnread={handleToggleUnread}
        designReview={designReview} onToggleDesignReview={handleToggleDesignReview}
        pendingAi={pendingAi} onTogglePendingAi={handleTogglePendingAi}
        onPreview={(id) => setPreviewId(id)}
        onMarkUnread={(id) => { markContactUnread(id).then(() => toast.success("Marcado como no leido")).catch(() => {}); }}
      />
      <ChatWindow
        contact={selectedContact} messages={messages} loading={messagesLoading} sessionExpired={sessionExpired}
        onSend={send} replyTo={replyTo} onSetReplyTo={setReplyTo} onLoadOlder={loadOlder}
        onToggleDetails={() => setShowDetails(!showDetails)} showDetails={showDetails}
        onToggleBot={handleToggleBot}
      />
      {showDetails && selectedContact && (
        <ContactDetails
          contact={selectedContact}
          onClose={() => setShowDetails(false)}
          onNewOrder={() => setOrderModalOpen(true)}
          onStatusChange={async (orderId, newStatus) => {
            try {
              await changeOrderStatus(orderId, newStatus);
              toast.success(`Estatus cambiado a ${newStatus}`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Error");
            }
          }}
          onContactUpdated={() => {
            if (selectedId) updateContactLocal(selectedId, { botActive: !selectedContact.botActive });
          }}
        />
      )}

      {/* Order modal */}
      {orderModalOpen && (
        <OrderModal
          onClose={() => setOrderModalOpen(false)}
          onSaved={() => setOrderModalOpen(false)}
        />
      )}

      {/* Conversation preview */}
      {previewId && (() => {
        const previewContact = contacts.find((c) => c.id === previewId);
        if (!previewContact) return null;
        return (
          <ConversationPreview
            contact={previewContact}
            onClose={() => setPreviewId(null)}
            onOpenChat={() => { setSelectedId(previewId); setPreviewId(null); }}
          />
        );
      })()}
    </div>
  );
}
