"use client";

import { useState, useRef, useEffect } from "react";
import { simulateAi } from "@/lib/api/crm";

interface ChatMsg {
  role: "user" | "model";
  content: string;
}

export default function SimuladorIaPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg: ChatMsg = { role: "user", content: input.trim() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);

    try {
      const res = await simulateAi(userMsg.content, messages);
      setMessages([...history, { role: "model", content: res.response }]);
    } catch {
      setMessages([...history, { role: "model", content: "Error al generar respuesta" }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <h1 className="text-xl font-bold font-headline text-on-surface">Simulador IA</h1>
        <p className="text-sm text-on-surface-variant mt-1">Prueba las respuestas de la IA del CRM</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 space-y-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <span className="material-symbols-outlined text-on-surface-variant/15 block mb-3" style={{ fontSize: 64 }}>smart_toy</span>
              <p className="text-sm text-on-surface-variant">Escribe un mensaje para probar la IA</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
              msg.role === "user"
                ? "bg-primary text-on-primary rounded-br-md"
                : "bg-surface-container-low text-on-surface rounded-bl-md"
            }`}>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-container-low rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-on-surface-variant/30 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-on-surface-variant/30 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-on-surface-variant/30 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-8 py-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje de prueba..."
            rows={1}
            className="flex-1 bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface resize-none border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 max-h-32"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="p-2.5 bg-primary text-on-primary rounded-xl disabled:opacity-40 hover:opacity-90 transition-all flex-shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
