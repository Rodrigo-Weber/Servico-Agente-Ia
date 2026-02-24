import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Save,
  Scissors,
  Stethoscope,
  CarFront,
  Trash2,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import { api } from "../api";
import { BarberAppointment, BarberAppointmentStatus, BarberProfile, BarberService } from "../types";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";
import { SkeletonDashboard } from "./ui/Skeleton";
import { cn } from "../lib/utils";

interface BarberOwnerPanelProps {
  token: string;
  activeView: string;
}

interface HourDraft {
  weekday: number;
  active: boolean;
  startTime: string;
  endTime: string;
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const HOUR_ROW_HEIGHT = 64;
const DAY_START_MINUTES = DAY_START_HOUR * 60;
const DAY_END_MINUTES = (DAY_END_HOUR + 1) * 60;
const DAY_TIMELINE_HEIGHT = ((DAY_END_MINUTES - DAY_START_MINUTES) / 60) * HOUR_ROW_HEIGHT;

interface DayAppointmentLayout {
  appointment: BarberAppointment;
  top: number;
  height: number;
}

function toInputDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseInputDate(value: string): Date | null {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!year || !month || !day) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shiftInputDate(value: string, days: number): string {
  const current = parseInputDate(value);
  if (!current) {
    return toInputDateValue(new Date());
  }

  const shifted = new Date(current);
  shifted.setDate(shifted.getDate() + days);
  return toInputDateValue(shifted);
}

function getInputDateRangeIso(value: string): { from: string; to: string } {
  const parsed = parseInputDate(value) ?? new Date();
  const start = new Date(parsed);
  start.setHours(0, 0, 0, 0);
  const end = new Date(parsed);
  end.setHours(23, 59, 59, 999);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function formatInputDateLabel(value: string): string {
  const parsed = parseInputDate(value);
  if (!parsed) {
    return "-";
  }

  return parsed.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeRange(appointment: BarberAppointment): string {
  return `${formatTime(appointment.startsAt)} - ${formatTime(appointment.endsAt)}`;
}

function formatAppointmentStatus(status: BarberAppointment["status"]): string {
  if (status === "scheduled") {
    return "Agendado";
  }
  if (status === "completed") {
    return "Concluido";
  }
  return "Cancelado";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function buildDayAppointmentLayout(appointments: BarberAppointment[]): DayAppointmentLayout[] {
  return [...appointments]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .map((appointment) => {
      const startsAt = new Date(appointment.startsAt);
      const endsAt = new Date(appointment.endsAt);
      const startsAtMinutes = Number.isNaN(startsAt.getTime()) ? DAY_START_MINUTES : minutesSinceMidnight(startsAt);
      const endsAtMinutes = Number.isNaN(endsAt.getTime())
        ? startsAtMinutes + 30
        : Math.max(minutesSinceMidnight(endsAt), startsAtMinutes + 15);

      const clampedStart = clamp(startsAtMinutes, DAY_START_MINUTES, DAY_END_MINUTES - 15);
      const clampedEnd = clamp(endsAtMinutes, clampedStart + 15, DAY_END_MINUTES);
      const rawTop = ((clampedStart - DAY_START_MINUTES) / 60) * HOUR_ROW_HEIGHT;
      const top = Math.min(rawTop, Math.max(DAY_TIMELINE_HEIGHT - 52, 0));
      const rawHeight = ((clampedEnd - clampedStart) / 60) * HOUR_ROW_HEIGHT;
      const height = Math.max(Math.min(rawHeight, DAY_TIMELINE_HEIGHT - top), 52);

      return {
        appointment,
        top,
        height,
      };
    });
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim();
  if (!normalized || normalized === "[object Object]") {
    return "unknown";
  }

  return normalized;
}

function normalizeQrForDisplay(qr: string): string {
  if (qr.startsWith("data:image")) {
    return qr;
  }

  const compact = qr.replace(/\s/g, "");
  if (compact.length > 120 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    return `data:image/png;base64,${compact}`;
  }

  return qr;
}

function getStatusTone(status: string): { text: string; badge: "default" | "secondary" | "destructive" | "outline" } {
  const normalized = status.toLowerCase();
  if (normalized.includes("open") || normalized.includes("connected")) {
    return { text: "Conectado", badge: "default" };
  }

  if (normalized.includes("qrcode") || normalized.includes("connect") || normalized.includes("init")) {
    return { text: "Aguardando conexao", badge: "secondary" };
  }

  return { text: "Offline", badge: "destructive" };
}

function createDefaultHoursDraft(): HourDraft[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    active: weekday >= 1 && weekday <= 6,
    startTime: "09:00",
    endTime: "18:00",
  }));
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("pt-BR");
}

function statusVariant(status: BarberAppointment["status"]): "default" | "secondary" | "destructive" {
  if (status === "completed") {
    return "default";
  }
  if (status === "scheduled") {
    return "secondary";
  }
  return "destructive";
}

export function BarberOwnerPanel({ token, activeView }: BarberOwnerPanelProps) {
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [companyName, setCompanyName] = useState("Empresa");
  const [bookingSector, setBookingSector] = useState<"barber" | "clinic" | "car_wash" | "generic">("barber");

  const isPersonResource = bookingSector === "barber" || bookingSector === "clinic";
  const labelResource = bookingSector === "car_wash" ? "Box/Vaga" : bookingSector === "clinic" ? "Profissional" : bookingSector === "generic" ? "Recurso" : "Barbeiro";
  const labelResources = bookingSector === "car_wash" ? "Boxes/Vagas" : bookingSector === "clinic" ? "Profissionais" : bookingSector === "generic" ? "Recursos" : "Barbeiros";

  let iconService = Scissors;
  if (bookingSector === "car_wash") iconService = CarFront;
  if (bookingSector === "clinic") iconService = Stethoscope;

  const [summary, setSummary] = useState<{
    barbers: number;
    services: number;
    appointmentsToday: number;
    upcomingScheduled: number;
  } | null>(null);
  const [barbers, setBarbers] = useState<BarberProfile[]>([]);
  const [services, setServices] = useState<BarberService[]>([]);
  const [appointments, setAppointments] = useState<BarberAppointment[]>([]);
  const [dayAppointments, setDayAppointments] = useState<BarberAppointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => toInputDateValue(new Date()));
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [loadingDayAppointments, setLoadingDayAppointments] = useState(false);

