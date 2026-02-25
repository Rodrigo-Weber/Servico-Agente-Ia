import {
  AdminMonitoringOverview,
  BarberAppointment,
  BarberDashboardSummary,
  BarberProfile,
  BarberService,
  BarberWorkingHour,
  AuthSession,
  Company,
  CompanyMonitoringOverview,
  NfeDocument,
  OperationalSettings,
  ServiceType,
  BillingDashboardSummary,
  BillingClient,
  BillingConversation,
  BillingMessage,
  OwnerDashboardSummary,
} from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3333" : "");
export const UNAUTHORIZED_EVENT_NAME = "weber:unauthorized";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string;
  body?: unknown;
  isMultipart?: boolean;
  skipUnauthorizedEvent?: boolean;
}

interface ApiErrorPayload {
  message?: string;
}

function emitUnauthorized(message: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{ message: string }>(UNAUTHORIZED_EVENT_NAME, {
      detail: { message },
    }),
  );
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: HeadersInit = {};

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.isMultipart && options.body instanceof FormData) {
      body = options.body;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    const message = payload.message || "Erro na requisicao";

    if (response.status === 401 && !options.skipUnauthorizedEvent) {
      emitUnauthorized("Sua sessao expirou. Entre novamente para continuar.");
    }

    throw new ApiError(message, response.status, payload);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function resolveDownloadFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) {
    return fallback;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return fallback;
}

