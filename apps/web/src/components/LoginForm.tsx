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

      <div className="absolute top-6 right-6 z-20">
        <ThemeToggle />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-[1100px] gap-8 lg:grid-cols-[1.1fr_0.9fr] items-center">
        {/* Left panel — Hero & Info (Premium layout) */}
        <section className="hidden flex-col justify-center lg:flex p-6 h-full enter-up">
          <div className="mb-12">
            <h1 className="mt-8 max-w-[500px] text-5xl font-extrabold tracking-tight text-foreground lg:text-5xl xl:text-6xl leading-[1.15]">
              O painel para gerir <span className="text-primary">sua operação</span>
            </h1>
            <p className="mt-6 max-w-md text-base text-muted-foreground leading-relaxed font-medium">
              Acesse serviços, consulte suas NF-es, gerencie seus agendamentos e interaja com os nossos assistentes inteligentes.
            </p>
          </div>

          <div className="grid gap-5 mt-auto">
            <div className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/50">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Workflow className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-foreground">Sua Central de Inteligência</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">Tenha em suas mãos o poder da IA para automatizar tarefas do seu dia a dia e ganhar tempo no que importa.</p>
              </div>
            </div>
            <div className="group flex items-start gap-4 rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-lg transition-all hover:bg-card hover:shadow-premium-card dark:hover:border-primary/30">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20 group-hover:scale-110 duration-300">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-foreground">Acesso Seguro & Simplificado</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">Tudo que você precisa em um ambiente unificado, rápido e totalmente protegido para sua tranquilidade.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Right panel — Login form */}
        <Card className="rounded-2xl border-border bg-card shadow-sm xl:p-6 enter-up" style={{ animationDelay: '0.1s' }}>
          <CardHeader className="space-y-4 pt-8 text-center sm:pt-10">
            <div className="mx-auto flex w-fit items-center justify-center rounded-xl border border-border bg-muted/50 px-6 py-2 shadow-sm">
              <span className="text-2xl font-mono font-extrabold text-foreground tracking-tight">
                {"<RW />"}
              </span>
            </div>
            <div className="space-y-2 mt-4">
              <CardTitle className="text-3xl font-bold tracking-tight">Bem-vindo(a)</CardTitle>
              <CardDescription className="text-base font-medium">Acesse com suas credenciais autorizadas.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pb-8 sm:pb-10">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="login-email" className="text-xs font-bold uppercase tracking-wider text-muted-foreground pl-1">
                  Email Corporativo
                </label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="usuario@empresa.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-xl bg-background/60 text-base shadow-sm focus:bg-background transition-all"
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between pl-1">
                  <label htmlFor="login-password" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Senha de Acesso
                  </label>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl bg-background/60 text-base font-medium tracking-widest placeholder:tracking-normal shadow-sm focus:bg-background transition-all"
                  minLength={8}
                  required
                />
              </div>

              {notice ? (
                <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm font-medium text-primary shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="leading-snug">{notice}</span>
                    {onDismissNotice ? (
                      <button
                        type="button"
                        onClick={onDismissNotice}
                        className="mt-0.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-primary/20 hover:text-primary dark:hover:bg-primary/20 text-primary/80"
                      >
                        Ok, fechar
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive shadow-sm">
                  {error}
                </div>
              ) : null}

              <Button type="submit" className="h-10 mt-2 w-full font-semibold transition-all" disabled={loading}>
                {loading ? "Autenticando..." : "Acessar Painel"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
