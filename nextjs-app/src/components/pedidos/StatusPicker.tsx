"use client";

import { useEffect, useRef } from "react";
import { STATUS_OPTIONS } from "@/lib/utils/statusConfig";

interface StatusPickerProps {
  currentStatus: string;
  anchorRect: DOMRect;
  onSelect: (newStatus: string) => void;
  onClose: () => void;
}

export default function StatusPicker({ currentStatus, anchorRect, onSelect, onClose }: StatusPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", handleKey);
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Position below the clicked badge, clamped to viewport
  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - 420);
  const left = Math.min(anchorRect.left, window.innerWidth - 240);

  return (
    <div
      ref={ref}
      className="fixed z-[70] bg-surface-container-lowest rounded-2xl shadow-xl border border-outline-variant/20 py-2 w-56 overflow-hidden"
      style={{ top, left }}
    >
      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant px-4 py-2">
        Cambiar estatus
      </p>
      <div className="max-h-[360px] overflow-y-auto">
        {STATUS_OPTIONS.map((status) => {
          const isActive = status.label === currentStatus;
          return (
            <button
              key={status.id}
              onClick={() => {
                if (!isActive) onSelect(status.label);
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 font-bold"
                  : "hover:bg-surface-container-high"
              }`}
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: status.color }}
              />
              <span
                className="material-symbols-outlined text-base"
                style={{ color: status.color }}
              >
                {status.icon}
              </span>
              <span className={isActive ? "text-primary" : "text-on-surface"}>
                {status.label}
              </span>
              {isActive && (
                <span className="material-symbols-outlined text-primary text-sm ml-auto">check</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
