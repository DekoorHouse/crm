"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/firebase/auth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signIn(email, password);
      const redirect = searchParams.get("redirect");
      if (redirect && redirect.startsWith("/")) {
        window.location.href = redirect;
      } else {
        router.push("/pedidos");
      }
    } catch (err: unknown) {
      const firebaseError = err as { code?: string };
      if (
        firebaseError.code === "auth/user-not-found" ||
        firebaseError.code === "auth/wrong-password" ||
        firebaseError.code === "auth/invalid-credential"
      ) {
        setError("El correo o la contraseña no coinciden.");
      } else if (firebaseError.code === "auth/invalid-email") {
        setError("El formato del correo es incorrecto.");
      } else {
        setError("Ups! Algo salió mal.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface-container-lowest p-8 rounded-3xl shadow-lg border border-outline-variant/10">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-on-primary">
          <span
            className="material-symbols-outlined text-2xl"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            auto_stories
          </span>
        </div>
        <div>
          <h1 className="text-2xl font-black text-primary leading-none font-headline">
            Dekoor
          </h1>
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
            CRM Workspace
          </p>
        </div>
      </div>

      <h2 className="text-xl font-bold font-headline text-on-surface mb-1">
        Iniciar sesión
      </h2>
      <p className="text-sm text-on-surface-variant mb-6">
        Ingresa tus credenciales para acceder
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
            Correo electrónico
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            required
            className="w-full px-4 py-3 bg-surface-container-low border-none rounded-xl text-sm focus:ring-2 ring-primary/30 text-on-surface placeholder:text-on-surface-variant/50"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
            Contraseña
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full px-4 py-3 bg-surface-container-low border-none rounded-xl text-sm focus:ring-2 ring-primary/30 text-on-surface placeholder:text-on-surface-variant/50"
          />
        </div>

        {error && (
          <div className="bg-error-container/30 text-on-error-container text-sm px-4 py-3 rounded-xl font-medium">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold text-sm hover:shadow-lg transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
              Ingresando...
            </>
          ) : (
            "Ingresar"
          )}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md px-4">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
