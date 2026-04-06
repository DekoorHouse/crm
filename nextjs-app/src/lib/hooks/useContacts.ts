"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Contact } from "../api/contacts";
import { fetchContacts } from "../api/contacts";
import { db } from "../firebase/config";
import { collection, query, where, onSnapshot, Timestamp } from "firebase/firestore";

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const lastVisibleId = useRef<string | null>(null);
  const appLoadTime = useRef(Timestamp.now());
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Initial load
  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchContacts(null, 50);
      setContacts(data.contacts);
      lastVisibleId.current = data.lastVisibleId;
      setHasMore(data.contacts.length >= 50);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Load more (pagination)
  const loadMore = useCallback(async () => {
    if (!hasMore || !lastVisibleId.current) return;
    try {
      const data = await fetchContacts(lastVisibleId.current, 50);
      setContacts((prev) => {
        const ids = new Set(prev.map((c) => c.id));
        const newOnes = data.contacts.filter((c) => !ids.has(c.id));
        return [...prev, ...newOnes];
      });
      lastVisibleId.current = data.lastVisibleId;
      setHasMore(data.contacts.length >= 50);
    } catch {
      // silently fail
    }
  }, [hasMore]);

  // Real-time listener for contact updates
  useEffect(() => {
    const contactsRef = collection(db, "contacts_whatsapp");
    const q = query(
      contactsRef,
      where("lastMessageTimestamp", ">", appLoadTime.current)
    );

    unsubscribeRef.current = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const updated: Contact = {
          id: change.doc.id,
          name: data.name || change.doc.id,
          lastMessage: data.lastMessage || "",
          lastMessageTimestamp: data.lastMessageTimestamp
            ? { _seconds: data.lastMessageTimestamp.seconds, _nanoseconds: data.lastMessageTimestamp.nanoseconds }
            : null,
          unreadCount: data.unreadCount || 0,
          status: data.status || "",
          channel: data.channel || "whatsapp",
          botActive: data.botActive || false,
          lastOrderNumber: data.lastOrderNumber || null,
          assignedDepartmentId: data.assignedDepartmentId || null,
          purchaseStatus: data.purchaseStatus || null,
          inDesignReview: data.inDesignReview || false,
        };

        setContacts((prev) => {
          const idx = prev.findIndex((c) => c.id === updated.id);
          let next: Contact[];
          if (idx >= 0) {
            next = [...prev];
            next[idx] = updated;
          } else {
            next = [updated, ...prev];
          }
          // Re-sort by lastMessageTimestamp descending
          next.sort((a, b) => {
            const aT = a.lastMessageTimestamp?._seconds ?? 0;
            const bT = b.lastMessageTimestamp?._seconds ?? 0;
            return bT - aT;
          });
          return next;
        });
      });
    });

    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  return { contacts, loading, hasMore, loadContacts, loadMore };
}
