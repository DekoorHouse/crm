"use client";

import { useEffect, useState } from "react";

const BRAND = "Dekoor";
const SUBTITLE = "Cargando workspace...";

export default function LoadingOverlay() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 100),   // ring
      setTimeout(() => setStep(2), 500),   // brand letters
      setTimeout(() => setStep(3), 1100),  // subtitle letters
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background overflow-hidden">
      {/* Subtle radial glow */}
      <div
        className="absolute"
        style={{
          width: 300,
          height: 300,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, var(--color-primary) 0%, transparent 70%)",
          opacity: step >= 1 ? 0.06 : 0,
          transition: "opacity 1.2s ease",
        }}
      />

      <div className="relative text-center">
        {/* Animated ring */}
        <div
          className="relative mx-auto mb-8"
          style={{
            width: 72,
            height: 72,
            opacity: step >= 1 ? 1 : 0,
            transform: step >= 1 ? "scale(1)" : "scale(0.5)",
            transition:
              "opacity 0.6s ease, transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          {/* Track */}
          <svg width="72" height="72" viewBox="0 0 72 72" className="absolute inset-0">
            <circle
              cx="36" cy="36" r="32"
              fill="none"
              stroke="var(--color-surface-container-high)"
              strokeWidth="3"
            />
          </svg>
          {/* Spinning arc */}
          <svg
            width="72" height="72" viewBox="0 0 72 72"
            className="absolute inset-0"
            style={{ animation: "loading-spin 1.4s linear infinite" }}
          >
            <circle
              cx="36" cy="36" r="32"
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="80 120"
            />
          </svg>
        </div>

        {/* Brand name — each letter drops in */}
        <h2
          className="text-2xl font-extrabold font-headline tracking-tight mb-1 flex justify-center"
          style={{ color: "var(--color-primary)" }}
        >
          {BRAND.split("").map((char, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: step >= 2 ? 1 : 0,
                transform: step >= 2 ? "translateY(0) scale(1)" : "translateY(-18px) scale(0.6)",
                filter: step >= 2 ? "blur(0px)" : "blur(4px)",
                transition: `opacity 0.4s ease ${i * 60}ms, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 60}ms, filter 0.4s ease ${i * 60}ms`,
              }}
            >
              {char}
            </span>
          ))}
        </h2>

        {/* Subtitle — each letter fades in */}
        <p className="text-sm text-on-surface-variant flex justify-center">
          {SUBTITLE.split("").map((char, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                whiteSpace: char === " " ? "pre" : undefined,
                opacity: step >= 3 ? 1 : 0,
                transform: step >= 3 ? "translateY(0)" : "translateY(6px)",
                transition: `opacity 0.3s ease ${i * 25}ms, transform 0.3s ease ${i * 25}ms`,
              }}
            >
              {char}
            </span>
          ))}
        </p>
      </div>

      <style>{`
        @keyframes loading-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
