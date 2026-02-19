import { JobsOptions, Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../lib/redis.js";

export const OUTBOUND_DISPATCH_QUEUE_NAME = "outbound-dispatch";

export interface OutboundDispatchJobData {
  dispatchId: string;
}

let outboundQueue: Queue | null = null;

function getOutboundQueue(): Queue {
  if (!outboundQueue) {
    outboundQueue = new Queue(OUTBOUND_DISPATCH_QUEUE_NAME, {
      connection: getBullMqConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: 1_000,
        removeOnFail: 1_000,
      },
    });
  }

  return outboundQueue;
}

export async function enqueueOutboundDispatch(
  dispatchId: string,
  options?: {
    delayMs?: number;
  },
): Promise<void> {
  const queue = getOutboundQueue();
  const jobOptions: JobsOptions = {
    jobId: dispatchId,
    delay: options?.delayMs && options.delayMs > 0 ? Math.trunc(options.delayMs) : undefined,
  };

  await queue.add("dispatch-text", { dispatchId } as OutboundDispatchJobData, jobOptions);
}

export async function getOutboundQueueCounts(): Promise<Record<string, number>> {
  const queue = getOutboundQueue();
  return queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
}

export async function closeOutboundQueue(): Promise<void> {
  if (!outboundQueue) {
    return;
  }

  await outboundQueue.close();
  outboundQueue = null;
}
