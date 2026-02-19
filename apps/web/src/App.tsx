import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, UNAUTHORIZED_EVENT_NAME } from "./api";
import { AdminPanel } from "./components/AdminPanel";
import { BarberOwnerPanel } from "./components/BarberOwnerPanel";
import { BarberStaffPanel } from "./components/BarberStaffPanel";
import { CompanyPanel } from "./components/CompanyPanel";
import { LoginForm } from "./components/LoginForm";
import { SaasPresentation } from "./components/SaasPresentation";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { AuthSession } from "./types";

const STORAGE_KEY = "weber_servicos_auth";
const SESSION_FALLBACK_SECONDS = 60 * 60;

function getCurrentPathname(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  return window.location.pathname || "/";
}

function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;

    if (!parsed.user.serviceType) {
      parsed.user.serviceType = parsed.user.role === "company" ? "nfe_import" : null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const payloadBase64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, "=");
    const json = atob(padded);
    const payload = JSON.parse(json) as { exp?: number };

    if (typeof payload.exp !== "number") {
      return null;
    }

    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function formatSessionCountdown(seconds: number | null): string | undefined {
  if (seconds === null) {
    return undefined;
  }

  if (seconds <= 0) {
    return "Sessao expirando";
  }

  const totalMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `Sessao: ${Math.max(totalMinutes, 1)} min`;
  }

  if (minutes === 0) {
    return `Sessao: ${hours}h`;
  }

  return `Sessao: ${hours}h ${minutes}m`;
}

