/**
 * Job de alerta para NF-e "stale" (detectadas há muito tempo sem importar).
 * Verifica notas com status "detected" mais antigas que o limiar configurado
 * e envia uma mensagem de alerta via WhatsApp para o último operador ativo
 * da empresa.
 */

import { prisma } from "../../lib/prisma.js";
import { evolutionService } from "../../services/evolution.service.js";

// Notas detectadas há mais de 4 horas sem importar disparam o alerta
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
// Intent usado no MessageDispatch para deduplicação (por empresa + dia)
const ALERT_INTENT_PREFIX = "nfe_stale_alert";

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function wasAlertSentToday(companyId: string): Promise<boolean> {
  const intentKey = `${ALERT_INTENT_PREFIX}_${companyId}_${getTodayDateString()}`;
  const existing = await prisma.messageDispatch.findFirst({
    where: {
      companyId,
      intent: intentKey,
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function findOperatorPhone(companyId: string): Promise<string | null> {
  // Usa o número que mais recentemente conversou sobre NF-e com a empresa
  const recentNfe = await prisma.conversationMemory.findFirst({
    where: {
      companyId,
      lastIntent: {
        in: ["importar", "ver", "ver_e_importar", "agent"],
      },
    },
    orderBy: { lastActivityAt: "desc" },
    select: { phoneE164: true },
  });

  if (recentNfe) {
    return recentNfe.phoneE164;
  }

  // Fallback: qualquer conversa ativa recente para esta empresa
  const recentAny = await prisma.conversationMemory.findFirst({
    where: { companyId },
    orderBy: { lastActivityAt: "desc" },
    select: { phoneE164: true },
  });

  return recentAny?.phoneE164 ?? null;
}

function buildAlertMessage(staleCount: number, oldestCreatedAt: Date): string {
  const hoursAgo = Math.floor((Date.now() - oldestCreatedAt.getTime()) / (60 * 60 * 1000));
  const hoursText = hoursAgo === 1 ? "1 hora" : `${hoursAgo} horas`;

  if (staleCount === 1) {
    return (
      `⚠️ Atenção: há 1 NF-e detectada aguardando importação há mais de ${hoursText}.\n\n` +
      `Para importar, envie: "importar notas pendentes" ou "confirmar importação" aqui no WhatsApp.`
    );
  }

  return (
    `⚠️ Atenção: há ${staleCount} NF-e detectadas aguardando importação, sendo a mais antiga há mais de ${hoursText}.\n\n` +
    `Para importar, envie: "importar notas pendentes" aqui no WhatsApp.`
  );
}

export async function runNfeStaleAlertJob(): Promise<void> {
  console.log("[nfe-stale-alert] Verificando notas detectadas sem importar...");

  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  // Busca empresas com aiType=nfe_import ativas que tenham notas stale
  const companiesWithStale = await prisma.nfeDocument.groupBy({
    by: ["companyId"],
    where: {
      status: "detected",
      createdAt: { lt: staleThreshold },
      company: {
        active: true,
        aiType: "nfe_import",
        evolutionInstanceName: { not: null },
      },
    },
    _count: { _all: true },
  });

  if (companiesWithStale.length === 0) {
    console.log("[nfe-stale-alert] Nenhuma empresa com notas stale.");
    return;
  }

  let totalAlerted = 0;
  let totalSkipped = 0;

  for (const row of companiesWithStale) {
    const companyId = row.companyId;
    const staleCount = row._count._all;

    try {
      // Deduplicação: envia no máximo 1 alerta por empresa por dia
      const alreadySent = await wasAlertSentToday(companyId);
      if (alreadySent) {
        totalSkipped++;
        continue;
      }

      // Busca a instância WhatsApp da empresa
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, evolutionInstanceName: true },
      });

      if (!company?.evolutionInstanceName) {
        totalSkipped++;
        continue;
      }

      // Busca o operador para envio
      const operatorPhone = await findOperatorPhone(companyId);
      if (!operatorPhone) {
        console.warn(`[nfe-stale-alert] Empresa ${companyId} sem operador encontrado. Pulando.`);
        totalSkipped++;
        continue;
      }

      // Busca a NF-e mais antiga para calcular tempo decorrido
      const oldest = await prisma.nfeDocument.findFirst({
        where: {
          companyId,
          status: "detected",
          createdAt: { lt: staleThreshold },
        },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });

      if (!oldest) {
        totalSkipped++;
        continue;
      }

      const alertMessage = buildAlertMessage(staleCount, oldest.createdAt);

      await evolutionService.sendText(
        operatorPhone,
        alertMessage,
        company.evolutionInstanceName,
      );

      // Registra para deduplicação diária
      const intentKey = `${ALERT_INTENT_PREFIX}_${companyId}_${getTodayDateString()}`;
      await prisma.messageDispatch.create({
        data: {
          companyId,
          instanceName: company.evolutionInstanceName,
          toPhoneE164: operatorPhone,
          intent: intentKey,
          status: "sent",
          payloadJson: {
            type: "nfe_stale_alert",
            staleCount,
            oldestCreatedAt: oldest.createdAt.toISOString(),
          },
        },
      });

      totalAlerted++;
      console.log(
        `[nfe-stale-alert] Alerta enviado para empresa ${company.name} (${staleCount} nota(s) stale) → ${operatorPhone}`,
      );

      // Pequeno delay para não sobrecarregar a API
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "erro desconhecido";
      console.error(`[nfe-stale-alert] Falha ao processar empresa ${companyId}: ${msg}`);
    }
  }

  console.log(
    `[nfe-stale-alert] Job finalizado. Alertados: ${totalAlerted}, Ignorados/Pulados: ${totalSkipped}`,
  );
}
