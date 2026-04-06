"use client";

import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/firebase/config";
import { collection, onSnapshot } from "firebase/firestore";

interface QR { id: string; shortcut: string; message: string; }

interface QuickReplyPickerProps {
  filter: string;
  onSelect: (message: string) => void;
  onClose: () => void;
}

export default function QuickReplyPicker({ filter, onSelect, onClose }: QuickReplyPickerProps) {
  const [items, setItems] = useState<QR[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "quick_replies"), (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, shortcut: d.data().shortcut || "", message: d.data().message || "" })));
    });
    return unsub;
  }, []);

  const filtered = items.filter((q) =>
    !filter || q.shortcut.toLowerCase().includes(filter.toLowerCase()) || q.message.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => { setSelectedIdx(0); }, [filter]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter" && filtered.length > 0) { e.preventDefault(); onSelect(filtered[selectedIdx].message); onClose(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [filtered, selectedIdx, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div ref={ref} className="absolute bottom-full mb-2 left-0 right-0 max-h-48 overflow-y-auto bg-surface-container-lowest rounded-xl shadow-2xl dark:shadow-[0_0_20px_rgba(122,162,247,0.15)] border border-outline-variant/20">
      {filtered.map((qr, i) => (
        <button key={qr.id} onClick={() => { onSelect(qr.message); onClose(); }}
          className={`w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors ${
            i === selectedIdx ? "bg-primary/10" : "hover:bg-surface-container-low"
          }`}>
          <span className="text-xs font-bold text-primary font-mono flex-shrink-0">/{qr.shortcut}</span>
          <span className="text-xs text-on-surface-variant truncate">{qr.message}</span>
        </button>
      ))}
    </div>
  );
}
