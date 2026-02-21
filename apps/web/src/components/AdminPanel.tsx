import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  Activity,
  Building2,
  FileWarning,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
  Check,
  Users,
} from "lucide-react";
import { api } from "../api";
import { AdminMonitoringOverview, Company, OperationalSettings, ServiceType } from "../types";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";
import { EmptyState } from "./ui/EmptyState";
import { SkeletonDashboard } from "./ui/Skeleton";
import { cn } from "../lib/utils";

interface AdminPanelProps {
  token: string;
  activeView: string;
}

type NumberDraftMap = Record<string, { phone: string; active: boolean }>;
const DAILY_SYNC_HOUR = 18;

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

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function formatWaitSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "-";
  if (seconds <= 0) return "liberado";

  const totalMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}min`;
}

function getLiveWaitSeconds(waitSeconds: number | null | undefined, generatedAt: string | null | undefined, nowMs: number): number | null {
  if (waitSeconds === null || waitSeconds === undefined) {
    return null;
  }

  if (!generatedAt) {
    return waitSeconds;
  }

  const generatedAtMs = new Date(generatedAt).getTime();
  if (Number.isNaN(generatedAtMs)) {
    return waitSeconds;
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - generatedAtMs) / 1000));
  return Math.max(0, waitSeconds - elapsedSeconds);
}

function getNextDailySyncAt(now: Date): Date {
  const next = new Date(now);
  next.setHours(DAILY_SYNC_HOUR, 0, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function getSecondsUntilNextDailySync(nowMs: number): number {
  const now = new Date(nowMs);
  const next = getNextDailySyncAt(now);
  return Math.max(0, Math.ceil((next.getTime() - nowMs) / 1000));
}

function formatScheduleCountdown(seconds: number): string {
  if (seconds <= 0) {
    return "agora";
  }

  return formatWaitSeconds(seconds);
}

function getCertificateTone(status: string): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (status === "valid") return { label: "Valido", variant: "default" };
  if (status === "expiring") return { label: "Expirando", variant: "secondary" };
  if (status === "expired") return { label: "Expirado", variant: "destructive" };
  if (status === "missing") return { label: "Sem certificado", variant: "outline" };
  return { label: "Desconhecido", variant: "secondary" };
}

function getServiceLabel(aiType: Exclude<ServiceType, null>): string {
  if (aiType === "barber_booking") return "Motor de Agendamentos (IA)";
  if (aiType === "billing") return "Cobranças e CRM";
  return "NF-e (Importacao)";
}

function buildNumberDraftMap(company: Company | null): NumberDraftMap {
  if (!company) {
    return {};
  }

  return company.whatsappNumbers.reduce<NumberDraftMap>((acc, number) => {
    acc[number.id] = { phone: number.phoneE164, active: number.active };
    return acc;
  }, {});
}

export function AdminPanel({ token, activeView }: AdminPanelProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");

  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [numberDrafts, setNumberDrafts] = useState<NumberDraftMap>({});
  const [savingNumberId, setSavingNumberId] = useState<string | null>(null);
  const [deletingNumberId, setDeletingNumberId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    cnpj: "",
    name: "",
    email: "",
    password: "",
    evolutionInstanceName: "",
    aiType: "nfe_import" as Exclude<ServiceType, null>,
    bookingSector: "barber" as "barber" | "clinic" | "car_wash" | "generic",
    active: true,
  });

  const [editForm, setEditForm] = useState({
    cnpj: "",
    name: "",
    email: "",
    password: "",
    evolutionInstanceName: "",
    aiType: "nfe_import" as Exclude<ServiceType, null>,
    bookingSector: "barber" as "barber" | "clinic" | "car_wash" | "generic",
    active: true,
  });

  const [newNumber, setNewNumber] = useState("");
  const [nfePrompt, setNfePrompt] = useState("");
  const [barberPrompt, setBarberPrompt] = useState("");
  const [activePromptTab, setActivePromptTab] = useState<"nfe_import" | "barber_booking">("nfe_import");
  const [companyPrompt, setCompanyPrompt] = useState("");
  const [operationalSettings, setOperationalSettings] = useState<OperationalSettings | null>(null);
  const [savingOperationalSettings, setSavingOperationalSettings] = useState(false);
  const [waStatus, setWaStatus] = useState("unknown");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingWhatsappAction, setLoadingWhatsappAction] = useState(false);
  const [monitoring, setMonitoring] = useState<AdminMonitoringOverview | null>(null);
  const [loadingMonitoring, setLoadingMonitoring] = useState(false);
  const [monitoringTick, setMonitoringTick] = useState(() => Date.now());
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsPageSize, setJobsPageSize] = useState(10);
  const [companySearch, setCompanySearch] = useState("");

  const filteredCompanies = useMemo(() => {
    const search = companySearch.trim().toLowerCase();
    if (!search) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(search) ||
        c.cnpj.toLowerCase().includes(search) ||
        c.email.toLowerCase().includes(search),
    );
  }, [companies, companySearch]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const stats = useMemo(() => {
    const total = companies.length;
    const active = companies.filter((company) => company.active).length;
    const withCertificate = companies.filter((company) => company.certificates.length > 0).length;
    const totalAuthorized = companies.reduce((acc, company) => acc + company.whatsappNumbers.length, 0);

    return { total, active, withCertificate, totalAuthorized };
  }, [companies]);

  const statusTone = useMemo(() => getStatusTone(waStatus), [waStatus]);
  const isWhatsappConnected = useMemo(() => {
    const normalized = waStatus.toLowerCase();
    return normalized.includes("open") || normalized.includes("connected");
  }, [waStatus]);

  function setOperationalField<K extends keyof OperationalSettings>(field: K, value: OperationalSettings[K]) {
    setOperationalSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setNumberDrafts(buildNumberDraftMap(selectedCompany));
  }, [selectedCompany]);

  useEffect(() => {
    if (!selectedCompany) {
      setEditForm({
        cnpj: "",
        name: "",
        email: "",
        password: "",
        evolutionInstanceName: "",
        aiType: "nfe_import" as Exclude<ServiceType, null>,
        bookingSector: "barber" as const,
        active: true,
      });
      return;
    }

    setEditForm({
      cnpj: selectedCompany.cnpj,
      name: selectedCompany.name,
      email: selectedCompany.email,
      password: "",
      evolutionInstanceName: selectedCompany.evolutionInstanceName || "",
      aiType: selectedCompany.aiType,
      bookingSector: selectedCompany.bookingSector || "barber",
      active: selectedCompany.active,
    });
  }, [selectedCompany]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setCompanyPrompt("");
      return;
    }

    void api
      .getCompanyPrompt(token, selectedCompanyId)
      .then((result) => setCompanyPrompt(result.promptText || ""))
      .catch(() => setCompanyPrompt(""));
  }, [selectedCompanyId, token]);

  useEffect(() => {
    if (activeView !== "monitoring") {
      return;
    }

    void loadMonitoring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, jobsPage, jobsPageSize]);

  useEffect(() => {
    if (activeView !== "monitoring" || !monitoring) {
      return;
    }

    const timer = window.setInterval(() => setMonitoringTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeView, monitoring]);

  const companiesCoolingDownLive = useMemo(() => {
    if (!monitoring) {
      return 0;
    }

    return monitoring.companyHealth.reduce((acc, company) => {
      const waitSeconds = getLiveWaitSeconds(company.sync.waitSeconds, monitoring.generatedAt, monitoringTick);
      return acc + ((waitSeconds ?? 0) > 0 ? 1 : 0);
    }, 0);
  }, [monitoring, monitoringTick]);

  const nextScheduledSyncAt = useMemo(() => getNextDailySyncAt(new Date(monitoringTick)), [monitoringTick]);
  const secondsUntilScheduledSync = useMemo(() => getSecondsUntilNextDailySync(monitoringTick), [monitoringTick]);

  async function loadAll() {
    setLoading(true);

    try {
      const [companiesData, sessionData, nfePromptData, barberPromptData, operationalSettingsData] = await Promise.all([
        api.getCompanies(token),
        api.getWhatsappSession(token),
        api.getGlobalPrompt(token, "nfe_import").catch(() => ({ promptText: "" })),
        api.getGlobalPrompt(token, "barber_booking").catch(() => ({ promptText: "" })),
        api.getOperationalSettings(token).catch(() => null),
      ]);

      setCompanies(companiesData);
      setWaStatus(normalizeStatus(sessionData.session.status));
      setNfePrompt(nfePromptData.promptText || "");
      setBarberPrompt(barberPromptData.promptText || "");
      setOperationalSettings(operationalSettingsData);

      const selectedStillExists = companiesData.some((company) => company.id === selectedCompanyId);
      if (!selectedStillExists) {
        setSelectedCompanyId(companiesData[0]?.id ?? "");
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao carregar dados do painel");
    } finally {
      setLoading(false);
    }
  }

  async function loadMonitoring() {
    setLoadingMonitoring(true);

    try {
      const data = await api.getAdminMonitoringOverview(token, { jobsPage, jobsPageSize });
      setMonitoring(data);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao carregar monitoramento");
    } finally {
      setLoadingMonitoring(false);
    }
  }

  async function handleCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    try {
      await api.createCompany(token, {
        cnpj: createForm.cnpj,
        name: createForm.name,
        email: createForm.email,
        password: createForm.password,
        evolutionInstanceName: createForm.evolutionInstanceName || undefined,
        aiType: createForm.aiType,
        bookingSector: createForm.bookingSector,
        active: createForm.active,
      });

      setCreateForm({
        cnpj: "",
        name: "",
        email: "",
        password: "",
        evolutionInstanceName: "",
        aiType: "nfe_import",
        bookingSector: "barber" as const,
        active: true,
      });
      setFeedback("Empresa criada com sucesso.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao criar empresa");
    }
  }

  async function handleUpdateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    if (!selectedCompanyId) {
      setFeedback("Selecione uma empresa para editar.");
      return;
    }

    const payload: {
      cnpj?: string;
      name?: string;
      email?: string;
      password?: string;
      evolutionInstanceName?: string | null;
      aiType?: Exclude<ServiceType, null>;
      bookingSector?: "barber" | "clinic" | "car_wash" | "generic";
      active?: boolean;
    } = {
      cnpj: editForm.cnpj,
      name: editForm.name,
      email: editForm.email,
      evolutionInstanceName: editForm.evolutionInstanceName || null,
      aiType: editForm.aiType,
      bookingSector: editForm.bookingSector,
      active: editForm.active,
    };

    const password = editForm.password.trim();
    if (password.length > 0) {
      if (password.length < 8) {
        setFeedback("A senha precisa ter pelo menos 8 caracteres.");
        return;
      }
      payload.password = password;
    }

    try {
      await api.updateCompany(token, selectedCompanyId, payload);
      setEditForm((prev) => ({ ...prev, password: "" }));
      setFeedback("Dados da empresa atualizados.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao atualizar empresa");
    }
  }

  async function handleAddNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    if (!selectedCompanyId) {
      setFeedback("Selecione uma empresa antes de cadastrar numero.");
      return;
    }

    try {
      await api.addCompanyNumber(token, selectedCompanyId, newNumber);
      setNewNumber("");
      setFeedback("Numero autorizado com sucesso.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao cadastrar numero");
    }
  }

  async function handleSaveNumber(numberId: string) {
    if (!selectedCompanyId) {
      setFeedback("Selecione uma empresa.");
      return;
    }

    const draft = numberDrafts[numberId];
    if (!draft) {
      return;
    }

    setSavingNumberId(numberId);
    setFeedback("");

    try {
      await api.updateCompanyNumber(token, selectedCompanyId, numberId, {
        phone: draft.phone,
        active: draft.active,
      });
      setFeedback("Numero atualizado com sucesso.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao atualizar numero");
    } finally {
      setSavingNumberId(null);
    }
  }

  async function handleDeleteNumber(numberId: string) {
    if (!selectedCompanyId) {
      setFeedback("Selecione uma empresa.");
      return;
    }

    const confirmDelete = window.confirm("Deseja realmente excluir este numero autorizado?");
    if (!confirmDelete) {
      return;
    }

    setDeletingNumberId(numberId);
    setFeedback("");

    try {
      await api.deleteCompanyNumber(token, selectedCompanyId, numberId);
      setFeedback("Numero removido com sucesso.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao excluir numero");
    } finally {
      setDeletingNumberId(null);
    }
  }

  async function handleSaveGlobalPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    const promptText = activePromptTab === "nfe_import" ? nfePrompt : barberPrompt;

    try {
      await api.setGlobalPrompt(token, promptText, activePromptTab);
      setFeedback(`Prompt global de ${activePromptTab === "nfe_import" ? "NF-e" : "Barbearia"} salvo.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao salvar prompt global");
    }
  }

  async function handleSaveCompanyPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    if (!selectedCompanyId) {
      setFeedback("Selecione uma empresa para salvar o prompt especifico.");
      return;
    }

    try {
      await api.setCompanyPrompt(token, selectedCompanyId, companyPrompt);
      setFeedback("Prompt da empresa salvo.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao salvar prompt da empresa");
    }
  }

  async function handleSaveOperationalSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    if (!operationalSettings) {
      setFeedback("Carregue as configuracoes operacionais antes de salvar.");
      return;
    }

    setSavingOperationalSettings(true);
    try {
      const updated = await api.updateOperationalSettings(token, operationalSettings);
      setOperationalSettings(updated);
      setFeedback("Configuracoes operacionais salvas com sucesso.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao salvar configuracoes operacionais");
    } finally {
      setSavingOperationalSettings(false);
    }
  }

  async function handleConnectWhatsappSession() {
    setFeedback("");
    setLoadingWhatsappAction(true);
    try {
      const result = await api.startWhatsappSession(token);
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
    const confirm = window.confirm("Deseja desconectar o WhatsApp agora?");
    if (!confirm) {
      return;
    }

    setFeedback("");
    setLoadingWhatsappAction(true);
    try {
      const result = await api.disconnectWhatsappSession(token);
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
        api.getWhatsappSession(token),
        api.getWhatsappQr(token).catch(() => null),
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

  if (loading) {
    return <SkeletonDashboard />;
  }

  if (activeView === "monitoring") {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sync DF-e diario as 18:00</p>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-lg border border-input bg-card px-2 text-xs font-semibold text-muted-foreground"
              value={jobsPageSize}
              onChange={(event) => {
                setJobsPage(1);
                setJobsPageSize(Number(event.target.value));
              }}
            >
              <option value={10}>10 logs</option>
              <option value={20}>20 logs</option>
              <option value={50}>50 logs</option>
            </select>
            <Button onClick={() => void loadMonitoring()} variant="outline" size="sm" disabled={loadingMonitoring}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Atualizar monitoramento
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-muted/50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agenda de sincronizacao</p>
          <p className="mt-1 text-sm font-semibold">O sync de NF-e roda apenas as 18:00, todos os dias.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Proxima execucao: {formatDateTime(nextScheduledSyncAt.toISOString())} | Faltam{" "}
            {formatScheduleCountdown(secondsUntilScheduledSync)}
          </p>
        </div>

        {loadingMonitoring ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/50 p-6">
            <RefreshCw className="h-5 w-5 animate-spin text-green-400" />
            <span className="text-sm font-semibold text-muted-foreground">Atualizando dados operacionais...</span>
          </div>
        ) : null}

        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Building2} label="Empresas ativas" value={monitoring?.totals.activeCompanies ?? 0} raw={`Total: ${monitoring?.totals.companies ?? 0}`} />
          <StatCard
            icon={ShieldCheck}
            label="Certificados validos"
            value={monitoring?.totals.certificates.valid ?? 0}
            raw={`Expirando: ${monitoring?.totals.certificates.expiring ?? 0} | Expirados: ${monitoring?.totals.certificates.expired ?? 0}`}
          />
          <StatCard
            icon={Users}
            label="Fila Atendimento"
            value={monitoring?.totals.jobs24h.total ?? 0}
            raw={`Sucesso: ${monitoring?.totals.jobs24h.success ?? 0} | Falha: ${monitoring?.totals.jobs24h.failed ?? 0} | Espera: ${companiesCoolingDownLive}`}
          />
          <StatCard
            icon={MessageSquare}
            label="Mensagens 24h"
            value={monitoring?.totals.messages24h.inbound ?? 0}
            raw={`Saida: ${monitoring?.totals.messages24h.outbound ?? 0} | Falha: ${monitoring?.totals.messages24h.failed ?? 0}`}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>Saude por empresa</CardTitle>
              <CardDescription>Validade do certificado, status de sync e volume de NF-e por empresa.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(monitoring?.companyHealth ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Sem empresas para monitorar.</p> : null}

              {(monitoring?.companyHealth ?? []).map((company) => {
                const certTone = getCertificateTone(company.certificate.status);
                const liveWaitSeconds = getLiveWaitSeconds(company.sync.waitSeconds, monitoring?.generatedAt, monitoringTick);
                return (
                  <div key={company.companyId} className="rounded-xl border border-border bg-muted/50 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{company.name}</p>
                        <p className="text-xs text-muted-foreground">Documento: {company.cnpj}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={company.active ? "default" : "secondary"}>{company.active ? "Ativa" : "Inativa"}</Badge>
                        <Badge variant={certTone.variant}>{certTone.label}</Badge>
                        <Badge variant="outline">Sync as 18:00</Badge>
                        {(liveWaitSeconds ?? 0) > 0 ? <Badge variant="secondary">Cooldown tecnico</Badge> : null}
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <p>Valido ate: {formatDate(company.certificate.validTo)}</p>
                      <p>Dias restantes: {company.certificate.daysRemaining ?? "-"}</p>
                      <p>Ultimo sync: {formatDateTime(company.sync.lastSyncAt)}</p>
                      <p>Status sync: {company.sync.lastSyncStatus ?? "-"}</p>
                      <p>Agenda: Diario as 18:00</p>
                      <p>Tempo ate 18:00: {formatScheduleCountdown(secondsUntilScheduledSync)}</p>
                      <p>Proximo ciclo: {formatDateTime(nextScheduledSyncAt.toISOString())}</p>
                      <p>Cooldown tecnico: {formatWaitSeconds(liveWaitSeconds)}</p>
                      <p>
                        NF-e: imp {company.nfes.imported} | det {company.nfes.detected} | falha {company.nfes.failed}
                      </p>
                      <p>
                        Numeros: {company.whatsappNumbers.active}/{company.whatsappNumbers.total}
                      </p>
                    </div>

                    {company.sync.lastJob?.error ? (
                      <div className="mt-2 rounded-lg border border-destructive/25 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                        Erro ultimo job: {company.sync.lastJob.error}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ultimos jobs globais</CardTitle>
              <CardDescription>Historico recente do worker de sincronizacao.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(monitoring?.recentJobs ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum job encontrado.</p> : null}

              {(monitoring?.recentJobs ?? []).map((job) => (
                <div key={job.id} className="rounded-xl border border-border bg-muted/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={job.status === "success" ? "default" : job.status === "running" ? "secondary" : "destructive"}>
                      {job.status}
                    </Badge>
                    <p className="text-xs text-muted-foreground">{formatDateTime(job.startedAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{job.company?.name || "Sem empresa"}</p>
                  {job.error ? (
                    <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
                      <FileWarning className="mt-0.5 h-3.5 w-3.5" />
                      <span>{job.error}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">Execucao sem erro.</p>
                  )}
                </div>
              ))}

              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Pagina {monitoring?.jobsPagination.page ?? jobsPage} de {monitoring?.jobsPagination.totalPages ?? 1} | Total:{" "}
                  {monitoring?.jobsPagination.total ?? 0}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loadingMonitoring || (monitoring?.jobsPagination.page ?? jobsPage) <= 1}
                    onClick={() => setJobsPage((prev) => Math.max(1, prev - 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      loadingMonitoring ||
                      (monitoring?.jobsPagination.page ?? jobsPage) >= (monitoring?.jobsPagination.totalPages ?? 1)
                    }
                    onClick={() =>
                      setJobsPage((prev) =>
                        Math.min(monitoring?.jobsPagination.totalPages ?? prev + 1, prev + 1),
                      )
                    }
                  >
                    Proxima
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "settings") {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-green-400" />
                Sessao principal do WhatsApp
              </CardTitle>
              <CardDescription>Fluxo recomendado: conectar, escanear QR (quando aparecer) e desconectar quando precisar trocar de aparelho.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-muted-foreground">Status:</span>
                <Badge variant={statusTone.badge}>{statusTone.text}</Badge>
                <span className="text-xs text-muted-foreground">{waStatus}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={isWhatsappConnected ? handleDisconnectWhatsappSession : handleConnectWhatsappSession}
                  variant={isWhatsappConnected ? "destructive" : "default"}
                  size="sm"
                  disabled={loadingWhatsappAction}
                >
                  <Phone className="mr-1.5 h-4 w-4" />
                  {loadingWhatsappAction
                    ? "Processando..."
                    : isWhatsappConnected
                      ? "Desconectar WhatsApp"
                      : "Conectar WhatsApp"}
                </Button>
                <Button onClick={handleRefreshWhatsappSession} variant="outline" size="sm" disabled={loadingWhatsappAction}>
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Atualizar status/QR
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {isWhatsappConnected
                  ? "Sessao ativa. Use desconectar apenas quando for trocar o aparelho vinculado."
                  : qrCode
                    ? "QR code pronto. Escaneie no WhatsApp para concluir a conexao."
                    : "Clique em Conectar WhatsApp para iniciar e gerar QR code."}
              </p>

              {qrCode ? (
                <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-white p-5">
                  {qrCode.startsWith("data:image") ? (
                    <img src={qrCode} alt="QR Code" className="h-auto w-full max-w-[230px] rounded-md" />
                  ) : (
                    <pre className="max-h-44 w-full overflow-auto text-xs">{qrCode}</pre>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-green-400" />
                Prompt da IA
              </CardTitle>
              <CardDescription>Configure o comportamento da IA por categoria de servico e personalize por empresa.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                    activePromptTab === "nfe_import"
                      ? "bg-green-500/20 text-green-400 shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setActivePromptTab("nfe_import")}
                >
                  NF-e (Importacao)
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                    activePromptTab === "barber_booking"
                      ? "bg-green-500/20 text-green-400 shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setActivePromptTab("barber_booking")}
                >
                  Motor Agendamento (IA)
                </button>
              </div>

              <form onSubmit={handleSaveGlobalPrompt} className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Prompt global — {activePromptTab === "nfe_import" ? "NF-e" : "Agendamento"}
                </label>
                <textarea
                  className="min-h-[130px] w-full rounded-xl border border-input bg-background/50 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                  value={activePromptTab === "nfe_import" ? nfePrompt : barberPrompt}
                  onChange={(event) =>
                    activePromptTab === "nfe_import"
                      ? setNfePrompt(event.target.value)
                      : setBarberPrompt(event.target.value)
                  }
                  required
                />
                <FeedbackButton type="submit" size="sm">
                  <Save className="mr-1.5 h-4 w-4" />
                  Salvar {activePromptTab === "nfe_import" ? "NF-e" : "Agendamento"}
                </FeedbackButton>
              </form>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresa para prompt especifico</label>
                <select
                  className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                  value={selectedCompanyId}
                  onChange={(event) => setSelectedCompanyId(event.target.value)}
                >
                  <option value="">Selecione...</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>

              <form onSubmit={handleSaveCompanyPrompt} className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prompt por empresa</label>
                <textarea
                  className="min-h-[120px] w-full rounded-xl border border-input bg-background/50 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                  value={companyPrompt}
                  onChange={(event) => setCompanyPrompt(event.target.value)}
                  placeholder="Se vazio, a empresa usa o prompt global da sua categoria."
                />
                <FeedbackButton type="submit" size="sm" variant="secondary" disabled={!selectedCompanyId}>
                  <Save className="mr-1.5 h-4 w-4" />
                  Salvar especifico
                </FeedbackButton>
              </form>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-green-400" />
              Configuracoes operacionais
            </CardTitle>
            <CardDescription>Essas configuracoes sao salvas no banco e aplicadas no backend sem depender do .env.</CardDescription>
          </CardHeader>
          <CardContent>
            {operationalSettings ? (
              <form onSubmit={handleSaveOperationalSettings} className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evolution URL</label>
                  <Input
                    type="url"
                    value={operationalSettings.evolutionBaseUrl}
                    onChange={(event) => setOperationalField("evolutionBaseUrl", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evolution API Key</label>
                  <Input
                    type="password"
                    value={operationalSettings.evolutionApiKey}
                    onChange={(event) => setOperationalField("evolutionApiKey", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instancia Evolution</label>
                  <Input
                    value={operationalSettings.evolutionInstanceName}
                    onChange={(event) => setOperationalField("evolutionInstanceName", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Numero do agente</label>
                  <Input
                    value={operationalSettings.agentWhatsappNumber}
                    onChange={(event) => setOperationalField("agentWhatsappNumber", event.target.value)}
                    placeholder="5511999999999"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Groq API Key</label>
                  <Input
                    type="password"
                    value={operationalSettings.groqApiKey}
                    onChange={(event) => setOperationalField("groqApiKey", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Groq Model</label>
                  <Input
                    value={operationalSettings.groqModel}
                    onChange={(event) => setOperationalField("groqModel", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SEFAZ tpAmb</label>
                  <select
                    className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                    value={operationalSettings.sefazTpAmb}
                    onChange={(event) => setOperationalField("sefazTpAmb", Number(event.target.value) as 1 | 2)}
                  >
                    <option value={1}>1 - Producao</option>
                    <option value={2}>2 - Homologacao</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SEFAZ cUFAutor</label>
                  <Input
                    type="number"
                    min={11}
                    max={99}
                    value={operationalSettings.sefazCUFAutor}
                    onChange={(event) => setOperationalField("sefazCUFAutor", Number(event.target.value))}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SEFAZ URL producao</label>
                  <Input
                    type="url"
                    value={operationalSettings.sefazNfeDistProdUrl}
                    onChange={(event) => setOperationalField("sefazNfeDistProdUrl", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SEFAZ URL homologacao</label>
                  <Input
                    type="url"
                    value={operationalSettings.sefazNfeDistHomologUrl}
                    onChange={(event) => setOperationalField("sefazNfeDistHomologUrl", event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeout SEFAZ (ms)</label>
                  <Input
                    type="number"
                    min={1000}
                    value={operationalSettings.sefazTimeoutMs}
                    onChange={(event) => setOperationalField("sefazTimeoutMs", Number(event.target.value))}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Max lotes por sync</label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={operationalSettings.sefazMaxBatchesPerSync}
                    onChange={(event) => setOperationalField("sefazMaxBatchesPerSync", Number(event.target.value))}
                    required
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Intervalo minimo de sync (segundos)</label>
                  <Input
                    type="number"
                    min={3660}
                    value={operationalSettings.syncMinIntervalSeconds}
                    onChange={(event) => setOperationalField("syncMinIntervalSeconds", Number(event.target.value))}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" disabled={savingOperationalSettings}>
                    <Save className="mr-1.5 h-4 w-4" />
                    {savingOperationalSettings ? "Salvando..." : "Salvar configuracoes operacionais"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Nao foi possivel carregar as configuracoes operacionais.</p>
            )}
          </CardContent>
        </Card>

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "companies") {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr_1.25fr]">
          <Card>
            <CardHeader>
              <CardTitle>Nova empresa</CardTitle>
              <CardDescription>Crie contas prontas para operacao imediata.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateCompany} className="space-y-3">
                <Input placeholder="CNPJ ou CPF" value={createForm.cnpj} onChange={(e) => setCreateForm((prev) => ({ ...prev, cnpj: e.target.value }))} required />
                <Input placeholder="Nome da empresa" value={createForm.name} onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))} required />
                <Input placeholder="Email da empresa" type="email" value={createForm.email} onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))} required />
                <Input placeholder="Senha inicial" type="password" minLength={8} value={createForm.password} onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))} required />
                <select
                  className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                  value={createForm.aiType}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, aiType: e.target.value as Exclude<ServiceType, null> }))}
                >
                  <option value="nfe_import">NF-e (Importacao)</option>
                  <option value="barber_booking">Motor de Agendamentos (IA)</option>
                  <option value="billing">Cobranças e CRM</option>
                </select>
                {createForm.aiType === "barber_booking" ? (
                  <>
                    <select
                      className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                      value={createForm.bookingSector}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, bookingSector: e.target.value as any }))}
                    >
                      <option value="barber">Barbearias e Salões de Beleza</option>
                      <option value="car_wash">Lava Jato e Estética Automotiva</option>
                      <option value="clinic">Clínicas e Consultórios</option>
                      <option value="generic">Agendamento Genérico</option>
                    </select>
                    <Input
                      placeholder="Nome da instancia Evolution (ex: barbearia_matriz)"
                      value={createForm.evolutionInstanceName}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, evolutionInstanceName: e.target.value }))}
                      required
                    />
                  </>
                ) : null}
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={createForm.active} onChange={(e) => setCreateForm((prev) => ({ ...prev, active: e.target.checked }))} />
                  Conta ativa
                </label>
                <Button type="submit" className="w-full">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Criar empresa
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Empresas cadastradas</CardTitle>
              <CardDescription>Selecione para editar dados, prompt e numeros autorizados.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[550px] overflow-auto space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar empresa..."
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {companySearch ? (
                <p className="text-xs text-muted-foreground">{filteredCompanies.length} de {companies.length} empresas</p>
              ) : null}
              {filteredCompanies.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title={companySearch ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada"}
                  description={companySearch ? "Tente ajustar a busca." : "Crie a primeira empresa no formulário ao lado."}
                />
              ) : null}
              {filteredCompanies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => setSelectedCompanyId(company.id)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2 text-left transition",
                    selectedCompanyId === company.id ? "border-green-500/30 bg-green-500/10" : "border-border bg-muted/50 hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{company.name}</p>
                    <Badge variant={company.active ? "default" : "secondary"}>{company.active ? "Ativa" : "Inativa"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Documento: {company.cnpj}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    servico: {getServiceLabel(company.aiType)} | numeros: {company.whatsappNumbers.length}
                  </p>
                  {company.aiType === "barber_booking" ? (
                    <p className="text-xs text-muted-foreground">instancia: {company.evolutionInstanceName || "nao configurada"}</p>
                  ) : null}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuracao da empresa</CardTitle>
              <CardDescription>Edite os dados da empresa e as regras de atendimento de cada servico.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {selectedCompany ? (
                <>
                  <form onSubmit={handleUpdateCompany} className="space-y-3">
                    <Input placeholder="CNPJ ou CPF" value={editForm.cnpj} onChange={(e) => setEditForm((prev) => ({ ...prev, cnpj: e.target.value }))} required />
                    <Input placeholder="Nome da empresa" value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} required />
                    <Input placeholder="Email da empresa" type="email" value={editForm.email} onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))} required />
                    <Input placeholder="Nova senha (opcional)" type="password" value={editForm.password} onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))} />
                    <select
                      className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                      value={editForm.aiType}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, aiType: e.target.value as Exclude<ServiceType, null> }))}
                    >
                      <option value="nfe_import">NF-e (Importacao)</option>
                      <option value="barber_booking">Motor de Agendamentos (IA)</option>
                      <option value="billing">Cobranças e CRM</option>
                    </select>
                    {editForm.aiType === "barber_booking" ? (
                      <>
                        <select
                          className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                          value={editForm.bookingSector}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, bookingSector: e.target.value as any }))}
                        >
                          <option value="barber">Barbearias e Salões de Beleza</option>
                          <option value="car_wash">Lava Jato e Estética Automotiva</option>
                          <option value="clinic">Clínicas e Consultórios</option>
                          <option value="generic">Agendamento Genérico</option>
                        </select>
                        <Input
                          placeholder="Nome da instancia Evolution"
                          value={editForm.evolutionInstanceName}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, evolutionInstanceName: e.target.value }))}
                          required
                        />
                      </>
                    ) : null}

                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm((prev) => ({ ...prev, active: e.target.checked }))} />
                      Empresa ativa
                    </label>

                    <Button type="submit" size="sm">
                      <Save className="mr-1.5 h-4 w-4" />
                      Salvar empresa
                    </Button>
                  </form>

                  <div className="h-px w-full bg-border" />

                  {editForm.aiType === "nfe_import" ? (
                    <>
                      <form onSubmit={handleAddNumber} className="space-y-2">
                        <p className="text-sm font-semibold">Adicionar numero autorizado</p>
                        <div className="flex gap-2">
                          <Input placeholder="5511999999999" value={newNumber} onChange={(event) => setNewNumber(event.target.value)} required />
                          <Button type="submit" size="sm" variant="outline">
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Dica: informe com DDI. O sistema bloqueia automaticamente o numero do proprio agente.
                        </p>
                      </form>

                      <div className="space-y-2">
                        {selectedCompany.whatsappNumbers.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhum numero autorizado para esta empresa.</p>
                        ) : null}

                        {selectedCompany.whatsappNumbers.map((number) => {
                          const draft = numberDrafts[number.id] ?? {
                            phone: number.phoneE164,
                            active: number.active,
                          };

                          const isSaving = savingNumberId === number.id;
                          const isDeleting = deletingNumberId === number.id;

                          return (
                            <div key={number.id} className="rounded-xl border border-border bg-muted/50 p-2.5">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <Input
                                  value={draft.phone}
                                  onChange={(event) =>
                                    setNumberDrafts((prev) => ({
                                      ...prev,
                                      [number.id]: {
                                        ...draft,
                                        phone: event.target.value,
                                      },
                                    }))
                                  }
                                />
                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <input
                                    type="checkbox"
                                    checked={draft.active}
                                    onChange={(event) =>
                                      setNumberDrafts((prev) => ({
                                        ...prev,
                                        [number.id]: {
                                          ...draft,
                                          active: event.target.checked,
                                        },
                                      }))
                                    }
                                  />
                                  ativo
                                </label>
                                <Button type="button" size="sm" onClick={() => void handleSaveNumber(number.id)} disabled={isSaving || isDeleting}>
                                  <Save className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => void handleDeleteNumber(number.id)}
                                  disabled={isSaving || isDeleting}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-border bg-muted/50 p-3">
                      <p className="text-sm font-semibold">Regra de atendimento da barbearia</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Este servico responde qualquer numero que falar com a instancia configurada.
                        {selectedCompany.whatsappNumbers.length > 0
                          ? ` Existem ${selectedCompany.whatsappNumbers.length} numero(s) autorizado(s) salvos, mas eles sao ignorados para barbearia.`
                          : ""}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Selecione uma empresa para editar os dados e numeros.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Building2} label="Empresas cadastradas" value={stats.total} />
        <StatCard icon={Users} label="Empresas ativas" value={stats.active} />
        <StatCard icon={MessageSquare} label="Numeros autorizados" value={stats.totalAuthorized} />
        <StatCard icon={Phone} label="Status WhatsApp" value={statusTone.text} raw={waStatus} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Resumo executivo</CardTitle>
            <CardDescription>Visao consolidada das empresas ativas e da operacao principal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {companies.length === 0 ? <p className="text-sm text-muted-foreground">Ainda nao existem empresas cadastradas.</p> : null}
            {companies.slice(0, 6).map((company) => (
              <div key={company.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/50 px-3 py-2">
                <div>
                  <p className="font-semibold">{company.name}</p>
                  <p className="text-xs text-muted-foreground">{company.email}</p>
                </div>
                <div className="text-right">
                  <Badge variant={company.active ? "default" : "secondary"}>{company.active ? "Ativa" : "Inativa"}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {company.aiType === "barber_booking"
                      ? `Agenda: ${company._count?.appointments ?? 0}`
                      : `NF-e: ${company._count?.nfeDocuments ?? 0}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{getServiceLabel(company.aiType)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conexao do agente</CardTitle>
            <CardDescription>Controle rapido da sessao usada no atendimento automatizado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status atual</p>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant={statusTone.badge}>{statusTone.text}</Badge>
                <span className="text-xs text-muted-foreground">{waStatus}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={isWhatsappConnected ? handleDisconnectWhatsappSession : handleConnectWhatsappSession}
                size="sm"
                variant={isWhatsappConnected ? "destructive" : "outline"}
                className="flex-1"
                disabled={loadingWhatsappAction}
              >
                {isWhatsappConnected ? "Desconectar" : "Conectar"}
              </Button>
              <Button onClick={handleRefreshWhatsappSession} size="sm" variant="outline" className="flex-1" disabled={loadingWhatsappAction}>
                Atualizar
              </Button>
              <Button onClick={() => void loadAll()} size="sm" variant="ghost" disabled={loadingWhatsappAction}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {feedback ? <FeedbackBox message={feedback} /> : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  raw,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  raw?: string;
}) {
  const valueIsNumeric = typeof value === "number";

  return (
    <Card className="h-full min-h-[108px] border-border bg-gradient-to-b from-white/[0.08] to-transparent transition-all hover:border-green-500/20 hover:bg-muted/50">
      <CardContent className="grid h-full grid-cols-[auto_minmax(0,1fr)] items-center gap-4 p-4 sm:p-5">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-500/10 text-green-400 ring-1 ring-inset ring-green-500/20">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">{label}</p>
          <p
            className={cn(
              "mt-1 truncate font-display font-bold leading-none text-foreground",
              valueIsNumeric ? "text-3xl" : "text-2xl sm:text-[1.8rem]",
            )}
          >
            {value}
          </p>
          {raw ? <p className="mt-1 truncate text-xs leading-tight text-muted-foreground">{raw}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2 rounded-xl border border-green-500/20 bg-background/90 px-4 py-3 text-sm font-semibold text-green-400 shadow-2xl backdrop-blur-md">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/10">
          <Check className="h-3.5 w-3.5" />
        </div>
        {message}
      </div>
    </div>
  );
}

function FeedbackButton({
  children,
  onClick,
  disabled,
  variant = "default",
  type = "button",
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "secondary" | "outline" | "destructive" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  type?: "button" | "submit" | "reset";
  className?: string;
}) {
  const [clicked, setClicked] = useState(false);

  useEffect(() => {
    if (clicked) {
      const timer = setTimeout(() => setClicked(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [clicked]);

  const handleClick = () => {
    setClicked(true);
    onClick?.();
  };

  return (
    <Button
      type={type}
      variant={clicked ? "outline" : variant}
      size="sm"
      disabled={disabled}
      onClick={type !== "submit" ? handleClick : undefined}
      className={cn("transition-all duration-300", clicked && "bg-green-500/10 text-green-400 border-green-500/50", className)}
    >
      {clicked ? (
        <>
          <Check className="mr-1.5 h-4 w-4 animate-in zoom-in spin-in-90 duration-300" />
          Salvo!
        </>
      ) : (
        children
      )}
    </Button>
  );
}
