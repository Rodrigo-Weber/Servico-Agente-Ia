export interface StoredMessageAttachment {
  fileName: string | null;
  mimeType: string | null;
  mediaType: string | null;
  base64: string;
}

export interface ParsedStoredMessageContent {
  text: string;
  attachment: StoredMessageAttachment | null;
}

interface StoredMessageContentPayload {
  version: 1;
  text: string;
  attachment: StoredMessageAttachment;
}

const STORED_CONTENT_PREFIX = "__MSGJSON__:";

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeAttachment(input: StoredMessageAttachment): StoredMessageAttachment | null {
  const base64 = (input.base64 || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (!base64) {
    return null;
  }

  return {
    fileName: normalizeText(input.fileName) || null,
    mimeType: normalizeText(input.mimeType) || null,
    mediaType: normalizeText(input.mediaType) || null,
    base64,
  };
}

export function buildStoredMessageContent(input: {
  text: string;
  attachment?: StoredMessageAttachment | null;
}): string {
  const text = input.text || "";
  const attachment = input.attachment ? sanitizeAttachment(input.attachment) : null;

  if (!attachment) {
    return text;
  }

  const payload: StoredMessageContentPayload = {
    version: 1,
    text,
    attachment,
  };

  return `${STORED_CONTENT_PREFIX}${JSON.stringify(payload)}`;
}

export function parseStoredMessageContent(content: string): ParsedStoredMessageContent {
  if (!content.startsWith(STORED_CONTENT_PREFIX)) {
    return {
      text: content,
      attachment: null,
    };
  }

  const rawJson = content.slice(STORED_CONTENT_PREFIX.length);
  try {
    const parsed = JSON.parse(rawJson) as Partial<StoredMessageContentPayload>;
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const attachmentRaw = parsed.attachment;

    if (!attachmentRaw || typeof attachmentRaw !== "object") {
      return { text, attachment: null };
    }

    const attachmentRecord = attachmentRaw as unknown as Record<string, unknown>;
    const attachment = sanitizeAttachment({
      fileName: attachmentRecord.fileName as string | null,
      mimeType: attachmentRecord.mimeType as string | null,
      mediaType: attachmentRecord.mediaType as string | null,
      base64: attachmentRecord.base64 as string,
    });

    return {
      text,
      attachment,
    };
  } catch {
    return {
      text: content,
      attachment: null,
    };
  }
}

export function buildStoredMessagePreview(input: { content: string; messageType: "text" | "media" | "system" }): string {
  const parsed = parseStoredMessageContent(input.content);
  const text = (parsed.text || "").trim();

  if (text) {
    return text;
  }

  if (parsed.attachment?.fileName) {
    return `[arquivo] ${parsed.attachment.fileName}`;
  }

  if (parsed.attachment) {
    return "[arquivo]";
  }

  if (input.messageType === "media") {
    return "[arquivo]";
  }

  return "";
}
