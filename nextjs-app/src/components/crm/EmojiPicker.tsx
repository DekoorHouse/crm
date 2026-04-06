"use client";

import { useState, useEffect, useRef } from "react";

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: "Frecuentes", emojis: ["😊", "👍", "❤️", "😂", "🙏", "😍", "🎉", "🔥", "✅", "👋", "💪", "😁", "🥰", "😎", "💯", "🤗", "😘", "👏", "🙌", "💕"] },
  { label: "Caras", emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "😮‍💨", "🤥"] },
  { label: "Gestos", emojis: ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏"] },
  { label: "Objetos", emojis: ["💰", "💵", "💳", "📦", "📱", "💻", "📸", "🎨", "🖼️", "🎁", "🏷️", "📋", "📝", "✏️", "📌", "📎", "🔗", "🔒", "🔑", "🛒", "📮", "📬", "🚚", "✈️", "🏠", "🏢", "⭐", "🌟", "💡", "🔔"] },
  { label: "Simbolos", emojis: ["✅", "❌", "❓", "❗", "💯", "🔥", "⚡", "💥", "✨", "🎯", "💎", "🏆", "🥇", "🎖️", "📣", "💬", "💭", "🗯️", "♻️", "⚠️", "🚫", "⭕", "🔴", "🟢", "🔵", "🟡", "⚪", "⚫", "🟣", "🟤"] },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [category, setCategory] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="absolute bottom-full mb-2 left-0 w-72 bg-surface-container-lowest rounded-2xl shadow-2xl dark:shadow-[0_0_20px_rgba(122,162,247,0.15)] border border-outline-variant/20 overflow-hidden">
      {/* Category tabs */}
      <div className="flex border-b border-outline-variant/10 px-1 pt-1">
        {EMOJI_CATEGORIES.map((cat, i) => (
          <button key={i} onClick={() => setCategory(i)}
            className={`flex-1 py-1.5 text-[10px] font-bold transition-all rounded-t-lg ${
              category === i ? "text-primary bg-primary/10" : "text-on-surface-variant/50 hover:text-on-surface"
            }`}>
            {cat.label}
          </button>
        ))}
      </div>
      {/* Emoji grid */}
      <div className="p-2 grid grid-cols-8 gap-0.5 max-h-48 overflow-y-auto">
        {EMOJI_CATEGORIES[category].emojis.map((emoji, i) => (
          <button key={i} onClick={() => { onSelect(emoji); onClose(); }}
            className="w-8 h-8 flex items-center justify-center text-lg hover:bg-surface-container-low rounded-lg transition-colors">
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
