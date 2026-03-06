import { prisma } from "../../lib/prisma.js";
import { outboundDispatchService } from "../messages/outbound-dispatch.service.js";

const MAX_BATCH = 50;

/**
 * Job que busca dispatches em status "retry" cujo nextAttemptAt já passou
 * e reprocessa cada um. Roda a cada 2 minutos via scheduler.
 */
export async function runDispatchRetryJob(): Promise<void> {
  const now = new Date();

  const pendingRetries = await prisma.messageDispatch.findMany({
    where: {
      status: "retry",
      nextAttemptAt: { lte: now },
    },
    select: { id: true },
    orderBy: { nextAttemptAt: "asc" },
    take: MAX_BATCH,
  });

  if (pendingRetries.length === 0) return;

  console.log(`[dispatch-retry] ${pendingRetries.length} dispatch(es) pendente(s) para retry`);

  for (const dispatch of pendingRetries) {
    try {
      const result = await outboundDispatchService.processDispatch(dispatch.id);
      console.log(`[dispatch-retry] dispatch ${dispatch.id} → ${result.outcome}`);
    } catch (error) {
      console.error(`[dispatch-retry] falha ao reprocessar dispatch ${dispatch.id}:`, error);
    }
  }
}
