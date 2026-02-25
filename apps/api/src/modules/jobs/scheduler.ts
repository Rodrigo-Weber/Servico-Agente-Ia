import cron, { ScheduledTask } from "node-cron";
import { runHourlyNfeSync, runDailyImportSummaryJob } from "./hourly-sync.js";
import { runBillingAdvanceRemindersJob } from "./billing-reminder.job.js";
import { appConfigService } from "../../services/app-config.service.js";
import { env } from "../../config/env.js";

const HOURLY_SYNC_CRON = "1 * * * *";
const DAILY_DIGEST_CRON = "0 0 18 * * *";
const DAILY_BILLING_REMINDER_CRON = "0 0 9 * * *";
const SCHEDULE_TIMEZONE = "America/Sao_Paulo";

interface SchedulerOptions {
  runOnStart?: boolean;
  tag?: string;
}

export async function startHourlyNfeScheduler(options: SchedulerOptions = {}): Promise<ScheduledTask[]> {
  const tag = options.tag ?? "[scheduler]";
  const runOnStart = options.runOnStart ?? false;

  let activeSync: Promise<void> | null = null;
  let busyWarningShown = false;

  const executeSync = async (): Promise<void> => {
    if (activeSync) {
      if (!busyWarningShown) {
        console.warn(`${tag} sync anterior ainda em execucao; pulando rodada concorrente.`);
        busyWarningShown = true;
      }
      return;
    }

    activeSync = runHourlyNfeSync();

    try {
      await activeSync;
    } finally {
      activeSync = null;
      busyWarningShown = false;
    }
  };

  const syncTask = cron.schedule(
    HOURLY_SYNC_CRON,
    async () => {
      try {
        await executeSync();
      } catch (error) {
        console.error(`${tag} falha no sync agendado`, error);
      }
    },
    {
      timezone: SCHEDULE_TIMEZONE,
    },
  );

  const digestTask = cron.schedule(
    DAILY_DIGEST_CRON,
    async () => {
      try {
        await runDailyImportSummaryJob();
      } catch (error) {
        console.error(`${tag} falha no resumo diario agendado`, error);
      }
    },
    {
      timezone: SCHEDULE_TIMEZONE,
    },
  );

  const billingReminderTask = cron.schedule(
    DAILY_BILLING_REMINDER_CRON,
    async () => {
      try {
        await runBillingAdvanceRemindersJob();
      } catch (error) {
        console.error(`${tag} falha nos lembretes de cobranca agendados`, error);
      }
    },
    {
      timezone: SCHEDULE_TIMEZONE,
    },
  );

  let syncMinIntervalSeconds = env.SYNC_MIN_INTERVAL_SECONDS;
  try {
    const settings = await appConfigService.getSettings();
    syncMinIntervalSeconds = settings.syncMinIntervalSeconds;
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`${tag} falha ao carregar settings iniciais, usando fallback do .env: ${message}`);
  }

  console.log(
    `${tag} agendadores iniciados (Sync: ${HOURLY_SYNC_CRON}, Resumo: ${DAILY_DIGEST_CRON}, Cobranca: ${DAILY_BILLING_REMINDER_CRON} ${SCHEDULE_TIMEZONE})`,
  );

  if (runOnStart) {
    try {
      await executeSync();
    } catch (error) {
      console.error(`${tag} falha no sync inicial`, error);
    }
  }

  return [syncTask, digestTask, billingReminderTask];
}
