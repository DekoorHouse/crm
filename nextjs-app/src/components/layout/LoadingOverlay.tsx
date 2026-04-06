"use client";

export default function LoadingOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="relative mb-6">
          <div className="w-16 h-16 border-4 border-surface-container-high rounded-full" />
          <div className="absolute top-0 left-0 w-16 h-16 border-4 border-transparent border-t-primary rounded-full animate-spin" />
        </div>
        <h2 className="text-lg font-bold font-headline text-primary mb-1">Dekoor</h2>
        <p className="text-sm text-on-surface-variant">Cargando workspace...</p>
      </div>
    </div>
  );
}
