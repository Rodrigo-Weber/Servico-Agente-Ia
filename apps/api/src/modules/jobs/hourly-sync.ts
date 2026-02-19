import { prisma } from "../../lib/prisma.js";
import { isSyncBlocked } from "../../lib/sync-policy.js";
import { buildCooldownStatus, parseCooldownUntil } from "../../lib/sync-status.js";
import { dfeSyncService, SefazDfeError } from "../../services/dfe-sync.service.js";
import { importNfeXml } from "../../services/nfe-import.service.js";
import { aiService } from "../../services/ai.service.js";
import { appConfigService } from "../../services/app-config.service.js";
import { outboundDispatchService } from "../messages/outbound-dispatch.service.js";

const MAX_SYNC_STATUS_LENGTH = 180;
const BASE_656_COOLDOWN_MS = 61 * 60 * 1000;
const MAX_656_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const GLOBAL_SYNC_LOCK_NAME = "hourly_nfe_sync_global_lock";

function normalizeSyncStatus(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_SYNC_STATUS_LENGTH) {
    return compact;
  }

  return `${compact.slice(0, MAX_SYNC_STATUS_LENGTH - 3)}...`;
}

function resolveSefaz656CooldownUntil(now: Date, previousStatus: string | null | undefined): Date {
  const baseUntil = new Date(now.getTime() + BASE_656_COOLDOWN_MS);
  const previousCooldown = parseCooldownUntil(previousStatus);

  if (!previousCooldown || previousCooldown.getTime() <= now.getTime()) {
    return baseUntil;
  }

  const extended = new Date(previousCooldown.getTime() + BASE_656_COOLDOWN_MS);
  const maxUntil = new Date(now.getTime() + MAX_656_COOLDOWN_MS);
  return extended.getTime() > maxUntil.getTime() ? maxUntil : extended;
}

async function tryAcquireGlobalSyncLock(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ locked: number | bigint | null }>>`
      SELECT GET_LOCK(${GLOBAL_SYNC_LOCK_NAME}, 0) AS locked
    `;
    return Number(rows[0]?.locked ?? 0) === 1;
  } catch {
    // Se o provider nao suportar GET_LOCK por algum motivo, segue sem lock.
    return true;
  }
}

async function releaseGlobalSyncLock(): Promise<void> {
  try {
    await prisma.$queryRaw`
      SELECT RELEASE_LOCK(${GLOBAL_SYNC_LOCK_NAME}) AS released
    `;
  } catch {
    // Nao interrompe o fluxo por falha de release.
  }
}

