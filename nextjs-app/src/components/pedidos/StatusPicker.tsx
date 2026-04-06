"use client";

import { useEffect, useRef, useState } from "react";
import { STATUS_OPTIONS } from "@/lib/utils/statusConfig";

interface StatusPickerProps {
  currentStatus: string;
  anchorRect: DOMRect;
  onSelect: (newStatus: string) => void;
  onClose: () => void;
}

export default function StatusPicker({ currentStatus, anchorRect, onSelect, onClose }: StatusPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    setTimeout(() => {
      document.addEventListener("keydown", handleKey);
      document.addEventListener("click", handleClick);
    }, 0);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("click", handleClick);
    };
  }, [onClose]);

  // Position popover below the badge, centered horizontally
  const popoverWidth = 280;
  const gap = 8;
  const padding = 12;

  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  let top = anchorRect.bottom + gap;

  // Clamp to viewport
  left = Math.max(padding, Math.min(left, window.innerWidth - popoverWidth - padding));

  // If not enough space below, show above
  const estimatedHeight = 320;
  if (top + estimatedHeight > window.innerHeight - padding) {
    top = anchorRect.top - estimatedHeight - gap;
  }
  // Clamp top
  top = Math.max(padding, top);

  return (
    <div
      ref={ref}
      className="fixed z-[70]"
      style={{
        left,
        top,
        width: popoverWidth,
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.97)",
        transition: "opacity 0.2s ease, transform 0.2s ease",
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-3 pb-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Cambiar estado
          </p>
        </div>

        {/* Grid of status options */}
        <div className="px-3 pb-3 grid grid-cols-2 gap-1.5">
          {STATUS_OPTIONS.map((status, index) => {
            const isActive = status.label === currentStatus;

            return (
              <button
                key={status.id}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 text-left group ${
                  isActive
                    ? "ring-2 ring-offset-1"
                    : "hover:bg-gray-50 active:scale-[0.97]"
                }`}
                style={{
                  backgroundColor: isActive ? `${status.color}12` : undefined,
                  // @ts-expect-error -- Tailwind ring-color via CSS variable
                  "--tw-ring-color": isActive ? status.color : undefined,
                  boxShadow: isActive ? `0 0 0 2px ${status.color}30` : undefined,
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? "translateY(0)" : "translateY(6px)",
                  transition: `all 0.2s ease ${index * 25}ms`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isActive) onSelect(status.label);
                  onClose();
                }}
              >
                {/* Icon circle */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-transform duration-150 group-hover:scale-110"
                  style={{
                    backgroundColor: `${status.color}18`,
                    color: status.color,
                  }}
                >
                  <span className="material-symbols-outlined text-base" style={{ color: status.color }}>
                    {status.icon}
                  </span>
                </div>

                {/* Label */}
                <span
                  className={`text-xs leading-tight font-medium ${
                    isActive ? "font-bold" : "text-gray-700"
                  }`}
                  style={isActive ? { color: status.color } : undefined}
                >
                  {status.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
