export type Role = "admin" | "company" | "barber";
export type ServiceType = "nfe_import" | "barber_booking" | "billing" | "restaurant_delivery" | "clinic_booking" | null;

export type CertificateStatus = "missing" | "valid" | "expiring" | "expired" | "unknown";

export interface AuthUser {
  id: string;
  role: Role;
  email: string;
  companyId: string | null;
  serviceType: ServiceType;
  bookingSector?: "barber" | "clinic" | "car_wash" | "generic";
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export interface CompanyCertificate {
  id: string;
  createdAt: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface Company {
  id: string;
  cnpj: string;
  name: string;
  email: string;
  evolutionInstanceName: string | null;
  aiType: Exclude<ServiceType, null>;
  bookingSector?: "barber" | "clinic" | "car_wash" | "generic";
  active: boolean;
  createdAt: string;
  whatsappNumbers: Array<{
    id: string;
    phoneE164: string;
    active: boolean;
  }>;
  certificates: CompanyCertificate[];
  _count?: {
    nfeDocuments: number;
    barberProfiles: number;
    appointments: number;
  };
}

export interface NfeItem {
  id: string;
  codigo: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  qtd: string;
  vUnit: string;
  vTotal: string;
}

export interface NfeDocument {
  id: string;
  chave: string;
  nsu: string | null;
  emitenteCnpj: string | null;
  emitenteNome: string | null;
  valorTotal: string;
  dataEmissao: string | null;
  dataVencimento: string | null;
  tipoOperacao: string | null;
  status: "detected" | "imported" | "failed";
  importedAt: string | null;
  createdAt: string;
  _count?: {
    items: number;
  };
  items?: NfeItem[];
}

export interface CompanyCertificateOverview {
  id: string | null;
  createdAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: CertificateStatus;
  daysRemaining: number | null;
}

export interface CompanyMonitoringOverview {
  generatedAt: string;
  company: {
    id: string;
    name: string;
    cnpj: string;
    active: boolean;
  };
  certificate: CompanyCertificateOverview;
  sync: {
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    nextAllowedSyncAt: string | null;
    waitSeconds: number | null;
    isCoolingDown: boolean;
    lastJob: {
      id: string;
      status: "running" | "success" | "failed";
      startedAt: string;
      endedAt: string | null;
      error: string | null;
    } | null;
    recentJobs: Array<{
      id: string;
      status: "running" | "success" | "failed";
      startedAt: string;
      endedAt: string | null;
      error: string | null;
    }>;
    jobs24h: {
      total: number;
      running: number;
      success: number;
      failed: number;
    };
  };
  messages24h: {
    inbound: number;
    outbound: number;
    failed: number;
  };
  nfes: {
    imported: number;
    detected: number;
    failed: number;
    total: number;
  };
  whatsappNumbers: {
    total: number;
    active: number;
    numbers: Array<{
      id: string;
      phoneE164: string;
      active: boolean;
    }>;
  };
}

export interface AdminMonitoringOverview {
  generatedAt: string;
  whatsappSession: {
    status: string;
    connectedAt: string | null;
    updatedAt: string | null;
  };
  totals: {
    companies: number;
    activeCompanies: number;
    certificates: {
      valid: number;
      expiring: number;
      expired: number;
      unknown: number;
      missing: number;
    };
    companiesCoolingDown: number;
    jobs24h: {
      total: number;
      running: number;
      success: number;
      failed: number;
    };
    messages24h: {
      inbound: number;
      outbound: number;
      failed: number;
    };
  };
  recentJobs: Array<{
    id: string;
    companyId: string | null;
    status: "running" | "success" | "failed";
    startedAt: string;
    endedAt: string | null;
    error: string | null;
    company: { name: string } | null;
  }>;
  jobsPagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  companyHealth: Array<{
    companyId: string;
    name: string;
    cnpj: string;
    active: boolean;
    certificate: CompanyCertificateOverview;
    whatsappNumbers: {
      total: number;
      active: number;
    };
    sync: {
      lastSyncAt: string | null;
      lastSyncStatus: string | null;
      nextAllowedSyncAt: string | null;
      waitSeconds: number | null;
      isCoolingDown: boolean;
      lastJob: {
        id: string;
        companyId: string | null;
        status: "running" | "success" | "failed";
        startedAt: string;
        endedAt: string | null;
        error: string | null;
      } | null;
    };
    nfes: {
      imported: number;
      detected: number;
      failed: number;
      total: number;
    };
  }>;
}

export interface OperationalSettings {
  evolutionBaseUrl: string;
  evolutionApiKey: string;
  evolutionInstanceName: string;
  agentWhatsappNumber: string;
  groqApiKey: string;
  groqModel: string;
  sefazTpAmb: 1 | 2;
  sefazCUFAutor: number;
  sefazNfeDistProdUrl: string;
  sefazNfeDistHomologUrl: string;
  sefazTimeoutMs: number;
  sefazMaxBatchesPerSync: number;
  syncMinIntervalSeconds: number;
}

export interface BarberProfile {
  id: string;
  companyId: string;
  userId: string | null;
  name: string;
  email: string | null;
  phoneE164: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    services: number;
    appointments: number;
  };
}

export interface BarberWorkingHour {
  id: string;
  barberId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BarberService {
  id: string;
  companyId: string;
  barberId: string | null;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  barber?: {
    id: string;
    name: string;
  } | null;
}

export type BarberAppointmentStatus = "scheduled" | "completed" | "canceled";

export interface BarberAppointment {
  id: string;
  companyId: string;
  barberId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  startsAt: string;
  endsAt: string;
  status: BarberAppointmentStatus;
  source: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  barber?: {
    id: string;
    name: string;
  };
  service?: {
    id: string;
    name: string;
    durationMinutes: number;
    price: string;
  };
}

export interface BarberDashboardSummary {
  generatedAt: string;
  totals: {
    barbers: number;
    services: number;
    appointmentsToday: number;
    upcomingScheduled: number;
  };
  nextAppointments: BarberAppointment[];
}

export type BillingDocumentStatus = "pending" | "paid" | "overdue";
export type BillingDocumentType = "boleto" | "nfe";

export interface BillingDocument {
  id: string;
  clientId: string;
  type: BillingDocumentType;
  description: string;
  amount: number;
  dueDate: string;
  status: BillingDocumentStatus;
  paidAt?: string;
  barcode?: string;
  nfeKey?: string;
}

export interface BillingClient {
  id: string;
  name: string;
  document: string; // CPF/CNPJ
  email: string;
  phone: string;
  autoSendEnabled?: boolean;
  documents: BillingDocument[];
}

export interface BillingConversation {
  id: string;
  phoneE164: string;
  userName: string | null;
  lastMessage: string;
  lastActivityAt: string;
}

export interface BillingMessage {
  id: string;
  direction: "in" | "out";
  content: string;
  createdAt: string;
  status?: string;
}

export interface OwnerDashboardAlert {
  type: "error" | "warning" | "info";
  message: string;
  time: string;
}

export interface OwnerDashboardSummary {
  generatedAt: string;
  totals: {
    pendingBillingAmount: number;
    pendingBillingCount: number;
    overdueBillingAmount: number;
    overdueBillingCount: number;
    appointmentsToday: number;
    appointmentsMonth: number;
    nfesImported: number;
    messagesOut: number;
    aiResponseRate: number;
  };
  messagesPerDay: Array<{ day: string; in: number; out: number }>;
  appointmentsPerDay: Array<{ day: string; scheduled: number; completed: number; canceled: number }>;
  billingByStatus: Array<{ status: string; count: number }>;
  recentAlerts: OwnerDashboardAlert[];
}

export interface BillingDashboardSummary {
  generatedAt: string;
  totals: {
    clients: number;
    pendingAmount: number;
    paidAmount: number;
    overdueAmount: number;
    pendingCount: number;
    paidCount: number;
    overdueCount: number;
  };
}
