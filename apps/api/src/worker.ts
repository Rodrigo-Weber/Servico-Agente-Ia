import { prisma } from "./lib/prisma.js";
import { startHourlyNfeScheduler } from "./modules/jobs/scheduler.js";
import { startOutboundDispatchWorker } from "./modules/messages/dispatcher.worker.js";
import { disconnectRedisClients } from "./lib/redis.js";

async function bootstrapWorker() {
  const tasks = await startHourlyNfeScheduler({
    runOnStart: false,
    tag: "[worker]",
  });

  await startOutboundDispatchWorker({
    tag: "[worker-dispatch]",
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} recebido, encerrando...`);
    for (const task of tasks) {
      task.stop();
    }
    await disconnectRedisClients();
    await prisma.$disconnect();
    console.log("[worker] Encerrado com sucesso.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrapWorker().catch(async (error) => {
  console.error("[worker] falha critica", error);
  await disconnectRedisClients();
  await prisma.$disconnect();
  process.exit(1);
});
