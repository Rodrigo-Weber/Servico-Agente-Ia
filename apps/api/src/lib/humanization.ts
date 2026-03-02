/**
 * Módulo de humanização para tornar respostas da IA mais naturais e empáticas.
 * Contém helpers para saudações, variações de expressões, emojis contextuais e personalização.
 */

// =============================================
// CONTEXTO TEMPORAL
// =============================================

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export type WeekdayType = "weekday" | "friday" | "saturday" | "sunday";

export function getTimeOfDay(date = new Date()): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

export function getWeekdayType(date = new Date()): WeekdayType {
  const day = date.getDay();
  if (day === 0) return "sunday";
  if (day === 6) return "saturday";
  if (day === 5) return "friday";
  return "weekday";
}

export function getTimeGreeting(date = new Date()): string {
  const time = getTimeOfDay(date);
  const greetings: Record<TimeOfDay, string[]> = {
    morning: ["Bom dia", "Bom diaa", "Oi, bom dia"],
    afternoon: ["Boa tarde", "Oi, boa tarde", "Boa tardee"],
    evening: ["Boa noite", "Oi, boa noite", "Boa noitee"],
    night: ["Oi", "Ola", "E ai"],
  };
  return pickRandom(greetings[time]);
}

export function getWeekdayContext(date = new Date()): string | null {
  const type = getWeekdayType(date);
  const contexts: Record<WeekdayType, string[] | null> = {
    weekday: null,
    friday: ["Sextou!", "Ja e sexta!"],
    saturday: ["Bom sabado!", "Sabadao chegou!"],
    sunday: ["Bom domingo!", "Domingo relax!"],
  };
  const options = contexts[type];
  return options ? pickRandom(options) : null;
}

// =============================================
// VARIAÇÕES DE EXPRESSÕES (evitar repetição)
// =============================================

const CONFIRMATION_PHRASES = [
  "Certinho!",
  "Perfeitoo!",
  "Show!",
  "Beleza!",
  "Certo!",
  "Otimo!",
  "Fechou!",
  "Ta feito!",
  "Pronto!",
  "Anotado!",
];

const UNDERSTANDING_PHRASES = [
  "Entendi!",
  "Entendido!",
  "Compreendi!",
  "Ah, entendi!",
  "Saquei!",
  "Certo, entendi!",
  "Hmm, entendi!",
  "Ah sim!",
];

const WAITING_PHRASES = [
  "Um momento...",
  "Deixa eu ver aqui...",
  "Ja verifico pra voce...",
  "Olhando aqui...",
  "So um instante...",
  "Vou conferir...",
];

const APOLOGIZE_PHRASES = [
  "Desculpa a demora!",
  "Poxa, desculpa!",
  "Mil desculpas!",
  "Desculpe por isso!",
  "Perdao!",
];

const EMPATHY_PHRASES = [
  "Entendo perfeitamente!",
  "Com certeza!",
  "Claro, sem problemas!",
  "Pode deixar!",
  "Fique tranquilo(a)!",
  "Relaxa que eu resolvo!",
  "Conte comigo!",
];

const QUESTIONS_MORE_HELP = [
  "Precisa de mais alguma coisa?",
  "Posso ajudar com mais algo?",
  "Quer saber mais alguma coisa?",
  "Tem algo mais que eu possa fazer?",
  "Se precisar de algo, e so chamar!",
  "Qualquer coisa, estou aqui!",
  "Mais alguma duvida?",
];

const GOODBYE_PHRASES = [
  "Ate mais!",
  "Ate logo!",
  "Ate a proxima!",
  "Foi um prazer ajudar!",
  "Valeu, ate!",
  "Tchau, ate mais!",
  "Obrigado(a) pela preferencia!",
];

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

export function getConfirmation(): string {
  return pickRandom(CONFIRMATION_PHRASES);
}

export function getUnderstanding(): string {
  return pickRandom(UNDERSTANDING_PHRASES);
}

export function getWaiting(): string {
  return pickRandom(WAITING_PHRASES);
}

export function getApology(): string {
  return pickRandom(APOLOGIZE_PHRASES);
}

export function getEmpathy(): string {
  return pickRandom(EMPATHY_PHRASES);
}

export function getMoreHelp(): string {
  return pickRandom(QUESTIONS_MORE_HELP);
}

export function getGoodbye(): string {
  return pickRandom(GOODBYE_PHRASES);
}

// =============================================
// EMOJIS CONTEXTUAIS (por setor)
// =============================================

