import { FastifyInstance } from "fastify";
import { AppointmentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { normalizePhone } from "../../lib/phone.js";
import { evolutionService } from "../../services/evolution.service.js";
import { authenticate, requireRoles } from "../auth/guards.js";

const hourPattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

const listAppointmentsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  barberId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const listServicesQuerySchema = z.object({
  activeOnly: z.coerce.boolean().default(false),
  barberId: z.string().min(1).optional(),
});

function blankStringToUndefined(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function blankStringToNull(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const createBarberSchema = z.object({
  name: z.string().trim().min(2),
  email: z.preprocess(blankStringToUndefined, z.string().trim().email().optional()),
  phone: z.preprocess(blankStringToUndefined, z.string().trim().min(8).optional()),
  active: z.boolean().default(true),
});

const updateBarberSchema = z
  .object({
    name: z.string().trim().min(2).optional(),
    email: z.preprocess(blankStringToNull, z.string().trim().email().nullable()).optional(),
    phone: z.preprocess(blankStringToNull, z.string().trim().min(8).nullable()).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos um campo para atualizar",
  });

const workingHourEntrySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(hourPattern),
    endTime: z.string().regex(hourPattern),
    active: z.boolean().default(true),
  })
  .refine((entry) => toMinutes(entry.startTime) < toMinutes(entry.endTime), {
    message: "startTime deve ser menor que endTime",
    path: ["endTime"],
  });

const updateWorkingHoursSchema = z.object({
  hours: z.array(workingHourEntrySchema).max(50),
});

const createServiceSchema = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().max(3000).optional(),
  barberId: z.string().min(1).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(360),
  price: z.coerce.number().min(0),
  active: z.boolean().default(true),
});

const updateServiceSchema = z
  .object({
    name: z.string().trim().min(2).optional(),
    description: z.string().trim().max(3000).nullable().optional(),
    barberId: z.string().min(1).nullable().optional(),
    durationMinutes: z.coerce.number().int().min(5).max(360).optional(),
    price: z.coerce.number().min(0).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos um campo para atualizar",
  });

const createAppointmentSchema = z.object({
  barberId: z.string().min(1),
  serviceId: z.string().min(1),
  clientName: z.string().trim().min(2),
  clientPhone: z.string().trim().min(8),
  startsAt: z.string().datetime(),
  source: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(4000).optional(),
});

const updateAppointmentSchema = z
  .object({
    barberId: z.string().min(1).optional(),
    serviceId: z.string().min(1).optional(),
    clientName: z.string().trim().min(2).optional(),
    clientPhone: z.string().trim().min(8).optional(),
    startsAt: z.string().datetime().optional(),
    status: z.nativeEnum(AppointmentStatus).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos um campo para atualizar",
  });

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return hour * 60 + minute;
}

function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function isInsideWorkingWindow(
  startsAt: Date,
  endsAt: Date,
  windows: Array<{ weekday: number; startTime: string; endTime: string; active: boolean }>,
): boolean {
  if (startsAt.toDateString() !== endsAt.toDateString()) {
    return false;
  }

  const weekday = startsAt.getDay();
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMinutes = endsAt.getHours() * 60 + endsAt.getMinutes();

  const validWindows = windows.filter((window) => window.active && window.weekday === weekday);
  if (validWindows.length === 0) {
    return false;
  }

  return validWindows.some((window) => {
    const windowStart = toMinutes(window.startTime);
    const windowEnd = toMinutes(window.endTime);
    return startMinutes >= windowStart && endMinutes <= windowEnd;
  });
}

async function resolveBarberScopeId(authUser: {
  id: string;
  role: "admin" | "company" | "barber";
  companyId: string | null;
}): Promise<string | null> {
  if (authUser.role !== "barber" || !authUser.companyId) {
    return null;
  }

  const profile = await prisma.barberProfile.findFirst({
    where: {
      companyId: authUser.companyId,
      userId: authUser.id,
      active: true,
    },
    select: { id: true },
  });

  return profile?.id ?? null;
}

async function assertCompanyBarberService(companyId: string): Promise<boolean> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { aiType: true, active: true },
  });

  return Boolean(company && company.active && company.aiType === "barber_booking");
}

