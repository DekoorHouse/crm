"use client";

import { useState, useEffect, useCallback } from "react";

interface ImageViewerProps {
  urls: string[];
  initialIndex?: number;
  orderNumber?: number | null;
  onClose: () => void;
}

export default function ImageViewer({ urls, initialIndex = 0, orderNumber, onClose }: ImageViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % urls.length);
  }, [urls.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + urls.length) % urls.length);
  }, [urls.length]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, goNext, goPrev]);

  if (urls.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="flex flex-col items-center gap-4 max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* Order badge */}
        {orderNumber && (
          <span className="bg-primary text-on-primary px-4 py-1.5 rounded-full text-sm font-bold font-headline">
            DH{orderNumber}
          </span>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-6">
          <button onClick={goPrev} className="w-10 h-10 rounded-full bg-accent/90 text-black flex items-center justify-center hover:scale-110 transition-all">
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <span className="text-white text-sm font-bold">
            {currentIndex + 1} / {urls.length}
          </span>
          <button onClick={goNext} className="w-10 h-10 rounded-full bg-accent/90 text-black flex items-center justify-center hover:scale-110 transition-all">
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>

        {/* Main image */}
        <img
          src={urls[currentIndex]}
          alt={`Foto ${currentIndex + 1}`}
          className="max-w-[80vw] max-h-[calc(80vh-160px)] object-contain rounded-2xl"
        />

        {/* Thumbnails */}
        {urls.length > 1 && (
          <div className="flex gap-2 overflow-x-auto max-w-[80vw] pb-2">
            {urls.map((url, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all ${
                  i === currentIndex ? "ring-2 ring-primary scale-110" : "opacity-60 hover:opacity-100"
                }`}
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Close button */}
        <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-all">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
  );
}
