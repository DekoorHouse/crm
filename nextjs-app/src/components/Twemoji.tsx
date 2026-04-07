"use client";

import { useEffect, useRef } from "react";
import twemoji from "twemoji";

interface TwemojiProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Reemplaza los caracteres Unicode de emoji dentro de los hijos por imagenes
 * SVG del set de Twemoji (similar a WhatsApp/Apple). Usa jsdelivr como CDN
 * porque el CDN original de Twitter (twemoji.maxcdn.com) ya no existe.
 *
 * Es solo un <span> wrapper. La parse es idempotente (no re-parsea las <img>
 * que ya inserto), asi que es seguro re-renderizar.
 */
export default function Twemoji({ children, className }: TwemojiProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) {
      twemoji.parse(ref.current, {
        folder: "svg",
        ext: ".svg",
        base: "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/",
        className: "twemoji",
      });
    }
  });

  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
}
