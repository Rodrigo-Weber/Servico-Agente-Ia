/**
 * Templates de Empresa — Configurações pré-definidas por setor de negócio
 * para onboarding rápido sem precisar mexer em código.
 */

export interface TemplateService {
  name: string;
  description?: string;
  durationMinutes: number;
  price: number;
}

export interface TemplateWorkingHour {
  weekday: number; // 0=Dom, 1=Seg, ..., 6=Sab
  startTime: string;
  endTime: string;
}

export interface TemplateNfseDefaults {
  itemListaServico?: string;
  codigoTributarioMunicipio?: string;
  aliquotaIss?: number;
  descricaoPadrao?: string;
}

export interface CompanyTemplateDefinition {
  slug: string;
  name: string;
  description: string;
  aiType: "barber_booking" | "nfe_import" | "billing" | "restaurant_delivery" | "clinic_booking";
  bookingSector: string;
  icon: string;
  services: TemplateService[];
  workingHours: TemplateWorkingHour[];
  promptTemplate: string;
  nfseDefaults?: TemplateNfseDefaults;
}

/* ─── Definições dos Templates ─── */

export const COMPANY_TEMPLATES: CompanyTemplateDefinition[] = [
  {
    slug: "lava_jato",
    name: "Lava Jato",
    description: "Lavagem automotiva com agendamento via WhatsApp, NFS-e automática e programa de fidelidade.",
    aiType: "barber_booking",
    bookingSector: "car_wash",
    icon: "🚗",
    services: [
      { name: "Lavagem Simples", description: "Lavagem externa completa", durationMinutes: 30, price: 35 },
      { name: "Lavagem Completa", description: "Lavagem externa + interna + aspiração", durationMinutes: 60, price: 60 },
      { name: "Lavagem Premium", description: "Completa + cera cristalizadora + pretinho nos pneus", durationMinutes: 90, price: 100 },
      { name: "Polimento", description: "Polimento com máquina rotativa", durationMinutes: 120, price: 180 },
      { name: "Higienização Interna", description: "Limpeza profunda de estofados e tapetes", durationMinutes: 90, price: 150 },
      { name: "Lavagem de Motor", description: "Limpeza do compartimento do motor", durationMinutes: 45, price: 80 },
    ],
    workingHours: [
      { weekday: 1, startTime: "08:00", endTime: "18:00" },
      { weekday: 2, startTime: "08:00", endTime: "18:00" },
      { weekday: 3, startTime: "08:00", endTime: "18:00" },
      { weekday: 4, startTime: "08:00", endTime: "18:00" },
      { weekday: 5, startTime: "08:00", endTime: "18:00" },
      { weekday: 6, startTime: "08:00", endTime: "14:00" },
    ],
    promptTemplate: `Você é o assistente virtual de um lava jato profissional. Atende pelo WhatsApp com simpatia e eficiência.

Responsabilidades:
- Agendar serviços de lavagem automotiva
- Informar preços e duração dos serviços
- Confirmar e cancelar agendamentos
- Enviar recibos e notas fiscais
- Programa de fidelidade: a cada 10 lavagens, uma lavagem simples grátis

Tom: Profissional e amigável. Use emojis moderadamente (🚗 🧼 ✨).
Sempre confirme data, horário e tipo de serviço antes de agendar.
Quando o cliente perguntar sobre preços, liste todos os serviços disponíveis.`,
    nfseDefaults: {
      itemListaServico: "14.01",
      aliquotaIss: 0.05,
      descricaoPadrao: "Serviço de lavagem e conservação de veículos automotores",
    },
  },
  {
    slug: "barbearia",
    name: "Barbearia",
    description: "Barbearia com agendamento inteligente, recibos e fidelidade via WhatsApp.",
    aiType: "barber_booking",
    bookingSector: "barber",
    icon: "💈",
    services: [
      { name: "Corte Masculino", description: "Corte de cabelo masculino tradicional ou moderno", durationMinutes: 30, price: 40 },
      { name: "Barba", description: "Barba com navalha e toalha quente", durationMinutes: 20, price: 25 },
      { name: "Corte + Barba", description: "Combo corte de cabelo + barba completa", durationMinutes: 45, price: 55 },
      { name: "Platinado", description: "Descoloração com platinado completo", durationMinutes: 90, price: 120 },
      { name: "Sobrancelha", description: "Design de sobrancelha masculina", durationMinutes: 15, price: 15 },
      { name: "Corte Infantil", description: "Corte de cabelo para crianças até 12 anos", durationMinutes: 25, price: 30 },
    ],
    workingHours: [
      { weekday: 1, startTime: "09:00", endTime: "19:00" },
      { weekday: 2, startTime: "09:00", endTime: "19:00" },
      { weekday: 3, startTime: "09:00", endTime: "19:00" },
      { weekday: 4, startTime: "09:00", endTime: "19:00" },
      { weekday: 5, startTime: "09:00", endTime: "19:00" },
      { weekday: 6, startTime: "09:00", endTime: "15:00" },
    ],
    promptTemplate: `Você é o assistente virtual de uma barbearia. Atende pelo WhatsApp com estilo e profissionalismo.

Responsabilidades:
- Agendar serviços de corte, barba e tratamentos capilares
- Informar preços e horários disponíveis
- Confirmar e cancelar agendamentos
- Enviar recibos de atendimento
- Programa de fidelidade: a cada 10 cortes, um corte grátis

Tom: Descontraído e estiloso. Trate o cliente pelo nome quando possível.
Use emojis adequados (💈 ✂️ 🔥).`,
    nfseDefaults: {
      itemListaServico: "6.01",
      aliquotaIss: 0.05,
      descricaoPadrao: "Serviços de barbearia - corte, barba e tratamentos capilares",
    },
  },
  {
    slug: "clinica_estetica",
    name: "Clínica de Estética",
    description: "Clínica de estética com agendamento, lembretes e NFS-e automática.",
    aiType: "barber_booking",
    bookingSector: "clinic",
    icon: "💆",
    services: [
      { name: "Limpeza de Pele", description: "Limpeza de pele facial profunda", durationMinutes: 60, price: 120 },
      { name: "Peeling", description: "Peeling químico ou enzimático", durationMinutes: 45, price: 150 },
      { name: "Microagulhamento", description: "Tratamento com microagulhamento", durationMinutes: 60, price: 200 },
      { name: "Drenagem Linfática", description: "Drenagem linfática corporal", durationMinutes: 60, price: 100 },
      { name: "Massagem Relaxante", description: "Massagem relaxante corpo inteiro", durationMinutes: 60, price: 90 },
      { name: "Depilação a Laser", description: "Sessão de depilação a laser (área pequena)", durationMinutes: 30, price: 180 },
    ],
    workingHours: [
      { weekday: 1, startTime: "08:00", endTime: "18:00" },
      { weekday: 2, startTime: "08:00", endTime: "18:00" },
      { weekday: 3, startTime: "08:00", endTime: "18:00" },
      { weekday: 4, startTime: "08:00", endTime: "18:00" },
      { weekday: 5, startTime: "08:00", endTime: "18:00" },
      { weekday: 6, startTime: "08:00", endTime: "13:00" },
    ],
    promptTemplate: `Você é a assistente virtual de uma clínica de estética. Atende pelo WhatsApp com delicadeza e profissionalismo.

Responsabilidades:
- Agendar procedimentos estéticos
- Informar sobre tratamentos, preços e contraindicações básicas
- Confirmar e cancelar agendamentos
- Enviar recibos e notas fiscais
- Lembretes de retorno e manutenção

Tom: Profissional, empática e acolhedora. Use emojis suaves (💆 ✨ 🌸).
Oriente o cliente a consultar na primeira visita sobre alergias e contraindicações.`,
    nfseDefaults: {
      itemListaServico: "6.02",
      aliquotaIss: 0.05,
      descricaoPadrao: "Serviços de estética e tratamentos corporais",
    },
  },
  {
    slug: "pet_shop",
    name: "Pet Shop / Banho e Tosa",
    description: "Pet shop com agendamento de banho e tosa via WhatsApp.",
    aiType: "barber_booking",
    bookingSector: "generic",
    icon: "🐾",
    services: [
      { name: "Banho Pequeno Porte", description: "Banho para cães de pequeno porte (até 10kg)", durationMinutes: 45, price: 50 },
      { name: "Banho Médio Porte", description: "Banho para cães de médio porte (10-25kg)", durationMinutes: 60, price: 70 },
      { name: "Banho Grande Porte", description: "Banho para cães de grande porte (acima de 25kg)", durationMinutes: 75, price: 90 },
      { name: "Tosa Higiênica", description: "Tosa higiênica (patinhas, barriga e genital)", durationMinutes: 30, price: 40 },
      { name: "Tosa Completa", description: "Tosa na máquina ou tesoura corpo inteiro", durationMinutes: 60, price: 80 },
      { name: "Banho + Tosa", description: "Combo banho + tosa completa", durationMinutes: 90, price: 110 },
    ],
    workingHours: [
      { weekday: 1, startTime: "08:00", endTime: "18:00" },
      { weekday: 2, startTime: "08:00", endTime: "18:00" },
      { weekday: 3, startTime: "08:00", endTime: "18:00" },
      { weekday: 4, startTime: "08:00", endTime: "18:00" },
      { weekday: 5, startTime: "08:00", endTime: "18:00" },
      { weekday: 6, startTime: "08:00", endTime: "14:00" },
    ],
    promptTemplate: `Você é o assistente virtual de um pet shop. Atende pelo WhatsApp com carinho e atenção.

Responsabilidades:
- Agendar serviços de banho e tosa
- Informar preços por porte do animal  
- Confirmar e cancelar agendamentos
- Perguntar nome e porte do pet antes de agendar
- Enviar recibos de atendimento

Tom: Carinhoso e simpático. Use emojis de animais (🐾 🐶 🐱 🛁).
Sempre pergunte o nome do pet e se tem alguma recomendação especial.`,
    nfseDefaults: {
      itemListaServico: "6.04",
      aliquotaIss: 0.05,
      descricaoPadrao: "Serviços de banho, tosa e higiene animal",
    },
  },
  {
    slug: "oficina_mecanica",
    name: "Oficina Mecânica",
    description: "Oficina mecânica com agendamento de serviços, orçamentos e fidelidade.",
    aiType: "barber_booking",
    bookingSector: "generic",
    icon: "🔧",
    services: [
      { name: "Troca de Óleo", description: "Troca de óleo com filtro", durationMinutes: 30, price: 80 },
      { name: "Revisão Básica", description: "Revisão de freios, suspensão e filtros", durationMinutes: 120, price: 250 },
      { name: "Alinhamento + Balanceamento", description: "Alinhamento e balanceamento 4 rodas", durationMinutes: 60, price: 120 },
      { name: "Diagnóstico Eletrônico", description: "Scanner e diagnóstico do veículo", durationMinutes: 45, price: 100 },
      { name: "Troca de Pastilhas de Freio", description: "Troca de pastilhas dianteiras ou traseiras", durationMinutes: 60, price: 180 },
    ],
    workingHours: [
      { weekday: 1, startTime: "08:00", endTime: "18:00" },
      { weekday: 2, startTime: "08:00", endTime: "18:00" },
      { weekday: 3, startTime: "08:00", endTime: "18:00" },
      { weekday: 4, startTime: "08:00", endTime: "18:00" },
      { weekday: 5, startTime: "08:00", endTime: "18:00" },
      { weekday: 6, startTime: "08:00", endTime: "12:00" },
    ],
    promptTemplate: `Você é o assistente virtual de uma oficina mecânica. Atende pelo WhatsApp com profissionalismo e transparência.

Responsabilidades:
- Agendar serviços mecânicos
- Informar preços e estimativa de tempo
- Confirmar e cancelar agendamentos
- Enviar orçamentos e recibos
- Programa de fidelidade: a cada 5 serviços, diagnóstico eletrônico grátis

Tom: Profissional e objetivo. Use linguagem técnica de forma acessível.
Emojis: 🔧 🚗 ✅. Sempre informe que valores podem variar conforme o veículo.`,
    nfseDefaults: {
      itemListaServico: "14.01",
      aliquotaIss: 0.05,
      descricaoPadrao: "Serviços de mecânica e manutenção automotiva",
    },
  },
  {
    slug: "cobranca",
    name: "Gestão de Cobranças",
    description: "CRM inteligente de cobrança com lembretes automáticos via WhatsApp.",
    aiType: "billing",
    bookingSector: "generic",
    icon: "💰",
    services: [],
    workingHours: [],
    promptTemplate: `Você é o assistente de cobranças financeiras. Atende pelo WhatsApp com profissionalismo e empatia.

Responsabilidades:
- Informar sobre boletos pendentes e vencidos
- Enviar segunda via de boletos
- Negociar prazos quando possível
- Registrar promessas de pagamento

Tom: Profissional, firme mas empático. Nunca agressivo ou ameaçador.
Ofereça sempre a solução e facilite o pagamento.`,
  },
  {
    slug: "nfe_import",
    name: "Importação de NF-e",
    description: "Importação automática de Notas Fiscais Eletrônicas via SEFAZ DF-e.",
    aiType: "nfe_import",
    bookingSector: "generic",
    icon: "📄",
    services: [],
    workingHours: [],
    promptTemplate: `Você é o assistente fiscal inteligente. Ajuda empresas a gerenciar suas Notas Fiscais Eletrônicas via WhatsApp.

Responsabilidades:
- Mostrar resumo das NF-e importadas
- Listar notas com filtros (data, valor, emitente)
- Detalhar notas específicas com itens
- Importar notas detectadas pendentes
- Aceitar XML enviados como anexo

Tom: Técnico e preciso. Valores sempre formatados (R$ X.XXX,XX).
Informe sobre certificado A1 quando necessário.`,
  },
];

/**
 * Busca um template pelo slug
 */
export function getTemplateBySlug(slug: string): CompanyTemplateDefinition | undefined {
  return COMPANY_TEMPLATES.find((t) => t.slug === slug);
}

/**
 * Retorna todos os templates ativos para exibir no wizard
 */
export function getAvailableTemplates(): CompanyTemplateDefinition[] {
  return COMPANY_TEMPLATES;
}
