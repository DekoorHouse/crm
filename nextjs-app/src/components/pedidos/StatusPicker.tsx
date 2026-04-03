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
  const [hoveredLabel, setHoveredLabel] = useState("Selecciona un estado");
  const [hoveredColor, setHoveredColor] = useState("#717973");
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

  // Center the menu on the clicked badge
  const menuSize = 280;
  const radius = 95;
  const centerX = anchorRect.left + anchorRect.width / 2;
  const centerY = anchorRect.top + anchorRect.height / 2;

  // Clamp to viewport
  const padding = 10;
  const left = Math.max(padding, Math.min(centerX - menuSize / 2, window.innerWidth - menuSize - padding));
  const top = Math.max(padding, Math.min(centerY - menuSize / 2, window.innerHeight - menuSize - padding));

  const numItems = STATUS_OPTIONS.length;
  const angleStep = 360 / numItems;

  return (
    <div
      ref={ref}
      className="fixed z-[70]"
      style={{ left, top, width: menuSize, height: menuSize }}
    >
      {/* Info bar */}
      <div
        className="absolute left-1/2 -translate-x-1/2 -top-10 px-4 py-1.5 rounded-full text-xs font-bold text-white whitespace-nowrap transition-all duration-200 shadow-lg"
        style={{ backgroundColor: hoveredColor }}
      >
        {hoveredLabel}
      </div>

      {/* Circular menu items */}
      <div className="relative w-full h-full">
        {STATUS_OPTIONS.map((status, index) => {
          const angle = (angleStep * index - 90) * (Math.PI / 180);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const isActive = status.label === currentStatus;

          return (
            <div
              key={status.id}
              className="absolute flex flex-col items-center gap-0.5 cursor-pointer group"
              style={{
                left: "50%",
                top: "50%",
                transform: mounted
                  ? `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1)`
                  : `translate(-50%, -50%) scale(0)`,
                transition: `transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 30}ms`,
              }}
              onMouseEnter={() => {
                setHoveredLabel(status.label);
                setHoveredColor(status.color);
              }}
              onMouseLeave={() => {
                setHoveredLabel("Selecciona un estado");
                setHoveredColor("#717973");
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!isActive) onSelect(status.label);
                onClose();
              }}
            >
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 group-hover:scale-[1.15] shadow-md ${
                  isActive ? "ring-3 ring-offset-2" : ""
                }`}
                style={{
                  backgroundColor: `${status.color}20`,
                  color: status.color,
                  ...(isActive && { ringColor: status.color }),
                  boxShadow: isActive ? `0 0 0 3px ${status.color}40` : undefined,
                }}
              >
                <span className="material-symbols-outlined text-lg" style={{ color: status.color }}>
                  {status.icon}
                </span>
              </div>
              <span
                className="text-[9px] font-bold text-center leading-tight max-w-[60px] transition-opacity duration-200"
                style={{ color: status.color }}
              >
                {status.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
