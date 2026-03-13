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
import { AdminMonitoringOverview, AdminUser, Company, OperationalSettings, ServiceType } from "../types";
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
type AdminManageableRole = AdminUser["role"];
type AdminUserRoleFilter = "all" | AdminManageableRole;
type AdminUserFormState = {
  role: AdminManageableRole;
  email: string;
  password: string;
  companyId: string;
  active: boolean;
};

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
  if (aiType === "barber_booking") return "Agendamentos (IA)";
  if (aiType === "billing") return "Cobranças / CRM";
  return "NF-e Import";
}

function getServiceIcon(aiType: Exclude<ServiceType, null>): string {
  if (aiType === "barber_booking") return "📅";
  if (aiType === "billing") return "💰";
  return "📄";
}

function getServiceColor(aiType: Exclude<ServiceType, null>): string {
  if (aiType === "barber_booking") return "text-blue-400";
  if (aiType === "billing") return "text-amber-400";
  return "text-green-400";
}

type CompanyHealthItem = NonNullable<AdminMonitoringOverview["companyHealth"]>[number];

function getServiceMetricsSummary(company: CompanyHealthItem): string {
  if (company.aiType === "barber_booking") {
    return `${company.barbers?.profiles ?? 0} profissionais | ${company.barbers?.services ?? 0} servicos | ${company.appointments?.total ?? 0} agendamentos`;
  }
  if (company.aiType === "billing") {
    return `${company.billing?.pending ?? 0} pendentes | ${company.billing?.paid ?? 0} pagos | ${company.billing?.overdue ?? 0} vencidos`;
  }
  return `${company.nfes.imported} importadas | ${company.nfes.detected} detectadas | ${company.nfes.failed} falhas`;
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

function createEmptyAdminUserForm(): AdminUserFormState {
  return {
    role: "admin",
    email: "",
    password: "",
    companyId: "",
    active: true,
  };
}

function getUserRoleLabel(role: AdminManageableRole): string {
  return role === "admin" ? "Administrador" : "Usuario da empresa";
}

function getUserRoleMeta(role: AdminManageableRole): {
  label: string;
  description: string;
  badge: "default" | "secondary" | "destructive" | "outline" | "warning" | "info";
  cardClassName: string;
  iconClassName: string;
} {
  if (role === "admin") {
    return {
      label: "Administrador",
      description: "Acesso total ao painel, usuarios, empresas, monitoramento e configuracoes centrais.",
      badge: "info",
      cardClassName: "border-blue-500/30 bg-blue-500/10 hover:border-blue-500/50",
      iconClassName: "bg-blue-500/10 text-blue-400 ring-blue-500/25",
    };
  }

    return {
      label: "Usuario da empresa",
      description: "Acesso restrito a uma empresa especifica, respeitando o modulo configurado nela.",
      badge: "default",
      cardClassName: "border-emerald-500/25 bg-emerald-500/10 hover:border-emerald-500/45",
    iconClassName: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25",
    };
  }

function getUserRoleOrder(role: AdminManageableRole): number {
  return role === "admin" ? 0 : 1;
}

export function AdminPanel({ token, activeView }: AdminPanelProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");

  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
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
    monthlyMessageLimit: 0,
    monthlyNfseLimit: 0,
    active: true,
  });

  const [newNumber, setNewNumber] = useState("");
  const [nfePrompt, setNfePrompt] = useState("");
  const [barberPrompt, setBarberPrompt] = useState("");
  const [billingPrompt, setBillingPrompt] = useState("");
  const [restaurantPrompt, setRestaurantPrompt] = useState("");
  const [clinicPrompt, setClinicPrompt] = useState("");
  const [activePromptTab, setActivePromptTab] = useState<Exclude<ServiceType, null>>("nfe_import");
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
  const [monitoringTab, setMonitoringTab] = useState<"overview" | "health" | "jobs">("overview");
  const [resettingCooldown, setResettingCooldown] = useState<string | null>(null);
  const [companiesTab, setCompaniesTab] = useState<"list" | "create" | "config">("list");
  const [companySearch, setCompanySearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<AdminUserRoleFilter>("all");
  const [userCompanyFilter, setUserCompanyFilter] = useState("all");
  const [createUserForm, setCreateUserForm] = useState<AdminUserFormState>(createEmptyAdminUserForm);
  const [editUserForm, setEditUserForm] = useState<AdminUserFormState>(createEmptyAdminUserForm);

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

  const companyOptions = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [companies],
  );

  const filteredUsers = useMemo(() => {
    const search = userSearch.trim().toLowerCase();
    return users
      .filter((user) => {
        if (userRoleFilter !== "all" && user.role !== userRoleFilter) {
          return false;
        }

        if (userCompanyFilter !== "all" && user.companyId !== userCompanyFilter) {
          return false;
        }

        if (!search) {
          return true;
        }

      const companyName = user.company?.name.toLowerCase() ?? "";
        return (
        user.email.toLowerCase().includes(search) ||
        user.role.toLowerCase().includes(search) ||
        companyName.includes(search)
      );
      })
      .sort((a, b) => {
        const roleOrder = getUserRoleOrder(a.role) - getUserRoleOrder(b.role);
        if (roleOrder !== 0) return roleOrder;
        if (a.active !== b.active) return Number(b.active) - Number(a.active);
        return a.email.localeCompare(b.email, "pt-BR");
      });
  }, [userCompanyFilter, userRoleFilter, userSearch, users]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

  const stats = useMemo(() => {
    const total = companies.length;
    const active = companies.filter((company) => company.active).length;
    const withCertificate = companies.filter((company) => company.certificates.length > 0).length;
    const totalAuthorized = companies.reduce((acc, company) => acc + company.whatsappNumbers.length, 0);

    return { total, active, withCertificate, totalAuthorized };
  }, [companies]);

  const userStats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => user.active).length;
    const admins = users.filter((user) => user.role === "admin").length;
    const companyUsers = users.filter((user) => user.role === "company").length;
    const inactive = total - active;
    const linkedCompanies = new Set(users.map((user) => user.companyId).filter(Boolean)).size;

    return { total, active, admins, companyUsers, inactive, linkedCompanies };
  }, [users]);

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
        monthlyMessageLimit: 0,
        monthlyNfseLimit: 0,
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
      monthlyMessageLimit: selectedCompany.monthlyMessageLimit ?? 0,
      monthlyNfseLimit: selectedCompany.monthlyNfseLimit ?? 0,
      active: selectedCompany.active,
    });
  }, [selectedCompany]);

  useEffect(() => {
    if (!selectedUser) {
      setEditUserForm(createEmptyAdminUserForm());
      return;
    }

    setEditUserForm({
      role: selectedUser.role,
      email: selectedUser.email,
      password: "",
      companyId: selectedUser.companyId ?? "",
      active: selectedUser.active,
    });
  }, [selectedUser]);

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
      const [companiesData, usersData, sessionData, nfePromptData, barberPromptData, billingPromptData, restaurantPromptData, clinicPromptData, operationalSettingsData] = await Promise.all([
        api.getCompanies(token),
        api.getUsers(token),
        api.getWhatsappSession(token),
        api.getGlobalPrompt(token, "nfe_import").catch(() => ({ promptText: "" })),
        api.getGlobalPrompt(token, "barber_booking").catch(() => ({ promptText: "" })),
        api.getGlobalPrompt(token, "billing").catch(() => ({ promptText: "" })),
        api.getGlobalPrompt(token, "restaurant_delivery").catch(() => ({ promptText: "" })),
        api.getGlobalPrompt(token, "clinic_booking").catch(() => ({ promptText: "" })),
        api.getOperationalSettings(token).catch(() => null),
      ]);

      setCompanies(companiesData);
      setUsers(usersData);
      setWaStatus(normalizeStatus(sessionData.session.status));
      setNfePrompt(nfePromptData.promptText || "");
      setBarberPrompt(barberPromptData.promptText || "");
      setBillingPrompt(billingPromptData.promptText || "");
      setRestaurantPrompt(restaurantPromptData.promptText || "");
      setClinicPrompt(clinicPromptData.promptText || "");
      setOperationalSettings(operationalSettingsData);

      const selectedStillExists = companiesData.some((company) => company.id === selectedCompanyId);
      if (!selectedStillExists) {
        setSelectedCompanyId(companiesData[0]?.id ?? "");
      }

      const selectedUserStillExists = usersData.some((user) => user.id === selectedUserId);
      if (!selectedUserStillExists) {
        setSelectedUserId(usersData[0]?.id ?? "");
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
      monthlyMessageLimit?: number;
      monthlyNfseLimit?: number;
      active?: boolean;
    } = {
      cnpj: editForm.cnpj,
      name: editForm.name,
      email: editForm.email,
      evolutionInstanceName: editForm.evolutionInstanceName || null,
      aiType: editForm.aiType,
      bookingSector: editForm.bookingSector,
      monthlyMessageLimit: editForm.monthlyMessageLimit,
      monthlyNfseLimit: editForm.monthlyNfseLimit,
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

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    const password = createUserForm.password.trim();
    if (password.length < 8) {
      setFeedback("A senha do usuario precisa ter pelo menos 8 caracteres.");
      return;
    }

    if (createUserForm.role === "company" && !createUserForm.companyId) {
      setFeedback("Selecione uma empresa para criar um usuario com acesso de empresa.");
      return;
    }

    try {
      const created = await api.createUser(token, {
        role: createUserForm.role,
        email: createUserForm.email,
        password,
        companyId: createUserForm.role === "company" ? createUserForm.companyId : null,
        active: createUserForm.active,
      });

      setCreateUserForm(createEmptyAdminUserForm());
      setFeedback("Usuario criado com sucesso.");
      await loadAll();
      setSelectedUserId(created.id);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao criar usuario");
    }
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    if (!selectedUserId) {
      setFeedback("Selecione um usuario para editar.");
      return;
    }

    const payload: {
      role?: AdminManageableRole;
      email?: string;
      password?: string;
      companyId?: string | null;
      active?: boolean;
    } = {
      role: editUserForm.role,
      email: editUserForm.email,
      companyId: editUserForm.role === "company" ? editUserForm.companyId || null : null,
      active: editUserForm.active,
    };

    if (editUserForm.role === "company" && !editUserForm.companyId) {
      setFeedback("Selecione a empresa vinculada para esse usuario.");
      return;
    }

    const password = editUserForm.password.trim();
    if (password.length > 0) {
      if (password.length < 8) {
        setFeedback("A nova senha precisa ter pelo menos 8 caracteres.");
        return;
      }

      payload.password = password;
    }

    try {
      await api.updateUser(token, selectedUserId, payload);
      setEditUserForm((prev) => ({ ...prev, password: "" }));
      setFeedback("Usuario atualizado com sucesso.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao atualizar usuario");
    }
  }

  async function handleDeleteUser() {
    if (!selectedUser) {
      setFeedback("Selecione um usuario para excluir.");
      return;
    }

    const confirmDelete = window.confirm(`Deseja realmente excluir o usuario ${selectedUser.email}?`);
    if (!confirmDelete) {
      return;
    }

    setFeedback("");

    try {
      await api.deleteUser(token, selectedUser.id);
      setSelectedUserId("");
      setEditUserForm(createEmptyAdminUserForm());
      setFeedback("Usuario excluido com sucesso.");
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao excluir usuario");
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

  const PROMPT_TAB_LABELS: Record<Exclude<ServiceType, null>, string> = {
    nfe_import: "NF-e",
    barber_booking: "Agendamento",
    billing: "Cobranca",
    restaurant_delivery: "Restaurante",
    clinic_booking: "Clinica",
  };

  function getPromptForTab(tab: Exclude<ServiceType, null>): string {
    switch (tab) {
      case "nfe_import": return nfePrompt;
      case "barber_booking": return barberPrompt;
      case "billing": return billingPrompt;
      case "restaurant_delivery": return restaurantPrompt;
      case "clinic_booking": return clinicPrompt;
    }
  }

  function setPromptForTab(tab: Exclude<ServiceType, null>, value: string) {
    switch (tab) {
      case "nfe_import": setNfePrompt(value); break;
      case "barber_booking": setBarberPrompt(value); break;
      case "billing": setBillingPrompt(value); break;
      case "restaurant_delivery": setRestaurantPrompt(value); break;
      case "clinic_booking": setClinicPrompt(value); break;
    }
  }

  async function handleSaveGlobalPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    const promptText = getPromptForTab(activePromptTab);

    try {
      await api.setGlobalPrompt(token, promptText, activePromptTab);
      setFeedback(`Prompt global de ${PROMPT_TAB_LABELS[activePromptTab]} salvo.`);
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
    const monitoringTabs = [
      { key: "overview" as const, label: "Visao Geral" },
      { key: "health" as const, label: "Saude por Empresa" },
      { key: "jobs" as const, label: "Historico de Jobs" },
    ];

    return (
      <div className="space-y-6">
        {/* Header com abas */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {monitoringTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-semibold transition-all",
                  monitoringTab === tab.key
                    ? "bg-green-500/20 text-green-400 shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setMonitoringTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
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
              <RefreshCw className={cn("mr-1.5 h-4 w-4", loadingMonitoring && "animate-spin")} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* Aba: Visao Geral */}
        {monitoringTab === "overview" ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agenda de sincronizacao</p>
              <p className="mt-1 text-sm font-semibold">Sync de NF-e roda as 18:00 diariamente com pausa de 1 min entre lojas.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Proxima execucao: {formatDateTime(nextScheduledSyncAt.toISOString())} | Faltam{" "}
                {formatScheduleCountdown(secondsUntilScheduledSync)}
              </p>
            </div>

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

            {/* Resumo rapido de cada empresa */}
            <Card>
              <CardHeader>
                <CardTitle>Status rapido</CardTitle>
                <CardDescription>Resumo compacto de cada empresa monitorada.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresa</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Servico</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Certificado</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Metricas</th>
                        <th className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cooldown</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {(monitoring?.companyHealth ?? []).map((company) => {
                        const certTone = getCertificateTone(company.certificate.status);
                        const liveWaitSeconds = getLiveWaitSeconds(company.sync.waitSeconds, monitoring?.generatedAt, monitoringTick);
                        return (
                          <tr key={company.companyId}>
                            <td className="py-2.5 pr-4">
                              <p className="font-semibold">{company.name}</p>
                              <p className="text-xs text-muted-foreground">{company.cnpj}</p>
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className={cn("text-xs font-semibold", getServiceColor(company.aiType))}>
                                {getServiceIcon(company.aiType)} {getServiceLabel(company.aiType)}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge variant={company.active ? "default" : "secondary"}>{company.active ? "Ativa" : "Inativa"}</Badge>
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge variant={certTone.variant}>{certTone.label}</Badge>
                              {company.certificate.daysRemaining !== null ? (
                                <span className="ml-1 text-xs text-muted-foreground">{company.certificate.daysRemaining}d</span>
                              ) : null}
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                              {getServiceMetricsSummary(company)}
                            </td>
                            <td className="py-2.5 text-xs">
                              {(liveWaitSeconds ?? 0) > 0 ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">{formatWaitSeconds(liveWaitSeconds)}</Badge>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    disabled={resettingCooldown === company.companyId}
                                    onClick={async () => {
                                      setResettingCooldown(company.companyId);
                                      try {
                                        await api.resetCompanyCooldown(token, company.companyId);
                                        setFeedback(`Cooldown de ${company.name} resetado.`);
                                        void loadMonitoring();
                                      } catch (err) {
                                        setFeedback(err instanceof Error ? err.message : "Falha ao resetar cooldown");
                                      } finally {
                                        setResettingCooldown(null);
                                      }
                                    }}
                                  >
                                    Resetar
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Aba: Saude por Empresa */}
        {monitoringTab === "health" ? (
          <div className="space-y-4">
            {(monitoring?.companyHealth ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Sem empresas para monitorar.</p> : null}

            {(monitoring?.companyHealth ?? []).map((company) => {
              const certTone = getCertificateTone(company.certificate.status);
              const liveWaitSeconds = getLiveWaitSeconds(company.sync.waitSeconds, monitoring?.generatedAt, monitoringTick);
              return (
                <Card key={company.companyId}>
                  <CardContent className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getServiceIcon(company.aiType)}</span>
                          <p className="text-lg font-semibold">{company.name}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {company.cnpj} · <span className={getServiceColor(company.aiType)}>{getServiceLabel(company.aiType)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={company.active ? "default" : "secondary"}>{company.active ? "Ativa" : "Inativa"}</Badge>
                        <Badge variant={certTone.variant}>{certTone.label}</Badge>
                        {company.aiType !== "nfe_import" && company.evolutionInstanceName ? (
                          <Badge variant="outline">Inst: {company.evolutionInstanceName}</Badge>
                        ) : null}
                        {(liveWaitSeconds ?? 0) > 0 ? (
                          <>
                            <Badge variant="secondary">Cooldown: {formatWaitSeconds(liveWaitSeconds)}</Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={resettingCooldown === company.companyId}
                              onClick={async () => {
                                setResettingCooldown(company.companyId);
                                try {
                                  await api.resetCompanyCooldown(token, company.companyId);
                                  setFeedback(`Cooldown de ${company.name} resetado.`);
                                  void loadMonitoring();
                                } catch (err) {
                                  setFeedback(err instanceof Error ? err.message : "Falha ao resetar cooldown");
                                } finally {
                                  setResettingCooldown(null);
                                }
                              }}
                            >
                              <RefreshCw className="mr-1 h-3 w-3" />
                              Resetar cooldown
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
                      {/* Card: Certificado (apenas NF-e) */}
                      {company.aiType === "nfe_import" ? (
                        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Certificado A1</p>
                          <p className="font-semibold">Valido ate: {formatDate(company.certificate.validTo)}</p>
                          <p className="text-xs text-muted-foreground">Dias restantes: {company.certificate.daysRemaining ?? "-"}</p>
                        </div>
                      ) : null}

                      {/* Card: Sincronizacao (apenas NF-e) */}
                      {company.aiType === "nfe_import" ? (
                        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sincronizacao SEFAZ</p>
                          <p className="font-semibold">Ultimo: {formatDateTime(company.sync.lastSyncAt)}</p>
                          <p className="text-xs text-muted-foreground">Status: {company.sync.lastSyncStatus ?? "-"}</p>
                        </div>
                      ) : null}

                      {/* Card: NF-e (apenas NF-e) */}
                      {company.aiType === "nfe_import" ? (
                        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notas Fiscais</p>
                          <p className="font-semibold text-green-400">{company.nfes.imported} importadas</p>
                          <p className="text-xs text-muted-foreground">{company.nfes.detected} detectadas | {company.nfes.failed} falhas</p>
                        </div>
                      ) : null}

                      {/* Card: Agendamentos (barber_booking) */}
                      {company.aiType === "barber_booking" ? (
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">Agendamentos</p>
                          <p className="font-semibold text-blue-400">{company.appointments?.scheduled ?? 0} agendados</p>
                          <p className="text-xs text-muted-foreground">{company.appointments?.completed ?? 0} concluidos | {company.appointments?.canceled ?? 0} cancelados</p>
                        </div>
                      ) : null}

                      {/* Card: Profissionais (barber_booking) */}
                      {company.aiType === "barber_booking" ? (
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">Equipe</p>
                          <p className="font-semibold">{company.barbers?.profiles ?? 0} profissionais</p>
                          <p className="text-xs text-muted-foreground">{company.barbers?.services ?? 0} servicos cadastrados</p>
                        </div>
                      ) : null}

                      {/* Card: Cobrancas (billing) */}
                      {company.aiType === "billing" ? (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Cobrancas</p>
                          <p className="font-semibold text-amber-400">{company.billing?.pending ?? 0} pendentes</p>
                          <p className="text-xs text-muted-foreground">{company.billing?.paid ?? 0} pagos | {company.billing?.overdue ?? 0} vencidos</p>
                        </div>
                      ) : null}

                      {/* Card: Billing total (billing) */}
                      {company.aiType === "billing" ? (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Total documentos</p>
                          <p className="font-semibold">{company.billing?.total ?? 0} documentos</p>
                          <p className="text-xs text-muted-foreground">Pendentes + pagos + vencidos</p>
                        </div>
                      ) : null}

                      {/* Card: Numeros (todos) */}
                      <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">WhatsApp</p>
                        <p className="font-semibold">{company.whatsappNumbers.active}/{company.whatsappNumbers.total} numeros ativos</p>
                        <p className="text-xs text-muted-foreground">Mensagens: entrada/saida via webhook</p>
                      </div>
                    </div>

                    {company.sync.lastJob?.error ? (
                      <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        <FileWarning className="mr-1.5 inline h-4 w-4" />
                        {company.sync.lastJob.error}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : null}

        {/* Aba: Historico de Jobs */}
        {monitoringTab === "jobs" ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Historico de jobs — sincronizacao</CardTitle>
                <CardDescription>Todas as execucoes do worker ordenadas por data.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresa</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inicio</th>
                        <th className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detalhes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {(monitoring?.recentJobs ?? []).map((job) => (
                        <tr key={job.id}>
                          <td className="py-2.5 pr-4">
                            <Badge variant={job.status === "success" ? "default" : job.status === "running" ? "secondary" : "destructive"}>
                              {job.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 pr-4 font-semibold">{job.company?.name || "Sem empresa"}</td>
                          <td className="py-2.5 pr-4 text-xs text-muted-foreground">{formatDateTime(job.startedAt)}</td>
                          <td className="py-2.5">
                            {job.error ? (
                              <span className="flex items-start gap-1 text-xs text-destructive">
                                <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>{job.error}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
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
        ) : null}

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
              <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                {(Object.entries(PROMPT_TAB_LABELS) as [Exclude<ServiceType, null>, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                      activePromptTab === key
                        ? "bg-green-500/20 text-green-400 shadow-soft"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setActivePromptTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSaveGlobalPrompt} className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Prompt global — {PROMPT_TAB_LABELS[activePromptTab]}
                </label>
                <textarea
                  className="min-h-[130px] w-full rounded-xl border border-input bg-background/50 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                  value={getPromptForTab(activePromptTab)}
                  onChange={(event) => setPromptForTab(activePromptTab, event.target.value)}
                  required
                />
                <FeedbackButton type="submit" size="sm">
                  <Save className="mr-1.5 h-4 w-4" />
                  Salvar {PROMPT_TAB_LABELS[activePromptTab]}
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
    const companyTabs = [
      { key: "list" as const, label: "Empresas" },
      { key: "create" as const, label: "Nova Empresa" },
      { key: "config" as const, label: "Configuracao" },
    ];

    return (
      <div className="space-y-6">
        {/* Header com abas */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {companyTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-semibold transition-all",
                  companiesTab === tab.key
                    ? "bg-green-500/20 text-green-400 shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setCompaniesTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{companies.length} empresa(s) cadastrada(s)</p>
        </div>

        {/* Aba: Lista de Empresas */}
        {companiesTab === "list" ? (
          <Card>
            <CardHeader>
              <CardTitle>Empresas cadastradas</CardTitle>
              <CardDescription>Clique para selecionar e ir para a aba Configuracao.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, documento ou email..."
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
                  description={companySearch ? "Tente ajustar a busca." : "Use a aba 'Nova Empresa' para cadastrar."}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nome</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documento</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Servico</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Uso mensal</th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Numeros</th>
                        <th className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acoes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {filteredCompanies.map((company) => (
                        <tr
                          key={company.id}
                          className={cn(
                            "cursor-pointer transition-colors",
                            selectedCompanyId === company.id ? "bg-green-500/5" : "hover:bg-muted/40",
                          )}
                          onClick={() => {
                            setSelectedCompanyId(company.id);
                            setCompaniesTab("config");
                          }}
                        >
                          <td className="py-2.5 pr-4">
                            <p className="font-semibold">{company.name}</p>
                            <p className="text-xs text-muted-foreground">{company.email}</p>
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-muted-foreground">{company.cnpj}</td>
                          <td className="py-2.5 pr-4">
                            <span className="text-xs">{getServiceLabel(company.aiType)}</span>
                          </td>
                          <td className="py-2.5 pr-4">
                            <Badge variant={company.active ? "default" : "secondary"}>{company.active ? "Ativa" : "Inativa"}</Badge>
                          </td>
                          <td className="py-2.5 pr-4">
                            {company._usage ? (
                              <div className="flex flex-col gap-0.5 text-[11px]">
                                <span className={company.monthlyMessageLimit > 0 && company._usage.messagesThisMonth > company.monthlyMessageLimit ? "font-bold text-red-400" : "text-muted-foreground"}>
                                  📤 {company._usage.messagesThisMonth.toLocaleString("pt-BR")}{company.monthlyMessageLimit > 0 ? ` / ${company.monthlyMessageLimit.toLocaleString("pt-BR")}` : ""}
                                </span>
                                {company.monthlyNfseLimit > 0 || (company._usage.nfseThisMonth > 0) ? (
                                  <span className={company.monthlyNfseLimit > 0 && company._usage.nfseThisMonth > company.monthlyNfseLimit ? "font-bold text-red-400" : "text-muted-foreground"}>
                                    📝 {company._usage.nfseThisMonth.toLocaleString("pt-BR")}{company.monthlyNfseLimit > 0 ? ` / ${company.monthlyNfseLimit.toLocaleString("pt-BR")}` : ""}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-muted-foreground">{company.whatsappNumbers.length}</td>
                          <td className="py-2.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCompanyId(company.id);
                                setCompaniesTab("config");
                              }}
                            >
                              Editar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Aba: Nova Empresa */}
        {companiesTab === "create" ? (
          <Card>
            <CardHeader>
              <CardTitle>Cadastrar nova empresa</CardTitle>
              <CardDescription>Selecione um template para criar rapidamente ou preencha manualmente.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-w-2xl mx-auto space-y-6">
                {/* Template Quick Select */}
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">Template</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { slug: "", label: "Manual", icon: "⚙️" },
                      { slug: "lava_jato", label: "Lava Jato", icon: "🚗" },
                      { slug: "barbearia", label: "Barbearia", icon: "✂️" },
                      { slug: "clinica_estetica", label: "Clínica", icon: "🏥" },
                      { slug: "pet_shop", label: "Pet Shop", icon: "🐾" },
                      { slug: "oficina_mecanica", label: "Oficina", icon: "🔧" },
                      { slug: "cobranca", label: "Cobranças", icon: "💰" },
                      { slug: "nfe_import", label: "NF-e Import", icon: "📄" },
                    ].map((tpl) => (
                      <button
                        key={tpl.slug}
                        type="button"
                        onClick={() => {
                          if (tpl.slug === "lava_jato") {
                            setCreateForm((prev) => ({ ...prev, aiType: "barber_booking", bookingSector: "car_wash" as any }));
                          } else if (tpl.slug === "barbearia") {
                            setCreateForm((prev) => ({ ...prev, aiType: "barber_booking", bookingSector: "barber" as any }));
                          } else if (tpl.slug === "clinica_estetica") {
                            setCreateForm((prev) => ({ ...prev, aiType: "barber_booking", bookingSector: "clinic" as any }));
                          } else if (tpl.slug === "pet_shop" || tpl.slug === "oficina_mecanica") {
                            setCreateForm((prev) => ({ ...prev, aiType: "barber_booking", bookingSector: "generic" as any }));
                          } else if (tpl.slug === "cobranca") {
                            setCreateForm((prev) => ({ ...prev, aiType: "billing" }));
                          } else {
                            setCreateForm((prev) => ({ ...prev, aiType: "nfe_import" }));
                          }
                        }}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-200",
                          (tpl.slug === "" && createForm.aiType === "nfe_import") ||
                          (tpl.slug === "lava_jato" && createForm.bookingSector === "car_wash" && createForm.aiType === "barber_booking") ||
                          (tpl.slug === "barbearia" && createForm.bookingSector === "barber" && createForm.aiType === "barber_booking") ||
                          (tpl.slug === "clinica_estetica" && createForm.bookingSector === "clinic" && createForm.aiType === "barber_booking") ||
                          (tpl.slug === "cobranca" && createForm.aiType === "billing")
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                        )}
                      >
                        <span>{tpl.icon}</span>
                        <span>{tpl.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-border/40" />

                <form onSubmit={handleCreateCompany} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="form-group">
                      <label className="form-label">Documento</label>
                      <Input placeholder="CNPJ ou CPF" value={createForm.cnpj} onChange={(e) => setCreateForm((prev) => ({ ...prev, cnpj: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Nome da empresa</label>
                      <Input placeholder="Ex: Lava Jato Premium" value={createForm.name} onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))} required />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <Input placeholder="email@empresa.com" type="email" value={createForm.email} onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Senha</label>
                      <Input placeholder="Min 8 chars" type="password" minLength={8} value={createForm.password} onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))} required />
                    </div>
                  </div>
                  {createForm.aiType === "barber_booking" || createForm.aiType === "billing" ? (
                    <div className="form-group">
                      <label className="form-label">Instância Evolution</label>
                      <Input
                        placeholder={
                          createForm.aiType === "billing"
                            ? "Ex: cobranca_matriz"
                            : "Ex: agendamento_matriz"
                        }
                        value={createForm.evolutionInstanceName}
                        onChange={(e) => setCreateForm((prev) => ({ ...prev, evolutionInstanceName: e.target.value }))}
                        required
                      />
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input type="checkbox" className="rounded border-input" checked={createForm.active} onChange={(e) => setCreateForm((prev) => ({ ...prev, active: e.target.checked }))} />
                    Conta ativa
                  </label>
                  <Button type="submit" variant="default">
                    <Plus className="mr-1.5 h-4 w-4" />
                    Criar empresa
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Aba: Configuracao */}
        {companiesTab === "config" ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedCompany ? `Configuracao — ${selectedCompany.name}` : "Configuracao da empresa"}
              </CardTitle>
              <CardDescription>
                {selectedCompany
                  ? "Edite os dados da empresa e as regras de atendimento."
                  : "Selecione uma empresa na aba 'Empresas' para configurar."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedCompany ? (
                <div className="max-w-3xl mx-auto space-y-6">
                  <form onSubmit={handleUpdateCompany} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="form-group">
                        <label className="form-label">Documento</label>
                        <Input placeholder="CNPJ ou CPF" value={editForm.cnpj} onChange={(e) => setEditForm((prev) => ({ ...prev, cnpj: e.target.value }))} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Nome</label>
                        <Input placeholder="Nome da empresa" value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} required />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="form-group">
                        <label className="form-label">Email</label>
                        <Input placeholder="Email da empresa" type="email" value={editForm.email} onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Nova senha (opcional)</label>
                        <Input placeholder="Deixe vazio para manter" type="password" value={editForm.password} onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="form-group">
                        <label className="form-label">Tipo de servico</label>
                        <select
                          className="h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                          value={editForm.aiType}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, aiType: e.target.value as Exclude<ServiceType, null> }))}
                        >
                          <option value="nfe_import">NF-e (Importacao)</option>
                          <option value="barber_booking">Motor de Agendamentos (IA)</option>
                          <option value="billing">Cobranças e CRM</option>
                        </select>
                      </div>
                      {editForm.aiType === "barber_booking" ? (
                        <div className="form-group">
                          <label className="form-label">Setor</label>
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
                        </div>
                      ) : null}
                    </div>
                    {editForm.aiType === "barber_booking" || editForm.aiType === "billing" ? (
                      <div className="form-group">
                        <label className="form-label">Instancia Evolution</label>
                        <Input
                          placeholder="Nome da instancia Evolution"
                          value={editForm.evolutionInstanceName}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, evolutionInstanceName: e.target.value }))}
                          required
                        />
                      </div>
                    ) : null}

                    {/* ─── Limites de Uso Mensal ──────────────── */}
                    <div className="rounded-xl border border-border/40 bg-muted/30 p-4 space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Limites de Uso (Mensal)</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="form-group">
                          <label className="form-label">Limite de mensagens</label>
                          <Input
                            type="number"
                            min={0}
                            placeholder="0 = sem limite"
                            value={editForm.monthlyMessageLimit}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, monthlyMessageLimit: parseInt(e.target.value) || 0 }))}
                          />
                          <p className="mt-1 text-[11px] text-muted-foreground">0 = ilimitado. Define o maximo de mensagens enviadas por mes.</p>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Limite de NFS-e</label>
                          <Input
                            type="number"
                            min={0}
                            placeholder="0 = sem limite"
                            value={editForm.monthlyNfseLimit}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, monthlyNfseLimit: parseInt(e.target.value) || 0 }))}
                          />
                          <p className="mt-1 text-[11px] text-muted-foreground">0 = ilimitado. Define o maximo de notas de servico emitidas por mes.</p>
                        </div>
                      </div>
                      {selectedCompany?._usage ? (
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>
                            📤 Mensagens este mes:{" "}
                            <strong className={selectedCompany._usage.messagesThisMonth > editForm.monthlyMessageLimit && editForm.monthlyMessageLimit > 0 ? "text-red-400" : "text-foreground"}>
                              {selectedCompany._usage.messagesThisMonth.toLocaleString("pt-BR")}
                            </strong>
                            {editForm.monthlyMessageLimit > 0 ? ` / ${editForm.monthlyMessageLimit.toLocaleString("pt-BR")}` : ""}
                          </span>
                          <span>
                            📝 NFS-e este mes:{" "}
                            <strong className={selectedCompany._usage.nfseThisMonth > editForm.monthlyNfseLimit && editForm.monthlyNfseLimit > 0 ? "text-red-400" : "text-foreground"}>
                              {selectedCompany._usage.nfseThisMonth.toLocaleString("pt-BR")}
                            </strong>
                            {editForm.monthlyNfseLimit > 0 ? ` / ${editForm.monthlyNfseLimit.toLocaleString("pt-BR")}` : ""}
                          </span>
                        </div>
                      ) : null}
                    </div>

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
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">Numeros autorizados</p>
                        <p className="text-xs text-muted-foreground">{selectedCompany.whatsappNumbers.length} numero(s)</p>
                      </div>
                      <form onSubmit={handleAddNumber} className="flex gap-2 max-w-md">
                        <Input placeholder="5511999999999" value={newNumber} onChange={(event) => setNewNumber(event.target.value)} required />
                        <Button type="submit" size="sm" variant="outline">
                          <Plus className="mr-1 h-4 w-4" />
                          Adicionar
                        </Button>
                      </form>
                      <p className="text-xs text-muted-foreground">
                        Dica: informe com DDI. O sistema bloqueia automaticamente o numero do proprio agente.
                      </p>

                      {selectedCompany.whatsappNumbers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum numero autorizado para esta empresa.</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {selectedCompany.whatsappNumbers.map((number) => {
                            const draft = numberDrafts[number.id] ?? {
                              phone: number.phoneE164,
                              active: number.active,
                            };
                            const isSaving = savingNumberId === number.id;
                            const isDeleting = deletingNumberId === number.id;
                            return (
                              <div key={number.id} className="rounded-xl border border-border/50 bg-muted/30 p-3">
                                <div className="flex flex-col gap-2">
                                  <Input
                                    value={draft.phone}
                                    onChange={(event) =>
                                      setNumberDrafts((prev) => ({
                                        ...prev,
                                        [number.id]: { ...draft, phone: event.target.value },
                                      }))
                                    }
                                  />
                                  <div className="flex items-center justify-between gap-2">
                                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <input
                                        type="checkbox"
                                        checked={draft.active}
                                        onChange={(event) =>
                                          setNumberDrafts((prev) => ({
                                            ...prev,
                                            [number.id]: { ...draft, active: event.target.checked },
                                          }))
                                        }
                                      />
                                      ativo
                                    </label>
                                    <div className="flex gap-1">
                                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => void handleSaveNumber(number.id)} disabled={isSaving || isDeleting}>
                                        <Save className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="destructive"
                                        className="h-7 px-2"
                                        onClick={() => void handleDeleteNumber(number.id)}
                                        disabled={isSaving || isDeleting}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
                      <p className="text-sm font-semibold">
                        {editForm.aiType === "billing" ? "Regra de atendimento da cobranca" : "Regra de atendimento do agendamento"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Este servico responde qualquer numero que falar com a instancia configurada.
                        {selectedCompany.whatsappNumbers.length > 0
                          ? ` Existem ${selectedCompany.whatsappNumbers.length} numero(s) autorizado(s) salvos, mas eles sao ignorados neste servico.`
                          : ""}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={Building2}
                  title="Nenhuma empresa selecionada"
                  description="Selecione uma empresa na aba 'Empresas' para configurar."
                />
              )}
            </CardContent>
          </Card>
        ) : null}

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "users") {
    const selectClassName =
      "h-10 w-full rounded-xl border border-input bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40";
    const createRoleMeta = getUserRoleMeta(createUserForm.role);
    const editRoleMeta = selectedUser ? getUserRoleMeta(editUserForm.role) : null;
    const createSelectedCompany = companyOptions.find((company) => company.id === createUserForm.companyId) ?? null;
    const editSelectedCompany = companyOptions.find((company) => company.id === editUserForm.companyId) ?? null;
    const hasUserFilters = Boolean(userSearch.trim() || userRoleFilter !== "all" || userCompanyFilter !== "all");

    return (
      <div className="space-y-6">
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Users} label="Usuarios cadastrados" value={userStats.total} raw={`Empresas atendidas: ${userStats.linkedCompanies}`} />
          <StatCard icon={ShieldCheck} label="Administradores" value={userStats.admins} raw="Controle total do painel" />
          <StatCard icon={Building2} label="Usuarios de empresa" value={userStats.companyUsers} raw="Acessos segmentados por operacao" />
          <StatCard icon={Activity} label="Usuarios ativos" value={userStats.active} raw={`Inativos: ${userStats.inactive}`} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Gerenciar usuarios</CardTitle>
            <CardDescription>Perfis barber continuam no modulo operacional. Aqui ficam apenas admin e company.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{userStats.total} usuarios</Badge>
            <Badge variant="default">{userStats.admins} admins</Badge>
            <Badge variant="outline">{userStats.companyUsers} usuarios de empresa</Badge>
            <Badge variant={userStats.inactive > 0 ? "warning" : "secondary"}>{userStats.inactive} inativos</Badge>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Novo usuario</CardTitle>
              <CardDescription>Cadastro rapido e direto.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div className="form-group">
                  <label className="form-label">Perfil</label>
                  <select
                    className={selectClassName}
                    value={createUserForm.role}
                    onChange={(event) =>
                      setCreateUserForm((prev) => ({
                        ...prev,
                        role: event.target.value as AdminManageableRole,
                        companyId: event.target.value === "company" ? prev.companyId : "",
                      }))
                    }
                  >
                    <option value="admin">Administrador</option>
                    <option value="company">Usuario da empresa</option>
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">{createRoleMeta.description}</p>
                </div>

                <div className="form-group">
                  <label className="form-label">Email</label>
                  <Input
                    type="email"
                    placeholder="usuario@dominio.com"
                    value={createUserForm.email}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, email: event.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Senha</label>
                  <Input
                    type="password"
                    minLength={8}
                    placeholder="Minimo de 8 caracteres"
                    value={createUserForm.password}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, password: event.target.value }))}
                    required
                  />
                </div>

                {createUserForm.role === "company" ? (
                  <div className="form-group">
                    <label className="form-label">Empresa</label>
                    <select
                      className={selectClassName}
                      value={createUserForm.companyId}
                      onChange={(event) => setCreateUserForm((prev) => ({ ...prev, companyId: event.target.value }))}
                      required
                    >
                      <option value="">Selecione uma empresa...</option>
                      {companyOptions.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                    {createSelectedCompany ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {getServiceLabel(createSelectedCompany.aiType)} •{" "}
                        {createSelectedCompany.active ? "empresa ativa" : "empresa inativa"}
                      </p>
                    ) : null}
                    {companyOptions.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">Cadastre uma empresa antes de criar usuarios com acesso de empresa.</p>
                    ) : null}
                  </div>
                ) : null}

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={createUserForm.active}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, active: event.target.checked }))}
                  />
                  Usuario ativo
                </label>

                <div className="flex gap-2">
                  <Button type="submit" disabled={createUserForm.role === "company" && companyOptions.length === 0}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Criar
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setCreateUserForm(createEmptyAdminUserForm())}>
                    Limpar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usuarios cadastrados</CardTitle>
              <CardDescription>Busca simples e lista compacta.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_220px_auto]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por email, perfil ou empresa..."
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    className="pl-9 pr-10"
                  />
                  {userSearch ? (
                    <button
                      type="button"
                      onClick={() => setUserSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Limpar busca"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>

                <select
                  className={selectClassName}
                  value={userRoleFilter}
                  onChange={(event) => setUserRoleFilter(event.target.value as AdminUserRoleFilter)}
                >
                  <option value="all">Todos os perfis</option>
                  <option value="admin">Administradores</option>
                  <option value="company">Usuarios de empresa</option>
                </select>

                <select
                  className={selectClassName}
                  value={userCompanyFilter}
                  onChange={(event) => setUserCompanyFilter(event.target.value)}
                >
                  <option value="all">Todas as empresas</option>
                  {companyOptions.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>

                {hasUserFilters ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setUserSearch("");
                      setUserRoleFilter("all");
                      setUserCompanyFilter("all");
                    }}
                  >
                    Limpar
                  </Button>
                ) : (
                  <div />
                )}
              </div>

              <p className="text-xs text-muted-foreground">{filteredUsers.length} de {users.length} usuario(s)</p>

              {filteredUsers.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={userSearch ? "Nenhum usuario encontrado" : "Nenhum usuario cadastrado"}
                  description={userSearch ? "Ajuste os filtros de busca." : "Use o formulario ao lado para criar o primeiro acesso."}
                />
              ) : (
                <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                  {filteredUsers.map((user) => {
                    const isSelected = selectedUserId === user.id;
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedUserId(user.id)}
                        className={cn(
                          "w-full rounded-xl border p-3 text-left transition-all",
                          isSelected
                            ? "border-primary/35 bg-primary/5 shadow-soft"
                            : "border-border/50 bg-card hover:border-primary/20 hover:bg-muted/30",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-foreground">{user.email}</p>
                              <Badge variant={user.role === "admin" ? "info" : "default"}>{getUserRoleLabel(user.role)}</Badge>
                              <Badge variant={user.active ? "default" : "secondary"}>{user.active ? "Ativo" : "Inativo"}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {user.company ? `${user.company.name} • ${getServiceLabel(user.company.aiType)}` : "Acesso global"}
                            </p>
                          </div>
                          {isSelected ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{selectedUser ? `Editar usuario — ${selectedUser.email}` : "Edicao de usuario"}</CardTitle>
            <CardDescription>
              {selectedUser ? "Edicao simples do acesso selecionado." : "Selecione um usuario na lista para editar."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedUser ? (
              <form onSubmit={handleUpdateUser} className="max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-sm">
                  <Badge variant={editRoleMeta?.badge ?? "outline"}>{editRoleMeta?.label ?? getUserRoleLabel(selectedUser.role)}</Badge>
                  <Badge variant={selectedUser.active ? "default" : "secondary"}>
                    {selectedUser.active ? "Ativo" : "Inativo"}
                  </Badge>
                  <span className="text-muted-foreground">
                    {selectedUser.company ? `${selectedUser.company.name} • ${getServiceLabel(selectedUser.company.aiType)}` : "Acesso global"}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <Input
                      type="email"
                      value={editUserForm.email}
                      onChange={(event) => setEditUserForm((prev) => ({ ...prev, email: event.target.value }))}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Nova senha</label>
                    <Input
                      type="password"
                      placeholder="Deixe em branco para manter"
                      value={editUserForm.password}
                      onChange={(event) => setEditUserForm((prev) => ({ ...prev, password: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="form-group">
                    <label className="form-label">Perfil</label>
                    <select
                      className={selectClassName}
                      value={editUserForm.role}
                      onChange={(event) =>
                        setEditUserForm((prev) => ({
                          ...prev,
                          role: event.target.value as AdminManageableRole,
                          companyId: event.target.value === "company" ? prev.companyId : "",
                        }))
                      }
                    >
                      <option value="admin">Administrador</option>
                      <option value="company">Usuario da empresa</option>
                    </select>
                    <p className="mt-1 text-[11px] text-muted-foreground">{editRoleMeta?.description}</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={editUserForm.active}
                        onChange={(event) => setEditUserForm((prev) => ({ ...prev, active: event.target.checked }))}
                      />
                      Usuario ativo
                    </label>
                  </div>
                </div>

                {editUserForm.role === "company" ? (
                  <div className="form-group">
                    <label className="form-label">Empresa</label>
                    <select
                      className={selectClassName}
                      value={editUserForm.companyId}
                      onChange={(event) => setEditUserForm((prev) => ({ ...prev, companyId: event.target.value }))}
                      required
                    >
                      <option value="">Selecione uma empresa...</option>
                      {companyOptions.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                    {editSelectedCompany ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {getServiceLabel(editSelectedCompany.aiType)} • {editSelectedCompany.active ? "empresa ativa" : "empresa inativa"}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Criado em {new Date(selectedUser.createdAt).toLocaleString("pt-BR")}</span>
                  <span>Atualizado em {new Date(selectedUser.updatedAt).toLocaleString("pt-BR")}</span>
                </div>

                <div className="flex gap-2">
                  <Button type="submit">
                    <Save className="mr-1.5 h-4 w-4" />
                    Salvar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setEditUserForm({
                        role: selectedUser.role,
                        email: selectedUser.email,
                        password: "",
                        companyId: selectedUser.companyId ?? "",
                        active: selectedUser.active,
                      })
                    }
                  >
                    Restaurar
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void handleDeleteUser()}>
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Excluir
                  </Button>
                </div>
              </form>
            ) : (
              <EmptyState
                icon={Users}
                title="Nenhum usuario selecionado"
                description="Escolha um usuario na lista para editar."
              />
            )}
          </CardContent>
        </Card>

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
              <div key={company.id} className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/30 px-3 py-2">
                <div>
                  <p className="font-semibold">{company.name}</p>
                  <p className="text-xs text-muted-foreground">{company.email}</p>
                </div>
                <div className="text-right">
                  <Badge variant={company.active ? "default" : "secondary"}>{company.active ? "Ativa" : "Inativa"}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {company.aiType === "barber_booking"
                      ? `Agenda: ${company._count?.appointments ?? 0}`
                      : company.aiType === "billing"
                        ? "Cobranca/CRM ativo"
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
            <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
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
    <Card className="h-full min-h-[108px] border-border/50 bg-card transition-all hover:border-primary/20 hover:bg-muted/50">
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
  const isError = /falha|erro|invalid|nao foi|nao consegui|expirad/i.test(message);
  const colorClass = isError ? "border-red-500/20 text-red-400" : "border-green-500/20 text-green-400";
  const iconBg = isError ? "bg-red-500/10" : "bg-green-500/10";
  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4">
      <div className={`flex items-center gap-2 rounded-xl border bg-background/90 px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur-md ${colorClass}`}>
        <div className={`flex h-6 w-6 items-center justify-center rounded-full ${iconBg}`}>
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