export type BusinessSector = "barber" | "clinic" | "restaurant" | "car_wash" | "billing" | "nfe" | "generic";

const SECTOR_EMOJIS: Record<BusinessSector, string[]> = {
  barber: ["💈", "✂️", "💇", "👔"],
  clinic: ["🏥", "🩺", "❤️", "😊"],
  restaurant: ["🍕", "🍔", "🍽️", "😋"],
  car_wash: ["🚗", "🧼", "✨", "🚙"],
  billing: ["📋", "💰", "✅", "📊"],
  nfe: ["📄", "✅", "📋", "💼"],
  generic: ["✨", "😊", "👍", "🙌"],
};

export function getSectorEmoji(sector: BusinessSector): string {
  return pickRandom(SECTOR_EMOJIS[sector]);
}

export function getSectorEmojis(sector: BusinessSector, count = 1): string[] {
  const emojis = SECTOR_EMOJIS[sector];
  const result: string[] = [];
  for (let i = 0; i < count && i < emojis.length; i++) {
    result.push(emojis[i] as string);
  }
  return result;
}

// =============================================
// SAUDAÇÃO PERSONALIZADA
// =============================================

interface GreetingOptions {
  clientName?: string | null;
  isReturningClient?: boolean;
  sector?: BusinessSector;
  includeEmoji?: boolean;
  isFirstMessageOfDay?: boolean;
}

export function buildPersonalizedGreeting(options: GreetingOptions = {}): string {
  const { clientName, isReturningClient, sector = "generic", includeEmoji = true, isFirstMessageOfDay = true } = options;

  const parts: string[] = [];

  // Saudação temporal na primeira mensagem do dia
  if (isFirstMessageOfDay) {
    parts.push(getTimeGreeting());
  }

  // Nome do cliente se disponível
  if (clientName) {
    const firstName = clientName.split(" ")[0];
    if (isReturningClient) {
      parts.push(pickRandom([
        `, ${firstName}!`,
        `, ${firstName}! Que bom te ver de novo`,
        `, ${firstName}! Saudades`,
        `! Oi de novo, ${firstName}`,
      ]));
    } else {
      parts.push(`, ${firstName}!`);
    }
  } else {
    parts.push("!");
  }

  // Contexto de dia da semana (ocasionalmente)
  const weekdayContext = Math.random() > 0.7 ? getWeekdayContext() : null;
  if (weekdayContext) {
    parts.push(` ${weekdayContext}`);
  }

  // Emoji do setor
  if (includeEmoji) {
    parts.push(` ${getSectorEmoji(sector)}`);
  }

  return parts.join("");
}

// =============================================
// HUMANIZAÇÃO DE RESPOSTAS
// =============================================

export interface HumanizeOptions {
  addGreeting?: boolean;
  greetingOptions?: GreetingOptions;
  addClosing?: boolean;
  closingType?: "help" | "goodbye";
  addEmpathy?: boolean;
  empathyContext?: "confirmation" | "understanding" | "waiting" | "apology";
  addEmoji?: boolean;
  sector?: BusinessSector;
  maxEmoji?: number;
}

export function humanizeResponse(text: string, options: HumanizeOptions = {}): string {
  const {
    addGreeting = false,
    greetingOptions,
    addClosing = false,
    closingType = "help",
    addEmpathy = false,
    empathyContext,
    addEmoji = false,
    sector = "generic",
    maxEmoji = 2,
  } = options;

  const parts: string[] = [];

  // Saudação no início
  if (addGreeting) {
    parts.push(buildPersonalizedGreeting({ sector, ...greetingOptions }));
    parts.push("\n\n");
  }

  // Expressão de empatia/confirmação
  if (addEmpathy && empathyContext) {
    const empathyMap = {
      confirmation: getConfirmation,
      understanding: getUnderstanding,
      waiting: getWaiting,
      apology: getApology,
    };
    parts.push(empathyMap[empathyContext]());
    parts.push(" ");
  }

  // Texto principal
  parts.push(text);

  // Emoji contextual (com limite)
  if (addEmoji && Math.random() > 0.5) {
    const emoji = getSectorEmoji(sector);
    if (!text.includes(emoji)) {
      parts.push(` ${emoji}`);
    }
  }

  // Fechamento
  if (addClosing) {
    parts.push("\n\n");
    parts.push(closingType === "goodbye" ? getGoodbye() : getMoreHelp());
  }

  return parts.join("");
}

// =============================================
// DETECÇÃO DE TOM/SENTIMENTO
// =============================================

export type ClientTone = "happy" | "neutral" | "frustrated" | "urgent" | "confused";

