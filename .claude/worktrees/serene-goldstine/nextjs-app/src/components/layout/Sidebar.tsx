"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/pedidos", label: "Pedidos", icon: "shopping_cart" },
  { href: "/clientes", label: "Clientes", icon: "group" },
  { href: "/reportes", label: "Reportes", icon: "analytics" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden xl:flex h-screen w-64 flex-col p-6 gap-4 bg-surface-container-low border-r border-outline-variant/20 fixed left-0 top-0 z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-on-primary">
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            auto_stories
          </span>
        </div>
        <div>
          <h1 className="text-lg font-black text-primary leading-none font-headline">
            Dekoor
          </h1>
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
            CRM Workspace
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                isActive
                  ? "text-primary font-semibold bg-surface-container-lowest/50"
                  : "text-on-surface-variant hover:bg-surface-container-lowest/30"
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="font-medium text-sm">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="mt-auto pt-6 border-t border-outline-variant/20">
        <Link
          href="/configuracion"
          className="flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-surface-container-lowest/30 rounded-xl transition-all duration-200"
        >
          <span className="material-symbols-outlined">settings</span>
          <span className="font-medium text-sm">Configuración</span>
        </Link>
        <div className="mt-4 p-4 bg-primary/10 rounded-2xl">
          <p className="text-xs font-bold text-primary mb-2">Workspace</p>
          <div className="w-full bg-surface-container-highest rounded-full h-1.5">
            <div className="bg-primary h-1.5 rounded-full" style={{ width: "65%" }} />
          </div>
        </div>
      </div>
    </aside>
  );
}
