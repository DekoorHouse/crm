"use client";

import { useState, useEffect, createContext, useContext } from "react";
import type { User } from "firebase/auth";
import { onAuthChange } from "../firebase/auth";

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true });

export function useAuth() {
  return useContext(AuthContext);
}

export { AuthContext };

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setState({ user, loading: false });
    });
    return unsubscribe;
  }, []);

  return state;
}
