"use client";

import { useState, useEffect } from "react";
import { getAwayMessage, setAwayMessage, getGoogleSheet, setGoogleSheet } from "@/lib/api/crm";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import toast from "react-hot-toast";

export default function AjustesPage() {
  const [awayActive, setAwayActive] = useState(false);
  const [sheetId, setSheetId] = useState("");
  const [botInstructions, setBotInstructions] = useState("");
  const [editorBotInstructions, setEditorBotInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAway, setSavingAway] = useState(false);
  const [savingSheet, setSavingSheet] = useState(false);
  const [savingBot, setSavingBot] = useState(false);
  const [savingEditorBot, setSavingEditorBot] = useState(false);

  useEffect(() => {
    Promise.all([
      getAwayMessage().then((s) => setAwayActive(s.isActive)).catch(() => {}),
      getGoogleSheet().then((s) => setSheetId(s.googleSheetId || "")).catch(() => {}),
      getDoc(doc(db, "crm_settings", "bot")).then((d) => setBotInstructions(d.data()?.instructions || "")).catch(() => {}),
      getDoc(doc(db, "crm_settings", "editor_bot")).then((d) => setEditorBotInstructions(d.data()?.instructions || "")).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  async function handleToggleAway() {
    setSavingAway(true);
    try {
      const next = !awayActive;
      await setAwayMessage(next);
      setAwayActive(next);
      toast.success(next ? "Mensaje de ausencia activado" : "Mensaje de ausencia desactivado");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSavingAway(false); }
  }

  async function handleSaveSheet() {
    setSavingSheet(true);
    try { await setGoogleSheet(sheetId.trim()); toast.success("Google Sheet actualizado"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSavingSheet(false); }
  }

  async function handleSaveBot() {
    setSavingBot(true);
    try { await updateDoc(doc(db, "crm_settings", "bot"), { instructions: botInstructions }); toast.success("Instrucciones del bot actualizadas"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSavingBot(false); }
  }

  async function handleSaveEditorBot() {
    setSavingEditorBot(true);
    try { await updateDoc(doc(db, "crm_settings", "editor_bot"), { instructions: editorBotInstructions }); toast.success("Instrucciones del editor bot actualizadas"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSavingEditorBot(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-bold font-headline text-on-surface mb-1">Ajustes</h1>
      <p className="text-sm text-on-surface-variant mb-8">Configuracion general del CRM</p>

      <div className="space-y-6">
        {/* Away message */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-on-surface">Mensaje de ausencia</h3>
              <p className="text-xs text-on-surface-variant mt-1">Respuesta automatica cuando no estas disponible</p>
            </div>
            <button onClick={handleToggleAway} disabled={savingAway}
              className={`relative w-12 h-7 rounded-full transition-colors ${awayActive ? "bg-primary" : "bg-surface-container-high"}`}>
              <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${awayActive ? "left-6" : "left-1"}`} />
            </button>
          </div>
        </div>

        {/* Google Sheet */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <h3 className="text-sm font-bold text-on-surface mb-1">Google Sheet ID</h3>
          <p className="text-xs text-on-surface-variant mb-4">ID de la hoja de calculo para exportar datos</p>
          <div className="flex gap-2">
            <input type="text" value={sheetId} onChange={(e) => setSheetId(e.target.value)} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              className="flex-1 bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 font-mono" />
            <button onClick={handleSaveSheet} disabled={savingSheet}
              className="px-4 py-2 text-sm font-bold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-40 transition-all">
              {savingSheet ? "..." : "Guardar"}
            </button>
          </div>
        </div>

        {/* Bot Instructions */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <h3 className="text-sm font-bold text-on-surface mb-1">Instrucciones del Bot IA (CRM)</h3>
          <p className="text-xs text-on-surface-variant mb-4">Prompt del sistema para el bot de WhatsApp</p>
          <textarea value={botInstructions} onChange={(e) => setBotInstructions(e.target.value)} rows={8}
            className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 resize-none font-mono" />
          <div className="flex justify-end mt-3">
            <button onClick={handleSaveBot} disabled={savingBot}
              className="px-4 py-2 text-sm font-bold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-40 transition-all">
              {savingBot ? "Guardando..." : "Guardar instrucciones"}
            </button>
          </div>
        </div>

        {/* Editor Bot Instructions */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <h3 className="text-sm font-bold text-on-surface mb-1">Instrucciones del Bot IA (Editor)</h3>
          <p className="text-xs text-on-surface-variant mb-4">Prompt del sistema para el bot del editor de diseno</p>
          <textarea value={editorBotInstructions} onChange={(e) => setEditorBotInstructions(e.target.value)} rows={8}
            className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 resize-none font-mono" />
          <div className="flex justify-end mt-3">
            <button onClick={handleSaveEditorBot} disabled={savingEditorBot}
              className="px-4 py-2 text-sm font-bold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-40 transition-all">
              {savingEditorBot ? "Guardando..." : "Guardar instrucciones"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
