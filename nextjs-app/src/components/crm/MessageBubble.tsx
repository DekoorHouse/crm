"use client";

import type { Message } from "@/lib/api/contacts";

interface MessageBubbleProps {
  message: Message;
  isSent: boolean;
  onReply?: (msg: Message) => void;
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

export default function MessageBubble({ message, isSent, onReply, allMessages }: MessageBubbleProps) {
  const hasMedia = !!message.fileUrl;
  const isImage = message.fileType?.startsWith("image/") || message.type === "image" || message.type === "sticker";
  const isVideo = message.fileType?.startsWith("video/") || message.type === "video";
  const isAudio = message.fileType?.startsWith("audio/") || message.type === "audio";
  const isLocation = message.type === "location" && message.location;

  // Find replied-to message
  const repliedMsg = message.context?.id && allMessages
    ? allMessages.find((m) => m.id === message.context!.id)
    : null;

  return (
    <div className={`flex ${isSent ? "justify-end" : "justify-start"} mb-1 group`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 relative ${
        isSent ? "bg-primary text-on-primary rounded-br-md" : "bg-surface-container-low text-on-surface rounded-bl-md"
      }`}>
        {/* Reply context */}
        {repliedMsg && (
          <div className={`mb-1.5 px-2.5 py-1.5 rounded-lg border-l-2 ${
            isSent ? "bg-on-primary/10 border-on-primary/30" : "bg-primary/5 border-primary"
          }`}>
            <p className={`text-[10px] truncate ${isSent ? "text-on-primary/70" : "text-on-surface-variant"}`}>
              {repliedMsg.text || "[archivo]"}
            </p>
          </div>
        )}

        {/* Media */}
        {hasMedia && isImage && (
          <img src={message.fileUrl} alt="" className="rounded-xl max-w-full max-h-60 object-cover mb-1" loading="lazy" />
        )}
        {hasMedia && isVideo && (
          <video src={message.fileUrl} controls className="rounded-xl max-w-full max-h-60 mb-1" />
        )}
        {hasMedia && isAudio && (
          <audio src={message.fileUrl} controls className="max-w-full mb-1" />
        )}
        {hasMedia && !isImage && !isVideo && !isAudio && (
          <a href={message.fileUrl} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 mb-1 ${isSent ? "text-on-primary/80" : "text-primary"}`}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>attach_file</span>
            <span className="text-xs underline">Archivo adjunto</span>
          </a>
        )}

        {/* Location */}
        {isLocation && message.location && (
          <a href={`https://maps.google.com/?q=${message.location.latitude},${message.location.longitude}`} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 mb-1 ${isSent ? "text-on-primary/80" : "text-primary"}`}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>location_on</span>
            <span className="text-xs underline">{message.location.name || "Ubicacion"}</span>
          </a>
        )}

        {/* Text */}
        {message.text && <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{message.text}</p>}

        {/* Reaction */}
        {message.reaction && <span className="text-base">{message.reaction}</span>}

        {/* Timestamp + status */}
        <div className={`flex items-center justify-end gap-1 mt-0.5 ${isSent ? "text-on-primary/60" : "text-on-surface-variant/60"}`}>
          <span className="text-[10px]">{formatTime(message.timestamp)}</span>
          {isSent && <StatusIcon status={message.status} />}
        </div>

        {/* Reply action (on hover) */}
        {onReply && (
          <button
            onClick={() => onReply(message)}
            className={`absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg ${
              isSent ? "-left-8 text-on-surface-variant/50 hover:text-on-surface" : "-right-8 text-on-surface-variant/50 hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>reply</span>
          </button>
        )}
      </div>
    </div>
  );
}
