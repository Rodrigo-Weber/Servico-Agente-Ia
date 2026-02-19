import { DelayedError, Worker } from "bullmq";
import { getBullMqConnectionOptions } from "../../lib/redis.js";
import { OUTBOUND_DISPATCH_QUEUE_NAME, OutboundDispatchJobData } from "./queue.js";
import { outboundDispatchService } from "./outbound-dispatch.service.js";

let outboundWorker: Worker | null = null;

interface StartWorkerOptions {
  tag?: string;
  concurrency?: number;
}

export async function startOutboundDispatchWorker(options: StartWorkerOptions = {}): Promise<Worker> {
  if (outboundWorker) {
    return outboundWorker;
  }

  const tag = options.tag ?? "[dispatch-worker]";
  const concurrency = Math.max(1, Math.trunc(options.concurrency ?? 6));

  outboundWorker = new Worker(
    OUTBOUND_DISPATCH_QUEUE_NAME,
    async (job, token) => {
      const payload = job.data as OutboundDispatchJobData;
      const result = await outboundDispatchService.processDispatch(payload.dispatchId);

      if ((result.outcome === "deferred" || result.outcome === "retry") && result.delayMs && token) {
        await job.moveToDelayed(Date.now() + result.delayMs, token);
        throw new DelayedError();
      }

      return result;
    },
    {
      connection: getBullMqConnectionOptions(),
      concurrency,
    },
  );

  outboundWorker.on("ready", () => {
    console.log(`${tag} worker de dispatch outbound iniciado (concurrency=${concurrency})`);
  });

  outboundWorker.on("failed", (job, error) => {
    const jobId = job?.id ?? "sem-id";
    const reason = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`${tag} falha no job ${jobId}: ${reason}`);
  });

  return outboundWorker;
}

export async function stopOutboundDispatchWorker(): Promise<void> {
  if (!outboundWorker) {
    return;
  }

  await outboundWorker.close();
  outboundWorker = null;
}
