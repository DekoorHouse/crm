"use client";

export interface RepasoData {
  grupos: { nombre: string; ideas: string[] }[];
  olvidadas: { texto: string; dias: number }[];
  sugerencia: string;
  total: number;
}

interface RepasoSheetProps {
  open: boolean;
  loading: boolean;
  data: RepasoData | null;
  onClose: () => void;
}

/**
 * Panel de "Repaso del mural": la IA agrupa tus ideas, rescata las olvidadas
 * y sugiere por dónde seguir. Bottom sheet en móvil, panel lateral en desktop.
 */
export default function RepasoSheet({ open, loading, data, onClose }: RepasoSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />

      {/* Panel */}
      <div className="absolute bottom-0 left-0 right-0 max-h-[82%] md:bottom-auto md:left-auto md:top-0 md:right-0 md:h-full md:max-h-full md:w-[420px] bg-surface-container-lowest rounded-t-3xl md:rounded-none md:border-l border-outline-variant/20 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-outline-variant/15 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#FEF08A", transform: "rotate(-4deg)" }}
          >
            <span className="material-symbols-outlined text-gray-800" style={{ fontSize: 18 }}>
              auto_awesome
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold font-headline text-on-surface leading-tight">Repaso del mural</h2>
            {data && (
              <p className="text-xs text-on-surface-variant">{data.total} ideas revisadas</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low"
            title="Cerrar"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-on-surface-variant">Leyendo tu mural…</p>
            </div>
          ) : data ? (
            <>
              {/* Sugerencia */}
              {data.sugerencia && (
                <div className="bg-primary/8 border border-primary/20 rounded-2xl p-4">
                  <p className="text-[11px] font-black uppercase tracking-widest text-primary mb-1.5">
                    Para hoy
                  </p>
                  <p className="text-sm text-on-surface leading-relaxed">{data.sugerencia}</p>
                </div>
              )}

              {/* Grupos */}
              {data.grupos.length > 0 && (
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 mb-2">
                    Tu cabeza, por temas
                  </p>
                  <div className="space-y-3">
                    {data.grupos.map((g, i) => (
                      <div key={i} className="border border-outline-variant/20 rounded-2xl p-3.5">
                        <p className="text-sm font-bold text-on-surface mb-1.5">
                          {g.nombre}{" "}
                          <span className="text-xs font-medium text-on-surface-variant">
                            · {g.ideas.length}
                          </span>
                        </p>
                        <ul className="space-y-1">
                          {g.ideas.map((idea, j) => (
                            <li key={j} className="text-xs text-on-surface-variant leading-snug truncate">
                              • {idea.split("\n")[0]}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Olvidadas */}
              {data.olvidadas.length > 0 && (
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 mb-2">
                    💤 No las dejes morir
                  </p>
                  <div className="space-y-2">
                    {data.olvidadas.map((o, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2.5 bg-surface-container-low rounded-xl px-3 py-2.5"
                      >
                        <span className="text-xs text-on-surface flex-1 truncate">{o.texto.split("\n")[0]}</span>
                        <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container rounded-full px-2 py-0.5 flex-shrink-0">
                          {o.dias} día{o.dias === 1 ? "" : "s"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-on-surface-variant/50 text-center pb-2">
                Generado con Gemini · tus ideas no salen de tu servidor
              </p>
            </>
          ) : (
            <p className="text-sm text-on-surface-variant text-center py-10">
              No se pudo generar el repaso. Intenta de nuevo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
