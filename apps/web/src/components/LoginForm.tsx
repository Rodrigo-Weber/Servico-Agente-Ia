import { FormEvent, useState } from "react";
import { ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { api } from "../api";
import { AuthSession } from "../types";
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
    <div className="relative grid min-h-screen items-center p-4 sm:p-6 md:p-8">
      {/* Background effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-[10%] h-72 w-72 rounded-full bg-green-500/10 blur-[100px]" />
        <div className="absolute bottom-[-80px] right-[15%] h-64 w-64 rounded-full bg-emerald-500/8 blur-[80px]" />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left panel — Info */}
        <section className="glass-card hidden rounded-3xl p-7 lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-400">
              <Sparkles className="h-3.5 w-3.5" />
              Plataforma WeberServicos
            </div>
            <h1 className="mt-5 max-w-md text-3xl font-bold leading-tight text-white xl:text-4xl">
              Centralize seus agentes de IA em um painel elegante e direto.
            </h1>
            <p className="mt-4 max-w-lg text-sm text-white/40">
              NF-e, agendamento de barbearia e novos servicos em uma plataforma unica para sua empresa.
            </p>
          </div>

          <div className="mt-10 grid gap-3">
            <div className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <Workflow className="mt-0.5 h-5 w-5 text-green-400" />
              <div>
                <p className="text-sm font-semibold text-white/90">Fluxos por tipo de negocio</p>
                <p className="text-xs text-white/35">Cada empresa acessa telas e processos do seu servico contratado.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-green-400" />
              <div>
                <p className="text-sm font-semibold text-white/90">Operacao segura e rastreavel</p>
                <p className="text-xs text-white/35">Monitoramento continuo com historico completo das automacoes da empresa.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Right panel — Login form */}
        <Card className="rounded-3xl">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-[0_0_25px_rgba(34,197,94,0.3)]">
              <span className="font-mono text-sm font-bold text-white">{"<RW />"}</span>
            </div>
            <CardTitle className="text-2xl">Entrar no WeberServicos</CardTitle>
            <CardDescription>Acesse com as credenciais da sua conta corporativa.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="login-email" className="text-xs font-semibold uppercase tracking-wide text-white/40">
                  Email
                </label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="email@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {notice ? (
                <div className="rounded-xl border border-green-500/25 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-400">
                  <div className="flex items-center justify-between gap-2">
                    <span>{notice}</span>
                    {onDismissNotice ? (
                      <button
                        type="button"
                        onClick={onDismissNotice}
                        className="rounded-md px-2 py-0.5 text-xs text-green-400/80 transition hover:bg-green-500/15 hover:text-green-300"
                      >
                        Ok
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="login-password" className="text-xs font-semibold uppercase tracking-wide text-white/40">
                  Senha
                </label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>

              {error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
              ) : null}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Entrando..." : "Entrar"}
              </Button>

              <div className="space-y-1.5 text-center">
                <p className="text-xs text-white/30">Nao possui acesso? Solicite ao administrador da sua empresa.</p>
                <a href="/apresentacao" className="text-xs font-semibold text-green-400 hover:text-green-300 hover:underline">
                  Ver apresentacao da plataforma
                </a>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
