"use client";

import { useState, useEffect, useCallback } from "react";
import { getAwayMessage, setAwayMessage, getGoogleSheet, setGoogleSheet } from "@/lib/api/crm";
import {
  getLeadReactivationConfig,
  saveLeadReactivationConfig,
  getLeadFollowupsCount,
  type LeadReactivationConfig,
} from "@/lib/api/leadReactivation";
import { db, auth } from "@/lib/firebase/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import toast from "react-hot-toast";

interface FbPage {
  id: string;
  name: string;
  category: string | null;
  subscribed: boolean;
}
interface FbStatus {
  connected: boolean;
  userName?: string;
  userEmail?: string;
  pages?: FbPage[];
  expiresAt?: number | null;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Fila editable de la secuencia de reactivación (delay + unidad + texto)
type LeadRow = { delay: string; unit: "min" | "h"; text: string };

function rowsFromLeadConfig(cfg: LeadReactivationConfig): LeadRow[] {
  return cfg.followups.map((f) =>
    f.delayMinutes >= 60 && f.delayMinutes % 60 === 0
      ? { delay: String(f.delayMinutes / 60), unit: "h", text: f.text }
      : { delay: String(f.delayMinutes), unit: "min", text: f.text }
  );
}

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
  const [fbStatus, setFbStatus] = useState<FbStatus>({ connected: false });
  const [fbLoading, setFbLoading] = useState(false);
  const [leadCfg, setLeadCfg] = useState<LeadReactivationConfig | null>(null);
  const [leadRows, setLeadRows] = useState<LeadRow[]>([]);
  const [leadMinDays, setLeadMinDays] = useState("15");
  const [leadCooldown, setLeadCooldown] = useState("24");
  const [leadPending, setLeadPending] = useState<number | null>(null);
  const [togglingLead, setTogglingLead] = useState(false);
  const [savingLead, setSavingLead] = useState(false);