export default function App() {
  const [pathname, setPathname] = useState<string>(getCurrentPathname);
  const [session, setSession] = useState<AuthSession | null>(loadSession);
  const [activeView, setActiveView] = useState("dashboard");
  const [authNotice, setAuthNotice] = useState("");
  const [sessionRemainingSeconds, setSessionRemainingSeconds] = useState<number | null>(null);
  const logoutInProgressRef = useRef(false);

  const sessionExpiryMs = useMemo(() => {
    if (!session) return null;
    const tokenExpMs = decodeJwtExpMs(session.accessToken);
    if (tokenExpMs) return tokenExpMs;
    return Date.now() + SESSION_FALLBACK_SECONDS * 1000;
  }, [session]);

  const viewMeta = useMemo(() => {
    if (!session) {
      return {
        title: "WeberServicos",
        subtitle: "Plataforma de agentes IA para empresas",
      };
    }

    if (session.user.role === "admin") {
      const adminTitles: Record<string, { title: string; subtitle: string }> = {
        dashboard: {
          title: "WeberServicos",
          subtitle: "Controle total de operacao, empresas e atendimento via WhatsApp",
        },
        companies: {
          title: "Empresas",
          subtitle: "Cadastre, organize e gerencie cada operacao em minutos",
        },
        monitoring: {
          title: "Monitoramento",
          subtitle: "Acompanhe saude operacional, certificados e sincronizacoes em tempo real",
        },
        settings: {
          title: "IA e WhatsApp",
          subtitle: "Ajuste comportamento da IA e status da sessao principal",
        },
      };

      return adminTitles[activeView] ?? adminTitles.dashboard;
    }

    if (session.user.role === "barber") {
      const barberTitles: Record<string, { title: string; subtitle: string }> = {
        dashboard: {
          title: "Painel do Barbeiro",
          subtitle: "Atendimento do dia e agenda pessoal",
        },
        appointments: {
          title: "Minha Agenda",
          subtitle: "Gerencie status dos agendamentos",
        },
        services: {
          title: "Servicos",
          subtitle: "Consulte valores e duracoes dos servicos ativos",
        },
      };

      return barberTitles[activeView] ?? barberTitles.dashboard;
    }

    if (session.user.serviceType === "barber_booking") {
      const barberCompanyTitles: Record<string, { title: string; subtitle: string }> = {
        dashboard: {
          title: "Painel da Barbearia",
          subtitle: "Resumo de servicos, barbeiros e agenda",
        },
        barbers: {
          title: "Barbeiros",
          subtitle: "Cadastre profissionais e grade de horarios",
        },
        services: {
          title: "Servicos",
          subtitle: "Defina valores, duracao e responsavel",
        },
        appointments: {
          title: "Agendamentos",
          subtitle: "Controle atendimentos e status em tempo real",
        },
        settings: {
          title: "Atendimento IA",
          subtitle: "Comandos e comportamento do agente no WhatsApp",
        },
      };

      return barberCompanyTitles[activeView] ?? barberCompanyTitles.dashboard;
    }

    const nfeCompanyTitles: Record<string, { title: string; subtitle: string }> = {
      dashboard: {
        title: "Painel da Empresa",
        subtitle: "Resumo de importacoes e movimentacao fiscal da operacao",
      },
      nfes: {
        title: "Notas Fiscais",
        subtitle: "Consulte detalhes, valores e situacao das NF-e importadas",
      },
      monitoring: {
        title: "Monitoramento",
        subtitle: "Acompanhe certificado e importacoes em tempo real",
      },
      settings: {
        title: "Certificado A1",
        subtitle: "Gerencie o certificado para sincronizacao e importacao automatica",
      },
    };

    return nfeCompanyTitles[activeView] ?? nfeCompanyTitles.dashboard;
  }, [activeView, session]);

  const clearLocalSession = useCallback((notice?: string) => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setActiveView("dashboard");
    setSessionRemainingSeconds(null);
    if (notice) {
      setAuthNotice(notice);
    }
  }, []);

  const forceLogout = useCallback(
    async (notice?: string, revokeRemoteSession = true) => {
      if (logoutInProgressRef.current) {
        return;
      }

      logoutInProgressRef.current = true;
      try {
        if (revokeRemoteSession && session?.refreshToken) {
          try {
            await api.logout(session.refreshToken);
          } catch {
            // ignora erro remoto de logout para nao bloquear encerramento local.
          }
        }
      } finally {
        clearLocalSession(notice);
        logoutInProgressRef.current = false;
      }
    },
    [clearLocalSession, session],
  );

  useEffect(() => {
    const onPopState = () => setPathname(getCurrentPathname());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      if (!session) {
        return;
      }

      const customEvent = event as CustomEvent<{ message?: string }>;
      const message = customEvent.detail?.message || "Sua sessao expirou. Entre novamente para continuar.";
      void forceLogout(message, false);
    };

    window.addEventListener(UNAUTHORIZED_EVENT_NAME, onUnauthorized as EventListener);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT_NAME, onUnauthorized as EventListener);
  }, [forceLogout, session]);

  useEffect(() => {
    if (!session || !sessionExpiryMs) {
      setSessionRemainingSeconds(null);
      return;
    }

    const syncRemaining = () => {
      const remaining = Math.max(0, Math.floor((sessionExpiryMs - Date.now()) / 1000));
      setSessionRemainingSeconds(remaining);

      if (remaining <= 0) {
        void forceLogout("Sessao expirada por seguranca. Faca login novamente.", false);
      }
    };

    syncRemaining();
    const timer = window.setInterval(syncRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [forceLogout, session, sessionExpiryMs]);

  function handleLogin(newSession: AuthSession) {
    setAuthNotice("");
    setSession(newSession);
    setActiveView("dashboard");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
  }

  async function handleLogout() {
    await forceLogout(undefined, true);
  }

  function navigate(to: string) {
    if (typeof window === "undefined") {
      return;
    }

    if (window.location.pathname === to) {
      return;
    }

    window.history.pushState({}, "", to);
    setPathname(to);
  }

  if (pathname === "/apresentacao") {
    return <SaasPresentation onEnterPlatform={() => navigate("/")} />;
  }

  if (!session) {
    return <LoginForm onLogin={handleLogin} notice={authNotice} onDismissNotice={() => setAuthNotice("")} />;
  }

  return (
    <DashboardLayout
      session={session}
      onLogout={handleLogout}
      title={viewMeta.title}
      subtitle={viewMeta.subtitle}
      activeView={activeView}
      onNavigate={setActiveView}
      sessionCountdownLabel={formatSessionCountdown(sessionRemainingSeconds)}
    >
      {session.user.role === "admin" ? <AdminPanel token={session.accessToken} activeView={activeView} /> : null}
      {session.user.role === "company" && session.user.serviceType === "nfe_import" ? (
        <CompanyPanel token={session.accessToken} activeView={activeView} />
      ) : null}
      {session.user.role === "company" && session.user.serviceType === "barber_booking" ? (
        <BarberOwnerPanel token={session.accessToken} activeView={activeView} />
      ) : null}
      {session.user.role === "barber" ? <BarberStaffPanel token={session.accessToken} activeView={activeView} /> : null}
    </DashboardLayout>
  );
}
