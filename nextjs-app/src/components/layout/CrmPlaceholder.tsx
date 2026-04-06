"use client";

interface CrmPlaceholderProps {
  icon: string;
  title: string;
  description?: string;
}

export default function CrmPlaceholder({ icon, title, description = "Proximamente" }: CrmPlaceholderProps) {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-center">
        <span
          className="material-symbols-outlined text-on-surface-variant/20 mb-4 block"
          style={{ fontSize: 64 }}
        >
          {icon}
        </span>
        <h2 className="text-xl font-bold font-headline text-on-surface mb-1">{title}</h2>
        <p className="text-sm text-on-surface-variant">{description}</p>
      </div>
    </div>
  );
}
