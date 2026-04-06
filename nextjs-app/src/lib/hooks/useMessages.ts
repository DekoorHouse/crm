"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Message } from "../api/contacts";
import { fetchMessages } from "../api/contacts";
import { db } from "../firebase/config";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";

export function useMessages(contactId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Cleanup listener
  const cleanup = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  // Load messages and setup listener when contactId changes
  useEffect(() => {
    cleanup();
    setMessages([]);
    setSessionExpired(false);

    if (!contactId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // Setup real-time listener
    const messagesRef = collection(db, "contacts_whatsapp", contactId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "desc"), limit(50));

    unsubscribeRef.current = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          docId: doc.id,
          id: d.id || doc.id,
          from: d.from || "",
          text: d.text || "",
          timestamp: d.timestamp
            ? { seconds: d.timestamp.seconds, nanoseconds: d.timestamp.nanoseconds }
            : null,
          status: d.status || "sent",
          fileUrl: d.fileUrl,
          fileType: d.fileType,
          type: d.type,
          reaction: d.reaction,
          context: d.context,
          location: d.location,
        };
      });

      // Reverse to chronological order (newest last)
      msgs.reverse();
      setMessages(msgs);
      setLoading(false);

      // Check session expiration (24h since last message from the contact)
      const lastFromContact = msgs
        .filter((m) => m.from === contactId)
        .pop();
      if (lastFromContact?.timestamp) {
        const lastTs = lastFromContact.timestamp.seconds * 1000;
        const hoursSince = (Date.now() - lastTs) / (1000 * 60 * 60);
        setSessionExpired(hoursSince > 24);
      }
    });

    return cleanup;
  }, [contactId, cleanup]);

  // Send message (optimistic)
  const sendText = useCallback(
    async (text: string) => {
      if (!contactId || !text.trim()) return;
      const { sendMessage } = await import("../api/contacts");
      await sendMessage(contactId, text.trim());
    },
    [contactId]
  );

  return { messages, loading, sessionExpired, sendText };
}
