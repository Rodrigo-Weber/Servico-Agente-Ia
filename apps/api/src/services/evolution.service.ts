import axios, { AxiosInstance } from "axios";
import { appConfigService } from "./app-config.service.js";

interface StartSessionResult {
  alreadyConnected: boolean;
  status: string;
  raw: unknown;
}

class EvolutionService {
  private async getClientContext(instanceNameOverride?: string): Promise<{ client: AxiosInstance; instanceName: string }> {
    const settings = await appConfigService.getSettings();
    const client = axios.create({
      baseURL: settings.evolutionBaseUrl,
      timeout: 15000,
      headers: settings.evolutionApiKey
        ? {
            apikey: settings.evolutionApiKey,
          }
        : undefined,
    });

    return {
      client,
      instanceName: instanceNameOverride || settings.evolutionInstanceName,
    };
  }

  private async getSessionStatusWithClient(
    client: AxiosInstance,
    instanceName: string,
  ): Promise<{ status: string; raw: unknown }> {
    const paths = [`/instance/connectionState/${instanceName}`, "/instance/fetchInstances"];

    for (const path of paths) {
      try {
        const response = await client.get(path);
        const status = this.extractStatus(response.data);
        return { status, raw: response.data };
      } catch {
        continue;
      }
    }

    return { status: "unknown", raw: null };
  }

  async startSession(instanceNameOverride?: string): Promise<StartSessionResult> {
    const { client, instanceName } = await this.getClientContext(instanceNameOverride);
    const before = await this.getSessionStatusWithClient(client, instanceName);
    if (this.isConnectedStatus(before.status)) {
      return {
        alreadyConnected: true,
        status: before.status,
        raw: before.raw,
      };
    }

    const attempts: Array<{ method: "get" | "post"; path: string; data?: unknown }> = [
      { method: "post", path: `/instance/connect/${instanceName}` },
      { method: "get", path: `/instance/connect/${instanceName}` },
      { method: "post", path: `/instance/create`, data: { instanceName } },
      { method: "post", path: `/instance/create`, data: { name: instanceName } },
    ];

    let lastError = "";

    for (const attempt of attempts) {
      try {
        const response = await client.request({
          method: attempt.method,
          url: attempt.path,
          data: attempt.data,
        });

        const status = this.extractStatus(response.data);
        if (status !== "unknown") {
          return {
            alreadyConnected: this.isConnectedStatus(status),
            status,
            raw: response.data,
          };
        }
      } catch (error) {
        lastError = this.extractErrorMessage(error);
      }
    }

    const after = await this.getSessionStatusWithClient(client, instanceName);
    if (after.status !== "unknown") {
      return {
        alreadyConnected: this.isConnectedStatus(after.status),
        status: after.status,
        raw: after.raw,
      };
    }

    throw new Error(lastError || "Falha ao iniciar sessao no Evolution API");
  }

  async disconnectSession(instanceNameOverride?: string): Promise<{ status: string; raw: unknown }> {
    const { client, instanceName } = await this.getClientContext(instanceNameOverride);

    const attempts: Array<{ method: "delete" | "post"; path: string; data?: unknown }> = [
      { method: "post", path: `/instance/logout/${instanceName}` },
      { method: "delete", path: `/instance/logout/${instanceName}` },
      { method: "post", path: `/instance/disconnect/${instanceName}` },
      { method: "delete", path: `/instance/disconnect/${instanceName}` },
      { method: "post", path: "/instance/logout", data: { instanceName } },
      { method: "post", path: "/instance/disconnect", data: { instanceName } },
    ];

    let lastError = "";

    for (const attempt of attempts) {
      try {
        const response = await client.request({
          method: attempt.method,
          url: attempt.path,
          data: attempt.data,
        });
        const status = this.extractStatus(response.data);
        if (status !== "unknown") {
          return { status, raw: response.data };
        }
      } catch (error) {
        lastError = this.extractErrorMessage(error);
      }
    }

    const after = await this.getSessionStatusWithClient(client, instanceName);
    if (!this.isConnectedStatus(after.status)) {
      return after;
    }

    throw new Error(lastError || "Falha ao desconectar sessao no Evolution API");
  }

