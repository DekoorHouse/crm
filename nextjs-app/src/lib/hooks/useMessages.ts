"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Message } from "../api/contacts";
import { db } from "../firebase/config";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";

// Quita los pendings que ya tienen un mensaje real correspondiente en `msgs`.
// Match: mensaje saliente (from !== contactId) con mismo texto/fileUrl y timestamp
// >= pendingTimestamp - 5s (tolerancia por desfase de relojes).
function pruneMatchedPending(pending: Message[], msgs: Message[], contactId: string): Message[] {
  return pending.filter((p) => {
    const matched = msgs.some((m) => {
      if (m.from === contactId) return false; // entrante
      if (!m.timestamp || !p.timestamp) return false;
      if (m.timestamp.seconds < p.timestamp.seconds - 5) return false;
      if (p.fileUrl) return m.fileUrl === p.fileUrl;
      return m.text === p.text;
    });
    return !matched;
  });
}

export function useMessages(contactId: string | null) {
  const [realMessages, setRealMessages] = useState<Message[]>([]);
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
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
    setRealMessages([]);
    setPendingMessages([]);
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
      setRealMessages(msgs);
      setPendingMessages((prev) => pruneMatchedPending(prev, msgs, contactId));
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

  // Lista combinada: reales + pendings ordenados por timestamp
  const messages = useMemo(() => {
    if (pendingMessages.length === 0) return realMessages;
    return [...realMessages, ...pendingMessages].sort((a, b) => {
      const ta = a.timestamp?.seconds ?? 0;
      const tb = b.timestamp?.seconds ?? 0;
      return ta - tb;
    });
  }, [realMessages, pendingMessages]);

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
      setRealMessages(msgs);
      setPendingMessages((prev) => pruneMatchedPending(prev, msgs, contactId));
    });
  }, [contactId, cleanup]);

  const send = useCallback(async (opts: { text?: string; fileUrl?: string; fileType?: string }) => {
    if (!contactId) return;

    // Optimistic: agregar mensaje pendiente con spinner antes de llamar al API
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const optimistic: Message = {
      docId: tempId,
      id: tempId,
      from: "", // saliente: from !== contactId asi MessageBubble lo trata como enviado
      text: opts.text || "",
      timestamp: { seconds: nowSec, nanoseconds: 0 },
      status: "sending",
      fileUrl: opts.fileUrl,
      fileType: opts.fileType,
      context: replyTo?.id ? { id: replyTo.id } : undefined,
    };
    setPendingMessages((prev) => [...prev, optimistic]);
    const replyToSnapshot = replyTo;
    setReplyTo(null);

    try {
      const { sendMessage } = await import("../api/contacts");
      await sendMessage(contactId, {
        ...opts,
        reply_to_wamid: replyToSnapshot?.id,
      });
      // El listener traera el mensaje real y pruneMatchedPending lo limpiara
    } catch (err) {
      // Marca el pending como fallido para que el spinner deje de girar
      setPendingMessages((prev) =>
        prev.map((p) => (p.docId === tempId ? { ...p, status: "failed" } : p))
      );
      throw err;
    }
  }, [contactId, replyTo]);

  return { messages, loading, sessionExpired, replyTo, setReplyTo, send, loadOlder };
}
