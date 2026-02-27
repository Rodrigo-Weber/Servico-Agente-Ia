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
    // Determine the appropriate label based on the booking sector
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
      { id: "settings", label: "Atendimento IA", icon: MessageSquare },
    ];
  }

  if (serviceType === "billing") {
    return [
      { id: "dashboard", label: "Visão Geral", icon: LayoutDashboard },
      { id: "collections", label: "Cobranças", icon: ReceiptText },
      { id: "crm", label: "CRM (Mensagens)", icon: MessageSquare },
      { id: "settings", label: "Configurações", icon: ShieldCheck },
    ]
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
      ? "Empresa Lava Jato"
      : bookingSector === "clinic"
        ? "Empresa Clinica"
        : "Empresa de Agendamento";
  const bookingRoleSubtitle =
    bookingSector === "car_wash"
      ? "Agente de agendamento para lava jato"
      : bookingSector === "clinic"
        ? "Agente de agendamento para clinica"
        : "Agente de agendamento";
  const roleLabel =
    session.user.role === "admin"
      ? "Administrador"
      : session.user.role === "barber"
        ? "Barbeiro"
        : session.user.serviceType === "barber_booking"
          ? bookingRoleLabel
          : session.user.serviceType === "billing"
            ? "Gestão de Cobranças"
            : "Empresa NF-e";
  const roleSubtitle =
    session.user.role === "admin"
      ? "Gestao central de agentes"
      : session.user.role === "barber"
        ? "Agenda pessoal"
        : session.user.serviceType === "barber_booking"
          ? bookingRoleSubtitle
          : session.user.serviceType === "billing"
            ? "Cobranças e CRM inteligente"
            : "Gestao inteligente de NF-e";
  const compact = collapsed && !mobile;

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-border/60 bg-background/80 backdrop-blur-3xl transition-[width] duration-300 ease-out shadow-[1px_0_40px_rgba(0,0,0,0.02)] z-50",
        compact ? "w-20" : "w-72",
        mobile ? "w-[86vw] max-w-[330px]" : "",
        className,
      )}
    >
      {/* ── Logo ── */}
      <div className={cn("border-b border-border flex h-16 items-center shrink-0", compact ? "px-3" : "px-5")}>
        <div className="flex w-full items-center justify-between gap-2">
          <div className={cn("flex items-center gap-3", compact ? "w-full justify-center" : "")}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105 duration-300">
              <span className="font-mono text-xs font-bold">RW</span>
            </div>
            {!compact ? (
              <div className="min-w-0">
                <p className="font-mono text-base font-bold leading-tight text-foreground tracking-tight">
                  {"<RW />"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{roleSubtitle}</p>
              </div>
            ) : null}
          </div>

          {mobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
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
                  "flex w-full items-center rounded-xl text-sm font-semibold transition-all duration-300",
                  compact ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(16,185,129,0.2)]"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
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
      <div className={cn("border-t border-border", compact ? "p-2" : "p-3")}>
        {!compact ? (
          <div className="rounded-xl bg-muted/30 p-3">
            <p className="truncate text-sm font-medium text-foreground">{session.user.email}</p>
            <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
            <button
              onClick={onLogout}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-red-500/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair da conta
            </button>
          </div>
        ) : (
          <div className="space-y-1 rounded-xl bg-muted/30 p-2 text-center">
            <p
              className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
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
