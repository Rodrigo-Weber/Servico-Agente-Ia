import { createHash } from "node:crypto";
import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { normalizePhone } from "../../lib/phone.js";
import { aiService, type AgentConversationMessage } from "../../services/ai.service.js";
import { evolutionService } from "../../services/evolution.service.js";
import { importNfeXml } from "../../services/nfe-import.service.js";
import { appConfigService } from "../../services/app-config.service.js";
import { generateBookingReceiptPdf } from "../barber/receipt-pdf.service.js";
import { buildStoredMessageContent } from "../messages/message-content.js";
import { outboundDispatchService } from "../messages/outbound-dispatch.service.js";

interface IncomingData {
  phone: string;
  phoneCandidates: string[];
  text: string;
  isXml: boolean;
  hasMedia: boolean;
  xmlContent: string | null;
  mediaUrl: string | null;
  mediaFileName: string | null;
  mediaMimeType: string | null;
  rawMessage: Record<string, unknown> | null;
  fromMe: boolean;
  messageType: "text" | "media";
}

function extractPhone(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const nestedCandidates = [record.id, record.user, record.phone, record.number, record.remoteJid, record.participant];
    const nestedPhone = nestedCandidates.map(extractPhone).find((value) => value.length > 0);
    return nestedPhone ?? "";
  }

  if (typeof raw !== "string") {
    return "";
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const lowered = trimmed.toLowerCase();
  if (lowered.endsWith("@g.us") || lowered.endsWith("@broadcast")) {
    return "";
  }

  const beforeAt = trimmed.split("@")[0] ?? trimmed;
  const beforeDevice = beforeAt.split(":")[0] ?? beforeAt;
  return normalizePhone(beforeDevice);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function computePayloadHash(value: unknown): string {
  try {
    const serialized = JSON.stringify(value) ?? "";
    return createHash("sha256").update(serialized).digest("hex");
  } catch {
    return createHash("sha256").update(String(value ?? "")).digest("hex");
  }
}

function extractWebhookEventId(body: unknown): string | null {
  const root = asRecord(body) ?? {};
  const data = asRecord(root.data) ?? root;
  const nested = asRecord(data.data);
  const source = nested ?? data;
  const messages = Array.isArray(source.messages)
    ? source.messages
    : Array.isArray(data.messages)
      ? data.messages
      : [];
  const first = asRecord(messages[0]);
  const firstKey = asRecord(first?.key);
  const sourceKey = asRecord(source.key);
  const dataKey = asRecord(data.key);

  const candidates = [
    asText(firstKey?.id),
    asText(sourceKey?.id),
    asText(dataKey?.id),
    asText(source.id),
    asText(data.id),
    asText(root.id),
  ];

  const eventId = candidates.find((value) => typeof value === "string" && value.length > 0) ?? null;
  return eventId ? eventId.slice(0, 190) : null;
}

function extractInstanceName(body: unknown): string | null {
  const root = asRecord(body) ?? {};
  const data = asRecord(root.data) ?? {};
  const nestedData = asRecord(data.data) ?? {};

  const candidates = [
    asText(root.instance),
    asText(root.instanceName),
    asText(data.instance),
    asText(data.instanceName),
    asText(nestedData.instance),
    asText(nestedData.instanceName),
    asText(asRecord(root.instanceData)?.instanceName),
    asText(asRecord(data.instanceData)?.instanceName),
    asText(asRecord(nestedData.instanceData)?.instanceName),
  ];

  const value = candidates.find((item) => typeof item === "string" && item.length > 0) ?? null;
  return value ? value.slice(0, 120) : null;
}

function extractInstanceNameFromHeaders(headers: unknown): string | null {
  const record = asRecord(headers);
  if (!record) {
    return null;
  }

  const pickText = (value: unknown): string | null => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const parsed = asText(item);
        if (parsed) {
          return parsed;
        }
      }
      return null;
    }

    return asText(value);
  };

  const candidates = [
    pickText(record["x-instance-name"]),
    pickText(record["x-evolution-instance"]),
    pickText(record["x-evolution-instancename"]),
    pickText(record["x-wa-instance"]),
    pickText(record.instance),
    pickText(record.instanceName),
  ];

  const value = candidates.find((item) => typeof item === "string" && item.length > 0) ?? null;
  return value ? value.slice(0, 120) : null;
}

function normalizeInstanceName(value: string): string {
  return value.trim().toLowerCase();
}

function unwrapMessage(message: unknown): Record<string, unknown> {
  let current = asRecord(message);
  if (!current) {
    return {};
  }

  const wrapperKeys = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "editedMessage",
    "documentWithCaptionMessage",
  ];

  for (let depth = 0; depth < 6; depth += 1) {
    let unwrapped = false;

    for (const key of wrapperKeys) {
      const wrapper = asRecord(current[key]);
      const nested = wrapper ? asRecord(wrapper.message) : null;
      if (nested) {
        current = nested;
        unwrapped = true;
        break;
      }
    }

    if (!unwrapped) {
      break;
    }
  }

  return current;
}

function isWebMessageLike(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  return Boolean(record.key) && Boolean(record.message);
}

