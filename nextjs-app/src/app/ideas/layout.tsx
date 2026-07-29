import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ideas — Pizarra personal",
  description: "Pizarra personal de post-its para aterrizar ideas.",
};

export default function IdeasLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen overflow-hidden bg-background">{children}</div>;
}
