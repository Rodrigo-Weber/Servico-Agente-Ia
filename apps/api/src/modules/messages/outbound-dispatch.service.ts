import { MessageDispatchStatus, Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { evolutionService } from "../../services/evolution.service.js";
import { dispatchRateLimiterService } from "./rate-limiter.service.js";
import { enqueueOutboundDispatch } from "./queue.js";

const BASE_RETRY_DELAY_MS = 15_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

interface OutboundTextPayload {
  type: "text";
  text: string;
}

interface QueueOutboundTextInput {
  companyId: string;
  phone: string;
  text: string;
  intent?: string;
  instanceName?: string;
  messageLogId?: string;
}

export interface ProcessDispatchResult {
  outcome: "sent" | "retry" | "deferred" | "dead" | "ignored";
  delayMs?: number;
  reason?: string;
}

function parsePayload(payload: Prisma.JsonValue): OutboundTextPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (record.type !== "text" || typeof record.text !== "string") {
    return null;
  }

  return {
    type: "text",
    text: record.text,
  };
}

function computeRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(BASE_RETRY_DELAY_MS * 3 ** exponent, MAX_RETRY_DELAY_MS);
}

function truncateError(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 400) {
    return compact;
  }
  return `${compact.slice(0, 397)}...`;
}

class OutboundDispatchService {
  async enqueueOutboundText(input: QueueOutboundTextInput): Promise<{ dispatchId: string }> {
    const dispatch = await prisma.messageDispatch.create({
      data: {
        companyId: input.companyId,
        instanceName: input.instanceName ?? null,
        toPhoneE164: input.phone,
        messageLogId: input.messageLogId ?? null,
        payloadJson: {
          type: "text",
          text: input.text,
        },
        intent: input.intent ?? null,
        status: "queued",
      },
      select: { id: true },
    });

    if (env.QUEUE_OUTBOUND_ENABLED) {
      try {
        await enqueueOutboundDispatch(dispatch.id);
        return { dispatchId: dispatch.id };
      } catch (error) {
        const message = error instanceof Error ? truncateError(error.message) : "Fila indisponivel";
        await prisma.messageDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: "failed",
            errorCode: "queue_unavailable",
            errorMessage: message,
            nextAttemptAt: new Date(),
          },
        });
      }
    }

    await this.processDispatch(dispatch.id);
    return { dispatchId: dispatch.id };
  }

  async processDispatch(dispatchId: string): Promise<ProcessDispatchResult> {
    const dispatch = await prisma.messageDispatch.findUnique({
      where: { id: dispatchId },
      select: {
        id: true,
        companyId: true,
        instanceName: true,
        toPhoneE164: true,
        messageLogId: true,
        payloadJson: true,
        status: true,
        attempts: true,
        maxAttempts: true,
      },
    });

    if (!dispatch) {
      return { outcome: "ignored", reason: "dispatch_not_found" };
    }

    if (dispatch.status === "sent" || dispatch.status === "dead") {
      return { outcome: "ignored", reason: "dispatch_already_finalized" };
    }

    const claimed = await prisma.messageDispatch.updateMany({
      where: {
        id: dispatch.id,
        status: {
          in: ["queued", "retry", "failed"],
        },
      },
      data: {
        status: "sending",
        errorCode: null,
        errorMessage: null,
      },
    });

    if (claimed.count === 0) {
      const current = await prisma.messageDispatch.findUnique({
        where: { id: dispatch.id },
        select: { status: true },
      });
      if (current?.status === "sending") {
        return { outcome: "ignored", reason: "dispatch_being_processed" };
      }
      if (current?.status === "sent" || current?.status === "dead") {
        return { outcome: "ignored", reason: "dispatch_already_finalized" };
      }
    }

    const current = await prisma.messageDispatch.findUnique({
      where: { id: dispatch.id },
      select: {
        id: true,
        companyId: true,
        instanceName: true,
        toPhoneE164: true,
        messageLogId: true,
        payloadJson: true,
        attempts: true,
        maxAttempts: true,
      },
    });

    if (!current) {
      return { outcome: "ignored", reason: "dispatch_not_found_after_claim" };
    }

    const payload = parsePayload(current.payloadJson);
    if (!payload) {
      await prisma.messageDispatch.update({
        where: { id: current.id },
        data: {
          status: "dead",
          errorCode: "invalid_payload",
          errorMessage: "Payload de dispatch invalido",
        },
      });
      if (current.messageLogId) {
        await prisma.messageLog.update({
          where: { id: current.messageLogId },
          data: { status: "failed" },
        });
      }

      return { outcome: "dead", reason: "invalid_payload" };
    }

    const rateLimit = await dispatchRateLimiterService.reserveSlot({
      companyId: current.companyId,
      instanceName: current.instanceName || "default",
      phone: current.toPhoneE164,
    });

    if (rateLimit.delayMs > 0) {
      const nextAttemptAt = new Date(Date.now() + rateLimit.delayMs);
      await prisma.messageDispatch.update({
        where: { id: current.id },
        data: {
          status: "retry",
          nextAttemptAt,
          errorCode: rateLimit.reason ?? null,
          errorMessage: rateLimit.reason ? `Aguardando janela de envio (${rateLimit.reason})` : "Aguardando janela de envio",
        },
      });

      return {
        outcome: "deferred",
        delayMs: rateLimit.delayMs,
        reason: rateLimit.reason,
      };
    }

    const nextAttempt = current.attempts + 1;
    await prisma.messageDispatch.update({
      where: { id: current.id },
      data: {
        attempts: nextAttempt,
      },
    });

    try {
      await evolutionService.sendText(current.toPhoneE164, payload.text, current.instanceName || undefined);

      await prisma.messageDispatch.update({
        where: { id: current.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          nextAttemptAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });

      if (current.messageLogId) {
        await prisma.messageLog.update({
          where: { id: current.messageLogId },
          data: { status: "processed" },
        });
      }

      await dispatchRateLimiterService.markSent(current.companyId);
      return { outcome: "sent" };
    } catch (error) {
      const message = error instanceof Error ? truncateError(error.message) : "Erro desconhecido ao enviar mensagem";
      const canRetry = nextAttempt < current.maxAttempts;

      if (!canRetry) {
        await prisma.messageDispatch.update({
          where: { id: current.id },
          data: {
            status: "dead",
            errorCode: "provider_error",
            errorMessage: message,
            nextAttemptAt: null,
          },
        });

        if (current.messageLogId) {
          await prisma.messageLog.update({
            where: { id: current.messageLogId },
            data: { status: "failed" },
          });
        }

        return {
          outcome: "dead",
          reason: message,
        };
      }

      const retryDelayMs = computeRetryDelayMs(nextAttempt);
      await prisma.messageDispatch.update({
        where: { id: current.id },
        data: {
          status: "retry",
          errorCode: "provider_error",
          errorMessage: message,
          nextAttemptAt: new Date(Date.now() + retryDelayMs),
        },
      });

      return {
        outcome: "retry",
        delayMs: retryDelayMs,
        reason: message,
      };
    }
  }
}

export const outboundDispatchService = new OutboundDispatchService();

export function isDispatchFinalStatus(status: MessageDispatchStatus): boolean {
  return status === "sent" || status === "dead";
}