export function detectClientTone(message: string): ClientTone {
  const normalized = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Sinais de frustração
  const frustrationSignals = [
    "demora", "demorou", "nao funciona", "nao da", "problema", "errado",
    "nao entende", "nao entendi", "cade", "onde esta", "ridiculo", "absurdo",
    "pessimo", "horrivel", "nunca mais", "desistir", "!!!", "irritado"
  ];
  if (frustrationSignals.some(signal => normalized.includes(signal))) {
    return "frustrated";
  }

  // Sinais de urgência
  const urgencySignals = [
    "urgente", "emergencia", "rapido", "agora", "ja", "imediato", "socorro",
    "preciso agora", "muito importante", "asap"
  ];
  if (urgencySignals.some(signal => normalized.includes(signal))) {
    return "urgent";
  }

  // Sinais de confusão
  const confusionSignals = [
    "como assim", "nao entendi", "pode explicar", "explica", "confuso",
    "nao sei", "o que", "qual", "ajuda", "help", "?"
  ];
  const questionMarks = (message.match(/\?/g) || []).length;
  if (confusionSignals.some(signal => normalized.includes(signal)) || questionMarks >= 2) {
    return "confused";
  }

  // Sinais de felicidade
  const happySignals = [
    "otimo", "maravilha", "perfeito", "show", "legal", "top", "amei",
    "obrigado", "obrigada", "valeu", "gratidao", ":)", "😊", "😄", "❤️",
    "excelente", "incrivel", "adorei", "muito bom"
  ];
  if (happySignals.some(signal => normalized.includes(signal))) {
    return "happy";
  }

  return "neutral";
}

export function getResponseForTone(tone: ClientTone): string {
  const responses: Record<ClientTone, string[]> = {
    happy: [
      "Que bom que gostou!",
      "Fico feliz em ajudar!",
      "Otimo!",
      "Que legal!",
    ],
    neutral: [],
    frustrated: [
      "Entendo sua frustracao e vou resolver isso agora!",
      "Desculpe pelo incomodo! Deixa eu ajudar.",
      "Poxa, sinto muito por isso! Vou verificar rapidinho.",
      "Compreendo, vamos resolver isso juntos!",
    ],
    urgent: [
      "Entendi que e urgente! Ja estou verificando.",
      "Certo, vou priorizar isso!",
      "Ok, vou resolver isso o mais rapido possivel!",
    ],
    confused: [
      "Deixa eu explicar melhor!",
      "Sem problemas, vou clarear isso!",
      "Entendo a duvida, vou te guiar!",
      "Vou simplificar pra voce!",
    ],
  };

  const options = responses[tone];
  return options.length > 0 ? pickRandom(options) : "";
}

// =============================================
// FORMATAÇÃO AMIGÁVEL DE DATAS/HORÁRIOS
// =============================================

export function formatFriendlyDate(date: Date, reference = new Date()): string {
  const diff = date.getTime() - reference.getTime();
  const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "hoje";
  }
  if (diffDays === 1) {
    return "amanha";
  }
  if (diffDays === -1) {
    return "ontem";
  }
  if (diffDays > 1 && diffDays <= 7) {
    const weekday = date.toLocaleDateString("pt-BR", { weekday: "long" });
    return diffDays <= 2 ? `depois de amanha (${weekday})` : weekday;
  }

  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatFriendlyTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const minuteStr = minutes > 0 ? `:${minutes.toString().padStart(2, "0")}` : "h";
  return `${hours}${minuteStr}`;
}

export function formatFriendlyDateTime(date: Date, reference = new Date()): string {
  const dateStr = formatFriendlyDate(date, reference);
  const timeStr = formatFriendlyTime(date);
  return `${dateStr} as ${timeStr}`;
}

// =============================================
// PERSONALIZAÇÃO BASEADA EM HISTÓRICO
// =============================================

export interface ClientHistory {
  totalAppointments?: number;
  lastServiceName?: string;
  preferredBarberId?: string;
  preferredBarberName?: string;
  averageSpending?: number;
  loyaltyPoints?: number;
  loyaltyGoal?: number;
}