function buildPhoneCandidates(phone: string): string[] {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return [];
  }

  const options = new Set<string>();
  const push = (value: string) => {
    if (value.length >= 8) {
      options.add(value);
    }
  };

  const addBrVariants = (value: string) => {
    const local = value.startsWith("55") ? value.slice(2) : value;
    if (local.length === 11 && local[2] === "9") {
      const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`;
      push(withoutNine);
      push(`55${withoutNine}`);
    }

    if (local.length === 10) {
      const withNine = `${local.slice(0, 2)}9${local.slice(2)}`;
      push(withNine);
      push(`55${withNine}`);
    }
  };

  push(normalized);
  addBrVariants(normalized);

  if (normalized.startsWith("55") && normalized.length > 11) {
    push(normalized.slice(2));
    addBrVariants(normalized.slice(2));
  }

  if (normalized.length > 12) {
    push(normalized.slice(-12));
  }

  if (normalized.length > 11) {
    push(normalized.slice(-11));
  }

  if (normalized.length > 10) {
    push(normalized.slice(-10));
  }

  return Array.from(options);
}

function matchesAgentOwnNumber(incomingCandidates: string[], agentWhatsappNumber: string): boolean {
  const agentPhoneCandidates = buildPhoneCandidates(agentWhatsappNumber || "");
  if (agentPhoneCandidates.length === 0 || incomingCandidates.length === 0) {
    return false;
  }

  return incomingCandidates.some((value) =>
    agentPhoneCandidates.some((agent) => value === agent || value.endsWith(agent) || agent.endsWith(value)),
  );
}

function extractIncomingPayload(body: unknown): IncomingData {
  const root = asRecord(body) ?? {};
  const data = asRecord(root.data) ?? root;
  const nestedData = asRecord(data.data);
  const source = nestedData ?? data;

  const messages = Array.isArray(source.messages)
    ? source.messages
    : Array.isArray(data.messages)
      ? data.messages
      : [];

  const firstMessage = asRecord(messages[0]);
  const firstMessageKey = asRecord(firstMessage?.key);
  const sourceKey = asRecord(source.key);
  const dataKey = asRecord(data.key);

  const messageRaw = firstMessage?.message ?? source.message ?? data.message ?? root.message;
  const message = unwrapMessage(messageRaw);
  const documentMessage = asRecord(message.documentMessage);
  const imageMessage = asRecord(message.imageMessage);
  const videoMessage = asRecord(message.videoMessage);
  const audioMessage = asRecord(message.audioMessage);
  const stickerMessage = asRecord(message.stickerMessage);

  const phoneRawCandidates = [
    firstMessageKey?.remoteJid,
    sourceKey?.remoteJid,
    dataKey?.remoteJid,
    source.remoteJid,
    data.remoteJid,
    firstMessageKey?.participant,
    sourceKey?.participant,
    dataKey?.participant,
    asRecord(source.sender)?.id,
    asRecord(data.sender)?.id,
    asRecord(root.sender)?.id,
    source.from,
    data.from,
    root.from,
    source.sender,
    data.sender,
    root.sender,
  ];

  const phone = phoneRawCandidates.map(extractPhone).find((value) => value.length > 0) ?? "";
  const phoneCandidates = buildPhoneCandidates(phone);

  const textCandidates = [
    asText(message.conversation),
    asText(asRecord(message.extendedTextMessage)?.text),
    asText(asRecord(message.imageMessage)?.caption),
    asText(asRecord(message.videoMessage)?.caption),
    asText(asRecord(message.documentMessage)?.caption),
    asText(asRecord(message.buttonsResponseMessage)?.selectedDisplayText),
    asText(asRecord(message.buttonsResponseMessage)?.selectedButtonId),
    asText(asRecord(message.listResponseMessage)?.title),
    asText(source.text),
    asText(source.body),
    asText(data.text),
    asText(data.body),
    asText(root.text),
    asText(root.body),
  ];

  const text = textCandidates.find((value) => typeof value === "string" && value.length > 0) ?? "";

  const reportedTypeCandidates = [
    asText(firstMessage?.messageType),
    asText(source.messageType),
    asText(data.messageType),
    asText(root.messageType),
    asText(source.type),
    asText(data.type),
    asText(root.type),
  ];
  const reportedType = reportedTypeCandidates.find((value) => typeof value === "string" && value.length > 0)?.toLowerCase() ?? "";
  const typeSignalsMedia =
    reportedType.includes("document") ||
    reportedType.includes("media") ||
    reportedType.includes("file") ||
    reportedType.includes("image") ||
    reportedType.includes("video") ||
    reportedType.includes("audio");

  const fileNameRaw = String(
    documentMessage?.fileName ??
      firstMessage?.fileName ??
      source.fileName ??
      data.fileName ??
      root.fileName ??
      source.file ??
      data.file ??
      root.file ??
      "",
  );
  const fileName = fileNameRaw.toLowerCase();
  const mimeTypeRaw = String(
    documentMessage?.mimetype ??
      firstMessage?.mimetype ??
      source.mimetype ??
      data.mimetype ??
      root.mimetype ??
      source.mimeType ??
      data.mimeType ??
      root.mimeType ??
      "",
  );
  const mimeType = mimeTypeRaw.toLowerCase();

  const mediaUrlCandidates = [
    asText(documentMessage?.url),
    asText(imageMessage?.url),
    asText(videoMessage?.url),
    asText(audioMessage?.url),
    asText(source.mediaUrl),
    asText(data.mediaUrl),
    asText(root.mediaUrl),
    asText(source.url),
    asText(data.url),
    asText(root.url),
  ];
  const mediaUrl = mediaUrlCandidates.find((value) => typeof value === "string" && value.length > 0) ?? null;

  const directXml = asText(source.xml) ?? asText(data.xml) ?? asText(root.xml);
  const base64 = asText(source.base64) ?? asText(data.base64) ?? asText(root.base64);
  const hasMedia =
    Boolean(documentMessage || imageMessage || videoMessage || audioMessage || stickerMessage || mediaUrl || base64) ||
    typeSignalsMedia;

  const isXmlHint =
    fileName.endsWith(".xml") ||
    mimeType.includes("xml") ||
    reportedType.includes("xml") ||
    (fileName.length > 0 && fileName.includes("xml"));
  const isXml = isXmlHint || (hasMedia && !text);

  let xmlContent: string | null = directXml;
  if (!xmlContent && base64 && hasMedia) {
    try {
      xmlContent = Buffer.from(base64, "base64").toString("utf8");
    } catch {
      xmlContent = null;
    }
  }

  const fromMeFlags = [
    firstMessageKey?.fromMe,
    sourceKey?.fromMe,
    dataKey?.fromMe,
    source.fromMe,
    data.fromMe,
    root.fromMe,
  ];
  const fromMe = fromMeFlags.find((value) => typeof value === "boolean") === true;
  const rawMessage = isWebMessageLike(firstMessage)
    ? firstMessage
    : isWebMessageLike(source)
      ? source
      : isWebMessageLike(data)
        ? data
        : isWebMessageLike(root)
          ? root
          : null;

  return {
    phone,
    phoneCandidates,
    text,
    isXml,
    hasMedia,
    xmlContent,
    mediaUrl,
    mediaFileName: fileNameRaw.trim() || null,
    mediaMimeType: mimeTypeRaw.trim() || null,
    rawMessage,
    fromMe,
    messageType: hasMedia ? "media" : "text",
  };
}

function phoneMatchScore(storedPhone: string, incomingCandidates: string[]): number {
  const stored = normalizePhone(storedPhone);
  if (!stored) {
    return 0;
  }

  let score = 0;
  for (const candidate of incomingCandidates) {
    if (stored === candidate) {
      score = Math.max(score, 1000 + candidate.length);
      continue;
    }

    if (stored.endsWith(candidate) || candidate.endsWith(stored)) {
      score = Math.max(score, candidate.length);
    }
  }

  return score;
}

async function findAuthorizedMapping(incomingCandidates: string[]) {
  if (incomingCandidates.length === 0) {
    return null;
  }

  const wherePhone = incomingCandidates.flatMap((candidate) => [
    { phoneE164: candidate },
    { phoneE164: { endsWith: candidate } },
  ]);

  const candidates = await prisma.companyWhatsappNumber.findMany({
    where: {
      active: true,
      company: {
        active: true,
      },
      OR: wherePhone,
    },
    include: {
      company: true,
    },
    take: 20,
  });

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates
    .map((item) => ({
      item,
      score: phoneMatchScore(item.phoneE164, incomingCandidates),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score > 0 ? best.item : null;
}

async function findCompanyByInstance(instanceName: string) {
  const normalized = normalizeInstanceName(instanceName || "");
  if (!normalized) {
    return null;
  }

  const companies = await prisma.company.findMany({
    where: {
      active: true,
      aiType: {
        in: ["barber_booking", "billing"],
      },
      evolutionInstanceName: {
        not: null,
      },
    },
    take: 200,
  });

  return (
    companies.find((company) => normalizeInstanceName(company.evolutionInstanceName || "") === normalized) ?? null
  );
}

function resolveReplyPhone(incoming: IncomingData): string {
  const direct = normalizePhone(incoming.phone);
  if (direct.startsWith("55") && direct.length >= 12) {
    return direct;
  }

  if ((direct.length === 10 || direct.length === 11) && !direct.startsWith("55")) {
    return `55${direct}`;
  }

  const withCountry = incoming.phoneCandidates.find((candidate) => candidate.startsWith("55") && candidate.length >= 12);
  return withCountry ?? incoming.phoneCandidates[0] ?? incoming.phone;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

type BarberIntent = "listar_servicos" | "agendar" | "cancelar" | "agenda" | "recibo" | "fidelidade" | "ajuda";
type BillingAgentIntent = "crm_inbound" | "billing_profile" | "billing_documents" | "billing_help";
type PendingBarberField = "nome" | "servico" | "horario";
type PendingCustomerField = "nome" | "documento";

interface BarberDateParts {
  year: number;
  month: number;
  day: number;
}

interface BarberTimeParts {
  hour: number;
  minute: number;
}

interface OutgoingAttachment {
  fileName: string;
  mimeType: string;
  mediaType: "document";
  base64: string;
}

interface BarberConversationReply {
  intent: BarberIntent;
  text: string;
  attachment?: OutgoingAttachment;
}

interface BarberTriageState {
  clientName: string | null;
  clientDocument: string | null;
  serviceId: string | null;
  startsAtIso: string | null;
  lastIntent: BarberIntent | null;
}

interface ConversationMessageMemory {
  role: "user" | "assistant";
  text: string;
  atIso: string;
}

type NfeMemoryStatus = "detected" | "imported" | "failed";

interface NfeReferenceMemory {
  chave: string;
  valor: number;
  status: NfeMemoryStatus;
  emitenteNome: string | null;
  createdAtIso: string;
}

interface NfeConversationState {
  listedNotes: NfeReferenceMemory[];
  selectedChave: string | null;
  updatedAtIso: string;
}

interface NfeDetailView {
  chave: string;
  emitenteCnpj: string | null;
  emitenteNome: string | null;
  valorTotal: Prisma.Decimal;
  dataEmissao: Date | null;
  status: NfeMemoryStatus;
  items: Array<{
    codigo: string | null;
    descricao: string | null;
    qtd: Prisma.Decimal;
    vTotal: Prisma.Decimal;
  }>;
}

interface ConversationContextPayload {
  version: 1;
  barber?: {
    triage?: {
      clientName: string | null;
      clientDocument: string | null;
      serviceId: string | null;
      startsAtIso: string | null;
      updatedAtIso: string;
    };
  };
  nfe?: NfeConversationState;
  recentMessages?: ConversationMessageMemory[];
}

const BARBER_TRIAGE_TTL_MS = 6 * 60 * 60 * 1000;
const NFE_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONVERSATION_MESSAGES = 20;
const MAX_NFE_LISTED_NOTES = 10;
const MAX_NFE_PRODUCT_LINES = 10;
const CLIENT_CANCELLATION_MIN_LEAD_MS = 60 * 60 * 1000;
const BOOKING_LOYALTY_GOAL = 10;

function parseConversationContext(raw: unknown): ConversationContextPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: 1 };
  }

  const record = raw as Record<string, unknown>;
  const barberRaw =
    record.barber && typeof record.barber === "object" && !Array.isArray(record.barber)
      ? (record.barber as Record<string, unknown>)
      : undefined;
  const triageRaw =
    barberRaw?.triage && typeof barberRaw.triage === "object" && !Array.isArray(barberRaw.triage)
      ? (barberRaw.triage as Record<string, unknown>)
      : undefined;

  const triage =
    triageRaw
      ? {
          clientName: typeof triageRaw.clientName === "string" ? triageRaw.clientName : null,
          clientDocument: typeof triageRaw.clientDocument === "string" ? triageRaw.clientDocument : null,
          serviceId: typeof triageRaw.serviceId === "string" ? triageRaw.serviceId : null,
          startsAtIso: typeof triageRaw.startsAtIso === "string" ? triageRaw.startsAtIso : null,
          updatedAtIso: typeof triageRaw.updatedAtIso === "string" ? triageRaw.updatedAtIso : new Date(0).toISOString(),
        }
      : undefined;

  const nfeRaw =
    record.nfe && typeof record.nfe === "object" && !Array.isArray(record.nfe)
      ? (record.nfe as Record<string, unknown>)
      : undefined;
  const listedNotes = Array.isArray(nfeRaw?.listedNotes)
    ? nfeRaw.listedNotes
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }

          const note = item as Record<string, unknown>;
          const status = note.status;
          if (status !== "detected" && status !== "imported" && status !== "failed") {
            return null;
          }

          if (typeof note.chave !== "string" || note.chave.trim().length === 0) {
            return null;
          }

          const value = Number(note.valor);
          if (!Number.isFinite(value)) {
            return null;
          }

          return {
            chave: note.chave.trim(),
            valor: value,
            status,
            emitenteNome: typeof note.emitenteNome === "string" ? note.emitenteNome : null,
            createdAtIso: typeof note.createdAtIso === "string" ? note.createdAtIso : new Date(0).toISOString(),
          } as NfeReferenceMemory;
        })
        .filter((item): item is NfeReferenceMemory => item !== null)
    : [];

  const nfeState = nfeRaw
    ? {
        listedNotes: listedNotes.slice(0, MAX_NFE_LISTED_NOTES),
        selectedChave:
          typeof nfeRaw.selectedChave === "string" && nfeRaw.selectedChave.trim().length > 0
            ? nfeRaw.selectedChave.trim()
            : null,
        updatedAtIso: typeof nfeRaw.updatedAtIso === "string" ? nfeRaw.updatedAtIso : new Date(0).toISOString(),
      }
    : undefined;

  const recentMessages = Array.isArray(record.recentMessages)
    ? record.recentMessages
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }
          const message = item as Record<string, unknown>;
          if ((message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string") {
            return null;
          }
          return {
            role: message.role,
            text: message.text,
            atIso: typeof message.atIso === "string" ? message.atIso : new Date(0).toISOString(),
          } as ConversationMessageMemory;
        })
        .filter((item): item is ConversationMessageMemory => item !== null)
    : [];

  return {
    version: 1,
    barber: triage ? { triage } : undefined,
    nfe: nfeState,
    recentMessages,
  };
}

function toConversationJson(value: ConversationContextPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function withConversationMemory(
  companyId: string,
  phone: string,
  callback: (context: ConversationContextPayload) => {
    context: ConversationContextPayload;
    userName?: string | null;
    lastIntent?: string | null;
    lastInboundAt?: Date | null;
    lastOutboundAt?: Date | null;
    lastActivityAt?: Date | null;
  },
): Promise<void> {
  const existing = await prisma.conversationMemory.findUnique({
    where: {
      companyId_phoneE164: {
        companyId,
        phoneE164: phone,
      },
    },
    select: {
      id: true,
      userName: true,
      lastIntent: true,
      contextJson: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      lastActivityAt: true,
    },
  });

  const baseContext = parseConversationContext(existing?.contextJson);
  const patch = callback(baseContext);
  const now = new Date();

  const data = {
    userName: patch.userName === undefined ? existing?.userName ?? null : patch.userName,
    lastIntent: patch.lastIntent === undefined ? existing?.lastIntent ?? null : patch.lastIntent,
    contextJson: toConversationJson(patch.context),
    lastInboundAt: patch.lastInboundAt === undefined ? existing?.lastInboundAt ?? null : patch.lastInboundAt,
    lastOutboundAt: patch.lastOutboundAt === undefined ? existing?.lastOutboundAt ?? null : patch.lastOutboundAt,
    lastActivityAt: patch.lastActivityAt === undefined ? now : patch.lastActivityAt,
  };

  if (existing) {
    await prisma.conversationMemory.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.conversationMemory.create({
    data: {
      companyId,
      phoneE164: phone,
      ...data,
    },
  });
}

async function appendConversationMessage(input: {
  companyId: string;
  phone: string;
  role: "user" | "assistant";
  text: string;
  intent?: string;
}): Promise<void> {
  const trimmed = input.text.trim();
  if (!trimmed) {
    return;
  }

  const normalizedText = trimmed.length > 1200 ? `${trimmed.slice(0, 1197)}...` : trimmed;
  const now = new Date();
  const nowIso = now.toISOString();

  await withConversationMemory(input.companyId, input.phone, (context) => {
    const currentMessages = Array.isArray(context.recentMessages) ? context.recentMessages : [];
    const nextMessages = [...currentMessages, { role: input.role, text: normalizedText, atIso: nowIso }];

    return {
      context: {
        ...context,
        recentMessages: nextMessages.slice(-MAX_CONVERSATION_MESSAGES),
      },
      lastIntent: input.intent ?? undefined,
      lastInboundAt: input.role === "user" ? now : undefined,
      lastOutboundAt: input.role === "assistant" ? now : undefined,
      lastActivityAt: now,
    };
  });
}

async function getBarberTriageState(companyId: string, phone: string): Promise<BarberTriageState | null> {
  const memory = await prisma.conversationMemory.findUnique({
    where: {
      companyId_phoneE164: {
        companyId,
        phoneE164: phone,
      },
    },
    select: {
      contextJson: true,
      userName: true,
      lastIntent: true,
    },
  });

  const context = parseConversationContext(memory?.contextJson);
  const triage = context.barber?.triage;
  if (!triage) {
    if (!memory?.userName) {
      return null;
    }

    return {
      clientName: memory.userName,
      clientDocument: null,
      serviceId: null,
      startsAtIso: null,
      lastIntent: null,
    };
  }

  const updatedAt = new Date(triage.updatedAtIso);
  if (Number.isNaN(updatedAt.getTime()) || Date.now() - updatedAt.getTime() > BARBER_TRIAGE_TTL_MS) {
    await clearBarberTriageState(companyId, phone);
    return null;
  }

  return {
    clientName: triage.clientName ?? memory?.userName ?? null,
    clientDocument: triage.clientDocument ?? null,
    serviceId: triage.serviceId,
    startsAtIso: triage.startsAtIso,
    lastIntent:
      memory?.lastIntent === "agendar" ||
      memory?.lastIntent === "recibo" ||
      memory?.lastIntent === "fidelidade"
        ? memory.lastIntent
        : null,
  };
}

async function rememberConversationUserName(input: {
  companyId: string;
  phone: string;
  userName: string;
}): Promise<void> {
  const normalizedName = normalizeClientName(input.userName);
  if (!normalizedName) {
    return;
  }

  await withConversationMemory(input.companyId, input.phone, (context) => {
    const triage = context.barber?.triage;
    const nextContext: ConversationContextPayload = {
      ...context,
      barber: {
        ...context.barber,
        triage: triage
          ? {
              ...triage,
              clientName: normalizedName,
              updatedAtIso: new Date().toISOString(),
            }
          : undefined,
      },
    };

    return {
      context: nextContext,
      userName: normalizedName,
      lastActivityAt: new Date(),
    };
  });
}

async function upsertBarberTriageState(input: {
  companyId: string;
  phone: string;
  clientName?: string | null;
  clientDocument?: string | null;
  serviceId?: string | null;
  startsAtIso?: string | null;
  lastIntent?: string;
}): Promise<void> {
  await withConversationMemory(input.companyId, input.phone, (context) => {
    const currentTriage = context.barber?.triage;
    const nextClientName = input.clientName === undefined ? currentTriage?.clientName ?? null : input.clientName;
    const nextClientDocument =
      input.clientDocument === undefined ? currentTriage?.clientDocument ?? null : input.clientDocument;
    const nextServiceId = input.serviceId === undefined ? currentTriage?.serviceId ?? null : input.serviceId;
    const nextStartsAtIso = input.startsAtIso === undefined ? currentTriage?.startsAtIso ?? null : input.startsAtIso;

    return {
      context: {
        ...context,
        barber: {
          ...context.barber,
          triage: {
            clientName: nextClientName,
            clientDocument: nextClientDocument,
            serviceId: nextServiceId,
            startsAtIso: nextStartsAtIso,
            updatedAtIso: new Date().toISOString(),
          },
        },
      },
      userName: nextClientName ?? undefined,
      lastIntent: input.lastIntent ?? undefined,
      lastActivityAt: new Date(),
    };
  });
}

async function clearBarberTriageState(
  companyId: string,
  phone: string,
  options?: { lastIntent?: string; userName?: string | null },
): Promise<void> {
  await withConversationMemory(companyId, phone, (context) => {
    const barber = context.barber ? { ...context.barber } : undefined;
    if (barber?.triage) {
      delete barber.triage;
    }

    return {
      context: {
        ...context,
        barber,
      },
      userName: options?.userName ?? undefined,
      lastIntent: options?.lastIntent ?? undefined,
      lastActivityAt: new Date(),
    };
  });
}

function formatNfeStatus(status: NfeMemoryStatus): string {
  if (status === "detected") {
    return "detectada";
  }

  if (status === "failed") {
    return "com falha";
  }

  return "importada";
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatDateBr(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(value);
}

function limitWhatsappText(value: string, maxChars: number): string {
  const compact = value.trim();
  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, maxChars - 3)}...`;
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function toNfeReferenceMemoryList(
  rows: Array<{
    chave: string;
    valorTotal: Prisma.Decimal | number;
    status: NfeMemoryStatus;
    emitenteNome: string | null;
    createdAt: Date;
  }>,
): NfeReferenceMemory[] {
  return rows.slice(0, MAX_NFE_LISTED_NOTES).map((row) => ({
    chave: row.chave,
    valor: Number(row.valorTotal),
    status: row.status,
    emitenteNome: row.emitenteNome,
    createdAtIso: row.createdAt.toISOString(),
  }));
}

async function rememberNfeConversation(input: {
  companyId: string;
  phone: string;
  listedNotes?: NfeReferenceMemory[];
  selectedChave?: string | null;
}): Promise<void> {
  await withConversationMemory(input.companyId, input.phone, (context) => {
    const current = context.nfe;
    const nextListed = input.listedNotes === undefined ? current?.listedNotes ?? [] : input.listedNotes;
    const nextSelected = input.selectedChave === undefined ? current?.selectedChave ?? null : input.selectedChave;

    const nextContext: ConversationContextPayload = {
      ...context,
    };

    if (nextListed.length === 0 && !nextSelected) {
      delete nextContext.nfe;
    } else {
      nextContext.nfe = {
        listedNotes: nextListed.slice(0, MAX_NFE_LISTED_NOTES),
        selectedChave: nextSelected,
        updatedAtIso: new Date().toISOString(),
      };
    }

    return {
      context: nextContext,
      lastActivityAt: new Date(),
    };
  });
}

async function safeRememberNfeConversation(input: {
  companyId: string;
  phone: string;
  listedNotes?: NfeReferenceMemory[];
  selectedChave?: string | null;
}): Promise<void> {
  try {
    await rememberNfeConversation(input);
  } catch {
    // Memoria NFe nao deve quebrar o fluxo principal.
  }
}

async function clearNfeConversationState(companyId: string, phone: string): Promise<void> {
  await withConversationMemory(companyId, phone, (context) => {
    const nextContext: ConversationContextPayload = {
      ...context,
    };
    delete nextContext.nfe;

    return {
      context: nextContext,
      lastActivityAt: new Date(),
    };
  });
}

async function safeClearNfeConversationState(companyId: string, phone: string): Promise<void> {
  try {
    await clearNfeConversationState(companyId, phone);
  } catch {
    // Memoria NFe nao deve quebrar o fluxo principal.
  }
}

async function getNfeConversationState(companyId: string, phone: string): Promise<NfeConversationState | null> {
  const memory = await prisma.conversationMemory.findUnique({
    where: {
      companyId_phoneE164: {
        companyId,
        phoneE164: phone,
      },
    },
    select: {
      contextJson: true,
    },
  });

  const context = parseConversationContext(memory?.contextJson);
  if (!context.nfe) {
    return null;
  }

  const updatedAt = new Date(context.nfe.updatedAtIso);
  if (Number.isNaN(updatedAt.getTime()) || Date.now() - updatedAt.getTime() > NFE_CONTEXT_TTL_MS) {
    await clearNfeConversationState(companyId, phone);
    return null;
  }

  return context.nfe;
}

function parseBrNumber(value: string): number {
  const sanitized = value.replace(/\s/g, "");
  if (!sanitized) {
    return Number.NaN;
  }

  if (sanitized.includes(",")) {
    return Number(sanitized.replace(/\./g, "").replace(",", "."));
  }

  return Number(sanitized.replace(/\./g, ""));
}

function extractNfeValueTargets(message: string): number[] {
  const targets = new Set<number>();
  const lower = message.toLowerCase();

  const thousandPattern = /(\d+(?:[.,]\d+)?)\s*mil\b/g;
  let thousandMatch = thousandPattern.exec(lower);
  while (thousandMatch) {
    const base = Number(thousandMatch[1].replace(",", "."));
    if (Number.isFinite(base)) {
      targets.add(base * 1000);
    }
    thousandMatch = thousandPattern.exec(lower);
  }

  const currencyPattern = /r\$\s*([\d.]+(?:,\d{1,2})?)/gi;
  let currencyMatch = currencyPattern.exec(message);
  while (currencyMatch) {
    const amount = parseBrNumber(currencyMatch[1] ?? "");
    if (Number.isFinite(amount)) {
      targets.add(amount);
    }
    currencyMatch = currencyPattern.exec(message);
  }

  if (/(nota|nfe|nf-e|fiscal|valor|reais|real)/i.test(message)) {
    const plainNumberPattern = /\b(\d{2,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{4,6}(?:,\d{1,2})?)\b/g;
    let plainMatch = plainNumberPattern.exec(message);
    while (plainMatch) {
      const amount = parseBrNumber(plainMatch[1] ?? "");
      if (Number.isFinite(amount) && amount >= 500) {
        targets.add(amount);
      }
      plainMatch = plainNumberPattern.exec(message);
    }
  }

  return Array.from(targets);
}

function extractNfeChaveCandidates(message: string): string[] {
  const digits = new Set<string>();
  const matches = message.match(/\d{8,44}/g) ?? [];

  for (const match of matches) {
    const normalized = normalizeDigits(match);
    if (normalized.length >= 8 && normalized.length <= 44) {
      digits.add(normalized);
    }
  }

  return Array.from(digits);
}

function resolveOrdinalReference(normalizedMessage: string): number | null {
  if (normalizedMessage.includes("penultim")) {
    return 1;
  }

  if (normalizedMessage.includes("ultim") || normalizedMessage.includes("mais recente")) {
    return 0;
  }

  if (normalizedMessage.includes("primeir")) {
    return 0;
  }

  if (normalizedMessage.includes("segund")) {
    return 1;
  }

  if (normalizedMessage.includes("terceir")) {
    return 2;
  }

  if (normalizedMessage.includes("quart")) {
    return 3;
  }

  if (normalizedMessage.includes("quint")) {
    return 4;
  }

  return null;
}

function hasImplicitNfeReference(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes("essa nota") ||
    normalizedMessage.includes("dessa nota") ||
    normalizedMessage.includes("esta nota") ||
    normalizedMessage.includes("dela") ||
    normalizedMessage.includes("dessa")
  );
}

function detectNfeDetailRequest(message: string): { wantsDetails: boolean; wantsProducts: boolean } {
  const normalized = normalizeForMatch(message);
  const wantsProducts =
    normalized.includes("produto") ||
    normalized.includes("produtos") ||
    normalized.includes("item") ||
    normalized.includes("itens") ||
    normalized.includes("mercadoria");
  const asksDetails =
    normalized.includes("detalh") ||
    normalized.includes("informac") ||
    normalized.includes("dados") ||
    normalized.includes("valor") ||
    normalized.includes("emitente") ||
    normalized.includes("chave");
  const mentionsNfe =
    normalized.includes("nota") ||
    normalized.includes("nfe") ||
    normalized.includes("nf-e") ||
    normalized.includes("fiscal");

  return {
    wantsDetails: wantsProducts || (asksDetails && (mentionsNfe || hasImplicitNfeReference(normalized))),
    wantsProducts,
  };
}

function detectNfeCapabilityQuestion(message: string): boolean {
  const normalized = normalizeForMatch(message);

  const asksWhatCanDo =
    normalized.includes("o que faz") ||
    normalized.includes("o que voce faz") ||
    normalized.includes("o que vc faz") ||
    normalized.includes("o que mais voce faz") ||
    normalized.includes("o que mais vc faz") ||
    normalized.includes("como funciona") ||
    normalized.includes("como voce funciona") ||
    normalized.includes("quais funcoes") ||
    normalized.includes("quais funcionalidades");

  const asksHelp =
    normalized === "ajuda" ||
    normalized === "help" ||
    normalized === "menu" ||
    normalized.includes("me ajuda");

  return asksWhatCanDo || asksHelp;
}

function matchNoteByValue(notes: NfeReferenceMemory[], targets: number[]): NfeReferenceMemory | null {
  let best: { note: NfeReferenceMemory; diff: number } | null = null;

  for (const target of targets) {
    for (const note of notes) {
      const diff = Math.abs(note.valor - target);
      const tolerance = Math.max(50, target * 0.04);
      if (diff > tolerance) {
        continue;
      }

      if (!best || diff < best.diff) {
        best = { note, diff };
      }
    }
  }

  return best?.note ?? null;
}

function matchNoteByPartialKey(notes: NfeReferenceMemory[], keyCandidate: string): NfeReferenceMemory | null {
  const normalizedCandidate = normalizeDigits(keyCandidate);
  if (normalizedCandidate.length < 8) {
    return null;
  }

  const candidates = notes.filter((note) => {
    const noteDigits = normalizeDigits(note.chave);
    return (
      noteDigits === normalizedCandidate ||
      noteDigits.endsWith(normalizedCandidate) ||
      noteDigits.includes(normalizedCandidate)
    );
  });

  if (candidates.length !== 1) {
    return null;
  }

  return candidates[0] ?? null;
}

function resolveReferencedNfeKey(input: {
  message: string;
  listedNotes: NfeReferenceMemory[];
  selectedChave: string | null;
  wantsProducts: boolean;
}): string | null {
  const normalizedMessage = normalizeForMatch(input.message);
  const keyCandidates = extractNfeChaveCandidates(input.message);

  for (const keyCandidate of keyCandidates) {
    if (keyCandidate.length === 44) {
      return keyCandidate;
    }

    const matched = matchNoteByPartialKey(input.listedNotes, keyCandidate);
    if (matched) {
      return matched.chave;
    }
  }

  const valueTargets = extractNfeValueTargets(input.message);
  if (valueTargets.length > 0) {
    const byValue = matchNoteByValue(input.listedNotes, valueTargets);
    if (byValue) {
      return byValue.chave;
    }
  }

  const ordinalRef = resolveOrdinalReference(normalizedMessage);
  if (ordinalRef !== null && input.listedNotes[ordinalRef]) {
    return input.listedNotes[ordinalRef].chave;
  }

  if (hasImplicitNfeReference(normalizedMessage) && input.selectedChave) {
    return input.selectedChave;
  }

  if (input.wantsProducts && input.selectedChave) {
    return input.selectedChave;
  }

  if (input.listedNotes.length === 1) {
    return input.listedNotes[0]?.chave ?? null;
  }

  return null;
}

async function fetchRecentNfeReferences(companyId: string): Promise<NfeReferenceMemory[]> {
  const rows = await prisma.nfeDocument.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: MAX_NFE_LISTED_NOTES,
    select: {
      chave: true,
      valorTotal: true,
      status: true,
      emitenteNome: true,
      createdAt: true,
    },
  });

  return toNfeReferenceMemoryList(rows);
}

