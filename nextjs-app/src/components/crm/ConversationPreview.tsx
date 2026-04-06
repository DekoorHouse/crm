"use client";

import { useState, useEffect, useRef } from "react";
import type { Contact, Message } from "@/lib/api/contacts";
import { db } from "@/lib/firebase/config";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import MessageBubble from "./MessageBubble";

interface ConversationPreviewProps {
  contact: Contact;
  onClose: () => void;
  onOpenChat: () => void;
}

export default function ConversationPreview({ contact, onClose, onOpenChat }: ConversationPreviewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Load last 15 messages (one-time, no listener — don't mark as read)
  useEffect(() => {
    setLoading(true);
    const messagesRef = collection(db, "contacts_whatsapp", contact.id, "messages");
    const q = query(messagesRef, orderBy("timestamp", "desc"), limit(15));
    getDocs(q).then((snap) => {
      const msgs: Message[] = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          docId: doc.id, id: d.id || doc.id, from: d.from || "", text: d.text || "",
          timestamp: d.timestamp ? { seconds: d.timestamp.seconds, nanoseconds: d.timestamp.nanoseconds } : null,
          status: d.status || "sent", fileUrl: d.fileUrl, fileType: d.fileType, type: d.type,
          reaction: d.reaction, context: d.context, location: d.location,
        };
      });
      msgs.reverse();
      setMessages(msgs);
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView(), 50);
    }).catch(() => setLoading(false));
  }, [contact.id]);

  // Close on click outside or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div ref={ref} className="relative bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/15 w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: "70vh" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-outline-variant/10">
          <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-sm flex-shrink-0">
            {(contact.name || contact.id).charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-on-surface truncate">{contact.name || contact.id}</h3>
            <p className="text-[11px] text-on-surface-variant">{contact.id}</p>
          </div>
          <button onClick={onOpenChat} className="text-[11px] font-bold text-primary hover:underline">
            Abrir chat
          </button>
          <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface rounded-lg">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-on-surface-variant/50 text-center py-8">Sin mensajes</p>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.docId} message={msg} isSent={msg.from !== contact.id} allMessages={messages} />
              ))}
              <div ref={endRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
