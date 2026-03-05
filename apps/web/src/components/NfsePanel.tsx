import { useEffect, useState } from "react";
import {
  FileCheck2,
  Send,
  Download,
  XCircle,
  RefreshCw,
  Plus,
  Info,
  CheckCircle2,
  Clock3,
  AlertTriangle,
} from "lucide-react";
import { api } from "../api";
import type { NfseDocument, NfseDashboard, NfseStatus } from "../types";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";
import { cn } from "../lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: NfseStatus) {
  const map: Record<NfseStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" | "info" }> = {
    pending: { label: "Pendente", variant: "secondary" },
    processing: { label: "Processando", variant: "info" },
    authorized: { label: "Autorizada", variant: "default" },
    rejected: { label: "Rejeitada", variant: "destructive" },
    canceled: { label: "Cancelada", variant: "outline" },
    error: { label: "Erro", variant: "destructive" },
  };
  const { label, variant } = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Stat Card ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, accent = "bg-muted" }: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <div className="stat-card rounded-xl border border-border/50 bg-card p-4 shadow-soft">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("grid h-8 w-8 place-items-center rounded-lg", accent)}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</p>
      </div>
      <p className="font-display text-xl font-bold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

// ─── Emit Modal ───────────────────────────────────────────────────────────

function EmitForm({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const [form, setForm] = useState({
    valorServicos: "",
    descricao: "",
    tomadorNome: "",
    tomadorDocumento: "",
    tomadorEmail: "",
    tomadorTelefone: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.emitirNfse(token, {
        valorServicos: parseFloat(form.valorServicos),
        descricao: form.descricao,
        tomadorNome: form.tomadorNome || undefined,
        tomadorDocumento: form.tomadorDocumento || undefined,
        tomadorEmail: form.tomadorEmail || undefined,
        tomadorTelefone: form.tomadorTelefone || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao emitir NFS-e");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="form-group">
          <label className="form-label">Valor do Serviço (R$)</label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="150.00"
            value={form.valorServicos}
            onChange={(e) => setForm((prev) => ({ ...prev, valorServicos: e.target.value }))}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">CPF/CNPJ Tomador</label>
          <Input
            placeholder="000.000.000-00"
            value={form.tomadorDocumento}
            onChange={(e) => setForm((prev) => ({ ...prev, tomadorDocumento: e.target.value }))}
          />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Descrição do Serviço</label>
        <textarea
          className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm shadow-inner-glow transition-all hover:border-primary/30 focus:ring-2 focus:ring-primary/25 focus:border-primary/50 focus:outline-none min-h-20 resize-none"
          placeholder="Descreva os serviços prestados..."
          value={form.descricao}
          onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="form-group">
          <label className="form-label">Nome do Tomador</label>
          <Input
            placeholder="Nome completo"
            value={form.tomadorNome}
            onChange={(e) => setForm((prev) => ({ ...prev, tomadorNome: e.target.value }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Telefone</label>
          <Input
            placeholder="(11) 99999-0000"
            value={form.tomadorTelefone}
            onChange={(e) => setForm((prev) => ({ ...prev, tomadorTelefone: e.target.value }))}
          />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Email do Tomador</label>
        <Input
          type="email"
          placeholder="email@cliente.com"
          value={form.tomadorEmail}
          onChange={(e) => setForm((prev) => ({ ...prev, tomadorEmail: e.target.value }))}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <Button type="submit" disabled={loading} className="w-full">
        <FileCheck2 className="mr-1.5 h-4 w-4" />
        {loading ? "Emitindo..." : "Emitir NFS-e"}
      </Button>
    </form>
  );
}

// ─── Main NFS-e Panel ─────────────────────────────────────────────────────

interface NfsePanelProps {
  token: string;
}

export function NfsePanel({ token }: NfsePanelProps) {
  const [documents, setDocuments] = useState<NfseDocument[]>([]);
  const [dashboard, setDashboard] = useState<NfseDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEmitForm, setShowEmitForm] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  async function loadData() {
    try {
      const [listRes, dashRes] = await Promise.all([
        api.listNfse(token, page, 15),
        api.getNfseDashboard(token),
      ]);
      setDocuments(listRes.data);
      setTotal(listRes.total);
      setDashboard(dashRes);
    } catch (err) {
      console.error("Error loading NFS-e data", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [token, page]);

  async function handleSendWhatsapp(id: string) {
    setActionLoading(id);
    setFeedback("");
    try {
      await api.enviarNfseWhatsapp(token, id);
      setFeedback("NFS-e enviada via WhatsApp com sucesso!");
      void loadData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erro ao enviar WhatsApp");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("Tem certeza que deseja cancelar esta NFS-e?")) return;
    setActionLoading(id);
    setFeedback("");
    try {
      await api.cancelarNfse(token, id);
      setFeedback("NFS-e cancelada com sucesso.");
      void loadData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erro ao cancelar");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRefreshStatus(id: string) {
    setActionLoading(id);
    try {
      await api.getNfseStatus(token, id);
      void loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDownloadPdf(id: string) {
    try {
      const res = await api.getNfsePdf(token, id);
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${res.pdf}`;
      link.download = res.filename;
      link.click();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erro ao baixar PDF");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/30" />
          ))}
        </div>
        <div className="h-96 rounded-xl bg-muted/30" />
      </div>
    );
  }

  const totalPages = Math.ceil(total / 15);

  return (
    <div className="space-y-6 enter-up">
      {/* Dashboard KPIs */}
      {dashboard ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Total" value={dashboard.total} icon={FileCheck2} accent="bg-blue-500/20" />
          <StatCard label="Autorizadas" value={dashboard.authorized} icon={CheckCircle2} accent="bg-emerald-500/20" />
          <StatCard label="Pendentes" value={dashboard.pending} icon={Clock3} accent="bg-yellow-500/20" />
          <StatCard label="Rejeitadas" value={dashboard.rejected} icon={AlertTriangle} accent="bg-red-500/20" />
          <StatCard label="Valor Total" value={formatMoney(dashboard.totalValue)} icon={FileCheck2} accent="bg-purple-500/20" />
          <StatCard label="WhatsApp" value={dashboard.whatsappSent} icon={Send} accent="bg-green-500/20" />
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-foreground">Notas Fiscais de Serviço</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); void loadData(); }}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setShowEmitForm(!showEmitForm)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Emitir NFS-e
          </Button>
        </div>
      </div>

      {/* Feedback */}
      {feedback ? (
        <div className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          feedback.includes("sucesso")
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-400",
        )}>
          {feedback}
        </div>
      ) : null}

      {/* Emit Form (collapsible) */}
      {showEmitForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Emitir Nova NFS-e</CardTitle>
            <CardDescription>Preencha os dados do serviço para emissão da nota fiscal.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmitForm
              token={token}
              onSuccess={() => {
                setShowEmitForm(false);
                setFeedback("NFS-e emitida com sucesso!");
                void loadData();
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Documents List */}
      <Card>
        <CardContent className="p-0">
          {documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileCheck2 className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Nenhuma NFS-e emitida</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Clique em &quot;Emitir NFS-e&quot; para começar</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="table-premium w-full">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Ref</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Tomador</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Descrição</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Valor</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Status</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">WhatsApp</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Data</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{doc.ref.slice(0, 12)}...</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{doc.tomadorNome || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{doc.tomadorDocumento || ""}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground max-w-50 truncate">{doc.descricao}</td>
                      <td className="px-4 py-3 text-sm font-medium text-foreground text-right">{formatMoney(doc.valorServicos)}</td>
                      <td className="px-4 py-3 text-center">{statusBadge(doc.status)}</td>
                      <td className="px-4 py-3 text-center">
                        {doc.whatsappSentAt ? (
                          <Badge variant="default">Enviado</Badge>
                        ) : (
                          <Badge variant="outline">Pendente</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(doc.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {doc.status === "authorized" && !doc.whatsappSentAt ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleSendWhatsapp(doc.id)}
                              disabled={actionLoading === doc.id}
                              title="Enviar via WhatsApp"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          {doc.status === "authorized" ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleDownloadPdf(doc.id)}
                              title="Baixar PDF"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          {doc.status === "pending" || doc.status === "processing" ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleRefreshStatus(doc.id)}
                              disabled={actionLoading === doc.id}
                              title="Atualizar status"
                            >
                              <RefreshCw className={cn("h-3.5 w-3.5", actionLoading === doc.id && "animate-spin")} />
                            </Button>
                          ) : null}
                          {doc.status === "authorized" ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleCancel(doc.id)}
                              disabled={actionLoading === doc.id}
                              title="Cancelar NFS-e"
                              className="text-red-500 hover:text-red-600"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          {doc.errorMessage ? (
                            <span title={doc.errorMessage}>
                              <Info className="h-3.5 w-3.5 text-red-400" />
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      ) : null}
    </div>
  );
}
