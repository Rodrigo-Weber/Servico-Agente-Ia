import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AuthSession } from "../../types";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "weber_sidebar_collapsed";

interface DashboardLayoutProps {
  children: ReactNode;
  session: AuthSession;
  onLogout: () => void;
  title: string;
  subtitle?: string;
  activeView?: string;
  onNavigate?: (view: string) => void;
  sessionCountdownLabel?: string;
}

export function DashboardLayout({
  children,
  session,
  onLogout,
  title,
  subtitle,
  activeView,
  onNavigate,
  sessionCountdownLabel,
}: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      return raw === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      // falha de persistencia nao deve interromper a UX.
    }
  }, [sidebarCollapsed]);

  return (
    <div className="flex h-screen overflow-hidden bg-background relative selection:bg-primary/20 selection:text-primary">
      <Sidebar
        session={session}
        onLogout={onLogout}
        className="hidden lg:flex"
        activeView={activeView}
        onNavigate={onNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      />

      {sidebarOpen ? (
        <div className="absolute inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
          <Sidebar
            session={session}
            onLogout={onLogout}
            className="relative z-10 h-full shadow-2xl animate-slide-in-left"
            activeView={activeView}
            mobile
            onCloseMobile={() => setSidebarOpen(false)}
            onNavigate={(view) => {
              onNavigate?.(view);
              setSidebarOpen(false);
            }}
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          subtitle={subtitle}
          onMenuClick={() => setSidebarOpen(true)}
          onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
          isSidebarCollapsed={sidebarCollapsed}
          sessionCountdownLabel={sessionCountdownLabel}
        />
        <main className="flex-1 overflow-auto px-3 pb-8 pt-5 sm:px-5 md:px-6 lg:px-8">
          <div className="mx-auto w-full enter-up">{children}</div>
        </main>
      </div>
    </div>
  );
}