export const api = {
  login(email: string, password: string) {
    return request<AuthSession>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipUnauthorizedEvent: true,
    });
  },

  logout(refreshToken: string) {
    return request<void>("/auth/logout", {
      method: "POST",
      body: { refreshToken },
      skipUnauthorizedEvent: true,
    });
  },

  getCompanies(token: string) {
    return request<Company[]>("/admin/companies", { token });
  },

  createCompany(
    token: string,
    payload: {
      cnpj: string;
      name: string;
      email: string;
      password: string;
      evolutionInstanceName?: string;
      aiType: Exclude<ServiceType, null>;
      bookingSector?: "barber" | "clinic" | "car_wash" | "generic";
      active: boolean;
    },
  ) {
    return request<Company>("/admin/companies", {
      method: "POST",
      token,
      body: payload,
    });
  },

  updateCompany(
    token: string,
    companyId: string,
    payload: {
      cnpj?: string;
      name?: string;
      email?: string;
      password?: string;
      evolutionInstanceName?: string | null;
      aiType?: Exclude<ServiceType, null>;
      bookingSector?: "barber" | "clinic" | "car_wash" | "generic";
      active?: boolean;
    },
  ) {
    return request<Company>(`/admin/companies/${companyId}`, {
      method: "PATCH",
      token,
      body: payload,
    });
  },

  addCompanyNumber(token: string, companyId: string, phone: string) {
    return request<{ id: string }>(`/admin/companies/${companyId}/whatsapp-numbers`, {
      method: "POST",
      token,
      body: { phone },
    });
  },

  updateCompanyNumber(
    token: string,
    companyId: string,
    numberId: string,
    payload: { phone?: string; active?: boolean },
  ) {
    return request<{ id: string; phoneE164: string; active: boolean }>(
      `/admin/companies/${companyId}/whatsapp-numbers/${numberId}`,
      {
        method: "PATCH",
        token,
        body: payload,
      },
    );
  },

  deleteCompanyNumber(token: string, companyId: string, numberId: string) {
    return request<void>(`/admin/companies/${companyId}/whatsapp-numbers/${numberId}`, {
      method: "DELETE",
      token,
    });
  },

  setGlobalPrompt(token: string, promptText: string, category?: string) {
    return request<{ id: string }>("/admin/prompts/global", {
      method: "PUT",
      token,
      body: { promptText, category },
    });
  },

  setCompanyPrompt(token: string, companyId: string, promptText: string) {
    return request<{ id: string }>(`/admin/companies/${companyId}/prompt`, {
      method: "PUT",
      token,
      body: { promptText },
    });
  },

  getGlobalPrompt(token: string, category?: string) {
    const qs = category ? `?category=${category}` : "";
    return request<{ promptText: string | null }>(`/admin/prompts/global${qs}`, { token });
  },

  getCompanyPrompt(token: string, companyId: string) {
    return request<{ promptText: string | null }>(`/admin/companies/${companyId}/prompt`, { token });
  },

  getOperationalSettings(token: string) {
    return request<OperationalSettings>("/admin/settings/operational", { token });
  },

  updateOperationalSettings(token: string, payload: Partial<OperationalSettings>) {
    return request<OperationalSettings>("/admin/settings/operational", {
      method: "PUT",
      token,
      body: payload,
    });
  },

  getWhatsappSession(token: string) {
    return request<{ session: { status: string } }>("/admin/whatsapp/session", { token });
  },

  startWhatsappSession(token: string) {
    return request<{
      ok: boolean;
      status: string;
      qr?: string | null;
      alreadyConnected: boolean;
      message: string;
    }>("/admin/whatsapp/session/connect", {
      method: "POST",
      token,
      body: {},
    });
  },

  disconnectWhatsappSession(token: string) {
    return request<{
      ok: boolean;
      status: string;
      message: string;
    }>("/admin/whatsapp/session/disconnect", {
      method: "POST",
      token,
      body: {},
    });
  },

  getWhatsappQr(token: string) {
    return request<{ qr: string | null; status: string; message: string | null }>("/admin/whatsapp/session/qrcode", {
      token,
    });
  },

  getCompanyMe(token: string) {
    return request<{
      company: {
        id: string;
        name: string;
        cnpj: string;
        certificates: Array<{
          id: string;
          createdAt: string;
          validFrom: string | null;
          validTo: string | null;
        }>;
      } | null;
      certificate:
      | {
        id: string;
        createdAt: string;
        validFrom: string | null;
        validTo: string | null;
        status: "missing" | "valid" | "expiring" | "expired" | "unknown";
        daysRemaining: number | null;
      }
      | null;
    }>("/company/me", { token });
  },

  uploadCertificate(token: string, file: File, password: string) {
    const form = new FormData();
    form.append("file", file);
    form.append("password", password);

    return request<{
      message: string;
      certificate: {
        validFrom: string | null;
        validTo: string | null;
        status: "missing" | "valid" | "expiring" | "expired" | "unknown";
        daysRemaining: number | null;
      };
    }>("/company/certificate-a1", {
      method: "POST",
      token,
      body: form,
      isMultipart: true,
    });
  },

  deleteCompanyCertificate(token: string) {
    return request<{ message: string }>("/company/certificate-a1", {
      method: "DELETE",
      token,
    });
  },

  getDashboardSummary(token: string) {
    return request<{
      totals: {
        importedCount: number;
        detectedCount: number;
        failedCount: number;
        importedValue: string;
        detectedValue: string;
      };
    }>("/company/dashboard/summary", { token });
  },

  getNfes(token: string) {
    return request<NfeDocument[]>("/company/nfes", { token });
  },

  getNfeDetail(token: string, nfeId: string) {
    return request<NfeDocument>(`/company/nfes/${nfeId}`, { token });
  },

  async downloadNfeXml(token: string, nfeId: string, chaveFallback?: string) {
    const response = await fetch(`${API_URL}/company/nfes/${encodeURIComponent(nfeId)}/xml`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
      const message = payload.message || "Erro na requisicao";

      if (response.status === 401) {
        emitUnauthorized("Sua sessao expirou. Entre novamente para continuar.");
      }

      throw new ApiError(message, response.status, payload);
    }

    const blob = await response.blob();
    const fallback = `${(chaveFallback || `nfe-${nfeId}`).replace(/[^0-9A-Za-z_-]/g, "") || `nfe-${nfeId}`}.xml`;
    const fileName = resolveDownloadFilename(response.headers.get("content-disposition"), fallback);
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  },

  getAdminMonitoringOverview(token: string, options?: { jobsPage?: number; jobsPageSize?: number }) {
    const params = new URLSearchParams();
    if (options?.jobsPage) {
      params.set("jobsPage", String(options.jobsPage));
    }
    if (options?.jobsPageSize) {
      params.set("jobsPageSize", String(options.jobsPageSize));
    }

    const query = params.toString();
    return request<AdminMonitoringOverview>(`/admin/monitoring/overview${query ? `?${query}` : ""}`, { token });
  },

  getCompanyMonitoringOverview(token: string) {
    return request<CompanyMonitoringOverview>("/company/monitoring/overview", { token });
  },

  getBarberMe(token: string) {
    return request<{
      user: {
        id: string;
        role: "company" | "barber";
        companyId: string;
        email: string;
      };
      company: {
        id: string;
        name: string;
        cnpj: string;
        aiType: "barber_booking";
        bookingSector: "barber" | "clinic" | "car_wash" | "generic";
        active: boolean;
      } | null;
      barberProfile: {
        id: string;
        name: string;
        email: string | null;
        phoneE164: string | null;
        active: boolean;
      } | null;
    }>("/barber/me", { token });
  },

  getBarberWhatsappSession(token: string) {
    return request<{ session: { status: string } }>("/barber/whatsapp/session", { token });
  },

  startBarberWhatsappSession(token: string) {
    return request<{
      ok: boolean;
      status: string;
      qr?: string | null;
      alreadyConnected: boolean;
      message: string;
    }>("/barber/whatsapp/session/connect", {
      method: "POST",
      token,
      body: {},
    });
  },

  disconnectBarberWhatsappSession(token: string) {
    return request<{
      ok: boolean;
      status: string;
      message: string;
    }>("/barber/whatsapp/session/disconnect", {
      method: "POST",
      token,
      body: {},
    });
  },

  getBarberWhatsappQr(token: string) {
    return request<{ qr: string | null; status: string; message: string | null }>("/barber/whatsapp/session/qrcode", { token });
  },

  getBarberDashboardSummary(token: string) {
    return request<BarberDashboardSummary>("/barber/dashboard/summary", { token });
  },

  getBarbers(token: string) {
    return request<BarberProfile[]>("/barber/barbers", { token });
  },

  createBarber(
    token: string,
    payload: {
      name: string;
      email?: string;
      phone?: string;
      active?: boolean;
    },
  ) {
    return request<BarberProfile>("/barber/barbers", {
      method: "POST",
      token,
      body: payload,
    });
  },

  updateBarber(
    token: string,
    barberId: string,
    payload: {
      name?: string;
      email?: string | null;
      phone?: string | null;
      active?: boolean;
    },
  ) {
    return request<BarberProfile>(`/barber/barbers/${barberId}`, {
      method: "PATCH",
      token,
      body: payload,
    });
  },

  deleteBarber(token: string, barberId: string) {
    return request<void>(`/barber/barbers/${barberId}`, {
      method: "DELETE",
      token,
    });
  },

  getBarberWorkingHours(token: string, barberId: string) {
    return request<BarberWorkingHour[]>(`/barber/barbers/${barberId}/working-hours`, { token });
  },

  updateBarberWorkingHours(
    token: string,
    barberId: string,
    payload: {
      hours: Array<{
        weekday: number;
        startTime: string;
        endTime: string;
        active?: boolean;
      }>;
    },
  ) {
    return request<BarberWorkingHour[]>(`/barber/barbers/${barberId}/working-hours`, {
      method: "PUT",
      token,
      body: payload,
    });
  },

  getBarberServices(token: string, options?: { activeOnly?: boolean; barberId?: string }) {
    const params = new URLSearchParams();
    if (options?.activeOnly !== undefined) {
      params.set("activeOnly", String(options.activeOnly));
    }
    if (options?.barberId) {
      params.set("barberId", options.barberId);
    }

    const query = params.toString();
    return request<BarberService[]>(`/barber/services${query ? `?${query}` : ""}`, { token });
  },

  createBarberService(
    token: string,
    payload: {
      name: string;
      description?: string;
      barberId?: string | null;
      durationMinutes: number;
      price: number;
      active?: boolean;
    },
  ) {
    return request<BarberService>("/barber/services", {
      method: "POST",
      token,
      body: payload,
    });
  },

  updateBarberService(
    token: string,
    serviceId: string,
    payload: {
      name?: string;
      description?: string | null;
      barberId?: string | null;
      durationMinutes?: number;
      price?: number;
      active?: boolean;
    },
  ) {
    return request<BarberService>(`/barber/services/${serviceId}`, {
      method: "PATCH",
      token,
      body: payload,
    });
  },

  deleteBarberService(token: string, serviceId: string) {
    return request<void>(`/barber/services/${serviceId}`, {
      method: "DELETE",
      token,
    });
  },

  getBarberAppointments(
    token: string,
    options?: {
      from?: string;
      to?: string;
      status?: "scheduled" | "completed" | "canceled";
      barberId?: string;
      limit?: number;
    },
  ) {
    const params = new URLSearchParams();
    if (options?.from) {
      params.set("from", options.from);
    }
    if (options?.to) {
      params.set("to", options.to);
    }
    if (options?.status) {
      params.set("status", options.status);
    }
    if (options?.barberId) {
      params.set("barberId", options.barberId);
    }
    if (options?.limit) {
      params.set("limit", String(options.limit));
    }

    const query = params.toString();
    return request<BarberAppointment[]>(`/barber/appointments${query ? `?${query}` : ""}`, { token });
  },

  createBarberAppointment(
    token: string,
    payload: {
      barberId: string;
      serviceId: string;
      clientName: string;
      clientPhone: string;
      startsAt: string;
      source?: string;
      notes?: string;
    },
  ) {
    return request<BarberAppointment>("/barber/appointments", {
      method: "POST",
      token,
      body: payload,
    });
  },

  updateBarberAppointment(
    token: string,
    appointmentId: string,
    payload: {
      barberId?: string;
      serviceId?: string;
      clientName?: string;
      clientPhone?: string;
      startsAt?: string;
      status?: "scheduled" | "completed" | "canceled";
      notes?: string | null;
    },
  ) {
    return request<BarberAppointment>(`/barber/appointments/${appointmentId}`, {
      method: "PATCH",
      token,
      body: payload,
    });
  },

  cancelBarberAppointment(token: string, appointmentId: string) {
    return request<void>(`/barber/appointments/${appointmentId}`, {
      method: "DELETE",
      token,
    });
  },

  deleteBarberAppointment(
    token: string,
    appointmentId: string,
    payload: {
      confirmation: string;
    },
  ) {
    return request<void>(`/barber/appointments/${appointmentId}/permanent`, {
      method: "DELETE",
      token,
      body: payload,
    });
  },

  getBillingDashboardSummary(token: string): Promise<BillingDashboardSummary> {
    return request<BillingDashboardSummary>("/billing/dashboard/summary", { token });
  },

  getBillingWhatsappSession(token: string) {
    return request<{ session: { status: string } }>("/billing/whatsapp/session", { token });
  },

  startBillingWhatsappSession(token: string) {
    return request<{
      ok: boolean;
      status: string;
      qr?: string | null;
      alreadyConnected: boolean;
      message: string;
    }>("/billing/whatsapp/session/connect", {
      method: "POST",
      token,
      body: {},
    });
  },

  disconnectBillingWhatsappSession(token: string) {
    return request<{
      ok: boolean;
      status: string;
      message: string;
    }>("/billing/whatsapp/session/disconnect", {
      method: "POST",
      token,
      body: {},
    });
  },

  getBillingWhatsappQr(token: string) {
    return request<{ qr: string | null; status: string; message: string | null }>("/billing/whatsapp/session/qrcode", { token });
  },

  getBillingClients(token: string): Promise<BillingClient[]> {
    return request<BillingClient[]>("/billing/clients", { token });
  },

  updateBillingClient(
    token: string,
    clientId: string,
    payload: {
      autoSendEnabled?: boolean;
      phone?: string | null;
      email?: string | null;
    },
  ) {
    return request<{
      id: string;
      autoSendEnabled: boolean;
      phone: string | null;
      email: string | null;
    }>(`/billing/clients/${clientId}`, {
      method: "PATCH",
      token,
      body: payload,
    });
  },

  notifyBillingDocument(token: string, documentId: string) {
    return request<{
      ok: boolean;
      phone: string;
      fallbackPhoneUsed: boolean;
      message: string;
    }>(`/billing/documents/${documentId}/notify`, {
      method: "POST",
      token,
      body: {},
    });
  },

  getBillingConversations(token: string): Promise<BillingConversation[]> {
    return request<BillingConversation[]>("/billing/crm/conversations", { token });
  },

  getBillingMessages(token: string, phoneE164: string): Promise<BillingMessage[]> {
    return request<BillingMessage[]>(`/billing/crm/messages/${encodeURIComponent(phoneE164)}`, { token });
  },

  async downloadBillingMessageAttachment(token: string, messageId: string, fallbackName = "arquivo.bin"): Promise<void> {
    const response = await fetch(`${API_URL}/billing/crm/message-attachments/${encodeURIComponent(messageId)}/download`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
      const message = payload.message || "Erro ao baixar anexo";

      if (response.status === 401) {
        emitUnauthorized("Sua sessao expirou. Entre novamente para continuar.");
      }

      throw new ApiError(message, response.status, payload);
    }

    const blob = await response.blob();
    const fileName = resolveDownloadFilename(response.headers.get("content-disposition"), fallbackName);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  deleteBillingConversation(token: string, phoneE164: string) {
    return request<{
      ok: boolean;
      deletedMessages: number;
      deletedMemories: number;
    }>(`/billing/crm/conversations/${encodeURIComponent(phoneE164)}`, {
      method: "DELETE",
      token,
    });
  },

  sendBillingMessage(token: string, phoneE164: string, content: string): Promise<BillingMessage> {
    return request<BillingMessage>("/billing/crm/messages", {
      method: "POST",
      token,
      body: {
        phone: phoneE164,
        content,
      },
    });
  },

  importBillingCsv(token: string) {
    return request<{
      suppliersCreated: number;
      suppliersUpdated: number;
      documentsCreated: number;
      documentsUpdated: number;
      suppliersTotal: number;
      documentsTotal: number;
      skippedDocuments: number;
      fornecedoresPath: string;
      documentosPath: string;
    }>("/billing/import/csv", {
      method: "POST",
      token,
      body: {},
    });
  },

  getBillingMe(token: string) {
    return request<{
      company: {
        id: string;
        name: string;
        cnpj: string;
        email: string;
        active: boolean;
        evolutionInstanceName: string | null;
      };
    }>("/billing/me", {
      token,
    });
  },

  async getOwnerDashboard(_token: string): Promise<OwnerDashboardSummary> {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" });
    });
    return {
      generatedAt: now.toISOString(),
      totals: {
        pendingBillingAmount: 18750.0,
        pendingBillingCount: 23,
        overdueBillingAmount: 4320.5,
        overdueBillingCount: 7,
        appointmentsToday: 14,
        appointmentsMonth: 187,
        nfesImported: 56,
        messagesOut: 132,
        aiResponseRate: 87,
      },
      messagesPerDay: days.map((day) => ({
        day,
        in: Math.floor(Math.random() * 60) + 20,
        out: Math.floor(Math.random() * 50) + 15,
      })),
      appointmentsPerDay: days.map((day) => ({
        day,
        scheduled: Math.floor(Math.random() * 20) + 5,
        completed: Math.floor(Math.random() * 18) + 3,
        canceled: Math.floor(Math.random() * 4),
      })),
      billingByStatus: [
        { status: "A Vencer", count: 23 },
        { status: "Vencidas", count: 7 },
        { status: "Pagas", count: 150 },
      ],
      recentAlerts: [
        {
          type: "warning",
          message: "7 cobranças vencidas há mais de 5 dias sem notificação.",
          time: "18:02",
        },
        {
          type: "info",
          message: "56 NF-es importadas com sucesso no último ciclo de sincronização.",
          time: "01:01",
        },
      ],
    };
  },
};
