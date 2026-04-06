"use client";

import { useEffect, useState } from "react";

export default function LoadingOverlay() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Stagger the entrance of each element
    const timers = [
      setTimeout(() => setStep(1), 100),   // logo ring
      setTimeout(() => setStep(2), 400),   // text "Dekoor"
      setTimeout(() => setStep(3), 700),   // subtitle
      setTimeout(() => setStep(4), 1000),  // progress bar starts
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background overflow-hidden">
      {/* Subtle radial glow behind the logo */}
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
            transition: "opacity 0.6s ease, transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          {/* Outer track */}
          <svg width="72" height="72" viewBox="0 0 72 72" className="absolute inset-0">
            <circle
              cx="36"
              cy="36"
              r="32"
              fill="none"
              stroke="var(--color-surface-container-high)"
              strokeWidth="3"
            />
          </svg>

          {/* Spinning arc */}
          <svg
            width="72"
            height="72"
            viewBox="0 0 72 72"
            className="absolute inset-0"
            style={{ animation: "loading-spin 1.4s linear infinite" }}
          >
            <circle
              cx="36"
              cy="36"
              r="32"
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="80 120"
            />
          </svg>

          {/* Pulsing dot at the center */}
          <div
            className="absolute inset-0 flex items-center justify-center"
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: "var(--color-primary)",
                animation: "loading-pulse 2s ease-in-out infinite",
              }}
            />
          </div>
        </div>

        {/* Brand name */}
        <h2
          className="text-2xl font-extrabold font-headline tracking-tight mb-1"
          style={{
            color: "var(--color-primary)",
            opacity: step >= 2 ? 1 : 0,
            transform: step >= 2 ? "translateY(0)" : "translateY(12px)",
            transition: "opacity 0.5s ease, transform 0.5s ease",
          }}
        >
          Dekoor
        </h2>

        {/* Subtitle */}
        <p
          className="text-sm text-on-surface-variant mb-8"
          style={{
            opacity: step >= 3 ? 1 : 0,
            transform: step >= 3 ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
          }}
        >
          Cargando workspace...
        </p>

        {/* Minimal progress bar */}
        <div
          className="mx-auto overflow-hidden rounded-full"
          style={{
            width: 120,
            height: 3,
            backgroundColor: "var(--color-surface-container-high)",
            opacity: step >= 4 ? 1 : 0,
            transition: "opacity 0.4s ease",
          }}
        >
          <div
            className="h-full rounded-full"
            style={{
              backgroundColor: "var(--color-primary)",
              animation: step >= 4 ? "loading-progress 2s ease-in-out infinite" : "none",
            }}
          />
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes loading-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes loading-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.5); }
        }
        @keyframes loading-progress {
          0% { width: 0%; margin-left: 0%; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}
