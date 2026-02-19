import { AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import shotLogin from "./assets/saas-screens/01-login.png";
import shotDashboard from "./assets/saas-screens/02-dashboard.png";
import shotEmpresas from "./assets/saas-screens/03-empresas.png";
import shotMonitoramento from "./assets/saas-screens/04-monitoramento.png";
import shotIaWhatsapp from "./assets/saas-screens/05-ia-whatsapp.png";
import shotVisaoGeral from "./assets/saas-screens/06-visao-geral.png";

type Callout = {
  title: string;
  detail: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  delay: number;
  side?: "left" | "right";
  width?: number;
  color?: string;
};

type Slide = {
  image: string;
  badge: string;
  title: string;
  subtitle: string;
  callouts: Callout[];
};

const TITLE_FONT = "'Sora', 'Segoe UI', sans-serif";
const BODY_FONT = "'Manrope', 'Segoe UI', sans-serif";

const SLIDE_DURATION = 150;
const CALLOUT_HEIGHT = 96;

const slides: Slide[] = [
  {
    badge: "Tela Real | Login",
    title: "Entrada corporativa pronta para escalar",
    subtitle: "Fluxo objetivo para iniciar operação em segundos, com controle de sessão e perfil.",
    image: shotLogin,
    callouts: [
      {
        title: "Login por perfil",
        detail: "Cada usuário entra no contexto exato do serviço contratado.",
        x: 90,
        y: 220,
        targetX: 874,
        targetY: 378,
        delay: 8,
      },
      {
        title: "Segurança operacional",
        detail: "Sessão monitorada com expiração para reduzir risco de uso indevido.",
        x: 90,
        y: 390,
        targetX: 865,
        targetY: 434,
        delay: 22,
      },
      {
        title: "Acesso em um clique",
        detail: "Do login ao painel em segundos para acelerar onboarding e demonstração.",
        x: 90,
        y: 560,
        targetX: 900,
        targetY: 473,
        delay: 36,
      },
    ],
  },
  {
    badge: "Tela Real | Dashboard",
    title: "Visão executiva do negócio em tempo real",
    subtitle: "Indicadores e conexão do agente reunidos em um cockpit comercial.",
    image: shotDashboard,
    callouts: [
      {
        title: "KPIs instantâneos",
        detail: "Empresas, números autorizados e status WhatsApp visíveis no topo.",
        x: 70,
        y: 90,
        targetX: 452,
        targetY: 98,
        delay: 8,
      },
      {
        title: "Resumo por empresa",
        detail: "Lista operacional simplificada para leitura rápida no atendimento.",
        x: 90,
        y: 280,
        targetX: 428,
        targetY: 242,
        delay: 22,
      },
      {
        title: "Conexão do agente",
        detail: "Controle direto da sessão para manter continuidade do atendimento.",
        x: 1480,
        y: 300,
        targetX: 955,
        targetY: 252,
        delay: 36,
        side: "right",
        width: 330,
      },
    ],
  },
  {
    badge: "Tela Real | Empresas",
    title: "Gestão comercial e operacional no mesmo fluxo",
    subtitle: "Cadastro, seleção e configuração com baixa fricção para o time.",
    image: shotEmpresas,
    callouts: [
      {
        title: "Onboarding rápido",
        detail: "Criação de empresa com dados mínimos para começar a operar.",
        x: 70,
        y: 200,
        targetX: 468,
        targetY: 357,
        delay: 8,
      },
      {
        title: "Carteira centralizada",
        detail: "Empresas cadastradas em lista única para gestão de crescimento.",
        x: 70,
        y: 390,
        targetX: 763,
        targetY: 166,
        delay: 24,
      },
      {
        title: "Configuração ativa",
        detail: "Salvar ajustes por empresa mantendo padrão operacional.",
        x: 1490,
        y: 245,
        targetX: 1002,
        targetY: 407,
        delay: 38,
        side: "right",
        width: 330,
      },
    ],
  },
  {
    badge: "Tela Real | Monitoramento",
    title: "Saúde operacional com leitura imediata",
    subtitle: "Acompanhamento de jobs, mensagens e estado da operação em uma só visão.",
    image: shotMonitoramento,
    callouts: [
      {
        title: "Estado atualizado",
        detail: "O painel comunica status operacional logo na abertura da tela.",
        x: 70,
        y: 120,
        targetX: 426,
        targetY: 132,
        delay: 8,
      },
      {
        title: "Métricas de operação",
        detail: "Cards consolidados para priorizar ação sem navegação extra.",
        x: 70,
        y: 300,
        targetX: 449,
        targetY: 205,
        delay: 24,
      },
      {
        title: "Jobs globais",
        detail: "Histórico de execução para diagnóstico rápido e comunicação com cliente.",
        x: 1490,
        y: 320,
        targetX: 1020,
        targetY: 304,
        delay: 38,
        side: "right",
        width: 330,
      },
    ],
  },
  {
    badge: "Tela Real | IA e WhatsApp",
    title: "Automação comercial com IA aplicada ao canal principal",
    subtitle: "Sessão do WhatsApp, prompt e configurações operacionais no mesmo contexto.",
    image: shotIaWhatsapp,
    callouts: [
      {
        title: "Sessão controlada",
        detail: "Conectar e gerenciar WhatsApp sem sair da operação principal.",
        x: 70,
        y: 170,
        targetX: 452,
        targetY: 190,
        delay: 8,
      },
      {
        title: "Prompt global",
        detail: "Comportamento da IA padronizado para manter qualidade de resposta.",
        x: 1490,
        y: 180,
        targetX: 1003,
        targetY: 266,
        delay: 24,
        side: "right",
        width: 330,
      },
      {
        title: "Prompt específico",
        detail: "Personalização por empresa para adaptar linguagem e rotina de atendimento.",
        x: 1490,
        y: 360,
        targetX: 996,
        targetY: 479,
        delay: 38,
        side: "right",
        width: 330,
      },
      {
        title: "Configuração central",
        detail: "Chaves e parâmetros operacionais acessíveis em um bloco único.",
        x: 660,
        y: 820,
        targetX: 938,
        targetY: 610,
        delay: 50,
        width: 420,
      },
    ],
  },
  {
    badge: "Tela Real | Encerramento",
    title: "Pitch pronto: produto validado na sua própria operação",
    subtitle: "Demonstração direta do SaaS em uso real, com foco em valor comercial.",
    image: shotVisaoGeral,
    callouts: [
      {
        title: "Prova de operação",
        detail: "Tela real do seu sistema, não um mock estático de apresentação.",
        x: 90,
        y: 140,
        targetX: 450,
        targetY: 96,
        delay: 8,
      },
      {
        title: "Argumento de venda",
        detail: "Do login ao monitoramento, o fluxo mostra clareza para o cliente.",
        x: 90,
        y: 320,
        targetX: 949,
        targetY: 242,
        delay: 24,
      },
      {
        title: "Escala com controle",
        detail: "Módulos, IA e operação centralizados para crescer com previsibilidade.",
        x: 1480,
        y: 220,
        targetX: 1120,
        targetY: 96,
        delay: 38,
        side: "right",
        width: 340,
      },
    ],
  },
];

function ArrowAndCallout(props: { callout: Callout; index: number; frame: number }) {
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, props.frame - props.callout.delay);
  const reveal = spring({
    frame: localFrame,
    fps,
    config: { damping: 13, stiffness: 110, mass: 0.9 },
  });

  const fadeOut = interpolate(props.frame, [SLIDE_DURATION - 16, SLIDE_DURATION], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bubbleWidth = props.callout.width ?? 360;
  const side = props.callout.side ?? "left";
  const color = props.callout.color ?? "#63e6ff";
  const bubbleFloat = Math.sin((props.frame + props.index * 9) / 16) * 4;
  const bubbleOpacity = interpolate(reveal, [0, 1], [0, 1]) * fadeOut;
  const bubbleScale = interpolate(reveal, [0, 1], [0.82, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const anchorX = side === "right" ? props.callout.x : props.callout.x + bubbleWidth;
  const anchorY = props.callout.y + CALLOUT_HEIGHT * 0.54;
  const dx = props.callout.targetX - anchorX;
  const dy = props.callout.targetY - anchorY;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const lineGrowth = interpolate(reveal, [0.22, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lineOpacity = interpolate(reveal, [0.2, 1], [0, 0.96], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const endX = anchorX + dx * lineGrowth;
  const endY = anchorY + dy * lineGrowth;
  const pulseScale = 1 + 0.18 * Math.sin((props.frame + props.index * 11) / 8);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: props.callout.x,
          top: props.callout.y + bubbleFloat,
          width: bubbleWidth,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.42)",
          background: "rgba(6, 25, 40, 0.74)",
          backdropFilter: "blur(4px)",
          boxShadow: "0 14px 32px -18px rgba(0,0,0,0.75)",
          padding: "12px 14px 13px 14px",
          transform: `scale(${bubbleScale})`,
          transformOrigin: side === "right" ? "left center" : "right center",
          opacity: bubbleOpacity,
        }}
      >
        <div
          style={{
            fontFamily: TITLE_FONT,
            fontSize: 24,
            fontWeight: 700,
            lineHeight: 1.12,
            color: "#f5fbff",
            letterSpacing: -0.5,
          }}
        >
          {props.callout.title}
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: BODY_FONT,
            fontSize: 18,
            lineHeight: 1.25,
            color: "#d3ebf8",
          }}
        >
          {props.callout.detail}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: anchorX,
          top: anchorY,
          width: distance * lineGrowth,
          height: 2.4,
          borderRadius: 999,
          background: color,
          boxShadow: `0 0 12px ${color}`,
          transform: `rotate(${angleDeg}deg)`,
          transformOrigin: "0 50%",
          opacity: lineOpacity * fadeOut,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: endX - 7,
          top: endY - 7,
          width: 14,
          height: 14,
          background: color,
          clipPath: "polygon(0 50%, 100% 0, 100% 100%)",
          transform: `rotate(${angleDeg}deg) scale(${lineGrowth})`,
          transformOrigin: "center",
          opacity: lineOpacity * fadeOut,
          filter: "drop-shadow(0 0 8px rgba(99,230,255,0.75))",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: props.callout.targetX - 12,
          top: props.callout.targetY - 12,
          width: 24,
          height: 24,
          borderRadius: 999,
          border: "2px solid rgba(99,230,255,0.95)",
          background: "rgba(99,230,255,0.15)",
          boxShadow: "0 0 12px rgba(99,230,255,0.85)",
          transform: `scale(${pulseScale * lineGrowth})`,
          opacity: lineOpacity * fadeOut,
        }}
      />
    </>
  );
}

