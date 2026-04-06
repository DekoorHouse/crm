"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SearchBarProps {
  visible: boolean;
  onClose: () => void;
  onLoadAll: () => Promise<void>;
  tableRef?: HTMLElement | null;
}

export default function SearchBar({ visible, onClose, onLoadAll, tableRef }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [loadedAll, setLoadedAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when visible
  useEffect(() => {
    if (visible) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      setQuery("");
      clearHighlights();
    }
  }, [visible]);

  // Highlight matches when query changes
  useEffect(() => {
    if (!query.trim()) {
      clearHighlights();
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }
    const count = highlightMatches(query);
    setMatchCount(count);
    setCurrentMatch(count > 0 ? 1 : 0);
    if (count > 0) scrollToMatch(0);
  }, [query]);

  function clearHighlights() {
    document.querySelectorAll("mark.search-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
        parent.normalize();
      }
    });
  }

  function highlightMatches(searchText: string): number {
    clearHighlights();
    if (!searchText.trim()) return 0;

    const walker = document.createTreeWalker(
      document.querySelector("[data-search-scope]") || document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
        textNodes.push(node as Text);
      }
    }

    let count = 0;
    textNodes.forEach((textNode) => {
      const text = textNode.textContent || "";
      const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      const parts = text.split(regex);
      if (parts.length <= 1) return;

      const frag = document.createDocumentFragment();
      parts.forEach((part) => {
        if (regex.test(part)) {
          regex.lastIndex = 0;
          const mark = document.createElement("mark");
          mark.className = "search-highlight bg-primary/20 text-primary font-semibold rounded px-0.5";
          mark.textContent = part;
          mark.dataset.matchIndex = String(count);
          count++;
          frag.appendChild(mark);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      });

      textNode.parentNode?.replaceChild(frag, textNode);
    });

    return count;
  }

  function scrollToMatch(index: number) {
    const marks = document.querySelectorAll("mark.search-highlight");
    marks.forEach((m) => m.classList.remove("ring-2", "ring-primary"));
    if (marks[index]) {
      marks[index].classList.add("ring-2", "ring-primary");
      marks[index].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function goNext() {
    if (matchCount === 0) return;
    const next = currentMatch >= matchCount ? 1 : currentMatch + 1;
    setCurrentMatch(next);
    scrollToMatch(next - 1);
  }

  function goPrev() {
    if (matchCount === 0) return;
    const prev = currentMatch <= 1 ? matchCount : currentMatch - 1;
    setCurrentMatch(prev);
    scrollToMatch(prev - 1);
  }

  const handleLoadAll = useCallback(async () => {
    if (loadedAll) return;
    setLoadedAll(true);
    await onLoadAll();
  }, [loadedAll, onLoadAll]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "Enter") {
      if (e.shiftKey) goPrev();
      else goNext();
      e.preventDefault();
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-surface-container-lowest rounded-2xl shadow-lg dark:shadow-[0_0_20px_rgba(122,162,247,0.15)] border border-outline-variant/20 p-3 flex items-center gap-2 animate-in slide-in-from-top">
      <span className="material-symbols-outlined text-on-surface-variant text-lg">search</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Buscar en pedidos..."
        className="bg-surface-container-low rounded-lg border-none text-sm text-on-surface focus:ring-0 focus:outline-none w-52 px-3 py-1.5 placeholder:text-on-surface-variant/50"
      />

      {query && (
        <span className="text-[10px] font-bold text-on-surface-variant whitespace-nowrap">
          {matchCount > 0 ? `${currentMatch}/${matchCount}` : "0 resultados"}
        </span>
      )}

      <div className="flex items-center gap-0.5">
        <button onClick={goPrev} className="p-1 text-on-surface-variant hover:text-on-surface rounded transition-colors" title="Anterior (Shift+Enter)">
          <span className="material-symbols-outlined text-sm">expand_less</span>
        </button>
        <button onClick={goNext} className="p-1 text-on-surface-variant hover:text-on-surface rounded transition-colors" title="Siguiente (Enter)">
          <span className="material-symbols-outlined text-sm">expand_more</span>
        </button>
      </div>

      {!loadedAll && (
        <button
          onClick={handleLoadAll}
          className="text-[10px] font-bold text-primary hover:underline whitespace-nowrap"
          title="Cargar todos los pedidos para búsqueda completa"
        >
          Cargar todos
        </button>
      )}

      <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface rounded transition-colors">
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  );
}
