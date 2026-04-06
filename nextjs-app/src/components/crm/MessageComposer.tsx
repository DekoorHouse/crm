"use client";

import { useState, useRef } from "react";
import type { Message } from "@/lib/api/contacts";
import { getSignedUploadUrl } from "@/lib/api/contacts";
import EmojiPicker from "./EmojiPicker";
import QuickReplyPicker from "./QuickReplyPicker";

interface MessageComposerProps {
  onSend: (opts: { text?: string; fileUrl?: string; fileType?: string }) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
  replyTo: Message | null;
  onCancelReply: () => void;
}

export default function MessageComposer({ onSend, disabled, disabledReason, replyTo, onCancelReply }: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [stagedFile, setStagedFile] = useState<{ file: File; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrFilter, setQrFilter] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSend() {
    if ((!text.trim() && !stagedFile) || sending || disabled) return;
    setSending(true);
    try {
      let fileUrl: string | undefined;
      let fileType: string | undefined;
      if (stagedFile) {
        setUploading(true);
        const filename = `chat-uploads/${Date.now()}-${stagedFile.file.name}`;
        const signedUrl = await getSignedUploadUrl(filename, stagedFile.file.type);
        await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": stagedFile.file.type }, body: stagedFile.file });
        fileUrl = signedUrl.split("?")[0];
        fileType = stagedFile.file.type;
        setUploading(false);
      }
      await onSend({ text: text.trim() || undefined, fileUrl, fileType });
      setText(""); setStagedFile(null); setShowQR(false);
      textareaRef.current?.focus();
    } catch { /* */ }
    finally { setSending(false); setUploading(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showQR) return; // Let QuickReplyPicker handle keys
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleTextChange(val: string) {
    setText(val);
    // Detect "/" at start for quick replies
    if (val.startsWith("/")) {
      setShowQR(true);
      setQrFilter(val.slice(1));
    } else {
      setShowQR(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStagedFile({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" });
    e.target.value = "";
  }

  function handlePaste(e: React.ClipboardEvent) {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { setStagedFile({ file, preview: URL.createObjectURL(file) }); break; }
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) setStagedFile({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" });
  }

  function insertEmoji(emoji: string) {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  }

  function selectQuickReply(message: string) {
    setText(message);
    setShowQR(false);
    textareaRef.current?.focus();
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
    <div className="border-t border-outline-variant/10 bg-surface-container-lowest">
      {/* Reply-to preview */}
      {replyTo && (
        <div className="px-4 pt-2 flex items-center gap-2">
          <div className="flex-1 bg-primary/5 border-l-2 border-primary rounded-r-lg px-3 py-1.5">
            <p className="text-[10px] font-bold text-primary">Respondiendo a</p>
            <p className="text-xs text-on-surface-variant truncate">{replyTo.text || "[archivo]"}</p>
          </div>
          <button onClick={onCancelReply} className="p-1 text-on-surface-variant/50 hover:text-on-surface">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      )}

      {/* Staged file preview */}
      {stagedFile && (
        <div className="px-4 pt-2">
          <div className="relative inline-block">
            {stagedFile.preview ? (
              <img src={stagedFile.preview} alt="" className="h-20 rounded-xl object-cover" />
            ) : (
              <div className="h-12 px-4 bg-surface-container-low rounded-xl flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>attach_file</span>
                <span className="text-xs text-on-surface-variant truncate max-w-[150px]">{stagedFile.file.name}</span>
              </div>
            )}
            <button onClick={() => setStagedFile(null)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-error text-white rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>close</span>
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="px-4 py-3 relative" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        {/* Quick reply picker */}
        {showQR && <QuickReplyPicker filter={qrFilter} onSelect={selectQuickReply} onClose={() => setShowQR(false)} />}
        {/* Emoji picker */}
        {showEmoji && <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />}

        <div className="flex items-end gap-1">
          <button onClick={() => fileInputRef.current?.click()}
            className="p-2 text-on-surface-variant/60 hover:text-primary rounded-lg transition-colors flex-shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>attach_file</span>
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx" />

          <button onClick={() => { setShowEmoji(!showEmoji); setShowQR(false); }}
            className={`p-2 rounded-lg transition-colors flex-shrink-0 ${showEmoji ? "text-primary" : "text-on-surface-variant/60 hover:text-primary"}`}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>emoji_emotions</span>
          </button>

          <textarea ref={textareaRef} value={text} onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="Escribe un mensaje... (/ para atajos)"
            rows={1} className="flex-1 bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface resize-none border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 max-h-32"
            style={{ minHeight: 40 }} />

          <button onClick={handleSend} disabled={(!text.trim() && !stagedFile) || sending || uploading}
            className="p-2.5 bg-primary text-on-primary rounded-xl disabled:opacity-40 hover:opacity-90 transition-all flex-shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              {uploading ? "cloud_upload" : sending ? "hourglass_empty" : "send"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
