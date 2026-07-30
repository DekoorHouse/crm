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
  {
    id: "cuadros",
    name: "Cuadros",
    base: "#FBFCFD",
    ink: "#1E3A5F",
    accent: "#2F5FAE",
    layers: [
      {
        inset: 0,
        background:
          "repeating-linear-gradient(0deg, transparent 0 8.4%, #CBD9E8 8.4% 8.9%), repeating-linear-gradient(90deg, transparent 0 12%, #CBD9E8 12% 12.6%)",
      },
      { top: 0, left: 0, width: "100%", height: "11%", background: "#2F5FAE" },
      { top: "11%", left: 0, width: "100%", height: "1.2%", background: "#1E3A5F" },
    ],
  },
  {
    id: "memphis",
    name: "Memphis",
    base: "#FDFBF6",
    ink: "#212529",
    accent: "#FF6B6B",
    layers: [
      {
        top: "6%",
        left: "7%",
        width: "38%",
        height: "15%",
        background: "radial-gradient(circle, #FF6B6B 24%, transparent 26%) 0 0 / 26% 48%",
      },
      { top: "5%", left: "70%", width: "22%", height: "16%", background: "#845EF7", borderRadius: "50%" },
      {
        top: "76%",
        left: "6%",
        width: "56%",
        height: "11%",
        background: "repeating-linear-gradient(135deg, #22B8CF 0 11%, transparent 11% 23%)",
      },
      {
        top: "70%",
        left: "70%",
        width: "24%",
        height: "19%",
        background: "#FFD43B",
        clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
      },
      { top: "26%", left: "82%", width: "12%", height: "8%", background: "#20C997", borderRadius: "50%" },
    ],
  },
  {
    id: "rayas",
    name: "Rayas",
    base: "#F7EFE3",
    ink: "#8C2F1E",
    accent: "#C8503C",
    layers: [
      { inset: 0, background: "repeating-linear-gradient(105deg, #C8503C 0 9%, #F7EFE3 9% 18%)" },
      {
        top: "34%",
        left: "6%",
        width: "88%",
        height: "31%",
        background: "#FBF6EC",
        boxShadow: "0 1cqw 2.4cqw rgba(0,0,0,0.16)",
      },
    ],
  },
  {
    id: "selva",
    name: "Selva",
    base: "#123A2C",
    ink: "#EAF6EE",
    accent: "#8FD3B0",
    dark: true,
    layers: [
      { top: "-8%", left: "-12%", width: "48%", height: "38%", background: "#1F6B4E", borderRadius: "0 100% 0 100%" },
      { top: "3%", left: "56%", width: "52%", height: "34%", background: "#2A8560", borderRadius: "100% 0 100% 0" },
      { top: "68%", left: "-14%", width: "56%", height: "40%", background: "#1B5C43", borderRadius: "0 100% 0 100%" },
      {
        top: "74%",
        left: "50%",
        width: "54%",
        height: "36%",
        background: "#2A8560",
        borderRadius: "100% 0 100% 0",
        opacity: 0.85,
      },
      { top: "30%", left: "4%", width: "16%", height: "12%", background: "#8FD3B0", borderRadius: "0 100% 0 100%", opacity: 0.5 },
    ],
  },
  {
    id: "coral",
    name: "Coral",
    base: "linear-gradient(150deg,#FFD9CE 0%,#FFB3A0 55%,#FF8E7A 100%)",
    ink: "#8A3520",
    accent: "#FFFFFF",
    layers: [
      { top: "-16%", left: "50%", width: "64%", height: "42%", background: "rgba(255,255,255,0.38)", borderRadius: "50%" },
      { top: "72%", left: "-18%", width: "60%", height: "42%", background: "rgba(255,116,88,0.5)", borderRadius: "50%" },
      { top: "82%", left: "54%", width: "42%", height: "28%", background: "rgba(255,255,255,0.32)", borderRadius: "50%" },
      { top: "4%", left: "8%", width: "24%", height: "16%", background: "rgba(255,255,255,0.28)", borderRadius: "50%" },
    ],
  },
  {
    id: "grafito",
    name: "Grafito",
    base: "linear-gradient(160deg,#3B4046 0%,#2A2E33 60%,#202327 100%)",
    ink: "#E9ECEF",
    accent: "#9AA3AB",
    dark: true,
    layers: [
      {
        inset: 0,
        background: "repeating-linear-gradient(58deg, rgba(255,255,255,0.05) 0 1.1%, transparent 1.1% 3%)",
      },
      {
        top: "-24%",
        left: "26%",
        width: "96%",
        height: "70%",
        background: "linear-gradient(118deg, rgba(255,255,255,0.12), transparent 62%)",
        transform: "rotate(-12deg)",
      },
      { top: "86%", left: "14%", width: "72%", height: "0.5%", background: "rgba(255,255,255,0.28)" },
    ],
  },
  {
    id: "neon",
    name: "Neón",
    base: "#0B0B14",
    ink: "#F2F4FF",
    accent: "#25E0E0",
    dark: true,
    layers: [
      {
        top: "4%",
        left: "16%",
        width: "68%",
        height: "26%",
        borderRadius: "50%",
        border: "0.9cqw solid #FF2E9A",
        boxSizing: "border-box",
        boxShadow: "0 0 5cqw rgba(255,46,154,0.65), inset 0 0 3cqw rgba(255,46,154,0.35)",
      },
      {
        top: "70%",
        left: "24%",
        width: "56%",
        height: "22%",
        borderRadius: "50%",
        border: "0.7cqw solid #25E0E0",
        boxSizing: "border-box",
        boxShadow: "0 0 4cqw rgba(37,224,224,0.6)",
      },
      { top: "44%", left: "6%", width: "18%", height: "0.7%", background: "#25E0E0", boxShadow: "0 0 2cqw #25E0E0" },
      { top: "44%", left: "76%", width: "18%", height: "0.7%", background: "#FF2E9A", boxShadow: "0 0 2cqw #FF2E9A" },
    ],
  },
  {
    id: "arena",
    name: "Arena",
    base: "linear-gradient(180deg,#F5E0BF 0%,#EBCB9F 100%)",
    ink: "#6B4A26",
    accent: "#B07F4E",
    layers: [
      { top: "10%", left: "62%", width: "26%", height: "18%", background: "#FBF1DE", borderRadius: "50%" },
      {
        top: "56%",
        left: "-22%",
        width: "146%",
        height: "44%",
        background: "#DDB47F",
        borderRadius: "50% 50% 0 0 / 100% 100% 0 0",
      },
      {
        top: "70%",
        left: "-34%",
        width: "156%",
        height: "40%",
        background: "#C99863",
        borderRadius: "50% 50% 0 0 / 100% 100% 0 0",
      },
      {
        top: "84%",
        left: "-12%",
        width: "142%",
        height: "30%",
        background: "#B07F4E",
        borderRadius: "50% 50% 0 0 / 100% 100% 0 0",
      },
    ],
  },
  {
    id: "vitral",
    name: "Vitral",
    base: "#17171B",
    ink: "#FBF7EC",
    accent: "#EFB93C",
    dark: true,
    layers: [
      { top: "2%", left: "2%", width: "30%", height: "30%", background: "#D64524", transform: "skewY(-6deg)" },
      { top: "2%", left: "35%", width: "28%", height: "23%", background: "#2F5FAE" },
      { top: "2%", left: "66%", width: "32%", height: "33%", background: "#EFB93C", transform: "skewY(5deg)" },
      { top: "70%", left: "2%", width: "34%", height: "28%", background: "#2E9E6B", transform: "skewY(4deg)" },
      { top: "66%", left: "39%", width: "26%", height: "32%", background: "#8A4FBF" },
      { top: "72%", left: "69%", width: "29%", height: "26%", background: "#C93F6E", transform: "skewY(-5deg)" },
    ],
  },
  {
    id: "lino",
    name: "Lino",
    base: "#F4F1EA",
    ink: "#5A5040",
    accent: "#A8977A",
    layers: [
      {
        inset: 0,
        background:
          "repeating-linear-gradient(90deg, rgba(140,125,100,0.11) 0 0.5%, transparent 0.5% 1.5%), repeating-linear-gradient(0deg, rgba(140,125,100,0.09) 0 0.5%, transparent 0.5% 1.5%)",
      },
      { inset: "7%", boxShadow: "inset 0 0 0 0.4cqw rgba(120,105,80,0.3)" },
      { top: "13%", left: "40%", width: "20%", height: "0.5%", background: "rgba(120,105,80,0.35)" },
      { top: "86%", left: "40%", width: "20%", height: "0.5%", background: "rgba(120,105,80,0.35)" },
    ],
  },
  {
    id: "cielo",
    name: "Cielo",
    base: "linear-gradient(180deg,#8FC7EF 0%,#BFE0F5 55%,#EAF5FC 100%)",
    ink: "#1B4F72",
    accent: "#FFFFFF",
    layers: [
      { top: "7%", left: "5%", width: "40%", height: "16%", background: "#FFFFFF", borderRadius: "50%", opacity: 0.92 },
      { top: "3%", left: "22%", width: "30%", height: "16%", background: "#FFFFFF", borderRadius: "50%", opacity: 0.85 },
      { top: "12%", left: "62%", width: "34%", height: "13%", background: "#FFFFFF", borderRadius: "50%", opacity: 0.7 },
      { top: "74%", left: "50%", width: "48%", height: "18%", background: "#FFFFFF", borderRadius: "50%", opacity: 0.8 },
      { top: "82%", left: "30%", width: "36%", height: "15%", background: "#FFFFFF", borderRadius: "50%", opacity: 0.7 },
    ],
  },
  {
    id: "cafe",
    name: "Café",
    base: "linear-gradient(160deg,#EFE3D3 0%,#E1CFB7 100%)",
    ink: "#4A2F17",
    accent: "#7A4C2A",
    layers: [
      {
        top: "62%",
        left: "50%",
        width: "42%",
        height: "30%",
        borderRadius: "50%",
        border: "1cqw solid rgba(122,76,42,0.32)",
        boxSizing: "border-box",
      },
      {
        top: "6%",
        left: "8%",
        width: "24%",
        height: "17%",
        borderRadius: "50%",
        border: "0.8cqw solid rgba(122,76,42,0.24)",
        boxSizing: "border-box",
      },
      { top: "76%", left: "12%", width: "9%", height: "6%", background: "rgba(122,76,42,0.3)", borderRadius: "50%" },
      { top: "84%", left: "26%", width: "6%", height: "4%", background: "rgba(122,76,42,0.22)", borderRadius: "50%" },
      { top: "12%", left: "62%", width: "7%", height: "5%", background: "rgba(122,76,42,0.25)", borderRadius: "50%" },
    ],
  },
  {
    id: "ajedrez",
    name: "Ajedrez",
    base: "#F5F1E8",
    ink: "#22262B",
    accent: "#C8503C",
    layers: [
      { inset: 0, background: "repeating-conic-gradient(#22262B 0% 25%, #F5F1E8 0% 50%) 0 0 / 24% 18%" },
      {
        top: "36%",
        left: "5%",
        width: "90%",
        height: "28%",
        background: "#F5F1E8",
        boxShadow: "0 0 0 0.5cqw #22262B, 0 1cqw 2cqw rgba(0,0,0,0.2)",
      },
    ],
  },
  {
    id: "girasol",
    name: "Girasol",
    base: "#FFF4D9",
    ink: "#7A5314",
    accent: "#F6B93B",
    layers: [
      {
        // repeating-: si no, el degradado cónico pinta un solo pétalo.
        top: "-30%",
        left: "6%",
        width: "88%",
        height: "64%",
        background: "repeating-conic-gradient(from 4deg, #F6B93B 0 5%, transparent 5% 11%)",
        borderRadius: "50%",
      },
      { top: "-8%", left: "32%", width: "36%", height: "26%", background: "#6B4A26", borderRadius: "50%" },
      { top: "78%", left: "-8%", width: "44%", height: "26%", background: "#5C8A3A", borderRadius: "0 100% 0 100%" },
      { top: "82%", left: "58%", width: "42%", height: "24%", background: "#77A64C", borderRadius: "100% 0 100% 0" },
    ],
  },
  {
    id: "artico",
    name: "Ártico",
    base: "linear-gradient(165deg,#DCEEF8 0%,#A9CFE6 58%,#79AFD1 100%)",
    ink: "#0F3550",
    accent: "#2E7BA6",
    layers: [
      {
        top: "-8%",
        left: "-10%",
        width: "62%",
        height: "44%",
        background: "rgba(255,255,255,0.92)",
        clipPath: "polygon(0 0, 100% 18%, 62% 100%, 0 72%)",
      },
      {
        top: "62%",
        left: "36%",
        width: "74%",
        height: "48%",
        background: "rgba(255,255,255,0.8)",
        clipPath: "polygon(18% 0, 100% 30%, 78% 100%, 0 78%)",
      },
      {
        top: "70%",
        left: "-18%",
        width: "60%",
        height: "42%",
        background: "rgba(70,132,172,0.55)",
        clipPath: "polygon(0 22%, 82% 0, 100% 82%, 10% 100%)",
      },
      {
        top: "-6%",
        left: "56%",
        width: "54%",
        height: "32%",
        background: "rgba(70,132,172,0.35)",
        clipPath: "polygon(24% 0, 100% 40%, 70% 100%, 0 60%)",
      },
    ],
  },
  {
    id: "cobre",
    name: "Cobre",
    base: "linear-gradient(150deg,#10403F 0%,#0A2B2B 100%)",
    ink: "#F3E4D3",
    accent: "#C47C48",
    dark: true,
    layers: [
      {
        top: "-34%",
        left: "-26%",
        width: "112%",
        height: "82%",
        borderRadius: "50%",
        border: "0.8cqw solid rgba(196,124,72,0.9)",
        boxSizing: "border-box",
      },
      {
        top: "50%",
        left: "16%",
        width: "112%",
        height: "82%",
        borderRadius: "50%",
        border: "0.6cqw solid rgba(214,160,110,0.6)",
        boxSizing: "border-box",
      },
      { top: "6%", left: "74%", width: "16%", height: "11%", background: "#C47C48", borderRadius: "50%" },
      {
        top: "88%",
        left: "10%",
        width: "24%",
        height: "16%",
        borderRadius: "50%",
        border: "0.5cqw solid rgba(196,124,72,0.5)",
        boxSizing: "border-box",
      },
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
