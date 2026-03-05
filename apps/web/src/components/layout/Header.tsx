import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "../ui/Button";
import { ThemeToggle } from "../theme-toggle";

interface HeaderProps {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
  sessionCountdownLabel?: string;
}

export function Header({ title, subtitle, onMenuClick, onToggleSidebar, isSidebarCollapsed, sessionCountdownLabel }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-header-bg px-4 backdrop-blur-xl md:px-6 sticky top-0 z-40 transition-colors duration-300">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={onMenuClick}>
            <Menu className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex h-8 w-8" onClick={onToggleSidebar}>
            {isSidebarCollapsed
              ? <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
              : <PanelLeftClose className="h-4 w-4 text-muted-foreground" />}
          </Button>
          <div className="h-5 w-px bg-border/60 hidden md:block" />
          <div>
            <h1 className="text-sm font-semibold text-foreground tracking-tight sm:text-base">{title}</h1>
            {subtitle ? <p className="hidden text-[11px] text-muted-foreground/80 md:block">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sessionCountdownLabel ? (
            <div className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 animate-pulse">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 align-middle" />
              {sessionCountdownLabel}
            </div>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
