import axios from "axios";
import type { CompanyAiType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { DEFAULT_GLOBAL_AI_PROMPT, getDefaultPromptForCategory } from "../config/default-ai-prompt.js";
import { appConfigService } from "./app-config.service.js";

type IntentType = "ver" | "importar" | "ver_e_importar" | "ajuda";

interface IntentResult {
  intent: IntentType;
  confidence: number;
}

interface NaturalReplyInput {
  companyId: string;
  userMessage: string;
  intent: IntentType;
  operationSummary: string;
  shouldAskAction: boolean;
  actionHint?: string;
}

interface BookingNaturalReplyInput {
  companyId: string;
  userMessage: string;
  intent: "listar_servicos" | "agendar" | "cancelar" | "agenda" | "recibo" | "fidelidade" | "ajuda";
  operationSummary: string;
  shouldAskAction?: boolean;
  actionHint?: string;
}

interface ProactiveNfe {
  chave: string;
  valor: number;
}

export interface AgentConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

interface AgentRunInput {
  companyId: string;
  userMessage: string;
  systemInstruction: string;
  tools: AgentToolDefinition[];
  conversationHistory?: AgentConversationMessage[];
  maxSteps?: number;
}

interface AgentRunResult {
  text: string;
  usedTools: string[];
}

interface ChatToolCall {
  id: string;
  type: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

const TOOL_FALLBACK_MODEL = "llama-3.1-8b-instant";

class AiService {
  async resolvePrompt(companyId: string, category?: CompanyAiType): Promise<string> {
    const resolvedCategory = category ?? await this.resolveCompanyCategory(companyId);

    const [companyPrompt, categoryGlobalPrompt, globalPrompt] = await Promise.all([
      prisma.aiPrompt.findFirst({
        where: { scope: "company", companyId, active: true },
        orderBy: { createdAt: "desc" },
      }),
      resolvedCategory
        ? prisma.aiPrompt.findFirst({
          where: { scope: "global", category: resolvedCategory, active: true },
          orderBy: { createdAt: "desc" },
        })
        : null,
      prisma.aiPrompt.findFirst({
        where: { scope: "global", category: null, active: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (companyPrompt?.promptText) {
      return companyPrompt.promptText;
    }

    if (categoryGlobalPrompt?.promptText) {
      return categoryGlobalPrompt.promptText;
    }

    if (globalPrompt?.promptText) {
      return globalPrompt.promptText;
    }

    return resolvedCategory
      ? getDefaultPromptForCategory(resolvedCategory)
      : DEFAULT_GLOBAL_AI_PROMPT;
  }

  private async resolveCompanyCategory(companyId: string): Promise<CompanyAiType | null> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { aiType: true },
    });
    return company?.aiType ?? null;
  }

  async classifyIntent(companyId: string, message: string): Promise<IntentResult> {
    const prompt = await this.resolvePrompt(companyId);
    const settings = await appConfigService.getSettings();
    if (!this.isAiProviderConfigured(settings.groqApiKey)) {
      return {
        intent: this.heuristicIntent(message),
        confidence: 0.3,
      };
    }

    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: settings.groqModel,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `${prompt}\nClassifique a intencao do usuario em: ver, importar, ver_e_importar ou ajuda. Retorne somente JSON no formato {"intent":"...","confidence":0-1}.`,
            },
            {
              role: "user",
              content: message,
            },
          ],
        },
        {
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${settings.groqApiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      const raw = response.data?.choices?.[0]?.message?.content;
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw) as { intent?: string; confidence?: number };
        const intent = this.sanitizeIntent(parsed.intent);
        if (intent) {
          return {
            intent,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.75,
          };
        }
      }
    } catch {
      // fallback heuristico para manter disponibilidade.
    }

    return {
      intent: this.heuristicIntent(message),
      confidence: 0.6,
    };
  }

  async generateNaturalReply(input: NaturalReplyInput): Promise<string> {
    const prompt = await this.resolvePrompt(input.companyId);
    const settings = await appConfigService.getSettings();
    const sectorInstructions = await this.resolveBookingSectorInstructions(input.companyId);

    if (!this.isAiProviderConfigured(settings.groqApiKey)) {
      return this.providerUnavailableReply("A chave da IA nao esta configurada.");
    }

    const systemPrompt = [
      prompt,
      sectorInstructions,
      "",
      "Regras adicionais desta resposta:",
      "- Responda sempre em portugues do Brasil.",
      "- Baseie-se somente no contexto operacional enviado.",
      "- Nao invente dados.",
      "- Seja objetiva e natural.",
      "- Escreva em texto simples para WhatsApp (sem markdown).",
      "- Nao use caracteres de markdown como *, _, `, # ou blocos de codigo.",
      '- Para lista, use somente linhas iniciadas com "- ".',
    ]
      .filter(Boolean)
      .join("\n");

    const userPayload = {
      objetivo: "Responder o cliente de forma natural e profissional com base no estado real do sistema.",
      mensagem_usuario: input.userMessage,
      intencao_detectada: input.intent,
      resumo_operacional: input.operationSummary,
      deve_perguntar_proxima_acao: input.shouldAskAction,
      sugestao_de_acao: input.actionHint ?? "",
      formato: "texto direto para WhatsApp, sem markdown, sem asteriscos, sem negrito",
    };

    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: settings.groqModel,
          temperature: 0.35,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: JSON.stringify(userPayload),
            },
          ],
        },
        {
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${settings.groqApiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      const text = response.data?.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.trim().length > 0) {
        return this.limitLength(this.normalizeWhatsappText(text), 1400);
      }

      return this.providerUnavailableReply("O provedor de IA respondeu sem conteudo valido.");
    } catch (error) {
      return this.providerUnavailableReply(this.extractProviderError(error));
    }
  }

  async generateBookingNaturalReply(input: BookingNaturalReplyInput): Promise<string> {
    const prompt = await this.resolvePrompt(input.companyId, "barber_booking");
    const settings = await appConfigService.getSettings();
    const sectorInstructions = await this.resolveBookingSectorInstructions(input.companyId);

    if (!this.isAiProviderConfigured(settings.groqApiKey)) {
      return this.fallbackBookingReply(input.operationSummary, input.shouldAskAction, input.actionHint);
    }

    const systemPrompt = [
      prompt,
      sectorInstructions,
      "",
      "Contexto adicional deste atendimento:",
      "- Este fluxo e de agendamento operacional (barbearia, clinica, lava jato ou agenda generica).",
      "- Use termos do setor da empresa quando estiverem disponiveis no contexto.",
      "- Preserve exatamente os dados operacionais informados no resumo (nome, servico, horario, status).",
      "- Nao invente disponibilidade, preco, duracao, recurso, profissional ou agendamento.",
      "- Nao invente categoria/tipo de servico (ex.: simples, premium, completa) se nao estiver no resumo operacional.",
      "- Se houver apenas um servico no resumo, trate esse servico como selecionado e nao pergunte novamente o tipo.",
      "- Mantenha continuidade da conversa: nao reinicie atendimento em toda mensagem.",
      "- Evite bordoes repetitivos no inicio das respostas (ex.: 'E ai', 'Bora', 'Tudo certo').",
      "- Responda em texto simples de WhatsApp, sem markdown.",
      "- Formate com frases curtas e claras; use lista somente quando necessario.",
      "",
      "Objetivo da resposta:",
      "- Transformar o resumo operacional em uma mensagem natural, clara e curta para o cliente.",
      "- Se houver pendencia de dados, pedir somente o que falta.",
      "- Se a operacao foi concluida, confirmar o resultado e orientar o proximo passo.",
    ].join("\n");

    const userPayload = {
      intencao_detectada: input.intent,
      mensagem_usuario: input.userMessage,
      resumo_operacional: input.operationSummary,
      deve_perguntar_proxima_acao: Boolean(input.shouldAskAction),
      sugestao_de_acao: input.actionHint ?? "",
    };

    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: settings.groqModel,
          temperature: 0.35,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: JSON.stringify(userPayload),
            },
          ],
        },
        {
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${settings.groqApiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      const text = response.data?.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.trim().length > 0) {
        return this.limitLength(this.normalizeWhatsappText(text), 1400);
      }
    } catch {
      // fallback abaixo garante disponibilidade mesmo sem IA.
    }

    return this.fallbackBookingReply(input.operationSummary, input.shouldAskAction, input.actionHint);
  }

  async generateProactiveNewNotesReply(companyId: string, notes: ProactiveNfe[]): Promise<string> {
    const total = notes.reduce((acc, item) => acc + item.valor, 0);
    const preview = notes
      .slice(0, 5)
      .map((item) => `${item.chave} | ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.valor)}`)
      .join("\n");

    const operationSummary = [
      `Webservice de NF-e ativo e com novas notas detectadas: ${notes.length}.`,
      `Valor total das novas notas: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total)}.`,
      preview ? `Notas (amostra):\n${preview}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return this.generateNaturalReply({
      companyId,
      userMessage: "Notificacao automatica de novas notas detectadas pelo webservice.",
      intent: "ajuda",
      operationSummary,
      shouldAskAction: true,
      actionHint: "Pergunte ao usuario se deseja ver, importar ou ver e importar.",
    });
  }

  async runToolAgent(input: AgentRunInput): Promise<AgentRunResult> {
    const prompt = await this.resolvePrompt(input.companyId);
    const settings = await appConfigService.getSettings();
    const sectorInstructions = await this.resolveBookingSectorInstructions(input.companyId);

    if (!this.isAiProviderConfigured(settings.groqApiKey)) {
      return {
        text: this.providerUnavailableReply("A chave da IA nao esta configurada."),
        usedTools: [],
      };
    }

    const tools = input.tools ?? [];
    const toolModel = this.resolveToolModel(settings.groqModel);
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    const toolSchemas = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const messages: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: [
          prompt,
          "",
          input.systemInstruction,
          sectorInstructions,
          "",
          "Regras de execucao:",
          "- Use ferramentas quando precisar consultar ou alterar dados.",
          "- Nao invente valores fiscais ou status.",
          "- Antes de executar acoes sensiveis, confirme explicitamente com o usuario.",
          "- Responda em portugues do Brasil, em texto simples de WhatsApp, sem markdown.",
        ].filter(Boolean).join("\n"),
      },
    ];

    for (const item of input.conversationHistory ?? []) {
      const text = item.text?.trim();
      if (!text || (item.role !== "user" && item.role !== "assistant")) {
        continue;
      }

      messages.push({
        role: item.role,
        content: text,
      });
    }

    messages.push({
      role: "user",
      content: input.userMessage,
    });

    const maxSteps = Math.max(1, Math.min(6, input.maxSteps ?? 4));
    const usedTools = new Set<string>();

    for (let step = 0; step < maxSteps; step += 1) {
      try {
        const response = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: toolModel,
            temperature: 0.2,
            messages,
            tools: toolSchemas,
            tool_choice: tools.length > 0 ? "auto" : "none",
          },
          {
            timeout: 20000,
            headers: {
              Authorization: `Bearer ${settings.groqApiKey}`,
              "Content-Type": "application/json",
            },
          },
        );

        const message = response.data?.choices?.[0]?.message ?? {};
        const assistantContent = typeof message.content === "string" ? message.content.trim() : "";
        const rawToolCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as ChatToolCall[]) : [];
        const toolCalls = rawToolCalls.filter((call) => {
          const name = call.function?.name;
          return typeof call.id === "string" && typeof name === "string" && toolMap.has(name);
        });

        if (toolCalls.length === 0) {
          if (assistantContent.length > 0) {
            return {
              text: this.limitLength(this.normalizeWhatsappText(assistantContent), 1400),
              usedTools: Array.from(usedTools),
            };
          }

          return {
            text: this.providerUnavailableReply("O provedor de IA respondeu sem conteudo valido."),
            usedTools: Array.from(usedTools),
          };
        }

        messages.push({
          role: "assistant",
          content: assistantContent || null,
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: call.type || "function",
            function: {
              name: call.function?.name,
              arguments: call.function?.arguments ?? "{}",
            },
          })),
        });

        for (const call of toolCalls) {
          const toolName = call.function?.name ?? "";
          const tool = toolMap.get(toolName);
          if (!tool) {
            continue;
          }

          usedTools.add(toolName);
          const args = this.safeParseToolArguments(call.function?.arguments);

          let result = "";
          try {
            result = await tool.execute(args);
          } catch (error) {
            result = `Erro na ferramenta ${toolName}: ${error instanceof Error ? error.message : "erro desconhecido"}`;
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: toolName,
            content: this.limitLength(this.normalizeWhatsappText(result || "Sem retorno da ferramenta."), 3000),
          });
        }
      } catch (error) {
        const providerError = this.extractProviderError(error);
        return {
          text: this.providerUnavailableReply(providerError),
          usedTools: Array.from(usedTools),
        };
      }
    }

    return {
      text: this.providerUnavailableReply("A conversa com ferramentas excedeu o limite de passos."),
      usedTools: Array.from(usedTools),
    };
  }

  private sanitizeIntent(value?: string): IntentType | null {
    if (!value) {
      return null;
    }

    if (value === "ver" || value === "importar" || value === "ver_e_importar" || value === "ajuda") {
      return value;
    }

    return null;
  }

  private heuristicIntent(message: string): IntentType {
    const normalized = message.toLowerCase();

    const wantsView =
      normalized.includes("ver") ||
      normalized.includes("mostrar") ||
      normalized.includes("consult") ||
      normalized.includes("detalh") ||
      normalized.includes("produto") ||
      normalized.includes("itens") ||
      normalized.includes("item");
    const wantsImport = normalized.includes("import") || normalized.includes("trazer") || normalized.includes("salvar");

    if (wantsView && wantsImport) {
      return "ver_e_importar";
    }

    if (wantsImport) {
      return "importar";
    }

    if (wantsView) {
      return "ver";
    }

    return "ajuda";
  }

  private fallbackReply(intent: IntentType, operationSummary: string, shouldAskAction: boolean, actionHint?: string): string {
    const base = this.normalizeWhatsappText(`${operationSummary}`);

    if (shouldAskAction) {
      const action = actionHint || "Deseja ver, importar ou ver e importar?";
      return this.normalizeWhatsappText(`${base}\n\n${action}`);
    }

    if (intent === "ajuda") {
      return this.normalizeWhatsappText(`${base}\n\nPosso te ajudar com: ver notas, importar notas ou ver e importar.`);
    }

    return base;
  }

  private fallbackBookingReply(operationSummary: string, shouldAskAction?: boolean, actionHint?: string): string {
    const base = this.normalizeWhatsappText(operationSummary || "");
    if (!shouldAskAction) {
      return base;
    }

    const hint = this.normalizeWhatsappText(actionHint || "Quer que eu continue com o proximo passo?");
    if (!base) {
      return hint;
    }

    return `${base}\n\n${hint}`;
  }

  private async resolveBookingSectorInstructions(companyId: string): Promise<string> {
    const companyDetails = await prisma.company.findUnique({
      where: { id: companyId },
      select: { bookingSector: true, aiType: true },
    });

    if (companyDetails?.aiType !== "barber_booking") {
      return "";
    }

    switch (companyDetails.bookingSector) {
      case "car_wash":
        return "ATENCAO: O estabelecimento e um LAVA JATO/ESTETICA AUTOMOTIVA. Use termos como box, vaga, lavador e tipo de lavagem, evitando vocabulario de barbearia.";
      case "clinic":
        return "ATENCAO: O estabelecimento e uma CLINICA/CONSULTORIO. Use termos como profissional, medico(a), doutor(a) ou especialista.";
      case "generic":
        return "ATENCAO: O estabelecimento usa AGENDAMENTO GENERICO. Adapte o vocabulario aos servicos e recursos cadastrados.";
      default:
        return "";
    }
  }

  private isAiProviderConfigured(apiKey: string | null | undefined): boolean {
    return Boolean(apiKey && apiKey.trim().length > 0);
  }

  private resolveToolModel(configuredModel: string): string {
    const normalized = (configuredModel || "").trim().toLowerCase();

    // O modelo "groq/compound" nao suporta tool-calling.
    if (normalized === "groq/compound") {
      return TOOL_FALLBACK_MODEL;
    }

    return configuredModel;
  }

  private safeParseToolArguments(raw: string | undefined): Record<string, unknown> {
    if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private providerUnavailableReply(reason: string): string {
    return this.normalizeWhatsappText(
      [
        "No momento nao consigo responder com IA generativa.",
        reason,
        "",
        "Verifique a configuracao do provedor de IA (GROQ_API_KEY) e tente novamente.",
      ].join("\n"),
    );
  }

  private extractProviderError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const providerMessage = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
      const base = providerMessage || error.message || "erro desconhecido";
      return status ? `Falha no provedor de IA (HTTP ${status}): ${base}` : `Falha no provedor de IA: ${base}`;
    }

    return error instanceof Error
      ? `Falha no provedor de IA: ${error.message}`
      : "Nao consegui consultar o provedor de IA agora.";
  }

  private normalizeWhatsappText(text: string): string {
    const withoutMarkdown = text
      .replace(/\r\n/g, "\n")
      .replace(/[\u2022\u25cf\u25aa\u25e6]/g, "-")
      .replace(/^\s*[.]\s+/gm, "- ")
      .replace(/^\s*-\s*-\s+/gm, "- ")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s{1,3}-/gm, "-")
      .replace(/\n{3,}/g, "\n\n");

    return withoutMarkdown
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
  }

  private limitLength(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }

    return `${text.slice(0, maxChars - 3)}...`;
  }
}

export const aiService = new AiService();

