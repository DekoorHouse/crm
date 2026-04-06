"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Department } from "../api/departments";
import { fetchDepartments } from "../api/departments";
import { db } from "../firebase/config";
import { collection, orderBy, query, onSnapshot } from "firebase/firestore";

export function useDepartments() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const unsubRef = useRef<(() => void) | null>(null);

  // Initial load + real-time listener
  useEffect(() => {
    // Initial fetch via API
    fetchDepartments()
      .then(setDepartments)
      .catch(() => {})
      .finally(() => setLoading(false));

    // Real-time listener
    const q = query(collection(db, "departments"), orderBy("createdAt"));
    unsubRef.current = onSnapshot(q, (snap) => {
      const deps: Department[] = snap.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "",
        color: doc.data().color || "#6c757d",
      }));
      setDepartments(deps);
    });

    return () => unsubRef.current?.();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchDepartments();
      setDepartments(data);
    } catch {
      // silently fail — listener keeps data fresh
    }
  }, []);

  return { departments, loading, refresh };
}
