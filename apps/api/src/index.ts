import "dotenv/config";
import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { startHourlyNfeScheduler } from "./modules/jobs/scheduler.js";
import { startOutboundDispatchWorker } from "./modules/messages/dispatcher.worker.js";

async function bootstrap() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`[api] Servidor iniciado em http://localhost:${env.PORT}`);

  if (!env.LOG_REQUESTS) {
    console.log("[api] Logs simplificados ativos (sem log por requisicao HTTP).");
  }

  if (env.ENABLE_EMBEDDED_WORKER) {
    await startHourlyNfeScheduler({
      runOnStart: true,
      tag: "[api-worker]",
    });
  }

  if (env.ENABLE_MESSAGE_WORKER) {
    await startOutboundDispatchWorker({
      tag: "[api-dispatch]",
    });
  }
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar API", error);
  process.exit(1);
});