async function resolveAppointmentContext(input: {
  companyId: string;
  barberId: string;
  serviceId: string;
  startsAt: Date;
  excludeAppointmentId?: string;
}): Promise<{
  barber: { id: string; name: string };
  service: { id: string; name: string; durationMinutes: number; barberId: string | null };
  endsAt: Date;
}> {
  const [barber, service, windows] = await Promise.all([
    prisma.barberProfile.findFirst({
      where: {
        id: input.barberId,
        companyId: input.companyId,
        active: true,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.barberService.findFirst({
      where: {
        id: input.serviceId,
        companyId: input.companyId,
        active: true,
      },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        barberId: true,
      },
    }),
    prisma.barberWorkingHour.findMany({
      where: {
        barberId: input.barberId,
        active: true,
      },
      select: {
        weekday: true,
        startTime: true,
        endTime: true,
        active: true,
      },
    }),
  ]);

  if (!barber) {
    throw new Error("Barbeiro nao encontrado ou inativo");
  }

  if (!service) {
    throw new Error("Servico nao encontrado ou inativo");
  }

  if (service.barberId && service.barberId !== barber.id) {
    throw new Error("Este servico nao pertence ao barbeiro selecionado");
  }

  const endsAt = new Date(input.startsAt.getTime() + service.durationMinutes * 60 * 1000);
  if (!isInsideWorkingWindow(input.startsAt, endsAt, windows)) {
    throw new Error("Horario fora da grade de trabalho configurada para este barbeiro");
  }

  const overlap = await prisma.barberAppointment.findFirst({
    where: {
      companyId: input.companyId,
      barberId: barber.id,
      status: "scheduled",
      id: input.excludeAppointmentId ? { not: input.excludeAppointmentId } : undefined,
      startsAt: { lt: endsAt },
      endsAt: { gt: input.startsAt },
    },
    select: { id: true },
  });

  if (overlap) {
    throw new Error("Horario indisponivel para este barbeiro");
  }

  return {
    barber,
    service,
    endsAt,
  };
}

function normalizeAppointmentPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  return normalized || phone.trim();
}

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

export async function barberRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (barberApp) => {
      barberApp.addHook("preHandler", authenticate);
      barberApp.addHook("preHandler", requireRoles(["company", "barber"]));
      barberApp.addHook("preHandler", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          reply.code(400).send({ message: "Conta sem empresa vinculada" });
          return;
        }

        const allowed = await assertCompanyBarberService(companyId);
        if (!allowed) {
          reply.code(403).send({ message: "Empresa sem acesso ao modulo de barbearia" });
          return;
        }

        if (request.authUser?.role === "barber") {
          const scopeId = await resolveBarberScopeId({
            id: request.authUser.id,
            role: request.authUser.role,
            companyId,
          });

          if (!scopeId) {
            reply.code(403).send({ message: "Perfil de barbeiro nao encontrado para este usuario" });
            return;
          }
        }
      });

      barberApp.get("/me", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const barberProfileId = await resolveBarberScopeId({
          id: request.authUser!.id,
          role: request.authUser!.role,
          companyId,
        });

        const [company, barberProfile] = await Promise.all([
          prisma.company.findUnique({
            where: { id: companyId },
            select: {
              id: true,
              name: true,
              cnpj: true,
              aiType: true,
              active: true,
            },
          }),
          barberProfileId
            ? prisma.barberProfile.findUnique({
                where: { id: barberProfileId },
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phoneE164: true,
                  active: true,
                },
              })
            : Promise.resolve(null),
        ]);

        return reply.send({
          user: request.authUser,
          company,
          barberProfile,
        });
      });

      barberApp.get("/whatsapp/session", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { evolutionInstanceName: true },
        });

        const instanceName = company?.evolutionInstanceName?.trim() || null;
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

      const connectBarberWhatsappSessionHandler = async (request: any, reply: any) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { evolutionInstanceName: true },
        });

        const instanceName = company?.evolutionInstanceName?.trim() || null;
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

      barberApp.post("/whatsapp/session/start", connectBarberWhatsappSessionHandler);
      barberApp.post("/whatsapp/session/connect", connectBarberWhatsappSessionHandler);

      barberApp.post("/whatsapp/session/disconnect", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { evolutionInstanceName: true },
        });

        const instanceName = company?.evolutionInstanceName?.trim() || null;
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

      barberApp.get("/whatsapp/session/qrcode", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { evolutionInstanceName: true },
        });

        const instanceName = company?.evolutionInstanceName?.trim() || null;
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

      barberApp.get("/dashboard/summary", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const barberProfileId = await resolveBarberScopeId({
          id: request.authUser!.id,
          role: request.authUser!.role,
          companyId,
        });

        const now = new Date();
        const today = dayBounds(now);

        const appointmentFilter: Prisma.BarberAppointmentWhereInput = {
          companyId,
          barberId: barberProfileId ?? undefined,
        };

        const [barbersCount, servicesCount, todayCount, upcomingCount, nextAppointments] = await Promise.all([
          prisma.barberProfile.count({
            where: {
              companyId,
              active: true,
              id: barberProfileId ?? undefined,
            },
          }),
          prisma.barberService.count({
            where: {
              companyId,
              active: true,
              barberId: barberProfileId ?? undefined,
            },
          }),
          prisma.barberAppointment.count({
            where: {
              ...appointmentFilter,
              startsAt: {
                gte: today.start,
                lte: today.end,
              },
            },
          }),
          prisma.barberAppointment.count({
            where: {
              ...appointmentFilter,
              status: "scheduled",
              startsAt: {
                gte: now,
              },
            },
          }),
          prisma.barberAppointment.findMany({
            where: {
              ...appointmentFilter,
              startsAt: {
                gte: new Date(now.getTime() - 3 * 60 * 60 * 1000),
              },
            },
            orderBy: { startsAt: "asc" },
            take: 10,
            select: {
              id: true,
              clientName: true,
              clientPhone: true,
              startsAt: true,
              endsAt: true,
              status: true,
              barber: {
                select: {
                  id: true,
                  name: true,
                },
              },
              service: {
                select: {
                  id: true,
                  name: true,
                  durationMinutes: true,
                  price: true,
                },
              },
            },
          }),
        ]);

        return reply.send({
          generatedAt: new Date().toISOString(),
          totals: {
            barbers: barbersCount,
            services: servicesCount,
            appointmentsToday: todayCount,
            upcomingScheduled: upcomingCount,
          },
          nextAppointments,
        });
      });

      barberApp.get("/barbers", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const barberProfileId = await resolveBarberScopeId({
          id: request.authUser!.id,
          role: request.authUser!.role,
          companyId,
        });

        const barbers = await prisma.barberProfile.findMany({
          where: {
            companyId,
            id: barberProfileId ?? undefined,
          },
          orderBy: [{ active: "desc" }, { name: "asc" }],
          include: {
            _count: {
              select: {
                services: true,
                appointments: true,
              },
            },
          },
        });

        return reply.send(barbers);
      });

      barberApp.post("/barbers", async (request, reply) => {
        if (request.authUser?.role !== "company") {
          return reply.code(403).send({ message: "Apenas a empresa pode cadastrar barbeiros" });
        }

        const companyId = request.authUser.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const parsed = createBarberSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Payload invalido", errors: parsed.error.flatten().fieldErrors });
        }

        const barber = await prisma.barberProfile.create({
          data: {
            companyId,
            name: parsed.data.name,
            email: parsed.data.email ?? null,
            phoneE164: parsed.data.phone ? normalizeAppointmentPhone(parsed.data.phone) : null,
            active: parsed.data.active,
          },
        });

        return reply.code(201).send(barber);
      });

      barberApp.patch("/barbers/:id", async (request, reply) => {
        if (request.authUser?.role !== "company") {
          return reply.code(403).send({ message: "Apenas a empresa pode editar barbeiros" });
        }

        const companyId = request.authUser.companyId;
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        const parsed = updateBarberSchema.safeParse(request.body);
        if (!companyId || !params.success || !parsed.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const barber = await prisma.barberProfile.findFirst({
          where: {
            id: params.data.id,
            companyId,
          },
          select: { id: true },
        });

        if (!barber) {
          return reply.code(404).send({ message: "Barbeiro nao encontrado" });
        }

        const updated = await prisma.barberProfile.update({
          where: { id: barber.id },
          data: {
            name: parsed.data.name,
            email: parsed.data.email === undefined ? undefined : parsed.data.email,
            phoneE164:
              parsed.data.phone === undefined
                ? undefined
                : parsed.data.phone === null
                  ? null
                  : normalizeAppointmentPhone(parsed.data.phone),
            active: parsed.data.active,
          },
        });

        return reply.send(updated);
      });

      barberApp.delete("/barbers/:id", async (request, reply) => {
        if (request.authUser?.role !== "company") {
          return reply.code(403).send({ message: "Apenas a empresa pode excluir barbeiros" });
        }

        const companyId = request.authUser.companyId;
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!companyId || !params.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const barber = await prisma.barberProfile.findFirst({
          where: {
            id: params.data.id,
            companyId,
          },
          select: { id: true },
        });

        if (!barber) {
          return reply.code(404).send({ message: "Barbeiro nao encontrado" });
        }

        await prisma.barberProfile.update({
          where: { id: barber.id },
          data: { active: false },
        });

        return reply.code(204).send();
      });

      barberApp.get("/barbers/:id/working-hours", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!companyId || !params.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const barberProfileId = await resolveBarberScopeId({
          id: request.authUser!.id,
          role: request.authUser!.role,
          companyId,
        });
        if (barberProfileId && barberProfileId !== params.data.id) {
          return reply.code(403).send({ message: "Acesso negado a este barbeiro" });
        }

        const barber = await prisma.barberProfile.findFirst({
          where: {
            id: params.data.id,
            companyId,
          },
          select: { id: true },
        });

        if (!barber) {
          return reply.code(404).send({ message: "Barbeiro nao encontrado" });
        }

        const hours = await prisma.barberWorkingHour.findMany({
          where: { barberId: barber.id },
          orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
        });

        return reply.send(hours);
      });

      barberApp.put("/barbers/:id/working-hours", async (request, reply) => {
        if (request.authUser?.role !== "company") {
          return reply.code(403).send({ message: "Apenas a empresa pode configurar horarios" });
        }

        const companyId = request.authUser.companyId;
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        const parsed = updateWorkingHoursSchema.safeParse(request.body);
        if (!companyId || !params.success || !parsed.success) {
          return reply.code(400).send({
            message: "Payload invalido",
            errors: parsed.success ? undefined : parsed.error.flatten().fieldErrors,
          });
        }

        const barber = await prisma.barberProfile.findFirst({
          where: {
            id: params.data.id,
            companyId,
          },
          select: { id: true },
        });

        if (!barber) {
          return reply.code(404).send({ message: "Barbeiro nao encontrado" });
        }

        await prisma.$transaction(async (tx) => {
          await tx.barberWorkingHour.deleteMany({
            where: { barberId: barber.id },
          });

          if (parsed.data.hours.length > 0) {
            await tx.barberWorkingHour.createMany({
              data: parsed.data.hours.map((entry) => ({
                barberId: barber.id,
                weekday: entry.weekday,
                startTime: entry.startTime,
                endTime: entry.endTime,
                active: entry.active,
              })),
            });
          }
        });

        const hours = await prisma.barberWorkingHour.findMany({
          where: { barberId: barber.id },
          orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
        });
        return reply.send(hours);
      });

      barberApp.get("/services", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const parsed = listServicesQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Query invalida", errors: parsed.error.flatten().fieldErrors });
        }

        const barberProfileId = await resolveBarberScopeId({
          id: request.authUser!.id,
          role: request.authUser!.role,
          companyId,
        });

        const serviceWhere: Prisma.BarberServiceWhereInput = {
          companyId,
          active: parsed.data.activeOnly ? true : undefined,
          barberId: parsed.data.barberId ?? undefined,
        };

        if (barberProfileId) {
          serviceWhere.OR = [{ barberId: null }, { barberId: barberProfileId }];
          if (parsed.data.barberId && parsed.data.barberId !== barberProfileId) {
            return reply.code(403).send({ message: "Acesso negado ao barbeiro informado" });
          }
        }

        const services = await prisma.barberService.findMany({
          where: serviceWhere,
          orderBy: [{ active: "desc" }, { name: "asc" }],
          include: {
            barber: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        return reply.send(services);
      });

      barberApp.post("/services", async (request, reply) => {
        if (request.authUser?.role !== "company") {
          return reply.code(403).send({ message: "Apenas a empresa pode cadastrar servicos" });
        }

        const companyId = request.authUser.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const parsed = createServiceSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Payload invalido", errors: parsed.error.flatten().fieldErrors });
        }

        if (parsed.data.barberId) {
          const barber = await prisma.barberProfile.findFirst({
            where: {
              id: parsed.data.barberId,
              companyId,
              active: true,
            },
            select: { id: true },
          });
          if (!barber) {
            return reply.code(404).send({ message: "Barbeiro nao encontrado para vincular ao servico" });
          }
        }

        const service = await prisma.barberService.create({
          data: {
            companyId,
            barberId: parsed.data.barberId ?? null,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            durationMinutes: parsed.data.durationMinutes,
            price: new Prisma.Decimal(parsed.data.price),
            active: parsed.data.active,
          },
        });

        return reply.code(201).send(service);
      });

      barberApp.patch("/services/:id", async (request, reply) => {
        if (request.authUser?.role !== "company") {
          return reply.code(403).send({ message: "Apenas a empresa pode editar servicos" });
        }

        const companyId = request.authUser.companyId;
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        const parsed = updateServiceSchema.safeParse(request.body);
        if (!companyId || !params.success || !parsed.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const service = await prisma.barberService.findFirst({
          where: { id: params.data.id, companyId },
          select: { id: true },
        });
        if (!service) {
          return reply.code(404).send({ message: "Servico nao encontrado" });
        }

        if (parsed.data.barberId) {
          const barber = await prisma.barberProfile.findFirst({
            where: {
              id: parsed.data.barberId,
              companyId,
              active: true,
            },
            select: { id: true },
          });
          if (!barber) {
            return reply.code(404).send({ message: "Barbeiro nao encontrado para vincular ao servico" });
          }
        }

        const updated = await prisma.barberService.update({
          where: { id: service.id },
          data: {
            name: parsed.data.name,
            description: parsed.data.description === undefined ? undefined : parsed.data.description,
            barberId: parsed.data.barberId === undefined ? undefined : parsed.data.barberId,
            durationMinutes: parsed.data.durationMinutes,
            price: parsed.data.price === undefined ? undefined : new Prisma.Decimal(parsed.data.price),
            active: parsed.data.active,
          },
        });

        return reply.send(updated);
      });

      barberApp.delete("/services/:id", async (request, reply) => {
        if (request.authUser?.role !== "company") {
          return reply.code(403).send({ message: "Apenas a empresa pode excluir servicos" });
        }

        const companyId = request.authUser.companyId;
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!companyId || !params.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const service = await prisma.barberService.findFirst({
          where: { id: params.data.id, companyId },
          select: { id: true },
        });
        if (!service) {
          return reply.code(404).send({ message: "Servico nao encontrado" });
        }

        await prisma.barberService.update({
          where: { id: service.id },
          data: { active: false },
        });

        return reply.code(204).send();
      });

      barberApp.get("/appointments", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const parsed = listAppointmentsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Query invalida", errors: parsed.error.flatten().fieldErrors });
        }

        const barberProfileId = await resolveBarberScopeId({
          id: request.authUser!.id,
          role: request.authUser!.role,
          companyId,
        });
        if (barberProfileId && parsed.data.barberId && parsed.data.barberId !== barberProfileId) {
          return reply.code(403).send({ message: "Acesso negado ao barbeiro informado" });
        }

        const appointments = await prisma.barberAppointment.findMany({
          where: {
            companyId,
            status: parsed.data.status,
            barberId: parsed.data.barberId ?? barberProfileId ?? undefined,
            startsAt: {
              gte: parsed.data.from ? new Date(parsed.data.from) : undefined,
              lte: parsed.data.to ? new Date(parsed.data.to) : undefined,
            },
          },
          orderBy: { startsAt: "asc" },
          take: parsed.data.limit,
          include: {
            barber: {
              select: {
                id: true,
                name: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
                durationMinutes: true,
                price: true,
              },
            },
          },
        });

        return reply.send(appointments);
      });

      barberApp.post("/appointments", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        if (!companyId) {
          return reply.code(400).send({ message: "Conta sem empresa vinculada" });
        }

        const parsed = createAppointmentSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ message: "Payload invalido", errors: parsed.error.flatten().fieldErrors });
        }

        const startsAt = new Date(parsed.data.startsAt);
        if (Number.isNaN(startsAt.getTime())) {
          return reply.code(400).send({ message: "Data de inicio invalida" });
        }

        const barberProfileId = await resolveBarberScopeId({
          id: request.authUser!.id,
          role: request.authUser!.role,
          companyId,
        });
        if (barberProfileId && parsed.data.barberId !== barberProfileId) {
          return reply.code(403).send({ message: "Acesso negado para agendar em outro barbeiro" });
        }

        try {
          const context = await resolveAppointmentContext({
            companyId,
            barberId: parsed.data.barberId,
            serviceId: parsed.data.serviceId,
            startsAt,
          });

          const appointment = await prisma.barberAppointment.create({
            data: {
              companyId,
              barberId: context.barber.id,
              serviceId: context.service.id,
              clientName: parsed.data.clientName,
              clientPhone: normalizeAppointmentPhone(parsed.data.clientPhone),
              startsAt,
              endsAt: context.endsAt,
              status: "scheduled",
              source: parsed.data.source ?? "web",
              notes: parsed.data.notes ?? null,
            },
            include: {
              barber: {
                select: {
                  id: true,
                  name: true,
                },
              },
              service: {
                select: {
                  id: true,
                  name: true,
                  durationMinutes: true,
                  price: true,
                },
              },
            },
          });

          return reply.code(201).send(appointment);
        } catch (error) {
          return reply.code(400).send({ message: error instanceof Error ? error.message : "Falha ao criar agendamento" });
        }
      });

      barberApp.patch("/appointments/:id", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        const parsed = updateAppointmentSchema.safeParse(request.body);
        if (!companyId || !params.success || !parsed.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const appointment = await prisma.barberAppointment.findFirst({
          where: {
            id: params.data.id,
            companyId,
          },
          include: {
            barber: {
              select: {
                id: true,
                userId: true,
              },
            },
          },
        });

        if (!appointment) {
          return reply.code(404).send({ message: "Agendamento nao encontrado" });
        }

        if (request.authUser?.role === "barber") {
          if (appointment.barber.userId !== request.authUser.id) {
            return reply.code(403).send({ message: "Acesso negado para este agendamento" });
          }

          const hasForbiddenChanges =
            parsed.data.barberId !== undefined ||
            parsed.data.serviceId !== undefined ||
            parsed.data.clientName !== undefined ||
            parsed.data.clientPhone !== undefined ||
            parsed.data.startsAt !== undefined;
          if (hasForbiddenChanges) {
            return reply.code(403).send({ message: "Perfil barbeiro pode alterar apenas status e observacoes" });
          }
        }

        const nextBarberId = parsed.data.barberId ?? appointment.barberId;
        const nextServiceId = parsed.data.serviceId ?? appointment.serviceId;
        const nextStartsAt = parsed.data.startsAt ? new Date(parsed.data.startsAt) : appointment.startsAt;

        if (Number.isNaN(nextStartsAt.getTime())) {
          return reply.code(400).send({ message: "Data de inicio invalida" });
        }

        try {
          let nextEndsAt: Date | undefined;

          const needsScheduleValidation =
            parsed.data.barberId !== undefined ||
            parsed.data.serviceId !== undefined ||
            parsed.data.startsAt !== undefined ||
            parsed.data.status === "scheduled";

          if (needsScheduleValidation && (parsed.data.status ?? appointment.status) === "scheduled") {
            const context = await resolveAppointmentContext({
              companyId,
              barberId: nextBarberId,
              serviceId: nextServiceId,
              startsAt: nextStartsAt,
              excludeAppointmentId: appointment.id,
            });
            nextEndsAt = context.endsAt;
          }

          const updated = await prisma.barberAppointment.update({
            where: { id: appointment.id },
            data: {
              barberId: nextBarberId,
              serviceId: nextServiceId,
              clientName: parsed.data.clientName,
              clientPhone:
                parsed.data.clientPhone === undefined ? undefined : normalizeAppointmentPhone(parsed.data.clientPhone),
              startsAt: parsed.data.startsAt ? nextStartsAt : undefined,
              endsAt: nextEndsAt,
              status: parsed.data.status,
              notes: parsed.data.notes === undefined ? undefined : parsed.data.notes,
            },
            include: {
              barber: {
                select: {
                  id: true,
                  name: true,
                },
              },
              service: {
                select: {
                  id: true,
                  name: true,
                  durationMinutes: true,
                  price: true,
                },
              },
            },
          });

          return reply.send(updated);
        } catch (error) {
          return reply.code(400).send({ message: error instanceof Error ? error.message : "Falha ao atualizar agendamento" });
        }
      });

      barberApp.delete("/appointments/:id", async (request, reply) => {
        const companyId = request.authUser?.companyId;
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
        if (!companyId || !params.success) {
          return reply.code(400).send({ message: "Payload invalido" });
        }

        const appointment = await prisma.barberAppointment.findFirst({
          where: { id: params.data.id, companyId },
          include: {
            barber: {
              select: {
                userId: true,
              },
            },
          },
        });

        if (!appointment) {
          return reply.code(404).send({ message: "Agendamento nao encontrado" });
        }

        if (request.authUser?.role === "barber" && appointment.barber.userId !== request.authUser.id) {
          return reply.code(403).send({ message: "Acesso negado para este agendamento" });
        }

        await prisma.barberAppointment.update({
          where: { id: appointment.id },
          data: {
            status: "canceled",
          },
        });

        return reply.code(204).send();
      });
    },
    { prefix: "/barber" },
  );
}
