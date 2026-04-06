"use client";

import { useEffect, useRef } from "react";
import type { Contact, Message } from "@/lib/api/contacts";
import { reactToMessage } from "@/lib/api/contacts";
import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";

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
}

export default function ChatWindow({
  contact, messages, loading, sessionExpired, onSend,
  replyTo, onSetReplyTo, onLoadOlder, onToggleDetails, showDetails,
}: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);

  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (contact) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView(), 100);
    }
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
      <div className="px-5 py-3 border-b border-outline-variant/10 flex items-center gap-3 bg-surface-container-lowest">
        <button onClick={onToggleDetails} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer hover:opacity-80 transition-opacity">
          <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-sm flex-shrink-0">
            {(contact.name || contact.id).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-on-surface truncate">{contact.name || contact.id}</h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-on-surface-variant">{contact.id}</span>
              {contact.status && (
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{contact.status}</span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1">
          {contact.botActive && (
            <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-full flex items-center gap-1">
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>smart_toy</span>
              IA
            </span>
          )}
          <button onClick={onToggleDetails}
            className={`p-1.5 rounded-lg transition-all ${showDetails ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:text-on-surface"}`}
            title="Detalles del contacto">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>info</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3" onScroll={handleScroll}>
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
                    <div className="flex justify-center my-3">
                      <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container-low px-3 py-1 rounded-full capitalize">
                        {msgDate}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isSent={msg.from !== contact.id}
                    onReply={onSetReplyTo}
                    onReact={(docId, emoji) => reactToMessage(contact.id, docId, emoji).catch(() => {})}
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

    </div>
  );
}
