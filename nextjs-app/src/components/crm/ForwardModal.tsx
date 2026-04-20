"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { searchContacts, forwardMessage, type Contact, type Message } from "@/lib/api/contacts";

interface ForwardModalProps {
  message: Message;
  onClose: () => void;
  excludeContactId?: string; // Contacto actual: no ofrecer reenvio al mismo
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function ForwardModal({ message, onClose, excludeContactId }: ForwardModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 300);

  const runSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const list = await searchContacts(q.trim());
      setResults(list.filter(c => c.id !== excludeContactId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al buscar");
    } finally {
      setSearching(false);
    }
  }, [excludeContactId]);

  useEffect(() => {
    runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  function toggle(contactId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  async function handleForward() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      toast.error("Selecciona al menos un contacto");
      return;
    }
    setSending(true);
    try {
      const { success, failed } = await forwardMessage(ids, {
        text: message.text,
        fileUrl: message.fileUrl,
        fileType: message.fileType
      });
      if (success.length > 0) {
        toast.success(`Reenviado a ${success.length} contacto${success.length === 1 ? "" : "s"}`);
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} fallaron. Puede ser ventana 24h cerrada.`);
        console.warn("[FORWARD] Failed:", failed);
      }
      if (failed.length === 0) onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al reenviar");
    } finally {
      setSending(false);
    }
  }

  // Preview del contenido que se va a reenviar
  const preview = message.text
    ? message.text.slice(0, 140)
    : message.fileType?.startsWith("image/") ? "📷 Imagen"
    : message.fileType?.startsWith("video/") ? "🎥 Video"
    : message.fileType?.startsWith("audio/") ? "🎵 Audio"
    : message.fileUrl ? "📄 Archivo"
    : "";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-lowest rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-outline-variant">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">forward</span>
            <h2 className="text-lg font-bold text-on-surface">Reenviar mensaje</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-container-low">
            <span className="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        </div>

        {/* Preview del mensaje */}
        <div className="p-3 border-b border-outline-variant bg-surface-container-low">
          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Mensaje</div>
          <div className="text-sm text-on-surface break-words whitespace-pre-wrap line-clamp-3">
            {preview || <span className="italic text-on-surface-variant">(Sin texto)</span>}
          </div>
        </div>

        {/* Buscador */}
        <div className="p-3 border-b border-outline-variant">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60" style={{ fontSize: 18 }}>search</span>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar contacto por nombre o telefono..."
              className="w-full bg-surface-container rounded-xl pl-10 pr-3 py-2.5 text-sm text-on-surface border-none focus:ring-2 focus:ring-primary focus:outline-none placeholder:text-on-surface-variant/50"
            />
          </div>
          {selected.size > 0 && (
            <div className="mt-2 text-xs text-on-surface-variant">
              {selected.size} seleccionado{selected.size === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {/* Lista de resultados */}
        <div className="flex-1 overflow-auto">
          {searching ? (
            <div className="p-6 text-center text-sm text-on-surface-variant">Buscando...</div>
          ) : query.trim().length < 2 ? (
            <div className="p-6 text-center text-sm text-on-surface-variant">
              Escribe al menos 2 caracteres para buscar
            </div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-sm text-on-surface-variant">
              Sin resultados para &quot;{query}&quot;
            </div>
          ) : (
            <ul className="divide-y divide-outline-variant/50">
              {results.map(contact => {
                const isSelected = selected.has(contact.id);
                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      onClick={() => toggle(contact.id)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-container-low transition-colors ${
                        isSelected ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${
                        isSelected ? "bg-primary border-primary" : "border-outline"
                      }`}>
                        {isSelected && (
                          <span className="material-symbols-outlined text-on-primary" style={{ fontSize: 14 }}>check</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-on-surface truncate">
                          {contact.name || contact.id}
                        </div>
                        <div className="text-xs text-on-surface-variant truncate">
                          {contact.id} {contact.channel && contact.channel !== "whatsapp" && `· ${contact.channel}`}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-outline-variant flex gap-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 text-sm font-semibold text-on-surface-variant rounded-xl hover:bg-surface-container-low disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleForward}
            disabled={sending || selected.size === 0}
            className="flex-1 px-4 py-2 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {sending ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-on-primary/40 border-t-on-primary rounded-full animate-spin" />
                Reenviando...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>forward</span>
                Reenviar {selected.size > 0 ? `a ${selected.size}` : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
