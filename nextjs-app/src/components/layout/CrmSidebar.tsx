"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { useTheme } from "@/lib/hooks/useTheme";
import { signOut } from "@/lib/firebase/auth";

interface NavItem {
  href: string;
  icon: string;
  label: string;
}

const NAV_SECTIONS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/crm/chats", icon: "chat", label: "Chats" },
      { href: "/crm/clientes", icon: "people", label: "Clientes" },
      { href: "/crm/pipeline", icon: "view_kanban", label: "Pipeline" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/crm/difusion", icon: "campaign", label: "Difusion Masiva" },
      { href: "/crm/campanas", icon: "send", label: "Campanas" },
      { href: "/crm/campana-imagen", icon: "image", label: "Campana Imagen" },
      { href: "/crm/mensajes-ads", icon: "chat_bubble", label: "Mensajes Ads" },
    ],
  },
  {
    label: "Gestion",
    items: [
      { href: "/crm/contactos", icon: "contacts", label: "Contactos" },
      { href: "/crm/departamentos", icon: "corporate_fare", label: "Departamentos" },
      { href: "/crm/reglas-ads", icon: "alt_route", label: "Reglas de Ads" },
      { href: "/crm/etiquetas", icon: "label", label: "Etiquetas" },
      { href: "/crm/respuestas-rapidas", icon: "quickreply", label: "Respuestas Rapidas" },
    ],
  },
  {
    label: "IA & Datos",
    items: [
      { href: "/crm/entrenamiento-ia", icon: "school", label: "Entrenamiento IA" },
      { href: "/crm/simulador-ia", icon: "smart_toy", label: "Simulador IA" },
      { href: "/crm/metricas", icon: "analytics", label: "Metricas" },
    ],
  },
  {
    items: [
      { href: "/crm/ajustes", icon: "settings", label: "Ajustes" },
    ],
  },
];

export default function CrmSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const userName = user?.email
    ? user.email.split("@")[0].charAt(0).toUpperCase() + user.email.split("@")[0].slice(1)
    : "Usuario";

  return (
    <aside className="w-60 h-screen flex flex-col bg-surface-container-lowest border-r border-outline-variant/15 flex-shrink-0">
      {/* Brand */}
      <div className="px-5 py-5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="material-symbols-outlined text-on-primary" style={{ fontSize: 18 }}>
            storefront
          </span>
        </div>
        <div>
          <h1 className="text-sm font-extrabold font-headline text-on-surface leading-none">Dekoor</h1>
          <p className="text-[10px] text-on-surface-variant font-medium">CRM Workspace</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-4">
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={sIdx}>
            {section.label && (
              <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/50 px-2 mb-1">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-150 ${
                      isActive
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                    }`}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: 20,
                        fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                      }}
                    >
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 space-y-2">
        {/* Pedidos link */}
        <Link
          href="/pedidos"
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-all"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            receipt_long
          </span>
          Pedidos
        </Link>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium text-on-surface-variant hover:bg-surface-container-low transition-all"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {isDark ? "light_mode" : "dark_mode"}
          </span>
          {isDark ? "Modo claro" : "Modo oscuro"}
        </button>

        {/* User + logout */}
        <div className="flex items-center gap-3 px-3 py-2 border-t border-outline-variant/15 pt-3">
          <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xs flex-shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-on-surface truncate">{userName}</p>
            <p className="text-[10px] text-on-surface-variant truncate">{user?.email}</p>
          </div>
          <button
            onClick={() => signOut()}
            className="p-1.5 text-on-surface-variant hover:text-error rounded-lg transition-colors"
            title="Cerrar sesion"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
