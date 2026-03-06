import { useEffect, useState, useCallback } from "react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Legend,
    PieChart,
    Pie,
    Cell,
} from "recharts";
import { api } from "../../api";
import type { AuthSession, OwnerDashboardSummary } from "../../types";
import { SkeletonDashboard } from "../ui/Skeleton";
import {
    TrendingUp,
    MessageSquare,
    CalendarDays,
    FileText,
    Wallet,
    AlertOctagon,
    Gauge,
    RefreshCw,
    ArrowUpRight,
    ArrowDownRight,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatMoney(value: number): string {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(value);
}

function formatNum(n: number): string {
    return n.toLocaleString("pt-BR");
}

function useIsMobile(breakpoint = 640): boolean {
    const [mobile, setMobile] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
        const handler = (e: MediaQueryListEvent | MediaQueryList) => setMobile(e.matches);
        handler(mq);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, [breakpoint]);
    return mobile;
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

interface KpiCardProps {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string | number;
    detail?: string;
    accent?: string;
    trend?: "up" | "down" | "neutral";
}

function KpiCard({ icon: Icon, label, value, detail, accent = "bg-muted", trend }: KpiCardProps) {
    return (
        <div className="stat-card group relative overflow-hidden rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-soft transition-all duration-300 hover:shadow-soft-lg hover:-translate-y-0.5 enter-up">
            <div className="flex items-center justify-between">
                <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${accent} transition-transform group-hover:scale-110 duration-300`}>
                    <Icon className="h-4 w-4" />
                </div>
                {trend && trend !== "neutral" && (
                    <div className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${trend === "up" ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"}`}>
                        {trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    </div>
                )}
            </div>
            <div className="mt-3">
                <p className="font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">{value}</p>
                <p className="mt-0.5 text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 truncate">{label}</p>
                {detail && <p className="mt-0.5 text-[10px] sm:text-[11px] text-muted-foreground truncate">{detail}</p>}
            </div>
        </div>
    );
}

// ─── Usage Meter ─────────────────────────────────────────────────────────────

interface UsageMeterProps {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    current: number;
    limit: number;
}

function UsageMeter({ icon: Icon, label, current, limit }: UsageMeterProps) {
    const pct = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
    const isOver = limit > 0 && current > limit;
    const overCount = isOver ? current - limit : 0;

    const barColor = isOver
        ? "bg-red-500"
        : pct >= 80
            ? "bg-yellow-500"
            : "bg-green-500";

    const textColor = isOver
        ? "text-red-400"
        : pct >= 80
            ? "text-yellow-400"
            : "text-green-400";

    if (limit === 0) {
        return (
            <div className="rounded-xl border border-border/50 bg-card p-3 sm:p-4 shadow-soft enter-up">
                <div className="flex items-center gap-2.5">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 truncate">{label}</p>
                        <p className="text-base sm:text-lg font-bold text-foreground">{formatNum(current)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 sm:px-2.5 py-0.5 text-[9px] sm:text-[10px] font-semibold text-muted-foreground uppercase">Ilimitado</span>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-border/50 bg-card p-3 sm:p-4 shadow-soft enter-up">
            <div className="flex items-center gap-2 sm:gap-2.5">
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isOver ? "bg-red-500/20" : "bg-muted"}`}>
                    <Icon className={`h-4 w-4 ${isOver ? "text-red-400" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 truncate">{label}</p>
                    <div className="flex items-baseline gap-1 sm:gap-1.5">
                        <span className={`text-base sm:text-lg font-bold ${textColor}`}>{formatNum(current)}</span>
                        <span className="text-[10px] sm:text-xs text-muted-foreground">/ {formatNum(limit)}</span>
                    </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 sm:px-2.5 py-0.5 text-[9px] sm:text-[10px] font-bold uppercase ${isOver ? "bg-red-500/20 text-red-400" : pct >= 80 ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"}`}>
                    {isOver ? `+${formatNum(overCount)}` : `${Math.round(pct)}%`}
                </span>
            </div>
            <div className="mt-2.5 sm:mt-3 h-1.5 sm:h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            {isOver && (
                <p className="mt-1.5 sm:mt-2 text-[10px] sm:text-[11px] font-semibold text-red-400">
                    Limite excedido em {formatNum(overCount)} {label.toLowerCase().includes("mensag") ? "mensagem(ns)" : "nota(s)"}
                </p>
            )}
        </div>
    );
}

// ─── Custom Tooltip ─────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-border bg-card/95 backdrop-blur-sm px-3 py-2 shadow-lg text-xs">
            <p className="font-semibold text-foreground mb-1">{label}</p>
            {payload.map((entry, i) => (
                <div key={i} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                    <span className="text-muted-foreground">{entry.name}:</span>
                    <span className="font-bold text-foreground">{formatNum(entry.value)}</span>
                </div>
            ))}
        </div>
    );
}