async function findNfeByReference(companyId: string, chaveReference: string): Promise<{ nfe: NfeDetailView | null; ambiguous: boolean }> {
  const keyDigits = normalizeDigits(chaveReference);
  if (keyDigits.length < 8) {
    return { nfe: null, ambiguous: false };
  }

  const where: Prisma.NfeDocumentWhereInput = {
    companyId,
    chave:
      keyDigits.length >= 44
        ? keyDigits
        : keyDigits.length >= 20
          ? { endsWith: keyDigits }
          : { contains: keyDigits },
  };

  const rows = await prisma.nfeDocument.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 2,
    select: {
      chave: true,
      emitenteCnpj: true,
      emitenteNome: true,
      valorTotal: true,
      dataEmissao: true,
      status: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          codigo: true,
          descricao: true,
          qtd: true,
          vTotal: true,
        },
      },
    },
  });

  if (rows.length > 1) {
    return { nfe: null, ambiguous: true };
  }

  return {
    nfe: (rows[0] as NfeDetailView | undefined) ?? null,
    ambiguous: false,
  };
}

function buildNfeSelectionPrompt(notes: NfeReferenceMemory[]): string {
  const preview = notes
    .slice(0, 4)
    .map((note, index) => `- ${index + 1}) ${formatCurrency(note.valor)} | final ${note.chave.slice(-8)} | ${formatNfeStatus(note.status)}`)
    .join("\n");

  return [
    "Para te passar isso com precisao, preciso identificar a nota.",
    preview,
    "",
    "Me diga o numero da lista, a chave da NF-e ou um valor aproximado (ex: 53 mil).",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildNfeDetailReply(nfe: NfeDetailView): string {
  const lines = [
    "Detalhes da NF-e solicitada:",
    `- Chave: ${nfe.chave}`,
    `- Valor total: ${formatCurrency(Number(nfe.valorTotal))}`,
    `- Status: ${formatNfeStatus(nfe.status)}`,
  ];

  if (nfe.emitenteNome) {
    lines.push(`- Emitente: ${nfe.emitenteNome}`);
  }

  if (nfe.emitenteCnpj) {
    lines.push(`- CNPJ emitente: ${nfe.emitenteCnpj}`);
  }

  const emissionDate = formatDateBr(nfe.dataEmissao);
  if (emissionDate) {
    lines.push(`- Emissao: ${emissionDate}`);
  }

  lines.push(`- Produtos: ${nfe.items.length} item(ns)`);
  lines.push("", "Se quiser, eu te mostro agora os produtos dessa nota.");

  return limitWhatsappText(lines.join("\n"), 1400);
}

function buildNfeProductsReply(nfe: NfeDetailView): string {
  if (nfe.items.length === 0) {
    return limitWhatsappText(
      [
        "Nao localizei itens dessa NF-e no momento.",
        `- Chave: ${nfe.chave}`,
        `- Valor total: ${formatCurrency(Number(nfe.valorTotal))}`,
        "",
        "Se quiser, posso te passar os demais detalhes dessa nota.",
      ].join("\n"),
      1400,
    );
  }

  const itemLines = nfe.items.slice(0, MAX_NFE_PRODUCT_LINES).map((item) => {
    const description = item.descricao || item.codigo || "Item sem descricao";
    return `- ${description} | Qtd ${formatDecimal(Number(item.qtd))} | Total ${formatCurrency(Number(item.vTotal))}`;
  });

  const hiddenCount = nfe.items.length - itemLines.length;

  const lines = [
    `Produtos da NF-e ${nfe.chave.slice(-8)}:`,
    `- Valor total: ${formatCurrency(Number(nfe.valorTotal))}`,
    `- Itens: ${nfe.items.length}`,
    ...itemLines,
  ];

  if (hiddenCount > 0) {
    lines.push(`- ... e mais ${hiddenCount} item(ns).`);
  }

  lines.push("", "Se quiser, eu te envio tambem o resumo completo dessa nota.");

  return limitWhatsappText(lines.join("\n"), 1400);
}

async function handleNfeDetailConversation(input: {
  companyId: string;
  phone: string;
  userMessage: string;
  wantsProducts: boolean;
}): Promise<string> {
  const state = await getNfeConversationState(input.companyId, input.phone);
  const listedNotes = state?.listedNotes?.length ? state.listedNotes : await fetchRecentNfeReferences(input.companyId);
  const resolvedKey = resolveReferencedNfeKey({
    message: input.userMessage,
    listedNotes,
    selectedChave: state?.selectedChave ?? null,
    wantsProducts: input.wantsProducts,
  });

  if (!resolvedKey) {
    if (listedNotes.length === 0) {
      return "Nao encontrei notas para detalhar no momento.\n\nSe quiser, posso listar as ultimas notas importadas.";
    }

    await safeRememberNfeConversation({
      companyId: input.companyId,
      phone: input.phone,
      listedNotes,
      selectedChave: state?.selectedChave ?? null,
    });
    return buildNfeSelectionPrompt(listedNotes);
  }

  const found = await findNfeByReference(input.companyId, resolvedKey);
  if (!found.nfe) {
    if (found.ambiguous || listedNotes.length > 0) {
      return buildNfeSelectionPrompt(listedNotes);
    }

    return "Nao consegui identificar essa NF-e. Se puder, me envie a chave completa da nota.";
  }

  const output = input.wantsProducts ? buildNfeProductsReply(found.nfe) : buildNfeDetailReply(found.nfe);

  await safeRememberNfeConversation({
    companyId: input.companyId,
    phone: input.phone,
    listedNotes: listedNotes.length > 0 ? listedNotes : await fetchRecentNfeReferences(input.companyId),
    selectedChave: found.nfe.chave,
  });

  return output;
}

function toCompactJson(value: unknown, maxChars = 2600): string {
  const json = JSON.stringify(value);
  if (!json) {
    return "{}";
  }

  if (json.length <= maxChars) {
    return json;
  }

  return `${json.slice(0, maxChars - 3)}...`;
}

function readStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumberArg(
  args: Record<string, unknown>,
  key: string,
  options: { defaultValue: number; min: number; max: number },
): number {
  const value = args[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return options.defaultValue;
  }

  const normalized = Math.trunc(parsed);
  if (normalized < options.min) {
    return options.min;
  }

  if (normalized > options.max) {
    return options.max;
  }

  return normalized;
}

function readOptionalNumberArg(
  args: Record<string, unknown>,
  key: string,
  options: { min: number; max: number },
): number | null {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = Math.trunc(parsed);
  if (normalized < options.min) {
    return options.min;
  }

  if (normalized > options.max) {
    return options.max;
  }

  return normalized;
}

function readBooleanArg(args: Record<string, unknown>, key: string, defaultValue = false): boolean {
  const value = args[key];
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "nao", "não"].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

function buildAgentConversationHistory(context: ConversationContextPayload, currentUserMessage: string): AgentConversationMessage[] {
  const raw = Array.isArray(context.recentMessages) ? context.recentMessages : [];
  const history: AgentConversationMessage[] = raw
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role,
      text: item.text,
    }))
    .filter((item) => item.text.trim().length > 0);

  const last = history[history.length - 1];
  if (
    last &&
    last.role === "user" &&
    normalizeForMatch(last.text) === normalizeForMatch(currentUserMessage)
  ) {
    history.pop();
  }

  return history.slice(-12);
}

async function handleNfeToolAgentConversation(input: {
  companyId: string;
  phone: string;
  userMessage: string;
}): Promise<string> {
  const memory = await prisma.conversationMemory.findUnique({
    where: {
      companyId_phoneE164: {
        companyId: input.companyId,
        phoneE164: input.phone,
      },
    },
    select: {
      contextJson: true,
    },
  });

  const context = parseConversationContext(memory?.contextJson);
  const history = buildAgentConversationHistory(context, input.userMessage);

  const result = await aiService.runToolAgent({
    companyId: input.companyId,
    userMessage: input.userMessage,
    conversationHistory: history,
    systemInstruction: [
      "Voce e um agente de operacao fiscal conectado a ferramentas reais do sistema.",
      "Sempre que precisar de dados, use ferramentas; nao responda no chute.",
      "Se houver ambiguidade de nota, peca confirmacao objetiva da referencia.",
      "Para acao de importar notas detectadas, so execute com confirm=true apos pedido explicito do usuario.",
      "Se o usuario perguntar o que voce faz, descreva suas capacidades reais no sistema.",
    ].join("\n"),
    tools: [
      {
        name: "nfe_get_overview",
        description: "Retorna resumo atual de NF-e (contagens por status e notas recentes).",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          const [counts, recent] = await Promise.all([
            prisma.nfeDocument.groupBy({
              by: ["status"],
              where: { companyId: input.companyId },
              _count: { _all: true },
            }),
            prisma.nfeDocument.findMany({
              where: { companyId: input.companyId },
              orderBy: { createdAt: "desc" },
              take: 5,
              select: {
                chave: true,
                valorTotal: true,
                status: true,
                emitenteNome: true,
                createdAt: true,
              },
            }),
          ]);

          const map = counts.reduce<Record<string, number>>((acc, item) => {
            acc[item.status] = item._count._all;
            return acc;
          }, {});

          const references = toNfeReferenceMemoryList(recent);
          if (references.length > 0) {
            await safeRememberNfeConversation({
              companyId: input.companyId,
              phone: input.phone,
              listedNotes: references,
              selectedChave: context.nfe?.selectedChave ?? null,
            });
          }

          return toCompactJson({
            importadas: map.imported ?? 0,
            detectadas: map.detected ?? 0,
            falhas: map.failed ?? 0,
            recentes: recent.map((nfe) => ({
              chave: nfe.chave,
              valor: Number(nfe.valorTotal),
              valorFmt: formatCurrency(Number(nfe.valorTotal)),
              status: nfe.status,
              statusFmt: formatNfeStatus(nfe.status),
              emitente: nfe.emitenteNome,
            })),
          });
        },
      },
      {
        name: "nfe_list_notes",
        description: "Lista notas por status/opcionalmente por busca textual.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["detected", "imported", "failed"] },
            limit: { type: "integer", minimum: 1, maximum: 20 },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
        execute: async (args) => {
          const statusRaw = readStringArg(args, "status");
          const status = statusRaw === "detected" || statusRaw === "imported" || statusRaw === "failed" ? statusRaw : undefined;
          const limit = readNumberArg(args, "limit", { defaultValue: 8, min: 1, max: 20 });
          const query = readStringArg(args, "query");

          const notes = await prisma.nfeDocument.findMany({
            where: {
              companyId: input.companyId,
              status,
              OR: query
                ? [{ chave: { contains: query } }, { emitenteNome: { contains: query } }, { emitenteCnpj: { contains: query } }]
                : undefined,
            },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: {
              chave: true,
              valorTotal: true,
              status: true,
              emitenteNome: true,
              createdAt: true,
            },
          });

          const references = toNfeReferenceMemoryList(notes);
          if (references.length > 0) {
            await safeRememberNfeConversation({
              companyId: input.companyId,
              phone: input.phone,
              listedNotes: references,
              selectedChave: null,
            });
          }

          return toCompactJson({
            total: notes.length,
            status,
            notas: notes.map((nfe) => ({
              chave: nfe.chave,
              valor: Number(nfe.valorTotal),
              valorFmt: formatCurrency(Number(nfe.valorTotal)),
              status: nfe.status,
              statusFmt: formatNfeStatus(nfe.status),
              emitente: nfe.emitenteNome,
            })),
          });
        },
      },
      {
        name: "nfe_get_note_details",
        description: "Busca detalhes de uma NF-e por referencia (chave, final da chave, valor ou referencia contextual).",
        parameters: {
          type: "object",
          properties: {
            reference: { type: "string" },
            includeItems: { type: "boolean" },
          },
          required: ["reference"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const reference = readStringArg(args, "reference") ?? input.userMessage;
          const includeItems = readBooleanArg(args, "includeItems", true);
          const state = await getNfeConversationState(input.companyId, input.phone);
          const listedNotes = state?.listedNotes?.length ? state.listedNotes : await fetchRecentNfeReferences(input.companyId);

          const resolvedKey = resolveReferencedNfeKey({
            message: reference,
            listedNotes,
            selectedChave: state?.selectedChave ?? null,
            wantsProducts: includeItems,
          });

          if (!resolvedKey) {
            return toCompactJson({
              ok: false,
              precisaConfirmar: true,
              mensagem: "Referencia ambigua. Preciso da chave, valor aproximado ou numero da lista.",
              sugestao: buildNfeSelectionPrompt(listedNotes),
            });
          }

          const found = await findNfeByReference(input.companyId, resolvedKey);
          if (!found.nfe) {
            return toCompactJson({
              ok: false,
              precisaConfirmar: true,
              mensagem: found.ambiguous
                ? "Referencia retornou mais de uma nota. Preciso de um identificador mais especifico."
                : "Nao encontrei nota para essa referencia.",
              sugestao: buildNfeSelectionPrompt(listedNotes),
            });
          }

          await safeRememberNfeConversation({
            companyId: input.companyId,
            phone: input.phone,
            listedNotes: listedNotes.length > 0 ? listedNotes : await fetchRecentNfeReferences(input.companyId),
            selectedChave: found.nfe.chave,
          });

          return toCompactJson({
            ok: true,
            nota: {
              chave: found.nfe.chave,
              valor: Number(found.nfe.valorTotal),
              valorFmt: formatCurrency(Number(found.nfe.valorTotal)),
              status: found.nfe.status,
              statusFmt: formatNfeStatus(found.nfe.status),
              emitenteNome: found.nfe.emitenteNome,
              emitenteCnpj: found.nfe.emitenteCnpj,
              dataEmissao: found.nfe.dataEmissao ? found.nfe.dataEmissao.toISOString() : null,
              dataEmissaoFmt: formatDateBr(found.nfe.dataEmissao),
              itensTotal: found.nfe.items.length,
              itens: includeItems
                ? found.nfe.items.slice(0, MAX_NFE_PRODUCT_LINES).map((item) => ({
                    codigo: item.codigo,
                    descricao: item.descricao,
                    qtd: Number(item.qtd),
                    qtdFmt: formatDecimal(Number(item.qtd)),
                    total: Number(item.vTotal),
                    totalFmt: formatCurrency(Number(item.vTotal)),
                  }))
                : [],
              itensOmitidos: includeItems ? Math.max(0, found.nfe.items.length - MAX_NFE_PRODUCT_LINES) : found.nfe.items.length,
            },
          });
        },
      },
      {
        name: "nfe_import_detected",
        description: "Importa notas detectadas para status imported. Exige confirmacao explicita (confirm=true).",
        parameters: {
          type: "object",
          properties: {
            confirm: { type: "boolean" },
          },
          required: ["confirm"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const confirm = readBooleanArg(args, "confirm", false);
          if (!confirm) {
            return toCompactJson({
              ok: false,
              importedCount: 0,
              mensagem: "Importacao nao executada. Aguarde confirmacao explicita do usuario antes de importar.",
            });
          }

          const result = await prisma.nfeDocument.updateMany({
            where: {
              companyId: input.companyId,
              status: "detected",
            },
            data: {
              status: "imported",
              importedAt: new Date(),
            },
          });

          const recentReferences = await fetchRecentNfeReferences(input.companyId);
          if (recentReferences.length > 0) {
            await safeRememberNfeConversation({
              companyId: input.companyId,
              phone: input.phone,
              listedNotes: recentReferences,
              selectedChave: null,
            });
          } else {
            await safeClearNfeConversationState(input.companyId, input.phone);
          }

          return toCompactJson({
            ok: true,
            importedCount: result.count,
            mensagem:
              result.count > 0
                ? `${result.count} nota(s) detectada(s) foram importadas com sucesso.`
                : "Nao havia notas detectadas para importar.",
          });
        },
      },
    ],
  });

  return result.text;
}

async function handleBarberToolAgentConversation(input: {
  companyId: string;
  incoming: IncomingData;
  replyPhone: string;
}): Promise<BarberConversationReply> {
  const userMessage = (input.incoming.text || "").trim() || "Solicitacao de agendamento via WhatsApp";
  const memory = await prisma.conversationMemory.findUnique({
    where: {
      companyId_phoneE164: {
        companyId: input.companyId,
        phoneE164: input.replyPhone,
      },
    },
    select: {
      contextJson: true,
    },
  });

  const context = parseConversationContext(memory?.contextJson);
  const history = buildAgentConversationHistory(context, userMessage);
  let operationResult: BarberConversationReply | null = null;

  await aiService.runToolAgent({
    companyId: input.companyId,
    userMessage,
    conversationHistory: history,
    systemInstruction: [
      "Voce e um agente operacional de agendamento conectado a ferramentas reais.",
      "Para responder o cliente, execute SEMPRE a ferramenta booking_handle_request.",
      "Nao invente servicos, horarios, disponibilidade ou cadastro.",
      "Use booking_get_capabilities apenas para explicar o que o sistema faz.",
      "Se o cliente pedir cancelamento, aplique as regras reais de antecedencia do sistema.",
    ].join("\n"),
    tools: [
      {
        name: "booking_handle_request",
        description:
          "Executa o fluxo completo de agendamento/agenda/cancelamento/recibo/fidelidade para a mensagem atual do cliente.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          if (!operationResult) {
            operationResult = await handleBarberConversation({
              companyId: input.companyId,
              incoming: input.incoming,
              replyPhone: input.replyPhone,
            });
          }

          return toCompactJson({
            intent: operationResult.intent,
            text: operationResult.text,
            hasAttachment: Boolean(operationResult.attachment),
          });
        },
      },
      {
        name: "booking_get_capabilities",
        description: "Retorna as capacidades reais do atendimento de agendamento.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () =>
          toCompactJson({
            capacidades: [
              "listar servicos ativos",
              "agendar horario",
              "consultar agenda do cliente",
              "cancelar com politica de antecedencia",
              "emitir recibo de atendimento concluido",
              "consultar fidelidade do cliente",
            ],
            comandosExemplo: ["servicos", "agendar", "agenda", "cancelar", "recibo", "fidelidade"],
          }),
      },
    ],
    maxSteps: 4,
  });

  if (operationResult) {
    return operationResult;
  }

  return handleBarberConversation({
    companyId: input.companyId,
    incoming: input.incoming,
    replyPhone: input.replyPhone,
  });
}

