"use client";

import type { CSSProperties } from "react";

/**
 * Diseños de portada de libreta.
 *
 * Todo es CSS (gradientes y formas en porcentajes), sin imágenes: así una misma
 * portada se ve bien desde 60px en el selector hasta el tamaño completo en el
 * escritorio. Los textos usan unidades `cqw` (relativas al ancho del contenedor)
 * para escalar con la portada — por eso el contenedor declara container-type.
 */

export interface CoverDesign {
  id: string;
  name: string;
  /** Fondo base de la portada. */
  base: string;
  /** Color del título impreso en la portada. */
  ink: string;
  /** Color de la línea/acento bajo el título. */
  accent: string;
  /** Capas decorativas, pintadas en orden. */
  layers: CSSProperties[];
  /** Portada oscura: el espiral y las sombras se aclaran. */
  dark?: boolean;
}

export const COVERS: CoverDesign[] = [
  {
    id: "terracota",
    name: "Terracota",
    base: "#F7E3D4",
    ink: "#7C3A21",
    accent: "#C4562C",
    layers: [
      { top: "-14%", left: "-20%", width: "74%", height: "42%", background: "#E4703C", borderRadius: "50%" },
      { top: "-10%", left: "46%", width: "66%", height: "32%", background: "#A9563C", borderRadius: "50% 50% 58% 42%" },
      { top: "66%", left: "-24%", width: "80%", height: "46%", background: "#E79A87", borderRadius: "52% 56% 44% 48%" },
      { top: "40%", left: "66%", width: "46%", height: "26%", background: "#E4703C", borderRadius: "50%" },
      { top: "72%", left: "38%", width: "54%", height: "34%", background: "rgba(212,164,140,0.5)", borderRadius: "50%" },
      {
        top: "13%",
        left: "60%",
        width: "34%",
        height: "14%",
        background: "repeating-linear-gradient(112deg, #FBEBDD 0 9%, transparent 9% 26%)",
        opacity: 0.9,
      },
    ],
  },
  {
    id: "medianoche",
    name: "Medianoche",
    base: "linear-gradient(165deg,#222C50 0%,#141B36 58%,#0B1124 100%)",
    ink: "#F6E7C8",
    accent: "#D9B368",
    dark: true,
    layers: [
      {
        inset: 0,
        background:
          "radial-gradient(circle, rgba(255,255,255,0.85) 0.7px, transparent 1.1px) 0 0 / 17% 13%",
        opacity: 0.45,
      },
      {
        top: "9%",
        left: "58%",
        width: "34%",
        height: "23%",
        background: "radial-gradient(circle at 34% 32%, #FDEFCC 0%, #E7C377 62%, #C79F52 100%)",
        borderRadius: "50%",
        boxShadow: "0 0 6cqw rgba(231,195,119,0.35)",
      },
      {
        top: "63%",
        left: "14%",
        width: "72%",
        height: "0.7%",
        background: "linear-gradient(90deg,transparent,#D9B368 45%,transparent)",
      },
      {
        top: "76%",
        left: "-10%",
        width: "120%",
        height: "34%",
        background: "linear-gradient(180deg, rgba(11,17,36,0) 0%, rgba(8,12,28,0.9) 100%)",
      },
    ],
  },
  {
    id: "salvia",
    name: "Salvia",
    base: "#DEE7D7",
    ink: "#33452C",
    accent: "#7C9270",
    layers: [
      { top: "-24%", left: "-12%", width: "84%", height: "52%", background: "#B9CCAC", borderRadius: "0 0 62% 44%" },
      { top: "26%", left: "16%", width: "68%", height: "48%", background: "#F3F1E7", borderRadius: "50%" },
      { top: "74%", left: "-18%", width: "74%", height: "40%", background: "#90A884", borderRadius: "54% 46% 50% 50%" },
      { top: "66%", left: "58%", width: "50%", height: "30%", background: "rgba(124,146,112,0.45)", borderRadius: "50%" },
      {
        top: "8%",
        left: "8%",
        width: "26%",
        height: "18%",
        background: "radial-gradient(circle at 30% 70%, transparent 58%, #F3F1E7 59% 63%, transparent 64%)",
      },
    ],
  },
  {
    id: "bauhaus",
    name: "Bauhaus",
    base: "#F2EBDD",
    ink: "#1B1B1B",
    accent: "#D64524",
    layers: [
      { top: "7%", left: "9%", width: "34%", height: "23%", background: "#D64524", borderRadius: "50%" },
      { top: "6%", left: "60%", width: "28%", height: "20%", background: "#2F5FAE" },
      // La barra va arriba del título, si no lo cruza como si estuviera tachado.
      { top: "35%", left: 0, width: "100%", height: "1.4%", background: "#1B1B1B" },
      {
        top: "68%",
        left: "8%",
        width: "30%",
        height: "24%",
        background: "#EFB93C",
        clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
      },
      { top: "70%", left: "56%", width: "32%", height: "22%", background: "#2F5FAE", transform: "rotate(14deg)" },
    ],
  },
  {
    id: "atardecer",
    name: "Atardecer",
    base: "linear-gradient(180deg,#3A2357 0%,#7C3A62 34%,#D9694A 66%,#F3B369 100%)",
    ink: "#FFF3E0",
    accent: "#FFD9A0",
    dark: true,
    layers: [
      {
        // Arriba del título: si queda al centro, el sol se encima con el texto.
        top: "11%",
        left: "34%",
        width: "32%",
        height: "22%",
        background: "radial-gradient(circle,#FFE9C2 0%,#FFC069 70%,#F0A552 100%)",
        borderRadius: "50%",
        boxShadow: "0 0 9cqw rgba(255,192,105,0.45)",
      },
      {
        top: "68%",
        left: 0,
        width: "100%",
        height: "32%",
        background: "linear-gradient(180deg, rgba(255,193,110,0.32) 0%, rgba(255,235,200,0.08) 100%)",
      },
      { top: "20%", left: "12%", width: "34%", height: "1%", background: "rgba(255,235,205,0.35)", borderRadius: "50%" },
      { top: "27%", left: "50%", width: "30%", height: "0.9%", background: "rgba(255,235,205,0.28)", borderRadius: "50%" },
      { top: "84%", left: "-6%", width: "112%", height: "1%", background: "rgba(255,240,215,0.4)" },
    ],
  },
  {
    id: "marmol",
    name: "Mármol",
    base: "linear-gradient(135deg,#FBF9F6 0%,#EFEAE2 46%,#F8F5F0 100%)",
    ink: "#4A4239",
    accent: "#B79B6E",
    layers: [
      {
        top: "14%",
        left: "-14%",
        width: "128%",
        height: "1.1%",
        background: "linear-gradient(90deg,transparent,#C9B79A 40%,transparent)",
        transform: "rotate(-16deg)",
      },
      {
        top: "26%",
        left: "-12%",
        width: "124%",
        height: "0.6%",
        background: "linear-gradient(90deg,transparent,#B79B6E 55%,transparent)",
        transform: "rotate(-13deg)",
        opacity: 0.75,
      },
      {
        top: "62%",
        left: "-16%",
        width: "132%",
        height: "1.3%",
        background: "linear-gradient(90deg,transparent,#D6C7AC 50%,transparent)",
        transform: "rotate(-20deg)",
      },
      {
        top: "72%",
        left: "-10%",
        width: "120%",
        height: "0.5%",
        background: "linear-gradient(90deg,transparent,#A98F63 60%,transparent)",
        transform: "rotate(-17deg)",
        opacity: 0.6,
      },
      {
        top: "34%",
        left: "44%",
        width: "70%",
        height: "44%",
        background: "radial-gradient(ellipse at 40% 40%, rgba(203,190,168,0.35) 0%, transparent 68%)",
        borderRadius: "50%",
      },
    ],
  },
  {
    id: "kraft",
    name: "Kraft",
    base: "linear-gradient(160deg,#CBA67D 0%,#BF9A71 60%,#B6906A 100%)",
    ink: "#4A3A26",
    accent: "#8C6B45",
    layers: [
      {
        inset: 0,
        background:
          "repeating-linear-gradient(48deg, rgba(255,255,255,0.05) 0 1.5%, transparent 1.5% 3.4%)",
      },
      {
        top: "22%",
        left: "12%",
        width: "76%",
        height: "46%",
        background: "#F7F2E7",
        boxShadow: "inset 0 0 0 0.7cqw rgba(74,58,38,0.18), 0 1cqw 2cqw rgba(0,0,0,0.12)",
      },
      { top: "76%", left: "22%", width: "56%", height: "0.7%", background: "rgba(74,58,38,0.25)" },
      { top: "81%", left: "30%", width: "40%", height: "0.7%", background: "rgba(74,58,38,0.18)" },
    ],
  },
  {
    id: "ondas",
    name: "Ondas",
    base: "#15324E",
    ink: "#F1E7D3",
    accent: "#E2C88A",
    dark: true,
    layers: [
      {
        inset: 0,
        background:
          "repeating-radial-gradient(circle at 50% 132%, transparent 0 5.4%, #EFE6D2 5.4% 6.2%, transparent 6.2% 11.6%)",
        opacity: 0.85,
      },
      {
        top: 0,
        left: 0,
        width: "100%",
        height: "46%",
        background: "linear-gradient(180deg,#15324E 62%, rgba(21,50,78,0) 100%)",
      },
      { top: "37%", left: "16%", width: "68%", height: "0.6%", background: "rgba(226,200,138,0.55)" },
    ],
  },
];

