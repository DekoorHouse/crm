"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { useEffect, useState } from "react";
import CrmSidebar from "@/components/layout/CrmSidebar";
import LoadingOverlay from "@/components/layout/LoadingOverlay";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Desktop: sidebar collapsed/expanded (icons-only vs full).
  // Mobile: sidebar oculto por defecto, se abre como drawer overlay.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      const current = window.location.pathname + window.location.search;
      router.push(`/login?redirect=${encodeURIComponent(current)}`);
    }
  }, [user, loading, router]);

  // Cerrar drawer mobile al navegar entre rutas
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  // ESC cierra el drawer mobile
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileSidebarOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileSidebarOpen]);

  // PWA: Inyectar manifest + meta tags + registrar service worker
  useEffect(() => {
    // Manifest
    let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.href = "/crm-manifest.json";

    // Theme color (barra superior en mobile)
    let theme = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!theme) {
      theme = document.createElement("meta");
      theme.name = "theme-color";
      document.head.appendChild(theme);
    }
    theme.content = "#1B4D5C";

    // Apple PWA meta tags (iOS Safari)
    const ensureMeta = (name: string, content: string) => {
      let m = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!m) {
        m = document.createElement("meta");
        m.name = name;
        document.head.appendChild(m);
      }
      m.content = content;
    };
    ensureMeta("apple-mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-status-bar-style", "default");
    ensureMeta("apple-mobile-web-app-title", "Dekoor CRM");
    ensureMeta("mobile-web-app-capable", "yes");

    // Apple touch icon
    let appleIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null;
    if (!appleIcon) {
      appleIcon = document.createElement("link");
      appleIcon.rel = "apple-touch-icon";
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = "/icon-192.png";

    // Registrar service worker (scope /crm/)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/crm-sw.js", { scope: "/crm/" })
        .then((reg) => {
          // Si hay update disponible, recargar al activarse el nuevo SW
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "activated" && navigator.serviceWorker.controller) {
                // Recarga silenciosa para tomar el nuevo SW
                window.location.reload();
              }
            });
          });
        })
        .catch((err) => console.warn("[PWA] SW registration failed:", err));
    }
  }, []);

  if (loading || !user) {
    return <LoadingOverlay />;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden relative">
      {/* Hamburger button (solo mobile) */}
      <button
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Abrir menu"
        className="md:hidden fixed top-3 left-3 z-30 w-10 h-10 rounded-xl bg-surface-container-lowest shadow-md flex items-center justify-center border border-outline-variant/20 active:scale-95 transition-transform"
      >
        <span className="material-symbols-outlined text-on-surface" style={{ fontSize: 22 }}>menu</span>
      </button>

      {/* Backdrop overlay (mobile) */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="md:hidden fixed inset-0 bg-black/50 z-40 animate-in fade-in"
        />
      )}

      {/* Sidebar:
          - Mobile: position fixed, slide-in/out con transform
          - Desktop (md+): position estatica dentro del flex */}
      <div
        className={`fixed md:static inset-y-0 left-0 z-50 transition-transform duration-200 md:transition-none md:translate-x-0 ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <CrmSidebar
          collapsed={!sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />
      </div>

      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>
    </div>
  );
}