async function buildBillingFallbackReply(input: {
  companyId: string;
  phoneCandidates: string[];
  hasMedia: boolean;
}): Promise<{ intent: BillingAgentIntent; text: string }> {
  const supplier = await findBillingSupplierByPhone(input.companyId, input.phoneCandidates);
  if (!supplier) {
    const lines = [
      "Recebi sua mensagem no atendimento financeiro.",
      input.hasMedia ? "Arquivo recebido no CRM com sucesso." : "",
      "Nao consegui localizar seu cadastro por este numero.",
      "Me informe CPF/CNPJ ou razao social para eu localizar seus documentos.",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      intent: "billing_help",
      text: lines,
    };
  }

  const [pendingCount, overdueCount, nextDocument] = await Promise.all([
    prisma.billingDocument.count({
      where: {
        companyId: input.companyId,
        supplierId: supplier.id,
        status: "pending",
      },
    }),
    prisma.billingDocument.count({
      where: {
        companyId: input.companyId,
        supplierId: supplier.id,
        status: "overdue",
      },
    }),
    prisma.billingDocument.findFirst({
      where: {
        companyId: input.companyId,
        supplierId: supplier.id,
        status: {
          in: ["pending", "overdue"],
        },
      },
      orderBy: { dueDate: "asc" },
      select: {
        description: true,
        amount: true,
        dueDate: true,
        status: true,
      },
    }),
  ]);

  const lines = [
    `Recebi sua mensagem, ${supplier.name}.`,
    pendingCount > 0 || overdueCount > 0
      ? `Seus documentos em aberto: pendentes ${pendingCount} | vencidos ${overdueCount}.`
      : "No momento nao encontrei documentos pendentes ou vencidos para o seu cadastro.",
    nextDocument
      ? `Proximo vencimento: ${nextDocument.description} em ${formatDateBr(nextDocument.dueDate)} (${formatCurrency(
          Number(nextDocument.amount),
        )}) - ${formatBillingDocumentStatus(nextDocument.status)}.`
      : "",
    "Se quiser, eu posso listar por mes ou por prazo de vencimento (30, 15 ou 7 dias).",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    intent: pendingCount > 0 || overdueCount > 0 ? "billing_documents" : "billing_profile",
    text: lines,
  };
}

async function handleBillingToolAgentConversation(input: {
  companyId: string;
  incoming: IncomingData;
  replyPhone: string;
}): Promise<{ intent: BillingAgentIntent; text: string }> {
  const userMessage = (input.incoming.text || "").trim() || "Mensagem recebida no canal de cobranca.";
  const memory = await prisma.conversationMemory.findUnique({
    where: {
      companyId_phoneE164: {
        companyId: input.companyId,
        phoneE164: input.replyPhone,
      },
    },
    select: {
      contextJson: true,
    },
  });

  const context = parseConversationContext(memory?.contextJson);
  const history = buildAgentConversationHistory(context, userMessage);
  const normalizedReplyPhone = normalizePhone(input.replyPhone) || input.replyPhone;
  const phoneCandidates = buildPhoneCandidates(normalizedReplyPhone);
  let inferredIntent: BillingAgentIntent = detectBillingIntent(userMessage);
  const supplierByPhone = await findBillingSupplierByPhone(input.companyId, phoneCandidates);

  const resolveSupplier = async (args: Record<string, unknown>) => {
    const query = readStringArg(args, "query");
    if (!query) {
      return supplierByPhone;
    }

    const queryDigits = onlyDigits(query);
    const conditions: Prisma.BillingSupplierWhereInput[] = [
      { name: { contains: query } },
      { externalCode: { contains: query } },
    ];

    if (queryDigits.length > 0) {
      conditions.push({ document: { contains: queryDigits } });
    }

    const candidates = await prisma.billingSupplier.findMany({
      where: {
        companyId: input.companyId,
        OR: conditions,
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    });

    if (candidates.length === 0) {
      return null;
    }

    if (supplierByPhone) {
      const byPhoneMatch = candidates.find((item) => item.id === supplierByPhone.id);
      if (byPhoneMatch) {
        return byPhoneMatch;
      }
    }

    return candidates[0] ?? null;
  };

  const result = await aiService.runToolAgent({
    companyId: input.companyId,
    userMessage,
    conversationHistory: history,
    systemInstruction: [
      "Voce e um agente de cobranca e CRM conectado a ferramentas reais do sistema.",
      "Sempre use ferramentas para localizar cliente, documentos e vencimentos antes de responder.",
      "Nao invente valores, vencimentos, status ou codigo de documento.",
      "Se nao localizar o cliente pelo numero, peca CPF/CNPJ ou razao social.",
      "Responda de forma natural e objetiva para WhatsApp.",
    ].join("\n"),
    tools: [
      {
        name: "billing_get_customer_profile",
        description: "Localiza um cliente de cobranca e retorna cadastro + resumo de documentos.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          additionalProperties: false,
        },
        execute: async (args) => {
          inferredIntent = "billing_profile";
          const supplier = await resolveSupplier(args);
          if (!supplier) {
            return toCompactJson({
              ok: false,
              mensagem: "Nao encontrei cliente com essa referencia.",
              acao: "Solicitar CPF/CNPJ ou razao social para localizar o cadastro.",
            });
          }

          const [summaryByStatus, nextDocument] = await Promise.all([
            prisma.billingDocument.groupBy({
              by: ["status"],
              where: {
                companyId: input.companyId,
                supplierId: supplier.id,
              },
              _count: { _all: true },
              _sum: { amount: true },
            }),
            prisma.billingDocument.findFirst({
              where: {
                companyId: input.companyId,
                supplierId: supplier.id,
                status: {
                  in: ["pending", "overdue"],
                },
              },
              orderBy: { dueDate: "asc" },
              select: {
                description: true,
                amount: true,
                dueDate: true,
                status: true,
              },
            }),
          ]);

          const totals = summaryByStatus.reduce<Record<string, { count: number; amount: number }>>((acc, item) => {
            acc[item.status] = {
              count: item._count._all,
              amount: Number(item._sum.amount ?? 0),
            };
            return acc;
          }, {});

          return toCompactJson({
            ok: true,
            cliente: {
              id: supplier.id,
              nome: supplier.name,
              documento: supplier.document,
              telefone: supplier.phoneE164,
              email: supplier.email,
              autoEnvio: supplier.autoSendEnabled,
            },
            documentos: {
              pendentes: totals.pending?.count ?? 0,
              pendentesValor: totals.pending?.amount ?? 0,
              pendentesValorFmt: formatCurrency(totals.pending?.amount ?? 0),
              pagos: totals.paid?.count ?? 0,
              pagosValor: totals.paid?.amount ?? 0,
              pagosValorFmt: formatCurrency(totals.paid?.amount ?? 0),
              vencidos: totals.overdue?.count ?? 0,
              vencidosValor: totals.overdue?.amount ?? 0,
              vencidosValorFmt: formatCurrency(totals.overdue?.amount ?? 0),
            },
            proximoDocumento: nextDocument
              ? {
                  descricao: nextDocument.description,
                  valor: Number(nextDocument.amount),
                  valorFmt: formatCurrency(Number(nextDocument.amount)),
                  vencimento: nextDocument.dueDate.toISOString(),
                  vencimentoFmt: formatDateBr(nextDocument.dueDate),
                  status: nextDocument.status,
                  statusFmt: formatBillingDocumentStatus(nextDocument.status),
                }
              : null,
          });
        },
      },
      {
        name: "billing_list_documents",
        description: "Lista documentos do cliente com filtros de status, prazo (dias) e mes/ano.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            status: { type: "string", enum: ["pending", "paid", "overdue"] },
            daysAhead: { type: "integer", minimum: 0, maximum: 365 },
            month: { type: "integer", minimum: 1, maximum: 12 },
            year: { type: "integer", minimum: 2020, maximum: 2100 },
            limit: { type: "integer", minimum: 1, maximum: 20 },
          },
          additionalProperties: false,
        },
        execute: async (args) => {
          inferredIntent = "billing_documents";
          const supplier = await resolveSupplier(args);
          if (!supplier) {
            return toCompactJson({
              ok: false,
              mensagem: "Nao encontrei cliente com essa referencia.",
              acao: "Solicitar CPF/CNPJ ou razao social para localizar os documentos.",
            });
          }

          const statusRaw = readStringArg(args, "status");
          const status = statusRaw === "pending" || statusRaw === "paid" || statusRaw === "overdue" ? statusRaw : undefined;
          const limit = readNumberArg(args, "limit", { defaultValue: 8, min: 1, max: 20 });
          const daysAhead = readOptionalNumberArg(args, "daysAhead", { min: 0, max: 365 });
          const month = readOptionalNumberArg(args, "month", { min: 1, max: 12 });
          const year = readOptionalNumberArg(args, "year", { min: 2020, max: 2100 });
          const textQuery = readStringArg(args, "query");

          let dueDateFilter: Prisma.DateTimeFilter | undefined;
          if (month !== null && year !== null) {
            const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
            const end = new Date(year, month, 0, 23, 59, 59, 999);
            dueDateFilter = { gte: start, lte: end };
          } else if (daysAhead !== null) {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + daysAhead);
            end.setHours(23, 59, 59, 999);
            dueDateFilter = { gte: start, lte: end };
          }

          const where: Prisma.BillingDocumentWhereInput = {
            companyId: input.companyId,
            supplierId: supplier.id,
            status,
            dueDate: dueDateFilter,
          };

          if (textQuery) {
            where.OR = [{ description: { contains: textQuery } }, { externalKey: { contains: textQuery } }];
          }

          const documents = await prisma.billingDocument.findMany({
            where,
            orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
            take: limit,
            select: {
              id: true,
              externalKey: true,
              description: true,
              amount: true,
              dueDate: true,
              status: true,
              duplicateNumber: true,
              installment: true,
              boletoLine: true,
              barcode: true,
            },
          });

          return toCompactJson({
            ok: true,
            cliente: {
              id: supplier.id,
              nome: supplier.name,
              documento: supplier.document,
            },
            filtro: {
              status: status ?? null,
              daysAhead,
              month,
              year,
              limit,
            },
            total: documents.length,
            documentos: documents.map((document) => ({
              id: document.id,
              chave: document.externalKey,
              descricao: document.description,
              valor: Number(document.amount),
              valorFmt: formatCurrency(Number(document.amount)),
              vencimento: document.dueDate.toISOString(),
              vencimentoFmt: formatDateBr(document.dueDate),
              status: document.status,
              statusFmt: formatBillingDocumentStatus(document.status),
              duplicata: document.duplicateNumber,
              parcela: document.installment,
              codigoBarras: document.boletoLine ?? document.barcode ?? null,
            })),
          });
        },
      },
      {
        name: "billing_get_capabilities",
        description: "Informa as capacidades operacionais do atendimento de cobranca.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          inferredIntent = "billing_help";
          return toCompactJson({
            capacidades: [
              "localizar cadastro de cliente por telefone ou referencia",
              "listar documentos pendentes, pagos e vencidos",
              "filtrar vencimentos por mes/ano",
              "filtrar documentos por prazo (ex.: 30, 15 e 7 dias)",
              "consultar detalhes de boletos e codigos de barras",
            ],
          });
        },
      },
    ],
    maxSteps: 5,
  });

  const resultText = result.text.trim();
  const providerUnavailable = normalizeForMatch(resultText).includes("no momento nao consigo responder com ia generativa");
  if (result.usedTools.length === 0 || resultText.length === 0 || providerUnavailable) {
    return buildBillingFallbackReply({
      companyId: input.companyId,
      phoneCandidates,
      hasMedia: input.incoming.hasMedia,
    });
  }

  return {
    intent: inferredIntent,
    text: resultText,
  };
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function isRepeatedDigits(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}

