"use client";

import { useState, useRef } from "react";

interface MessageComposerProps {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}

export default function MessageComposer({ onSend, disabled, disabledReason }: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    if (!text.trim() || sending || disabled) return;
    setSending(true);
    try {
      await onSend(text);
      setText("");
      textareaRef.current?.focus();
    } catch {
      // toast error could go here
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (disabled) {
    return (
      <div className="px-4 py-3 border-t border-outline-variant/10 bg-surface-container-low/50">
        <div className="flex items-center gap-2 text-on-surface-variant/60 text-sm">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>lock</span>
          <span>{disabledReason || "No puedes enviar mensajes"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-outline-variant/10 bg-surface-container-lowest">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe un mensaje..."
          rows={1}
          className="flex-1 bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface resize-none border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 max-h-32"
          style={{ minHeight: 40 }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="p-2.5 bg-primary text-on-primary rounded-xl disabled:opacity-40 hover:opacity-90 transition-all flex-shrink-0"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {sending ? "hourglass_empty" : "send"}
          </span>
        </button>
      </div>
    </div>
  );
}