  const loadFbStatus = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!("Authorization" in headers)) return;
      const r = await fetch("/auth/facebook/status", { headers });
      const data = await r.json();
      if (data.success) setFbStatus(data);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    Promise.all([
      getAwayMessage().then((s) => setAwayActive(s.isActive)).catch(() => {}),
      getGoogleSheet().then((s) => setSheetId(s.googleSheetId || "")).catch(() => {}),
      getDoc(doc(db, "crm_settings", "bot")).then((d) => setBotInstructions(d.data()?.instructions || "")).catch(() => {}),
      getDoc(doc(db, "crm_settings", "editor_bot")).then((d) => setEditorBotInstructions(d.data()?.instructions || "")).catch(() => {}),
      getLeadReactivationConfig().then((cfg) => {
        setLeadCfg(cfg);
        setLeadRows(rowsFromLeadConfig(cfg));
        setLeadMinDays(String(cfg.minDaysSinceLastOrder));
        setLeadCooldown(String(cfg.cooldownHours));
      }).catch(() => {}),
      getLeadFollowupsCount().then(setLeadPending).catch(() => {}),
      loadFbStatus(),
    ]).finally(() => setLoading(false));
  }, [loadFbStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fb_connected") === "1") {
      toast.success("Facebook conectado correctamente");
      loadFbStatus();
      window.history.replaceState({}, "", "/crm/ajustes");
    }
    const err = params.get("fb_error");
    if (err) {
      toast.error(`Facebook: ${err}`);
      window.history.replaceState({}, "", "/crm/ajustes");
    }
  }, [loadFbStatus]);

  function handleConnectFacebook() {
    const uid = auth.currentUser?.uid;
    if (!uid) { toast.error("Inicia sesion primero"); return; }
    window.location.href = `/auth/facebook/start?uid=${encodeURIComponent(uid)}`;
  }

  async function handleDisconnectFacebook() {
    if (!confirm("Desconectar Facebook? El CRM dejara de enviar/recibir mensajes de estas paginas.")) return;
    setFbLoading(true);
    try {
      const headers = await authHeaders();
      const r = await fetch("/auth/facebook/disconnect", { method: "POST", headers });
      const data = await r.json();
      if (!data.success) throw new Error(data.message || "Error");
      toast.success("Facebook desconectado");
      setFbStatus({ connected: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setFbLoading(false);
    }
  }

  async function handleSubscribePage(pageId: string) {
    setFbLoading(true);
    try {
      const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
      const r = await fetch("/auth/facebook/subscribe-page", {
        method: "POST", headers, body: JSON.stringify({ pageId }),
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.message || "Error");
      toast.success("Pagina suscrita al CRM");
      await loadFbStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setFbLoading(false);
    }
  }

  async function handleListBusinesses() {
    setFbLoading(true);
    try {
      const headers = await authHeaders();
      const r = await fetch("/auth/facebook/businesses", { headers });
      const data = await r.json();
      if (!data.success) throw new Error(data.message || "Error");
      const names = (data.businesses || []).map((b: { name: string }) => b.name).join(", ");
      toast.success(names ? `Business Managers: ${names}` : "No se encontraron Business Managers");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setFbLoading(false);
    }
  }

  async function handleViewInsights(pageId: string) {
    setFbLoading(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`/auth/facebook/page-insights/${pageId}`, { headers });
      const data = await r.json();
      if (!data.success) throw new Error(data.message || "Error");
      const d = data.data;
      toast.success(`${d.name}: ${d.fan_count ?? 0} fans / ${d.followers_count ?? 0} seguidores`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setFbLoading(false);
    }
  }

  async function handleToggleLead() {
    if (!leadCfg) { toast.error("La configuración aún no carga"); return; }
    setTogglingLead(true);
    try {
      const next = !leadCfg.enabled;
      const saved = await saveLeadReactivationConfig({ enabled: next });
      setLeadCfg(saved);
      toast.success(next ? "Reactivación de leads encendida" : "Reactivación de leads apagada");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setTogglingLead(false); }
  }

  function updateLeadRow(i: number, patch: Partial<LeadRow>) {
    setLeadRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addLeadRow() {
    setLeadRows((rows) => [...rows, { delay: "60", unit: "min", text: "" }]);
  }

  function removeLeadRow(i: number) {
    setLeadRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function handleSaveLead() {
    const followups: { delayMinutes: number; text: string }[] = [];
    for (const row of leadRows) {
      const value = Number(row.delay);
      const text = row.text.trim();
      if (!Number.isFinite(value) || value < 1 || !text) {
        toast.error("Cada mensaje necesita un tiempo válido y un texto");
        return;
      }
      const delayMinutes = row.unit === "h" ? Math.round(value * 60) : Math.round(value);
      if (delayMinutes > 23 * 60) {
        toast.error("Los mensajes deben enviarse dentro de las primeras 23 horas (ventana de WhatsApp)");
        return;
      }
      followups.push({ delayMinutes, text });
    }
    if (followups.length === 0) { toast.error("Agrega al menos un mensaje"); return; }

    setSavingLead(true);
    try {
      const saved = await saveLeadReactivationConfig({
        followups,
        minDaysSinceLastOrder: Math.max(0, Number(leadMinDays) || 0),
        cooldownHours: Math.max(0, Number(leadCooldown) || 0),
      });
      setLeadCfg(saved);
      setLeadRows(rowsFromLeadConfig(saved));
      setLeadMinDays(String(saved.minDaysSinceLastOrder));
      setLeadCooldown(String(saved.cooldownHours));
      toast.success("Mensajes de reactivación guardados");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSavingLead(false); }
  }

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

        {/* Reactivación de leads */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-on-surface">Reactivación de leads</h3>
              <p className="text-xs text-on-surface-variant mt-1">
                Mensajes automáticos para clientes que escriben y no registran pedido
                {leadCfg?.enabled && leadPending !== null ? ` · ${leadPending} en seguimiento ahora` : ""}
              </p>
            </div>
            <button onClick={handleToggleLead} disabled={togglingLead || !leadCfg}
              title={leadCfg?.enabled ? "Apagar" : "Encender"}
              className={`relative w-12 h-7 rounded-full transition-colors ${leadCfg?.enabled ? "bg-primary" : "bg-surface-container-high"}`}>
              <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${leadCfg?.enabled ? "left-6" : "left-1"}`} />
            </button>
          </div>

          <div className={leadCfg?.enabled ? "" : "opacity-60"}>
            <div className="space-y-3">
              {leadRows.map((row, i) => (
                <div key={i} className="bg-surface-container-low rounded-xl p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wide">Mensaje {i + 1}</span>
                    <span className="text-xs text-on-surface-variant">· enviar a los</span>
                    <input type="number" min={1} value={row.delay}
                      onChange={(e) => updateLeadRow(i, { delay: e.target.value })}
                      className="w-20 bg-surface-container-lowest rounded-lg px-2 py-1.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none text-center" />
                    <select value={row.unit}
                      onChange={(e) => updateLeadRow(i, { unit: e.target.value as "min" | "h" })}
                      className="bg-surface-container-lowest rounded-lg px-2 py-1.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none">
                      <option value="min">minutos</option>
                      <option value="h">horas</option>
                    </select>
                    <span className="text-xs text-on-surface-variant">del último mensaje del cliente</span>
                    {leadRows.length > 1 && (
                      <button onClick={() => removeLeadRow(i)}
                        className="ml-auto text-xs font-bold text-red-500 hover:opacity-70">
                        Quitar
                      </button>
                    )}
                  </div>
                  <textarea value={row.text} onChange={(e) => updateLeadRow(i, { text: e.target.value })} rows={2}
                    placeholder="Texto del mensaje…"
                    className="w-full bg-surface-container-lowest rounded-lg px-3 py-2 text-sm text-on-surface border-none focus:ring-0 focus:outline-none resize-none" />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3">
              <button onClick={addLeadRow} className="text-xs font-bold text-primary hover:opacity-70">+ Agregar mensaje</button>
              <p className="text-xs text-on-surface-variant">Usa <span className="font-mono">{"{{nombre}}"}</span> para el nombre del cliente</p>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 text-xs text-on-surface-variant">
              <label className="flex items-center gap-2">
                No enviar si tiene pedido de hace menos de
                <input type="number" min={0} value={leadMinDays} onChange={(e) => setLeadMinDays(e.target.value)}
                  className="w-16 bg-surface-container-low rounded-lg px-2 py-1.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none text-center" />
                días
              </label>
              <label className="flex items-center gap-2">
                Pausa entre secuencias al mismo cliente
                <input type="number" min={0} value={leadCooldown} onChange={(e) => setLeadCooldown(e.target.value)}
                  className="w-16 bg-surface-container-low rounded-lg px-2 py-1.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none text-center" />
                horas
              </label>
            </div>

            <div className="flex justify-end mt-3">
              <button onClick={handleSaveLead} disabled={savingLead}
                className="px-4 py-2 text-sm font-bold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-40 transition-all">
                {savingLead ? "Guardando..." : "Guardar mensajes"}
              </button>
            </div>
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

        {/* Facebook / Messenger Integration */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-on-surface">Integracion con Facebook</h3>
              <p className="text-xs text-on-surface-variant mt-1">
                Conecta tu cuenta de Facebook para recibir y responder mensajes desde tus paginas en el CRM.
              </p>
            </div>
            {fbStatus.connected ? (
              <button onClick={handleDisconnectFacebook} disabled={fbLoading}
                className="px-4 py-2 text-sm font-bold text-on-surface bg-surface-container-high rounded-xl hover:opacity-90 disabled:opacity-40 transition-all">
                Desconectar
              </button>
            ) : (
              <button onClick={handleConnectFacebook}
                className="px-4 py-2 text-sm font-bold text-white rounded-xl hover:opacity-90 transition-all flex items-center gap-2"
                style={{ background: "#1877F2" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                Continuar con Facebook
              </button>
            )}
          </div>

          {fbStatus.connected && (
            <>
              <div className="bg-surface-container-low rounded-xl p-3 mb-3 text-xs flex items-center justify-between gap-2">
                <div>
                  <span className="text-on-surface-variant">Conectado como </span>
                  <span className="font-bold text-on-surface">{fbStatus.userName}</span>
                  {fbStatus.userEmail && <span className="text-on-surface-variant"> ({fbStatus.userEmail})</span>}
                </div>
                <button onClick={handleListBusinesses} disabled={fbLoading}
                  className="px-3 py-1.5 text-xs font-bold text-on-surface bg-surface-container-high rounded-lg hover:opacity-90 disabled:opacity-40 whitespace-nowrap">
                  Ver Business Managers
                </button>
              </div>

              <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wide mb-2">
                Paginas disponibles ({fbStatus.pages?.length || 0})
              </h4>
              {(fbStatus.pages || []).length === 0 ? (
                <p className="text-xs text-on-surface-variant">No se encontraron paginas en tu cuenta.</p>
              ) : (
                <div className="space-y-2">
                  {fbStatus.pages!.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-surface-container-low rounded-xl px-4 py-3">
                      <div>
                        <div className="text-sm font-bold text-on-surface">{p.name}</div>
                        <div className="text-xs text-on-surface-variant">
                          {p.category || "Pagina"} &middot; ID {p.id}
                          {p.subscribed && <span className="ml-2 text-green-600 font-bold">&#10003; Suscrita</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleViewInsights(p.id)} disabled={fbLoading}
                          className="px-3 py-1.5 text-xs font-bold text-on-surface bg-surface-container-high rounded-lg hover:opacity-90 disabled:opacity-40">
                          Ver datos
                        </button>
                        {!p.subscribed && (
                          <button onClick={() => handleSubscribePage(p.id)} disabled={fbLoading}
                            className="px-3 py-1.5 text-xs font-bold text-on-primary bg-primary rounded-lg hover:opacity-90 disabled:opacity-40">
                            Suscribir al CRM
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
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
