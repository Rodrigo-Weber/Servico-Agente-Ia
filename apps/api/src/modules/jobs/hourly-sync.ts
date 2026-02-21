import { prisma } from "../../lib/prisma.js";
import { isSyncBlocked } from "../../lib/sync-policy.js";
import { buildCooldownStatus, parseCooldownUntil } from "../../lib/sync-status.js";
import { dfeSyncService, SefazDfeError } from "../../services/dfe-sync.service.js";
import { importNfeXml } from "../../services/nfe-import.service.js";
import { appConfigService } from "../../services/app-config.service.js";
import { outboundDispatchService } from "../messages/outbound-dispatch.service.js";

const MAX_SYNC_STATUS_LENGTH = 180;
const BASE_656_COOLDOWN_MS = 61 * 60 * 1000;
const MAX_656_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_DIGEST_TIMEZONE = "America/Sao_Paulo";
const OUTBOUND_TEXT_MAX_CHARS = 2800;

interface DigestCompany {
  id: string;
  whatsappNumbers: Array<{ phoneE164: string }>;
}

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

function formatCurrencyBr(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function getTimezoneDayBounds(referenceDate: Date, timeZone: string): { startUtc: Date; endUtc: Date; dayLabel: string } {
  const referenceInTimezone = new Date(referenceDate.toLocaleString("en-US", { timeZone }));
  const dayStartInTimezone = new Date(referenceInTimezone);
  dayStartInTimezone.setHours(0, 0, 0, 0);
  const dayEndInTimezone = new Date(referenceInTimezone);
  dayEndInTimezone.setHours(23, 59, 59, 999);

  const driftMs = referenceDate.getTime() - referenceInTimezone.getTime();
  const startUtc = new Date(dayStartInTimezone.getTime() + driftMs);
  const endUtc = new Date(dayEndInTimezone.getTime() + driftMs);
  const dayLabel = new Intl.DateTimeFormat("pt-BR", { timeZone }).format(referenceDate);

  return { startUtc, endUtc, dayLabel };
}

function splitTextByLines(text: string, maxChars = OUTBOUND_TEXT_MAX_CHARS): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (line.length <= maxChars) {
      current = line;
      continue;
    }

    let rest = line;
    while (rest.length > maxChars) {
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    current = rest;
  }

  if (current) {
    chunks.push(current);
  }

  if (chunks.length <= 1) {
    return chunks;
  }

  return chunks.map((chunk, index) => `Resumo NF-e (${index + 1}/${chunks.length})\n${chunk}`);
}

async function sendDailyImportSummary(
  company: DigestCompany,
  referenceDate: Date,
  options: { cooldownUntil?: Date | null } = {},
): Promise<void> {
  const { startUtc, endUtc, dayLabel } = getTimezoneDayBounds(referenceDate, DAILY_DIGEST_TIMEZONE);
  const importedNotes = await prisma.nfeDocument.findMany({
    where: {
      companyId: company.id,
      status: {
        in: ["imported", "detected"],
      },
      createdAt: {
        gte: startUtc,
        lte: endUtc,
      },
    },
    orderBy: [{ createdAt: "asc" }, { chave: "asc" }],
    select: {
      chave: true,
      emitenteNome: true,
      valorTotal: true,
    },
  });

  const lines: string[] = [];
  lines.push(`Resumo NF-e do dia ${dayLabel} (18:00).`);

  if (options.cooldownUntil) {
    lines.push(
      `Observacao: a consulta SEFAZ entrou em cooldown temporario (cStat 656) ate ${options.cooldownUntil.toLocaleString("pt-BR", {
        timeZone: DAILY_DIGEST_TIMEZONE,
      })}.`,
    );
  }

  if (importedNotes.length === 0) {
    lines.push("Nenhuma NF-e foi detectada ou importada hoje.");
    lines.push('Se quiser, responda "ver notas" para consultar o historico.');
  } else {
    const totalImportedValue = importedNotes.reduce((acc, note) => acc + Number(note.valorTotal), 0);
    lines.push(`NF-e importadas automaticamente hoje: ${importedNotes.length}.`);
    lines.push(`Valor total das notas: ${formatCurrencyBr(totalImportedValue)}.`);
    lines.push("");

    for (let index = 0; index < importedNotes.length; index += 1) {
      const note = importedNotes[index];
      const emitente = note.emitenteNome ? ` | ${note.emitenteNome}` : "";
      lines.push(`${index + 1}. ${note.chave} | ${formatCurrencyBr(Number(note.valorTotal))}${emitente}`);
    }

    lines.push("");
    lines.push('Se quiser consultar os detalhes ou baixar o DANFE, responda: "ver notas".');
  }

  const messages = splitTextByLines(lines.join("\n"));

  for (const number of company.whatsappNumbers) {
    for (const text of messages) {
      const outLog = await prisma.messageLog.create({
        data: {
          companyId: company.id,
          phoneE164: number.phoneE164,
          direction: "out",
          messageType: "text",
          content: text,
          intent: "ver",
          status: "received",
        },
      });

      await outboundDispatchService.enqueueOutboundText({
        companyId: company.id,
        phone: number.phoneE164,
        text,
        intent: "ver",
        messageLogId: outLog.id,
      });
    }
  }
}

export async function runHourlyNfeSync(): Promise<void> {
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
    const syncBlocked = isSyncBlocked({
      minIntervalSeconds: settings.syncMinIntervalSeconds,
      lastSuccessAt: company.dfeSyncState?.ultimoSucessoAt,
      lastSyncAt: company.dfeSyncState?.ultimoSyncAt,
      status: company.dfeSyncState?.ultimoStatus,
    });

    if (syncBlocked) {
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
      let failedDocuments = 0;
      const now = new Date();

      for (const doc of sync.documents) {
        try {
          await importNfeXml(company.id, doc.xml, {
            status: "imported",
            nsu: doc.nsu,
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
}

export async function runDailyImportSummaryJob(): Promise<void> {
  const companies = await prisma.company.findMany({
    where: {
      active: true,
      aiType: "nfe_import",
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

  const now = new Date();
  for (const company of companies) {
    const cooldownUntil = parseCooldownUntil(company.dfeSyncState?.ultimoStatus);
    const activeCooldownUntil = cooldownUntil && cooldownUntil.getTime() > now.getTime() ? cooldownUntil : null;

    try {
      await sendDailyImportSummary(company, now, { cooldownUntil: activeCooldownUntil });
    } catch (error) {
      const digestMessage = error instanceof Error ? error.message : "erro desconhecido";
      console.warn(`[daily-summary] Falha ao enviar resumo diario da empresa ${company.id}: ${digestMessage}`);
    }
  }
}
