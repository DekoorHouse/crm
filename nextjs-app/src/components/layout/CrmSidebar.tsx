"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { useTheme } from "@/lib/hooks/useTheme";
import { signOut } from "@/lib/firebase/auth";
import { useState, useEffect } from "react";
import { db } from "@/lib/firebase/config";
import { collection, query, where, Timestamp, onSnapshot, orderBy, limit, getCountFromServer } from "firebase/firestore";

interface NavItem {
  href: string;
  icon: string;
  label: string;
}

const NAV_SECTIONS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/crm/chats", icon: "chat", label: "Chats" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/crm/rentabilidad", icon: "trending_up", label: "Rentabilidad" },
      { href: "/crm/mensajes-ads", icon: "chat_bubble", label: "Mensajes Ads" },
      { href: "/crm/carritos-abandonados", icon: "shopping_cart_off", label: "Carritos abandonados" },
    ],
  },
  {
    label: "Gestion",
    items: [
      { href: "/crm/departamentos", icon: "corporate_fare", label: "Departamentos" },
      { href: "/crm/reglas-ads", icon: "alt_route", label: "Reglas de Ads" },
      { href: "/crm/etiquetas", icon: "label", label: "Etiquetas" },
      { href: "/crm/respuestas-rapidas", icon: "quickreply", label: "Respuestas Rapidas" },
    ],
  },
  {
    label: "IA",
    items: [
      { href: "/crm/entrenamiento-ia", icon: "school", label: "Entrenamiento IA" },
      { href: "/crm/simulador-ia", icon: "smart_toy", label: "Simulador IA" },
    ],
  },
  {
    items: [
      { href: "/crm/ajustes", icon: "settings", label: "Ajustes" },
    ],
  },
];

interface CrmSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onMobileClose?: () => void;
}

export default function CrmSidebar({ collapsed: collapsedProp, onToggle, onMobileClose }: CrmSidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  // En mobile (< md = 768px) el sidebar siempre se ve expandido (no colapsado).
  // El layout maneja el show/hide via translate-x. La prop collapsed solo aplica en desktop.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const collapsed = isMobile ? false : collapsedProp;

  const userName = user?.email
    ? user.email.split("@")[0].charAt(0).toUpperCase() + user.email.split("@")[0].slice(1)
    : "Usuario";

  const [todayOrders, setTodayOrders] = useState(0);

  // Real-time today orders count
  useEffect(() => {
    const mexicoDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    const start = Timestamp.fromDate(new Date(mexicoDate + "T00:00:00-06:00"));
    const end = Timestamp.fromDate(new Date(mexicoDate + "T23:59:59.999-06:00"));
    const pedidosRef = collection(db, "pedidos");
    const countQ = query(pedidosRef, where("createdAt", ">=", start), where("createdAt", "<", end));

    // Initial count
    getCountFromServer(countQ).then((snap) => setTodayOrders(snap.data().count)).catch(() => {});

    // Listener for changes
    const listenerQ = query(pedidosRef, where("createdAt", ">=", start), where("createdAt", "<", end), orderBy("createdAt", "desc"), limit(1));
    let isFirst = true;
    const unsub = onSnapshot(listenerQ, () => {
      if (isFirst) { isFirst = false; return; }
      getCountFromServer(countQ).then((snap) => setTodayOrders(snap.data().count)).catch(() => {});
    });
    return unsub;
  }, []);

  return (
    <aside
      className={`h-screen flex flex-col bg-surface-container-lowest border-r border-outline-variant/15 flex-shrink-0 transition-all duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Brand + toggle */}
      <div className={`py-4 flex items-center ${collapsed ? "px-3 justify-center" : "px-5 gap-3"}`}>
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-xl avatar-gradient flex items-center justify-center flex-shrink-0 hover:opacity-90 transition-all shadow-sm md:flex hidden"
          title={collapsed ? "Expandir menu" : "Colapsar menu"}
        >
          <span className="material-symbols-outlined text-white" style={{ fontSize: 18 }}>
            {collapsed ? "menu" : "menu_open"}
          </span>
        </button>
        {/* Avatar gradient (solo mobile, no es boton) */}
        <div className="md:hidden w-8 h-8 rounded-xl avatar-gradient flex items-center justify-center flex-shrink-0 shadow-sm">
          <span className="text-white text-xs font-bold">D</span>
        </div>
        {!collapsed && (
          <div className="flex-1">
            <h1 className="text-sm font-extrabold font-headline text-on-surface leading-none">Dekoor</h1>
            <p className="text-[10px] text-on-surface-variant font-medium">CRM Workspace</p>
          </div>
        )}
        {/* Close button (mobile only) */}
        {onMobileClose && (
          <button
            onClick={onMobileClose}
            aria-label="Cerrar menu"
            className="md:hidden p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-all"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 overflow-y-auto pb-3 space-y-4 ${collapsed ? "px-2" : "px-3"}`}>
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={sIdx}>
            {section.label && !collapsed && (
              <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/50 px-2 mb-1">
                {section.label}
              </p>
            )}
            {section.label && collapsed && (
              <div className="border-t border-outline-variant/10 my-2" />
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center rounded-xl text-[13px] font-medium transition-all duration-150 ${
                      collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2"
                    } ${
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
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={`pb-4 space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
        {/* Today orders count */}
        {todayOrders > 0 && (
          <div className={`flex items-center rounded-xl text-[13px] font-medium transition-all ${
            collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2"
          }`} title={`${todayOrders} pedidos hoy`}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>receipt_long</span>
            {!collapsed && <span className="text-on-surface"><span className="font-bold text-primary">{todayOrders}</span> pedidos hoy</span>}
          </div>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={collapsed ? (isDark ? "Modo claro" : "Modo oscuro") : undefined}
          className={`w-full flex items-center rounded-xl text-[13px] font-medium text-on-surface-variant hover:bg-surface-container-low transition-all ${
            collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {isDark ? "light_mode" : "dark_mode"}
          </span>
          {!collapsed && (isDark ? "Modo claro" : "Modo oscuro")}
        </button>

        {/* User + logout */}
        <div className={`flex items-center border-t border-outline-variant/15 pt-3 ${
          collapsed ? "justify-center px-0 py-1" : "gap-3 px-3 py-2"
        }`}>
          <div className="w-8 h-8 rounded-full avatar-gradient flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm">
            {userName.charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <>
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
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
