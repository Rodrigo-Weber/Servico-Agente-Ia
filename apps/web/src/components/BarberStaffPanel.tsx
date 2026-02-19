import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { CalendarDays, CheckCircle2, Clock3, RefreshCw, Scissors } from "lucide-react";
import { api } from "../api";
import { BarberAppointment, BarberService } from "../types";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";

interface BarberStaffPanelProps {
  token: string;
  activeView: string;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("pt-BR");
}

function formatMoney(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function statusVariant(status: BarberAppointment["status"]): "default" | "secondary" | "destructive" {
  if (status === "completed") return "default";
  if (status === "scheduled") return "secondary";
  return "destructive";
}

export function BarberStaffPanel({ token, activeView }: BarberStaffPanelProps) {
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [barberName, setBarberName] = useState("Barbeiro");
  const [services, setServices] = useState<BarberService[]>([]);
  const [appointments, setAppointments] = useState<BarberAppointment[]>([]);
  const [summary, setSummary] = useState<{
    services: number;
    appointmentsToday: number;
    upcomingScheduled: number;
  } | null>(null);

  const nextAppointments = useMemo(() => appointments.slice(0, 8), [appointments]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [me, dash, serviceList, appointmentList] = await Promise.all([
        api.getBarberMe(token),
        api.getBarberDashboardSummary(token),
        api.getBarberServices(token, { activeOnly: true }),
        api.getBarberAppointments(token, { limit: 80 }),
      ]);
      setBarberName(me.barberProfile?.name || "Barbeiro");
      setServices(serviceList);
      setAppointments(appointmentList);
      setSummary({
        services: dash.totals.services,
        appointmentsToday: dash.totals.appointmentsToday,
        upcomingScheduled: dash.totals.upcomingScheduled,
      });
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao carregar painel");
    } finally {
      setLoading(false);
    }
  }

  async function setAppointmentStatus(appointmentId: string, status: "completed" | "canceled") {
    setFeedback("");
    try {
      await api.updateBarberAppointment(token, appointmentId, { status });
      setFeedback(status === "completed" ? "Agendamento concluido." : "Agendamento cancelado.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao atualizar agendamento");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-8">
        <RefreshCw className="h-5 w-5 animate-spin text-green-400" />
        <span className="text-sm font-semibold text-muted-foreground">Carregando painel do barbeiro...</span>
      </div>
    );
  }

  if (activeView === "services") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Servicos disponiveis</CardTitle>
            <CardDescription>Catalogo habilitado para atendimento.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {services.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum servico ativo encontrado.</p> : null}
            {services.map((service) => (
              <div key={service.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">{service.name}</p>
                  <p className="text-xs text-muted-foreground">{service.durationMinutes} min</p>
                </div>
                <p className="text-sm font-semibold text-green-400">{formatMoney(service.price)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "appointments") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Minha agenda</CardTitle>
            <CardDescription>Atualize status dos atendimentos do dia.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {appointments.length === 0 ? <p className="text-sm text-muted-foreground">Sem agendamentos para este perfil.</p> : null}
            {appointments.map((appointment) => (
              <div key={appointment.id} className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{appointment.clientName}</p>
                    <p className="text-xs text-muted-foreground">{appointment.service?.name || "-"}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(appointment.startsAt)}</p>
                  </div>
                  <Badge variant={statusVariant(appointment.status)}>{appointment.status}</Badge>
                </div>
                {appointment.status === "scheduled" ? (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void setAppointmentStatus(appointment.id, "completed")}>
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Concluir
                    </Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => void setAppointmentStatus(appointment.id, "canceled")}>
                      Cancelar
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5">
        <p className="text-sm text-muted-foreground">Perfil do profissional</p>
        <h2 className="font-display text-2xl font-bold text-white">{barberName}</h2>
      </div>

      {summary ? (
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard icon={Scissors} label="Servicos" value={summary.services} />
          <StatCard icon={CalendarDays} label="Hoje" value={summary.appointmentsToday} />
          <StatCard icon={Clock3} label="Futuros" value={summary.upcomingScheduled} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Proximos atendimentos</CardTitle>
          <CardDescription>Resumo da agenda imediata.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {nextAppointments.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum agendamento encontrado.</p> : null}
          {nextAppointments.map((appointment) => (
            <div key={appointment.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
              <div>
                <p className="text-sm font-semibold">{appointment.clientName}</p>
                <p className="text-xs text-muted-foreground">{appointment.service?.name || "-"}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(appointment.startsAt)}</p>
              </div>
              <Badge variant={statusVariant(appointment.status)}>{appointment.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {feedback ? <FeedbackBox message={feedback} /> : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="h-full min-h-[108px] border-white/5 bg-gradient-to-b from-white/[0.08] to-transparent transition-all hover:border-green-500/20 hover:bg-white/[0.03]">
      <CardContent className="grid h-full grid-cols-[auto_minmax(0,1fr)] items-center gap-4 p-4 sm:p-5">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-green-500/15 text-green-400 ring-1 ring-inset ring-green-500/20">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">{label}</p>
          <p className="mt-1 truncate font-display text-3xl font-bold leading-none text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackBox({ message }: { message: string }) {
  return <div className="rounded-xl border border-green-500/25 bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-400">{message}</div>;
}
