"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { useEffect, useState } from "react";
import CrmSidebar from "@/components/layout/CrmSidebar";
import LoadingOverlay from "@/components/layout/LoadingOverlay";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return <LoadingOverlay />;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <CrmSidebar collapsed={!sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
