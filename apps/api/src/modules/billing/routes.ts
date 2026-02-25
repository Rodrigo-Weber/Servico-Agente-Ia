import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { normalizePhone } from "../../lib/phone.js";
import { evolutionService } from "../../services/evolution.service.js";
import { authenticate, requireRole } from "../auth/guards.js";
import { buildStoredMessagePreview, parseStoredMessageContent } from "../messages/message-content.js";
import { outboundDispatchService } from "../messages/outbound-dispatch.service.js";
import { importBillingCsvForCompany } from "./csv-import.service.js";
import { BILLING_TEST_NOTIFICATION_PHONE, sendBillingDocumentNotification } from "./notification.service.js";

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

function sanitizeDownloadFileName(fileName: string | null | undefined): string {
  const raw = (fileName || "").trim();
  if (!raw) {
    return "arquivo.bin";
  }

  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_");
  return safe.length > 0 ? safe : "arquivo.bin";
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
            evolutionInstanceName: true,
          },
        });

        if (!company) {
          return reply.code(404).send({ message: "Empresa nao encontrada" });
        }

        return reply.send({ company });
      });

      billingApp.get("/whatsapp/session", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const instanceName = context.evolutionInstanceName?.trim() || null;
        if (!instanceName) {
          return reply.code(400).send({ message: "Instancia WhatsApp nao configurada pelo admin para esta empresa" });
        }

        const status = await evolutionService.getSessionStatus(instanceName);
        const normalizedStatus = normalizeSessionStatus(status.status);

        const session = await prisma.whatsappSession.upsert({
          where: { sessionName: instanceName },
          update: {
            status: normalizedStatus,
          },
          create: {
            sessionName: instanceName,
            status: normalizedStatus,
          },
        });

        return reply.send({ session, raw: status.raw });
      });

      const connectBillingWhatsappSessionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const instanceName = context.evolutionInstanceName?.trim() || null;
        if (!instanceName) {
          return reply.code(400).send({ message: "Instancia WhatsApp nao configurada pelo admin para esta empresa" });
        }

        try {
          const started = await evolutionService.startSession(instanceName);
          const qrResult = await evolutionService.getQrCode(instanceName);
          const status = normalizeSessionStatus(
            qrResult.status && qrResult.status !== "unknown"
              ? qrResult.status
              : started.status || (qrResult.qr ? "qrcode" : "connecting"),
          );
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName: instanceName },
            update: {
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName: instanceName,
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
            alreadyConnected: started.alreadyConnected,
            message,
            raw: {
              start: started.raw,
              qrcode: qrResult.raw,
            },
          });
        } catch (error) {
          const current = await evolutionService.getSessionStatus(instanceName);
          const currentStatus = normalizeSessionStatus(current.status || "unknown");
          const qrResult = await evolutionService.getQrCode(instanceName).catch(() => ({
            qr: null as string | null,
            raw: null as unknown,
            status: currentStatus,
          }));
          const status = normalizeSessionStatus(
            qrResult.status && qrResult.status !== "unknown" ? qrResult.status : currentStatus,
          );
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName: instanceName },
            update: {
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName: instanceName,
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
              alreadyConnected: connected,
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

      billingApp.post("/whatsapp/session/start", connectBillingWhatsappSessionHandler);
      billingApp.post("/whatsapp/session/connect", connectBillingWhatsappSessionHandler);

      billingApp.post("/whatsapp/session/disconnect", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const instanceName = context.evolutionInstanceName?.trim() || null;
        if (!instanceName) {
          return reply.code(400).send({ message: "Instancia WhatsApp nao configurada pelo admin para esta empresa" });
        }

        try {
          const disconnected = await evolutionService.disconnectSession(instanceName);
          const current = await evolutionService.getSessionStatus(instanceName).catch(() => disconnected);
          const status = normalizeSessionStatus(current.status || disconnected.status || "unknown");
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName: instanceName },
            update: {
              status,
              qrLast: connected ? undefined : null,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName: instanceName,
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

      billingApp.get("/whatsapp/session/qrcode", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const instanceName = context.evolutionInstanceName?.trim() || null;
        if (!instanceName) {
          return reply.code(400).send({ message: "Instancia WhatsApp nao configurada pelo admin para esta empresa" });
        }

        try {
          const qrResult = await evolutionService.getQrCode(instanceName);
          const status = normalizeSessionStatus(
            qrResult.status && qrResult.status !== "unknown" ? qrResult.status : qrResult.qr ? "qrcode" : "unknown",
          );
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName: instanceName },
            update: {
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName: instanceName,
              status,
              qrLast: qrResult.qr,
              connectedAt: connected ? new Date() : null,
            },
          });

          const message = !session.qrLast
            ? connected
              ? "Sessao ja conectada. Nao ha QR code ativo."
              : "Sem QR code ativo. Clique em Conectar WhatsApp."
            : null;

          return reply.send({
            qr: session.qrLast,
            status: session.status,
            message,
            raw: qrResult.raw,
          });
        } catch (error) {
          const current = await evolutionService.getSessionStatus(instanceName);
          const status = normalizeSessionStatus(current.status || "unknown");
          const connected = isConnectedStatus(status);

          const session = await prisma.whatsappSession.upsert({
            where: { sessionName: instanceName },
            update: {
              status,
              connectedAt: connected ? new Date() : null,
            },
            create: {
              sessionName: instanceName,
              status,
              connectedAt: connected ? new Date() : null,
            },
          });

          return reply.send({
            qr: session.qrLast,
            status: session.status,
            message: connected
              ? "Sessao conectada. QR code nao necessario."
              : "Nao foi possivel obter QR code agora. Verifique configuracao do Evolution e tente novamente.",
            raw: current.raw,
            error: error instanceof Error ? error.message : "Erro desconhecido",
          });
        }
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

        const supplierPhone = normalizePhone(document.supplier.phoneE164 || "");
        const targetPhone = supplierPhone ?? BILLING_TEST_NOTIFICATION_PHONE;
        const fallbackPhoneUsed = !supplierPhone;

        try {
          const result = await sendBillingDocumentNotification({
            companyId: context.id,
            evolutionInstanceName: context.evolutionInstanceName,
            documentId: document.id,
            supplierName: document.supplier.name,
            description: document.description,
            amount: Number(document.amount),
            dueDate: document.dueDate,
            boletoLine: document.boletoLine,
            barcode: document.barcode,
            targetPhone,
            intent: "billing_notify",
          });

          return reply.send({
            ok: true,
            phone: result.phone,
            fallbackPhoneUsed,
            message: result.message,
            mediaType: result.mediaType,
          });
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : "Falha ao enviar boleto em PDF";
          return reply.code(502).send({ message: errMessage });
        }
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
              messageType: true,
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
              lastMessage:
                latest
                  ? buildStoredMessagePreview({ content: latest.content, messageType: latest.messageType })
                  : "Sem mensagens ainda",
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
            messageType: true,
            content: true,
            createdAt: true,
            status: true,
          },
        });

        return reply.send(
          messages.map((message) => {
            const parsed = parseStoredMessageContent(message.content);
            return {
              id: message.id,
              direction: message.direction,
              messageType: message.messageType,
              content: parsed.text,
              attachment: parsed.attachment
                ? {
                    available: Boolean(parsed.attachment.base64),
                    fileName: parsed.attachment.fileName,
                    mimeType: parsed.attachment.mimeType,
                    mediaType: parsed.attachment.mediaType,
                  }
                : null,
              createdAt: message.createdAt.toISOString(),
              status: message.status,
            };
          }),
        );
      });

      billingApp.get("/crm/message-attachments/:id/download", async (request, reply) => {
        const context = await getBillingCompanyContext(request, reply);
        if (!context) {
          return;
        }

        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Parametro invalido" });
        }

        const message = await prisma.messageLog.findFirst({
          where: {
            id: params.data.id,
            companyId: context.id,
          },
          select: {
            id: true,
            messageType: true,
            content: true,
          },
        });

        if (!message) {
          return reply.code(404).send({ message: "Mensagem nao encontrada" });
        }

        const parsed = parseStoredMessageContent(message.content);
        if (!parsed.attachment?.base64) {
          return reply.code(404).send({ message: "Mensagem sem anexo disponivel para download" });
        }

        let buffer: Buffer;
        try {
          buffer = Buffer.from(parsed.attachment.base64, "base64");
        } catch {
          return reply.code(422).send({ message: "Anexo invalido" });
        }

        const mimeType = parsed.attachment.mimeType || "application/octet-stream";
        const fileName = sanitizeDownloadFileName(parsed.attachment.fileName);

        reply.header("Content-Type", mimeType);
        reply.header("Content-Disposition", `attachment; filename=\"${fileName}\"`);
        reply.header("Cache-Control", "no-store");
        return reply.send(buffer);
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
            messageType: true,
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
          messageType: outLog.messageType,
          content: outLog.content,
          attachment: null,
          createdAt: outLog.createdAt.toISOString(),
          status: outLog.status,
        });
      });
    },
    { prefix: "/billing" },
  );
}
