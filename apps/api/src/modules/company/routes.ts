import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getCertificateDaysRemaining, getCertificateStatus, parsePkcs12Certificate } from "../../lib/certificate.js";
import { decryptBuffer, encryptBuffer, encryptText } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { getNextAllowedSyncAt, getNextSyncWaitSeconds } from "../../lib/sync-policy.js";
import { authenticate, requireRole } from "../auth/guards.js";
import { appConfigService } from "../../services/app-config.service.js";

const listQuerySchema = z.object({
  status: z.enum(["detected", "imported", "failed"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
});

const monitoringMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

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

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (companyApp) => {
      companyApp.addHook("preHandler", authenticate);
      companyApp.addHook("preHandler", requireRole("company"));
      companyApp.addHook("preHandler", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          reply.code(400).send({ message: "Conta sem empresa vinculada" });
          return;
        }

        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { active: true, aiType: true },
        });

        if (!company || !company.active) {
          reply.code(403).send({ message: "Empresa inativa" });
          return;
        }

        if (company.aiType !== "nfe_import") {
          reply.code(403).send({ message: "Empresa sem acesso ao modulo NF-e" });
          return;
        }
      });

      companyApp.get("/me", async (request, reply) => {
        const companyId = request.authUser?.companyId;

        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const company = await prisma.company.findUnique({
          where: { id: companyId },
          include: {
            certificates: {
              where: { active: true },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                validFrom: true,
                validTo: true,
                createdAt: true,
              },
            },
          },
        });

        const activeCertificate = company?.certificates?.[0] ?? null;

        return {
          user: request.authUser,
          company,
          certificate: activeCertificate
            ? {
                ...activeCertificate,
                status: getCertificateStatus(activeCertificate.validTo),
                daysRemaining: getCertificateDaysRemaining(activeCertificate.validTo),
              }
            : null,
        };
      });

      companyApp.post("/certificate-a1", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const parts = request.parts();

        let fileBuffer: Buffer | null = null;
        let fileName = "";
        let password = "";

        for await (const part of parts) {
          if (part.type === "file") {
            fileName = part.filename;
            fileBuffer = await part.toBuffer();
          } else if (part.fieldname === "password") {
            password = String(part.value ?? "");
          }
        }

        if (!fileBuffer || !fileName.toLowerCase().endsWith(".pfx")) {
          return reply.code(400).send({ message: "Envie um arquivo .pfx valido" });
        }

        if (!password || password.length < 4) {
          return reply.code(400).send({ message: "Senha do certificado obrigatoria" });
        }

        let parsedCertificate: { validFrom: Date | null; validTo: Date | null };
        try {
          parsedCertificate = parsePkcs12Certificate(fileBuffer, password);
        } catch (error) {
          return reply.code(400).send({
            message: error instanceof Error ? error.message : "Nao foi possivel validar o certificado A1",
          });
        }

        await prisma.$transaction(async (tx) => {
          await tx.companyCertificate.updateMany({
            where: { companyId, active: true },
            data: { active: false },
          });

          await tx.companyCertificate.create({
            data: {
              companyId,
              pfxBlobEncrypted: new Uint8Array(encryptBuffer(fileBuffer)),
              pfxPasswordEncrypted: new Uint8Array(encryptText(password)),
              validFrom: parsedCertificate.validFrom,
              validTo: parsedCertificate.validTo,
              active: true,
            },
          });
        });

        return reply.code(201).send({
          message: "Certificado A1 enviado com sucesso",
          certificate: {
            validFrom: parsedCertificate.validFrom,
            validTo: parsedCertificate.validTo,
            status: getCertificateStatus(parsedCertificate.validTo),
            daysRemaining: getCertificateDaysRemaining(parsedCertificate.validTo),
          },
        });
      });

      companyApp.delete("/certificate-a1", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const activeCertificate = await prisma.companyCertificate.findFirst({
          where: { companyId, active: true },
          orderBy: { createdAt: "desc" },
        });

        if (!activeCertificate) {
          return reply.code(404).send({ message: "Nao existe certificado ativo para remover" });
        }

        await prisma.companyCertificate.updateMany({
          where: { companyId, active: true },
          data: { active: false },
        });

        return reply.send({ message: "Certificado removido com sucesso" });
      });

      companyApp.get("/dashboard/summary", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const [counts, importedAgg, detectedAgg] = await Promise.all([
          prisma.nfeDocument.groupBy({
            by: ["status"],
            where: { companyId },
            _count: { _all: true },
          }),
          prisma.nfeDocument.aggregate({
            where: { companyId, status: "imported" },
            _sum: { valorTotal: true },
          }),
          prisma.nfeDocument.aggregate({
            where: { companyId, status: "detected" },
            _sum: { valorTotal: true },
          }),
        ]);

        const countMap = counts.reduce<Record<string, number>>((acc, item) => {
          acc[item.status] = item._count._all;
          return acc;
        }, {});

        return {
          totals: {
            importedCount: countMap.imported ?? 0,
            detectedCount: countMap.detected ?? 0,
            failedCount: countMap.failed ?? 0,
            importedValue: importedAgg._sum.valorTotal ?? 0,
            detectedValue: detectedAgg._sum.valorTotal ?? 0,
          },
        };
      });

      companyApp.get("/nfes", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const parsed = listQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Query invalida" });
        }

        const { status, from, to, q } = parsed.data;

        const nfes = await prisma.nfeDocument.findMany({
          where: {
            companyId,
            status,
            dataEmissao: {
              gte: from ? new Date(from) : undefined,
              lte: to ? new Date(to) : undefined,
            },
            OR: q
              ? [{ chave: { contains: q } }, { emitenteNome: { contains: q } }, { emitenteCnpj: { contains: q } }]
              : undefined,
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            chave: true,
            nsu: true,
            emitenteCnpj: true,
            emitenteNome: true,
            valorTotal: true,
            dataEmissao: true,
            dataVencimento: true,
            tipoOperacao: true,
            status: true,
            importedAt: true,
            createdAt: true,
            _count: {
              select: { items: true },
            },
          },
        });

        return nfes;
      });

      companyApp.get("/nfes/:id/xml", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Parametro invalido" });
        }

        const nfe = await prisma.nfeDocument.findFirst({
          where: {
            id: params.data.id,
            companyId,
          },
          select: {
            id: true,
            chave: true,
            rawXmlBlobEncrypted: true,
          },
        });

        if (!nfe) {
          return reply.code(404).send({ message: "NF-e nao encontrada" });
        }

        let xml = "";
        try {
          xml = decryptBuffer(Buffer.from(nfe.rawXmlBlobEncrypted)).toString("utf8");
        } catch (error) {
          request.log.error({ err: error, nfeId: nfe.id }, "Falha ao descriptografar XML da NF-e");
          return reply.code(500).send({ message: "Falha ao carregar XML da NF-e" });
        }

        const sanitizedKey = nfe.chave.replace(/[^0-9A-Za-z_-]/g, "");
        const fileName = sanitizedKey ? `${sanitizedKey}.xml` : `nfe-${nfe.id}.xml`;

        reply.header("Content-Type", "application/xml; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
        reply.header("Cache-Control", "no-store");
        return reply.send(xml);
      });

      companyApp.get("/nfes/:id", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ message: "Parametro invalido" });
        }

        const nfe = await prisma.nfeDocument.findFirst({
          where: {
            id: params.data.id,
            companyId,
          },
          select: {
            id: true,
            chave: true,
            nsu: true,
            emitenteCnpj: true,
            emitenteNome: true,
            valorTotal: true,
            dataEmissao: true,
            dataVencimento: true,
            tipoOperacao: true,
            status: true,
            importedAt: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                codigo: true,
                descricao: true,
                ncm: true,
                cfop: true,
                qtd: true,
                vUnit: true,
                vTotal: true,
              },
            },
          },
        });

        if (!nfe) {
          return reply.code(404).send({ message: "NF-e nao encontrada" });
        }

        return nfe;
      });

      companyApp.get("/monitoring/overview", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const settings = await appConfigService.getSettings();

        const [company, nfeByStatus, jobs24ByStatus, recentJobs, message24ByDirection, failedMessages24] = await Promise.all([
          prisma.company.findUnique({
            where: { id: companyId },
            select: {
              id: true,
              name: true,
              cnpj: true,
              active: true,
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
            by: ["status"],
            where: { companyId },
            _count: { _all: true },
          }),
          prisma.jobRun.groupBy({
            by: ["status"],
            where: {
              companyId,
              jobName: "hourly_nfe_sync",
              startedAt: { gte: since },
            },
            _count: { _all: true },
          }),
          prisma.jobRun.findMany({
            where: {
              companyId,
              jobName: "hourly_nfe_sync",
            },
            orderBy: { startedAt: "desc" },
            take: 10,
            select: {
              id: true,
              status: true,
              startedAt: true,
              endedAt: true,
              error: true,
            },
          }),
          prisma.messageLog.groupBy({
            by: ["direction"],
            where: {
              companyId,
              createdAt: { gte: since },
            },
            _count: { _all: true },
          }),
          prisma.messageLog.count({
            where: {
              companyId,
              createdAt: { gte: since },
              status: "failed",
            },
          }),
        ]);

        if (!company) {
          return reply.code(404).send({ message: "Empresa nao encontrada" });
        }

        const nfeMap = toStatusCountMap(nfeByStatus);
        const jobsMap = toStatusCountMap(jobs24ByStatus);
        const messageDirectionMap = message24ByDirection.reduce<Record<string, number>>((acc, item) => {
          acc[item.direction] = item._count._all;
          return acc;
        }, {});

        const activeCertificate = company.certificates[0] ?? null;
        const recentJobsSafe = recentJobs.map((job) => ({
          ...job,
          error: sanitizeSyncJobError(job.error),
        }));
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

        return reply.send({
          generatedAt: new Date().toISOString(),
          company: {
            id: company.id,
            name: company.name,
            cnpj: company.cnpj,
            active: company.active,
          },
          certificate: activeCertificate
            ? {
                id: activeCertificate.id,
                createdAt: activeCertificate.createdAt,
                validFrom: activeCertificate.validFrom,
                validTo: activeCertificate.validTo,
                status: getCertificateStatus(activeCertificate.validTo),
                daysRemaining: getCertificateDaysRemaining(activeCertificate.validTo),
              }
            : {
                id: null,
                createdAt: null,
                validFrom: null,
                validTo: null,
                status: "missing",
                daysRemaining: null,
              },
          sync: {
            lastSyncAt: company.dfeSyncState?.ultimoSyncAt ?? null,
            lastSuccessAt: company.dfeSyncState?.ultimoSucessoAt ?? null,
            lastSyncStatus: company.dfeSyncState?.ultimoStatus ?? null,
            nextAllowedSyncAt: nextAllowedSyncAt ? nextAllowedSyncAt.toISOString() : null,
            waitSeconds,
            isCoolingDown: (waitSeconds ?? 0) > 0,
            lastJob: recentJobsSafe[0] ?? null,
            recentJobs: recentJobsSafe,
            jobs24h: {
              total: (jobsMap.running ?? 0) + (jobsMap.success ?? 0) + (jobsMap.failed ?? 0),
              running: jobsMap.running ?? 0,
              success: jobsMap.success ?? 0,
              failed: jobsMap.failed ?? 0,
            },
          },
          messages24h: {
            inbound: messageDirectionMap.in ?? 0,
            outbound: messageDirectionMap.out ?? 0,
            failed: failedMessages24,
          },
          nfes: {
            imported: nfeMap.imported ?? 0,
            detected: nfeMap.detected ?? 0,
            failed: nfeMap.failed ?? 0,
            total: (nfeMap.imported ?? 0) + (nfeMap.detected ?? 0) + (nfeMap.failed ?? 0),
          },
          whatsappNumbers: {
            total: company.whatsappNumbers.length,
            active: company.whatsappNumbers.filter((item) => item.active).length,
            numbers: company.whatsappNumbers,
          },
        });
      });

      companyApp.get("/monitoring/messages", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const parsed = monitoringMessagesQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Query invalida", errors: parsed.error.flatten().fieldErrors });
        }

        const { page, pageSize } = parsed.data;
        const skip = (page - 1) * pageSize;

        const [dispatches, total] = await Promise.all([
          prisma.messageDispatch.findMany({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            skip,
            take: pageSize,
            select: {
              id: true,
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
            },
          }),
          prisma.messageDispatch.count({
            where: { companyId },
          }),
        ]);

        return reply.send({
          data: dispatches,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
          },
        });
      });

      companyApp.get("/monitoring/rate-limit", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const [companyLimit, policies] = await Promise.all([
          prisma.companyOperationalLimit.findUnique({
            where: { companyId },
          }),
          prisma.rateLimitPolicy.findMany({
            where: {
              active: true,
              OR: [{ scope: "global" }, { scope: "instance" }, { scope: "company", companyId }, { scope: "contact", companyId }],
            },
            orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
          }),
        ]);

        return reply.send({
          companyLimit,
          policies,
        });
      });
    },
    { prefix: "/company" },
  );
}
