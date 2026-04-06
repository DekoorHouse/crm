"use client";

import { useTheme } from "@/lib/hooks/useTheme";
import { useAuth } from "@/lib/hooks/useAuth";
import { signOut } from "@/lib/firebase/auth";
import { useState } from "react";

interface NavbarProps {
  viewMode: "tabla" | "kanban";
  onViewModeChange: (mode: "tabla" | "kanban") => void;
  onExport?: () => void;
  onNewOrder: () => void;
}

export default function Navbar({ viewMode, onViewModeChange, onNewOrder, onExport }: NavbarProps) {
  const { isDark, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const userName = user?.email
    ? user.email.split("@")[0].charAt(0).toUpperCase() + user.email.split("@")[0].slice(1)
    : "Usuario";

  return (
    <header className="bg-background/80 backdrop-blur-md sticky top-0 z-50 flex justify-between items-center px-8 py-4 border-b border-outline-variant/20">
      {/* Left side */}
      <div className="flex items-center gap-6">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-sm font-medium text-on-surface-variant">
          <span>Pedidos</span>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-primary font-bold border-b-2 border-primary pb-1 capitalize">
            {viewMode}
          </span>
        </nav>

        {/* Search */}
        <div className="relative hidden lg:block">
          <span className="absolute inset-y-0 left-3 flex items-center text-on-surface-variant">
            <span className="material-symbols-outlined text-lg">search</span>
          </span>
          <input
            type="text"
            placeholder="Buscar pedido..."
            className="pl-10 pr-4 py-2 bg-surface-container-low border-none rounded-xl text-sm focus:ring-2 ring-primary/20 w-64 text-on-surface placeholder:text-on-surface-variant/50"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* View toggle */}
        <div className="flex bg-surface-container-high p-1 rounded-xl">
          <button
            onClick={() => onViewModeChange("tabla")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              viewMode === "tabla"
                ? "bg-surface-container-lowest text-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            Tabla
          </button>
          <button
            onClick={() => onViewModeChange("kanban")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              viewMode === "kanban"
                ? "bg-surface-container-lowest text-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            Kanban
          </button>
        </div>

        {/* Export CSV */}
        {onExport && (
          <button
            onClick={onExport}
            className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-all"
            title="Exportar CSV"
          >
            <span className="material-symbols-outlined">download</span>
          </button>
        )}

        {/* Dark mode toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-all"
        >
          <span className="material-symbols-outlined">
            {isDark ? "light_mode" : "dark_mode"}
          </span>
        </button>

        {/* New order button */}
        <button
          onClick={onNewOrder}
          className="bg-primary text-on-primary px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:shadow-lg transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Nuevo Pedido
        </button>

        {/* User avatar + menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-sm border-2 border-primary/20 hover:border-primary/40 transition-all"
          >
            {userName.charAt(0).toUpperCase()}
          </button>

          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 top-12 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/20 py-2 w-56 z-50">
                <div className="px-4 py-3 border-b border-outline-variant/10">
                  <p className="text-sm font-bold text-on-surface">{userName}</p>
                  <p className="text-xs text-on-surface-variant">{user?.email}</p>
                </div>
                <button
                  onClick={() => {
                    signOut();
                    setShowUserMenu(false);
                  }}
                  className="w-full px-4 py-3 text-left text-sm text-error hover:bg-error-container/20 flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">logout</span>
                  Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
