"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Message } from "../api/contacts";
import { db } from "../firebase/config";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";

export function useMessages(contactId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const msgLimit = useRef(50);

  const cleanup = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  useEffect(() => {
    cleanup();
    setMessages([]);
    setSessionExpired(false);
    setReplyTo(null);
    msgLimit.current = 50;

    if (!contactId) { setLoading(false); return; }
    setLoading(true);

    const messagesRef = collection(db, "contacts_whatsapp", contactId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "desc"), limit(msgLimit.current));

    unsubscribeRef.current = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = snapshot.docs.map((doc) => {
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

      // Check session expiration: 24h since last message FROM the contact
      const lastFromContact = msgs.filter((m) => m.from === contactId).pop();
      if (lastFromContact?.timestamp) {
        setSessionExpired((Date.now() - lastFromContact.timestamp.seconds * 1000) / 3600000 > 24);
      } else if (msgs.length > 0) {
        // There are messages but none from the contact — session expired
        setSessionExpired(true);
      }
    });

    return cleanup;
  }, [contactId, cleanup]);

  // Load older messages
  const loadOlder = useCallback(() => {
    if (!contactId) return;
    msgLimit.current += 30;
    cleanup();
    const messagesRef = collection(db, "contacts_whatsapp", contactId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "desc"), limit(msgLimit.current));
    unsubscribeRef.current = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = snapshot.docs.map((doc) => {
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
    });
  }, [contactId, cleanup]);

  const send = useCallback(async (opts: { text?: string; fileUrl?: string; fileType?: string }) => {
    if (!contactId) return;
    const { sendMessage } = await import("../api/contacts");
    await sendMessage(contactId, {
      ...opts,
      reply_to_wamid: replyTo?.id,
    });
    setReplyTo(null);
  }, [contactId, replyTo]);

  return { messages, loading, sessionExpired, replyTo, setReplyTo, send, loadOlder };
}
