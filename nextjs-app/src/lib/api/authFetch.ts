/**
 * authFetch.ts — Adjunta `Authorization: Bearer <Firebase ID token>` a TODAS las
 * llamadas fetch del mismo origen que van a /api, sin tocar los ~56 call-sites de
 * lib/api/*. Lo exige el middleware del servidor (server/apiAuth.js) en modo enforce.
 *
 * Reglas del interceptor:
 *  - Solo URLs del mismo origen cuyo path empiece con /api. Las URLs absolutas de
 *    Firebase (identitytoolkit, firestore) y las URLs firmadas de GCS (subida de
 *    archivos en MessageComposer) quedan fuera y NO se les agrega el header — a una
 *    URL firmada, un Authorization extra le invalida la firma.
 *  - Si la llamada ya trae Authorization propio (p. ej. OrderModal), se respeta.
 *  - Espera al primer evento de onAuthStateChanged (con tope de 3 s) para no mandar
 *    los primeros fetch sin token mientras Firebase restaura la sesión.
 *  - Ante cualquier error obteniendo el token, la llamada sale igual (sin header):
 *    en modo log el servidor solo lo anota; en enforce responderá 401.
 */
import { auth } from "@/lib/firebase/config";
import { onAuthStateChanged } from "firebase/auth";

let installed = false;
let authReady: Promise<void> | null = null;

/** Resuelve cuando Firebase ya emitió su primer estado de sesión (o a los 3 s). */
function ensureAuthReady(): Promise<void> {
  if (!authReady) {
    authReady = new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      const unsub = onAuthStateChanged(
        auth,
        () => { clearTimeout(timer); unsub(); resolve(); },
        () => { clearTimeout(timer); unsub(); resolve(); },
      );
    });
  }
  return authReady;
}

function isSameOriginApi(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, window.location.origin);
    return u.origin === window.location.origin && (u.pathname === "/api" || u.pathname.startsWith("/api/"));
  } catch {
    return false;
  }
}

/** Instala el interceptor global. Idempotente; no hace nada fuera del navegador. */
export function installApiAuthFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isSameOriginApi(input)) return original(input, init);
    try {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has("Authorization")) {
        await ensureAuthReady();
        const user = auth.currentUser;
        if (user) headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
      }
      return original(input, { ...init, headers });
    } catch {
      return original(input, init);
    }
  }) as typeof window.fetch;
}
