import { useEffect, useState } from "react";
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
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatMoney(value: number): string {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(value);
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

interface KpiCardProps {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string | number;
    detail?: string;
    accent?: string; // Tailwind color class for icon bg
}

function KpiCard({ icon: Icon, label, value, detail, accent = "bg-muted" }: KpiCardProps) {
    return (
        <div className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm gap-4 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${accent} text-foreground`}>
                    <Icon className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-muted-foreground">{label}</p>
            </div>
            <div>
                <p className="font-display text-2xl font-bold tracking-tight text-foreground">{value}</p>
                {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface OwnerDashboardProps {
    session: AuthSession;
    token: string;
}

const CHART_TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 12 };

export function OwnerDashboard({ session, token }: OwnerDashboardProps) {
    const [summary, setSummary] = useState<OwnerDashboardSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const data = await api.getOwnerDashboard(token);
                setSummary(data);
            } catch (err) {
                console.error("Error loading owner dashboard", err);
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [token]);

    if (loading || !summary) return <SkeletonDashboard />;

    const st = summary.totals;
    const serviceType = session.user.serviceType;

    return (
        <div className="space-y-8">
            {/* Welcome header */}
            <div className="rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border border-primary/20 p-6">
                <h2 className="font-display text-2xl font-bold text-foreground">
                    Visão Geral da Operação 🚀
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Resumo de {new Date(summary.generatedAt).toLocaleString("pt-BR", {
                        dateStyle: "full",
                        timeStyle: "short",
                    })}
                </p>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {serviceType === "billing" || !serviceType ? (
                    <>
                        <KpiCard
                            icon={Wallet}
                            label="A Receber (Total)"
                            value={formatMoney(st.pendingBillingAmount)}
                            detail={`${st.pendingBillingCount} títulos`}
                            accent="bg-green-500/20"
                        />
                        <KpiCard
                            icon={AlertOctagon}
                            label="Cobranças Vencidas"
                            value={formatMoney(st.overdueBillingAmount)}
                            detail={`${st.overdueBillingCount} em atraso`}
                            accent="bg-red-500/20"
                        />
                    </>
                ) : null}

                {serviceType === "barber_booking" || !serviceType ? (
                    <>
                        <KpiCard
                            icon={CalendarDays}
                            label="Agendamentos Hoje"
                            value={st.appointmentsToday}
                            detail={`${st.appointmentsMonth} no mês`}
                            accent="bg-blue-500/20"
                        />
                    </>
                ) : null}

                {serviceType === "nfe_import" || !serviceType ? (
                    <>
                        <KpiCard
                            icon={FileText}
                            label="NF-es Importadas"
                            value={st.nfesImported}
                            detail="Últimas 30 dias"
                            accent="bg-purple-500/20"
                        />
                    </>
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
                />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {/* Messages over time */}
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <h3 className="mb-4 font-semibold text-foreground">Mensagens por Dia (7 dias)</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={summary.messagesPerDay}>
                            <defs>
                                <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="day" tick={CHART_TICK_STYLE} />
                            <YAxis tick={CHART_TICK_STYLE} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: "var(--card)",
                                    border: "1px solid var(--border)",
                                    borderRadius: "0.5rem",
                                    color: "var(--foreground)",
                                }}
                            />
                            <Legend />
                            <Area
                                type="monotone"
                                dataKey="in"
                                name="Recebidas"
                                stroke="#60a5fa"
                                fill="url(#colorIn)"
                                strokeWidth={2}
                            />
                            <Area
                                type="monotone"
                                dataKey="out"
                                name="Enviadas"
                                stroke="#34d399"
                                fill="url(#colorOut)"
                                strokeWidth={2}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Performance by service or billing */}
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <h3 className="mb-4 font-semibold text-foreground">
                        {serviceType === "billing" ? "Cobranças por Status (Mês)" : "Agendamentos por Dia (7 dias)"}
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={serviceType === "billing" ? summary.billingByStatus : summary.appointmentsPerDay}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis
                                dataKey={serviceType === "billing" ? "status" : "day"}
                                tick={CHART_TICK_STYLE}
                            />
                            <YAxis tick={CHART_TICK_STYLE} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: "var(--card)",
                                    border: "1px solid var(--border)",
                                    borderRadius: "0.5rem",
                                    color: "var(--foreground)",
                                }}
                            />
                            <Legend />
                            {serviceType === "billing" ? (
                                <Bar dataKey="count" name="Títulos" fill="#818cf8" radius={[4, 4, 0, 0]} />
                            ) : (
                                <>
                                    <Bar dataKey="scheduled" name="Agendados" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="completed" name="Realizados" fill="#34d399" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="canceled" name="Cancelados" fill="#f87171" radius={[4, 4, 0, 0]} />
                                </>
                            )}
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Recent Activity / Alerts */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h3 className="mb-4 font-semibold text-foreground">Alertas e Atividade Recente</h3>
                <div className="space-y-2">
                    {summary.recentAlerts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum alerta no momento. Tudo operando normalmente! ✅</p>
                    ) : (
                        summary.recentAlerts.map((alert, i) => (
                            <div
                                key={i}
                                className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${alert.type === "error"
                                        ? "border-red-500/30 bg-red-500/10 text-red-400"
                                        : alert.type === "warning"
                                            ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                                            : "border-green-500/30 bg-green-500/10 text-green-400"
                                    }`}
                            >
                                <AlertOctagon className="h-4 w-4 mt-0.5 shrink-0" />
                                <span>{alert.message}</span>
                                <span className="ml-auto text-xs opacity-60">{alert.time}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
