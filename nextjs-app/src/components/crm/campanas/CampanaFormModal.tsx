"use client";

import { useState } from "react";
import { createCampana, updateCampana, type Campana, type CampanaPlantilla } from "@/lib/api/campanas";
import toast from "react-hot-toast";

interface Props {
  campana: Campana | null;
  onClose: () => void;
  onSaved: () => void;
}

function dateToInputValue(d: Date | null | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseInputDate(v: string, endOfDay: boolean): Date | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
}

interface PlantillaRow {
  key: string;
  nombre: string;
  contactados: string;
  notas: string;
}

function plantillasToRows(p: Record<string, CampanaPlantilla>): PlantillaRow[] {
  const entries = Object.entries(p);
  if (entries.length === 0) {
    return [{ key: "row-0", nombre: "", contactados: "0", notas: "" }];
  }
  return entries.map(([nombre, val], i) => ({
    key: `row-${i}`,
    nombre,
    contactados: String(val.contactados ?? 0),
    notas: val.notas ?? "",
  }));
}

export default function CampanaFormModal({ campana, onClose, onSaved }: Props) {
  const isEditing = !!campana;
  const [nombre, setNombre] = useState(campana?.nombre ?? "");
  const [fechaInicio, setFechaInicio] = useState(dateToInputValue(campana?.fecha_inicio?.toDate() ?? null));
  const [fechaFin, setFechaFin] = useState(dateToInputValue(campana?.fecha_fin?.toDate() ?? null));
  const [estatus, setEstatus] = useState<"activa" | "cerrada">(campana?.estatus ?? "activa");
  const [notas, setNotas] = useState(campana?.notas ?? "");
  const [rows, setRows] = useState<PlantillaRow[]>(plantillasToRows(campana?.plantillas ?? {}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addRow() {
    setRows((prev) => [...prev, { key: `row-${Date.now()}`, nombre: "", contactados: "0", notas: "" }]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, field: keyof PlantillaRow, value: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  async function handleSave() {
    setError("");
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    const ini = parseInputDate(fechaInicio, false);
    const fin = parseInputDate(fechaFin, true); // null si está vacía → "en curso"
    if (!ini) {
      setError("Selecciona la fecha de inicio");
      return;
    }
    if (fin && fin < ini) {
      setError("La fecha fin debe ser posterior a la fecha inicio");
      return;
    }

    const plantillasMap: Record<string, CampanaPlantilla> = {};
    for (const r of rows) {
      const key = r.nombre.trim();
      if (!key) continue;
      if (plantillasMap[key]) {
        setError(`Plantilla repetida: "${key}". Usa nombres únicos.`);
        return;
      }
      plantillasMap[key] = {
        contactados: Math.max(0, parseInt(r.contactados, 10) || 0),
        notas: r.notas.trim(),
      };
    }

    setSaving(true);
    try {
      if (isEditing && campana) {
        await updateCampana(campana.id, {
          nombre: nombre.trim(),
          fecha_inicio: ini,
          fecha_fin: fin,
          estatus,
          plantillas: plantillasMap,
          notas: notas.trim(),
        });
        toast.success("Campaña actualizada");
      } else {
        await createCampana({
          nombre: nombre.trim(),
          fecha_inicio: ini,
          fecha_fin: fin,
          estatus,
          plantillas: plantillasMap,
          notas: notas.trim(),
        });
        toast.success("Campaña creada", { icon: "🚀" });
      }
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al guardar";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-container-lowest rounded-3xl shadow-xl max-w-[720px] w-full mx-4 max-h-[90vh] flex flex-col border border-outline-variant/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
          <h2 className="text-lg font-bold font-headline text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">campaign</span>
            {isEditing ? "Editar Campaña" : "Nueva Campaña"}
          </h2>
          <button onClick={onClose} className="p-1.5 text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-all">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Nombre *</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Mayo 2026 - Promoción Base"
              className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20 placeholder:text-on-surface-variant/50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Fecha inicio *</label>
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Fecha fin *</label>
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Estatus</label>
              <select
                value={estatus}
                onChange={(e) => setEstatus(e.target.value as "activa" | "cerrada")}
                className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20"
              >
                <option value="activa">Activa</option>
                <option value="cerrada">Cerrada</option>
              </select>
            </div>
          </div>

          {/* Plantillas */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Plantillas usadas</label>
              <button
                type="button"
                onClick={addRow}
                className="text-xs font-bold text-primary hover:opacity-80 flex items-center gap-1"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                Agregar plantilla
              </button>
            </div>
            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={r.key} className="grid grid-cols-12 gap-2 items-start bg-surface-container-low/50 rounded-xl p-2.5">
                  <div className="col-span-5">
                    <input
                      type="text"
                      value={r.nombre}
                      onChange={(e) => updateRow(idx, "nombre", e.target.value)}
                      placeholder="Nombre plantilla (ej: A_porta_retrato)"
                      className="w-full px-3 py-1.5 bg-surface-container-lowest rounded-lg text-xs text-on-surface placeholder:text-on-surface-variant/50 border-none focus:ring-primary/20"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      min="0"
                      value={r.contactados}
                      onChange={(e) => updateRow(idx, "contactados", e.target.value)}
                      placeholder="Contactados"
                      className="w-full px-3 py-1.5 bg-surface-container-lowest rounded-lg text-xs text-on-surface placeholder:text-on-surface-variant/50 border-none focus:ring-primary/20"
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      type="text"
                      value={r.notas}
                      onChange={(e) => updateRow(idx, "notas", e.target.value)}
                      placeholder="Notas (opcional)"
                      className="w-full px-3 py-1.5 bg-surface-container-lowest rounded-lg text-xs text-on-surface placeholder:text-on-surface-variant/50 border-none focus:ring-primary/20"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="p-1.5 text-on-surface-variant hover:text-error rounded-lg hover:bg-error/10 transition-all"
                      title="Quitar plantilla"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Notas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Contexto adicional de la campaña..."
              className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20 resize-none placeholder:text-on-surface-variant/50"
            />
          </div>

          {error && (
            <div className="bg-error-container/30 text-on-error-container text-sm px-4 py-3 rounded-xl font-medium">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/10">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container-high hover:bg-surface-container-highest transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-bold text-on-primary bg-primary hover:opacity-90 transition-all disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                Guardando...
              </>
            ) : (
              isEditing ? "Guardar cambios" : "Crear campaña"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