function SlideScene(props: { slide: Slide; index: number }) {
  const frame = useCurrentFrame();
  const inOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outOpacity = interpolate(frame, [SLIDE_DURATION - 14, SLIDE_DURATION], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sceneOpacity = inOpacity * outOpacity;
  const pan = interpolate(frame, [0, SLIDE_DURATION], [0, 18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const zoom = interpolate(frame, [0, SLIDE_DURATION], [1.01, 1.045], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const panX = props.index % 2 === 0 ? pan : -pan;
  const panY = props.index % 2 === 0 ? pan * 0.4 : -pan * 0.3;

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <Img
        src={props.slide.image}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: "center",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(4,12,20,0.76) 0%, rgba(4,12,20,0.18) 34%, rgba(4,12,20,0.26) 68%, rgba(4,12,20,0.82) 100%)",
        }}
      />

      <div style={{ position: "absolute", left: 48, right: 48, top: 40 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid rgba(119,240,255,0.5)",
            background: "rgba(23,189,233,0.2)",
            color: "#ddf7ff",
            fontFamily: BODY_FONT,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 0.2,
          }}
        >
          {props.slide.badge}
        </div>

        <h2
          style={{
            margin: "12px 0 0 0",
            fontFamily: TITLE_FONT,
            fontSize: 58,
            lineHeight: 1.04,
            color: "#ffffff",
            letterSpacing: -1.3,
            textShadow: "0 8px 24px rgba(0,0,0,0.52)",
          }}
        >
          {props.slide.title}
        </h2>
        <p
          style={{
            margin: "10px 0 0 0",
            fontFamily: BODY_FONT,
            fontSize: 30,
            lineHeight: 1.25,
            maxWidth: 1380,
            color: "#d3eaf7",
            textShadow: "0 8px 16px rgba(0,0,0,0.45)",
          }}
        >
          {props.slide.subtitle}
        </p>
      </div>

      {props.slide.callouts.map((callout, index) => (
        <ArrowAndCallout key={`${callout.title}-${index}`} callout={callout} index={index} frame={frame} />
      ))}

      <div
        style={{
          position: "absolute",
          right: 52,
          bottom: 34,
          fontFamily: BODY_FONT,
          fontSize: 18,
          color: "rgba(222, 241, 252, 0.86)",
          fontWeight: 700,
        }}
      >
        Pitch Comercial | Cena {props.index + 1}/{slides.length}
      </div>
    </AbsoluteFill>
  );
}

export function SaasPresentationRemotion() {
  return (
    <AbsoluteFill>
      {slides.map((slide, index) => (
        <Sequence key={`${slide.badge}-${index}`} from={index * SLIDE_DURATION} durationInFrames={SLIDE_DURATION}>
          <SlideScene slide={slide} index={index} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

