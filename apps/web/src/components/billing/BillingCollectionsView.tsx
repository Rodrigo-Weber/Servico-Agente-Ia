import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { BillingClient, BillingDocument } from "../../types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Search, ChevronLeft, ChevronRight, Download, Eye, Send, Settings, User, Copy } from "lucide-react";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { EmptyState } from "../ui/EmptyState";
import { SkeletonDashboard } from "../ui/Skeleton";
import { ToastContainer, useToast } from "../ui/Toast";

interface BillingCollectionsViewProps {
  token: string;
}

interface BillingDocumentWithClient extends BillingDocument {
  clientName: string;
  clientDocument: string;
}

function formatMoney(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR");
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_OPTIONS = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Marco" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
] as const;

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const datePrefix = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (datePrefix) {
    const year = Number(datePrefix[1]);
    const month = Number(datePrefix[2]);
    const day = Number(datePrefix[3]);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function getDaysUntilDue(value: string): number | null {
  const dueDate = parseDateOnly(value);
  if (!dueDate) {
    return null;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((dueDate.getTime() - today.getTime()) / MS_PER_DAY);
}

function getDaysUntilDueLabel(value: string): string {
  const diffDays = getDaysUntilDue(value);
  if (diffDays === null) {
    return "Sem vencimento";
  }

  if (diffDays > 0) {
    return `${diffDays} dia(s) para vencer`;
  }

  if (diffDays === 0) {
    return "Vence hoje";
  }

  return `Vencido ha ${Math.abs(diffDays)} dia(s)`;
}

function getDaysUntilDueClassName(value: string): string {
  const diffDays = getDaysUntilDue(value);
  if (diffDays === null) {
    return "text-muted-foreground";
  }

  if (diffDays < 0) {
    return "text-red-400";
  }

  if (diffDays === 0) {
    return "text-amber-400";
  }

  if (diffDays <= 7) {
    return "text-orange-400";
  }

  return "text-emerald-400";
}

export function BillingCollectionsView({ token }: BillingCollectionsViewProps) {
  const [clients, setClients] = useState<BillingClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"pending" | "overdue" | "paid" | "clients">("pending");
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState<"all" | "today" | "up_to_7" | "up_to_15" | "up_to_30" | "over_30">("all");
  const [page, setPage] = useState(1);
  const [globalAutoSend, setGlobalAutoSend] = useState(false);
  const [sendingDocId, setSendingDocId] = useState<string | null>(null);
  const [updatingClientId, setUpdatingClientId] = useState<string | null>(null);
  const [barcodePreview, setBarcodePreview] = useState<{
    clientName: string;
    description: string;
    barcode: string;
  } | null>(null);
  const { messages, removeToast, toast } = useToast();
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

  useEffect(() => {
    if (clients.length === 0) {
      setGlobalAutoSend(false);
      return;
    }

    setGlobalAutoSend(clients.every((client) => Boolean(client.autoSendEnabled)));
  }, [clients]);

  const allDocuments = useMemo<BillingDocumentWithClient[]>(() => {
    return clients.flatMap((client) =>
      client.documents.map((doc) => ({
        ...doc,
        clientName: client.name,
        clientDocument: client.document,
      })),
    );
  }, [clients]);

  const availableYears = useMemo<number[]>(() => {
    const years = new Set<number>();
    for (const doc of allDocuments) {
      const dueDate = parseDateOnly(doc.dueDate);
      if (dueDate) {
        years.add(dueDate.getFullYear());
      }
    }

    return Array.from(years).sort((a, b) => a - b);
  }, [allDocuments]);

  const filteredDocuments = useMemo(() => {
    let result = allDocuments.filter((doc) => doc.status === tab);

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (doc) =>
          doc.clientName.toLowerCase().includes(s) ||
          doc.clientDocument.toLowerCase().includes(s) ||
          doc.description.toLowerCase().includes(s),
      );
    }

    if (monthFilter !== "all" || yearFilter !== "all") {
      result = result.filter((doc) => {
        const dueDate = parseDateOnly(doc.dueDate);
        if (!dueDate) {
          return false;
        }

        if (monthFilter !== "all" && dueDate.getMonth() + 1 !== Number(monthFilter)) {
          return false;
        }

        if (yearFilter !== "all" && dueDate.getFullYear() !== Number(yearFilter)) {
          return false;
        }

        return true;
      });
    }

    if (tab === "pending" && daysFilter !== "all") {
      result = result.filter((doc) => {
        const diffDays = getDaysUntilDue(doc.dueDate);
        if (diffDays === null) {
          return false;
        }

        if (daysFilter === "today") {
          return diffDays === 0;
        }

        if (daysFilter === "up_to_7") {
          return diffDays >= 0 && diffDays <= 7;
        }

        if (daysFilter === "up_to_15") {
          return diffDays >= 0 && diffDays <= 15;
        }

        if (daysFilter === "up_to_30") {
          return diffDays >= 0 && diffDays <= 30;
        }

        if (daysFilter === "over_30") {
          return diffDays > 30;
        }

        return true;
      });
    }

    return result.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [allDocuments, tab, search, monthFilter, yearFilter, daysFilter]);

  const filteredClients = useMemo(() => {
    let result = [...clients];

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (client) =>
          client.name.toLowerCase().includes(s) ||
          client.document.toLowerCase().includes(s) ||
          client.phone.toLowerCase().includes(s) ||
          client.email.toLowerCase().includes(s),
      );
    }

    return result.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [clients, search]);

  const documentsInCurrentTab = useMemo(() => allDocuments.filter((doc) => doc.status === tab).length, [allDocuments, tab]);

  const totalItems = tab === "clients" ? filteredClients.length : filteredDocuments.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const paginatedDocs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredDocuments.slice(start, start + PAGE_SIZE);
  }, [filteredDocuments, page]);

  const paginatedClients = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredClients.slice(start, start + PAGE_SIZE);
  }, [filteredClients, page]);

  useEffect(() => {
    setPage(1);
  }, [search, tab, monthFilter, yearFilter, daysFilter]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (tab !== "pending" && daysFilter !== "all") {
      setDaysFilter("all");
    }
  }, [tab, daysFilter]);

  async function handleSendNotification(doc: BillingDocumentWithClient) {
    if (sendingDocId) {
      return;
    }

    setSendingDocId(doc.id);
    try {
      const result = await api.notifyBillingDocument(token, doc.id);
      toast.success(`Boleto em PDF enviado para +${result.phone}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar notificacao");
    } finally {
      setSendingDocId(null);
    }
  }

  async function toggleClientAutoSend(clientId: string, nextValue: boolean) {
    if (updatingClientId) {
      return;
    }

    setUpdatingClientId(clientId);
    try {
      await api.updateBillingClient(token, clientId, { autoSendEnabled: nextValue });
      setClients((prev) =>
        prev.map((client) =>
          client.id === clientId
            ? {
                ...client,
                autoSendEnabled: nextValue,
              }
          : client,
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar configuracao do cliente");
    } finally {
      setUpdatingClientId(null);
    }
  }

  async function toggleGlobalAutoSend(nextValue: boolean) {
    setGlobalAutoSend(nextValue);

    const targetClients = clients.filter((client) => Boolean(client.autoSendEnabled) !== nextValue);
    if (targetClients.length === 0) {
      return;
    }

    try {
      await Promise.all(
        targetClients.map((client) =>
          api.updateBillingClient(token, client.id, {
            autoSendEnabled: nextValue,
          }),
        ),
      );

      setClients((prev) => prev.map((client) => ({ ...client, autoSendEnabled: nextValue })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar envio automatico em massa");
      setGlobalAutoSend(clients.every((client) => Boolean(client.autoSendEnabled)));
    }
  }

  async function handleCopyBarcode(): Promise<void> {
    if (!barcodePreview) {
      return;
    }

    try {
      await navigator.clipboard.writeText(barcodePreview.barcode);
      toast.success("Codigo copiado para a area de transferencia.");
    } catch {
      toast.error("Nao foi possivel copiar o codigo.");
    }
  }

  if (loading) {
    return <SkeletonDashboard />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Automacao de Lembretes</h2>
            <p className="text-sm text-muted-foreground">
              O sistema envia cobrancas automaticamente com 30, 15 e 7 dias de antecedencia do vencimento.
            </p>
            <p className="text-xs text-muted-foreground/80">
              Quando o cliente nao tiver telefone valido, o envio manual usa o numero de teste 5571983819052.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{globalAutoSend ? "Ativo" : "Inativo"}</span>
          <label className="relative inline-block h-6 w-11 cursor-pointer">
            <input
              type="checkbox"
              checked={globalAutoSend}
              onChange={(e) => void toggleGlobalAutoSend(e.target.checked)}
              className="peer sr-only"
            />
            <div className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-green-500 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold">Gerenciamento de Cobrancas</h2>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, CPF/CNPJ ou descricao..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-border pb-2">
        <button
          onClick={() => setTab("pending")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
            tab === "pending" ? "bg-green-500/10 text-green-400" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          A Vencer
        </button>
        <button
          onClick={() => setTab("overdue")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
            tab === "overdue" ? "bg-red-500/10 text-red-400" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Vencidas
        </button>
        <button
          onClick={() => setTab("paid")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
            tab === "paid" ? "bg-blue-500/10 text-blue-400" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Pagas
        </button>
        <button
          onClick={() => setTab("clients")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
            tab === "clients" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Clientes
        </button>
      </div>

      {tab !== "clients" ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card/60 p-3">
          <div className="min-w-[170px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mes</label>
            <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} fullWidth={false} className="w-[170px]">
              <option value="all">Todos os meses</option>
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-[140px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ano</label>
            <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} fullWidth={false} className="w-[140px]">
              <option value="all">Todos</option>
              {availableYears.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </Select>
          </div>

          {tab === "pending" ? (
            <div className="min-w-[170px]">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dias para vencer</label>
              <Select value={daysFilter} onChange={(e) => setDaysFilter(e.target.value as typeof daysFilter)} fullWidth={false} className="w-[170px]">
                <option value="all">Todos prazos</option>
                <option value="today">Vence hoje</option>
                <option value="up_to_7">Ate 7 dias</option>
                <option value="up_to_15">Ate 15 dias</option>
                <option value="up_to_30">Ate 30 dias</option>
                <option value="over_30">Mais de 30 dias</option>
              </Select>
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {filteredDocuments.length} de {documentsInCurrentTab} titulo(s)
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMonthFilter("all");
                setYearFilter("all");
                setDaysFilter("all");
              }}
              disabled={monthFilter === "all" && yearFilter === "all" && daysFilter === "all"}
            >
              Limpar filtros
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {tab === "pending" && "Titulos a Receber"}
            {tab === "overdue" && "Titulos em Atraso"}
            {tab === "paid" && "Titulos Recebidos"}
            {tab === "clients" && "Clientes Ativos (Configuracao)"}
          </CardTitle>
          <CardDescription>
            {tab === "clients"
              ? `Mostrando ${filteredClients.length} cliente(s).`
              : `Mostrando ${filteredDocuments.length} titulo(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tab === "clients" ? (
            <div className="space-y-2">
              {filteredClients.length === 0 ? (
                <EmptyState
                  icon={User}
                  title="Nenhum cliente"
                  description="Nao ha clientes cadastrados para exibir."
                  className="py-10"
                />
              ) : (
                paginatedClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex flex-1 flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{client.name}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">CPF/CNPJ: {client.document}</p>
                      <p className="text-xs text-muted-foreground">Telefone: {client.phone || "Nao informado"}</p>
                    </div>

                    <div className="flex items-center gap-2 pt-2 md:pt-0">
                      <span className="text-sm font-semibold text-muted-foreground">Envios automaticos</span>
                      <label className="relative inline-block h-6 w-11 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={client.autoSendEnabled || false}
                          onChange={(e) => void toggleClientAutoSend(client.id, e.target.checked)}
                          disabled={updatingClientId === client.id}
                          className="peer sr-only"
                        />
                        <div className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-green-500 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
                      </label>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : paginatedDocs.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Nenhum titulo encontrado"
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
                    <p className="mt-1 text-sm text-muted-foreground">Documento: {doc.clientDocument}</p>
                    <p className="text-xs text-muted-foreground">Ref: {doc.description}</p>
                  </div>

                  <div className="flex flex-col items-start gap-1 md:items-end">
                    <span className="font-mono text-lg font-semibold text-green-400">{formatMoney(doc.amount)}</span>
                    <span className="text-xs text-muted-foreground">
                      {tab === "paid" ? "Pago em:" : "Vencimento:"} {formatDate(doc.paidAt || doc.dueDate)}
                    </span>
                    {tab !== "paid" ? (
                      <span className={`text-xs font-semibold ${getDaysUntilDueClassName(doc.dueDate)}`}>
                        Prazo: {getDaysUntilDueLabel(doc.dueDate)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 pt-2 md:pt-0 md:justify-end">
                    {tab !== "paid" ? (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => void handleSendNotification(doc)}
                        disabled={sendingDocId === doc.id}
                        className={tab === "overdue" ? "bg-red-500 text-white hover:bg-red-600" : ""}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {sendingDocId === doc.id
                          ? "Enviando..."
                          : tab === "overdue"
                            ? "Cobrar Novamente"
                            : "Enviar Notificacao"}
                      </Button>
                    ) : null}

                    {doc.type === "boleto" && doc.barcode ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        title="Ver codigo"
                        onClick={() =>
                          setBarcodePreview({
                            clientName: doc.clientName,
                            description: doc.description,
                            barcode: doc.barcode || "Sem codigo disponivel",
                          })
                        }
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Ver codigo
                      </Button>
                    ) : null}

                    {doc.type === "nfe" && doc.nfeKey ? (
                      <Button variant="secondary" size="sm" title="Baixar XML">
                        <Download className="mr-2 h-4 w-4" />
                        XML
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalItems > PAGE_SIZE ? (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-2">
              <span className="text-sm text-muted-foreground">
                Pagina {page} de {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {barcodePreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar popup"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setBarcodePreview(null)}
          />

          <Card className="relative z-10 w-full max-w-3xl border-border bg-card shadow-2xl">
            <CardHeader>
              <CardTitle>Codigo do boleto</CardTitle>
              <CardDescription>
                {barcodePreview.clientName} • {barcodePreview.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linha/Codigo</p>
                <p className="break-all font-mono text-sm text-foreground">{barcodePreview.barcode}</p>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setBarcodePreview(null)}>
                  Fechar
                </Button>
                <Button type="button" onClick={() => void handleCopyBarcode()}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar codigo
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <ToastContainer messages={messages} removeToast={removeToast} />
    </div>
  );
}
