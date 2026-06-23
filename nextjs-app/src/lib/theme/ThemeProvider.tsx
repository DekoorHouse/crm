"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { onAuthChange } from "@/lib/firebase/auth";
import { applyThemeToDom } from "./applyTheme";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  getTheme,
  migrateThemeValue,
  type ThemeId,
  type ThemeMeta,
} from "./themes";

interface ThemeContextValue {
  /** Id del tema activo. */
  theme: ThemeId;
  /** Metadata del tema activo. */
  meta: ThemeMeta;
  /** Cambia el tema (aplica + guarda en localStorage + sincroniza a Firestore). */
  setTheme: (id: ThemeId) => void;
  /** Lista de temas disponibles. */
  themes: ThemeMeta[];
  /** true si el tema activo es oscuro. */
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);
  // uid del que ya leímos la preferencia en Firestore (evita re-leer en cada render).
  const pulledForUid = useRef<string | null>(null);
  // true en cuanto el usuario elige un tema manualmente: a partir de ahí su
  // elección local manda sobre lo que llegue de Firestore en este sesión.
  const userChanged = useRef(false);
  // uid actual logueado, para escribir a Firestore al cambiar de tema.
  const uidRef = useRef<string | null>(null);

  // 1) Al montar: toma el tema cacheado en localStorage (el script inline del
  //    layout ya lo aplicó al DOM; aquí solo sincronizamos el estado de React).
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* localStorage no disponible */
    }
    const id = migrateThemeValue(stored);
    setThemeState(id);
    applyThemeToDom(id);
  }, []);

  // 2) Al iniciar sesión: lee la preferencia guardada en la cuenta (una vez por uid).
  useEffect(() => {
    const unsub = onAuthChange(async (user) => {
      uidRef.current = user?.uid ?? null;
      if (!user) {
        pulledForUid.current = null;
        return;
      }
      if (pulledForUid.current === user.uid) return;
      pulledForUid.current = user.uid;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const remote = snap.exists() ? (snap.data() as { theme?: string }).theme : undefined;
        if (!remote) return;
        // Si el usuario ya eligió tema manualmente en esta sesión, respeta su elección.
        if (userChanged.current) return;
        const id = migrateThemeValue(remote);
        setThemeState(id);
        applyThemeToDom(id);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, id);
        } catch {
          /* noop */
        }
      } catch {
        /* sin conexión / permisos: nos quedamos con el cache local */
      }
    });
    return unsub;
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    userChanged.current = true;
    setThemeState(id);
    applyThemeToDom(id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* noop */
    }
    const uid = uidRef.current;
    if (uid) {
      setDoc(doc(db, "users", uid), { theme: id }, { merge: true }).catch(() => {
        /* el cache local ya guardó la elección */
      });
    }
  }, []);

  const value: ThemeContextValue = {
    theme,
    meta: getTheme(theme),
    setTheme,
    themes: THEMES,
    isDark: getTheme(theme).isDark,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  }
  return ctx;
}
