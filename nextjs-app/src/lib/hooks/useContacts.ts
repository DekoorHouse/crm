"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Contact } from "../api/contacts";
import { fetchContacts, searchContacts } from "../api/contacts";
import { db } from "../firebase/config";
import { collection, query, where, onSnapshot, Timestamp } from "firebase/firestore";

interface ContactFilters {
  tag?: string;
  unreadOnly?: boolean;
  departmentId?: string;
  purchaseStatus?: string;
  designReview?: boolean;
}

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ContactFilters>({});
  const lastVisibleId = useRef<string | null>(null);
  const appLoadTime = useRef(Timestamp.now());
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const loadContacts = useCallback(async (newFilters?: ContactFilters) => {
    const activeFilters = newFilters ?? filters;
    setLoading(true);
    lastVisibleId.current = null;
    try {
      const data = await fetchContacts({ limit: 50, ...activeFilters });
      setContacts(data.contacts);
      lastVisibleId.current = data.lastVisibleId;
      setHasMore(data.contacts.length >= 50);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !lastVisibleId.current) return;
    try {
      const data = await fetchContacts({ startAfterId: lastVisibleId.current, limit: 50, ...filters });
      setContacts((prev) => {
        const ids = new Set(prev.map((c) => c.id));
        return [...prev, ...data.contacts.filter((c) => !ids.has(c.id))];
      });
      lastVisibleId.current = data.lastVisibleId;
      setHasMore(data.contacts.length >= 50);
    } catch { /* */ }
  }, [hasMore, filters]);

  const search = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      loadContacts();
      return;
    }
    setLoading(true);
    try {
      const results = await searchContacts(q.trim());
      setContacts(results);
      setHasMore(false);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [loadContacts]);

  const applyFilters = useCallback((newFilters: ContactFilters) => {
    setFilters(newFilters);
    setSearchQuery("");
    loadContacts(newFilters);
  }, [loadContacts]);

  // Real-time listener
  useEffect(() => {
    unsubscribeRef.current?.();
    const contactsRef = collection(db, "contacts_whatsapp");
    const q = query(contactsRef, where("lastMessageTimestamp", ">", appLoadTime.current));
    unsubscribeRef.current = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const updated: Contact = {
          id: change.doc.id,
          name: data.name || change.doc.id,
          email: data.email || "",
          nickname: data.nickname || "",
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
          let next = idx >= 0 ? [...prev] : [updated, ...prev];
          if (idx >= 0) next[idx] = updated;
          next.sort((a, b) => (b.lastMessageTimestamp?._seconds ?? 0) - (a.lastMessageTimestamp?._seconds ?? 0));
          return next;
        });
      });
    });
    return () => unsubscribeRef.current?.();
  }, []);

  return { contacts, loading, hasMore, searchQuery, filters, loadContacts, loadMore, search, applyFilters };
}
