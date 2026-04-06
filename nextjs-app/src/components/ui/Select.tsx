"use client";

import { useState, useEffect, useRef } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = "",
  className = "",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [above, setAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? placeholder;

  function close() {
    setOpen(false);
    setMounted(false);
    setAbove(false);
  }

  function toggle() {
    if (open) {
      close();
    } else {
      setOpen(true);
    }
  }

  // Mount animation
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => {
      cancelAnimationFrame(frame);
      setMounted(false);
    };
  }, [open]);

  // Click-outside + Escape
  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      function onMouseDown(e: MouseEvent) {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          close();
        }
      }
      function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") close();
      }
      document.addEventListener("mousedown", onMouseDown);
      document.addEventListener("keydown", onKeyDown);

      // Store cleanup in ref-like closure
      cleanupRef.current = () => {
        document.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("keydown", onKeyDown);
      };
    }, 0);

    return () => {
      clearTimeout(timer);
      cleanupRef.current?.();
    };
  }, [open]);

  const cleanupRef = useRef<(() => void) | null>(null);

  // Flip detection
  useEffect(() => {
    if (!open || !mounted || !dropdownRef.current) return;
    const rect = dropdownRef.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 12) {
      setAbove(true);
    }
  }, [open, mounted]);

  function handleSelect(val: string) {
    onChange(val);
    close();
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 bg-surface-container-low rounded-xl px-3 py-2 text-sm font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
      >
        <span className="truncate">{selectedLabel}</span>
        <span
          className="material-symbols-outlined text-on-surface-variant"
          style={{
            fontSize: 18,
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className={`absolute left-0 right-0 z-50 ${
            above ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : above
                ? "translateY(4px) scale(0.97)"
                : "translateY(-4px) scale(0.97)",
            transition: "opacity 0.15s ease, transform 0.15s ease",
          }}
        >
          <div className="bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/20 py-1 max-h-60 overflow-y-auto">
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value + index}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors duration-150 cursor-pointer ${
                    isSelected
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-on-surface hover:bg-surface-container-low"
                  }`}
                  style={{
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? "translateY(0)" : "translateY(4px)",
                    transition: `opacity 0.15s ease ${index * 20}ms, transform 0.15s ease ${index * 20}ms`,
                  }}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && (
                    <span
                      className="material-symbols-outlined text-primary"
                      style={{ fontSize: 16 }}
                    >
                      check
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
