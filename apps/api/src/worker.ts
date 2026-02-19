import { prisma } from "./lib/prisma.js";
import { startHourlyNfeScheduler } from "./modules/jobs/scheduler.js";
import { startOutboundDispatchWorker } from "./modules/messages/dispatcher.worker.js";
import { disconnectRedisClients } from "./lib/redis.js";

async function bootstrapWorker() {
  await Promise.all([
    startHourlyNfeScheduler({
      runOnStart: false,
      tag: "[worker]",
    }),
    startOutboundDispatchWorker({
      tag: "[worker-dispatch]",
    }),
  ]);
}

bootstrapWorker().catch(async (error) => {
  console.error("[worker] falha critica", error);
  await disconnectRedisClients();
  await prisma.$disconnect();
  process.exit(1);
});