  async getSessionStatus(instanceNameOverride?: string): Promise<{ status: string; raw: unknown }> {
    const { client, instanceName } = await this.getClientContext(instanceNameOverride);
    return this.getSessionStatusWithClient(client, instanceName);
  }

  async getQrCode(instanceNameOverride?: string): Promise<{ qr: string | null; raw: unknown; status: string }> {
    const { client, instanceName } = await this.getClientContext(instanceNameOverride);
    const paths = [`/instance/connect/${instanceName}`, `/instance/qrcode/${instanceName}`];

    for (const path of paths) {
      try {
        const response = await client.get(path);
        const qr = this.extractQr(response.data);
        const status = this.extractStatus(response.data);
        return { qr, raw: response.data, status };
      } catch {
        continue;
      }
    }

    const current = await this.getSessionStatusWithClient(client, instanceName);
    return { qr: null, raw: current.raw, status: current.status };
  }

  async sendText(phone: string, text: string, instanceNameOverride?: string): Promise<void> {
    const { client, instanceName } = await this.getClientContext(instanceNameOverride);
    const payload = {
      number: phone,
      text,
      options: {
        delay: 0,
        presence: "composing",
      },
    };

    const paths = [`/message/sendText/${instanceName}`, "/message/sendText"];

    let lastError: unknown;

    for (const path of paths) {
      try {
        await client.post(path, payload);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Falha ao enviar mensagem no WhatsApp");
  }

  async sendDocument(
    phone: string,
    input: {
      base64: string;
      fileName: string;
      mimeType?: string;
      caption?: string;
    },
    instanceNameOverride?: string,
  ): Promise<void> {
    const { client, instanceName } = await this.getClientContext(instanceNameOverride);
    const mimeType = input.mimeType || "application/pdf";
    const base64Plain = input.base64.replace(/^data:[^;]+;base64,/, "");
    const base64DataUri = `data:${mimeType};base64,${base64Plain}`;

    const payloads: Array<Record<string, unknown>> = [
      {
        number: phone,
        mediatype: "document",
        mimetype: mimeType,
        media: base64DataUri,
        fileName: input.fileName,
        caption: input.caption ?? "",
        options: {
          delay: 0,
          presence: "composing",
        },
      },
      {
        number: phone,
        mediatype: "document",
        mimetype: mimeType,
        media: base64Plain,
        fileName: input.fileName,
        caption: input.caption ?? "",
        options: {
          delay: 0,
          presence: "composing",
        },
      },
      {
        number: phone,
        mediatype: "document",
        mimetype: mimeType,
        mediabase64: base64Plain,
        fileName: input.fileName,
        caption: input.caption ?? "",
      },
      {
        number: phone,
        mediatype: "document",
        mimetype: mimeType,
        mediabase64: base64DataUri,
        filename: input.fileName,
        caption: input.caption ?? "",
      },
    ];

    const paths = [`/message/sendMedia/${instanceName}`, "/message/sendMedia", `/message/sendFile/${instanceName}`, "/message/sendFile"];

    let lastError: unknown;
    for (const path of paths) {
      for (const payload of payloads) {
        try {
          await client.post(path, payload);
          return;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Falha ao enviar documento no WhatsApp");
  }

  async downloadMedia(url: string): Promise<Buffer> {
    const { client } = await this.getClientContext();
    const response = await client.get(url, {
      responseType: "arraybuffer",
    });

    return Buffer.from(response.data);
  }

  async getBase64FromMediaMessage(message: unknown, instanceNameOverride?: string): Promise<{
    base64: string;
    mimetype?: string | null;
    fileName?: string | null;
    mediaType?: string | null;
  } | null> {
    const { client, instanceName } = await this.getClientContext(instanceNameOverride);
    const payload = {
      message,
      convertToMp4: false,
    };

    const paths = [`/chat/getBase64FromMediaMessage/${instanceName}`, "/chat/getBase64FromMediaMessage"];

    for (const path of paths) {
      try {
        const response = await client.post(path, payload);
        const normalized = this.extractBase64Payload(response.data);
        if (normalized) {
          return normalized;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private extractStatus(data: unknown): string {
    const found = this.findStatusValue(data);
    return found ?? "unknown";
  }

  private findStatusValue(value: unknown): string | null {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized || normalized === "[object Object]" || normalized.length > 64) {
        return null;
      }

      return normalized;
    }

    if (!value) {
      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findStatusValue(item);
        if (found) {
          return found;
        }
      }
      return null;
    }

    if (typeof value !== "object") {
      return null;
    }

    const record = value as Record<string, unknown>;

    const priorityKeys = ["state", "status", "connectionStatus", "instanceStatus"];
    for (const key of priorityKeys) {
      const found = this.findStatusValue(record[key]);
      if (found) {
        return found;
      }
    }

    const commonNestedKeys = ["instance", "instances", "data", "response", "info"];
    for (const key of commonNestedKeys) {
      const found = this.findStatusValue(record[key]);
      if (found) {
        return found;
      }
    }

    return null;
  }

  private extractQr(data: unknown): string | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    const root = data as Record<string, unknown>;

    const candidates: unknown[] = [
      root.base64,
      root.qrcode,
      root.qr,
      (root.qrcode as Record<string, unknown> | undefined)?.base64,
      (root.qrcode as Record<string, unknown> | undefined)?.code,
      (root.instance as Record<string, unknown> | undefined)?.qrcode,
      (root.instance as Record<string, unknown> | undefined)?.qr,
    ];

    for (const item of candidates) {
      if (typeof item === "string" && item.length > 0) {
        return item;
      }
    }

    return null;
  }

  private isConnectedStatus(status: string): boolean {
    const normalized = status.toLowerCase();
    return normalized.includes("open") || normalized.includes("connected");
  }

  private extractBase64Payload(data: unknown): {
    base64: string;
    mimetype?: string | null;
    fileName?: string | null;
    mediaType?: string | null;
  } | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    const root = data as Record<string, unknown>;
    const nestedCandidates: Array<Record<string, unknown>> = [root];

    const dataNode = root.data;
    if (dataNode && typeof dataNode === "object" && !Array.isArray(dataNode)) {
      nestedCandidates.push(dataNode as Record<string, unknown>);
    }

    const responseNode = root.response;
    if (responseNode && typeof responseNode === "object" && !Array.isArray(responseNode)) {
      nestedCandidates.push(responseNode as Record<string, unknown>);
    }

    for (const node of nestedCandidates) {
      const base64 = node.base64;
      if (typeof base64 === "string" && base64.length > 0) {
        return {
          base64,
          mimetype: typeof node.mimetype === "string" ? node.mimetype : null,
          fileName:
            typeof node.fileName === "string"
              ? node.fileName
              : typeof node.filename === "string"
                ? node.filename
                : null,
          mediaType: typeof node.mediaType === "string" ? node.mediaType : null,
        };
      }
    }

    return null;
  }

  private extractErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;

      if (typeof data === "string" && data.trim()) {
        return `Evolution API (${status ?? "sem status"}): ${data}`;
      }

      if (data && typeof data === "object") {
        const payload = data as Record<string, unknown>;
        const msg = [payload.message, payload.error, payload.detail].find(
          (value) => typeof value === "string" && value.trim().length > 0,
        ) as string | undefined;

        if (msg) {
          return `Evolution API (${status ?? "sem status"}): ${msg}`;
        }

        try {
          return `Evolution API (${status ?? "sem status"}): ${JSON.stringify(data)}`;
        } catch {
          return `Evolution API (${status ?? "sem status"})`;
        }
      }

      if (error.message) {
        return `Evolution API: ${error.message}`;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Erro desconhecido ao comunicar com Evolution API";
  }
}

export const evolutionService = new EvolutionService();
