/**
 * Job de lembretes de agendamento humanizados.
 * Envia mensagens amigáveis aos clientes antes dos atendimentos.
 */

import { prisma } from "../../lib/prisma.js";
import { evolutionService } from "../../services/evolution.service.js";
import { buildFriendlyReminder, getTimeGreeting, pickRandom } from "../../lib/humanization.js";

interface ReminderConfig {
  hoursAhead: number;
  reminderType: "day_before" | "hours_before";
}

const REMINDER_CONFIGS: ReminderConfig[] = [
  { hoursAhead: 24, reminderType: "day_before" },
  { hoursAhead: 2, reminderType: "hours_before" },
];

interface AppointmentToRemind {
  id: string;
  clientName: string;
  clientPhone: string;
  startsAt: Date;
  serviceName: string;
  barberName: string;
  companyId: string;
  companyName: string;
  instanceName: string | null;
  sector: string | null;
}

async function getAppointmentsToRemind(hoursAhead: number): Promise<AppointmentToRemind[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + (hoursAhead - 0.5) * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + (hoursAhead + 0.5) * 60 * 60 * 1000);

  const appointments = await prisma.barberAppointment.findMany({
    where: {
      status: "scheduled",
      startsAt: {
        gte: windowStart,
        lt: windowEnd,
      },
      company: {
        active: true,
        aiType: "barber_booking",
        evolutionInstanceName: {
          not: null,
        },
      },
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          evolutionInstanceName: true,
          bookingSector: true,
        },
      },
      service: {
        select: {
          name: true,
        },
      },
      barber: {
        select: {
          name: true,
        },
      },
    },
  });

  return appointments.map((apt) => ({
    id: apt.id,
    clientName: apt.clientName,
    clientPhone: apt.clientPhone,
    startsAt: apt.startsAt,
    serviceName: apt.service.name,
    barberName: apt.barber.name,
    companyId: apt.company.id,
    companyName: apt.company.name,
    instanceName: apt.company.evolutionInstanceName,
    sector: apt.company.bookingSector ?? null,
  }));
}

function buildHumanizedReminder(input: {
  clientName: string;
  serviceName: string;
  barberName: string;
  startsAt: Date;
  hoursAhead: number;
  companyName: string;
  sector?: string | null;
}): string {
  const { clientName, serviceName, barberName, startsAt, hoursAhead, companyName, sector } = input;
  const firstName = clientName.split(" ")[0];
  const greeting = getTimeGreeting();

  // Formatar no fuso de São Paulo para enviar horário correto ao cliente
  const timeStr = startsAt.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  // Vocabulário e emojis por setor
  const emoji = sector === "car_wash" ? "🚗" : sector === "clinic" ? "🏥" : "💈";
  const labelServico = sector === "car_wash" ? "lavagem" : sector === "clinic" ? "consulta" : "servico";
  const labelReserva = sector === "car_wash" ? "reserva" : sector === "clinic" ? "consulta" : "agendamento";
  const labelProfissional = sector === "car_wash" ? barberName : barberName;
  const emojiAlt = sector === "car_wash" ? "✨" : sector === "clinic" ? "🏥" : "✂️";

  // Lembretes do dia anterior (24h)
  if (hoursAhead >= 20) {
    const templates = [
      `${greeting}, ${firstName}! 😊\n\nSo passando pra lembrar que amanha voce tem ${labelServico} com ${labelProfissional} as ${timeStr}!\n\nTe esperamos na ${companyName}! ${emoji}`,
      `Oi, ${firstName}! ${greeting}!\n\nAmanha e dia de ${labelServico}! 🎉\nSeu ${labelReserva} com ${labelProfissional} e as ${timeStr}.\n\nQualquer coisa, e so chamar!`,
      `${greeting}, ${firstName}!\n\nLembrete: amanha tem ${labelServico} as ${timeStr} com ${labelProfissional}.\n\nTe aguardamos! ${emojiAlt}`,
    ];
    return pickRandom(templates);
  }

  // Lembretes de poucas horas (2-4h)
  if (hoursAhead <= 4) {
    const templates = [
      `Oi, ${firstName}! 👋\n\nSeu ${labelServico} com ${labelProfissional} e daqui a pouquinho, as ${timeStr}!\n\nJa estamos te esperando! 😊`,
      `${firstName}, so um lembrete: seu ${labelReserva} das ${timeStr} com ${labelProfissional} ta chegando!\n\nAte ja! ${emoji}`,
      `Oi! O ${labelServico} com ${labelProfissional} e as ${timeStr} - falta pouco!\n\nTe esperamos, ${firstName}! ${emojiAlt}`,
    ];
    return pickRandom(templates);
  }

  // Lembretes genéricos
  return buildFriendlyReminder({
    serviceName,
    barberName,
    dateTime: startsAt,
    hoursAhead,
  });
}