// ─── Chart Wrapper ──────────────────────────────────────────────────────────

function ChartCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={`rounded-xl border border-border/50 bg-card p-4 sm:p-6 shadow-soft transition-all duration-300 hover:shadow-soft-lg enter-up ${className}`}>
            <h3 className="mb-3 sm:mb-4 text-xs sm:text-sm font-semibold text-foreground">{title}</h3>
            {children}
        </div>
    );
}

// ─── Pie colors ─────────────────────────────────────────────────────────────

const PIE_COLORS = ["#60a5fa", "#34d399", "#f87171", "#818cf8", "#fbbf24", "#f472b6"];

// ─── Main Component ──────────────────────────────────────────────────────────

interface OwnerDashboardProps {
    session: AuthSession;
    token: string;
}

const CHART_TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 11 };
const CHART_MOBILE_TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 9 };

export function OwnerDashboard({ session, token }: OwnerDashboardProps) {
    const [summary, setSummary] = useState<OwnerDashboardSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const isMobile = useIsMobile();

    const loadData = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const data = await api.getOwnerDashboard(token);
            setSummary(data);
        } catch (err) {
            console.error("Error loading owner dashboard", err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [token]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    // Auto-refresh a cada 5 minutos
    useEffect(() => {
        const interval = setInterval(() => void loadData(true), 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [loadData]);

    if (loading || !summary) return <SkeletonDashboard />;

    const st = summary.totals;
    const serviceType = session.user.serviceType;
    const tickStyle = isMobile ? CHART_MOBILE_TICK_STYLE : CHART_TICK_STYLE;
    const chartHeight = isMobile ? 180 : 240;

    // Dados para gráfico de distribuição de mensagens (pie)
    const messagePieData = [
        { name: "Recebidas", value: summary.messagesPerDay.reduce((s, d) => s + (d.in ?? 0), 0) },
        { name: "Enviadas", value: summary.messagesPerDay.reduce((s, d) => s + (d.out ?? 0), 0) },
    ].filter(d => d.value > 0);

    return (
        <div className="space-y-5 sm:space-y-8">
            {/* Welcome header */}
            <div className="rounded-xl border border-border/40 bg-linear-to-r from-primary/5 via-transparent to-primary/5 p-4 sm:p-6 shadow-soft enter-up">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xl sm:text-2xl shrink-0">
                            {serviceType === "barber_booking" ? "📅" : serviceType === "nfe_import" ? "📄" : serviceType === "billing" ? "💰" : "📊"}
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-display text-lg sm:text-xl lg:text-2xl font-bold text-foreground truncate">
                                {serviceType === "barber_booking"
                                    ? "Visão Geral — Agendamentos"
                                    : serviceType === "nfe_import"
                                        ? "Visão Geral — NF-e Import"
                                        : serviceType === "billing"
                                            ? "Visão Geral — Cobranças"
                                            : "Visão Geral da Operação"}
                            </h2>
                            <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground/80 truncate">
                                {new Date(summary.generatedAt).toLocaleString("pt-BR", {
                                    dateStyle: isMobile ? "short" : "full",
                                    timeStyle: "short",
                                })}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => void loadData(true)}
                        disabled={refreshing}
                        className="shrink-0 grid h-9 w-9 place-items-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-all hover:text-foreground hover:border-primary/30 hover:bg-primary/5 active:scale-95 disabled:opacity-50"
                        title="Atualizar dados"
                    >
                        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    </button>
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
                {serviceType === "billing" || !serviceType ? (
                    <>
                        <KpiCard
                            icon={Wallet}
                            label="A Receber (Total)"
                            value={formatMoney(st.pendingBillingAmount)}
                            detail={`${st.pendingBillingCount} títulos`}
                            accent="bg-green-500/20"
                            trend="up"
                        />
                        <KpiCard
                            icon={AlertOctagon}
                            label="Cobranças Vencidas"
                            value={formatMoney(st.overdueBillingAmount)}
                            detail={`${st.overdueBillingCount} em atraso`}
                            accent="bg-red-500/20"
                            trend={st.overdueBillingCount > 0 ? "down" : "neutral"}
                        />
                    </>
                ) : null}

                {serviceType === "barber_booking" || !serviceType ? (
                    <KpiCard
                        icon={CalendarDays}
                        label="Agendamentos Hoje"
                        value={st.appointmentsToday}
                        detail={`${st.appointmentsMonth} no mês`}
                        accent="bg-blue-500/20"
                    />
                ) : null}

                {serviceType === "nfe_import" || !serviceType ? (
                    <KpiCard
                        icon={FileText}
                        label="NF-es Importadas"
                        value={st.nfesImported}
                        detail="Últimos 30 dias"
                        accent="bg-purple-500/20"
                    />
                ) : null}

                <KpiCard
                    icon={MessageSquare}
                    label="Mensagens Enviadas"
                    value={st.messagesOut}
                    detail="Últimas 24h"
                    accent="bg-yellow-500/20"
                />
                <KpiCard
                    icon={TrendingUp}
                    label="Taxa de Resposta IA"
                    value={`${st.aiResponseRate}%`}
                    detail="Nos últimos 7 dias"
                    accent="bg-teal-500/20"
                    trend={st.aiResponseRate >= 80 ? "up" : st.aiResponseRate >= 50 ? "neutral" : "down"}
                />
            </div>

            {/* ─── Contadores de Uso ──────────────── */}
            {summary.usage && (summary.usage.monthlyMessageLimit > 0 || summary.usage.monthlyNfseLimit > 0 || summary.usage.messagesThisMonth > 0 || summary.usage.nfseThisMonth > 0) && (
                <div className="space-y-3 enter-up">
                    <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-muted-foreground" />
                        <h3 className="text-xs sm:text-sm font-semibold text-foreground">Uso Mensal</h3>
                        <span className="ml-auto text-[10px] sm:text-[11px] text-muted-foreground">
                            {new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                        </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2">
                        <UsageMeter
                            icon={MessageSquare}
                            label="Mensagens enviadas"
                            current={summary.usage.messagesThisMonth}
                            limit={summary.usage.monthlyMessageLimit}
                        />
                        <UsageMeter
                            icon={FileText}
                            label="Notas de servico (NFS-e)"
                            current={summary.usage.nfseThisMonth}
                            limit={summary.usage.monthlyNfseLimit}
                        />
                    </div>
                </div>
            )}

            {/* Charts Row */}
            <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {/* Messages over time */}
                <ChartCard title="Mensagens por Dia (7 dias)">
                    <ResponsiveContainer width="100%" height={chartHeight}>
                        <AreaChart data={summary.messagesPerDay} margin={isMobile ? { left: -20, right: 4, top: 4, bottom: 0 } : { left: 0, right: 8, top: 4, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                            <XAxis dataKey="day" tick={tickStyle} tickLine={false} axisLine={false} />
                            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={isMobile ? 30 : 40} />
                            <Tooltip content={<ChartTooltip />} />
                            {!isMobile && <Legend wrapperStyle={{ fontSize: "12px" }} />}
                            <Area
                                type="monotone"
                                dataKey="in"
                                name="Recebidas"
                                stroke="#60a5fa"
                                fill="url(#colorIn)"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 5, strokeWidth: 2, fill: "#60a5fa" }}
                                animationDuration={800}
                                animationEasing="ease-out"
                            />
                            <Area
                                type="monotone"
                                dataKey="out"
                                name="Enviadas"
                                stroke="#34d399"
                                fill="url(#colorOut)"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 5, strokeWidth: 2, fill: "#34d399" }}
                                animationDuration={800}
                                animationEasing="ease-out"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                    {isMobile && (
                        <div className="flex justify-center gap-4 mt-2 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-400" /> Recebidas</span>
                            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> Enviadas</span>
                        </div>
                    )}
                </ChartCard>

                {/* Performance by service */}
                <ChartCard
                    title={
                        serviceType === "billing"
                            ? "Cobranças por Status (Mês)"
                            : serviceType === "nfe_import"
                                ? "NF-es por Dia (7 dias)"
                                : "Agendamentos por Dia (7 dias)"
                    }
                >
                    <ResponsiveContainer width="100%" height={chartHeight}>
                        <BarChart
                            data={
                                serviceType === "billing"
                                    ? summary.billingByStatus
                                    : serviceType === "nfe_import"
                                        ? summary.nfesPerDay
                                        : summary.appointmentsPerDay
                            }
                            margin={isMobile ? { left: -20, right: 4, top: 4, bottom: 0 } : { left: 0, right: 8, top: 4, bottom: 0 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                            <XAxis
                                dataKey={serviceType === "billing" ? "status" : "day"}
                                tick={tickStyle}
                                tickLine={false}
                                axisLine={false}
                            />
                            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={isMobile ? 30 : 40} />
                            <Tooltip content={<ChartTooltip />} />
                            {!isMobile && <Legend wrapperStyle={{ fontSize: "12px" }} />}
                            {serviceType === "billing" ? (
                                <Bar dataKey="count" name="Títulos" fill="#818cf8" radius={[6, 6, 0, 0]} animationDuration={700} />
                            ) : serviceType === "nfe_import" ? (
                                <>
                                    <Bar dataKey="imported" name="Importadas" fill="#34d399" radius={[6, 6, 0, 0]} animationDuration={700} />
                                    <Bar dataKey="detected" name="Detectadas" fill="#60a5fa" radius={[6, 6, 0, 0]} animationDuration={700} animationBegin={100} />
                                    <Bar dataKey="failed" name="Com Falha" fill="#f87171" radius={[6, 6, 0, 0]} animationDuration={700} animationBegin={200} />
                                </>
                            ) : (
                                <>
                                    <Bar dataKey="scheduled" name="Agendados" fill="#60a5fa" radius={[6, 6, 0, 0]} animationDuration={700} />
                                    <Bar dataKey="completed" name="Realizados" fill="#34d399" radius={[6, 6, 0, 0]} animationDuration={700} animationBegin={100} />
                                    <Bar dataKey="canceled" name="Cancelados" fill="#f87171" radius={[6, 6, 0, 0]} animationDuration={700} animationBegin={200} />
                                </>
                            )}
                        </BarChart>
                    </ResponsiveContainer>
                    {isMobile && (
                        <div className="flex flex-wrap justify-center gap-3 mt-2 text-[10px] text-muted-foreground">
                            {serviceType === "billing" ? (
                                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-indigo-400" /> Títulos</span>
                            ) : serviceType === "nfe_import" ? (
                                <>
                                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> Importadas</span>
                                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-400" /> Detectadas</span>
                                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-400" /> Falha</span>
                                </>
                            ) : (
                                <>
                                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-400" /> Agendados</span>
                                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> Realizados</span>
                                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-400" /> Cancelados</span>
                                </>
                            )}
                        </div>
                    )}
                </ChartCard>
            </div>

            {/* Distribution Pie + Alerts Row */}
            <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[1fr_1.5fr]">
                {/* Pie chart distribuição */}
                {messagePieData.length > 0 && (
                    <ChartCard title="Distribuição de Mensagens">
                        <ResponsiveContainer width="100%" height={isMobile ? 160 : 200}>
                            <PieChart>
                                <Pie
                                    data={messagePieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={isMobile ? 35 : 50}
                                    outerRadius={isMobile ? 60 : 75}
                                    dataKey="value"
                                    paddingAngle={4}
                                    animationDuration={800}
                                    animationEasing="ease-out"
                                >
                                    {messagePieData.map((_entry, i) => (
                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip content={<ChartTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="flex justify-center gap-4 mt-1 text-[10px] sm:text-xs text-muted-foreground">
                            {messagePieData.map((d, i) => (
                                <span key={d.name} className="flex items-center gap-1.5">
                                    <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i] }} />
                                    {d.name}: <strong className="text-foreground">{formatNum(d.value)}</strong>
                                </span>
                            ))}
                        </div>
                    </ChartCard>
                )}

                {/* Recent Activity / Alerts */}
                <div className="rounded-xl border border-border/50 bg-card p-4 sm:p-6 shadow-soft transition-all duration-300 enter-up">
                    <h3 className="mb-3 sm:mb-4 text-xs sm:text-sm font-semibold text-foreground">Alertas e Atividade Recente</h3>
                    <div className="space-y-2 max-h-65 overflow-y-auto pr-1">
                        {summary.recentAlerts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-6 sm:py-8 text-center">
                                <div className="grid h-10 w-10 place-items-center rounded-full bg-green-500/15 mb-3">
                                    <span className="text-lg">✅</span>
                                </div>
                                <p className="text-xs sm:text-sm text-muted-foreground">Nenhum alerta no momento.</p>
                                <p className="text-[10px] sm:text-xs text-muted-foreground/60 mt-0.5">Tudo operando normalmente!</p>
                            </div>
                        ) : (
                            summary.recentAlerts.map((alert, i) => (
                                <div
                                    key={i}
                                    className={`flex items-start gap-2.5 sm:gap-3 rounded-xl border p-2.5 sm:p-3 text-xs sm:text-sm transition-all duration-200 hover:scale-[1.01] ${alert.type === "error"
                                        ? "border-red-500/30 bg-red-500/10 text-red-400"
                                        : alert.type === "warning"
                                            ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                                            : "border-green-500/30 bg-green-500/10 text-green-400"
                                        }`}
                                >
                                    <AlertOctagon className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 shrink-0" />
                                    <span className="flex-1 min-w-0 wrap-break-word">{alert.message}</span>
                                    <span className="ml-auto text-[10px] sm:text-xs opacity-60 shrink-0 whitespace-nowrap">{alert.time}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
