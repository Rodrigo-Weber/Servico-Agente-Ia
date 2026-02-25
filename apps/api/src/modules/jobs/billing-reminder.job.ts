import { prisma } from "../../lib/prisma.js";
import { normalizePhone } from "../../lib/phone.js";
import { BILLING_ADVANCE_REMINDER_DAYS, sendBillingDocumentNotification } from "../billing/notification.service.js";

const BILLING_REMINDER_TIMEZONE = "America/Sao_Paulo";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAY_TO_NOTIFICATION_STEP = new Map<number, number>(
  BILLING_ADVANCE_REMINDER_DAYS.map((day, index) => [day, index + 1]),
);

function getTimezoneDayBounds(referenceDate: Date, timeZone: string): { startUtc: Date; endUtc: Date } {
  const referenceInTimezone = new Date(referenceDate.toLocaleString("en-US", { timeZone }));
  const dayStartInTimezone = new Date(referenceInTimezone);
  dayStartInTimezone.setHours(0, 0, 0, 0);
  const dayEndInTimezone = new Date(referenceInTimezone);
  dayEndInTimezone.setHours(23, 59, 59, 999);

  const driftMs = referenceDate.getTime() - referenceInTimezone.getTime();
  const startUtc = new Date(dayStartInTimezone.getTime() + driftMs);
  const endUtc = new Date(dayEndInTimezone.getTime() + driftMs);

  return { startUtc, endUtc };
}

function getDayStartInTimezone(referenceDate: Date, timeZone: string): Date {
  const inTimezone = new Date(referenceDate.toLocaleString("en-US", { timeZone }));
  inTimezone.setHours(0, 0, 0, 0);
  return inTimezone;
}

function getDaysUntilDueInTimezone(dueDate: Date, referenceDate: Date, timeZone: string): number {
  const dueStart = getDayStartInTimezone(dueDate, timeZone);
  const referenceStart = getDayStartInTimezone(referenceDate, timeZone);
  return Math.round((dueStart.getTime() - referenceStart.getTime()) / MS_PER_DAY);
}

function wasNotificationSentToday(lastNotificationAt: Date | null, referenceDate: Date): boolean {
  if (!lastNotificationAt) {
    return false;
  }

  const lastDay = getDayStartInTimezone(lastNotificationAt, BILLING_REMINDER_TIMEZONE);
  const today = getDayStartInTimezone(referenceDate, BILLING_REMINDER_TIMEZONE);
  return lastDay.getTime() === today.getTime();
}

export async function runBillingAdvanceRemindersJob(): Promise<void> {
  const now = new Date();
  const maxReminderDays = Math.max(...BILLING_ADVANCE_REMINDER_DAYS);
  const maxReferenceDate = new Date(now.getTime() + maxReminderDays * MS_PER_DAY);
  const todayBounds = getTimezoneDayBounds(now, BILLING_REMINDER_TIMEZONE);
  const maxBounds = getTimezoneDayBounds(maxReferenceDate, BILLING_REMINDER_TIMEZONE);

  const documents = await prisma.billingDocument.findMany({
    where: {
      status: "pending",
      dueDate: {
        gte: todayBounds.startUtc,
        lte: maxBounds.endUtc,
      },
      company: {
        active: true,
        aiType: "billing",
      },
      supplier: {
        autoSendEnabled: true,
        phoneE164: {
          not: null,
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      companyId: true,
      description: true,
      amount: true,
      dueDate: true,
      boletoLine: true,
      barcode: true,
      notificationCount: true,
      notificationLastAt: true,
      supplier: {
        select: {
          name: true,
          phoneE164: true,
        },
      },
      company: {
        select: {
          evolutionInstanceName: true,
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const document of documents) {
    const daysUntilDue = getDaysUntilDueInTimezone(document.dueDate, now, BILLING_REMINDER_TIMEZONE);
    const requiredNotificationStep = DAY_TO_NOTIFICATION_STEP.get(daysUntilDue);

    if (!requiredNotificationStep) {
      skipped += 1;
      continue;
    }

    if (document.notificationCount >= requiredNotificationStep) {
      skipped += 1;
      continue;
    }

    if (wasNotificationSentToday(document.notificationLastAt, now)) {
      skipped += 1;
      continue;
    }

    const supplierPhone = normalizePhone(document.supplier.phoneE164 || "");
    if (!supplierPhone) {
      skipped += 1;
      continue;
    }

    try {
      await sendBillingDocumentNotification({
        companyId: document.companyId,
        evolutionInstanceName: document.company.evolutionInstanceName,
        documentId: document.id,
        supplierName: document.supplier.name,
        description: document.description,
        amount: Number(document.amount),
        dueDate: document.dueDate,
        boletoLine: document.boletoLine,
        barcode: document.barcode,
        targetPhone: supplierPhone,
        intent: `billing_notify_due_${daysUntilDue}`,
        daysUntilDue,
        setNotificationCount: requiredNotificationStep,
      });

      sent += 1;
    } catch (error) {
      failed += 1;
      const errMessage = error instanceof Error ? error.message : "erro desconhecido";
      console.warn(
        `[billing-reminders] Falha ao notificar documento ${document.id} da empresa ${document.companyId} (D-${daysUntilDue}): ${errMessage}`,
      );
    }
  }

  console.log(
    `[billing-reminders] Execucao concluida: candidatos=${documents.length}, enviados=${sent}, ignorados=${skipped}, falhas=${failed}.`,
  );
}
