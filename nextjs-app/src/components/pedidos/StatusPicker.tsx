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
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const popoverWidth = 300;
  const gap = 8;
  const padding = 12;

  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  let top = anchorRect.bottom + gap;

  left = Math.max(padding, Math.min(left, window.innerWidth - popoverWidth - padding));

  const estimatedHeight = 280;
  if (top + estimatedHeight > window.innerHeight - padding) {
    top = anchorRect.top - estimatedHeight - gap;
  }
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
        transform: mounted ? "translateY(0) scale(1)" : "translateY(-6px) scale(0.98)",
        transition: "opacity 0.18s ease, transform 0.18s ease",
      }}
    >
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/15 overflow-hidden">
        {/* Grid of status chips */}
        <div className="p-2.5 grid grid-cols-2 gap-1.5">
          {STATUS_OPTIONS.map((status, index) => {
            const isActive = status.label === currentStatus;

            return (
              <button
                key={status.id}
                className="flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition-all duration-150 text-left group active:scale-[0.96]"
                style={{
                  backgroundColor: isActive ? `${status.color}20` : undefined,
                  border: isActive ? `1.5px solid ${status.color}50` : "1.5px solid transparent",
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? "translateY(0)" : "translateY(5px)",
                  transition: `all 0.2s ease ${index * 20}ms`,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = `${status.color}10`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isActive) onSelect(status.label);
                  onClose();
                }}
              >
                {/* Icon */}
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-150 group-hover:scale-110"
                  style={{ backgroundColor: `${status.color}18` }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16, color: status.color }}
                  >
                    {status.icon}
                  </span>
                </div>

                {/* Label */}
                <span
                  className="text-[11px] leading-tight font-semibold truncate"
                  style={{ color: isActive ? status.color : "var(--color-on-surface)" }}
                >
                  {status.label}
                </span>

                {/* Active check */}
                {isActive && (
                  <span
                    className="material-symbols-outlined ml-auto flex-shrink-0"
                    style={{ fontSize: 14, color: status.color }}
                  >
                    check
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
