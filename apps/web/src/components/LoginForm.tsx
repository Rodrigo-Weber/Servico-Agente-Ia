import { FormEvent, useState } from "react";
import {
  ArrowRight,
  Bot,
  Lock,
  Mail,
  MessageSquare,
  Settings2,
  Shield,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import { AuthSession } from "../types";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface LoginFormProps {
  onLogin: (session: AuthSession) => void;
  notice?: string;
  onDismissNotice?: () => void;
}

const FEATURES = [
  {
    icon: Bot,
    title: "Agentes de IA",
    desc: "Assistentes inteligentes que operam 24/7 para automatizar processos do seu negócio.",
  },
  {
    icon: Settings2,
    title: "Automações",
    desc: "Fluxos automatizados que eliminam tarefas repetitivas e aumentam produtividade.",
  },
  {
    icon: MessageSquare,
    title: "Notificações WhatsApp",
    desc: "Alertas e comunicações instantâneas direto no WhatsApp dos seus clientes.",
  },
  {
    icon: Shield,
    title: "Segurança Total",
    desc: "Criptografia de ponta, multi-empresa e controle de acesso granular.",
  },
];

export function LoginForm({ onLogin, notice, onDismissNotice }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const session = await api.login(email, password);
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-125 h-125 rounded-full bg-primary/4 blur-[100px]" />
        <div className="absolute bottom-0 right-0 w-150 h-100 rounded-full bg-primary/3 blur-[120px]" />
      </div>

      {/* Theme toggle */}
      <div className="absolute top-5 right-5 z-20">
        <ThemeToggle />
      </div>

      {/* Main grid — info left, login right */}
      <div className="relative z-10 flex min-h-screen">
        {/* ── LEFT PANEL ── */}
        <section className="hidden lg:flex lg:w-[55%] xl:w-[56%] flex-col justify-between px-12 xl:px-20 py-14">
          {/* Top — Brand */}
          <div className="enter-up">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <span className="text-2xl font-black tracking-tight font-display text-foreground">
                WEF
              </span>
            </div>
          </div>

          {/* Middle — Hero + Features */}
          <div className="flex-1 flex flex-col justify-center -mt-8">
            <div className="enter-up stagger-1">
              <p className="inline-block rounded-full bg-primary/10 border border-primary/15 px-3.5 py-1 text-[11px] font-bold uppercase tracking-widest text-primary mb-6">
                Painel Inteligente
              </p>
              <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tight text-foreground leading-[1.1] font-display max-w-lg">
                Automatize.{" "}
                <span className="gradient-text">Conecte.</span>{" "}
                Escale.
              </h1>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md">
                Uma plataforma unificada com agentes de IA, automações e notificações via WhatsApp para gerenciar sua operação com inteligência.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-10">
              {FEATURES.map((feat, i) => (
                <div
                  key={feat.title}
                  className={`group relative rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm p-4 transition-all duration-300 hover:bg-card/70 hover:border-primary/20 hover:shadow-lg enter-up stagger-${i + 2}`}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3 transition-transform duration-300 group-hover:scale-110">
                    <feat.icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground mb-1">{feat.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{feat.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom — Footer */}
          <div className="enter-up stagger-6">
            <p className="text-xs text-muted-foreground/60">
              &copy; {new Date().getFullYear()} WEF — Todos os direitos reservados.
            </p>
          </div>
        </section>

        {/* ── RIGHT PANEL — Login ── */}
        <section className="flex w-full lg:w-[45%] xl:w-[44%] items-center justify-center px-6 sm:px-10 lg:px-14 py-10">
          <div className="w-full max-w-105 enter-up stagger-2">
            {/* Mobile brand */}
            <div className="flex items-center justify-center gap-2 mb-8 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <span className="text-2xl font-black tracking-tight font-display text-foreground">WEF</span>
            </div>

            {/* Login card */}
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl p-8 sm:p-10 shadow-lg">
              {/* Header */}
              <div className="text-center mb-8">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-primary/15 to-primary/5 border border-primary/20 shadow-sm">
                  <span className="text-xl font-mono font-black text-foreground tracking-tighter">
                    {"<W/>"}
                  </span>
                </div>
                <h2 className="text-2xl font-bold font-display text-foreground">
                  Bem-vindo de volta
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Entre com suas credenciais para continuar.
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label htmlFor="login-email" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground pl-0.5">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="seu@email.com.br"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 pl-10 rounded-xl bg-background/50 border-border/70 focus:bg-background transition-colors"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground pl-0.5">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pl-10 rounded-xl tracking-widest placeholder:tracking-normal bg-background/50 border-border/70 focus:bg-background transition-colors"
                      minLength={8}
                      required
                    />
                  </div>
                </div>

                {notice ? (
                  <div className="animate-scale-in rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
                    <div className="flex items-start justify-between gap-3">
                      <span className="leading-snug">{notice}</span>
                      {onDismissNotice ? (
                        <button
                          type="button"
                          onClick={onDismissNotice}
                          className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-primary/10"
                        >
                          Fechar
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div className="animate-scale-in rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
                    {error}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full rounded-xl font-bold text-sm mt-3 h-12 shadow-md hover:shadow-lg transition-shadow"
                  disabled={loading}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Entrando...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Acessar Painel
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  )}
                </Button>
              </form>
            </div>

            {/* Mobile features */}
            <div className="mt-8 lg:hidden">
              <div className="grid grid-cols-2 gap-2.5">
                {FEATURES.map((feat) => (
                  <div key={feat.title} className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card/30 backdrop-blur-sm px-3 py-2.5">
                    <feat.icon className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground">{feat.title}</span>
                  </div>
                ))}
              </div>
              <p className="text-center text-[10px] text-muted-foreground/50 mt-5">
                &copy; {new Date().getFullYear()} WEF
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