async function sendReminder(appointment: AppointmentToRemind, hoursAhead: number): Promise<boolean> {
  if (!appointment.instanceName) {
    return false;
  }

  const message = buildHumanizedReminder({
    clientName: appointment.clientName,
    serviceName: appointment.serviceName,
    barberName: appointment.barberName,
    startsAt: appointment.startsAt,
    hoursAhead,
    companyName: appointment.companyName,
    sector: appointment.sector,
  });

  try {
    await evolutionService.sendText(appointment.clientPhone, message, appointment.instanceName);
    console.log(`[reminder] Lembrete enviado para ${appointment.clientName} (${appointment.clientPhone})`);
    return true;
  } catch (error) {
    console.error(`[reminder] Erro ao enviar lembrete para ${appointment.clientPhone}:`, error);
    return false;
  }
}

async function hasRecentReminder(appointmentId: string, hoursAhead: number): Promise<boolean> {
  // Verifica se já foi enviado um lembrete similar nas últimas horas
  // Isso evita duplicatas se o job rodar mais de uma vez
  const cutoff = new Date(Date.now() - hoursAhead * 60 * 60 * 1000);
  
  const recent = await prisma.messageDispatch.findFirst({
    where: {
      intent: `reminder_${appointmentId}`,
      createdAt: {
        gte: cutoff,
      },
    },
  });

  return Boolean(recent);
}

export async function runAppointmentRemindersJob(): Promise<void> {
  console.log("[reminder] Iniciando job de lembretes de agendamento...");

  let totalSent = 0;
  let totalSkipped = 0;

  for (const config of REMINDER_CONFIGS) {
    const appointments = await getAppointmentsToRemind(config.hoursAhead);

    for (const appointment of appointments) {
      const alreadySent = await hasRecentReminder(appointment.id, config.hoursAhead);
      if (alreadySent) {
        totalSkipped++;
        continue;
      }

      const sent = await sendReminder(appointment, config.hoursAhead);
      if (sent) {
        totalSent++;

        // Registra o envio para evitar duplicatas
        try {
          await prisma.messageDispatch.create({
            data: {
              companyId: appointment.companyId,
              instanceName: appointment.instanceName,
              toPhoneE164: appointment.clientPhone,
              intent: `reminder_${appointment.id}`,
              status: "sent",
              payloadJson: {
                type: "appointment_reminder",
                appointmentId: appointment.id,
                reminderType: config.reminderType,
                hoursAhead: config.hoursAhead,
              },
            },
          });
        } catch {
          // Log de lembrete não deve impedir o fluxo
        }
      }

      // Delay entre envios para não sobrecarregar
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`[reminder] Job finalizado. Enviados: ${totalSent}, Ignorados: ${totalSkipped}`);
}

// Função para enviar lembrete manual específico
export async function sendManualReminder(appointmentId: string): Promise<{ success: boolean; message: string }> {
  const appointment = await prisma.barberAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          evolutionInstanceName: true,
          bookingSector: true,
        },
      },
      service: {
        select: {
          name: true,
        },
      },
      barber: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!appointment) {
    return { success: false, message: "Agendamento não encontrado" };
  }

  if (appointment.status !== "scheduled") {
    return { success: false, message: "Agendamento não está com status agendado" };
  }

  if (!appointment.company.evolutionInstanceName) {
    return { success: false, message: "Instância WhatsApp não configurada" };
  }

  const hoursAhead = (appointment.startsAt.getTime() - Date.now()) / (60 * 60 * 1000);

  const message = buildHumanizedReminder({
    clientName: appointment.clientName,
    serviceName: appointment.service.name,
    barberName: appointment.barber.name,
    startsAt: appointment.startsAt,
    hoursAhead: Math.max(1, Math.round(hoursAhead)),
    companyName: appointment.company.name,
    sector: appointment.company.bookingSector ?? null,
  });

  try {
    await evolutionService.sendText(
      appointment.clientPhone,
      message,
      appointment.company.evolutionInstanceName,
    );
    return { success: true, message: "Lembrete enviado com sucesso!" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    return { success: false, message: `Erro ao enviar: ${errorMessage}` };
  }
}
