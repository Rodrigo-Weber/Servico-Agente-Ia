import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { api } from "../api";
import { CertificateStatus, CompanyMonitoringOverview, NfeDocument } from "../types";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { EmptyState } from "./ui/EmptyState";

import { SkeletonDashboard } from "./ui/Skeleton";

interface CompanyPanelProps {
  token: string;
  activeView: string;
}

interface CertificateState {
  id: string | null;
  createdAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: CertificateStatus;
  daysRemaining: number | null;
}

function formatMoney(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function parseDateOnly(value: string | null): Date | null {
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

function getStatusVariant(status: NfeDocument["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "imported") {
    return "default";
  }

  if (status === "detected") {
    return "secondary";
  }

  return "destructive";
}

function getNfeStatusLabel(status: NfeDocument["status"]): string {
  if (status === "imported") {
    return "Importada";
  }

  if (status === "detected") {
    return "Detectada";
  }

  return "Com falha";
}

function formatDueDate(dataVencimento: string | null): string {
  const dueDate = parseDateOnly(dataVencimento);
  return dueDate ? dueDate.toLocaleDateString("pt-BR") : "-";
}

function getDueDaysLabel(dataVencimento: string | null): string {
  const dueDate = parseDateOnly(dataVencimento);
  if (!dueDate) {
    return "Sem vencimento";
  }

  const now = new Date();
  const due = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays > 0) {
    return `${diffDays} dia(s) restantes`;
  }

  if (diffDays === 0) {
    return "Vence hoje";
  }

  return `Vencida ha ${Math.abs(diffDays)} dia(s)`;
}

function formatNfeKey(key: string): string {
  return key.replace(/(.{4})/g, "$1 ").trim();
}

function getCertificateBadge(status: CertificateStatus): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (status === "valid") return { label: "Valido", variant: "default" };
  if (status === "expiring") return { label: "Expirando", variant: "secondary" };
  if (status === "expired") return { label: "Expirado", variant: "destructive" };
  if (status === "missing") return { label: "Sem certificado", variant: "outline" };
  return { label: "Validade desconhecida", variant: "secondary" };
}

function normalizeCertificate(me: Awaited<ReturnType<typeof api.getCompanyMe>>["certificate"]): CertificateState {
  if (!me) {
    return {
      id: null,
      createdAt: null,
      validFrom: null,
      validTo: null,
      status: "missing",
      daysRemaining: null,
    };
  }

  return {
    id: me.id,
    createdAt: me.createdAt,
    validFrom: me.validFrom,
    validTo: me.validTo,
    status: me.status,
    daysRemaining: me.daysRemaining,
  };
}

