"use client";

import { getStatusConfig } from "@/lib/utils/statusConfig";

interface StatusBadgeProps {
  status: string;
  onClick?: (event: React.MouseEvent) => void;
}

export default function StatusBadge({ status, onClick }: StatusBadgeProps) {
  const config = getStatusConfig(status);

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer border"
      style={{
        backgroundColor: `${config.color}18`,
        color: config.color,
        borderColor: `${config.color}30`,
      }}
    >
      <span className="material-symbols-outlined text-xs" style={{ fontSize: "14px" }}>
        {config.icon}
      </span>
      {config.label}
    </button>
  );
}
