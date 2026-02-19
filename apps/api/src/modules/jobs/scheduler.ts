import cron, { ScheduledTask } from "node-cron";
import { runHourlyNfeSync } from "./hourly-sync.js";
import { appConfigService } from "../../services/app-config.service.js";
import { env } from "../../config/env.js";

interface SchedulerOptions {
  runOnStart?: boolean;
  tag?: string;
}

export async function startHourlyNfeScheduler(options: SchedulerOptions = {}): Promise<ScheduledTask> {
  const tag = options.tag ?? "[scheduler]";
  const runOnStart = options.runOnStart ?? true;
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

  const task = cron.schedule("*/30 * * * * *", async () => {
    try {
      await executeSync();
    } catch (error) {
      console.error(`${tag} falha no sync horario`, error);
    }
  });

  let syncMinIntervalSeconds = env.SYNC_MIN_INTERVAL_SECONDS;
  try {
    const settings = await appConfigService.getSettings();
    syncMinIntervalSeconds = settings.syncMinIntervalSeconds;
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`${tag} falha ao carregar settings iniciais, usando fallback do .env: ${message}`);
  }

  console.log(
    `${tag} agendador iniciado (checagem a cada 30s, intervalo minimo por empresa: ${syncMinIntervalSeconds}s)`,
  );

  if (runOnStart) {
    try {
      await executeSync();
    } catch (error) {
      console.error(`${tag} falha no sync inicial`, error);
    }
  }

  return task;
}
