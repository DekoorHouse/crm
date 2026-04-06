"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Contact, Message } from "@/lib/api/contacts";
import { db } from "@/lib/firebase/config";
import { collection, query, orderBy, limit, getDocs, startAfter, Timestamp } from "firebase/firestore";
import MessageBubble from "./MessageBubble";

interface ConversationPreviewProps {
  contact: Contact;
  onClose: () => void;
  onOpenChat: () => void;
}

function mapDoc(doc: any): Message {
  const d = doc.data();
  return {
    docId: doc.id, id: d.id || doc.id, from: d.from || "", text: d.text || "",
    timestamp: d.timestamp ? { seconds: d.timestamp.seconds, nanoseconds: d.timestamp.nanoseconds } : null,
    status: d.status || "sent", fileUrl: d.fileUrl, fileType: d.fileType, type: d.type,
    reaction: d.reaction, context: d.context, location: d.location,
  };
}

export default function ConversationPreview({ contact, onClose, onOpenChat }: ConversationPreviewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const oldestTimestamp = useRef<Timestamp | null>(null);
  const isLoadingRef = useRef(false);

  // Initial load
  useEffect(() => {
    setLoading(true);
    const messagesRef = collection(db, "contacts_whatsapp", contact.id, "messages");
    const q = query(messagesRef, orderBy("timestamp", "desc"), limit(20));
    getDocs(q).then((snap) => {
      const msgs = snap.docs.map(mapDoc);
      if (snap.docs.length > 0) {
        oldestTimestamp.current = snap.docs[snap.docs.length - 1].data().timestamp;
      }
      setHasMore(snap.docs.length >= 20);
      msgs.reverse();
      setMessages(msgs);
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView(), 50);
    }).catch(() => setLoading(false));
  }, [contact.id]);

  // Load older messages
  const loadOlder = useCallback(async () => {
    if (isLoadingRef.current || !hasMore || !oldestTimestamp.current) return;
    isLoadingRef.current = true;
    setLoadingMore(true);
    try {
      const prevScrollHeight = scrollRef.current?.scrollHeight ?? 0;
      const messagesRef = collection(db, "contacts_whatsapp", contact.id, "messages");
      const q = query(messagesRef, orderBy("timestamp", "desc"), startAfter(oldestTimestamp.current), limit(20));
      const snap = await getDocs(q);
      const older = snap.docs.map(mapDoc);
      if (snap.docs.length > 0) {
        oldestTimestamp.current = snap.docs[snap.docs.length - 1].data().timestamp;
      }
      setHasMore(snap.docs.length >= 20);
      older.reverse();
      setMessages((prev) => [...older, ...prev]);
      // Maintain scroll position after prepending
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevScrollHeight;
        }
      });
    } finally {
      setLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [contact.id, hasMore]);

  // Scroll to top → load older
  function handleScroll() {
    if (scrollRef.current && scrollRef.current.scrollTop < 50 && hasMore && !loadingMore) {
      loadOlder();
    }
  }

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
      <div ref={ref} className="relative bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/15 w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: "75vh" }}>
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3" onScroll={handleScroll}>
          {loadingMore && (
            <div className="flex justify-center py-2">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-on-surface-variant/50 text-center py-8">Sin mensajes</p>
          ) : (
            <>
              {messages.map((msg, i) => {
                const msgDate = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
                const prevDate = i > 0 && messages[i - 1].timestamp ? new Date(messages[i - 1].timestamp!.seconds * 1000).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
                const showDate = msgDate && msgDate !== prevDate;
                return (
                  <div key={msg.docId}>
                    {showDate && (
                      <div className="flex justify-center my-3">
                        <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container-low px-3 py-1 rounded-full capitalize">
                          {msgDate}
                        </span>
                      </div>
                    )}
                    <MessageBubble message={msg} isSent={msg.from !== contact.id} allMessages={messages} />
                  </div>
                );
              })}
              <div ref={endRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