export async function runHourlyNfeSync(): Promise<void> {
  const lockAcquired = await tryAcquireGlobalSyncLock();
  if (!lockAcquired) {
    return;
  }

  try {
  const settings = await appConfigService.getSettings();
  const companies = await prisma.company.findMany({
    where: {
      active: true,
      aiType: "nfe_import",
      certificates: {
        some: { active: true },
      },
      whatsappNumbers: {
        some: { active: true },
      },
    },
    include: {
      whatsappNumbers: {
        where: { active: true },
      },
      dfeSyncState: true,
    },
  });

  for (const company of companies) {
    if (
      isSyncBlocked({
        minIntervalSeconds: settings.syncMinIntervalSeconds,
        lastSuccessAt: company.dfeSyncState?.ultimoSucessoAt,
        lastSyncAt: company.dfeSyncState?.ultimoSyncAt,
        status: company.dfeSyncState?.ultimoStatus,
      })
    ) {
      continue;
    }

    const job = await prisma.jobRun.create({
      data: {
        jobName: "hourly_nfe_sync",
        companyId: company.id,
        status: "running",
      },
    });

    try {
      const sync = await dfeSyncService.fetchNewDocuments(company.id);
      const imported: { chave: string; valor: number }[] = [];
      let failedDocuments = 0;
      const now = new Date();

      for (const doc of sync.documents) {
        try {
          const result = await importNfeXml(company.id, doc.xml, {
            status: "detected",
            nsu: doc.nsu,
          });

          imported.push({
            chave: result.chave,
            valor: Number(result.valorTotal),
          });
        } catch (error) {
          failedDocuments += 1;
          const message = error instanceof Error ? error.message : "Erro desconhecido";
          console.warn(`[hourly-sync] Falha ao importar doc NSU ${doc.nsu} da empresa ${company.id}: ${message}`);
        }
      }

      await prisma.dfeSyncState.upsert({
        where: { companyId: company.id },
        update: {
          ultimoNsu: sync.nextNsu,
          ultimoSyncAt: now,
          ultimoSucessoAt: now,
          ultimoStatus: normalizeSyncStatus(failedDocuments > 0 ? `success_partial:${failedDocuments}` : "success"),
        },
        create: {
          companyId: company.id,
          ultimoNsu: sync.nextNsu,
          ultimoSyncAt: now,
          ultimoSucessoAt: now,
          ultimoStatus: normalizeSyncStatus(failedDocuments > 0 ? `success_partial:${failedDocuments}` : "success"),
        },
      });

      if (imported.length > 0) {
        const text = await aiService.generateProactiveNewNotesReply(company.id, imported);

        for (const number of company.whatsappNumbers) {
          const outLog = await prisma.messageLog.create({
            data: {
              companyId: company.id,
              phoneE164: number.phoneE164,
              direction: "out",
              messageType: "text",
              content: text,
              intent: "ajuda",
              status: "received",
            },
          });

          await outboundDispatchService.enqueueOutboundText({
            companyId: company.id,
            phone: number.phoneE164,
            text,
            intent: "ajuda",
            messageLogId: outLog.id,
          });
        }
      }

      await prisma.jobRun.update({
        where: { id: job.id },
        data: {
          status: "success",
          endedAt: new Date(),
          error: failedDocuments > 0 ? `Falha ao importar ${failedDocuments} documento(s) do lote.` : null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      const now = new Date();
      const errorUltNsu = error instanceof SefazDfeError ? error.ultNSU : null;

      if (error instanceof SefazDfeError && error.cStat === "656") {
        const cooldownUntil = resolveSefaz656CooldownUntil(now, company.dfeSyncState?.ultimoStatus);

        await prisma.dfeSyncState.upsert({
          where: { companyId: company.id },
          update: {
            ultimoNsu: errorUltNsu ?? company.dfeSyncState?.ultimoNsu ?? null,
            ultimoSyncAt: now,
            ultimoStatus: normalizeSyncStatus(buildCooldownStatus(cooldownUntil, "656")),
          },
          create: {
            companyId: company.id,
            ultimoNsu: errorUltNsu ?? null,
            ultimoSyncAt: now,
            ultimoStatus: normalizeSyncStatus(buildCooldownStatus(cooldownUntil, "656")),
          },
        });

        await prisma.jobRun.update({
          where: { id: job.id },
          data: {
            status: "success",
            endedAt: new Date(),
            error: null,
          },
        });

        console.warn(
          `[hourly-sync] Empresa ${company.id} em cooldown SEFAZ 656 ate ${cooldownUntil.toISOString()} (backoff automatico).`,
        );

        continue;
      }

      await prisma.dfeSyncState.upsert({
        where: { companyId: company.id },
        update: {
          ultimoNsu: errorUltNsu ?? company.dfeSyncState?.ultimoNsu ?? null,
          ultimoSyncAt: now,
          ultimoStatus: normalizeSyncStatus(`error:${message}`),
        },
        create: {
          companyId: company.id,
          ultimoNsu: errorUltNsu ?? null,
          ultimoSyncAt: now,
          ultimoStatus: normalizeSyncStatus(`error:${message}`),
        },
      });

      await prisma.jobRun.update({
        where: { id: job.id },
        data: {
          status: "failed",
          endedAt: new Date(),
          error: message,
        },
      });
    }
  }
  } finally {
    await releaseGlobalSyncLock();
  }
}
