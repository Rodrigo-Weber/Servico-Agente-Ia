import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as boletoUtils from "@mrmgomes/boleto-utils";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { normalizePhone } from "../../lib/phone.js";
import { evolutionService } from "../../services/evolution.service.js";
import { authenticate, requireRole } from "../auth/guards.js";
import { outboundDispatchService } from "../messages/outbound-dispatch.service.js";
import { generateBillingBoletoPdf } from "./boleto-pdf.service.js";
import { importBillingCsvForCompany } from "./csv-import.service.js";

interface BillingCompanyContext {
  id: string;
  evolutionInstanceName: string | null;
}

const updateClientSchema = z
  .object({
    autoSendEnabled: z.boolean().optional(),
    phone: z.string().trim().nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos um campo para atualizar",
  });

const sendCrmMessageSchema = z.object({
  phone: z.string().min(8),
  content: z.string().trim().min(1).max(4096),
});

const crmPhoneParamsSchema = z.object({
  phone: z.string().min(8),
});

const importCsvSchema = z.object({
  fornecedoresPath: z.string().trim().min(1).optional(),
  documentosPath: z.string().trim().min(1).optional(),
});

const BILLING_TEST_NOTIFICATION_PHONE = "5571983819052";

const BANK_NAMES_BY_CODE: Record<string, string> = {
  "001": "Banco do Brasil",
  "033": "Santander",
  "041": "Banrisul",
  "104": "Caixa Economica Federal",
  "237": "Bradesco",
  "341": "Itau",
  "756": "Sicoob",
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("pt-BR");
}

