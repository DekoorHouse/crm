import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ideas — Pizarra personal",
  description: "Pizarra personal de post-its para aterrizar ideas.",
};

export default function IdeasLayout({ children }: { children: React.ReactNode }) {
  // h-dvh (no h-screen): en móvil, 100vh incluye la zona tras la barra del
  // navegador y cortaba la barra inferior de acciones.
  return <div className="h-dvh overflow-hidden bg-background">{children}</div>;
}
