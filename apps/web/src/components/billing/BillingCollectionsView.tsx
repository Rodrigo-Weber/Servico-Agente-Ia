import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { BillingClient, BillingDocument } from "../../types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Search, ChevronLeft, ChevronRight, Download, Eye, Send, Settings, User, Copy } from "lucide-react";
import { Input } from "../ui/Input";
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

export function BillingCollectionsView({ token }: BillingCollectionsViewProps) {
  const [clients, setClients] = useState<BillingClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"pending" | "overdue" | "paid" | "clients">("pending");
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

    return result.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [allDocuments, tab, search]);

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
  }, [search, tab]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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
              O sistema pode enviar boletos e cobrancas automaticamente nos vencimentos quando ativado.
            </p>
            <p className="text-xs text-muted-foreground/80">Modo teste: notificacoes enviadas para 5571983819052.</p>
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
