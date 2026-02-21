import { FormEvent, useState } from "react";
import { ShieldCheck, Sparkles, Workflow } from "lucide-react";
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
    <div className="relative grid min-h-screen items-center justify-center p-4 sm:p-6 md:p-8 overflow-hidden bg-background">
      {/* Background ambient effects - more sophisticated gradients */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] h-[500px] w-[500px] rounded-full bg-gradient-to-br from-green-500/20 to-emerald-600/5 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[-10%] -right-[10%] h-[600px] w-[600px] rounded-full bg-gradient-to-tl from-emerald-500/10 to-teal-900/5 blur-[100px] mix-blend-screen dark:from-emerald-600/15" />
      </div>

      <div className="absolute top-6 right-6 z-20">
        <ThemeToggle />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-[1100px] gap-8 lg:grid-cols-[1.1fr_0.9fr] items-center">
        {/* Left panel — Hero & Info (Premium layout) */}
        <section className="hidden flex-col justify-center lg:flex p-6 h-full">
          <div className="mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-600 dark:text-green-400 backdrop-blur-sm shadow-sm transition-all hover:bg-green-500/15">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Plataforma WeberServicos</span>
            </div>
            <h1 className="mt-6 max-w-[480px] text-4xl font-extrabold tracking-tight text-foreground lg:text-5xl leading-[1.15]">
              O painel que centraliza <span className="bg-gradient-to-r from-green-500 to-emerald-500 bg-clip-text text-transparent">seus agentes de IA.</span>
            </h1>
            <p className="mt-5 max-w-md text-base text-muted-foreground leading-relaxed">
              Acesse serviços, consulte suas NF-es, gerencie seus agendamentos e interaja com os nossos assistentes inteligentes de forma simples e rápida.
            </p>
          </div>

          <div className="grid gap-4 mt-auto">
            <div className="group flex items-start gap-4 rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-md transition-all hover:bg-card hover:shadow-md dark:hover:border-green-500/30">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-500/10 text-green-600 dark:text-green-400 transition-colors group-hover:bg-green-500/20">
                <Workflow className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-foreground">Sua Central de Inteligência</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">Tenha em suas mãos o poder da IA para automatizar tarefas do seu dia a dia e ganhar tempo no que importa.</p>
              </div>
            </div>
            <div className="group flex items-start gap-4 rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-md transition-all hover:bg-card hover:shadow-md dark:hover:border-green-500/30">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-500/10 text-green-600 dark:text-green-400 transition-colors group-hover:bg-green-500/20">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-foreground">Acesso Seguro & Simplificado</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">Tudo que você precisa em um ambiente unificado, rápido e totalmente protegido para sua tranquilidade.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Right panel — Login form */}
        <Card className="rounded-[2.5rem] border-border/40 bg-card/80 backdrop-blur-xl shadow-2xl xl:p-4">
          <CardHeader className="space-y-4 pt-8 text-center sm:pt-10">
            <div className="mx-auto flex w-fit items-center justify-center rounded-3xl border-2 border-green-500/20 bg-background/50 px-8 py-3 shadow-[0_4px_30px_rgba(34,197,94,0.05)]">
              <span className="text-3xl sm:text-4xl font-mono font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-emerald-400 tracking-tight">
                {"<RW />"}
              </span>
            </div>
            <div className="space-y-1.5">
              <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">Bem-vindo(a) de volta</CardTitle>
              <CardDescription className="text-[15px]">Acesse com suas crendenciais autorizadas.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pb-8 sm:pb-10">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="login-email" className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 pl-1">
                  Email Corporativo
                </label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="usuario@empresa.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-xl bg-background/50 text-base"
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between pl-1">
                  <label htmlFor="login-password" className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                    Senha de Acesso
                  </label>
                  {/* Future integration: forgot password link */}
                </div>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl bg-background/50 text-base font-medium tracking-widest placeholder:tracking-normal"
                  minLength={8}
                  required
                />
              </div>

              {notice ? (
                <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-green-500/25 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-600 dark:text-green-400">
                  <div className="flex items-start justify-between gap-3">
                    <span className="leading-snug">{notice}</span>
                    {onDismissNotice ? (
                      <button
                        type="button"
                        onClick={onDismissNotice}
                        className="mt-0.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold text-green-600/80 transition hover:bg-green-500/15 hover:text-green-500 dark:text-green-400/80 dark:hover:bg-green-400/10 dark:hover:text-green-300"
                      >
                        Ok, fechar
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                  {error}
                </div>
              ) : null}

              <Button type="submit" className="h-12 w-full text-base font-semibold shadow-md active:scale-[0.98] transition-transform" disabled={loading}>
                {loading ? "Autenticando..." : "Acessar Painel"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