function digitsOnly(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

function normalizePersonName(value: string): string {
  const clean = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");

  if (!clean) {
    return "Cliente";
  }

  return clean
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function formatLinhaDigitavel(value: string): string {
  const digits = digitsOnly(value);

  if (digits.length === 47) {
    return `${digits.slice(0, 5)}.${digits.slice(5, 10)} ${digits.slice(10, 15)}.${digits.slice(15, 21)} ${digits.slice(21, 26)}.${digits.slice(26, 32)} ${digits.slice(32, 33)} ${digits.slice(33)}`;
  }

  if (digits.length === 48) {
    return `${digits.slice(0, 11)}-${digits.slice(11, 12)} ${digits.slice(12, 23)}-${digits.slice(23, 24)} ${digits.slice(24, 35)}-${digits.slice(35, 36)} ${digits.slice(36, 47)}-${digits.slice(47, 48)}`;
  }

  return value;
}

function safeValidateBoleto(code: string): {
  linhaDigitavel?: string;
  codigoBarras?: string;
  sucesso?: boolean;
} | null {
  try {
    const result = boletoUtils.validarBoleto(code) as {
      linhaDigitavel?: string;
      codigoBarras?: string;
      sucesso?: boolean;
    };

    return result?.sucesso ? result : null;
  } catch {
    return null;
  }
}

function resolveBoletoData(input: {
  boletoLine: string | null;
  barcode: string | null;
}): {
  linhaDigitavel: string | null;
  codigoBarras: string | null;
} {
  let line = digitsOnly(input.boletoLine);
  let barcode = digitsOnly(input.barcode);

  const validatedFromLine = line ? safeValidateBoleto(line) : null;
  const validated = validatedFromLine ?? (barcode ? safeValidateBoleto(barcode) : null);

  if (validated) {
    line = digitsOnly(validated.linhaDigitavel) || line;
    barcode = digitsOnly(validated.codigoBarras) || barcode;
  }

  if (!line && barcode.length === 44) {
    try {
      line = digitsOnly(boletoUtils.codBarras2LinhaDigitavel(barcode, false));
    } catch {
      // fallback para manter apenas codigo de barras
    }
  }

  if (!barcode && line.length >= 46) {
    try {
      barcode = digitsOnly(boletoUtils.linhaDigitavel2CodBarras(line));
    } catch {
      // fallback para manter apenas linha digitavel
    }
  }

  return {
    linhaDigitavel: line ? formatLinhaDigitavel(line) : null,
    codigoBarras: barcode || null,
  };
}

function resolveBankFromBoleto(input: { linhaDigitavel: string | null; codigoBarras: string | null }): {
  code: string | null;
  name: string | null;
} {
  const lineDigits = digitsOnly(input.linhaDigitavel);
  const barcodeDigits = digitsOnly(input.codigoBarras);

  let code: string | null = null;
  if (lineDigits.length >= 3) {
    code = lineDigits.slice(0, 3);
  } else if (barcodeDigits.length === 44) {
    code = barcodeDigits.slice(0, 3);
  }

  if (!code) {
    return { code: null, name: null };
  }

  return {
    code,
    name: BANK_NAMES_BY_CODE[code] ?? `Banco ${code}`,
  };
}

function buildNotificationMessage(input: {
  supplierName: string;
  description: string;
  amount: number;
  dueDate: Date;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
}): string {
  const customerName = normalizePersonName(input.supplierName);
  const firstName = customerName.split(/\s+/)[0] || "Cliente";
  const bank = resolveBankFromBoleto({
    linhaDigitavel: input.linhaDigitavel,
    codigoBarras: input.codigoBarras,
  });
  const reference = truncateText(input.description, 90);

  const lines = [
    "📌 *AVISO DE COBRANCA*",
    "",
    `Olá, *${firstName}*.`,
    "",
    "Segue o boleto em PDF com os dados para pagamento:",
    `• *Referência:* ${reference}`,
    `• *Valor:* ${formatMoney(input.amount)}`,
    `• *Vencimento:* ${formatDate(input.dueDate)}`,
  ];

  if (bank.name) {
    lines.push(`• *Banco:* ${bank.name}${bank.code ? ` (${bank.code})` : ""}`);
  }

  if (input.linhaDigitavel) {
    lines.push(`• *Linha digitável:* \`${input.linhaDigitavel}\``);
  }

  if (input.codigoBarras) {
    lines.push(`• *Código de barras:* \`${input.codigoBarras}\``);
  }

  lines.push("");
  lines.push("📎 *Boleto anexado nesta conversa.*");
  lines.push("Se o pagamento já foi realizado, desconsidere esta mensagem.");
  lines.push("Em caso de dúvida, responda este WhatsApp.");
  lines.push("");
  lines.push("*Departamento Financeiro*");

  return lines.join("\n");
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

  if (!normalized.startsWith("55") && (normalized.length === 10 || normalized.length === 11)) {
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

async function getBillingCompanyContext(request: FastifyRequest, reply: FastifyReply): Promise<BillingCompanyContext | null> {
  const companyId = request.authUser?.companyId;
  if (!companyId) {
    reply.code(400).send({ message: "Conta sem empresa vinculada" });
    return null;
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      active: true,
      aiType: true,
      evolutionInstanceName: true,
    },
  });

  if (!company || !company.active) {
    reply.code(403).send({ message: "Empresa inativa" });
    return null;
  }

  if (company.aiType !== "billing") {
    reply.code(403).send({ message: "Empresa sem acesso ao modulo de cobranca" });
    return null;
  }

  return {
    id: company.id,
    evolutionInstanceName: company.evolutionInstanceName,
  };
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (billingApp) => {
      billingApp.addHook("preHandler", authenticate);
      billingApp.addHook("preHandler", requireRole("company"));

      billingApp.post("/import/csv", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const parsed = importCsvSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({
            message: "Payload invalido",
            errors: parsed.error.flatten().fieldErrors,
          });
        }

        const result = await importBillingCsvForCompany(prisma, context.id, parsed.data);
        return reply.send(result);
      });

      billingApp.get("/me", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const company = await prisma.company.findUnique({
          where: { id: context.id },
          select: {
            id: true,
            name: true,
            cnpj: true,
            email: true,
            active: true,
          },
        });

        if (!company) {
          return reply.code(404).send({ message: "Empresa nao encontrada" });
        }

        return reply.send({ company });
      });

      billingApp.get("/dashboard/summary", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const [clients, pendingAgg, paidAgg, overdueAgg] = await Promise.all([
          prisma.billingSupplier.count({ where: { companyId: context.id } }),
          prisma.billingDocument.aggregate({
            where: { companyId: context.id, status: "pending" },
            _sum: { amount: true },
            _count: { _all: true },
          }),
          prisma.billingDocument.aggregate({
            where: { companyId: context.id, status: "paid" },
            _sum: { amount: true },
            _count: { _all: true },
          }),
          prisma.billingDocument.aggregate({
            where: { companyId: context.id, status: "overdue" },
            _sum: { amount: true },
            _count: { _all: true },
          }),
        ]);

        return reply.send({
          generatedAt: new Date().toISOString(),
          totals: {
            clients,
            pendingAmount: Number(pendingAgg._sum.amount ?? 0),
            paidAmount: Number(paidAgg._sum.amount ?? 0),
            overdueAmount: Number(overdueAgg._sum.amount ?? 0),
            pendingCount: pendingAgg._count._all,
            paidCount: paidAgg._count._all,
            overdueCount: overdueAgg._count._all,
          },
        });
      });

      billingApp.get("/clients", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const suppliers = await prisma.billingSupplier.findMany({
          where: { companyId: context.id },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            externalCode: true,
            document: true,
            email: true,
            phoneE164: true,
            autoSendEnabled: true,
            documents: {
              orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
              select: {
                id: true,
                description: true,
                amount: true,
                dueDate: true,
                status: true,
                paidAt: true,
                boletoLine: true,
                barcode: true,
              },
            },
          },
        });

        const payload = suppliers.map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
          document: supplier.document ?? supplier.externalCode,
          email: supplier.email ?? "",
          phone: supplier.phoneE164 ?? "",
          autoSendEnabled: supplier.autoSendEnabled,
          documents: supplier.documents.map((document) => ({
            id: document.id,
            clientId: supplier.id,
            type: "boleto" as const,
            description: document.description,
            amount: Number(document.amount),
            dueDate: document.dueDate.toISOString(),
            status: document.status,
            paidAt: document.paidAt ? document.paidAt.toISOString() : undefined,
            barcode: document.boletoLine ?? document.barcode ?? undefined,
          })),
        }));

        return reply.send(payload);
      });

      billingApp.patch("/clients/:id", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Parametro invalido" });
        }

        const parsed = updateClientSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            message: "Payload invalido",
            errors: parsed.error.flatten().fieldErrors,
          });
        }

        const supplier = await prisma.billingSupplier.findFirst({
          where: {
            id: params.data.id,
            companyId: context.id,
          },
          select: { id: true },
        });

        if (!supplier) {
          return reply.code(404).send({ message: "Fornecedor nao encontrado" });
        }

        let phone: string | null | undefined;
        if (Object.prototype.hasOwnProperty.call(parsed.data, "phone")) {
          const rawPhone = parsed.data.phone;
          if (!rawPhone) {
            phone = null;
          } else {
            const normalized = normalizePhone(rawPhone);
            if (!normalized) {
              return reply.code(400).send({ message: "Telefone invalido" });
            }
            phone = normalized;
          }
        }

        const updated = await prisma.billingSupplier.update({
          where: { id: supplier.id },
          data: {
            autoSendEnabled: parsed.data.autoSendEnabled,
            phoneE164: phone,
            email: parsed.data.email,
          },
          select: {
            id: true,
            autoSendEnabled: true,
            phoneE164: true,
            email: true,
          },
        });

        return reply.send({
          id: updated.id,
          autoSendEnabled: updated.autoSendEnabled,
          phone: updated.phoneE164,
          email: updated.email,
        });
      });

      billingApp.post("/documents/:id/notify", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Parametro invalido" });
        }

        const document = await prisma.billingDocument.findFirst({
          where: {
            id: params.data.id,
            companyId: context.id,
          },
          select: {
            id: true,
            description: true,
            amount: true,
            dueDate: true,
            boletoLine: true,
            barcode: true,
            supplier: {
              select: {
                id: true,
                name: true,
                phoneE164: true,
              },
            },
          },
        });

        if (!document) {
          return reply.code(404).send({ message: "Documento nao encontrado" });
        }

        const targetPhone = BILLING_TEST_NOTIFICATION_PHONE;

        const boletoData = resolveBoletoData({
          boletoLine: document.boletoLine,
          barcode: document.barcode,
        });

        const message = buildNotificationMessage({
          supplierName: document.supplier.name,
          description: document.description,
          amount: Number(document.amount),
          dueDate: document.dueDate,
          linhaDigitavel: boletoData.linhaDigitavel,
          codigoBarras: boletoData.codigoBarras,
        });

        const outLog = await prisma.messageLog.create({
          data: {
            companyId: context.id,
            phoneE164: targetPhone,
            direction: "out",
            messageType: "media",
            intent: "billing_notify",
            content: message,
            status: "received",
          },
          select: {
            id: true,
          },
        });

        const dueDateTag = [
          document.dueDate.getFullYear(),
          String(document.dueDate.getMonth() + 1).padStart(2, "0"),
          String(document.dueDate.getDate()).padStart(2, "0"),
        ].join("");

        const boletoPdf = await generateBillingBoletoPdf({
          documentId: document.id,
          supplierName: document.supplier.name,
          description: document.description,
          amount: Number(document.amount),
          dueDate: document.dueDate,
          linhaDigitavel: boletoData.linhaDigitavel,
          codigoBarras: boletoData.codigoBarras,
        });

        try {
          await evolutionService.sendDocument(
            targetPhone,
            {
              base64: Buffer.from(boletoPdf).toString("base64"),
              fileName: `boleto-${document.id}-${dueDateTag}.pdf`,
              mimeType: "application/pdf",
              caption: message,
            },
            context.evolutionInstanceName ?? undefined,
          );

          await prisma.messageLog.update({
            where: { id: outLog.id },
            data: { status: "processed" },
          });
        } catch (error) {
          await prisma.messageLog.update({
            where: { id: outLog.id },
            data: { status: "failed" },
          });

          const errMessage = error instanceof Error ? error.message : "Falha ao enviar boleto em PDF";
          return reply.code(502).send({ message: errMessage });
        }

        await prisma.billingDocument.update({
          where: { id: document.id },
          data: {
            notificationCount: {
              increment: 1,
            },
            notificationLastAt: new Date(),
          },
        });

        return reply.send({
          ok: true,
          phone: targetPhone,
          fallbackPhoneUsed: false,
          message,
          mediaType: "application/pdf",
        });
      });

      billingApp.get("/crm/conversations", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const [latestMessages, memories, suppliers] = await Promise.all([
          prisma.messageLog.findMany({
            where: { companyId: context.id },
            orderBy: [{ phoneE164: "asc" }, { createdAt: "desc" }],
            distinct: ["phoneE164"],
            select: {
              phoneE164: true,
              content: true,
              createdAt: true,
            },
          }),
          prisma.conversationMemory.findMany({
            where: { companyId: context.id },
            select: {
              phoneE164: true,
              userName: true,
              lastActivityAt: true,
            },
          }),
          prisma.billingSupplier.findMany({
            where: {
              companyId: context.id,
              phoneE164: {
                not: null,
              },
            },
            select: {
              phoneE164: true,
              name: true,
            },
          }),
        ]);

        const latestByPhone = new Map(latestMessages.map((item) => [item.phoneE164, item]));
        const memoryByPhone = new Map(memories.map((item) => [item.phoneE164, item]));
        const supplierNameByPhone = new Map(
          suppliers
            .filter((item) => Boolean(item.phoneE164))
            .map((item) => [item.phoneE164 as string, item.name]),
        );

        const phones = new Set<string>([
          ...latestMessages.map((item) => item.phoneE164),
          ...memories.map((item) => item.phoneE164),
          ...suppliers.map((item) => item.phoneE164 || "").filter((item): item is string => item.length > 0),
        ]);

        const conversations = Array.from(phones)
          .map((phone) => {
            const latest = latestByPhone.get(phone);
            const memory = memoryByPhone.get(phone);

            return {
              id: phone,
              phoneE164: phone,
              userName: memory?.userName || supplierNameByPhone.get(phone) || null,
              lastMessage: latest?.content || "Sem mensagens ainda",
              lastActivityAt: (memory?.lastActivityAt || latest?.createdAt || new Date(0)).toISOString(),
            };
          })
          .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

        return reply.send(conversations);
      });

      billingApp.get("/crm/messages/:phone", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const params = crmPhoneParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Parametro invalido" });
        }

        const variants = buildPhoneVariants(params.data.phone);
        if (variants.length === 0) {
          return reply.send([]);
        }

        const messages = await prisma.messageLog.findMany({
          where: {
            companyId: context.id,
            OR: variants.map((value) => ({ phoneE164: value })),
          },
          orderBy: { createdAt: "asc" },
          take: 500,
          select: {
            id: true,
            direction: true,
            content: true,
            createdAt: true,
            status: true,
          },
        });

        return reply.send(
          messages.map((message) => ({
            id: message.id,
            direction: message.direction,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
            status: message.status,
          })),
        );
      });

      billingApp.delete("/crm/conversations/:phone", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const params = crmPhoneParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Parametro invalido" });
        }

        const variants = buildPhoneVariants(params.data.phone);
        if (variants.length === 0) {
          return reply.code(400).send({ message: "Telefone invalido" });
        }

        const phoneFilters = variants.map((phone) => ({ phoneE164: phone }));

        const [deletedMessages, deletedMemories] = await prisma.$transaction([
          prisma.messageLog.deleteMany({
            where: {
              companyId: context.id,
              OR: phoneFilters,
            },
          }),
          prisma.conversationMemory.deleteMany({
            where: {
              companyId: context.id,
              OR: phoneFilters,
            },
          }),
        ]);

        return reply.send({
          ok: true,
          deletedMessages: deletedMessages.count,
          deletedMemories: deletedMemories.count,
        });
      });

      billingApp.post("/crm/messages", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const parsed = sendCrmMessageSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            message: "Payload invalido",
            errors: parsed.error.flatten().fieldErrors,
          });
        }

        const phone = normalizePhone(parsed.data.phone);
        if (!phone) {
          return reply.code(400).send({ message: "Telefone invalido" });
        }

        const outLog = await prisma.messageLog.create({
          data: {
            companyId: context.id,
            phoneE164: phone,
            direction: "out",
            messageType: "text",
            intent: "crm_manual",
            content: parsed.data.content,
            status: "received",
          },
          select: {
            id: true,
            direction: true,
            content: true,
            createdAt: true,
            status: true,
          },
        });

        await outboundDispatchService.enqueueOutboundText({
          companyId: context.id,
          instanceName: context.evolutionInstanceName ?? undefined,
          phone,
          text: parsed.data.content,
          intent: "crm_manual",
          messageLogId: outLog.id,
        });

        return reply.send({
          id: outLog.id,
          direction: outLog.direction,
          content: outLog.content,
          createdAt: outLog.createdAt.toISOString(),
          status: outLog.status,
        });
      });
    },
    { prefix: "/billing" },
  );
}