export const DEFAULT_COVER = COVERS[0].id;

export function getCover(id: string): CoverDesign {
  return COVERS.find((c) => c.id === id) || COVERS[0];
}

interface CoverArtProps {
  cover: string;
  title?: string;
  /** Texto pequeño bajo el título (p. ej. "5 hojas"). */
  subtitle?: string;
  /** Dibuja el espiral en el borde izquierdo. */
  spiral?: boolean;
  /** Oculta el título (para miniaturas del selector). */
  hideTitle?: boolean;
  className?: string;
}

/**
 * Portada completa: fondo + capas + espiral + título. Llena a su contenedor,
 * así que el tamaño lo decide quien la usa.
 */
export default function CoverArt({
  cover,
  title,
  subtitle,
  spiral = true,
  hideTitle = false,
  className = "",
}: CoverArtProps) {
  const d = getCover(cover);
  const ringDark = d.dark ? "#0A0F1C" : "#2B2B2B";

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${className}`}
      style={{ background: d.base, containerType: "inline-size" }}
    >
      {/* Capas decorativas */}
      {d.layers.map((layer, i) => (
        <div key={i} className="absolute pointer-events-none" style={layer} />
      ))}

      {/* Título impreso en la portada */}
      {!hideTitle && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-[12cqw] text-center pointer-events-none">
          <span
            className="font-headline font-extrabold leading-[1.05] break-words"
            style={{
              color: d.ink,
              fontSize: "13cqw",
              letterSpacing: "-0.02em",
              textShadow: d.dark ? "0 0.4cqw 1.4cqw rgba(0,0,0,0.45)" : "0 0.3cqw 1cqw rgba(255,255,255,0.35)",
            }}
          >
            {title?.trim() || "Sin título"}
          </span>
          <span
            className="mt-[3cqw] rounded-full"
            style={{ background: d.accent, width: "22cqw", height: "1.1cqw", opacity: 0.9 }}
          />
          {subtitle && (
            <span
              className="mt-[3cqw] font-headline font-bold uppercase"
              style={{ color: d.ink, fontSize: "5.4cqw", letterSpacing: "0.18em", opacity: 0.72 }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}

      {/* Espiral metálico del borde izquierdo */}
      {spiral && (
        <div
          className="absolute top-0 bottom-0 flex flex-col justify-evenly items-start pointer-events-none"
          style={{ left: "-2.6cqw", width: "13cqw", paddingTop: "3%", paddingBottom: "3%" }}
        >
          {Array.from({ length: 11 }).map((_, i) => (
            <span
              key={i}
              className="rounded-full"
              style={{
                width: "11cqw",
                height: "2.6cqw",
                background: `linear-gradient(180deg, #8E8E93 0%, ${ringDark} 55%, #6B6B70 100%)`,
                boxShadow: "0 0.3cqw 0.6cqw rgba(0,0,0,0.35)",
              }}
            />
          ))}
        </div>
      )}

      {/* Sombra interna del lomo, para que se sienta encuadernada */}
      <div
        className="absolute top-0 bottom-0 left-0 pointer-events-none"
        style={{
          width: "16%",
          background: d.dark
            ? "linear-gradient(90deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 100%)"
            : "linear-gradient(90deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0) 100%)",
        }}
      />
    </div>
  );
}
