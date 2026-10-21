"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Selector de rango de fechas en UN solo calendario: el primer clic marca el inicio, el segundo el fin
 * (si el segundo es anterior, se intercambian). Fechas en formato YYYY-MM-DD. Accesos rápidos a la
 * izquierda (en celular arriba) y "Aplicar" para no recargar la página con cada clic.
 */

interface Props {
  desde: string;
  hasta: string;
  /** Fecha máxima elegible (YYYY-MM-DD). */
  max?: string;
  onChange: (desde: string, hasta: string) => void;
  className?: string;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["L", "M", "M", "J", "V", "S", "D"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
};
const addDays = (s: string, n: number) => {
  const { y, m, d } = parse(s);
  const dt = new Date(Date.UTC(y, m, d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
};
const etiqueta = (s: string) => {
  const { y, m, d } = parse(s);
  return `${d} ${MESES_CORTOS[m]} ${y}`;
};

export default function DateRangePicker({ desde, hasta, max, onChange, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [ini, setIni] = useState(desde);
  const [fin, setFin] = useState<string | null>(hasta);
  const [hover, setHover] = useState<string | null>(null);
  const [vista, setVista] = useState(() => {
    const { y, m } = parse(hasta || desde);
    return { y, m };
  });
  const ref = useRef<HTMLDivElement>(null);

  // Al abrir, parte de lo aplicado.
  useEffect(() => {
    if (!open) return;
    setIni(desde);
    setFin(hasta);
    setHover(null);
    const { y, m } = parse(hasta || desde);
    setVista({ y, m });
  }, [open, desde, hasta]);

  // Clic afuera / Escape cierran sin aplicar.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const celdas = useMemo(() => {
    const { y, m } = vista;
    const primero = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0 = domingo
    const offset = (primero + 6) % 7; // semana empieza en lunes
    const dias = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= dias; d++) out.push(ymd(y, m, d));
    while (out.length % 7) out.push(null);
    return out;
  }, [vista]);

  const finEfectivo = fin ?? hover;
  const [a, b] = finEfectivo && finEfectivo < ini ? [finEfectivo, ini] : [ini, finEfectivo ?? ini];

  function elegir(dia: string) {
    if (fin !== null || !ini) {
      setIni(dia);
      setFin(null);
      return;
    }
    if (dia < ini) {
      setFin(ini);
      setIni(dia);
    } else setFin(dia);
  }

  function aplicar(d1 = ini, d2 = fin ?? ini) {
    const [x, y] = d2 < d1 ? [d2, d1] : [d1, d2];
    onChange(x, y);
    setOpen(false);
  }

  const hoy = max || ymd(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const rapidos: { label: string; r: () => [string, string] }[] = [
    { label: "Hoy", r: () => [hoy, hoy] },
    { label: "Ayer", r: () => [addDays(hoy, -1), addDays(hoy, -1)] },
    { label: "Últimos 7 días", r: () => [addDays(hoy, -6), hoy] },
    { label: "Últimos 30 días", r: () => [addDays(hoy, -29), hoy] },
    {
      label: "Este mes",
      r: () => {
        const { y, m } = parse(hoy);
        return [ymd(y, m, 1), hoy];
      },
    },
    {
      label: "Mes pasado",
      r: () => {
        const { y, m } = parse(hoy);
        const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1;
        return [ymd(py, pm, 1), ymd(py, pm, new Date(Date.UTC(py, pm + 1, 0)).getUTCDate())];
      },
    },
  ];

  const puedeSiguiente = !max || ymd(vista.y, vista.m, 1) < ymd(parse(max).y, parse(max).m, 1);
  const mover = (delta: number) =>
    setVista(({ y, m }) => {
      const nm = m + delta;
      return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
    });

  const unDia = desde === hasta;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-on-surface bg-surface-container-low border transition-colors cursor-pointer ${
          open ? "border-primary/60 ring-2 ring-primary/15" : "border-outline-variant/20 hover:border-outline-variant/50"
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>
          date_range
        </span>
        <span className="truncate">{unDia ? etiqueta(desde) : `${etiqueta(desde)} – ${etiqueta(hasta)}`}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Elegir rango de fechas"
          className="absolute left-0 z-50 mt-2 w-[min(560px,calc(100vw-2rem))] rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-2xl overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row">
            {/* Accesos rápidos */}
            <div className="flex sm:flex-col gap-1 p-2 sm:p-3 sm:w-40 overflow-x-auto border-b sm:border-b-0 sm:border-r border-outline-variant/15 bg-surface-container-low/60">
              {rapidos.map((q) => {
                const [x, y] = q.r();
                const activo = x === ini && y === (fin ?? ini);
                return (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => {
                      setIni(x);
                      setFin(y);
                      setVista({ y: parse(y).y, m: parse(y).m });
                    }}
                    className={`shrink-0 whitespace-nowrap text-left rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors cursor-pointer ${
                      activo ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>

            {/* Calendario */}
            <div className="flex-1 p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={() => mover(-1)}
                  className="w-8 h-8 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high cursor-pointer"
                  aria-label="Mes anterior"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_left</span>
                </button>
                <p className="text-sm font-black text-on-surface capitalize">
                  {MESES[vista.m]} {vista.y}
                </p>
                <button
                  type="button"
                  onClick={() => puedeSiguiente && mover(1)}
                  disabled={!puedeSiguiente}
                  className="w-8 h-8 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-default cursor-pointer"
                  aria-label="Mes siguiente"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_right</span>
                </button>
              </div>

              <div className="grid grid-cols-7 mb-1">
                {DIAS.map((d, i) => (
                  <span key={i} className="text-center text-[10px] font-black uppercase tracking-widest text-on-surface-variant/70 py-1">
                    {d}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-y-1" onMouseLeave={() => setHover(null)}>
                {celdas.map((dia, i) => {
                  if (!dia) return <span key={i} />;
                  const deshabilitado = !!max && dia > max;
                  const enRango = dia >= a && dia <= b;
                  const esIni = dia === a, esFin = dia === b;
                  const esHoy = dia === hoy;
                  return (
                    <div
                      key={i}
                      className={`relative h-9 ${enRango && !(esIni && esFin) ? "bg-primary/12" : ""} ${esIni && !esFin ? "rounded-l-full" : ""} ${esFin && !esIni ? "rounded-r-full" : ""}`}
                    >
                      <button
                        type="button"
                        disabled={deshabilitado}
                        onClick={() => elegir(dia)}
                        onMouseEnter={() => fin === null && setHover(dia)}
                        className={`absolute inset-0 m-auto w-9 h-9 rounded-full text-[13px] font-semibold transition-colors ${
                          deshabilitado
                            ? "text-on-surface-variant/30 cursor-default"
                            : esIni || esFin
                            ? "bg-primary text-on-primary shadow-md cursor-pointer"
                            : enRango
                            ? "text-on-surface hover:bg-primary/20 cursor-pointer"
                            : "text-on-surface hover:bg-surface-container-high cursor-pointer"
                        } ${esHoy && !(esIni || esFin) ? "ring-1 ring-primary/50" : ""}`}
                      >
                        {parse(dia).d}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-outline-variant/15 pt-3">
                <p className="text-xs text-on-surface-variant truncate">
                  {fin === null ? (
                    <>Elige el día final</>
                  ) : (
                    <span className="font-semibold text-on-surface">
                      {a === b ? etiqueta(a) : `${etiqueta(a)} – ${etiqueta(b)}`}
                    </span>
                  )}
                </p>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-1.5 text-[13px] font-bold text-on-surface-variant hover:bg-surface-container-high cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => aplicar()}
                    className="rounded-xl px-4 py-1.5 text-[13px] font-bold bg-primary text-on-primary hover:opacity-90 cursor-pointer"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