function isValidCpf(cpf: string): boolean {
  if (cpf.length !== 11 || isRepeatedDigits(cpf)) {
    return false;
  }

  const calcDigit = (base: string, factor: number) => {
    let total = 0;
    for (const char of base) {
      total += Number(char) * factor;
      factor -= 1;
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const first = calcDigit(cpf.slice(0, 9), 10);
  const second = calcDigit(cpf.slice(0, 10), 11);

  return first === Number(cpf[9]) && second === Number(cpf[10]);
}

function isValidCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14 || isRepeatedDigits(cnpj)) {
    return false;
  }

  const calcDigit = (base: string, factors: number[]) => {
    const total = base.split("").reduce((acc, digit, index) => acc + Number(digit) * factors[index]!, 0);
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = calcDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calcDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

function validateAndNormalizeCustomerDocument(value: string): { normalized: string; type: "cpf" | "cnpj" } | null {
  const normalized = onlyDigits(value);

  if (isValidCpf(normalized)) {
    return { normalized, type: "cpf" };
  }

  if (isValidCnpj(normalized)) {
    return { normalized, type: "cnpj" };
  }

  return null;
}

function formatCustomerDocument(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return value;
}

function extractCustomerDocument(message: string): string | null {
  const explicitPatterns = [
    /(?:cpf|documento)\s*[:\-]?\s*([\d.\-\/]{11,18})/i,
    /(?:cnpj|documento)\s*[:\-]?\s*([\d.\-\/]{14,20})/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = message.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const normalized = validateAndNormalizeCustomerDocument(match[1]);
    if (normalized) {
      return normalized.normalized;
    }
  }

  const genericCandidates = message.match(/\d[\d.\-\/]{9,20}\d/g) ?? [];
  for (const candidate of genericCandidates) {
    const normalized = validateAndNormalizeCustomerDocument(candidate);
    if (normalized) {
      return normalized.normalized;
    }
  }

  return null;
}

function buildMissingCustomerFields(input: {
  clientName: string | null;
  clientDocument: string | null;
}): PendingCustomerField[] {
  const missing: PendingCustomerField[] = [];
  if (!input.clientName) {
    missing.push("nome");
  }
  if (!input.clientDocument) {
    missing.push("documento");
  }
  return missing;
}

function isGreetingOnlyMessage(message: string): boolean {
  const normalized = normalizeForMatch(message)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return false;
  }

  if (
    normalized.includes("agend") ||
    normalized.includes("servic") ||
    normalized.includes("recibo") ||
    normalized.includes("fidelidade") ||
    normalized.includes("cancel") ||
    normalized.includes("agenda") ||
    normalized.includes("horario")
  ) {
    return false;
  }

  const greetings = [
    "oi",
    "ola",
    "opa",
    "e ai",
    "eae",
    "salve",
    "bom dia",
    "boa tarde",
    "boa noite",
    "tudo bem",
    "td bem",
    "blz",
    "beleza",
  ];

  if (greetings.includes(normalized)) {
    return true;
  }

  return (
    /^(oi|ola|opa|e ai|eae|salve|bom dia|boa tarde|boa noite)(\s+(tudo bem|td bem|blz|beleza))?$/.test(normalized) ||
    /^(tudo bem|td bem)\s*(oi|ola)?$/.test(normalized)
  );
}

function detectBarberIntent(message: string): BarberIntent {
  const text = normalizeForMatch(message);

  if (text.includes("recibo") || text.includes("comprovante")) {
    return "recibo";
  }

  if (text.includes("fidelidade") || text.includes("cartao fidelidade") || text.includes("pontos")) {
    return "fidelidade";
  }

  if (text.includes("cancel") || text.includes("desmarc")) {
    return "cancelar";
  }

  if (text.includes("agend") || text.includes("marcar") || text.includes("remarc") || text.includes("reagend")) {
    return "agendar";
  }

  if (text.includes("agenda") || text.includes("horario") || text.includes("agendamentos")) {
    return "agenda";
  }

  if (text.includes("servic") || text.includes("preco") || text.includes("valor") || text.includes("corte")) {
    return "listar_servicos";
  }

  return "ajuda";
}

function detectBillingIntent(message: string): BillingAgentIntent {
  const text = normalizeForMatch(message);

  if (
    text.includes("venc") ||
    text.includes("boleto") ||
    text.includes("fatura") ||
    text.includes("document") ||
    text.includes("pagamento") ||
    text.includes("pagar") ||
    text.includes("penden") ||
    text.includes("cobranc")
  ) {
    return "billing_documents";
  }

  if (
    text.includes("cadastro") ||
    text.includes("meu dado") ||
    text.includes("atualizar") ||
    text.includes("cpf") ||
    text.includes("cnpj")
  ) {
    return "billing_profile";
  }

  return "crm_inbound";
}

function formatBillingDocumentStatus(status: "pending" | "paid" | "overdue"): string {
  if (status === "pending") {
    return "pendente";
  }

  if (status === "paid") {
    return "pago";
  }

  return "vencido";
}

function summarizeNeedsMoreData(operationSummary: string): boolean {
  const normalized = normalizeForMatch(operationSummary || "");
  return (
    normalized.includes("preciso de") ||
    normalized.includes("preciso do") ||
    normalized.includes("preciso da") ||
    normalized.includes("me informe") ||
    normalized.includes("falta") ||
    normalized.includes("faltam") ||
    normalized.includes("pendencia") ||
    normalized.includes("pendencia") ||
    normalized.includes("solicitar novamente") ||
    normalized.includes("solicitar ao cliente") ||
    normalized.includes("solicitar um novo horario") ||
    normalized.includes("novo horario")
  );
}

function looksLikeBookingConfirmed(text: string): boolean {
  const normalized = normalizeForMatch(text || "");
  return (
    normalized.includes("agendamento confirmado") ||
    normalized.includes("confirmando:") ||
    normalized.includes("confirmando ") ||
    normalized.includes("deixo tudo pronto") ||
    normalized.includes("ja deixo tudo pronto") ||
    normalized.includes("tudo certo?")
  );
}

function normalizeClientName(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\s'-]/gu, "");

  if (cleaned.length < 2) {
    return null;
  }

  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 80);
}

function looksLikeStandaloneName(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  if (/\d/.test(trimmed)) {
    return false;
  }

  const normalized = normalizeForMatch(trimmed);
  const blockedTokens = [
    "agend",
    "marcar",
    "servic",
    "horario",
    "agenda",
    "cancel",
    "barba",
    "corte",
    "hoje",
    "amanha",
  ];
  if (blockedTokens.some((token) => normalized.includes(token))) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) {
    return false;
  }

  return /^[\p{L}\s'-]+$/u.test(trimmed);
}

function sanitizeExtractedClientName(rawValue: string): string {
  return rawValue
    .replace(/\s+e\s+(?:quero|gostaria|preciso|posso|pode|tem|amanha|hoje)\b.*$/i, "")
    .replace(/\s+(?:amanha|hoje)\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractClientName(message: string): string | null {
  const patterns = [
    /(?:meu nome\s*(?:e|é)|nome)\s*[:\-]?\s*([^\n,.!?]+?)(?=(?:\s+e\s+(?:quero|gostaria|preciso|posso|pode|tem|amanha|hoje)\b|$))/i,
    /me chamo\s+([^\n,.!?]+?)(?=(?:\s+e\s+(?:quero|gostaria|preciso|posso|pode|tem|amanha|hoje)\b|$))/i,
    /sou\s+([^\n,.!?]+?)(?=(?:\s+e\s+(?:quero|gostaria|preciso|posso|pode|tem|amanha|hoje)\b|$))/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const normalized = normalizeClientName(sanitizeExtractedClientName(match[1]));
    if (normalized) {
      return normalized;
    }
  }

  if (looksLikeStandaloneName(message)) {
    return normalizeClientName(message);
  }

  return null;
}

function buildBarberDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(result.getTime())) {
    return null;
  }

  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day ||
    result.getHours() !== hour ||
    result.getMinutes() !== minute
  ) {
    return null;
  }

  return result;
}

function parseBarberDateOnly(message: string): BarberDateParts | null {
  const normalized = normalizeForMatch(message).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const fullYear = normalized.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (fullYear) {
    const day = Number(fullYear[1]);
    const month = Number(fullYear[2]);
    const year = Number(fullYear[3]);
    const candidate = buildBarberDateTime(year, month, day, 12, 0);
    if (candidate) {
      return { year, month, day };
    }
  }

  const noYear = normalized.match(/\b(\d{2})\/(\d{2})(?!\/\d{4})\b/);
  if (noYear) {
    const day = Number(noYear[1]);
    const month = Number(noYear[2]);
    const now = new Date();
    let year = now.getFullYear();
    let candidate = buildBarberDateTime(year, month, day, 12, 0);
    if (candidate && candidate.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
      year += 1;
      candidate = buildBarberDateTime(year, month, day, 12, 0);
    }
    if (candidate) {
      return { year, month, day };
    }
  }

  const relative = normalized.match(/\b(hoje|amanha)\b/);
  if (relative) {
    const base = new Date();
    if (relative[1] === "amanha") {
      base.setDate(base.getDate() + 1);
    }

    return {
      year: base.getFullYear(),
      month: base.getMonth() + 1,
      day: base.getDate(),
    };
  }

  return null;
}

