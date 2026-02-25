import { prisma } from "../../lib/prisma.js";

export const OUTBOUND_DISPATCH_QUEUE_NAME = "outbound-dispatch";

export interface OutboundDispatchJobData {
  dispatchId: string;
}

export async function enqueueOutboundDispatch(
  dispatchId: string,
  options?: {
    delayMs?: number;
  },
): Promise<void> {
  void dispatchId;
  void options;
  throw new Error("Fila outbound desativada: envio processado diretamente no banco.");
}

export async function getOutboundQueueCounts(): Promise<Record<string, number>> {
  const grouped = await prisma.messageDispatch.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const map = grouped.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  return {
    waiting: map.queued ?? 0,
    active: map.sending ?? 0,
    completed: map.sent ?? 0,
    failed: (map.failed ?? 0) + (map.dead ?? 0),
    delayed: map.retry ?? 0,
    paused: 0,
  };
}

export async function closeOutboundQueue(): Promise<void> {
  // Sem BullMQ/Redis.
}
