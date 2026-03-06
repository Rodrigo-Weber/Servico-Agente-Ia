import "dotenv/config";
import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { startHourlyNfeScheduler } from "./modules/jobs/scheduler.js";
import { startOutboundDispatchWorker } from "./modules/messages/dispatcher.worker.js";
import type { ScheduledTask } from "node-cron";

async function bootstrap() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`[api] Servidor iniciado em http://localhost:${env.PORT}`);

  if (!env.LOG_REQUESTS) {
    console.log("[api] Logs simplificados ativos (sem log por requisicao HTTP).");
  }

  let schedulerTasks: ScheduledTask[] = [];

  if (env.ENABLE_EMBEDDED_WORKER) {
    schedulerTasks = await startHourlyNfeScheduler({
      runOnStart: false,
      tag: "[api-worker]",
    });
  }

  if (env.ENABLE_MESSAGE_WORKER) {
    await startOutboundDispatchWorker({
      tag: "[api-dispatch]",
    });
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} recebido, encerrando...`);
    for (const task of schedulerTasks) {
      task.stop();
    }
    await app.close();
    console.log("[api] Encerrado com sucesso.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar API", error);
  process.exit(1);
});
