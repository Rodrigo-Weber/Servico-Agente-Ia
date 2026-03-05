/**
 * NFS-e Routes — Endpoints para emissão, consulta e gestão de NFS-e de serviço
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { nfseService } from "../../services/nfse.service.js";
import { authenticate, requireRoles } from "../auth/guards.js";
import { evolutionService } from "../../services/evolution.service.js";
import { getAvailableTemplates } from "../../config/company-templates.js";
import { MUNICIPIOS_BA_PRINCIPAIS, searchMunicipios } from "../../config/municipios-ba.js";

export async function nfseRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  /* ─── Templates (público para admin/company) ─── */
  app.get("/templates", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const templates = getAvailableTemplates();
    return templates.map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      aiType: t.aiType,
      bookingSector: t.bookingSector,
      icon: t.icon,
      servicesCount: t.services.length,
      hasNfse: !!t.nfseDefaults,
    }));
  });

  /* ─── Municípios BA (para select de município na config) ─── */
  app.get("/municipios-ba", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const query = request.query as { q?: string };
    if (query.q && query.q.length >= 2) {
      return searchMunicipios(query.q);
    }
    return MUNICIPIOS_BA_PRINCIPAIS;
  });

  /* ─── Config NFS-e ─── */

  app.get("/config", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const user = request.authUser!;
    const companyId = user.role === "admin"
      ? (request.query as any).companyId
      : user.companyId;

    if (!companyId) {
      return reply.status(400).send({ error: "companyId é obrigatório" });
    }

    const config = await nfseService.getConfig(companyId);
    const certStatus = await nfseService.getCertificateStatus(companyId);

    if (!config) {
      return { configured: false, config: null, certificado: certStatus };
    }

    return {
      configured: true,
      config,
      certificado: certStatus,
    };
  });

  app.put("/config", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const user = request.authUser!;

    const schema = z.object({
      companyId: z.string().optional(),
      environment: z.enum(["producao", "homologacao"]).optional(),
      inscricaoMunicipal: z.string().optional(),
      codigoMunicipio: z.string().optional(),
      regimeTributario: z.number().int().min(1).max(6).optional(),
      itemListaServico: z.string().optional(),
      codigoTributarioMunicipio: z.string().optional(),
      aliquotaIss: z.number().min(0).max(1).optional(),
      issRetido: z.boolean().optional(),
      naturezaOperacao: z.number().int().optional(),
      descricaoPadrao: z.string().optional(),
      autoEmitir: z.boolean().optional(),
      enviarWhatsapp: z.boolean().optional(),
      sefazEndpoint: z.string().url().optional(),
      serieRps: z.string().optional(),
    });

    const body = schema.parse(request.body);
    const companyId = user.role === "admin" ? (body.companyId || user.companyId!) : user.companyId!;
    if (!companyId) {
      return reply.status(400).send({ error: "companyId é obrigatório" });
    }

    const data: any = { ...body };
    delete data.companyId;

    const config = await nfseService.upsertConfig(companyId, data);
    return config;
  });

  /* ─── Emissão ─── */

  app.post("/emitir", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const user = request.authUser!;

    const schema = z.object({
      companyId: z.string().optional(),
      appointmentId: z.string().optional(),
      valorServicos: z.number().positive(),
      discriminacao: z.string().min(1),
      tomador: z.object({
        nome: z.string().min(1),
        cpfCnpj: z.string().optional().nullable(),
        email: z.string().email().optional().nullable(),
        telefone: z.string().optional().nullable(),
      }),
    });

    const body = schema.parse(request.body);
    const companyId = user.role === "admin" ? (body.companyId || user.companyId!) : user.companyId!;

    const result = await nfseService.emitir({
      companyId,
      appointmentId: body.appointmentId,
      valorServicos: body.valorServicos,
      discriminacao: body.discriminacao,
      tomador: body.tomador,
    });

    // Se emissão ok e enviarWhatsapp está ativo, enviar PDF
    if (result.status === "authorized" && body.tomador.telefone) {
      const config = await nfseService.getConfig(companyId);
      if (config?.enviarWhatsapp) {
        // Agenda envio assíncrono do PDF
        void sendNfsePdfViaWhatsapp(companyId, result.nfseDocId, body.tomador.telefone);
      }
    }

    return result;
  });

  /* ─── Emissão automática a partir de agendamento ─── */

  app.post("/emitir-por-agendamento/:appointmentId", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const user = request.authUser!;
    const { appointmentId } = request.params as { appointmentId: string };

    const appointment = await prisma.barberAppointment.findUnique({
      where: { id: appointmentId },
      include: {
        service: true,
        company: true,
        bookingCustomer: true,
      },
    });

    if (!appointment) {
      return reply.status(404).send({ error: "Agendamento não encontrado" });
    }

    const companyId = appointment.companyId;
    const config = await nfseService.getConfig(companyId);
    if (!config) {
      return reply.status(400).send({ error: "NFS-e não configurada para esta empresa" });
    }

    // Monta a discriminação
    const discriminacao = config.descricaoPadrao
      ? config.descricaoPadrao
        .replace("{servico}", appointment.service.name)
        .replace("{data}", new Intl.DateTimeFormat("pt-BR").format(appointment.startsAt))
        .replace("{cliente}", appointment.clientName)
      : `${appointment.service.name} - Atendimento em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(appointment.startsAt)}`;

    const result = await nfseService.emitir({
      companyId,
      appointmentId: appointment.id,
      valorServicos: Number(appointment.service.price),
      discriminacao,
      tomador: {
        nome: appointment.clientName,
        cpfCnpj: appointment.bookingCustomer?.document || null,
        telefone: appointment.clientPhone,
      },
    });

    // Envio automático via WhatsApp
    if (config.enviarWhatsapp && appointment.clientPhone) {
      void sendNfsePdfViaWhatsapp(companyId, result.nfseDocId, appointment.clientPhone);
    }

    return result;
  });

  /* ─── Consulta de status ─── */

  app.get("/status/:id", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const { id } = request.params as { id: string };
    return nfseService.consultarStatus(id);
  });

  /* ─── Listagem ─── */

  app.get("/", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const user = request.authUser!;
    const query = request.query as { companyId?: string; status?: string; page?: string; pageSize?: string };

    const companyId = user.role === "admin" ? (query.companyId || user.companyId!) : user.companyId!;
    if (!companyId) {
      return reply.status(400).send({ error: "companyId é obrigatório" });
    }

    return nfseService.listar(companyId, {
      status: query.status as any,
      page: query.page ? parseInt(query.page) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize) : 20,
    });
  });

  /* ─── Download PDF ─── */

  app.get("/pdf/:id", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const { id } = request.params as { id: string };

    const pdf = await nfseService.downloadPdf(id);
    if (!pdf) {
      return reply.status(404).send({ error: "PDF não disponível" });
    }

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="nfse-${id}.pdf"`)
      .send(pdf);
  });

  /* ─── Reenviar PDF por WhatsApp ─── */

  app.post("/enviar-whatsapp/:id", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const { id } = request.params as { id: string };

    const doc = await prisma.nfseServiceDocument.findUniqueOrThrow({
      where: { id },
    });

    if (!doc.tomadorTelefone) {
      return reply.status(400).send({ error: "Tomador não possui telefone cadastrado" });
    }

    await sendNfsePdfViaWhatsapp(doc.companyId, id, doc.tomadorTelefone);
    return { sent: true };
  });

  /* ─── Cancelamento ─── */

  app.post("/cancelar/:id", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const { id } = request.params as { id: string };

    const schema = z.object({
      justificativa: z.string().min(15, "Justificativa deve ter no mínimo 15 caracteres"),
    });

    const body = schema.parse(request.body);
    return nfseService.cancelar(id, body.justificativa);
  });

  /* ─── Dashboard NFS-e ─── */

  app.get("/dashboard", async (request, reply) => {
    await requireRoles(["admin", "company"])(request, reply);
    const user = request.authUser!;
    const query = request.query as { companyId?: string };
    const companyId = user.role === "admin" ? (query.companyId || user.companyId) : user.companyId;
    if (!companyId) {
      return reply.status(400).send({ error: "companyId é obrigatório" });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [config, statusCounts, monthTotal, recentDocs] = await Promise.all([
      nfseService.getConfig(companyId),
      prisma.nfseServiceDocument.groupBy({
        by: ["status"],
        where: { companyId },
        _count: true,
      }),
      prisma.nfseServiceDocument.aggregate({
        where: {
          companyId,
          status: "authorized",
          createdAt: { gte: startOfMonth },
        },
        _sum: { valorServicos: true },
        _count: true,
      }),
      prisma.nfseServiceDocument.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const s of statusCounts) {
      statusMap[s.status] = s._count;
    }

    return {
      configured: !!config,
      autoEmitir: config?.autoEmitir || false,
      enviarWhatsapp: config?.enviarWhatsapp || false,
      totals: {
        authorized: statusMap.authorized || 0,
        processing: statusMap.processing || 0,
        pending: statusMap.pending || 0,
        rejected: statusMap.rejected || 0,
        error: statusMap.error || 0,
        canceled: statusMap.canceled || 0,
      },
      month: {
        count: monthTotal._count || 0,
        total: Number(monthTotal._sum.valorServicos || 0),
      },
      recentDocs: recentDocs.map((d) => ({
        id: d.id,
        numero: d.numero,
        status: d.status,
        valorServicos: Number(d.valorServicos),
        tomadorNome: d.tomadorNome,
        discriminacao: d.discriminacao.slice(0, 100),
        createdAt: d.createdAt.toISOString(),
        emitidaEm: d.emitidaEm?.toISOString() || null,
      })),
    };
  });
}

/* ─── Helper: Envia PDF da NFS-e via WhatsApp ─── */

async function sendNfsePdfViaWhatsapp(
  companyId: string,
  nfseDocId: string,
  phoneE164: string,
): Promise<void> {
  try {
    // Espera um pouco para dar tempo de autorizar
    await new Promise((r) => setTimeout(r, 3000));

    // Consulta status atualizado
    const statusResult = await nfseService.consultarStatus(nfseDocId);

    const pdf = await nfseService.downloadPdf(nfseDocId);
    if (!pdf) {
      console.error(`[NFS-e] PDF não disponível para doc ${nfseDocId}`);
      return;
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const instanceName = company?.evolutionInstanceName || undefined;

    const caption = statusResult.numero
      ? `📄 *NFS-e nº ${statusResult.numero}*\nNota fiscal de serviço emitida com sucesso!\n\nObrigado pela preferência! 😊`
      : `📄 *Nota Fiscal de Serviço*\nSua NFS-e foi emitida com sucesso!\n\nObrigado pela preferência! 😊`;

    await evolutionService.sendDocument(
      phoneE164,
      {
        base64: pdf.toString("base64"),
        fileName: `nfse-${statusResult.numero || nfseDocId.slice(-6)}.pdf`,
        mimeType: "application/pdf",
        caption,
      },
      instanceName,
    );

    // Atualiza registro
    await prisma.nfseServiceDocument.update({
      where: { id: nfseDocId },
      data: { whatsappSentAt: new Date() },
    });

    console.log(`[NFS-e] PDF enviado via WhatsApp para ${phoneE164}`);
  } catch (err) {
    console.error(`[NFS-e] Erro ao enviar PDF via WhatsApp:`, err);
  }
}
