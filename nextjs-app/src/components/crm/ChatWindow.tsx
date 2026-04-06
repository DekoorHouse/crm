"use client";

import { useEffect, useRef } from "react";
import type { Contact } from "@/lib/api/contacts";
import type { Message } from "@/lib/api/contacts";
import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";

interface ChatWindowProps {
  contact: Contact | null;
  messages: Message[];
  loading: boolean;
  sessionExpired: boolean;
  onSend: (text: string) => Promise<void>;
}

export default function ChatWindow({
  contact,
  messages,
  loading,
  sessionExpired,
  onSend,
}: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  // Scroll to bottom when contact changes
  useEffect(() => {
    if (contact) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView();
      }, 100);
    }
  }, [contact?.id]);

  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <span className="material-symbols-outlined text-on-surface-variant/15 block mb-3" style={{ fontSize: 72 }}>
            chat
          </span>
          <p className="text-sm text-on-surface-variant">Selecciona una conversacion</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* Header */}
      <div className="px-5 py-3 border-b border-outline-variant/10 flex items-center gap-3 bg-surface-container-lowest">
        <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-sm flex-shrink-0">
          {(contact.name || contact.id).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-on-surface truncate">{contact.name || contact.id}</h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-on-surface-variant">{contact.id}</span>
            <span className="material-symbols-outlined text-on-surface-variant/40" style={{ fontSize: 12 }}>
              {contact.channel === "messenger" ? "question_answer" : "chat"}
            </span>
          </div>
        </div>
        {contact.botActive && (
          <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-full flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>smart_toy</span>
            IA activa
          </span>
        )}
      </div>

      {/* Session expired banner */}
      {sessionExpired && (
        <div className="px-4 py-2 bg-error-container/20 text-error text-xs flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>warning</span>
          Sesion expirada — han pasado mas de 24h desde el ultimo mensaje del cliente
        </div>
      )}

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3">
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
            {messages.map((msg) => (
              <MessageBubble
                key={msg.docId}
                message={msg}
                isSent={msg.from !== contact.id}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        onSend={onSend}
        disabled={sessionExpired && contact.channel === "whatsapp"}
        disabledReason="Sesion expirada — envia un template para reiniciar"
      />
    </div>
  );
}
