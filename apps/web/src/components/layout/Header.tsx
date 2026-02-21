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
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl md:px-6">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
            <Menu className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={onToggleSidebar}>
            {isSidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
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
