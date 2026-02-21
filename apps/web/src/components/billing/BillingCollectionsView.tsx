import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { BillingClient, BillingDocument } from "../../types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Search, ChevronLeft, ChevronRight, Download, Eye, Send, Settings, User } from "lucide-react";
import { Input } from "../ui/Input";
import { EmptyState } from "../ui/EmptyState";
import { SkeletonDashboard } from "../ui/Skeleton";

interface BillingCollectionsViewProps {
    token: string;
}

function formatMoney(value: string | number): string {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function formatDate(value: string): string {
    return new Date(value).toLocaleDateString("pt-BR");
}

export function BillingCollectionsView({ token }: BillingCollectionsViewProps) {
    const [clients, setClients] = useState<BillingClient[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [tab, setTab] = useState<"pending" | "overdue" | "paid" | "clients">("pending");
    const [page, setPage] = useState(1);
    const [globalAutoSend, setGlobalAutoSend] = useState(false);
    const PAGE_SIZE = 10;

    useEffect(() => {
        async function load() {
            try {
                const data = await api.getBillingClients(token);
                setClients(data);
            } catch (err) {
                console.error("Error loading clients", err);
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [token]);

    const allDocuments = useMemo(() => {
        return clients.flatMap((client) =>
            client.documents.map((doc) => ({
                ...doc,
                clientName: client.name,
                clientDocument: client.document,
            }))
        );
    }, [clients]);

    const filteredDocuments = useMemo(() => {
        let result = allDocuments.filter((doc) => doc.status === tab);

        if (search.trim()) {
            const s = search.toLowerCase();
            result = result.filter(
                (doc) =>
                    doc.clientName.toLowerCase().includes(s) ||
                    doc.clientDocument.toLowerCase().includes(s) ||
                    doc.description.toLowerCase().includes(s)
            );
        }

        return result.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    }, [allDocuments, tab, search]);

    const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / PAGE_SIZE));
    const paginatedDocs = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredDocuments.slice(start, start + PAGE_SIZE);
    }, [filteredDocuments, page]);

    useEffect(() => {
        setPage(1);
    }, [search, tab]);

    const handleSendNotification = (doc: any) => {
        // Mocking a toast/notification
        alert(`Disparando notificação simulada para o documento: ${doc.description} (${doc.clientName}).\nLembre-se: Este sistema ainda está no modo MOCK.`);
    };

    const toggleClientAutoSend = (clientId: string) => {
        setClients(prev => prev.map(c =>
            c.id === clientId ? { ...c, autoSendEnabled: !c.autoSendEnabled } : c
        ));
    };

    if (loading) {
        return <SkeletonDashboard />;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                        <Settings className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">Automação de Lembretes</h2>
                        <p className="text-sm text-muted-foreground">O sistema tentará enviar boletos e cobranças ativas nos dias de vencimento em massa se isso estiver ativo.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{globalAutoSend ? "Ativo" : "Inativo"}</span>
                    <label className="relative inline-block h-6 w-11 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={globalAutoSend}
                            onChange={(e) => setGlobalAutoSend(e.target.checked)}
                            className="peer sr-only"
                        />
                        <div className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-green-500 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                </div>
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <h2 className="text-xl font-bold">Gerenciamento de Cobranças</h2>
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por cliente, CPF/CNPJ ou descrição..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
            </div>

            <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
                <button
                    onClick={() => setTab("pending")}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${tab === "pending"
                        ? "bg-green-500/10 text-green-400"
                        : "text-muted-foreground hover:bg-muted"
                        }`}
                >
                    A Vencer
                </button>
                <button
                    onClick={() => setTab("overdue")}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${tab === "overdue"
                        ? "bg-red-500/10 text-red-400"
                        : "text-muted-foreground hover:bg-muted"
                        }`}
                >
                    Vencidas
                </button>
                <button
                    onClick={() => setTab("paid")}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${tab === "paid"
                        ? "bg-blue-500/10 text-blue-400"
                        : "text-muted-foreground hover:bg-muted"
                        }`}
                >
                    Pagas
                </button>
                <button
                    onClick={() => setTab("clients")}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${tab === "clients"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted"
                        }`}
                >
                    Clientes
                </button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {tab === "pending" && "Títulos a Receber"}
                        {tab === "overdue" && "Títulos em Atraso"}
                        {tab === "paid" && "Títulos Recebidos"}
                        {tab === "clients" && "Clientes Ativos (Configuração)"}
                    </CardTitle>
                    <CardDescription>
                        {tab === "clients"
                            ? `Mostrando ${clients.length} cliente(s).`
                            : `Mostrando ${filteredDocuments.length} titulo(s).`
                        }
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {tab === "clients" ? (
                        <div className="space-y-2">
                            {clients.length === 0 ? (
                                <EmptyState
                                    icon={User}
                                    title="Nenhum cliente"
                                    description="Não há clientes cadastrados para exibir."
                                    className="py-10"
                                />
                            ) : (
                                clients.map((c) => (
                                    <div
                                        key={c.id}
                                        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
                                    >
                                        <div className="flex flex-1 flex-col justify-center">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold">{c.name}</span>
                                            </div>
                                            <p className="mt-1 text-sm text-muted-foreground">CPF/CNPJ: {c.document}</p>
                                            <p className="text-xs text-muted-foreground">Telefone: {c.phone}</p>
                                        </div>

                                        <div className="flex items-center gap-2 pt-2 md:pt-0">
                                            <span className="text-sm font-semibold text-muted-foreground">Envios automáticos</span>
                                            <label className="relative inline-block h-6 w-11 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={c.autoSendEnabled || false}
                                                    onChange={() => toggleClientAutoSend(c.id)}
                                                    className="peer sr-only"
                                                />
                                                <div className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-green-500 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full"></div>
                                            </label>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    ) : (paginatedDocs.length === 0 ? (
                        <EmptyState
                            icon={Search}
                            title="Nenhum título encontrado"
                            description="Nenhum documento atende aos filtros atuais."
                            className="py-10"
                        />
                    ) : (
                        <div className="space-y-2">
                            {paginatedDocs.map((doc) => (
                                <div
                                    key={doc.id}
                                    className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
                                >
                                    <div className="flex flex-1 flex-col justify-center">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold">{doc.clientName}</span>
                                            <Badge variant="outline" className="text-[10px] uppercase">
                                                {doc.type === "boleto" ? "Boleto" : "NF-e"}
                                            </Badge>
                                        </div>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            Documento: {doc.clientDocument}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Ref: {doc.description}
                                        </p>
                                    </div>

                                    <div className="flex flex-col items-start gap-1 md:items-end">
                                        <span className="font-mono text-lg font-semibold text-green-400">
                                            {formatMoney(doc.amount)}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {tab === "paid" ? "Pago em:" : "Vencimento:"}{" "}
                                            {formatDate(doc.paidAt || doc.dueDate)}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2 pt-2 md:pt-0 md:justify-end">
                                        {tab === "overdue" && (
                                            <Button
                                                variant="default"
                                                size="sm"
                                                onClick={() => handleSendNotification(doc)}
                                                className="bg-red-500 hover:bg-red-600 text-white"
                                            >
                                                <Send className="mr-2 h-4 w-4" />
                                                Cobrar Novamente
                                            </Button>
                                        )}
                                        {doc.type === "boleto" && doc.barcode && (
                                            <Button variant="secondary" size="sm" title="Ver código de barras">
                                                <Eye className="mr-2 h-4 w-4" />
                                                Ver código
                                            </Button>
                                        )}
                                        {doc.type === "nfe" && doc.nfeKey && (
                                            <Button variant="secondary" size="sm" title="Baixar XML">
                                                <Download className="mr-2 h-4 w-4" />
                                                XML
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}

                    {tab !== "clients" && filteredDocuments.length > PAGE_SIZE && (
                        <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-2">
                            <span className="text-sm text-muted-foreground">
                                Página {page} de {totalPages}
                            </span>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