export function buildPersonalizedSuggestion(history: ClientHistory): string | null {
  if (!history.totalAppointments || history.totalAppointments < 2) {
    return null;
  }

  const suggestions: string[] = [];

  if (history.lastServiceName) {
    suggestions.push(`Quer repetir o ${history.lastServiceName} que voce fez da ultima vez?`);
  }

  if (history.preferredBarberName) {
    suggestions.push(`Quer agendar com ${history.preferredBarberName} de novo?`);
  }

  if (history.loyaltyPoints && history.loyaltyGoal) {
    const remaining = history.loyaltyGoal - (history.loyaltyPoints % history.loyaltyGoal);
    if (remaining <= 3 && remaining > 0) {
      suggestions.push(`Faltam so ${remaining} agendamentos para seu atendimento cortesia!`);
    }
  }

  return suggestions.length > 0 ? pickRandom(suggestions) : null;
}

// =============================================
// MENSAGENS DE CONFIRMAÇÃO DE AGENDAMENTO
// =============================================

export interface AppointmentConfirmationData {
  serviceName: string;
  barberName: string;
  dateTime: Date;
  price?: number;
  clientName?: string;
  isReschedule?: boolean;
}

export function buildAppointmentConfirmation(data: AppointmentConfirmationData): string {
  const { serviceName, barberName, dateTime, price, clientName, isReschedule } = data;

  const dateStr = formatFriendlyDateTime(dateTime);
  const priceStr = price ? ` por ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(price)}` : "";

  const templates = isReschedule
    ? [
        `${getConfirmation()} Remarquei seu ${serviceName} com ${barberName} para ${dateStr}${priceStr}.`,
        `Pronto! Seu horario foi alterado: ${serviceName} com ${barberName}, ${dateStr}${priceStr}.`,
        `Feito! Remarcado ${serviceName} - ${barberName} - ${dateStr}${priceStr}.`,
      ]
    : [
        `${getConfirmation()} Agendado ${serviceName} com ${barberName}, ${dateStr}${priceStr}.`,
        `Pronto! ${serviceName} marcado com ${barberName} para ${dateStr}${priceStr}.`,
        `Feito! Seu ${serviceName} esta confirmado: ${barberName}, ${dateStr}${priceStr}.`,
        `Show! Deixei tudo pronto: ${serviceName} com ${barberName}, ${dateStr}${priceStr}.`,
      ];

  let message = pickRandom(templates);

  if (clientName) {
    const firstName = clientName.split(" ")[0];
    message = message.replace("Seu", `${firstName}, seu`);
  }

  return message;
}

// =============================================
// MENSAGENS DE CANCELAMENTO
// =============================================

export function buildCancellationMessage(serviceName: string, reason?: string): string {
  const templates = [
    `Cancelamento feito! ${reason ? `Entendo que ${reason}. ` : ""}Quando quiser remarcar, e so me chamar!`,
    `Pronto, cancelei o ${serviceName}. ${reason ? `(${reason}) ` : ""}Espero te ver em breve!`,
    `Cancelado com sucesso! ${reason ? reason : "Sem problemas!"} Qualquer coisa, estou aqui.`,
  ];

  return pickRandom(templates);
}

// =============================================
// LEMBRETES AMIGÁVEIS
// =============================================

export function buildFriendlyReminder(data: {
  serviceName: string;
  barberName: string;
  dateTime: Date;
  hoursAhead: number;
}): string {
  const { serviceName, barberName, dateTime, hoursAhead } = data;

  const timeStr = formatFriendlyTime(dateTime);

  if (hoursAhead <= 2) {
    return `Oi! So passando pra lembrar que seu ${serviceName} com ${barberName} e daqui a pouquinho, as ${timeStr}! Te esperamos 😊`;
  }

  if (hoursAhead <= 24) {
    const dateStr = formatFriendlyDateTime(dateTime);
    return `E ai! Lembrando que amanha voce tem ${serviceName} com ${barberName}, ${dateStr}. Te aguardamos!`;
  }

  return `Oi! Lembrando do seu agendamento: ${serviceName} com ${barberName}, ${formatFriendlyDateTime(dateTime)}. Qualquer coisa e so avisar!`;
}

// =============================================
// EXPORT HELPERS UTILITIES
// =============================================

export const humanizationHelpers = {
  getTimeOfDay,
  getWeekdayType,
  getTimeGreeting,
  getWeekdayContext,
  getConfirmation,
  getUnderstanding,
  getWaiting,
  getApology,
  getEmpathy,
  getMoreHelp,
  getGoodbye,
  getSectorEmoji,
  buildPersonalizedGreeting,
  humanizeResponse,
  detectClientTone,
  getResponseForTone,
  formatFriendlyDate,
  formatFriendlyTime,
  formatFriendlyDateTime,
  buildPersonalizedSuggestion,
  buildAppointmentConfirmation,
  buildCancellationMessage,
  buildFriendlyReminder,
  pickRandom,
};