export function CompanyPanel({ token, activeView }: CompanyPanelProps) {
  const [companyName, setCompanyName] = useState("Empresa");
  const [summary, setSummary] = useState<{
    importedCount: number;
    detectedCount: number;
    failedCount: number;
    importedValue: string;
    detectedValue: string;
  } | null>(null);
  const [nfes, setNfes] = useState<NfeDocument[]>([]);
  const [selectedNfe, setSelectedNfe] = useState<NfeDocument | null>(null);
  const [monitoring, setMonitoring] = useState<CompanyMonitoringOverview | null>(null);
  const [certificate, setCertificate] = useState<CertificateState>({
    id: null,
    createdAt: null,
    validFrom: null,
    validTo: null,
    status: "missing",
    daysRemaining: null,
  });
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMonitoring, setLoadingMonitoring] = useState(false);
  const [uploadingCertificate, setUploadingCertificate] = useState(false);
  const [removingCertificate, setRemovingCertificate] = useState(false);
  const [downloadingXml, setDownloadingXml] = useState(false);
  const [feedback, setFeedback] = useState("");

  const [nfeSearch, setNfeSearch] = useState("");
  const [nfeStatusFilter, setNfeStatusFilter] = useState<"all" | NfeDocument["status"]>("all");
  const [nfePage, setNfePage] = useState(1);
  const NFE_PAGE_SIZE = 10;

  const recentNfes = useMemo(() => nfes.slice(0, 5), [nfes]);

  const filteredNfes = useMemo(() => {
    let result = nfes;
    if (nfeStatusFilter !== "all") {
      result = result.filter((nfe) => nfe.status === nfeStatusFilter);
    }
    const search = nfeSearch.trim().toLowerCase();
    if (search) {
      result = result.filter(
        (nfe) =>
          nfe.chave.toLowerCase().includes(search) ||
          (nfe.emitenteNome || "").toLowerCase().includes(search) ||
          (nfe.emitenteCnpj || "").toLowerCase().includes(search),
      );
    }
    return result;
  }, [nfes, nfeStatusFilter, nfeSearch]);

  const nfeTotalPages = Math.max(1, Math.ceil(filteredNfes.length / NFE_PAGE_SIZE));
  const paginatedNfes = useMemo(() => {
    const start = (nfePage - 1) * NFE_PAGE_SIZE;
    return filteredNfes.slice(start, start + NFE_PAGE_SIZE);
  }, [filteredNfes, nfePage]);

  useEffect(() => {
    setNfePage(1);
  }, [nfeSearch, nfeStatusFilter]);

  const handleCopyKey = useCallback((key: string) => {
    void navigator.clipboard.writeText(key);
  }, []);

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeView !== "monitoring") {
      return;
    }

    void loadMonitoring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  async function loadDashboard() {
    setLoading(true);

    try {
      const [me, summaryData, list] = await Promise.all([api.getCompanyMe(token), api.getDashboardSummary(token), api.getNfes(token)]);
      setCompanyName(me.company?.name || "Empresa");
      setSummary(summaryData.totals);
      setNfes(list);
      setCertificate(normalizeCertificate(me.certificate));
      setSelectedNfe(null);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao carregar dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function loadMonitoring() {
    setLoadingMonitoring(true);

    try {
      const data = await api.getCompanyMonitoringOverview(token);
      setMonitoring(data);
      setCertificate(data.certificate);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao carregar monitoramento");
    } finally {
      setLoadingMonitoring(false);
    }
  }

  async function handleUploadCertificate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    if (!certFile) {
      setFeedback("Selecione um arquivo .pfx");
      return;
    }

    setUploadingCertificate(true);

    try {
      const result = await api.uploadCertificate(token, certFile, certPassword);
      setFeedback(result.message);
      setCertFile(null);
      setCertPassword("");
      await Promise.all([loadDashboard(), loadMonitoring()]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha no upload do certificado");
    } finally {
      setUploadingCertificate(false);
    }
  }

  async function handleDeleteCertificate() {
    const confirmed = window.confirm("Deseja realmente excluir o certificado ativo?");
    if (!confirmed) {
      return;
    }

    setFeedback("");
    setRemovingCertificate(true);

    try {
      const result = await api.deleteCompanyCertificate(token);
      setFeedback(result.message);
      await Promise.all([loadDashboard(), loadMonitoring()]);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao excluir certificado");
    } finally {
      setRemovingCertificate(false);
    }
  }

  async function handleOpenNfe(id: string) {
    try {
      const detail = await api.getNfeDetail(token, id);
      setSelectedNfe(detail);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao abrir detalhes da NF-e");
    }
  }

  async function handleDownloadNfeXml() {
    if (!selectedNfe) {
      return;
    }

    setFeedback("");
    setDownloadingXml(true);

    try {
      await api.downloadNfeXml(token, selectedNfe.id, selectedNfe.chave);
      setFeedback("XML baixado com sucesso.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Falha ao baixar XML da NF-e");
    } finally {
      setDownloadingXml(false);
    }
  }

  if (loading) {
    return <SkeletonDashboard />;
  }

  if (activeView === "monitoring") {
    const certificateBadge = getCertificateBadge(certificate.status);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Button onClick={() => void loadMonitoring()} variant="outline" size="sm" disabled={loadingMonitoring}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Atualizar monitoramento
          </Button>
        </div>

        {loadingMonitoring ? (
          <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-6">
            <RefreshCw className="h-5 w-5 animate-spin text-green-400" />
            <span className="text-sm font-semibold text-muted-foreground">Atualizando dados de monitoramento...</span>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <SummaryCard icon={ShieldCheck} label="Certificado" value={certificateBadge.label} detail={certificate.validTo ? `Valido ate ${formatDate(certificate.validTo)}` : "Sem validade informada"} />
          <SummaryCard icon={FileText} label="NF-e importadas" value={monitoring?.nfes.imported ?? 0} detail="Total de notas importadas no sistema" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Saude do certificado</CardTitle>
            <CardDescription>Status de validade e dados do certificado A1 atual.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={certificateBadge.variant}>{certificateBadge.label}</Badge>
              {certificate.daysRemaining !== null ? <span className="text-muted-foreground">{certificate.daysRemaining} dia(s) restantes</span> : null}
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <InfoField label="Valido de" value={formatDate(certificate.validFrom)} />
              <InfoField label="Valido ate" value={formatDate(certificate.validTo)} />
              <InfoField label="Importado em" value={formatDateTime(certificate.createdAt)} />
              <InfoField label="Status" value={certificateBadge.label} />
            </div>
          </CardContent>
        </Card>

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "settings") {
    const certBadge = getCertificateBadge(certificate.status);
    const hasActiveCertificate = certificate.id !== null;

    return (
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-green-400" />
                Certificado A1 atual
              </CardTitle>
              <CardDescription>Consulte validade, status e remova o certificado atual quando necessario.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={certBadge.variant}>{certBadge.label}</Badge>
                {certificate.daysRemaining !== null ? <span className="text-xs text-muted-foreground">{certificate.daysRemaining} dia(s) restantes</span> : null}
              </div>

              <div className="grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.04] p-3 text-sm md:grid-cols-2">
                <InfoField label="Valido de" value={formatDate(certificate.validFrom)} />
                <InfoField label="Valido ate" value={formatDate(certificate.validTo)} />
                <InfoField label="Importado em" value={formatDateTime(certificate.createdAt)} />
                <InfoField label="Status" value={certBadge.label} />
              </div>

              {hasActiveCertificate ? (
                <Button type="button" variant="destructive" onClick={() => void handleDeleteCertificate()} disabled={removingCertificate}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {removingCertificate ? "Excluindo..." : "Excluir certificado atual"}
                </Button>
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-muted-foreground">
                  Nenhum certificado ativo encontrado.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-green-400" />
                {hasActiveCertificate ? "Importar novo certificado" : "Importar certificado A1"}
              </CardTitle>
              <CardDescription>
                {hasActiveCertificate
                  ? "Ao enviar um novo .pfx, o atual sera substituido automaticamente."
                  : "Envie o arquivo .pfx para habilitar sincronizacao da sua empresa."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUploadCertificate} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arquivo do certificado (.pfx)</label>
                  <Input type="file" accept=".pfx" onChange={(event) => setCertFile(event.target.files?.[0] || null)} required />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Senha do certificado</label>
                  <Input type="password" value={certPassword} onChange={(event) => setCertPassword(event.target.value)} required />
                </div>

                <Button type="submit" disabled={uploadingCertificate}>
                  <Upload className="mr-2 h-4 w-4" />
                  {uploadingCertificate ? "Enviando..." : hasActiveCertificate ? "Substituir certificado" : "Enviar certificado"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {(certificate.status === "expired" || certificate.status === "expiring") && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <p>
                O certificado atual esta {certificate.status === "expired" ? "expirado" : "proximo da expiracao"}. Recomenda-se importar um novo
                certificado para nao interromper as sincronizacoes.
              </p>
            </div>
          </div>
        )}

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  if (activeView === "nfes") {
    return (
      <div className="space-y-6">
        {/* Toolbar: busca + filtro + contador + atualizar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por chave, emitente ou CNPJ..."
              value={nfeSearch}
              onChange={(e) => setNfeSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={nfeStatusFilter}
            onChange={(e) => setNfeStatusFilter(e.target.value as typeof nfeStatusFilter)}
            fullWidth={false}
            className="w-auto min-w-[140px]"
          >
            <option value="all">Todos status</option>
            <option value="imported">Importadas</option>
            <option value="detected">Detectadas</option>
            <option value="failed">Com falha</option>
          </Select>
          <span className="text-xs font-semibold text-muted-foreground">
            {filteredNfes.length} de {nfes.length} notas
          </span>
          <Button onClick={() => void loadDashboard()} variant="outline" size="sm">
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Atualizar
          </Button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Lista de notas</CardTitle>
              <CardDescription>Selecione uma nota para abrir o detalhe completo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {paginatedNfes.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title={nfeSearch || nfeStatusFilter !== "all" ? "Nenhuma nota encontrada" : "Sem notas processadas"}
                  description={nfeSearch || nfeStatusFilter !== "all" ? "Tente ajustar os filtros de busca." : "As notas aparecerão aqui quando forem detectadas ou importadas."}
                />
              ) : null}
              {paginatedNfes.map((nfe) => (
                <button
                  key={nfe.id}
                  onClick={() => void handleOpenNfe(nfe.id)}
                  className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.08]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-muted-foreground">{formatNfeKey(nfe.chave)}</p>
                      <p className="text-sm font-semibold">{nfe.emitenteNome || "Emitente nao identificado"}</p>
                      <p className="text-xs text-muted-foreground">
                        Vencimento: {formatDueDate(nfe.dataVencimento)} | {getDueDaysLabel(nfe.dataVencimento)}
                      </p>
                    </div>
                    <Badge variant={getStatusVariant(nfe.status)}>{getNfeStatusLabel(nfe.status)}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-green-400">{formatMoney(nfe.valorTotal)}</p>
                </button>
              ))}

              {/* Paginação */}
              {filteredNfes.length > NFE_PAGE_SIZE ? (
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    Página {nfePage} de {nfeTotalPages}
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={nfePage <= 1}
                      onClick={() => setNfePage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={nfePage >= nfeTotalPages}
                      onClick={() => setNfePage((p) => Math.min(nfeTotalPages, p + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Detalhes da nota</CardTitle>
              <CardDescription>Visualize emitente, valor e itens importados.</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedNfe ? (
                <EmptyState
                  icon={ArrowRight}
                  title="Selecione uma nota"
                  description="Clique em uma nota na lista ao lado para visualizar os detalhes completos."
                  className="min-h-[220px]"
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleDownloadNfeXml()} disabled={downloadingXml}>
                      <Download className="mr-1.5 h-4 w-4" />
                      {downloadingXml ? "Baixando XML..." : "Baixar XML"}
                    </Button>
                  </div>

                  <div className="grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.04] p-3 text-sm md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chave</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <p className="break-all font-mono text-xs font-semibold">{formatNfeKey(selectedNfe.chave)}</p>
                        <button
                          type="button"
                          onClick={() => handleCopyKey(selectedNfe.chave)}
                          className="shrink-0 rounded p-1 transition hover:bg-white/10"
                          title="Copiar chave"
                        >
                          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                    <InfoField label="Status" value={getNfeStatusLabel(selectedNfe.status)} />
                    <InfoField label="Emitente" value={selectedNfe.emitenteNome || "-"} />
                    <InfoField label="CNPJ" value={selectedNfe.emitenteCnpj || "-"} />
                    <InfoField label="Valor total" value={formatMoney(selectedNfe.valorTotal)} />
                    <InfoField label="Data emissao" value={formatDate(selectedNfe.dataEmissao)} />
                    <InfoField label="Data vencimento" value={formatDueDate(selectedNfe.dataVencimento)} />
                    <InfoField label="Prazo" value={getDueDaysLabel(selectedNfe.dataVencimento)} />
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-semibold">Itens da nota</p>
                    <div className="overflow-hidden rounded-xl border border-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2">Codigo</th>
                            <th className="px-3 py-2">Descricao</th>
                            <th className="px-3 py-2 text-right">Qtd</th>
                            <th className="px-3 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.06] bg-white/[0.03]">
                          {(selectedNfe.items || []).length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum item nesta nota.</td>
                            </tr>
                          ) : null}
                          {(selectedNfe.items || []).map((item) => (
                            <tr key={item.id}>
                              <td className="px-3 py-2 text-xs">{item.codigo || "-"}</td>
                              <td className="px-3 py-2">{item.descricao || "-"}</td>
                              <td className="px-3 py-2 text-right">{item.qtd}</td>
                              <td className="px-3 py-2 text-right">{formatMoney(item.vTotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {feedback ? <FeedbackBox message={feedback} /> : null}
      </div>
    );
  }

  const certStatus = getCertificateBadge(certificate.status);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5">
        <p className="text-sm text-muted-foreground">Operacao da empresa</p>
        <h2 className="font-display text-2xl font-bold text-white">{companyName}</h2>
      </div>

      {summary ? (
        <div className="grid gap-4 md:grid-cols-4">
          <SummaryCard icon={CheckCircle2} label="Importadas" value={summary.importedCount} detail={formatMoney(summary.importedValue)} />
          <SummaryCard icon={FileText} label="Pendentes" value={summary.detectedCount} detail={formatMoney(summary.detectedValue)} />
          <SummaryCard icon={XCircle} label="Revisar" value={summary.failedCount} detail="Notas com problema de processamento" />
          <SummaryCard icon={certificate.status === "expired" ? ShieldAlert : ShieldCheck} label="Certificado A1" value={certStatus.label} detail={certificate.validTo ? `Valido ate ${formatDate(certificate.validTo)}` : "Sem certificado ativo"} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ultimas notas processadas</CardTitle>
          <CardDescription>Visao rapida das notas mais recentes da empresa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentNfes.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma nota processada ainda.</p> : null}
          {recentNfes.map((nfe) => (
            <div key={nfe.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{nfe.chave}</p>
                <p className="text-xs text-muted-foreground">{nfe.emitenteNome || "Emitente nao identificado"}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-green-400">{formatMoney(nfe.valorTotal)}</p>
                <Badge variant={getStatusVariant(nfe.status)}>{getNfeStatusLabel(nfe.status)}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {feedback ? <FeedbackBox message={feedback} /> : null}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-green-500/15 text-green-400">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="font-display text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-semibold">{value}</p>
    </div>
  );
}

function FeedbackBox({ message }: { message: string }) {
  return <div className="rounded-xl border border-green-500/25 bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-400">{message}</div>;
}