function parseBarberTimeOnly(message: string): BarberTimeParts | null {
  const normalizeTime = (hour: number, minute: number): BarberTimeParts | null => {
    const candidate = buildBarberDateTime(2026, 1, 1, hour, minute);
    if (!candidate) {
      return null;
    }
    return { hour, minute };
  };

  const normalized = normalizeForMatch(message).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const colon = normalized.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    const parsed = normalizeTime(Number(colon[1]), Number(colon[2]));
    if (parsed) {
      return parsed;
    }
  }

  const compact = normalized.match(/\b(\d{1,2})h(\d{1,2})\b/);
  if (compact) {
    const parsed = normalizeTime(Number(compact[1]), Number(compact[2]));
    if (parsed) {
      return parsed;
    }
  }

  const withWords = normalized.match(
    /\b(\d{1,2})\s*(?:h|hs|hora|horas)\b(?:[^\d]*(\d{1,2})\s*(?:min|minuto|minutos))?/,
  );
  if (withWords) {
    const hour = Number(withWords[1]);
    const minute = withWords[2] ? Number(withWords[2]) : 0;
    const parsed = normalizeTime(hour, minute);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function resolveNearestFutureFromTime(time: BarberTimeParts): Date | null {
  const now = new Date();
  const today = buildBarberDateTime(now.getFullYear(), now.getMonth() + 1, now.getDate(), time.hour, time.minute);
  if (!today) {
    return null;
  }

  if (today.getTime() >= now.getTime()) {
    return today;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return buildBarberDateTime(tomorrow.getFullYear(), tomorrow.getMonth() + 1, tomorrow.getDate(), time.hour, time.minute);
}

function parseBarberDateTime(message: string): Date | null {
  const isoMatch = message.match(/(\d{4}-\d{2}-\d{2})[ t](\d{1,2}:\d{2})/i);
  if (isoMatch) {
    const [year, month, day] = isoMatch[1].split("-").map((part) => Number(part));
    const [hour, minute] = isoMatch[2].split(":").map((part) => Number(part));
    const result = buildBarberDateTime(year, month, day, hour, minute);
    if (result) {
      return result;
    }
  }

  const brMatch = message.match(/(\d{2})\/(\d{2})\/(\d{4})[^\d]*(\d{1,2}:\d{2})/);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    const year = Number(brMatch[3]);
    const [hour, minute] = brMatch[4].split(":").map((part) => Number(part));
    const result = buildBarberDateTime(year, month, day, hour, minute);
    if (result) {
      return result;
    }
  }

  const brHourWordsMatch = message.match(
    /(\d{2})\/(\d{2})\/(\d{4})[^\d]*(\d{1,2})\s*(?:h|hs|hora|horas)\b(?:[^\d]*(\d{1,2})\s*(?:min|minuto|minutos))?/i,
  );
  if (brHourWordsMatch) {
    const day = Number(brHourWordsMatch[1]);
    const month = Number(brHourWordsMatch[2]);
    const year = Number(brHourWordsMatch[3]);
    const hour = Number(brHourWordsMatch[4]);
    const minute = brHourWordsMatch[5] ? Number(brHourWordsMatch[5]) : 0;
    const result = buildBarberDateTime(year, month, day, hour, minute);
    if (result) {
      return result;
    }
  }

  const brNoYearMatch = message.match(/(\d{2})\/(\d{2})(?!\/\d{4})[^\d]*(\d{1,2}:\d{2})/);
  if (brNoYearMatch) {
    const day = Number(brNoYearMatch[1]);
    const month = Number(brNoYearMatch[2]);
    const [hour, minute] = brNoYearMatch[3].split(":").map((part) => Number(part));
    const now = new Date();
    const result = buildBarberDateTime(now.getFullYear(), month, day, hour, minute);
    if (result) {
      if (result.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
        result.setFullYear(result.getFullYear() + 1);
      }
      return result;
    }
  }

  const brNoYearHourWordsMatch = message.match(
    /(\d{2})\/(\d{2})(?!\/\d{4})[^\d]*(\d{1,2})\s*(?:h|hs|hora|horas)\b(?:[^\d]*(\d{1,2})\s*(?:min|minuto|minutos))?/i,
  );
  if (brNoYearHourWordsMatch) {
    const day = Number(brNoYearHourWordsMatch[1]);
    const month = Number(brNoYearHourWordsMatch[2]);
    const hour = Number(brNoYearHourWordsMatch[3]);
    const minute = brNoYearHourWordsMatch[4] ? Number(brNoYearHourWordsMatch[4]) : 0;
    const now = new Date();
    const result = buildBarberDateTime(now.getFullYear(), month, day, hour, minute);
    if (result) {
      if (result.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
        result.setFullYear(result.getFullYear() + 1);
      }
      return result;
    }
  }

  const normalized = normalizeForMatch(message).replace(/\s+/g, " ").trim();
  const relativeMatch = normalized.match(/\b(hoje|amanha)\b[^\d]*(\d{1,2}:\d{2})/);
  if (relativeMatch) {
    const [hour, minute] = relativeMatch[2].split(":").map((part) => Number(part));
    const base = new Date();
    if (relativeMatch[1] === "amanha") {
      base.setDate(base.getDate() + 1);
    }
    const result = buildBarberDateTime(base.getFullYear(), base.getMonth() + 1, base.getDate(), hour, minute);
    if (result) {
      return result;
    }
  }

  const relativeCompactMatch = normalized.match(/\b(hoje|amanha)\b[^\d]*(\d{1,2})h(\d{1,2})\b/);
  if (relativeCompactMatch) {
    const hour = Number(relativeCompactMatch[2]);
    const minute = Number(relativeCompactMatch[3]);
    const base = new Date();
    if (relativeCompactMatch[1] === "amanha") {
      base.setDate(base.getDate() + 1);
    }
    const result = buildBarberDateTime(base.getFullYear(), base.getMonth() + 1, base.getDate(), hour, minute);
    if (result) {
      return result;
    }
  }

  const relativeHourWordsMatch = normalized.match(
    /\b(hoje|amanha)\b[^\d]*(\d{1,2})\s*(?:h|hs|hora|horas)\b(?:[^\d]*(\d{1,2})\s*(?:min|minuto|minutos))?/,
  );
  if (relativeHourWordsMatch) {
    const hour = Number(relativeHourWordsMatch[2]);
    const minute = relativeHourWordsMatch[3] ? Number(relativeHourWordsMatch[3]) : 0;
    const base = new Date();
    if (relativeHourWordsMatch[1] === "amanha") {
      base.setDate(base.getDate() + 1);
    }
    const result = buildBarberDateTime(base.getFullYear(), base.getMonth() + 1, base.getDate(), hour, minute);
    if (result) {
      return result;
    }
  }

  const timeOnly = parseBarberTimeOnly(message);
  if (timeOnly) {
    return resolveNearestFutureFromTime(timeOnly);
  }

  return null;
}

function formatDateTimeBr(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function findByNameInText<T extends { name: string }>(message: string, items: T[]): T | null {
  const text = normalizeForMatch(message);
  const ordered = [...items].sort((a, b) => b.name.length - a.name.length);
  return ordered.find((item) => text.includes(normalizeForMatch(item.name))) ?? null;
}

function buildMissingBarberFields(input: {
  clientName: string | null;
  serviceFound: boolean;
  startsAt: Date | null;
}): PendingBarberField[] {
  const missing: PendingBarberField[] = [];
  if (!input.clientName) {
    missing.push("nome");
  }
  if (!input.serviceFound) {
    missing.push("servico");
  }
  if (!input.startsAt) {
    missing.push("horario");
  }
  return missing;
}

async function findBookingCustomerByPhone(companyId: string, phoneCandidates: string[]) {
  if (phoneCandidates.length === 0) {
    return null;
  }

  const wherePhone = phoneCandidates.flatMap((candidate) => [{ phoneE164: candidate }, { phoneE164: { endsWith: candidate } }]);
  const candidates = await prisma.bookingCustomer.findMany({
    where: {
      companyId,
      OR: wherePhone,
    },
    take: 20,
  });

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates
    .map((item) => ({
      item,
      score: phoneMatchScore(item.phoneE164, phoneCandidates),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score > 0 ? best.item : null;
}

async function findBillingSupplierByPhone(companyId: string, phoneCandidates: string[]) {
  if (phoneCandidates.length === 0) {
    return null;
  }

  const wherePhone = phoneCandidates.flatMap((candidate) => [{ phoneE164: candidate }, { phoneE164: { endsWith: candidate } }]);
  const candidates = await prisma.billingSupplier.findMany({
    where: {
      companyId,
      OR: wherePhone,
    },
    take: 20,
  });

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates
    .map((item) => ({
      item,
      score: phoneMatchScore(item.phoneE164 || "", phoneCandidates),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score > 0 ? best.item : null;
}

async function calculateBookingLoyaltyProgress(input: { companyId: string; customerId: string }): Promise<{
  completedServices: number;
  nextRewardIn: number;
  rewardsUnlocked: number;
}> {
  const completedServices = await prisma.barberAppointment.count({
    where: {
      companyId: input.companyId,
      bookingCustomerId: input.customerId,
      status: "completed",
    },
  });

  const rewardsUnlocked = Math.floor(completedServices / BOOKING_LOYALTY_GOAL);
  const nextRewardInRaw = BOOKING_LOYALTY_GOAL - (completedServices % BOOKING_LOYALTY_GOAL);
  const nextRewardIn = nextRewardInRaw === BOOKING_LOYALTY_GOAL ? 0 : nextRewardInRaw;

  return {
    completedServices,
    nextRewardIn,
    rewardsUnlocked,
  };
}

function looksLikeXml(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("<")) {
    return false;
  }

  const lowered = trimmed.slice(0, 300).toLowerCase();
  return (
    lowered.startsWith("<?xml") ||
    lowered.includes("<nfeproc") ||
    lowered.includes("<nfe ") ||
    lowered.includes("<nfe>") ||
    lowered.includes("<procnfe") ||
    lowered.includes("<envinfe")
  );
}

async function resolveXmlFromIncoming(incoming: IncomingData): Promise<string | null> {
  if (incoming.xmlContent && looksLikeXml(incoming.xmlContent)) {
    return incoming.xmlContent;
  }

  if (incoming.mediaUrl) {
    try {
      const buffer = await evolutionService.downloadMedia(incoming.mediaUrl);
      const text = buffer.toString("utf8");
      if (looksLikeXml(text)) {
        return text;
      }
    } catch {
      // O fluxo principal trata indisponibilidade de media em seguida.
    }
  }

  if (incoming.xmlContent) {
    return incoming.xmlContent;
  }

  if (incoming.rawMessage) {
    const media = await evolutionService.getBase64FromMediaMessage(incoming.rawMessage);
    if (media?.base64) {
      try {
        const text = Buffer.from(media.base64, "base64").toString("utf8");
        if (looksLikeXml(text)) {
          return text;
        }
      } catch {
        // segue para retorno nulo
      }
    }
  }

  return null;
}

async function resolveIncomingMediaPayload(
  incoming: IncomingData,
  instanceName?: string,
): Promise<{ base64: string; fileName: string | null; mimeType: string | null; mediaType: string | null } | null> {
  if (!incoming.hasMedia) {
    return null;
  }

  if (incoming.rawMessage) {
    const media = await evolutionService.getBase64FromMediaMessage(incoming.rawMessage, instanceName);
    if (media?.base64) {
      return {
        base64: media.base64,
        fileName: media.fileName ?? incoming.mediaFileName ?? null,
        mimeType: media.mimetype ?? incoming.mediaMimeType ?? null,
        mediaType: media.mediaType ?? "document",
      };
    }
  }

  if (incoming.mediaUrl) {
    try {
      const buffer = await evolutionService.downloadMedia(incoming.mediaUrl);
      return {
        base64: buffer.toString("base64"),
        fileName: incoming.mediaFileName,
        mimeType: incoming.mediaMimeType,
        mediaType: "document",
      };
    } catch {
      return null;
    }
  }

  return null;
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return hour * 60 + minute;
}

function isInsideWorkingWindow(
  startsAt: Date,
  endsAt: Date,
  windows: Array<{ weekday: number; startTime: string; endTime: string }>,
): boolean {
  if (startsAt.toDateString() !== endsAt.toDateString()) {
    return false;
  }

  const weekday = startsAt.getDay();
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMinutes = endsAt.getHours() * 60 + endsAt.getMinutes();

  const validWindows = windows.filter((window) => window.weekday === weekday);
  if (validWindows.length === 0) {
    return false;
  }

  return validWindows.some((window) => {
    const windowStart = toMinutes(window.startTime);
    const windowEnd = toMinutes(window.endTime);
    return startMinutes >= windowStart && endMinutes <= windowEnd;
  });
}

async function handleBarberConversation(input: {
  companyId: string;
  incoming: IncomingData;
  replyPhone: string;
}): Promise<BarberConversationReply> {
  const clientPhone = normalizePhone(input.replyPhone) || input.replyPhone;
  const incomingUserMessage = (input.incoming.text || "").trim() || "Solicitacao de agendamento via WhatsApp";
  const detectedIntent = detectBarberIntent(incomingUserMessage);
  const triageState = await getBarberTriageState(input.companyId, clientPhone);
  const parsedCustomerName = extractClientName(incomingUserMessage);
  const parsedCustomerDocument = extractCustomerDocument(incomingUserMessage);
  const parsedDateOnly = parseBarberDateOnly(incomingUserMessage);
  const parsedTimeOnly = parseBarberTimeOnly(incomingUserMessage);
  const isGreetingMessage = isGreetingOnlyMessage(incomingUserMessage);
  const hasRegistrationPayload =
    Boolean(parsedCustomerName || parsedCustomerDocument) || /^\d{11,14}$/.test(onlyDigits(incomingUserMessage));
  const shouldResumeCustomerRegistration =
    detectedIntent === "ajuda" &&
    !isGreetingMessage &&
    Boolean(
      triageState &&
        (triageState.lastIntent === "recibo" || triageState.lastIntent === "fidelidade") &&
        hasRegistrationPayload,
    );
  const shouldResumeScheduling =
    detectedIntent === "ajuda" &&
    !isGreetingMessage &&
    Boolean(
      triageState &&
        triageState.lastIntent === "agendar" &&
        (triageState.clientName || triageState.serviceId || triageState.startsAtIso),
    );
  const intent: BarberIntent =
    detectedIntent !== "ajuda"
      ? detectedIntent
      : shouldResumeCustomerRegistration && triageState?.lastIntent
        ? triageState.lastIntent
        : shouldResumeScheduling
          ? "agendar"
          : "ajuda";
  const clientPhoneCandidates = buildPhoneCandidates(clientPhone);

  const phoneWhere =
    clientPhoneCandidates.length > 0
      ? clientPhoneCandidates.flatMap((candidate) => [{ clientPhone: candidate }, { clientPhone: { endsWith: candidate } }])
      : [{ clientPhone }];

  const renderReply = async (
    replyIntent: BarberIntent,
    operationSummary: string,
    options?: { forcePending?: boolean },
  ): Promise<string> => {
    const fallback = operationSummary.trim();
    const pending = options?.forcePending ?? summarizeNeedsMoreData(fallback);

    if (pending || (replyIntent === "ajuda" && isGreetingMessage)) {
      return fallback;
    }

    try {
      const natural = await aiService.generateBookingNaturalReply({
        companyId: input.companyId,
        userMessage: incomingUserMessage,
        intent: replyIntent,
        operationSummary: fallback,
      });
      const normalizedNatural = natural.trim();
      if (!normalizedNatural) {
        return fallback;
      }

      // Evita resposta de "confirmacao" quando o resumo operacional ainda indica dados pendentes.
      if (pending && looksLikeBookingConfirmed(normalizedNatural)) {
        return fallback;
      }

      return normalizedNatural;
    } catch {
      return fallback;
    }
  };

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      name: true,
      cnpj: true,
      bookingSector: true,
    },
  });

  if (!company) {
    return {
      intent: "ajuda",
      text: await renderReply("ajuda", "Nao foi possivel identificar a empresa para continuar o atendimento."),
    };
  }

  let knownCustomer = await findBookingCustomerByPhone(input.companyId, clientPhoneCandidates);

  if (parsedCustomerName) {
    try {
      await rememberConversationUserName({
        companyId: input.companyId,
        phone: clientPhone,
        userName: parsedCustomerName,
      });
    } catch {
      // Persistencia de nome nao deve interromper o atendimento.
    }
  } else if (knownCustomer?.name) {
    try {
      await rememberConversationUserName({
        companyId: input.companyId,
        phone: clientPhone,
        userName: knownCustomer.name,
      });
    } catch {
      // Persistencia de nome nao deve interromper o atendimento.
    }
  }

  const rememberedClientName = parsedCustomerName ?? triageState?.clientName ?? knownCustomer?.name ?? null;

  if (!rememberedClientName && (intent === "agendar" || intent === "listar_servicos" || intent === "ajuda")) {
    await upsertBarberTriageState({
      companyId: input.companyId,
      phone: clientPhone,
      clientName: null,
      clientDocument: parsedCustomerDocument ?? triageState?.clientDocument ?? null,
      serviceId: triageState?.serviceId ?? null,
      startsAtIso: triageState?.startsAtIso ?? null,
      lastIntent: "agendar",
    });

    const operationSummary = [
      "Antes de continuar, preciso registrar seu nome.",
      "Assim salvo seu nome junto com este numero e nao preciso perguntar novamente nas proximas conversas.",
      "- Responda apenas com seu nome completo.",
    ].join("\n");

    return {
      intent: "agendar",
      text: await renderReply("agendar", operationSummary, { forcePending: true }),
    };
  }

  const ensureRegisteredCustomer = async (customerIntent: "recibo" | "fidelidade") => {
    if (knownCustomer) {
      return { customer: knownCustomer, text: null as string | null };
    }

    const nextCustomerName = parsedCustomerName ?? triageState?.clientName ?? null;
    const nextCustomerDocument = parsedCustomerDocument ?? triageState?.clientDocument ?? null;
    const missing = buildMissingCustomerFields({
      clientName: nextCustomerName,
      clientDocument: nextCustomerDocument,
    });

    if (missing.length > 0) {
      await upsertBarberTriageState({
        companyId: input.companyId,
        phone: clientPhone,
        clientName: nextCustomerName,
        clientDocument: nextCustomerDocument,
        lastIntent: customerIntent,
      });

      const lines: string[] = [];
      lines.push("Antes de continuar, preciso concluir seu cadastro para o cartao fidelidade.");
      if (nextCustomerName) {
        lines.push(`Nome identificado: ${nextCustomerName}.`);
      }
      if (nextCustomerDocument) {
        lines.push(`Documento identificado: ${formatCustomerDocument(nextCustomerDocument)}.`);
      }
      if (missing.includes("nome")) {
        lines.push("- Me informe seu nome completo.");
      }
      if (missing.includes("documento")) {
        lines.push("- Me informe seu CPF ou CNPJ para cadastro.");
      }

      return {
        customer: null,
        text: await renderReply(customerIntent, lines.join("\n"), { forcePending: true }),
      };
    }

    const normalizedDocument = validateAndNormalizeCustomerDocument(nextCustomerDocument!);
    if (!normalizedDocument) {
      await upsertBarberTriageState({
        companyId: input.companyId,
        phone: clientPhone,
        clientName: nextCustomerName,
        clientDocument: null,
        lastIntent: customerIntent,
      });

      return {
        customer: null,
        text: await renderReply(
          customerIntent,
          "O documento informado parece invalido. Solicite novamente um CPF (11 digitos) ou CNPJ (14 digitos).",
          { forcePending: true },
        ),
      };
    }

    const customer = await prisma.bookingCustomer.upsert({
      where: {
        companyId_document: {
          companyId: input.companyId,
          document: normalizedDocument.normalized,
        },
      },
      update: {
        name: nextCustomerName!,
        phoneE164: clientPhone,
      },
      create: {
        companyId: input.companyId,
        name: nextCustomerName!,
        document: normalizedDocument.normalized,
        phoneE164: clientPhone,
      },
    });

    knownCustomer = customer;
    await clearBarberTriageState(input.companyId, clientPhone, {
      lastIntent: customerIntent,
      userName: customer.name,
    });

    return { customer, text: null as string | null };
  };

  if (intent === "recibo") {
    const registration = await ensureRegisteredCustomer("recibo");
    if (!registration.customer) {
      return {
        intent,
        text: registration.text || (await renderReply(intent, "Nao foi possivel concluir o cadastro do cliente.")),
      };
    }

    await prisma.barberAppointment.updateMany({
      where: {
        companyId: input.companyId,
        bookingCustomerId: null,
        OR: phoneWhere,
        status: "completed",
      },
      data: {
        bookingCustomerId: registration.customer.id,
      },
    });

    let appointment = await prisma.barberAppointment.findFirst({
      where: {
        companyId: input.companyId,
        AND: [
          {
            OR: phoneWhere,
          },
          {
            OR: [
              { status: "completed" },
              {
                status: "scheduled",
                startsAt: {
                  lte: new Date(),
                },
              },
            ],
          },
        ],
      },
      orderBy: { startsAt: "desc" },
      include: {
        barber: {
          select: {
            name: true,
          },
        },
        service: {
          select: {
            name: true,
            price: true,
          },
        },
      },
    });

    if (!appointment) {
      return {
        intent,
        text: await renderReply(
          intent,
          "Nao encontrei nenhum atendimento concluido para emitir recibo neste numero. Oriente o cliente a solicitar apos finalizar o servico.",
        ),
      };
    }

    if (appointment.status === "scheduled") {
      if (appointment.endsAt.getTime() > Date.now()) {
        return {
          intent,
          text: await renderReply(
            intent,
            `O atendimento mais recente ainda nao terminou. Data prevista de conclusao: ${formatDateTimeBr(appointment.endsAt)}.`,
          ),
        };
      }

      appointment = await prisma.barberAppointment.update({
        where: { id: appointment.id },
        data: {
          status: "completed",
          bookingCustomerId: registration.customer.id,
        },
        include: {
          barber: {
            select: {
              name: true,
            },
          },
          service: {
            select: {
              name: true,
              price: true,
            },
          },
        },
      });
    } else if (!appointment.bookingCustomerId) {
      appointment = await prisma.barberAppointment.update({
        where: { id: appointment.id },
        data: {
          bookingCustomerId: registration.customer.id,
        },
        include: {
          barber: {
            select: {
              name: true,
            },
          },
          service: {
            select: {
              name: true,
              price: true,
            },
          },
        },
      });
    }

    const loyalty = await calculateBookingLoyaltyProgress({
      companyId: input.companyId,
      customerId: registration.customer.id,
    });

    const operationSummary = [
      "Recibo de servico pronto para envio ao cliente.",
      `Empresa: ${company.name}.`,
      `CNPJ: ${formatCustomerDocument(company.cnpj)}.`,
      `Cliente: ${registration.customer.name}.`,
      `Documento do cliente: ${formatCustomerDocument(registration.customer.document)}.`,
      `Servico: ${appointment.service.name}.`,
      `Valor: ${formatCurrency(Number(appointment.service.price))}.`,
      `Data do atendimento: ${formatDateTimeBr(appointment.startsAt)}.`,
      `Recibo: ${appointment.id}.`,
      `Cartao fidelidade: ${loyalty.completedServices} servico(s) concluido(s).`,
      loyalty.nextRewardIn > 0
        ? `Faltam ${loyalty.nextRewardIn} atendimento(s) para liberar o proximo premio.`
        : `Meta de ${BOOKING_LOYALTY_GOAL} atendimentos concluida. Premio disponivel.`,
      "Anexar o recibo em PDF nesta resposta.",
    ]
      .join("\n")
      .trim();

    const receiptPdf = await generateBookingReceiptPdf({
      receiptId: appointment.id,
      companyName: company.name,
      companyDocument: formatCustomerDocument(company.cnpj),
      clientName: registration.customer.name,
      clientDocument: formatCustomerDocument(registration.customer.document),
      serviceName: appointment.service.name,
      serviceValue: Number(appointment.service.price),
      appointmentDate: appointment.startsAt,
      resourceName: appointment.barber?.name ?? null,
    });

    const receiptAttachment: OutgoingAttachment = {
      fileName: `recibo-${appointment.id}.pdf`,
      mimeType: "application/pdf",
      mediaType: "document",
      base64: Buffer.from(receiptPdf).toString("base64"),
    };

    await clearBarberTriageState(input.companyId, clientPhone, {
      userName: registration.customer.name,
    });

    return {
      intent,
      text: await renderReply(intent, operationSummary),
      attachment: receiptAttachment,
    };
  }

  if (intent === "fidelidade") {
    const registration = await ensureRegisteredCustomer("fidelidade");
    if (!registration.customer) {
      return {
        intent,
        text: registration.text || (await renderReply(intent, "Nao foi possivel concluir o cadastro do cliente.")),
      };
    }

    await prisma.barberAppointment.updateMany({
      where: {
        companyId: input.companyId,
        bookingCustomerId: null,
        OR: phoneWhere,
        status: "completed",
      },
      data: {
        bookingCustomerId: registration.customer.id,
      },
    });

    const loyalty = await calculateBookingLoyaltyProgress({
      companyId: input.companyId,
      customerId: registration.customer.id,
    });

    const operationSummary = [
      "Consulta de cartao fidelidade concluida.",
      `Cliente: ${registration.customer.name}.`,
      `Documento: ${formatCustomerDocument(registration.customer.document)}.`,
      `Atendimentos concluidos: ${loyalty.completedServices}.`,
      `Premios liberados: ${loyalty.rewardsUnlocked}.`,
      loyalty.nextRewardIn > 0
        ? `Faltam ${loyalty.nextRewardIn} atendimento(s) para o proximo premio.`
        : `Meta atual concluida. Proximo atendimento ja inicia um novo ciclo de fidelidade.`,
    ]
      .join("\n")
      .trim();

    await clearBarberTriageState(input.companyId, clientPhone, {
      userName: registration.customer.name,
    });

    return {
      intent,
      text: await renderReply(intent, operationSummary),
    };
  }

  if (intent === "listar_servicos") {
    const services = await prisma.barberService.findMany({
      where: {
        companyId: input.companyId,
        active: true,
      },
      orderBy: { name: "asc" },
      include: {
        barber: {
          select: {
            name: true,
          },
        },
      },
      take: 12,
    });

    if (services.length === 0) {
      const operationSummary =
        "No momento nao ha servicos ativos cadastrados no sistema para novos agendamentos. Oriente o cliente a tentar novamente mais tarde.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    // Quando existe apenas 1 servico ativo, persistimos no MySQL para continuar o fluxo no proximo turno.
    if (services.length === 1) {
      await upsertBarberTriageState({
        companyId: input.companyId,
        phone: clientPhone,
        clientName: rememberedClientName,
        clientDocument: triageState?.clientDocument ?? null,
        serviceId: services[0]!.id,
        startsAtIso: triageState?.startsAtIso ?? null,
        lastIntent: "agendar",
      });
    }

    const lines = services.map(
      (service) =>
        `- ${service.name} | ${service.durationMinutes}min | ${formatCurrency(Number(service.price))}${service.barber?.name ? ` | ${service.barber.name}` : ""}`,
    );

    const operationSummary = [
      `Foram encontrados ${services.length} servico(s) ativo(s):`,
      ...lines,
      "",
      "Se o cliente quiser, pode agendar enviando nome, servico e data/hora.",
    ]
      .join("\n")
      .trim();

    return {
      intent,
      text: await renderReply(intent, operationSummary),
    };
  }

  if (intent === "agenda") {
    const appointments = await prisma.barberAppointment.findMany({
      where: {
        companyId: input.companyId,
        status: "scheduled",
        OR: phoneWhere,
        startsAt: {
          gte: new Date(),
        },
      },
      orderBy: { startsAt: "asc" },
      take: 5,
      include: {
        barber: {
          select: {
            name: true,
          },
        },
        service: {
          select: {
            name: true,
          },
        },
      },
    });

    if (appointments.length === 0) {
      const operationSummary =
        "Nao foram encontrados agendamentos futuros vinculados ao numero do cliente. Informe que ele pode solicitar um novo agendamento.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    const lines = appointments.map((appointment) => {
      return `- ${formatDateTimeBr(appointment.startsAt)} | ${appointment.service.name} | ${appointment.barber.name}`;
    });

    const operationSummary = [
      "Agendamentos futuros encontrados para este cliente:",
      ...lines,
      "",
      "Se o cliente quiser cancelar, solicitar confirmacao da operacao.",
    ]
      .join("\n")
      .trim();

    return {
      intent,
      text: await renderReply(intent, operationSummary),
    };
  }

  if (intent === "cancelar") {
    await clearBarberTriageState(input.companyId, clientPhone, { lastIntent: "cancelar" });

    const appointment = await prisma.barberAppointment.findFirst({
      where: {
        companyId: input.companyId,
        status: "scheduled",
        OR: phoneWhere,
        startsAt: {
          gte: new Date(),
        },
      },
      orderBy: { startsAt: "asc" },
      include: {
        barber: {
          select: {
            name: true,
          },
        },
        service: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!appointment) {
      const operationSummary =
        "Nenhum agendamento futuro foi localizado para este numero. Informe isso ao cliente e ofereca novo agendamento.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    const remainingToStartMs = appointment.startsAt.getTime() - Date.now();
    if (remainingToStartMs < CLIENT_CANCELLATION_MIN_LEAD_MS) {
      const operationSummary = [
        "Cancelamento nao permitido para este horario.",
        `O agendamento inicia em ${formatDateTimeBr(appointment.startsAt)}.`,
        "A politica permite cancelamento somente com antecedencia minima de 1 hora.",
      ].join("\n");
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    await prisma.barberAppointment.update({
      where: { id: appointment.id },
      data: { status: "canceled" },
    });

    const operationSummary = [
      "Agendamento cancelado com sucesso.",
      `Servico: ${appointment.service.name}.`,
      `Horario: ${formatDateTimeBr(appointment.startsAt)}.`,
      `Recurso: ${appointment.barber.name}.`,
    ].join("\n");

    return {
      intent,
      text: await renderReply(intent, operationSummary),
    };
  }

  if (intent === "agendar") {
    const [services, barbers] = await Promise.all([
      prisma.barberService.findMany({
        where: {
          companyId: input.companyId,
          active: true,
        },
        orderBy: { name: "asc" },
      }),
      prisma.barberProfile.findMany({
        where: {
          companyId: input.companyId,
          active: true,
        },
        orderBy: { name: "asc" },
      }),
    ]);

    if (services.length === 0 || barbers.length === 0) {
      const operationSummary =
        "Nao foi possivel concluir o agendamento porque faltam servicos ativos ou recursos ativos cadastrados.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    const message = input.incoming.text || "";
    const parsedName = parsedCustomerName;
    const parsedService = findByNameInText(message, services);
    const draftService = triageState?.serviceId ? services.find((item) => item.id === triageState.serviceId) ?? null : null;
    const singleService = services.length === 1 ? services[0] ?? null : null;
    const service = parsedService ?? draftService ?? singleService;
    const preferredBarber = findByNameInText(message, barbers);
    const clientName = parsedName ?? rememberedClientName ?? null;

    const parsedStartsAt = parseBarberDateTime(message);
    let draftStartsAt: Date | null = null;
    if (triageState?.startsAtIso) {
      const parsed = new Date(triageState.startsAtIso);
      if (!Number.isNaN(parsed.getTime())) {
        draftStartsAt = parsed;
      }
    }

    let startsAt: Date | null = parsedStartsAt;
    if (!startsAt && parsedDateOnly && parsedTimeOnly) {
      startsAt = buildBarberDateTime(
        parsedDateOnly.year,
        parsedDateOnly.month,
        parsedDateOnly.day,
        parsedTimeOnly.hour,
        parsedTimeOnly.minute,
      );
    }
    if (!startsAt && parsedDateOnly && draftStartsAt) {
      startsAt = buildBarberDateTime(
        parsedDateOnly.year,
        parsedDateOnly.month,
        parsedDateOnly.day,
        draftStartsAt.getHours(),
        draftStartsAt.getMinutes(),
      );
    }
    if (!startsAt && parsedTimeOnly && draftStartsAt) {
      startsAt = buildBarberDateTime(
        draftStartsAt.getFullYear(),
        draftStartsAt.getMonth() + 1,
        draftStartsAt.getDate(),
        parsedTimeOnly.hour,
        parsedTimeOnly.minute,
      );
    }
    if (!startsAt && parsedTimeOnly) {
      startsAt = resolveNearestFutureFromTime(parsedTimeOnly);
    }
    if (!startsAt && draftStartsAt) {
      startsAt = draftStartsAt;
    }

    const missing = buildMissingBarberFields({
      clientName,
      serviceFound: Boolean(service),
      startsAt: startsAt ?? null,
    });

    if (missing.length > 0) {
      await upsertBarberTriageState({
        companyId: input.companyId,
        phone: clientPhone,
        clientName,
        clientDocument: parsedCustomerDocument ?? undefined,
        serviceId: service?.id ?? null,
        startsAtIso: startsAt ? startsAt.toISOString() : null,
        lastIntent: "agendar",
      });

      const collected: string[] = [];
      if (clientName) {
        collected.push(`Nome: ${clientName}`);
      }
      if (service) {
        collected.push(`Servico: ${service.name}`);
      }
      if (startsAt) {
        collected.push(`Horario: ${formatDateTimeBr(startsAt)}`);
      }

      const lines: string[] = [];
      if (missing.includes("nome")) {
        lines.push("Antes de concluir seu agendamento, preciso registrar seu nome completo.");
        if (service) {
          lines.push(`Servico identificado: ${service.name}.`);
        }
        if (startsAt) {
          lines.push(`Horario identificado: ${formatDateTimeBr(startsAt)}.`);
        }
        lines.push("- Responda apenas com seu nome.");
      } else {
        if (collected.length > 0) {
          lines.push(`Ja identifiquei: ${collected.join(" | ")}.`);
        }
        lines.push("Para concluir seu agendamento, preciso de:");
        if (missing.includes("servico")) {
          const preview = services.slice(0, 6).map((item) => item.name).join(", ");
          lines.push(`- Servico desejado. Opcoes: ${preview}.`);
        }
        if (missing.includes("horario")) {
          lines.push("- Data e horario. Ex: 20/02/2026 14:30.");
        }
      }

      const operationSummary = lines.join("\n");
      return {
        intent,
        text: await renderReply(intent, operationSummary, { forcePending: true }),
      };
    }

    if (!startsAt || !service || !clientName) {
      const operationSummary =
        "Os dados enviados para agendamento ficaram incompletos ou invalidos. Solicitar novamente nome, servico e data/hora.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    if (startsAt.getTime() < Date.now()) {
      await upsertBarberTriageState({
        companyId: input.companyId,
        phone: clientPhone,
        clientName,
        serviceId: service.id,
        startsAtIso: null,
        lastIntent: "agendar",
      });

      const operationSummary =
        "O horario enviado ja passou. Solicitar ao cliente um novo horario futuro para concluir o agendamento.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    let barber = preferredBarber;
    if (!barber && service.barberId) {
      barber = barbers.find((item) => item.id === service.barberId) ?? null;
    }
    if (!barber) {
      barber = barbers[0] ?? null;
    }

    if (!barber) {
      const operationSummary =
        "Nao foi encontrado recurso disponivel para o servico solicitado neste momento. Solicitar ao cliente outro servico ou horario.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60 * 1000);
    const windows = await prisma.barberWorkingHour.findMany({
      where: {
        barberId: barber.id,
        active: true,
      },
      select: {
        weekday: true,
        startTime: true,
        endTime: true,
      },
    });

    if (!isInsideWorkingWindow(startsAt, endsAt, windows)) {
      await upsertBarberTriageState({
        companyId: input.companyId,
        phone: clientPhone,
        clientName,
        serviceId: service.id,
        startsAtIso: null,
        lastIntent: "agendar",
      });

      const operationSummary =
        "O horario solicitado esta fora da grade configurada do recurso. Solicitar ao cliente um novo horario dentro da disponibilidade.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    const overlap = await prisma.barberAppointment.findFirst({
      where: {
        companyId: input.companyId,
        barberId: barber.id,
        status: "scheduled",
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });

    if (overlap) {
      await upsertBarberTriageState({
        companyId: input.companyId,
        phone: clientPhone,
        clientName,
        serviceId: service.id,
        startsAtIso: null,
        lastIntent: "agendar",
      });

      const operationSummary =
        "O horario solicitado ja esta ocupado para este recurso. Solicitar ao cliente outro horario disponivel.";
      return {
        intent,
        text: await renderReply(intent, operationSummary),
      };
    }

    if (!knownCustomer && clientName) {
      const candidateDocument = parsedCustomerDocument ?? triageState?.clientDocument ?? null;
      if (candidateDocument) {
        const normalizedDocument = validateAndNormalizeCustomerDocument(candidateDocument);
        if (normalizedDocument) {
          knownCustomer = await prisma.bookingCustomer.upsert({
            where: {
              companyId_document: {
                companyId: input.companyId,
                document: normalizedDocument.normalized,
              },
            },
            update: {
              name: clientName,
              phoneE164: clientPhone,
            },
            create: {
              companyId: input.companyId,
              name: clientName,
              document: normalizedDocument.normalized,
              phoneE164: clientPhone,
            },
          });
        }
      }
    }

    const appointment = await prisma.barberAppointment.create({
      data: {
        companyId: input.companyId,
        bookingCustomerId: knownCustomer?.id ?? null,
        barberId: barber.id,
        serviceId: service.id,
        clientName,
        clientPhone,
        startsAt,
        endsAt,
        status: "scheduled",
        source: "whatsapp",
      },
    });

    await clearBarberTriageState(input.companyId, clientPhone, { lastIntent: "agendar", userName: clientName });

    const operationSummary = [
      "Agendamento confirmado com sucesso.",
      `Cliente: ${clientName}.`,
      `Servico: ${service.name}.`,
      `Recurso: ${barber.name}.`,
      `Horario: ${formatDateTimeBr(appointment.startsAt)}.`,
      knownCustomer
        ? "Cliente vinculado ao cadastro de fidelidade."
        : "Para ativar o cartao fidelidade, o cliente pode enviar CPF/CNPJ apos o atendimento.",
    ].join("\n");

    return {
      intent,
      text: await renderReply(intent, operationSummary),
    };
  }

  if (isGreetingMessage) {
    const operationSummary = [
      rememberedClientName
        ? `Ola, ${rememberedClientName}! Estou pronto para te ajudar com seu atendimento.`
        : "Ola! Estou pronto para te ajudar com seu atendimento.",
      "Voce pode enviar: servicos, agendar, agenda, cancelar, recibo ou fidelidade.",
    ].join("\n");

    return {
      intent: "ajuda",
      text: await renderReply("ajuda", operationSummary),
    };
  }

  const [servicesCount, upcomingCount] = await Promise.all([
    prisma.barberService.count({
      where: {
        companyId: input.companyId,
        active: true,
      },
    }),
    prisma.barberAppointment.count({
      where: {
        companyId: input.companyId,
        status: "scheduled",
        OR: phoneWhere,
        startsAt: {
          gte: new Date(),
        },
      },
    }),
  ]);

  const operationSummary = [
    "Atendimento de agendamento pronto para ajudar o cliente.",
    `Servicos ativos no sistema: ${servicesCount}.`,
    `Agendamentos futuros do cliente: ${upcomingCount}.`,
    "Se necessario, orientar comandos: servicos, agendar, agenda, cancelar agendamento, recibo e fidelidade.",
  ]
    .join("\n")
    .trim();

  return {
    intent: "ajuda",
    text: await renderReply("ajuda", operationSummary),
  };
}

async function sendAndLog(
  companyId: string,
  phone: string,
  text: string,
  intent?: string,
  instanceName?: string,
  attachment?: OutgoingAttachment,
): Promise<void> {
  const content = attachment
    ? buildStoredMessageContent({
        text,
        attachment: {
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          mediaType: attachment.mediaType,
          base64: attachment.base64,
        },
      })
    : text;

  const outLog = await prisma.messageLog.create({
    data: {
      companyId,
      phoneE164: phone,
      direction: "out",
      messageType: attachment ? "media" : "text",
      content,
      intent,
      status: "received",
    },
  });

  if (attachment) {
    try {
      await evolutionService.sendDocument(
        phone,
        {
          base64: attachment.base64,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          caption: text,
        },
        instanceName,
      );

      await prisma.messageLog.update({
        where: { id: outLog.id },
        data: { status: "processed" },
      });
    } catch (error) {
      await prisma.messageLog.update({
        where: { id: outLog.id },
        data: { status: "failed" },
      });

      throw error;
    }
  } else {
    await outboundDispatchService.enqueueOutboundText({
      companyId,
      phone,
      text,
      intent,
      instanceName,
      messageLogId: outLog.id,
    });
  }

  try {
    await appendConversationMessage({
      companyId,
      phone,
      role: "assistant",
      text,
      intent,
    });
  } catch {
    // Memoria conversacional nao deve interromper envio.
  }
}

export async function webhooksRoutes(app: FastifyInstance): Promise<void> {
  const handleMessagesWebhook = async (request: any, reply: any) => {
    const settings = await appConfigService.getSettings();
    const rawBody = request.body as Record<string, unknown>;
    const incoming = extractIncomingPayload(rawBody);
    const instanceName = extractInstanceName(rawBody) || extractInstanceNameFromHeaders(request.headers);
    const event = typeof request.params?.event === "string" ? request.params.event : "messages";
    const payloadHash = computePayloadHash(rawBody);
    const eventId = extractWebhookEventId(rawBody);
    const replyPhone = resolveReplyPhone(incoming);
    const companyByInstance = instanceName ? await findCompanyByInstance(instanceName) : null;

    const duplicateWindowStart = new Date(Date.now() - 2 * 60 * 1000);
    if (!eventId) {
      const duplicateByHash = await prisma.webhookEvent.findFirst({
        where: {
          provider: "evolution",
          eventType: event,
          payloadHash,
          receivedAt: {
            gte: duplicateWindowStart,
          },
        },
        select: { id: true },
      });

      if (duplicateByHash) {
        return reply.send({ ok: true, ignored: "duplicate_event" });
      }
    }

    let webhookEventRecord: { id: string } | null = null;
    try {
      webhookEventRecord = await prisma.webhookEvent.create({
        data: {
          provider: "evolution",
          eventType: event,
          eventId,
          instanceName,
          payloadHash,
          payloadJson: JSON.parse(JSON.stringify(rawBody)) as Prisma.InputJsonValue,
          status: "received",
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.send({ ok: true, ignored: "duplicate_event" });
      }

      throw error;
    }

    const markWebhookEvent = async (status: "ignored" | "processed" | "failed", companyId?: string) => {
      if (!webhookEventRecord) {
        return;
      }

      await prisma.webhookEvent.update({
        where: { id: webhookEventRecord.id },
        data: {
          status,
          companyId: companyId ?? undefined,
          processedAt: new Date(),
        },
      });
    };

    if (incoming.fromMe) {
      request.log.debug({ event, phone: incoming.phone }, "Webhook ignorado: from_me");
      await markWebhookEvent("ignored");
      return reply.send({ ok: true, ignored: "from_me" });
    }

    if (!incoming.phone) {
      request.log.warn({ event }, "Webhook ignorado: phone_not_found");
      await markWebhookEvent("ignored");
      return reply.send({ ok: true, ignored: "phone_not_found" });
    }

    if (!companyByInstance && matchesAgentOwnNumber(incoming.phoneCandidates, settings.agentWhatsappNumber)) {
      request.log.warn(
        {
          event,
          phone: incoming.phone,
          candidates: incoming.phoneCandidates,
          agentNumberConfigured: Boolean(settings.agentWhatsappNumber),
        },
        "Webhook ignorado: agent_own_number",
      );
      await markWebhookEvent("ignored");
      return reply.send({ ok: true, ignored: "agent_own_number" });
    }

    const skipAllowList = Boolean(
      companyByInstance && (companyByInstance.aiType === "barber_booking" || companyByInstance.aiType === "billing"),
    );
    const allowedMapping = skipAllowList ? null : await findAuthorizedMapping(incoming.phoneCandidates);

    if (!skipAllowList && !allowedMapping) {
      request.log.warn(
        {
          event,
          phone: incoming.phone,
          candidates: incoming.phoneCandidates,
          instanceName,
        },
        "Webhook ignorado: number_not_allowed",
      );
      await markWebhookEvent("ignored");
      return reply.send({ ok: true, ignored: "number_not_allowed" });
    }

    const mappedCompany = companyByInstance ?? allowedMapping!.company;
    const mappedCompanyId = companyByInstance ? companyByInstance.id : allowedMapping!.companyId;
    const replyInstanceName =
      mappedCompany.aiType === "barber_booking" || mappedCompany.aiType === "billing"
        ? mappedCompany.evolutionInstanceName || instanceName || undefined
        : undefined;

    request.log.info(
      {
        event,
        instanceName,
        phone: incoming.phone,
        candidates: incoming.phoneCandidates,
        replyPhone,
        companyId: mappedCompanyId,
        aiType: mappedCompany.aiType,
        hasMedia: incoming.hasMedia,
        isXml: incoming.isXml,
        hasMediaUrl: Boolean(incoming.mediaUrl),
        hasRawMessage: Boolean(incoming.rawMessage),
      },
      "Webhook processado",
    );

    const inboundText = incoming.text || "[arquivo recebido]";
    const inboundMediaPayload = incoming.hasMedia
      ? await resolveIncomingMediaPayload(incoming, replyInstanceName).catch(() => null)
      : null;
    const inboundContent = inboundMediaPayload
      ? buildStoredMessageContent({
          text: inboundText,
          attachment: {
            fileName: inboundMediaPayload.fileName,
            mimeType: inboundMediaPayload.mimeType,
            mediaType: inboundMediaPayload.mediaType,
            base64: inboundMediaPayload.base64,
          },
        })
      : inboundText;

    const inLog = await prisma.messageLog.create({
      data: {
        companyId: mappedCompanyId,
        phoneE164: replyPhone,
        direction: "in",
        messageType: incoming.messageType,
        content: inboundContent,
        status: "received",
      },
    });

    try {
      await appendConversationMessage({
        companyId: mappedCompanyId,
        phone: replyPhone,
        role: "user",
        text: inboundText,
      });
    } catch {
      // Memoria conversacional nao deve interromper o fluxo principal.
    }

    try {
      if (mappedCompany.aiType === "barber_booking") {
        if (incoming.hasMedia && !incoming.text) {
          const text =
            "Recebi seu arquivo, mas neste servico de agendamento eu processo mensagens de texto. Envie servicos, agenda ou agendar <servico> <data hora>.";
          await sendAndLog(mappedCompanyId, replyPhone, text, "ajuda", replyInstanceName);

          await prisma.messageLog.update({
            where: { id: inLog.id },
            data: {
              status: "processed",
              intent: "ajuda",
            },
          });

          await markWebhookEvent("processed", mappedCompanyId);
          return reply.send({ ok: true, intent: "ajuda" });
        }

        const barberReply = await handleBarberToolAgentConversation({
          companyId: mappedCompanyId,
          incoming,
          replyPhone,
        });

        await sendAndLog(
          mappedCompanyId,
          replyPhone,
          barberReply.text,
          barberReply.intent,
          replyInstanceName,
          barberReply.attachment,
        );

        await prisma.messageLog.update({
          where: { id: inLog.id },
          data: {
            status: "processed",
            intent: barberReply.intent,
          },
        });

        await markWebhookEvent("processed", mappedCompanyId);
        return reply.send({ ok: true, intent: barberReply.intent });
      }

      if (mappedCompany.aiType === "billing") {
        const billingReply = await handleBillingToolAgentConversation({
          companyId: mappedCompanyId,
          incoming,
          replyPhone,
        });

        await sendAndLog(mappedCompanyId, replyPhone, billingReply.text, billingReply.intent, replyInstanceName);

        await prisma.messageLog.update({
          where: { id: inLog.id },
          data: {
            status: "processed",
            intent: billingReply.intent,
          },
        });

        await markWebhookEvent("processed", mappedCompanyId);
        return reply.send({ ok: true, intent: billingReply.intent });
      }

      if (incoming.isXml || incoming.hasMedia) {
        const xml = await resolveXmlFromIncoming(incoming);

        if (!xml) {
          const rawMessageKeys = incoming.rawMessage ? Object.keys(incoming.rawMessage) : [];
          const rawInnerMessageKeys = incoming.rawMessage
            ? Object.keys((incoming.rawMessage.message as Record<string, unknown> | undefined) ?? {})
            : [];

          request.log.warn(
            {
              event,
              phone: incoming.phone,
              replyPhone,
              hasMedia: incoming.hasMedia,
              isXml: incoming.isXml,
              hasMediaUrl: Boolean(incoming.mediaUrl),
              hasRawMessage: Boolean(incoming.rawMessage),
              rawMessageKeys,
              rawInnerMessageKeys,
            },
            "Falha ao resolver XML a partir da mensagem de midia",
          );
          throw new Error("Nao foi possivel obter o XML anexado.");
        }

        if (!looksLikeXml(xml)) {
          throw new Error("Arquivo recebido, mas nao parece ser um XML valido de NF-e.");
        }

        const imported = await importNfeXml(mappedCompanyId, xml, { status: "imported" });
        const importedReference: NfeReferenceMemory = {
          chave: imported.chave,
          valor: Number(imported.valorTotal),
          status: imported.status,
          emitenteNome: imported.emitenteNome,
          createdAtIso: imported.createdAt.toISOString(),
        };

        await safeRememberNfeConversation({
          companyId: mappedCompanyId,
          phone: replyPhone,
          listedNotes: [importedReference],
          selectedChave: imported.chave,
        });

        const operationSummary = [
          `XML recebido e importado com sucesso.`,
          `Chave: ${imported.chave}.`,
          `Valor total: ${formatCurrency(Number(imported.valorTotal))}.`,
          imported.emitenteNome ? `Emitente: ${imported.emitenteNome}.` : "",
          imported.emitenteCnpj ? `CNPJ emitente: ${imported.emitenteCnpj}.` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const text = await aiService.generateNaturalReply({
          companyId: mappedCompanyId,
          userMessage: incoming.text || "Envio de arquivo XML para importacao.",
          intent: "importar",
          operationSummary,
          shouldAskAction: true,
          actionHint: "Se desejar, posso te mostrar agora as ultimas notas importadas.",
        });

        await sendAndLog(mappedCompanyId, replyPhone, text, "importar");

        await prisma.messageLog.update({
          where: { id: inLog.id },
          data: {
            status: "processed",
            intent: "importar",
          },
        });

        await markWebhookEvent("processed", mappedCompanyId);
        return reply.send({ ok: true, action: "xml_imported" });
      }

      const agentReply = await handleNfeToolAgentConversation({
        companyId: mappedCompanyId,
        phone: replyPhone,
        userMessage: incoming.text,
      });

      if (agentReply.trim().length > 0) {
        await sendAndLog(mappedCompanyId, replyPhone, agentReply, "agent");

        await prisma.messageLog.update({
          where: { id: inLog.id },
          data: {
            status: "processed",
            intent: "agent",
          },
        });

        await markWebhookEvent("processed", mappedCompanyId);
        return reply.send({ ok: true, intent: "agent" });
      }

      const detailRequest = detectNfeDetailRequest(incoming.text || "");
      if (detailRequest.wantsDetails) {
        const detailReply = await handleNfeDetailConversation({
          companyId: mappedCompanyId,
          phone: replyPhone,
          userMessage: incoming.text || "",
          wantsProducts: detailRequest.wantsProducts,
        });

        await sendAndLog(mappedCompanyId, replyPhone, detailReply, "ver");

        await prisma.messageLog.update({
          where: { id: inLog.id },
          data: {
            status: "processed",
            intent: "ver",
          },
        });

        await markWebhookEvent("processed", mappedCompanyId);
        return reply.send({ ok: true, intent: "ver" });
      }

      const intent = await aiService.classifyIntent(mappedCompanyId, incoming.text);
      let operationSummary = "";
      let actionHint = "";
      let shouldAskAction = true;

      if (intent.intent === "ver") {
        const nfes = await prisma.nfeDocument.findMany({
          where: { companyId: mappedCompanyId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            chave: true,
            valorTotal: true,
            status: true,
            emitenteNome: true,
            createdAt: true,
          },
        });

        if (nfes.length === 0) {
          operationSummary = "No momento nao foram encontradas notas importadas ou detectadas para esta empresa.";
          actionHint = "Voce pode enviar um XML para importacao ou aguardar novas notas do webservice.";
          await safeClearNfeConversationState(mappedCompanyId, replyPhone);
        } else {
          const references = toNfeReferenceMemoryList(nfes);
          await safeRememberNfeConversation({
            companyId: mappedCompanyId,
            phone: replyPhone,
            listedNotes: references,
            selectedChave: null,
          });

          const preview = nfes
            .map((nfe) => `${nfe.chave} | ${formatCurrency(Number(nfe.valorTotal))} | ${formatNfeStatus(nfe.status)}`)
            .join("\n");

          operationSummary = `Encontrei ${nfes.length} nota(s) recentes:\n${preview}`;
          actionHint = "Se quiser, posso importar agora todas as notas que estiverem pendentes (detected).";
        }
      } else if (intent.intent === "importar") {
        const result = await prisma.nfeDocument.updateMany({
          where: {
            companyId: mappedCompanyId,
            status: "detected",
          },
          data: {
            status: "imported",
            importedAt: new Date(),
          },
        });

        if (result.count > 0) {
          operationSummary = `${result.count} nota(s) detectadas foram importadas com sucesso.`;
          actionHint = "Se desejar, posso listar as notas importadas agora.";
        } else {
          operationSummary = "Nao ha notas pendentes para importacao neste momento.";
          actionHint = "Posso te mostrar as ultimas notas ja importadas, se quiser.";
        }

        const recentReferences = await fetchRecentNfeReferences(mappedCompanyId);
        if (recentReferences.length === 0) {
          await safeClearNfeConversationState(mappedCompanyId, replyPhone);
        } else {
          await safeRememberNfeConversation({
            companyId: mappedCompanyId,
            phone: replyPhone,
            listedNotes: recentReferences,
            selectedChave: null,
          });
        }
      } else if (intent.intent === "ver_e_importar") {
        const nfes = await prisma.nfeDocument.findMany({
          where: {
            companyId: mappedCompanyId,
            status: "detected",
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            chave: true,
            valorTotal: true,
            status: true,
            emitenteNome: true,
            createdAt: true,
          },
        });

        await prisma.nfeDocument.updateMany({
          where: {
            companyId: mappedCompanyId,
            status: "detected",
          },
          data: {
            status: "imported",
            importedAt: new Date(),
          },
        });

        if (nfes.length === 0) {
          operationSummary = "Nao ha notas detectadas para importar agora.";
          actionHint = "Posso te mostrar o historico das notas ja importadas, se desejar.";
          const recentReferences = await fetchRecentNfeReferences(mappedCompanyId);
          if (recentReferences.length === 0) {
            await safeClearNfeConversationState(mappedCompanyId, replyPhone);
          } else {
            await safeRememberNfeConversation({
              companyId: mappedCompanyId,
              phone: replyPhone,
              listedNotes: recentReferences,
              selectedChave: null,
            });
          }
        } else {
          const references = toNfeReferenceMemoryList(nfes);
          await safeRememberNfeConversation({
            companyId: mappedCompanyId,
            phone: replyPhone,
            listedNotes: references,
            selectedChave: null,
          });

          const preview = nfes
            .map((nfe) => `${nfe.chave} | ${formatCurrency(Number(nfe.valorTotal))}`)
            .join("\n");

          operationSummary = `As ${nfes.length} nota(s) detectadas foram importadas.\nResumo:\n${preview}`;
          actionHint = "Se quiser, posso te mostrar tambem o status geral das notas no sistema.";
        }
      } else {
        const [counts, recent] = await Promise.all([
          prisma.nfeDocument.groupBy({
            by: ["status"],
            where: { companyId: mappedCompanyId },
            _count: { _all: true },
          }),
          prisma.nfeDocument.findMany({
            where: { companyId: mappedCompanyId },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: {
              chave: true,
              valorTotal: true,
              status: true,
              emitenteNome: true,
              createdAt: true,
            },
          }),
        ]);

        const map = counts.reduce<Record<string, number>>((acc, item) => {
          acc[item.status] = item._count._all;
          return acc;
        }, {});

        if (recent.length > 0) {
          await safeRememberNfeConversation({
            companyId: mappedCompanyId,
            phone: replyPhone,
            listedNotes: toNfeReferenceMemoryList(recent),
            selectedChave: null,
          });
        } else {
          await safeClearNfeConversationState(mappedCompanyId, replyPhone);
        }

        const recentText = recent.length > 0
          ? recent.map((nfe) => `${nfe.chave} | ${formatCurrency(Number(nfe.valorTotal))} | ${formatNfeStatus(nfe.status)}`).join("\n")
          : "Sem notas recentes.";

        if (detectNfeCapabilityQuestion(incoming.text || "")) {
          operationSummary = [
            "Posso atuar como agente de NF-e para voce no WhatsApp:",
            "- listar notas detectadas e importadas",
            "- importar XML enviado por anexo",
            "- importar notas pendentes detectadas pelo webservice",
            "- detalhar uma nota especifica e listar os produtos",
            "",
            `Contexto atual: importadas=${map.imported ?? 0}, detectadas=${map.detected ?? 0}, falhas=${map.failed ?? 0}.`,
            `Notas recentes:\n${recentText}`,
          ].join("\n");
          actionHint = "Me diga sua acao em linguagem natural. Exemplo: \"detalhe a nota de 53 mil\".";
          shouldAskAction = true;
        } else {
          operationSummary = [
            `Resumo atual: importadas=${map.imported ?? 0}, detectadas=${map.detected ?? 0}, falhas=${map.failed ?? 0}.`,
            `Notas recentes:\n${recentText}`,
          ].join("\n");
          actionHint = "Voce pode pedir: ver notas, importar notas, ver e importar, ou enviar um XML.";
          shouldAskAction = true;
        }
      }

      const responseText = await aiService.generateNaturalReply({
        companyId: mappedCompanyId,
        userMessage: incoming.text,
        intent: intent.intent,
        operationSummary,
        shouldAskAction,
        actionHint,
      });

      await sendAndLog(mappedCompanyId, replyPhone, responseText, intent.intent);

      await prisma.messageLog.update({
        where: { id: inLog.id },
        data: {
          status: "processed",
          intent: intent.intent,
        },
      });

      await markWebhookEvent("processed", mappedCompanyId);
      return reply.send({ ok: true, intent: intent.intent });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado";

      await prisma.messageLog.update({
        where: { id: inLog.id },
        data: {
          status: "failed",
        },
      });

      try {
        await sendAndLog(mappedCompanyId, replyPhone, `Nao consegui processar sua solicitacao: ${message}`, "ajuda", replyInstanceName);
      } catch {
        // Evita erro em cascata se a sessao WhatsApp estiver indisponivel.
      }

      await markWebhookEvent("failed", mappedCompanyId);
      return reply.code(500).send({ ok: false, message });
    }
  };

  app.post("/webhooks/evolution/messages", handleMessagesWebhook);
  app.post("/webhooks/evolution/messages-upsert", handleMessagesWebhook);
  app.post("/webhooks/evolution/messages-upsert/:event", handleMessagesWebhook);
  app.post("/webhooks/evolution/messages.upsert", handleMessagesWebhook);
  app.post("/webhooks/evolution/messages.upsert/:event", handleMessagesWebhook);
  app.post("/webhooks/evolution/messages/:event", handleMessagesWebhook);
  app.post("/webhooks/evolution", handleMessagesWebhook);

  const handleSessionWebhook = async (request: any) => {
    const settings = await appConfigService.getSettings();
    const sessionName = extractInstanceName(request.body) || settings.evolutionInstanceName;
    const parsed = z
      .object({
        status: z.string().optional(),
      })
      .safeParse(request.body);

    const status = parsed.success ? parsed.data.status ?? "unknown" : "unknown";

    await prisma.whatsappSession.upsert({
      where: { sessionName },
      update: {
        status,
        connectedAt: status.toLowerCase().includes("open") || status.toLowerCase().includes("connected") ? new Date() : null,
      },
      create: {
        sessionName,
        status,
        connectedAt: status.toLowerCase().includes("open") || status.toLowerCase().includes("connected") ? new Date() : null,
      },
    });

    return { ok: true };
  };

  app.post("/webhooks/evolution/session", handleSessionWebhook);
  app.post("/webhooks/evolution/session/:event", handleSessionWebhook);
}