  const [barberDrafts, setBarberDrafts] = useState<Record<string, { name: string; email: string; phone: string; active: boolean }>>({});
  const [serviceDrafts, setServiceDrafts] = useState<
    Record<string, { name: string; durationMinutes: number; price: string; barberId: string; active: boolean }>
  >({});

  const [newBarber, setNewBarber] = useState({ name: "", email: "", phone: "", active: true });
  const [newService, setNewService] = useState({ name: "", durationMinutes: 45, price: "50", barberId: "", active: true });
  const [newAppointment, setNewAppointment] = useState({
    barberId: "",
    serviceId: "",
    clientName: "",
    clientPhone: "",
    startsAt: "",
  });

  const [selectedBarberId, setSelectedBarberId] = useState("");
  const [hoursDraft, setHoursDraft] = useState<HourDraft[]>(createDefaultHoursDraft);
  const [waStatus, setWaStatus] = useState("unknown");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingWhatsappAction, setLoadingWhatsappAction] = useState(false);
  const [dayStatusFilter, setDayStatusFilter] = useState<"all" | BarberAppointmentStatus>("all");

  const filteredDayAppointments = useMemo(() => {
    if (dayStatusFilter === "all") return dayAppointments;
    return dayAppointments.filter((a) => a.status === dayStatusFilter);
  }, [dayAppointments, dayStatusFilter]);

  const dayStatusCounts = useMemo(() => {
    const counts = { scheduled: 0, completed: 0, canceled: 0 };
    for (const a of dayAppointments) {
      if (a.status in counts) counts[a.status as keyof typeof counts]++;
    }
    return counts;
  }, [dayAppointments]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (barbers.length === 0) {
      setSelectedBarberId("");
      return;
    }
    if (!selectedBarberId || !barbers.some((barber) => barber.id === selectedBarberId)) {
      setSelectedBarberId(barbers[0].id);
    }
  }, [barbers, selectedBarberId]);

  useEffect(() => {
    if (!selectedBarberId) {
      setHoursDraft(createDefaultHoursDraft());
      return;
    }
    void loadWorkingHours(selectedBarberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBarberId]);

  useEffect(() => {
    void loadAppointmentsForDate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (dayAppointments.length === 0) {
      setSelectedAppointmentId(null);
      return;
    }

    if (!selectedAppointmentId || !dayAppointments.some((appointment) => appointment.id === selectedAppointmentId)) {
      setSelectedAppointmentId(dayAppointments[0].id);
    }
  }, [dayAppointments, selectedAppointmentId]);

  const nextAppointments = useMemo(() => appointments.slice(0, 8), [appointments]);
  const statusTone = useMemo(() => getStatusTone(waStatus), [waStatus]);
  const isWhatsappConnected = useMemo(() => {
    const normalized = waStatus.toLowerCase();
    return normalized.includes("open") || normalized.includes("connected");
  }, [waStatus]);
  const dayAppointmentsLayout = useMemo(() => buildDayAppointmentLayout(filteredDayAppointments), [filteredDayAppointments]);
  const selectedDayAppointment = useMemo(
    () => filteredDayAppointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null,
    [filteredDayAppointments, selectedAppointmentId],
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [me, dash, barberList, serviceList, appointmentList, sessionData] = await Promise.all([
        api.getBarberMe(token),
        api.getBarberDashboardSummary(token),
        api.getBarbers(token),
        api.getBarberServices(token),
        api.getBarberAppointments(token, { limit: 80 }),
        api.getBarberWhatsappSession(token).catch(() => null),
      ]);

      setCompanyName(me.company?.name || "Empresa");
      setBookingSector(me.company?.bookingSector || "barber");
      setSummary(dash.totals);
      setBarbers(barberList);
      setServices(serviceList);
      setAppointments(appointmentList);
      setWaStatus(normalizeStatus(sessionData?.session?.status || "unknown"));

      setBarberDrafts(
        barberList.reduce<Record<string, { name: string; email: string; phone: string; active: boolean }>>((acc, barber) => {
          acc[barber.id] = {
            name: barber.name,
            email: barber.email || "",
            phone: barber.phoneE164 || "",
            active: barber.active,
          };
          return acc;
        }, {}),
      );

      setServiceDrafts(
        serviceList.reduce<Record<string, { name: string; durationMinutes: number; price: string; barberId: string; active: boolean }>>((acc, service) => {
          acc[service.id] = {
            name: service.name,
            durationMinutes: service.durationMinutes,
            price: String(service.price),
            barberId: service.barberId || "",
            active: service.active,
          };
          return acc;
        }, {}),
      );

      void loadAppointmentsForDate(selectedDate);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao carregar painel da barbearia");
    } finally {
      setLoading(false);
    }
  }

  async function loadAppointmentsForDate(dateInput: string) {
    setLoadingDayAppointments(true);
    try {
      const range = getInputDateRangeIso(dateInput);
      const agenda = await api.getBarberAppointments(token, {
        from: range.from,
        to: range.to,
        limit: 200,
      });
      setDayAppointments(agenda);
    } catch (err) {
      setDayAppointments([]);
      setFeedback(err instanceof Error ? err.message : "Falha ao carregar agenda do dia");
    } finally {
      setLoadingDayAppointments(false);
    }
  }

  async function loadWorkingHours(barberId: string) {
    try {
      const hours = await api.getBarberWorkingHours(token, barberId);
      const draft = createDefaultHoursDraft();
      for (const item of hours) {
        const target = draft[item.weekday];
        if (target) {
          target.active = item.active;
          target.startTime = item.startTime;
          target.endTime = item.endTime;
        }
      }
      setHoursDraft(draft);
    } catch {
      setHoursDraft(createDefaultHoursDraft());
    }
  }

  async function handleConnectWhatsappSession() {
    setFeedback("");
    setLoadingWhatsappAction(true);
    try {
      const result = await api.startBarberWhatsappSession(token);
      const status = normalizeStatus(result.status);
      setWaStatus(status);

      if (result.qr) {
        setQrCode(normalizeQrForDisplay(result.qr));
      } else if (status.toLowerCase().includes("open") || status.toLowerCase().includes("connected")) {
        setQrCode(null);
      }

      setFeedback(result.message || "Fluxo de conexao iniciado.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao conectar WhatsApp");
    } finally {
      setLoadingWhatsappAction(false);
    }
  }

  async function handleDisconnectWhatsappSession() {
    const confirm = window.confirm("Deseja desconectar o WhatsApp da empresa agora?");
    if (!confirm) {
      return;
    }

    setFeedback("");
    setLoadingWhatsappAction(true);
    try {
      const result = await api.disconnectBarberWhatsappSession(token);
      const status = normalizeStatus(result.status);
      setWaStatus(status);
      if (!status.toLowerCase().includes("open") && !status.toLowerCase().includes("connected")) {
        setQrCode(null);
      }
      setFeedback(result.message || "Sessao desconectada.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao desconectar sessao");
    } finally {
      setLoadingWhatsappAction(false);
    }
  }

  async function handleRefreshWhatsappSession() {
    setFeedback("");
    setLoadingWhatsappAction(true);
    try {
      const [sessionData, qrData] = await Promise.all([
        api.getBarberWhatsappSession(token),
        api.getBarberWhatsappQr(token).catch(() => null),
      ]);

      const status = normalizeStatus(qrData?.status || sessionData.session.status);
      setWaStatus(status);
      if (qrData?.qr) {
        setQrCode(normalizeQrForDisplay(qrData.qr));
        setFeedback("QR code atualizado.");
      } else {
        setQrCode(null);
        setFeedback(qrData?.message || "Status atualizado.");
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao atualizar status do WhatsApp");
    } finally {
      setLoadingWhatsappAction(false);
    }
  }

  async function submitNewBarber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    try {
      const payload: { name: string; email?: string; phone?: string; active: boolean } = {
        name: newBarber.name.trim(),
        active: newBarber.active,
      };

      const email = newBarber.email.trim();
      const phone = newBarber.phone.trim();
      if (email) {
        payload.email = email;
      }
      if (phone) {
        payload.phone = phone;
      }

      await api.createBarber(token, payload);
      setNewBarber({ name: "", email: "", phone: "", active: true });
      setFeedback("Barbeiro criado com sucesso.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao criar barbeiro");
    }
  }

  async function saveBarber(barberId: string) {
    const draft = barberDrafts[barberId];
    if (!draft) return;
    setFeedback("");
    try {
      await api.updateBarber(token, barberId, {
        name: draft.name,
        email: draft.email || null,
        phone: draft.phone || null,
        active: draft.active,
      });
      setFeedback("Barbeiro atualizado.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao atualizar barbeiro");
    }
  }

  async function removeBarber(barberId: string) {
    if (!window.confirm("Deseja realmente desativar este barbeiro?")) return;
    setFeedback("");
    try {
      await api.deleteBarber(token, barberId);
      setFeedback("Barbeiro removido.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao remover barbeiro");
    }
  }

  async function saveHours() {
    if (!selectedBarberId) return;
    setFeedback("");
    try {
      await api.updateBarberWorkingHours(token, selectedBarberId, {
        hours: hoursDraft.filter((entry) => entry.active).map((entry) => ({ ...entry, active: true })),
      });
      setFeedback("Horarios atualizados.");
      await loadWorkingHours(selectedBarberId);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao salvar horarios");
    }
  }

  async function submitNewService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    try {
      await api.createBarberService(token, {
        name: newService.name,
        durationMinutes: Number(newService.durationMinutes),
        price: Number(newService.price.replace(",", ".")),
        barberId: newService.barberId || null,
        active: newService.active,
      });
      setNewService({ name: "", durationMinutes: 45, price: "50", barberId: "", active: true });
      setFeedback("Servico criado.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao criar servico");
    }
  }

  async function saveService(serviceId: string) {
    const draft = serviceDrafts[serviceId];
    if (!draft) return;
    setFeedback("");
    try {
      await api.updateBarberService(token, serviceId, {
        name: draft.name,
        durationMinutes: Number(draft.durationMinutes),
        price: Number(String(draft.price).replace(",", ".")),
        barberId: draft.barberId || null,
        active: draft.active,
      });
      setFeedback("Servico atualizado.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao atualizar servico");
    }
  }

  async function removeService(serviceId: string) {
    if (!window.confirm("Deseja realmente desativar este servico?")) return;
    setFeedback("");
    try {
      await api.deleteBarberService(token, serviceId);
      setFeedback("Servico removido.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao remover servico");
    }
  }

  async function submitNewAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    try {
      const created = await api.createBarberAppointment(token, {
        barberId: newAppointment.barberId,
        serviceId: newAppointment.serviceId,
        clientName: newAppointment.clientName,
        clientPhone: newAppointment.clientPhone,
        startsAt: new Date(newAppointment.startsAt).toISOString(),
      });
      const appointmentDate = toInputDateValue(new Date(created.startsAt));
      setSelectedDate(appointmentDate);
      setSelectedAppointmentId(created.id);
      setNewAppointment({ barberId: "", serviceId: "", clientName: "", clientPhone: "", startsAt: "" });
      setFeedback("Agendamento criado.");
      await Promise.all([loadAll(), loadAppointmentsForDate(appointmentDate)]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao criar agendamento");
    }
  }

  async function setAppointmentStatus(appointmentId: string, status: "completed" | "canceled") {
    setFeedback("");
    try {
      await api.updateBarberAppointment(token, appointmentId, { status });
      setFeedback(status === "completed" ? "Agendamento concluido." : "Agendamento cancelado.");
      await Promise.all([loadAll(), loadAppointmentsForDate(selectedDate)]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao atualizar agendamento");
    }
  }

  if (loading) {
    return <SkeletonDashboard />;
  }

  if (activeView === "barbers") {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader>
              <CardTitle>Novo(a) {labelResource.toLowerCase()}</CardTitle>
              <CardDescription>Cadastre {labelResources.toLowerCase()} para montar a agenda.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitNewBarber} className="space-y-3">
                <Input placeholder={`Nome do(a) ${labelResource.toLowerCase()}`} value={newBarber.name} onChange={(e) => setNewBarber((prev) => ({ ...prev, name: e.target.value }))} required />
                {isPersonResource && (
                  <>
                    <Input placeholder="Email (opcional)" value={newBarber.email} onChange={(e) => setNewBarber((prev) => ({ ...prev, email: e.target.value }))} />
                    <Input placeholder="Telefone (opcional)" value={newBarber.phone} onChange={(e) => setNewBarber((prev) => ({ ...prev, phone: e.target.value }))} />
                  </>
                )}
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={newBarber.active}
                    onChange={(e) => setNewBarber((prev) => ({ ...prev, active: e.target.checked }))}
                  />
                  Perfil ativo
                </label>
                <Button type="submit" className="w-full">
                  <UserRound className="mr-1.5 h-4 w-4" />
                  Cadastrar {labelResource.toLowerCase()}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{labelResources} cadastrados(as)</CardTitle>
              <CardDescription>Edite nome, contato e status de cada {labelResource.toLowerCase()}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {barbers.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum(a) {labelResource.toLowerCase()} cadastrado(a).</p> : null}
              {barbers.map((barber) => {
                const draft = barberDrafts[barber.id];
                if (!draft) return null;

                return (
                  <div key={barber.id} className="rounded-xl border border-border bg-muted/50 p-3">
                    <div className="grid gap-2 md:grid-cols-3">
                      <Input
                        placeholder="Nome"
                        value={draft.name}
                        onChange={(e) =>
                          setBarberDrafts((prev) => ({ ...prev, [barber.id]: { ...draft, name: e.target.value } }))
                        }
                      />
                      {isPersonResource && (
                        <>
                          <Input
                            placeholder="Email"
                            value={draft.email}
                            onChange={(e) =>
                              setBarberDrafts((prev) => ({ ...prev, [barber.id]: { ...draft, email: e.target.value } }))
                            }
                          />
                          <Input
                            placeholder="Telefone"
                            value={draft.phone}
                            onChange={(e) =>
                              setBarberDrafts((prev) => ({ ...prev, [barber.id]: { ...draft, phone: e.target.value } }))
                            }
                          />
                        </>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={draft.active}
                          onChange={(e) =>
                            setBarberDrafts((prev) => ({ ...prev, [barber.id]: { ...draft, active: e.target.checked } }))
                          }
                        />
                        ativo
                      </label>
                      <Badge variant={barber.id === selectedBarberId ? "default" : "outline"}>horarios</Badge>
                      <Button type="button" size="sm" variant="outline" onClick={() => setSelectedBarberId(barber.id)}>
                        Selecionar
                      </Button>
                      <Button type="button" size="sm" onClick={() => void saveBarber(barber.id)}>
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => void removeBarber(barber.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Grade de horarios</CardTitle>
            <CardDescription>Defina horario de atendimento do(a) {labelResource.toLowerCase()} selecionado(a).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!selectedBarberId ? <p className="text-sm text-muted-foreground">Selecione um(a) {labelResource.toLowerCase()} para editar os horarios.</p> : null}
            {selectedBarberId ? (
              <>
                {hoursDraft.map((entry) => (
                  <div key={entry.weekday} className="grid items-center gap-2 rounded-xl border border-border bg-muted/50 p-2 grid-cols-2 lg:grid-cols-[90px_1fr_1fr_auto]">
                    <span className="col-span-2 text-sm font-semibold lg:col-span-1">{WEEKDAY_LABELS[entry.weekday]}</span>
                    <Input
                      type="time"
                      value={entry.startTime}
                      disabled={!entry.active}
                      onChange={(e) =>
                        setHoursDraft((prev) =>
                          prev.map((item) => (item.weekday === entry.weekday ? { ...item, startTime: e.target.value } : item)),
                        )
                      }
                    />
                    <Input
                      type="time"
                      value={entry.endTime}
                      disabled={!entry.active}
                      onChange={(e) =>
                        setHoursDraft((prev) =>
                          prev.map((item) => (item.weekday === entry.weekday ? { ...item, endTime: e.target.value } : item)),
                        )
                      }
                    />
                    <label className="col-span-2 flex items-center justify-end gap-2 text-xs text-muted-foreground lg:col-span-1">
                      <input
                        type="checkbox"
                        checked={entry.active}
                        onChange={(e) =>
                          setHoursDraft((prev) =>
                            prev.map((item) => (item.weekday === entry.weekday ? { ...item, active: e.target.checked } : item)),
                          )
                        }
                      />
                      ativo
                    </label>
                  </div>
                ))}
                <Button type="button" onClick={() => void saveHours()}>
                  <Save className="mr-1.5 h-4 w-4" />
                  Salvar horarios
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "services") {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader>
              <CardTitle>Novo servico</CardTitle>
              <CardDescription>Defina valor, duracao e {labelResource.toLowerCase()} responsavel.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitNewService} className="space-y-3">
                <Input placeholder="Nome do servico" value={newService.name} onChange={(e) => setNewService((prev) => ({ ...prev, name: e.target.value }))} required />
                <div className="grid gap-2 md:grid-cols-2">
                  <Input
                    type="number"
                    min={5}
                    placeholder="Duracao (min)"
                    value={newService.durationMinutes}
                    onChange={(e) => setNewService((prev) => ({ ...prev, durationMinutes: Number(e.target.value) }))}
                    required
                  />
                  <Input placeholder="Preco" value={newService.price} onChange={(e) => setNewService((prev) => ({ ...prev, price: e.target.value }))} required />
                </div>
                <select
                  className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                  value={newService.barberId}
                  onChange={(e) => setNewService((prev) => ({ ...prev, barberId: e.target.value }))}
                >
                  <option value="">Todos(as) os(as) {labelResources.toLowerCase()}</option>
                  {barbers.map((barber) => (
                    <option key={barber.id} value={barber.id}>
                      {barber.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" className="w-full">
                  <Scissors className="mr-1.5 h-4 w-4" />
                  Criar servico
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Catalogo de servicos</CardTitle>
              <CardDescription>Atualize rapidamente nome, valor, duracao e status.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {services.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum servico cadastrado.</p> : null}
              {services.map((service) => {
                const draft = serviceDrafts[service.id];
                if (!draft) return null;

                return (
                  <div key={service.id} className="rounded-xl border border-border bg-muted/50 p-3">
                    <Input
                      value={draft.name}
                      onChange={(e) => setServiceDrafts((prev) => ({ ...prev, [service.id]: { ...draft, name: e.target.value } }))}
                    />
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <Input
                        type="number"
                        min={5}
                        value={draft.durationMinutes}
                        onChange={(e) =>
                          setServiceDrafts((prev) => ({ ...prev, [service.id]: { ...draft, durationMinutes: Number(e.target.value) } }))
                        }
                      />
                      <Input
                        value={draft.price}
                        onChange={(e) => setServiceDrafts((prev) => ({ ...prev, [service.id]: { ...draft, price: e.target.value } }))}
                      />
                      <select
                        className="h-10 rounded-xl border border-input bg-background/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                        value={draft.barberId}
                        onChange={(e) =>
                          setServiceDrafts((prev) => ({ ...prev, [service.id]: { ...draft, barberId: e.target.value } }))
                        }
                      >
                        <option value="">Todos(as) os(as) {labelResources.toLowerCase()}</option>
                        {barbers.map((barber) => (
                          <option key={barber.id} value={barber.id}>
                            {barber.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={draft.active}
                          onChange={(e) =>
                            setServiceDrafts((prev) => ({ ...prev, [service.id]: { ...draft, active: e.target.checked } }))
                          }
                        />
                        ativo
                      </label>
                      <Button type="button" size="sm" onClick={() => void saveService(service.id)}>
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => void removeService(service.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "appointments") {
    const timelineHours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 2 }, (_, index) => DAY_START_HOUR + index);

    return (
      <div className="space-y-6">
        <Card className="rounded-xl border border-border bg-card">
          <CardHeader className="pb-4">
            <CardTitle>Novo agendamento</CardTitle>
            <CardDescription className="hidden sm:block">Cadastre atendimentos de forma rapida.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitNewAppointment} className="grid items-end gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
              <div className="space-y-1.5 lg:col-span-1">
                <Input placeholder="Nome" value={newAppointment.clientName} onChange={(e) => setNewAppointment((prev) => ({ ...prev, clientName: e.target.value }))} required />
              </div>
              <div className="space-y-1.5 lg:col-span-1">
                <Input placeholder="Telefone" value={newAppointment.clientPhone} onChange={(e) => setNewAppointment((prev) => ({ ...prev, clientPhone: e.target.value }))} required />
              </div>
              <div className="space-y-1.5 lg:col-span-1">
                <select
                  className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                  value={newAppointment.serviceId}
                  onChange={(e) => setNewAppointment((prev) => ({ ...prev, serviceId: e.target.value }))}
                  required
                >
                  <option value="">Servico</option>
                  {services.filter((service) => service.active).map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 lg:col-span-1">
                <select
                  className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                  value={newAppointment.barberId}
                  onChange={(e) => setNewAppointment((prev) => ({ ...prev, barberId: e.target.value }))}
                  required
                >
                  <option value="">{labelResource}</option>
                  {barbers.filter((barber) => barber.active).map((barber) => (
                    <option key={barber.id} value={barber.id}>
                      {barber.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 lg:col-span-1">
                <Input
                  type="datetime-local"
                  value={newAppointment.startsAt}
                  onChange={(e) => setNewAppointment((prev) => ({ ...prev, startsAt: e.target.value }))}
                  required
                />
              </div>
              <div className="lg:col-span-1">
                <Button type="submit" className="w-full">
                  <CalendarDays className="mr-1.5 h-4 w-4 hidden lg:inline-block" />
                  Salvar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-xl border border-border bg-card">
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Agenda do dia</CardTitle>
                <CardDescription>Visao ampla dos agendamentos com detalhes por clique.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="icon" variant="outline" onClick={() => setSelectedDate((prev) => shiftInputDate(prev, -1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="w-[170px]" />
                <Button type="button" size="icon" variant="outline" onClick={() => setSelectedDate((prev) => shiftInputDate(prev, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" onClick={() => void loadAppointmentsForDate(selectedDate)}>
                  <RefreshCw className={`h-4 w-4 ${loadingDayAppointments ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-semibold capitalize text-foreground">{formatInputDateLabel(selectedDate)}</span>
              {" | "}
              {dayAppointments.length} agendamento(s) no dia
            </div>

            {/* Tabs de status */}
            <div className="flex flex-wrap gap-1.5">
              {(["all", "scheduled", "completed", "canceled"] as const).map((status) => {
                const labels: Record<typeof status, string> = {
                  all: "Todos",
                  scheduled: "Agendados",
                  completed: "Concluídos",
                  canceled: "Cancelados",
                };
                const count = status === "all"
                  ? dayAppointments.length
                  : dayStatusCounts[status];
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setDayStatusFilter(status)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                      dayStatusFilter === status
                        ? "bg-green-500/15 text-green-400"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    {labels[status]}
                    <span className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                      dayStatusFilter === status ? "bg-green-500/20 text-green-400" : "bg-muted/50 text-muted-foreground",
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-xl border border-border bg-muted/50 p-3">
                <div className="relative min-h-[620px] overflow-x-auto">
                  <div className="relative min-w-[340px] sm:min-w-[480px] md:min-w-full" style={{ height: `${DAY_TIMELINE_HEIGHT}px` }}>
                    {timelineHours.map((hour, index) => (
                      <div key={hour} className="absolute left-0 right-0 border-t border-border" style={{ top: `${index * HOUR_ROW_HEIGHT}px` }}>
                        <span className="absolute left-1 top-0 -translate-y-1/2 rounded bg-background px-1 text-[11px] font-semibold text-muted-foreground">
                          {`${String(hour).padStart(2, "0")}:00`}
                        </span>
                      </div>
                    ))}

                    {dayAppointmentsLayout.map((item) => {
                      const isSelected = item.appointment.id === selectedAppointmentId;
                      const toneClass =
                        item.appointment.status === "completed"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : item.appointment.status === "canceled"
                            ? "border-rose-200 bg-rose-50 text-rose-900"
                            : "border-primary/35 bg-primary/10 text-primary";

                      return (
                        <button
                          key={item.appointment.id}
                          type="button"
                          onClick={() => setSelectedAppointmentId(item.appointment.id)}
                          className={`absolute left-[72px] right-2 rounded-xl border px-3 py-2 text-left transition ${toneClass} ${isSelected ? "ring-2 ring-primary/45 shadow-sm" : "hover:shadow-sm"
                            }`}
                          style={{ top: `${item.top}px`, height: `${item.height}px` }}
                        >
                          <p className="text-sm font-semibold leading-snug">{item.appointment.clientName}</p>
                          <p className="text-xs font-semibold">{formatTimeRange(item.appointment)}</p>
                          <p className="mt-1 text-xs opacity-90">
                            {item.appointment.service?.name || "-"} | {item.appointment.barber?.name || "-"}
                          </p>
                        </button>
                      );
                    })}

                    {!loadingDayAppointments && dayAppointmentsLayout.length === 0 ? (
                      <div className="absolute inset-0 grid place-items-center pl-16 pr-3">
                        <p className="rounded-xl border border-dashed border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                          Nenhum agendamento para este dia.
                        </p>
                      </div>
                    ) : null}

                    {loadingDayAppointments ? (
                      <div className="absolute inset-0 grid place-items-center bg-card/80">
                        <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-muted-foreground">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Atualizando agenda...
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {selectedDayAppointment ? (
                  <div className="rounded-xl border border-border bg-muted/50 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detalhes</p>
                        <h4 className="text-base font-bold">{selectedDayAppointment.clientName}</h4>
                      </div>
                      <Badge variant={statusVariant(selectedDayAppointment.status)}>
                        {formatAppointmentStatus(selectedDayAppointment.status)}
                      </Badge>
                    </div>

                    <div className="mt-3 space-y-2 text-sm">
                      <p className="flex items-center gap-2 text-muted-foreground">
                        <CalendarClock className="h-4 w-4" />
                        <span className="font-semibold text-foreground">{formatTimeRange(selectedDayAppointment)}</span>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Telefone:</span> {selectedDayAppointment.clientPhone}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Servico:</span> {selectedDayAppointment.service?.name || "-"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">{labelResource}:</span> {selectedDayAppointment.barber?.name || "-"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Criado em:</span> {formatDateTime(selectedDayAppointment.createdAt)}
                      </p>
                      {selectedDayAppointment.notes ? (
                        <div className="rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                          {selectedDayAppointment.notes}
                        </div>
                      ) : null}
                    </div>

                    {selectedDayAppointment.status === "scheduled" ? (
                      <div className="mt-4 grid gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void setAppointmentStatus(selectedDayAppointment.id, "completed")}
                        >
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          Marcar como concluido
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => void setAppointmentStatus(selectedDayAppointment.id, "canceled")}
                        >
                          Cancelar agendamento
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/50 px-4 py-8 text-center text-sm text-muted-foreground">
                    Clique em um agendamento para ver os detalhes.
                  </div>
                )}

                {dayAppointments.length > 0 ? (
                  <div className="rounded-xl border border-border bg-muted/50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lista rapida</p>
                    <div className="mt-2 space-y-2">
                      {dayAppointments.map((appointment) => (
                        <button
                          key={appointment.id}
                          type="button"
                          onClick={() => setSelectedAppointmentId(appointment.id)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${appointment.id === selectedAppointmentId
                            ? "border-primary/40 bg-primary/10"
                            : "border-border bg-background hover:border-primary/25"
                            }`}
                        >
                          <p className="font-semibold">{formatTime(appointment.startsAt)} - {appointment.clientName}</p>
                          <p className="text-xs text-muted-foreground">{appointment.service?.name || "-"}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "settings") {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp da empresa</CardTitle>
              <CardDescription>
                Fluxo recomendado: conectar, escanear QR quando aparecer e desconectar quando precisar trocar de aparelho.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status da sessao</p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant={statusTone.badge}>{statusTone.text}</Badge>
                  <span className="text-xs text-muted-foreground">{waStatus}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={isWhatsappConnected ? "destructive" : "default"}
                  onClick={() => void (isWhatsappConnected ? handleDisconnectWhatsappSession() : handleConnectWhatsappSession())}
                  disabled={loadingWhatsappAction}
                >
                  {loadingWhatsappAction
                    ? "Processando..."
                    : isWhatsappConnected
                      ? "Desconectar WhatsApp"
                      : "Conectar WhatsApp"}
                </Button>
                <Button type="button" variant="outline" onClick={() => void handleRefreshWhatsappSession()} disabled={loadingWhatsappAction}>
                  Atualizar status/QR
                </Button>
                <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loadingWhatsappAction}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {isWhatsappConnected
                  ? "Sessao ativa. Desconecte apenas quando quiser trocar o aparelho conectado."
                  : qrCode
                    ? "QR code pronto. Escaneie no WhatsApp Business para concluir."
                    : "Clique em Conectar WhatsApp para iniciar e gerar QR code."}
              </p>

              <p className="text-xs text-muted-foreground">
                Se aparecer "Instancia WhatsApp nao configurada", solicite ao admin preencher a instancia na edicao da empresa.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>QR code</CardTitle>
              <CardDescription>Escaneie com o WhatsApp Business do estabelecimento.</CardDescription>
            </CardHeader>
            <CardContent>
              {qrCode ? (
                <div className="rounded-xl border border-border bg-muted/50 p-3">
                  <img src={qrCode} alt="QR code WhatsApp" className="mx-auto w-full max-w-[320px] rounded-md border border-border bg-white p-2" />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/50 px-3 py-8 text-center text-sm text-muted-foreground">
                  QR code indisponivel no momento.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Atendimento por IA</CardTitle>
            <CardDescription>Instrucoes rapidas para o agente de agendamento no WhatsApp.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>O agente entende comandos como: servicos, agenda, agendar e cancelar agendamento.</p>
            <p>Exemplo para cliente: agendar corte masculino 20/02/2026 14:30.</p>
            <p>Se o cliente enviar horario fora da grade, a IA solicita um novo horario automaticamente.</p>
          </CardContent>
        </Card>
        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-muted/50 p-5">
        <p className="text-sm text-muted-foreground">Operacao da empresa</p>
        <h2 className="font-display text-2xl font-bold">{companyName}</h2>
      </div>

      {summary ? (
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={UsersRound} label={labelResources} value={summary.barbers} />
          <StatCard icon={iconService} label="Servicos" value={summary.services} />
          <StatCard icon={CalendarDays} label="Hoje" value={summary.appointmentsToday} />
          <StatCard icon={Clock3} label="Futuros" value={summary.upcomingScheduled} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Proximos agendamentos</CardTitle>
          <CardDescription>Visao rapida dos atendimentos planejados.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {nextAppointments.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum agendamento encontrado.</p> : null}
          {nextAppointments.map((appointment) => (
            <div key={appointment.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/50 px-3 py-2">
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
  const valueIsNumeric = typeof value === "number";

  return (
    <Card className="h-full min-h-[108px] border-border bg-card transition-all hover:border-primary/25 hover:bg-muted/50">
      <CardContent className="grid h-full grid-cols-[auto_minmax(0,1fr)] items-center gap-4 p-4 sm:p-5">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/20">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">{label}</p>
          <p className={cn("mt-1 truncate font-display font-bold leading-none text-foreground", valueIsNumeric ? "text-3xl" : "text-2xl")}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackBox({ message }: { message: string }) {
  return <div className="rounded-xl border border-primary/25 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">{message}</div>;
}
