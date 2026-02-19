import type { ComponentType } from "react";
import {
  Activity,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Scissors,
  ShieldCheck,
  Users2,
  X,
} from "lucide-react";
import { AuthSession } from "../../types";
import { cn } from "../../lib/utils";

interface SidebarProps {
  session: AuthSession;
  onLogout: () => void;
  className?: string;
  activeView?: string;
  onNavigate?: (view: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  mobile?: boolean;
  onCloseMobile?: () => void;
}

type NavItem = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

function getNavItems(session: AuthSession): NavItem[] {
  const role = session.user.role;
  const serviceType = session.user.serviceType;

  if (role === "admin") {
    return [
      { id: "dashboard", label: "Visao geral", icon: LayoutDashboard },
      { id: "companies", label: "Empresas", icon: Building2 },
      { id: "monitoring", label: "Monitoramento", icon: Activity },
      { id: "settings", label: "IA e WhatsApp", icon: MessageSquare },
    ];
  }

  if (role === "barber") {
    return [
      { id: "dashboard", label: "Visao geral", icon: LayoutDashboard },
      { id: "appointments", label: "Agenda", icon: CalendarDays },
      { id: "services", label: "Servicos", icon: Scissors },
    ];
  }

  if (serviceType === "barber_booking") {
    return [
      { id: "dashboard", label: "Visao geral", icon: LayoutDashboard },
      { id: "barbers", label: "Barbeiros", icon: Users2 },
      { id: "services", label: "Servicos", icon: Scissors },
      { id: "appointments", label: "Agenda", icon: CalendarDays },
      { id: "settings", label: "Atendimento IA", icon: MessageSquare },
    ];
  }

  return [
    { id: "dashboard", label: "Visao geral", icon: LayoutDashboard },
    { id: "nfes", label: "Notas", icon: FileText },
    { id: "monitoring", label: "Saude", icon: Activity },
    { id: "settings", label: "Certificado", icon: ShieldCheck },
  ];
}

export function Sidebar({
  session,
  onLogout,
  className,
  activeView = "dashboard",
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  mobile = false,
  onCloseMobile,
}: SidebarProps) {
  const navItems = getNavItems(session);
  const roleLabel =
    session.user.role === "admin"
      ? "Administrador"
      : session.user.role === "barber"
        ? "Barbeiro"
        : session.user.serviceType === "barber_booking"
          ? "Empresa Barbearia"
          : "Empresa NF-e";
  const roleSubtitle =
    session.user.role === "admin"
      ? "Gestao central de agentes"
      : session.user.role === "barber"
        ? "Agenda pessoal"
        : session.user.serviceType === "barber_booking"
          ? "Agente de agendamento"
          : "Gestao inteligente de NF-e";
  const compact = collapsed && !mobile;

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-white/[0.06] bg-[#0a0a0a]/95 backdrop-blur-xl transition-[width] duration-300 ease-out",
        compact ? "w-20" : "w-72",
        mobile ? "w-[86vw] max-w-[330px]" : "",
        className,
      )}
    >
      {/* ── Logo ── */}
      <div className={cn("border-b border-white/[0.06]", compact ? "px-3 py-4" : "p-5")}>
        <div className="flex items-center justify-between gap-2">
          <div className={cn("flex items-center gap-3", compact ? "w-full justify-center" : "")}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-[0_0_15px_rgba(34,197,94,0.25)]">
              <span className="font-mono text-xs font-bold text-white">RW</span>
            </div>
            {!compact ? (
              <div className="min-w-0">
                <p className="font-mono text-base font-bold leading-tight text-white">
                  {"<RW />"}
                </p>
                <p className="truncate text-[11px] text-white/35">{roleSubtitle}</p>
              </div>
            ) : null}
          </div>

          {mobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/50 transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          ) : onToggleCollapse ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/40 transition hover:text-white",
                compact ? "border-green-500/20 bg-green-500/10 text-green-400" : "",
              )}
              title={compact ? "Expandir menu" : "Recolher menu"}
            >
              {compact ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Nav ── */}
      <div className={cn("flex-1 overflow-auto", compact ? "p-2 pt-5" : "p-3")}>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onNavigate?.(item.id)}
                title={compact ? item.label : undefined}
                className={cn(
                  "flex w-full items-center rounded-xl text-sm font-medium transition-all duration-200",
                  compact ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-gradient-to-r from-green-500/15 to-emerald-500/10 text-green-400 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.15)]"
                    : "text-white/40 hover:bg-white/[0.04] hover:text-white/80",
                )}
              >
                <Icon className={cn("shrink-0", compact ? "h-5 w-5" : "h-4.5 w-4.5")} />
                {!compact ? <span>{item.label}</span> : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Footer ── */}
      <div className={cn("border-t border-white/[0.06]", compact ? "p-2" : "p-3")}>
        {!compact ? (
          <div className="rounded-xl bg-white/[0.03] p-3">
            <p className="truncate text-sm font-medium text-white/80">{session.user.email}</p>
            <p className="text-[11px] text-white/35">{roleLabel}</p>
            <button
              onClick={onLogout}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-red-500/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair da conta
            </button>
          </div>
        ) : (
          <div className="space-y-1 rounded-xl bg-white/[0.03] p-2 text-center">
            <p
              className="truncate text-[9px] font-semibold uppercase tracking-wide text-white/30"
              title={session.user.email}
            >
              {roleLabel}
            </p>
            <button
              onClick={onLogout}
              title="Sair da conta"
              className="mt-1 grid h-8 w-full place-items-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-400 transition hover:bg-red-500/20"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
