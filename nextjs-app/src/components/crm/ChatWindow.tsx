"use client";

import { useEffect, useRef, useState } from "react";
import type { Contact, Message } from "@/lib/api/contacts";
import { reactToMessage, sendUtilityMessage } from "@/lib/api/contacts";
import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";
import ForwardModal from "./ForwardModal";
import Twemoji from "@/components/Twemoji";
import toast from "react-hot-toast";

interface ChatWindowProps {
  contact: Contact | null;
  messages: Message[];
  loading: boolean;
  sessionExpired: boolean;
  onSend: (opts: { text?: string; fileUrl?: string; fileType?: string }) => Promise<void>;
  replyTo: Message | null;
  onSetReplyTo: (msg: Message | null) => void;
  onLoadOlder: () => void;
  onToggleDetails: () => void;
  showDetails: boolean;
  onToggleBot: () => void;
}

export default function ChatWindow({
  contact, messages, loading, sessionExpired, onSend,
  replyTo, onSetReplyTo, onLoadOlder, onToggleDetails, showDetails, onToggleBot,
}: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);
  const isInitialLoad = useRef(true);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [utilityText, setUtilityText] = useState("");
  const [utilityTag, setUtilityTag] = useState<"POST_PURCHASE_UPDATE" | "CONFIRMED_EVENT_UPDATE" | "ACCOUNT_UPDATE">("POST_PURCHASE_UPDATE");
  const [utilitySending, setUtilitySending] = useState(false);
  const [forwarding, setForwarding] = useState<Message | null>(null);

  async function handleSendUtility() {
    if (!contact || !utilityText.trim()) return;
    setUtilitySending(true);
    try {
      await sendUtilityMessage(contact.id, utilityText.trim(), utilityTag);
      toast.success("Actualizacion enviada al cliente");
      setUtilityText("");
      setUtilityOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setUtilitySending(false);
    }
  }

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length === 0) return;
    if (isInitialLoad.current) {
      messagesEndRef.current?.scrollIntoView();
      isInitialLoad.current = false;
      // Re-scroll after images load
      const imgs = containerRef.current?.querySelectorAll("img");
      imgs?.forEach((img) => {
        if (!img.complete) {
          img.addEventListener("load", () => messagesEndRef.current?.scrollIntoView(), { once: true });
        }
      });
    } else if (messages.length > prevMessageCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCount.current = messages.length;
  }, [messages]);

  // Reset on contact change
  useEffect(() => {
    isInitialLoad.current = true;
    prevMessageCount.current = 0;
  }, [contact?.id]);

  // Load older messages on scroll to top
  function handleScroll() {
    if (containerRef.current && containerRef.current.scrollTop < 50 && messages.length > 0) {
      onLoadOlder();
    }
  }

  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <span className="material-symbols-outlined text-on-surface-variant/15 block mb-3" style={{ fontSize: 72 }}>chat</span>
          <p className="text-sm text-on-surface-variant">Selecciona una conversacion</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* Header */}
      <div className="px-5 py-3 border-b border-outline-variant/10 flex items-center gap-3 glass-header z-10">
        <button onClick={onToggleDetails} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer hover:opacity-80 transition-opacity">
          <div className="w-9 h-9 rounded-full avatar-gradient flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm">
            {(contact.name || contact.id).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-on-surface truncate">
              <Twemoji>{contact.name || contact.id}</Twemoji>
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-on-surface-variant">{contact.id}</span>
              {contact.channel === "messenger" && <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">Messenger</span>}
              {contact.channel === "instagram" && <span className="text-[10px] font-bold text-pink-500 bg-pink-500/10 px-1.5 py-0.5 rounded">Instagram</span>}
              {contact.status && (
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{contact.status}</span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1">
          {contact.channel === "messenger" && (
            <button
              onClick={() => setUtilityOpen((v) => !v)}
              title="Enviar actualizacion de pedido (fuera de 24h)"
              className="text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 transition-all border text-blue-600 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>local_shipping</span>
              Actualizar pedido
            </button>
          )}
          <button
            onClick={onToggleBot}
            title={contact.botActive ? "Desactivar IA" : "Activar IA"}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 transition-all border ${
              contact.botActive
                ? "text-primary bg-primary/10 border-primary/20 hover:bg-primary/20 shadow-sm"
                : "text-on-surface-variant bg-surface-container-high border-transparent hover:bg-surface-container-highest"
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>smart_toy</span>
            IA
          </button>
        </div>
      </div>

      {/* Utility messaging panel (fuera de 24h con MESSAGE_TAG) */}
      {utilityOpen && contact.channel === "messenger" && (
        <div className="px-5 py-3 border-b border-outline-variant/10 bg-blue-500/5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-on-surface">Enviar actualizacion fuera de 24h</h4>
            <button onClick={() => setUtilityOpen(false)} className="text-xs text-on-surface-variant hover:text-on-surface">Cerrar</button>
          </div>
          <p className="text-[11px] text-on-surface-variant mb-2">
            Usa esta funcion solo para notificar al cliente sobre un pedido, evento confirmado o cambio en su cuenta.
            Meta prohibe usarla con fines promocionales.
          </p>
          <div className="flex gap-2 mb-2">
            <select value={utilityTag} onChange={(e) => setUtilityTag(e.target.value as typeof utilityTag)}
              className="text-xs bg-surface-container-low rounded-lg px-2 py-1.5 border border-outline-variant/20">
              <option value="POST_PURCHASE_UPDATE">Actualizacion de pedido</option>
              <option value="CONFIRMED_EVENT_UPDATE">Recordatorio de evento/cita</option>
              <option value="ACCOUNT_UPDATE">Cambio en cuenta</option>
            </select>
          </div>
          <textarea
            value={utilityText}
            onChange={(e) => setUtilityText(e.target.value)}
            placeholder="Ej: Tu pedido #1234 salio del almacen. Numero de guia: ABC123..."
            rows={2}
            className="w-full bg-surface-container-lowest rounded-lg px-3 py-2 text-xs border border-outline-variant/20 resize-none focus:outline-none focus:border-primary"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={handleSendUtility} disabled={utilitySending || !utilityText.trim()}
              className="px-3 py-1.5 text-xs font-bold text-on-primary bg-primary rounded-lg hover:opacity-90 disabled:opacity-40">
              {utilitySending ? "Enviando..." : "Enviar actualizacion"}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 chat-bg" onScroll={handleScroll}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-on-surface-variant/50">No hay mensajes</p>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => {
              // Date separator
              const msgDate = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
              const prevDate = i > 0 && messages[i - 1].timestamp ? new Date(messages[i - 1].timestamp!.seconds * 1000).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
              const showDate = msgDate && msgDate !== prevDate;

              return (
                <div key={msg.docId}>
                  {showDate && (
                    <div className="flex justify-center my-4">
                      <span className="text-[10px] font-bold text-on-surface-variant/60 bg-surface-container-lowest px-4 py-1.5 rounded-full capitalize shadow-sm">
                        {msgDate}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isSent={msg.from !== contact.id}
                    onReply={onSetReplyTo}
                    onReact={(docId, emoji) => reactToMessage(contact.id, docId, emoji).catch(() => {})}
                    onForward={setForwarding}
                    allMessages={messages}
                  />
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        onSend={onSend}
        disabled={sessionExpired && contact.channel === "whatsapp"}
        disabledReason="Sesion expirada — han pasado mas de 24h desde el ultimo mensaje del cliente"
        replyTo={replyTo}
        onCancelReply={() => onSetReplyTo(null)}
      />

      {/* Modal de reenvio */}
      {forwarding && (
        <ForwardModal
          message={forwarding}
          onClose={() => setForwarding(null)}
          excludeContactId={contact.id}
        />
      )}

    </div>
  );
}
