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
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/70 px-4 backdrop-blur-2xl md:px-6 sticky top-0 z-40 transition-colors">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden hover:bg-background/80" onClick={onMenuClick}>
            <Menu className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex hover:bg-background/80" onClick={onToggleSidebar}>
            {isSidebarCollapsed ? <PanelLeftOpen className="h-5 w-5 text-muted-foreground" /> : <PanelLeftClose className="h-5 w-5 text-muted-foreground" />}
          </Button>
          <div>
            <h1 className="text-lg font-bold text-foreground sm:text-xl">{title}</h1>
            {subtitle ? <p className="hidden text-xs text-muted-foreground md:block">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sessionCountdownLabel ? (
            <div className="shrink-0 rounded-full border border-green-500/25 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-700 dark:text-green-400">
              {sessionCountdownLabel}
            </div>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
