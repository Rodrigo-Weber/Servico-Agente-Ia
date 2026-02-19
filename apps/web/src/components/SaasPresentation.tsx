import {
  ArrowRight,
  Bot,
  Building2,
  FileText,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { Button } from "./ui/Button";

interface SaasPresentationProps {
  onEnterPlatform: () => void;
}

const valueCards = [
  {
    icon: FileText,
    title: "NF-e em fluxo continuo",
    description: "Importacao por XML e consulta DF-e com historico centralizado por empresa.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp como canal oficial",
    description: "Atendimento, notificacoes e automacoes com rastreabilidade ponta a ponta.",
  },
  {
    icon: Bot,
    title: "IA orientada ao negocio",
    description: "Prompts globais e por empresa para respostas coerentes com cada operacao.",
  },
];

const modules = [
  {
    title: "Painel Admin",
    text: "Controle de empresas, prompts, sessao WhatsApp e monitoramento global.",
  },
  {
    title: "Painel Empresa",
    text: "Gestao de certificado A1, acompanhamento de NF-es e status do sync.",
  },
  {
    title: "Motor de Jobs",
    text: "Execucao recorrente de sincronizacao com cooldown e politicas operacionais.",
  },
  {
    title: "Outbound Inteligente",
    text: "Fila de envio com retentativa, limite por escopo e telemetria de entrega.",
  },
];

const steps = [
  "Cadastro da empresa e dos numeros autorizados.",
  "Upload do certificado A1 para consultas fiscais seguras.",
  "IA interpreta mensagens, importa XMLs e responde automaticamente.",
  "Scheduler monitora novas notas e dispara notificacoes para o time.",
];

export function SaasPresentation({ onEnterPlatform }: SaasPresentationProps) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#071521] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-36 left-[8%] h-80 w-80 rounded-full bg-green-400/20 blur-3xl" />
        <div className="absolute top-40 right-[6%] h-72 w-72 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="absolute bottom-[-120px] left-1/2 h-96 w-[32rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl" />
      </div>

      <main className="relative mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8 md:px-8 md:py-12">
        <section className="overflow-hidden rounded-[2rem] border border-white/15 bg-gradient-to-br from-green-500/20 via-slate-900/70 to-amber-500/15 p-6 shadow-[0_24px_80px_-30px_rgba(8,34,53,0.9)] md:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-200/25 bg-green-300/10 px-3 py-1 text-xs font-semibold text-green-100">
            <Sparkles className="h-3.5 w-3.5" />
            WeberServicos
          </div>

          <h1 className="mt-5 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-white md:text-5xl">
            Seu SaaS para operacao fiscal e atendimento inteligente em um unico cockpit.
          </h1>

          <p className="mt-4 max-w-3xl text-sm text-slate-200/90 md:text-base">
            Una importacao de NF-e, WhatsApp e IA em uma plataforma feita para escalar empresas com controle, velocidade e visibilidade.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" onClick={onEnterPlatform}>
              Entrar na Plataforma
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <a
              href="#modulos"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/25 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              Ver Modulos
            </a>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-green-100/70">Modelo</p>
              <p className="mt-2 text-2xl font-bold">Multiempresa</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-green-100/70">Canal</p>
              <p className="mt-2 text-2xl font-bold">WhatsApp + API</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-green-100/70">Core</p>
              <p className="mt-2 text-2xl font-bold">NF-e + IA</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {valueCards.map((item, index) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="enter-up rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-300/15 text-green-100">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-lg font-bold text-white">{item.title}</h2>
                <p className="mt-2 text-sm text-slate-200/80">{item.description}</p>
              </article>
            );
          })}
        </section>

        <section id="modulos" className="grid gap-6 rounded-[1.7rem] border border-white/10 bg-white/[0.03] p-6 md:grid-cols-[1.1fr_0.9fr] md:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
              <Workflow className="h-3.5 w-3.5" />
              Arquitetura de Operacao
            </div>
            <h3 className="mt-4 text-2xl font-extrabold text-white md:text-3xl">Tudo que seu SaaS entrega no dia a dia do cliente</h3>
            <p className="mt-3 text-sm text-slate-200/85">
              Do onboarding da empresa ate o envio proativo no WhatsApp, cada etapa foi desenhada para reduzir trabalho manual e aumentar previsibilidade operacional.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {modules.map((item) => (
                <div key={item.title} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-1.5 text-xs text-slate-300">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-green-100/15 bg-gradient-to-br from-green-500/15 to-emerald-600/10 p-5">
            <h4 className="text-lg font-bold text-white">Fluxo de valor</h4>
            <div className="mt-4 space-y-3">
              {steps.map((step, index) => (
                <div key={step} className="flex items-start gap-3">
                  <div className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-200/15 text-xs font-bold text-green-100">
                    {index + 1}
                  </div>
                  <p className="text-sm text-slate-200/90">{step}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3">
              <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Building2 className="h-4 w-4 text-green-100" />
                  Pronto para multiempresa
                </div>
                <p className="mt-1.5 text-xs text-slate-300">Separacao por empresa com controle de dados, regras e monitoramento individual.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-green-100" />
                  Operacao auditavel
                </div>
                <p className="mt-1.5 text-xs text-slate-300">Historico de jobs, mensagens e eventos para diagnostico rapido e escala segura.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 rounded-[1.7rem] border border-white/10 bg-gradient-to-r from-white/[0.06] via-white/[0.03] to-white/[0.06] p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
              <TrendingUp className="h-3.5 w-3.5" />
              Crescimento com controle
            </div>
            <h5 className="mt-3 text-2xl font-extrabold text-white">Apresentacao pronta para mostrar seu SaaS para novos clientes.</h5>
            <p className="mt-2 text-sm text-slate-200/80">Use esta tela como pitch comercial e entrada institucional da plataforma.</p>
          </div>
          <Button size="lg" onClick={onEnterPlatform} className="md:justify-self-end">
            Abrir Login
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </section>
      </main>
    </div>
  );
}

