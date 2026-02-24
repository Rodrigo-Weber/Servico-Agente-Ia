import { useEffect, useState } from "react";
import { api } from "../../api";
import { BillingDashboardSummary } from "../../types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/Card";
import { Users2, Wallet, AlertCircle, CheckCircle2 } from "lucide-react";
import { SkeletonDashboard } from "../ui/Skeleton";

interface BillingDashboardProps {
    token: string;
    companyName: string;
}

function formatMoney(value: string | number): string {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function SummaryCard({
    icon: Icon,
    label,
    value,
    detail,
}: {
    icon: any;
    label: string;
    value: string | number;
    detail?: string;
}) {
    return (
        <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-colors duration-300">
            <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                    <Icon className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-muted-foreground">{label}</p>
            </div>
            <div className="mt-4">
                <p className="font-display text-2xl font-bold tracking-tight text-foreground">{value}</p>
                <div className="mt-1 h-4">
                    {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
                </div>
            </div>
        </div>
    );
}

export function BillingDashboard({ token, companyName }: BillingDashboardProps) {
    const [summary, setSummary] = useState<BillingDashboardSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const data = await api.getBillingDashboardSummary(token);
                setSummary(data);
            } catch (err) {
                console.error("Error loading billing summary", err);
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [token]);

    if (loading || !summary) {
        return <SkeletonDashboard />;
    }

    return (
        <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm enter-up">
                <p className="text-sm text-muted-foreground">Operação da empresa</p>
                <h2 className="font-display text-2xl font-bold text-foreground">{companyName}</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-4 enter-up" style={{ animationDelay: '0.1s' }}>
                <SummaryCard
                    icon={Users2}
                    label="Clientes Ativos"
                    value={summary.totals.clients}
                    detail="Total na base"
                />
                <SummaryCard
                    icon={Wallet}
                    label="A Receber"
                    value={formatMoney(summary.totals.pendingAmount)}
                    detail={`${summary.totals.pendingCount} títulos`}
                />
                <SummaryCard
                    icon={CheckCircle2}
                    label="Recebido"
                    value={formatMoney(summary.totals.paidAmount)}
                    detail={`${summary.totals.paidCount} títulos pagos`}
                />
                <SummaryCard
                    icon={AlertCircle}
                    label="Em Atraso"
                    value={formatMoney(summary.totals.overdueAmount)}
                    detail={`${summary.totals.overdueCount} títulos vencidos`}
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Painel do ERP</CardTitle>
                    <CardDescription>Estes são os dados retornados pela integração com o ERP.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded border border-border p-4 text-sm text-muted-foreground bg-muted/30">
                        <p><strong>Integração:</strong> Conexão ERP ativa.</p>
                        <p className="mt-2">Use a aba de Cobranças para detalhar os itens vencidos e a receber agrupados por cliente.</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
