import { FastifyInstance } from "fastify";
import { CompanyAiType, MessageDispatchStatus } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../../lib/password.js";
import { normalizePhone } from "../../lib/phone.js";
import { prisma } from "../../lib/prisma.js";
import { getNextAllowedSyncAt, getNextSyncWaitSeconds } from "../../lib/sync-policy.js";
import { requireRole, authenticate } from "../auth/guards.js";
import { evolutionService } from "../../services/evolution.service.js";
import { appConfigService } from "../../services/app-config.service.js";
import { getOutboundQueueCounts } from "../messages/queue.js";

const createCompanySchema = z.object({
  cnpj: z.string().min(11),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  evolutionInstanceName: z.string().trim().min(1).optional(),
  aiType: z.nativeEnum(CompanyAiType).default("nfe_import"),
  bookingSector: z.enum(["barber", "clinic", "car_wash", "generic"]).default("barber"),
  active: z.boolean().default(true),
});

const updateCompanySchema = z.object({
  cnpj: z.string().min(11).optional(),
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  evolutionInstanceName: z.string().trim().min(1).nullable().optional(),
  aiType: z.nativeEnum(CompanyAiType).optional(),
  bookingSector: z.enum(["barber", "clinic", "car_wash", "generic"]).optional(),
  active: z.boolean().optional(),
});

const createNumberSchema = z.object({
  phone: z.string().min(8),
});

const updateNumberSchema = z
  .object({
    phone: z.string().min(8).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => data.phone !== undefined || data.active !== undefined, {
    message: "Informe ao menos um campo para atualizar",
  });

const promptSchema = z.object({
  promptText: z.string().min(20),
  category: z.nativeEnum(CompanyAiType).optional(),
});

const monitoringQuerySchema = z.object({
  jobsPage: z.coerce.number().int().min(1).default(1),
  jobsPageSize: z.coerce.number().int().min(5).max(50).default(10),
});

const dispatchQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  status: z.nativeEnum(MessageDispatchStatus).optional(),
  companyId: z.string().min(1).optional(),
});

const rateLimitPolicyItemSchema = z.object({
  scope: z.enum(["global", "instance", "company", "contact"]),
  instanceName: z.string().trim().min(1).nullable().optional(),
  companyId: z.string().min(1).nullable().optional(),
  maxPerMinute: z.coerce.number().int().min(1).max(10000),
  minDelayMs: z.coerce.number().int().min(0).max(60000).default(1500),
  maxDelayMs: z.coerce.number().int().min(0).max(120000).default(4500),
  burst: z.coerce.number().int().min(1).max(1000).default(3),
  active: z.boolean().default(true),
});

const replaceRateLimitPoliciesSchema = z.object({
  policies: z.array(rateLimitPolicyItemSchema).max(500),
});

const operationalSettingsUpdateSchema = z
  .object({
    evolutionBaseUrl: z.union([z.string().url(), z.null()]).optional(),
    evolutionApiKey: z.union([z.string(), z.null()]).optional(),
    evolutionInstanceName: z.union([z.string().min(1), z.null()]).optional(),
    agentWhatsappNumber: z.union([z.string(), z.null()]).optional(),
    groqApiKey: z.union([z.string(), z.null()]).optional(),
    groqModel: z.union([z.string().min(2), z.null()]).optional(),
    sefazTpAmb: z.union([z.literal(1), z.literal(2), z.null()]).optional(),
    sefazCUFAutor: z.union([z.coerce.number().int().min(11).max(99), z.null()]).optional(),
    sefazNfeDistProdUrl: z.union([z.string().url(), z.null()]).optional(),
    sefazNfeDistHomologUrl: z.union([z.string().url(), z.null()]).optional(),
    sefazTimeoutMs: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    sefazMaxBatchesPerSync: z.union([z.coerce.number().int().min(1).max(30), z.null()]).optional(),
    syncMinIntervalSeconds: z.union([z.coerce.number().int().min(3660), z.null()]).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos um campo para atualizar",
  });

function isConnectedStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized.includes("open") || normalized.includes("connected");
}

function normalizeSessionStatus(status: string | null | undefined): string {
  if (!status || typeof status !== "string") {
    return "unknown";
  }

  const cleaned = status.trim().toLowerCase();
  if (!cleaned) {
    return "unknown";
  }

  return cleaned.slice(0, 40);
}

function companyAiTypeRequiresDedicatedInstance(aiType: CompanyAiType): boolean {
  return aiType === "barber_booking" || aiType === "billing";
}

