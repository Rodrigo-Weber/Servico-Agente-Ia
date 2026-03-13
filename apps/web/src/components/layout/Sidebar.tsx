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
  ReceiptText,
  Scissors,
  ShieldCheck,
  Stethoscope,
  Users2,
  X,
  CarFront,
  FileCheck2,
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
      { id: "users", label: "Usuarios", icon: Users2 },
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
    let labelResource = "Barbeiros";
    if (session.user.bookingSector === "car_wash") labelResource = "Boxes/Vagas";
    if (session.user.bookingSector === "clinic") labelResource = "Profissionais";
    if (session.user.bookingSector === "generic") labelResource = "Recursos";

    let iconService = Scissors;
    if (session.user.bookingSector === "car_wash") iconService = CarFront;
    if (session.user.bookingSector === "clinic") iconService = Stethoscope;

    return [
      { id: "dashboard", label: "Visao geral", icon: LayoutDashboard },
      { id: "barbers", label: labelResource, icon: Users2 },
      { id: "services", label: "Servicos", icon: iconService },
      { id: "appointments", label: "Agenda", icon: CalendarDays },
      { id: "nfse", label: "NFS-e", icon: FileCheck2 },
      { id: "settings", label: "Configurações", icon: ShieldCheck },
    ];
  }

  if (serviceType === "billing") {
    return [
      { id: "dashboard", label: "Visão Geral", icon: LayoutDashboard },
      { id: "collections", label: "Cobranças", icon: ReceiptText },
      { id: "crm", label: "CRM (Mensagens)", icon: MessageSquare },
      { id: "settings", label: "Configurações", icon: ShieldCheck },
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
  const bookingSector = session.user.bookingSector || "generic";
  const bookingRoleLabel =
    bookingSector === "car_wash"
      ? "Lava Jato"
      : bookingSector === "clinic"
        ? "Clinica"
        : "Agendamentos";
  const bookingRoleSubtitle =
    bookingSector === "car_wash"
      ? "Agendamento para lava jato"
      : bookingSector === "clinic"
        ? "Agendamento para clinica"
        : "Agendamento inteligente";
  const roleLabel =
    session.user.role === "admin"
      ? "Administrador"
      : session.user.role === "barber"
        ? "Barbeiro"
        : session.user.serviceType === "barber_booking"
          ? bookingRoleLabel
          : session.user.serviceType === "billing"
            ? "Cobranças"
            : "NF-e";
  const roleSubtitle =
    session.user.role === "admin"
      ? "Gestão central"
      : session.user.role === "barber"
        ? "Agenda pessoal"
        : session.user.serviceType === "barber_booking"
          ? bookingRoleSubtitle
          : session.user.serviceType === "billing"
            ? "CRM inteligente"
            : "Gestão fiscal";
  const compact = collapsed && !mobile;

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-sidebar-bg border-sidebar-border transition-[width] duration-300 ease-in-out z-50",
        compact ? "w-18" : "w-66",
        mobile ? "w-[86vw] max-w-[320px]" : "",
        className,
      )}
    >
      {/* ── Logo ── */}
      <div className={cn("flex h-16 items-center shrink-0 border-b border-sidebar-border", compact ? "px-2" : "px-4")}>
        <div className="flex w-full items-center justify-between gap-2">
          <div className={cn("flex items-center gap-3", compact ? "w-full justify-center" : "")}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-primary to-primary/80 text-primary-foreground shadow-glow-sm transition-transform hover:scale-105 duration-300">
              <span className="font-mono text-xs font-black">WEF</span>
            </div>
            {!compact ? (
              <div className="min-w-0">
                <p className="font-display text-sm font-bold leading-tight text-foreground tracking-tight">
                  Painel WEF
                </p>
                <p className="truncate text-[11px] text-muted-foreground font-medium">{roleSubtitle}</p>
              </div>
            ) : null}
          </div>

          {mobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/60"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Nav ── */}
      <div className={cn("flex-1 overflow-auto", compact ? "p-1.5 pt-4" : "p-3 pt-4")}>
        {!compact && (
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/60">
            Navegação
          </p>
        )}
        <nav className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onNavigate?.(item.id)}
                title={compact ? item.label : undefined}
                className={cn(
                  "flex w-full items-center rounded-lg text-[13px] font-medium transition-all duration-200",
                  compact ? "justify-center px-0 py-2.5 mx-auto" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-primary/10 text-primary font-semibold shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon className={cn("shrink-0 transition-colors", compact ? "h-4.5 w-4.5" : "h-4 w-4")} />
                {!compact ? <span>{item.label}</span> : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Footer ── */}
      <div className={cn("border-t border-sidebar-border", compact ? "p-2" : "p-3")}>
        {!compact ? (
          <div className="rounded-xl bg-muted/30 p-3 space-y-2">
            <div>
              <p className="truncate text-sm font-medium text-foreground">{session.user.email}</p>
              <p className="text-[11px] text-muted-foreground font-medium">{roleLabel}</p>
            </div>
            <button
              onClick={onLogout}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs font-semibold text-red-500 dark:text-red-400 transition-all hover:bg-red-500/10 hover:border-red-500/30"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair da conta
            </button>
          </div>
        ) : (
          <div className="space-y-1.5 text-center">
            <button
              onClick={onLogout}
              title="Sair da conta"
              className="grid h-8 w-full place-items-center rounded-lg border border-red-500/20 bg-red-500/5 text-red-500 dark:text-red-400 transition-all hover:bg-red-500/10"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
