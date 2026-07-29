"use client";

import { type ReactNode } from "react";
import { AuthContext, useAuthState } from "@/lib/hooks/useAuth";
import { installApiAuthFetch } from "@/lib/api/authFetch";

// Interceptor global: todas las llamadas a /api salen con el ID token de Firebase
// (lo pide server/apiAuth.js). Se instala una sola vez al cargar el bundle.
installApiAuthFetch();

export default function AuthProvider({ children }: { children: ReactNode }) {
  const authState = useAuthState();
  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
}