function buildPhoneVariants(raw: string): string[] {
  const normalized = normalizePhone(raw);
  if (!normalized) {
    return [];
  }

  const variants = new Set<string>();
  variants.add(normalized);

  if (normalized.startsWith("55") && normalized.length > 11) {
    variants.add(normalized.slice(2));
  }

  if (normalized.length === 11 && normalized.startsWith("55")) {
    variants.add(`55${normalized}`);
  }

  if (normalized.length > 11) {
    variants.add(normalized.slice(-11));
  }

  if (normalized.length > 10) {
    variants.add(normalized.slice(-10));
  }

  return Array.from(variants);
}

function isAgentOwnNumber(rawPhone: string, agentWhatsappNumber: string): boolean {
  const agentPhone = normalizePhone(agentWhatsappNumber || "");
  if (!agentPhone) {
    return false;
  }

  const incoming = buildPhoneVariants(rawPhone);
  const agent = buildPhoneVariants(agentPhone);

  return incoming.some((value) => agent.some((target) => value === target || value.endsWith(target) || target.endsWith(value)));
}

function getCertificateStatus(validTo: Date | null | undefined): "missing" | "valid" | "expiring" | "expired" | "unknown" {
  if (!validTo) {
    return "unknown";
  }

  const diffDays = Math.ceil((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return "expired";
  }

  if (diffDays <= 30) {
    return "expiring";
  }

  return "valid";
}

function getDaysRemaining(validTo: Date | null | undefined): number | null {
  if (!validTo) {
    return null;
  }

  return Math.ceil((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function toStatusCountMap(rows: Array<{ status: string; _count: { _all: number } }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
}

function sanitizeSyncJobError(error: string | null): string | null {
  if (!error) {
    return null;
  }

  if (/SEFAZ bloqueou novas consultas ate .*cStat 656/i.test(error)) {
    return "SEFAZ aplicou cooldown temporario por consumo indevido (cStat 656).";
  }

  return error;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function isRepeatedDigits(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}

function isValidCpf(cpf: string): boolean {
  if (cpf.length !== 11 || isRepeatedDigits(cpf)) {
    return false;
  }

  const calcDigit = (base: string, factor: number) => {
    let total = 0;
    for (const char of base) {
      total += Number(char) * factor;
      factor -= 1;
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const first = calcDigit(cpf.slice(0, 9), 10);
  const second = calcDigit(cpf.slice(0, 10), 11);

  return first === Number(cpf[9]) && second === Number(cpf[10]);
}

function isValidCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14 || isRepeatedDigits(cnpj)) {
    return false;
  }

  const calcDigit = (base: string, factors: number[]) => {
    const total = base.split("").reduce((acc, digit, index) => acc + Number(digit) * factors[index]!, 0);
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = calcDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calcDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

function validateAndNormalizeDocument(value: string): { normalized: string; type: "cpf" | "cnpj" } | null {
  const normalized = onlyDigits(value);

  if (isValidCpf(normalized)) {
    return { normalized, type: "cpf" };
  }

  if (isValidCnpj(normalized)) {
    return { normalized, type: "cnpj" };
  }

  return null;
}

function validateRatePolicyItem(item: z.infer<typeof rateLimitPolicyItemSchema>): string | null {
  if (item.maxDelayMs < item.minDelayMs) {
    return "maxDelayMs deve ser maior ou igual a minDelayMs";
  }

  if (item.scope === "global" && (item.instanceName || item.companyId)) {
    return "Politica global nao deve informar instanceName ou companyId";
  }

  if (item.scope === "instance" && !item.instanceName) {
    return "Politica por instancia exige instanceName";
  }

  if ((item.scope === "company" || item.scope === "contact") && !item.companyId) {
    return "Politicas de company/contact exigem companyId";
  }

  return null;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (adminApp) => {
      adminApp.addHook("preHandler", authenticate);
      adminApp.addHook("preHandler", requireRole("admin"));

      adminApp.post("/companies", async (request, reply) => {
        const parsed = createCompanySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Payload invalido", errors: parsed.error.flatten().fieldErrors });
        }

        const data = parsed.data;
        const requestedInstanceName = data.evolutionInstanceName?.trim() || null;
        const document = validateAndNormalizeDocument(data.cnpj);

        if (!document) {
          return reply.code(400).send({ message: "Informe um CPF ou CNPJ valido" });
        }

        if (data.aiType === "nfe_import" && document.type !== "cnpj") {
          return reply.code(400).send({ message: "Empresas no servico de NF-e devem usar CNPJ valido" });
        }

        if (companyAiTypeRequiresDedicatedInstance(data.aiType) && !requestedInstanceName) {
          return reply.code(400).send({ message: "Informe o nome da instancia Evolution para empresas de agendamento/cobranca" });
        }

        const existing = await prisma.company.findFirst({
          where: {
            OR: [
              { cnpj: document.normalized },
              { email: data.email },
              requestedInstanceName ? { evolutionInstanceName: requestedInstanceName } : undefined,
            ].filter(Boolean) as Array<Record<string, unknown>>,
          },
        });

        if (existing) {
          if (requestedInstanceName && existing.evolutionInstanceName === requestedInstanceName) {
            return reply.code(409).send({ message: "Nome de instancia Evolution ja em uso por outra empresa" });
          }
          return reply.code(409).send({ message: "Empresa com CNPJ ou email ja existente" });
        }

        const userExists = await prisma.user.findUnique({ where: { email: data.email } });
        if (userExists) {
          return reply.code(409).send({ message: "Email ja em uso por outro usuario" });
        }

        const passwordHash = await hashPassword(data.password);

        const result = await prisma.$transaction(async (tx) => {
          const company = await tx.company.create({
            data: {
              cnpj: document.normalized,
              name: data.name,
              email: data.email,
              evolutionInstanceName: companyAiTypeRequiresDedicatedInstance(data.aiType) ? requestedInstanceName : null,
              aiType: data.aiType,
              bookingSector: data.bookingSector,
              active: data.active,
            },
          });

          await tx.companyOperationalLimit.create({
            data: {
              companyId: company.id,
            },
          });

          await tx.user.create({
            data: {
              role: "company",
              companyId: company.id,
              email: data.email,
              passwordHash,
              active: data.active,
            },
          });

          if (data.aiType === "nfe_import") {
            await tx.dfeSyncState.create({
              data: {
                companyId: company.id,
                ultimoStatus: "pending",
              },
            });
          }

          return { company };
        });

        return reply.code(201).send(result.company);
      });

      adminApp.get("/companies", async () => {
        const companies = await prisma.company.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            whatsappNumbers: true,
            certificates: {
              where: { active: true },
              select: { id: true, validFrom: true, validTo: true, createdAt: true },
            },
            _count: {
              select: {
                nfeDocuments: true,
                barberProfiles: true,
                appointments: true,
              },
            },
          },
        });

        return companies;
      });

      adminApp.patch("/companies/:id", async (request, reply) => {
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        const parsed = updateCompanySchema.safeParse(request.body);

        if (!params.success) {
          return reply.code(400).send({ message: "ID invalido", errors: params.error.flatten().fieldErrors });
        }

        if (!parsed.success) {
          return reply.code(400).send({ message: "Payload invalido", errors: parsed.error.flatten().fieldErrors });
        }

        const { id } = params.data;
        const data = parsed.data;

        const company = await prisma.company.findUnique({ where: { id } });
        if (!company) {
          return reply.code(404).send({ message: "Empresa nao encontrada" });
        }

        const document = data.cnpj ? validateAndNormalizeDocument(data.cnpj) : null;
        if (data.cnpj && !document) {
          return reply.code(400).send({ message: "Informe um CPF ou CNPJ valido" });
        }

        const nextAiType = data.aiType ?? company.aiType;
        const nextInstanceName =
          data.evolutionInstanceName === undefined
            ? company.evolutionInstanceName
            : data.evolutionInstanceName === null
              ? null
              : data.evolutionInstanceName.trim() || null;
        const nextDocument = document?.normalized ?? company.cnpj;

        if (companyAiTypeRequiresDedicatedInstance(nextAiType) && !nextInstanceName) {
          return reply.code(400).send({ message: "Informe o nome da instancia Evolution para empresas de agendamento/cobranca" });
        }

        if (nextAiType === "nfe_import" && nextDocument.length !== 14) {
          return reply.code(400).send({ message: "Empresas no servico de NF-e devem usar CNPJ valido" });
        }

        if (nextInstanceName) {
          const existingInstance = await prisma.company.findFirst({
            where: {
              id: { not: id },
              evolutionInstanceName: nextInstanceName,
            },
            select: { id: true },
          });

          if (existingInstance) {
            return reply.code(409).send({ message: "Nome de instancia Evolution ja em uso por outra empresa" });
          }
        }

        const updated = await prisma.$transaction(async (tx) => {
          const companyUpdated = await tx.company.update({
            where: { id },
            data: {
              cnpj: document?.normalized,
              name: data.name,
              email: data.email,
              evolutionInstanceName: companyAiTypeRequiresDedicatedInstance(nextAiType) ? nextInstanceName : null,
              aiType: data.aiType,
              bookingSector: data.bookingSector,
              active: data.active,
            },
          });

          if (companyUpdated.aiType === "nfe_import") {
            await tx.dfeSyncState.upsert({
              where: { companyId: id },
              update: {
                ultimoStatus: "pending",
              },
              create: {
                companyId: id,
                ultimoStatus: "pending",
              },
            });
          }

          const companyUser = await tx.user.findFirst({ where: { companyId: id, role: "company" } });
          if (companyUser) {
            await tx.user.update({
              where: { id: companyUser.id },
              data: {
                email: data.email,
                active: data.active,
                passwordHash: data.password ? await hashPassword(data.password) : undefined,
              },
            });
          }

          return companyUpdated;
        });

        return updated;
      });

      adminApp.post("/companies/:id/whatsapp-numbers", async (request, reply) => {
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        const parsed = createNumberSchema.safeParse(request.body);

        if (!params.success || !parsed.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const phone = normalizePhone(parsed.data.phone);
        if (!phone) {
          return reply.code(400).send({ message: "Telefone invalido" });
        }

        const settings = await appConfigService.getSettings();
        if (isAgentOwnNumber(phone, settings.agentWhatsappNumber)) {
          return reply.code(400).send({ message: "Nao e permitido autorizar o numero do proprio agente" });
        }

        const company = await prisma.company.findUnique({ where: { id: params.data.id } });
        if (!company) {
          return reply.code(404).send({ message: "Empresa nao encontrada" });
        }

        const number = await prisma.companyWhatsappNumber.upsert({
          where: {
            companyId_phoneE164: {
              companyId: company.id,
              phoneE164: phone,
            },
          },
          update: {
            active: true,
          },
          create: {
            companyId: company.id,
            phoneE164: phone,
            active: true,
          },
        });

        return reply.code(201).send(number);
      });

      adminApp.patch("/companies/:id/whatsapp-numbers/:numId", async (request, reply) => {
        const params = z.object({ id: z.string().min(1), numId: z.string().min(1) }).safeParse(request.params);
        const parsed = updateNumberSchema.safeParse(request.body);

        if (!params.success || !parsed.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const number = await prisma.companyWhatsappNumber.findUnique({ where: { id: params.data.numId } });
        if (!number || number.companyId !== params.data.id) {
          return reply.code(404).send({ message: "Numero nao encontrado" });
        }

        const nextPhone = parsed.data.phone !== undefined ? normalizePhone(parsed.data.phone) : undefined;
        if (parsed.data.phone !== undefined && !nextPhone) {
          return reply.code(400).send({ message: "Telefone invalido" });
        }

        const settings = await appConfigService.getSettings();
        if (nextPhone && isAgentOwnNumber(nextPhone, settings.agentWhatsappNumber)) {
          return reply.code(400).send({ message: "Nao e permitido usar o numero do proprio agente" });
        }

        if (nextPhone && nextPhone !== number.phoneE164) {
          const exists = await prisma.companyWhatsappNumber.findFirst({
            where: {
              companyId: params.data.id,
              phoneE164: nextPhone,
              id: { not: number.id },
            },
          });

          if (exists) {
            return reply.code(409).send({ message: "Este numero ja esta cadastrado para a empresa" });
          }
        }

        const updated = await prisma.companyWhatsappNumber.update({
          where: { id: number.id },
          data: {
            phoneE164: nextPhone,
            active: parsed.data.active,
          },
        });

        return updated;
      });

      adminApp.delete("/companies/:id/whatsapp-numbers/:numId", async (request, reply) => {
        const params = z.object({ id: z.string().min(1), numId: z.string().min(1) }).safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const number = await prisma.companyWhatsappNumber.findUnique({ where: { id: params.data.numId } });
        if (!number || number.companyId !== params.data.id) {
          return reply.code(404).send({ message: "Numero nao encontrado" });
        }

        await prisma.companyWhatsappNumber.delete({ where: { id: number.id } });
        return reply.code(204).send();
      });

      adminApp.put("/prompts/global", async (request, reply) => {
        const parsed = promptSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const category = parsed.data.category ?? null;

        const last = await prisma.aiPrompt.findFirst({
          where: { scope: "global", category },
          orderBy: { version: "desc" },
        });

        await prisma.aiPrompt.updateMany({
          where: { scope: "global", category, active: true },
          data: { active: false },
        });

        const created = await prisma.aiPrompt.create({
          data: {
            scope: "global",
            category,
            promptText: parsed.data.promptText,
            version: (last?.version ?? 0) + 1,
            active: true,
          },
        });

        return created;
      });

      adminApp.get("/prompts/global", async (request) => {
        const query = z.object({ category: z.nativeEnum(CompanyAiType).optional() }).safeParse(request.query);
        const category = query.success ? (query.data.category ?? null) : null;

        const prompt = await prisma.aiPrompt.findFirst({
          where: { scope: "global", category, active: true },
          orderBy: { createdAt: "desc" },
        });

        return {
          promptText: prompt?.promptText ?? null,
          version: prompt?.version ?? null,
        };
      });

      adminApp.put("/companies/:id/prompt", async (request, reply) => {
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        const parsed = promptSchema.safeParse(request.body);

        if (!params.success || !parsed.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const company = await prisma.company.findUnique({ where: { id: params.data.id } });
        if (!company) {
          return reply.code(404).send({ message: "Empresa nao encontrada" });
        }

        const last = await prisma.aiPrompt.findFirst({
          where: { scope: "company", companyId: company.id },
          orderBy: { version: "desc" },
        });

        await prisma.aiPrompt.updateMany({
          where: { scope: "company", companyId: company.id, active: true },
          data: { active: false },
        });

        const created = await prisma.aiPrompt.create({
          data: {
            scope: "company",
            companyId: company.id,
            promptText: parsed.data.promptText,
            version: (last?.version ?? 0) + 1,
            active: true,
            category: company.aiType || null, // Auto-assign category from company type
          },
        });

        return created;
      });

      adminApp.get("/companies/:id/prompt", async (request, reply) => {
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Parametro invalido" });
        }

        const company = await prisma.company.findUnique({
          where: { id: params.data.id },
          select: { aiType: true },
        });

        const prompt = await prisma.aiPrompt.findFirst({
          where: {
            scope: "company",
            companyId: params.data.id,
            active: true,
            // If company has aiType, try to match category. If not, find any company prompt.
            category: company?.aiType || undefined,
          },
          orderBy: { createdAt: "desc" },
        });

        return {
          promptText: prompt?.promptText ?? null,
          version: prompt?.version ?? null,
        };
      });

      adminApp.get("/settings/operational", async () => {
        const settings = await appConfigService.getSettings();
        return settings;
      });

      adminApp.put("/settings/operational", async (request, reply) => {
        const parsed = operationalSettingsUpdateSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Payload invalido", errors: parsed.error.flatten().fieldErrors });
        }

        const settings = await appConfigService.updateSettings(parsed.data);
        return settings;
      });

      adminApp.get("/monitoring/overview", async (request, reply) => {
        const queryParsed = monitoringQuerySchema.safeParse(request.query);
        if (!queryParsed.success) {
          return reply.code(400).send({ message: "Query invalida", errors: queryParsed.error.flatten().fieldErrors });
        }

        const { jobsPage, jobsPageSize } = queryParsed.data;
        const jobsSkip = (jobsPage - 1) * jobsPageSize;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const settings = await appConfigService.getSettings();

        const [companies, nfeByCompanyStatus, jobs24ByStatus, recentJobs, recentJobsTotal, message24ByDirection, failedMessages24, session] =
          await Promise.all([
            prisma.company.findMany({
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                name: true,
                cnpj: true,
                active: true,
                createdAt: true,
                whatsappNumbers: {
                  select: {
                    id: true,
                    phoneE164: true,
                    active: true,
                  },
                },
                certificates: {
                  where: { active: true },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: {
                    id: true,
                    createdAt: true,
                    validFrom: true,
                    validTo: true,
                  },
                },
                dfeSyncState: {
                  select: {
                    ultimoSyncAt: true,
                    ultimoSucessoAt: true,
                    ultimoStatus: true,
                  },
                },
              },
            }),
            prisma.nfeDocument.groupBy({
              by: ["companyId", "status"],
              _count: { _all: true },
            }),
            prisma.jobRun.groupBy({
              by: ["status"],
              where: {
                jobName: "hourly_nfe_sync",
                startedAt: { gte: since },
              },
              _count: { _all: true },
            }),
            prisma.jobRun.findMany({
              where: {
                jobName: "hourly_nfe_sync",
              },
              orderBy: { startedAt: "desc" },
              skip: jobsSkip,
              take: jobsPageSize,
              select: {
                id: true,
                companyId: true,
                status: true,
                startedAt: true,
                endedAt: true,
                error: true,
                company: {
                  select: {
                    name: true,
                  },
                },
              },
            }),
            prisma.jobRun.count({
              where: {
                jobName: "hourly_nfe_sync",
              },
            }),
            prisma.messageLog.groupBy({
              by: ["direction"],
              where: {
                createdAt: { gte: since },
              },
              _count: { _all: true },
            }),
            prisma.messageLog.count({
              where: {
                createdAt: { gte: since },
                status: "failed",
              },
            }),
            prisma.whatsappSession.findUnique({
              where: { sessionName: settings.evolutionInstanceName },
              select: {
                status: true,
                connectedAt: true,
                updatedAt: true,
              },
            }),
          ]);

        const companyIds = companies.map((company) => company.id);
        const lastJobsRows =
          companyIds.length > 0
            ? await prisma.jobRun.findMany({
              where: {
                jobName: "hourly_nfe_sync",
                companyId: { in: companyIds },
              },
              orderBy: { startedAt: "desc" },
              select: {
                id: true,
                companyId: true,
                status: true,
                startedAt: true,
                endedAt: true,
                error: true,
              },
            })
            : [];
        const recentJobsSafe = recentJobs.map((job) => ({
          ...job,
          error: sanitizeSyncJobError(job.error),
        }));
        const lastJobsRowsSafe = lastJobsRows.map((job) => ({
          ...job,
          error: sanitizeSyncJobError(job.error),
        }));

        const lastJobByCompany = new Map<string, (typeof lastJobsRows)[number]>();
        for (const job of lastJobsRowsSafe) {
          if (!job.companyId || lastJobByCompany.has(job.companyId)) {
            continue;
          }

          lastJobByCompany.set(job.companyId, job);
        }

        const nfeByCompany = nfeByCompanyStatus.reduce<Record<string, Record<string, number>>>((acc, item) => {
          if (!acc[item.companyId]) {
            acc[item.companyId] = {};
          }

          acc[item.companyId][item.status] = item._count._all;
          return acc;
        }, {});

        const jobs24Map = toStatusCountMap(jobs24ByStatus);
        const messageDirectionMap = message24ByDirection.reduce<Record<string, number>>((acc, item) => {
          acc[item.direction] = item._count._all;
          return acc;
        }, {});

        const certificateTotals = {
          valid: 0,
          expiring: 0,
          expired: 0,
          unknown: 0,
          missing: 0,
        };
        let companiesCoolingDown = 0;

        const companyHealth = companies.map((company) => {
          const certificate = company.certificates[0] ?? null;
          const certificateStatus = certificate ? getCertificateStatus(certificate.validTo) : "missing";
          const daysRemaining = certificate ? getDaysRemaining(certificate.validTo) : null;
          const nfeCounts = nfeByCompany[company.id] ?? {};
          const lastJob = lastJobByCompany.get(company.id) ?? null;
          const nextAllowedSyncAt = getNextAllowedSyncAt({
            minIntervalSeconds: settings.syncMinIntervalSeconds,
            lastSuccessAt: company.dfeSyncState?.ultimoSucessoAt,
            lastSyncAt: company.dfeSyncState?.ultimoSyncAt,
            status: company.dfeSyncState?.ultimoStatus,
          });
          const waitSeconds = getNextSyncWaitSeconds({
            minIntervalSeconds: settings.syncMinIntervalSeconds,
            lastSuccessAt: company.dfeSyncState?.ultimoSucessoAt,
            lastSyncAt: company.dfeSyncState?.ultimoSyncAt,
            status: company.dfeSyncState?.ultimoStatus,
          });

          if ((waitSeconds ?? 0) > 0) {
            companiesCoolingDown += 1;
          }

          if (certificateStatus === "missing") certificateTotals.missing += 1;
          if (certificateStatus === "valid") certificateTotals.valid += 1;
          if (certificateStatus === "expiring") certificateTotals.expiring += 1;
          if (certificateStatus === "expired") certificateTotals.expired += 1;
          if (certificateStatus === "unknown") certificateTotals.unknown += 1;

          return {
            companyId: company.id,
            name: company.name,
            cnpj: company.cnpj,
            active: company.active,
            certificate: {
              id: certificate?.id ?? null,
              status: certificateStatus,
              validFrom: certificate?.validFrom ?? null,
              validTo: certificate?.validTo ?? null,
              daysRemaining,
              createdAt: certificate?.createdAt ?? null,
            },
            whatsappNumbers: {
              total: company.whatsappNumbers.length,
              active: company.whatsappNumbers.filter((item) => item.active).length,
            },
            sync: {
              lastSyncAt: company.dfeSyncState?.ultimoSyncAt ?? null,
              lastSuccessAt: company.dfeSyncState?.ultimoSucessoAt ?? null,
              lastSyncStatus: company.dfeSyncState?.ultimoStatus ?? null,
              nextAllowedSyncAt: nextAllowedSyncAt ? nextAllowedSyncAt.toISOString() : null,
              waitSeconds,
              isCoolingDown: (waitSeconds ?? 0) > 0,
              lastJob,
            },
            nfes: {
              imported: nfeCounts.imported ?? 0,
              detected: nfeCounts.detected ?? 0,
              failed: nfeCounts.failed ?? 0,
              total: (nfeCounts.imported ?? 0) + (nfeCounts.detected ?? 0) + (nfeCounts.failed ?? 0),
            },
          };
        });

        return {
          generatedAt: new Date().toISOString(),
          whatsappSession: {
            status: session?.status ?? "unknown",
            connectedAt: session?.connectedAt ?? null,
            updatedAt: session?.updatedAt ?? null,
          },
          totals: {
            companies: companies.length,
            activeCompanies: companies.filter((company) => company.active).length,
            certificates: certificateTotals,
            companiesCoolingDown,
            jobs24h: {
              total: (jobs24Map.running ?? 0) + (jobs24Map.success ?? 0) + (jobs24Map.failed ?? 0),
              running: jobs24Map.running ?? 0,
              success: jobs24Map.success ?? 0,
              failed: jobs24Map.failed ?? 0,
            },
            messages24h: {
              inbound: messageDirectionMap.in ?? 0,
              outbound: messageDirectionMap.out ?? 0,
              failed: failedMessages24,
            },
          },
          recentJobs: recentJobsSafe,
          jobsPagination: {
            page: jobsPage,
            pageSize: jobsPageSize,
            total: recentJobsTotal,
            totalPages: Math.max(1, Math.ceil(recentJobsTotal / jobsPageSize)),
          },
          companyHealth,
        };
      });

      adminApp.get("/monitoring/queues", async () => {
        const [queueCounts, dispatchByStatus] = await Promise.all([
          getOutboundQueueCounts().catch(() => ({
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            paused: 0,
          })),
          prisma.messageDispatch.groupBy({
            by: ["status"],
            _count: { _all: true },
          }),
        ]);

        const dispatchMap = dispatchByStatus.reduce<Record<string, number>>((acc, row) => {
          acc[row.status] = row._count._all;
          return acc;
        }, {});

        return {
          generatedAt: new Date().toISOString(),
          outboundQueue: queueCounts,
          dispatch: {
            queued: dispatchMap.queued ?? 0,
            sending: dispatchMap.sending ?? 0,
            sent: dispatchMap.sent ?? 0,
            retry: dispatchMap.retry ?? 0,
            failed: dispatchMap.failed ?? 0,
            dead: dispatchMap.dead ?? 0,
          },
        };
      });

      adminApp.get("/monitoring/dispatches", async (request, reply) => {
        const parsed = dispatchQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Query invalida", errors: parsed.error.flatten().fieldErrors });
        }

        const { page, pageSize, status, companyId } = parsed.data;
        const skip = (page - 1) * pageSize;

        const where = {
          status,
          companyId,
        };

        const [rows, total] = await Promise.all([
          prisma.messageDispatch.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: pageSize,
            select: {
              id: true,
              companyId: true,
              instanceName: true,
              toPhoneE164: true,
              intent: true,
              status: true,
              attempts: true,
              maxAttempts: true,
              nextAttemptAt: true,
              sentAt: true,
              errorCode: true,
              errorMessage: true,
              createdAt: true,
              updatedAt: true,
              company: {
                select: {
                  name: true,
                },
              },
            },
          }),
          prisma.messageDispatch.count({ where }),
        ]);

        return {
          data: rows,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
          },
        };
      });

      adminApp.get("/limits/policies", async () => {
        const policies = await prisma.rateLimitPolicy.findMany({
          where: { active: true },
          orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
        });

        return { policies };
      });

      adminApp.put("/limits/policies", async (request, reply) => {
        const parsed = replaceRateLimitPoliciesSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Payload invalido", errors: parsed.error.flatten().fieldErrors });
        }

        const normalizedPolicies = parsed.data.policies.map((policy) => ({
          ...policy,
          instanceName: policy.instanceName ?? null,
          companyId: policy.companyId ?? null,
        }));

        for (const policy of normalizedPolicies) {
          const error = validateRatePolicyItem(policy);
          if (error) {
            return reply.code(400).send({ message: error, policy });
          }
        }

        const companyIds = Array.from(
          new Set(normalizedPolicies.filter((policy) => Boolean(policy.companyId)).map((policy) => policy.companyId!)),
        );

        if (companyIds.length > 0) {
          const existingCompanies = await prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: { id: true },
          });
          const existingSet = new Set(existingCompanies.map((item) => item.id));
          const missing = companyIds.find((id) => !existingSet.has(id));

          if (missing) {
            return reply.code(400).send({ message: `Empresa nao encontrada para politica: ${missing}` });
          }
        }

        await prisma.$transaction(async (tx) => {
          await tx.rateLimitPolicy.updateMany({
            where: { active: true },
            data: { active: false },
          });

          if (normalizedPolicies.length > 0) {
            await tx.rateLimitPolicy.createMany({
              data: normalizedPolicies.map((policy) => ({
                scope: policy.scope,
                instanceName: policy.instanceName,
                companyId: policy.companyId,
                maxPerMinute: policy.maxPerMinute,
                minDelayMs: policy.minDelayMs,
                maxDelayMs: policy.maxDelayMs,
                burst: policy.burst,
                active: policy.active,
              })),
            });
          }
        });

        const policies = await prisma.rateLimitPolicy.findMany({
          where: { active: true },
          orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
        });

        return { policies };
      });

      adminApp.get("/whatsapp/session", async () => {
        const settings = await appConfigService.getSettings();
        const sessionName = settings.evolutionInstanceName;
        const status = await evolutionService.getSessionStatus();
        const normalizedStatus = normalizeSessionStatus(status.status);

        const session = await prisma.whatsappSession.upsert({
          where: { sessionName },
          update: {
            status: normalizedStatus,
          },
          create: {
            sessionName,
            status: normalizedStatus,
          },
        });

        return { session, raw: status.raw };
      });

      const connectWhatsappSessionHandler = async (_request: unknown, reply: any) => {
        const settings = await appConfigService.getSettings();
        const sessionName = settings.evolutionInstanceName;

        try {
          const started = await evolutionService.startSession();
          const qrResult = await evolutionService.getQrCode();
          let status = normalizeSessionStatus(
            qrResult.status && qrResult.status !== "unknown"
              ? qrResult.status
              : started.status || (qrResult.qr ? "qrcode" : "connecting"),
          );
          let connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName },
            update: {
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName,
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
          });

          const message = connected
            ? "WhatsApp conectado com sucesso."
            : session.qrLast
              ? "Escaneie o QR code para concluir a conexao."
              : "Sessao iniciada. Aguarde alguns segundos e atualize.";

          return reply.send({
            ok: true,
            qr: session.qrLast,
            status: session.status,
            message,
            alreadyConnected: started.alreadyConnected,
            raw: {
              start: started.raw,
              qrcode: qrResult.raw,
            },
          });
        } catch (error) {
          const current = await evolutionService.getSessionStatus();
          const currentStatus = normalizeSessionStatus(current.status || "unknown");
          const currentConnected = isConnectedStatus(currentStatus);
          const qrResult = await evolutionService.getQrCode().catch(() => ({
            qr: null as string | null,
            raw: null as unknown,
            status: currentStatus,
          }));
          const status = normalizeSessionStatus(
            qrResult.status && qrResult.status !== "unknown" ? qrResult.status : currentStatus,
          );
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName },
            update: {
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName,
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
          });

          if (connected || session.qrLast) {
            return reply.send({
              ok: true,
              qr: session.qrLast,
              status: session.status,
              alreadyConnected: connected || currentConnected,
              message: connected
                ? "Sessao ja estava conectada."
                : "Escaneie o QR code para concluir a conexao.",
              raw: {
                status: current.raw,
                qrcode: qrResult.raw,
              },
            });
          }

          return reply.code(502).send({
            message: "Falha ao iniciar sessao Evolution",
            error: error instanceof Error ? error.message : "Erro desconhecido",
          });
        }
      };

      adminApp.post("/whatsapp/session/start", connectWhatsappSessionHandler);
      adminApp.post("/whatsapp/session/connect", connectWhatsappSessionHandler);

      adminApp.post("/whatsapp/session/disconnect", async (_request, reply) => {
        const settings = await appConfigService.getSettings();
        const sessionName = settings.evolutionInstanceName;

        try {
          const disconnected = await evolutionService.disconnectSession();
          const current = await evolutionService.getSessionStatus().catch(() => disconnected);
          const status = normalizeSessionStatus(current.status || disconnected.status || "unknown");
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName },
            update: {
              status,
              qrLast: connected ? undefined : null,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName,
              status,
              qrLast: connected ? null : null,
              connectedAt: connected ? new Date() : null,
            },
          });

          return reply.send({
            ok: !connected,
            status: session.status,
            message: connected
              ? "A API informou sessao ainda conectada. Tente novamente em alguns segundos."
              : "WhatsApp desconectado com sucesso.",
            raw: {
              disconnect: disconnected.raw,
              status: current.raw,
            },
          });
        } catch (error) {
          return reply.code(502).send({
            message: "Falha ao desconectar sessao Evolution",
            error: error instanceof Error ? error.message : "Erro desconhecido",
          });
        }
      });

      adminApp.get("/whatsapp/session/qrcode", async (_request) => {
        const settings = await appConfigService.getSettings();
        const sessionName = settings.evolutionInstanceName;

        try {
          const qrResult = await evolutionService.getQrCode();
          const status = normalizeSessionStatus(
            qrResult.status && qrResult.status !== "unknown"
              ? qrResult.status
              : qrResult.qr
                ? "qrcode"
                : "unknown",
          );
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName },
            update: {
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName,
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
          });

          const message = !session.qrLast
            ? connected
              ? "Sessao conectada. QR code nao necessario."
              : "Sem QR code ativo. Clique em Conectar WhatsApp."
            : null;

          return {
            qr: session.qrLast,
            status: session.status,
            message,
            raw: qrResult.raw,
          };
        } catch (error) {
          const current = await evolutionService.getSessionStatus();
          const status = normalizeSessionStatus(current.status || "unknown");
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName },
            update: {
              status,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName,
              status,
              connectedAt: connected ? new Date() : null,
            },
          });

          return {
            qr: session.qrLast,
            status: session.status,
            message: connected
              ? "Sessao conectada. QR code nao necessario."
              : "Nao foi possivel obter QR code agora. Verifique configuracao do Evolution e tente novamente.",
            raw: current.raw,
            error: error instanceof Error ? error.message : "Erro desconhecido",
          };
        }
      });
    },
    { prefix: "/admin" },
  );
}
