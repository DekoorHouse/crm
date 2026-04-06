"use client";

import { useState, useRef, useEffect } from "react";
import type { Message } from "@/lib/api/contacts";

interface MessageBubbleProps {
  message: Message;
  isSent: boolean;
  onReply?: (msg: Message) => void;
  onReact?: (msgDocId: string, emoji: string) => void;
  allMessages?: Message[];
}

function formatTime(ts: { seconds: number } | null): string {
  if (!ts) return "";
  return new Date(ts.seconds * 1000).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function StatusIcon({ status }: { status: string }) {
  const base = "material-symbols-outlined";
  const s = { fontSize: 14 };
  switch (status) {
    case "pending": return <span className={`${base} text-on-surface-variant/40`} style={s}>schedule</span>;
    case "queued": return <span className={`${base} text-primary/60`} style={s}>schedule</span>;
    case "sent": return <span className={`${base} text-on-surface-variant/40`} style={s}>check</span>;
    case "delivered": return <span className={`${base} text-on-surface-variant/40`} style={s}>done_all</span>;
    case "read": return <span className={`${base} text-primary`} style={s}>done_all</span>;
    default: return null;
  }
}

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const barRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);

  // Smooth animation loop using RAF + direct DOM manipulation
  useEffect(() => {
    function tick() {
      if (audioRef.current && barRef.current && timeRef.current) {
        const cur = audioRef.current.currentTime;
        const dur = audioRef.current.duration || 1;
        barRef.current.style.width = `${(cur / dur) * 100}%`;
        const m = Math.floor(cur / 60);
        const s = Math.floor(cur % 60);
        timeRef.current.textContent = `${m}:${s.toString().padStart(2, "0")}`;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    if (playing) { rafRef.current = requestAnimationFrame(tick); }
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  function toggle() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); }
    else { audioRef.current.play(); }
    setPlaying(!playing);
  }

  function formatSec(s: number) {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  return (
    <div className="flex items-center gap-2.5 bg-surface-container rounded-2xl px-3 py-2 mb-1 min-w-[240px]">
      <audio
        ref={audioRef}
        src={src}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => { setPlaying(false); if (barRef.current) barRef.current.style.width = "0%"; if (timeRef.current) timeRef.current.textContent = "0:00"; }}
      />
      <button onClick={toggle} className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 hover:opacity-90 transition-all">
        <span className="material-symbols-outlined text-on-primary" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
          {playing ? "pause" : "play_arrow"}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="h-1.5 bg-surface-container-high rounded-full cursor-pointer relative overflow-hidden"
          onClick={(e) => {
            if (!audioRef.current || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            audioRef.current.currentTime = pct * duration;
          }}
        >
          <div ref={barRef} className="h-full bg-primary rounded-full" style={{ width: "0%" }} />
        </div>
        <div className="flex justify-between mt-1">
          <span ref={timeRef} className="text-[9px] text-on-surface-variant/60">0:00</span>
          <span className="text-[9px] text-on-surface-variant/60">{formatSec(duration)}</span>
        </div>
      </div>
      <span className="material-symbols-outlined text-primary/60 flex-shrink-0" style={{ fontSize: 16 }}>mic</span>
    </div>
  );
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export default function MessageBubble({ message, isSent, onReply, onReact, allMessages }: MessageBubbleProps) {
  const [showReactions, setShowReactions] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const reactRef = useRef<HTMLDivElement>(null);
  const hasMedia = !!message.fileUrl;
  const isImage = message.fileType?.startsWith("image/") || message.type === "image" || message.type === "sticker";
  const isVideo = message.fileType?.startsWith("video/") || message.type === "video";
  const isAudio = message.fileType?.startsWith("audio/") || message.type === "audio";
  const isLocation = message.type === "location" && message.location;

  const repliedMsg = message.context?.id && allMessages
    ? allMessages.find((m) => m.id === message.context!.id)
    : null;

  // Close reaction picker on click outside
  useEffect(() => {
    if (!showReactions) return;
    function handleClick(e: MouseEvent) {
      if (reactRef.current && !reactRef.current.contains(e.target as Node)) setShowReactions(false);
    }
    setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showReactions]);

  function handleDoubleClick() {
    if (onReply) onReply(message);
  }

  function handleReact(emoji: string) {
    if (onReact) onReact(message.docId, emoji);
    setShowReactions(false);
  }

  return (
    <div className={`flex ${isSent ? "justify-end" : "justify-start"} mb-1 group cursor-pointer`} onDoubleClick={handleDoubleClick}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 relative ${
          isSent ? "bg-primary/30 text-on-surface rounded-br-md" : "bg-surface-container-low text-on-surface rounded-bl-md"
        }`}
      >
        {/* Reply context */}
        {repliedMsg && (
          <div className={`mb-1.5 px-2.5 py-1.5 rounded-lg border-l-2 ${
            isSent ? "bg-primary/10 border-primary/30" : "bg-primary/5 border-primary"
          }`}>
            <p className={`text-[10px] truncate ${isSent ? "text-on-surface-variant" : "text-on-surface-variant"}`}>
              {repliedMsg.text || "[archivo]"}
            </p>
          </div>
        )}

        {/* Media */}
        {hasMedia && isImage && (
          <>
            <img src={message.fileUrl} alt="" className="rounded-xl max-w-full max-h-60 object-cover mb-1 cursor-pointer" loading="lazy" onClick={(e) => { e.stopPropagation(); setShowImage(true); }} />
            {showImage && (
              <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80" onClick={() => setShowImage(false)}>
                <button className="absolute top-4 right-4 p-2 text-white/70 hover:text-white" onClick={() => setShowImage(false)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 28 }}>close</span>
                </button>
                <img src={message.fileUrl} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
              </div>
            )}
          </>
        )}
        {hasMedia && isVideo && <video src={message.fileUrl} controls className="rounded-xl max-w-full max-h-60 mb-1" />}
        {hasMedia && isAudio && <AudioPlayer src={message.fileUrl!} />}
        {hasMedia && !isImage && !isVideo && !isAudio && (
          <a href={message.fileUrl} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 mb-1 ${isSent ? "text-primary" : "text-primary"}`}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>attach_file</span>
            <span className="text-xs underline">Archivo adjunto</span>
          </a>
        )}

        {isLocation && message.location && (
          <a href={`https://maps.google.com/?q=${message.location.latitude},${message.location.longitude}`} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 mb-1 ${isSent ? "text-primary" : "text-primary"}`}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>location_on</span>
            <span className="text-xs underline">{message.location.name || "Ubicacion"}</span>
          </a>
        )}

        {message.text && !(hasMedia && (message.text.toLowerCase() === "imagen" || message.text.toLowerCase() === "mensaje de voz" || message.text.toLowerCase() === "audio" || message.text.toLowerCase() === "video" || message.text.toLowerCase() === "sticker" || message.text.toLowerCase() === "documento")) && (
          <p className="text-[13px] font-medium leading-relaxed whitespace-pre-wrap break-words">{message.text}</p>
        )}

        {/* Reaction badge */}
        {message.reaction && (
          <div className="absolute -bottom-2 left-2">
            <span className="text-sm bg-surface-container-lowest rounded-full px-1 shadow-sm border border-outline-variant/10">
              {message.reaction}
            </span>
          </div>
        )}

        {/* Timestamp + status */}
        <div className={`flex items-center justify-end gap-1 mt-0.5 ${isSent ? "text-on-surface-variant/60" : "text-on-surface-variant/60"}`}>
          <span className="text-[10px]">{formatTime(message.timestamp)}</span>
          {isSent && <StatusIcon status={message.status} />}
        </div>

        {/* Hover actions */}
        <div className={`absolute top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
          isSent ? "-left-16" : "-right-16"
        }`}>
          {/* Reaction button */}
          {onReact && (
            <div ref={reactRef} className="relative">
              <button onClick={() => setShowReactions(!showReactions)}
                className="p-1 rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-low transition-all">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add_reaction</span>
              </button>
              {showReactions && (
                <div className={`absolute z-50 bottom-full mb-1 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/20 p-1 flex gap-0.5 ${
                  isSent ? "right-0" : "left-0"
                }`}>
                  {QUICK_REACTIONS.map((emoji) => (
                    <button key={emoji} onClick={() => handleReact(emoji)}
                      className="w-7 h-7 flex items-center justify-center text-base hover:bg-surface-container-low rounded-lg transition-colors">
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Reply button */}
          {onReply && (
            <button onClick={() => onReply(message)}
              className="p-1 rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-low transition-all">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>reply</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
