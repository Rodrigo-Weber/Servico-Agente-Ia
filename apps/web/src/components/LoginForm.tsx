import { FormEvent, useState } from "react";
import { ArrowRight, Lock, Mail, ShieldCheck, Sparkles, Workflow, Zap } from "lucide-react";
import { api } from "../api";
import { AuthSession } from "../types";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";

interface LoginFormProps {
  onLogin: (session: AuthSession) => void;
  notice?: string;
  onDismissNotice?: () => void;
}

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
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/3 rounded-full blur-[120px]" />
      </div>

      <div className="absolute top-5 right-5 z-20">
        <ThemeToggle />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center p-4 sm:p-6">
        <div className="mx-auto grid w-full max-w-[1100px] gap-12 lg:grid-cols-[1.15fr_0.85fr] items-center">

          {/* Left — Hero */}
          <section className="hidden lg:flex flex-col justify-center enter-up">
            <div className="mb-14">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary mb-6">
                <Sparkles className="h-3.5 w-3.5" />
                Plataforma de IA para Empresas
              </div>

              <h1 className="max-w-[480px] text-5xl font-extrabold tracking-tight text-foreground xl:text-[3.5rem] leading-[1.1] font-display">
                Gerencie sua operação com{" "}
                <span className="gradient-text">inteligência</span>
              </h1>
              <p className="mt-5 max-w-md text-base text-muted-foreground leading-relaxed">
                NFS-e automática, agendamentos inteligentes, cobranças e atendimento via WhatsApp — tudo em um painel unificado.
              </p>
            </div>

            <div className="grid gap-4">
              {[
                {
                  icon: Zap,
                  title: "Automação Inteligente",
                  description: "IA que entende seu negócio e automatiza atendimento, agendamento e emissão fiscal.",
                },
                {
                  icon: ShieldCheck,
                  title: "Seguro & Escalável",
                  description: "Multi-empresa com criptografia, NFS-e real e configuração sem código.",
                },
                {
                  icon: Workflow,
                  title: "WhatsApp Integrado",
                  description: "Seus clientes agendam, recebem notas fiscais e lembretes direto no WhatsApp.",
                },
              ].map((item, i) => (
                <div
                  key={item.title}
                  className={`group flex items-start gap-4 rounded-xl border border-border/60 bg-card/50 p-4.5 backdrop-blur-sm transition-all duration-300 hover:bg-card hover:border-primary/25 hover:shadow-soft enter-up stagger-${i + 1}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Right — Login */}
          <Card className="rounded-2xl border-border/60 bg-card/80 backdrop-blur-xl shadow-premium-card enter-up stagger-2">
            <CardHeader className="space-y-5 pt-8 text-center sm:pt-10">
              <div className="mx-auto flex w-fit items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 px-6 py-3 shadow-glow-sm">
                <span className="text-2xl font-mono font-black text-foreground tracking-tight">
                  {"<RW />"}
                </span>
              </div>
              <div className="space-y-2">
                <CardTitle className="text-2xl font-display">Bem-vindo de volta</CardTitle>
                <CardDescription className="text-sm">Acesse com suas credenciais para continuar.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pb-8 sm:pb-10">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="login-email" className="form-label pl-0.5">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="seu@email.com.br"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 pl-10 rounded-xl"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="login-password" className="form-label pl-0.5">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pl-10 rounded-xl tracking-widest placeholder:tracking-normal"
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
                  className="w-full rounded-xl font-bold text-sm mt-2 h-11"
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

              {/* Mobile-only features */}
              <div className="mt-8 lg:hidden border-t border-border pt-6">
                <p className="text-xs text-center text-muted-foreground mb-3 font-medium">
                  Plataforma de IA para Empresas
                </p>
                <div className="flex justify-center gap-6 text-muted-foreground/60">
                  <div className="flex flex-col items-center gap-1">
                    <Zap className="h-4 w-4" />
                    <span className="text-2xs">Automação</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="text-2xs">Segurança</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <Workflow className="h-4 w-4" />
                    <span className="text-2xs">WhatsApp</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
