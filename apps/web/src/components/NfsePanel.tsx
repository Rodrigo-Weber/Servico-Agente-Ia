import { useEffect, useState, useCallback } from "react";
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
  Settings2,
  Save,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Globe,
  Upload,
  Trash2,
  KeyRound,
} from "lucide-react";
import { api } from "../api";
import type { NfseDocument, NfseDashboard, NfseStatus, NfseConfig, MunicipioBA } from "../types";
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

// ─── NFS-e Config Panel ───────────────────────────────────────────────────

function NfseConfigPanel({ token, onConfigured }: { token: string; onConfigured: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<"success" | "error">("success");
  const [municipios, setMunicipios] = useState<MunicipioBA[]>([]);
  const [municipioSearch, setMunicipioSearch] = useState("");
  const [showMunicipioDropdown, setShowMunicipioDropdown] = useState(false);
  const [certStatus, setCertStatus] = useState<{ hasCertificate: boolean; validTo: string | null; daysRemaining: number | null; status: string } | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState("");
  const [uploadingCert, setUploadingCert] = useState(false);
  const [removingCert, setRemovingCert] = useState(false);

  const [form, setForm] = useState({
    environment: "homologacao" as "homologacao" | "producao",
    sefazEndpoint: "",
    serieRps: "RPS",
    inscricaoMunicipal: "",
    codigoMunicipio: "",
    municipioNome: "",
    regimeTributario: 1,
    itemListaServico: "14.01",
    codigoTributarioMunicipio: "1401",
    aliquotaIss: 0.05,
    issRetido: false,
    naturezaOperacao: 1,
    descricaoPadrao: "Serviço de lavagem e conservação de veículos automotores - {servico} realizado em {data} para {cliente}",
    autoEmitir: false,
    enviarWhatsapp: true,
  });

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.getNfseConfig(token);
      if (res) {
        const data = res as any;
        if (data.certificado) setCertStatus(data.certificado);
        if (data.configured !== false && data.config) {
          const config = data.config;
          setForm({
            environment: config.environment || "homologacao",
            sefazEndpoint: config.sefazEndpoint || "",
            serieRps: config.serieRps || "RPS",
            inscricaoMunicipal: config.inscricaoMunicipal || "",
            codigoMunicipio: config.codigoMunicipio || "",
            municipioNome: "",
            regimeTributario: config.regimeTributario || 1,
            itemListaServico: config.itemListaServico || "14.01",
            codigoTributarioMunicipio: config.codigoTributarioMunicipio || "1401",
            aliquotaIss: config.aliquotaIss ? Number(config.aliquotaIss) : 0.05,
            issRetido: config.issRetido ?? false,
            naturezaOperacao: config.naturezaOperacao || 1,
            descricaoPadrao: config.descricaoPadrao || "Serviço de lavagem e conservação de veículos automotores",
            autoEmitir: config.autoEmitir ?? false,
            enviarWhatsapp: config.enviarWhatsapp ?? true,
          });
        }
      }
    } catch {
      // Sem config ainda - manter defaults
    }
    // Carrega municípios principais
    try {
      const munis = await api.getMunicipiosBA(token);
      setMunicipios(munis);
    } catch {
      // ok
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function searchMunicipios(query: string) {
    setMunicipioSearch(query);
    if (query.length >= 2) {
      try {
        const results = await api.getMunicipiosBA(token, query);
        setMunicipios(results);
        setShowMunicipioDropdown(true);
      } catch {
        // ok
      }
    } else if (query.length === 0) {
      const munis = await api.getMunicipiosBA(token);
      setMunicipios(munis);
      setShowMunicipioDropdown(false);
    }
  }

  function selectMunicipio(mun: MunicipioBA) {
    setForm((prev) => ({
      ...prev,
      codigoMunicipio: mun.codigo,
      municipioNome: `${mun.nome} - ${mun.uf}`,
    }));
    setMunicipioSearch(`${mun.nome} - ${mun.uf} (${mun.codigo})`);
    setShowMunicipioDropdown(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback("");
    try {
      const payload: Record<string, unknown> = {
        environment: form.environment,
        sefazEndpoint: form.sefazEndpoint || undefined,
        serieRps: form.serieRps || "RPS",
        inscricaoMunicipal: form.inscricaoMunicipal || undefined,
        codigoMunicipio: form.codigoMunicipio || undefined,
        regimeTributario: form.regimeTributario,
        itemListaServico: form.itemListaServico || undefined,
        codigoTributarioMunicipio: form.codigoTributarioMunicipio || undefined,
        aliquotaIss: form.aliquotaIss,
        issRetido: form.issRetido,
        naturezaOperacao: form.naturezaOperacao,
        descricaoPadrao: form.descricaoPadrao || undefined,
        autoEmitir: form.autoEmitir,
        enviarWhatsapp: form.enviarWhatsapp,
      };

      await api.updateNfseConfig(token, payload as Partial<NfseConfig>);
      setFeedback("Configuração salva com sucesso!");
      setFeedbackType("success");
      onConfigured();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erro ao salvar configuração");
      setFeedbackType("error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-48 rounded-xl bg-muted/30" />
        <div className="h-48 rounded-xl bg-muted/30" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Certificado A1 e SEFAZ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Emissão Direta via SEFAZ (Gratuito)
          </CardTitle>
          <CardDescription>
            NFS-e emitida diretamente no WebService municipal com certificado digital A1. Sem custo de provedor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status do Certificado */}
          {certStatus ? (
            <div className={cn(
              "rounded-lg border p-3 flex items-center gap-3",
              certStatus.status === "valid" ? "border-emerald-500/30 bg-emerald-500/10" :
              certStatus.status === "expiring" ? "border-yellow-500/30 bg-yellow-500/10" :
              certStatus.status === "expired" ? "border-red-500/30 bg-red-500/10" :
              "border-orange-500/30 bg-orange-500/10"
            )}>
              {certStatus.status === "valid" ? <ShieldCheck className="h-5 w-5 text-emerald-500" /> :
               certStatus.status === "expiring" ? <ShieldAlert className="h-5 w-5 text-yellow-500" /> :
               certStatus.status === "expired" ? <ShieldX className="h-5 w-5 text-red-500" /> :
               <ShieldX className="h-5 w-5 text-orange-500" />}
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {certStatus.status === "valid" ? "Certificado A1 válido" :
                   certStatus.status === "expiring" ? `Certificado A1 expirando em ${certStatus.daysRemaining} dias` :
                   certStatus.status === "expired" ? "Certificado A1 expirado" :
                   "Certificado A1 não encontrado"}
                </p>
                {certStatus.validTo ? (
                  <p className="text-xs text-muted-foreground">
                    Válido até: {new Date(certStatus.validTo).toLocaleDateString("pt-BR")}
                  </p>
                ) : certStatus.status === "missing" ? (
                  <p className="text-xs text-muted-foreground">
                    Envie o certificado digital .pfx abaixo para habilitar a emissão de NFS-e.
                  </p>
                ) : null}
              </div>
              {certStatus.hasCertificate ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={removingCert}
                  onClick={async () => {
                    if (!confirm("Deseja realmente excluir o certificado A1 ativo?")) return;
                    setRemovingCert(true);
                    try {
                      await api.deleteCompanyCertificate(token);
                      setCertStatus({ hasCertificate: false, validTo: null, daysRemaining: null, status: "missing" });
                      setFeedback("Certificado removido.");
                      setFeedbackType("success");
                    } catch (err) {
                      setFeedback(err instanceof Error ? err.message : "Erro ao remover certificado");
                      setFeedbackType("error");
                    } finally {
                      setRemovingCert(false);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  {removingCert ? "..." : "Excluir"}
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* Upload de Certificado A1 */}
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-foreground">
                {certStatus?.hasCertificate ? "Substituir Certificado A1" : "Enviar Certificado A1 (.pfx)"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {certStatus?.hasCertificate
                ? "Ao enviar um novo certificado, o atual será substituído automaticamente."
                : "O certificado digital A1 é obrigatório para emissão de NFS-e diretamente na SEFAZ."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div className="form-group">
                <label className="form-label text-xs">Arquivo .pfx</label>
                <Input
                  type="file"
                  accept=".pfx"
                  onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="form-group">
                <label className="form-label text-xs flex items-center gap-1">
                  <KeyRound className="h-3 w-3" />
                  Senha do certificado
                </label>
                <Input
                  type="password"
                  placeholder="Senha do .pfx"
                  value={certPassword}
                  onChange={(e) => setCertPassword(e.target.value)}
                />
              </div>
              <Button
                type="button"
                disabled={uploadingCert || !certFile || !certPassword}
                onClick={async () => {
                  if (!certFile || !certPassword) return;
                  setUploadingCert(true);
                  setFeedback("");
                  try {
                    const result = await api.uploadCertificate(token, certFile, certPassword);
                    setFeedback(result.message || "Certificado enviado com sucesso!");
                    setFeedbackType("success");
                    setCertFile(null);
                    setCertPassword("");
                    // Atualiza status do certificado
                    if (result.certificate) {
                      setCertStatus({
                        hasCertificate: true,
                        validTo: result.certificate.validTo,
                        daysRemaining: result.certificate.daysRemaining,
                        status: result.certificate.status,
                      });
                    } else {
                      setCertStatus({ hasCertificate: true, validTo: null, daysRemaining: null, status: "valid" });
                    }
                  } catch (err) {
                    setFeedback(err instanceof Error ? err.message : "Erro ao enviar certificado");
                    setFeedbackType("error");
                  } finally {
                    setUploadingCert(false);
                  }
                }}
              >
                <Upload className="h-4 w-4 mr-1.5" />
                {uploadingCert ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-group">
              <label className="form-label">Ambiente</label>
              <select
                className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm shadow-inner-glow transition-all hover:border-primary/30 focus:ring-2 focus:ring-primary/25 focus:border-primary/50 focus:outline-none"
                value={form.environment}
                onChange={(e) => setForm((prev) => ({ ...prev, environment: e.target.value as "homologacao" | "producao" }))}
              >
                <option value="homologacao">Homologação (Testes)</option>
                <option value="producao">Produção</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Série RPS</label>
              <Input
                placeholder="RPS"
                value={form.serieRps}
                onChange={(e) => setForm((prev) => ({ ...prev, serieRps: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Geralmente "RPS" ou "1" — verifique com sua prefeitura
              </p>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              URL do WebService NFS-e (SEFAZ Municipal)
            </label>
            <Input
              type="url"
              placeholder="https://nfse.suaprefeitura.ba.gov.br/webservice/nfse"
              value={form.sefazEndpoint}
              onChange={(e) => setForm((prev) => ({ ...prev, sefazEndpoint: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              URL do WebService ABRASF 2.04 do seu município. Consulte a prefeitura ou contabilidade para obter.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Dados Fiscais */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Dados Fiscais do Prestador (BA)
          </CardTitle>
          <CardDescription>
            Informações fiscais da empresa para emissão de NFS-e na Bahia.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-group">
              <label className="form-label">Inscrição Municipal</label>
              <Input
                placeholder="Número da Inscrição Municipal"
                value={form.inscricaoMunicipal}
                onChange={(e) => setForm((prev) => ({ ...prev, inscricaoMunicipal: e.target.value }))}
              />
            </div>
            <div className="form-group relative">
              <label className="form-label">Município (BA)</label>
              <Input
                placeholder="Buscar município..."
                value={municipioSearch || form.municipioNome || form.codigoMunicipio}
                onChange={(e) => void searchMunicipios(e.target.value)}
                onFocus={() => { if (municipios.length > 0) setShowMunicipioDropdown(true); }}
              />
              {showMunicipioDropdown && municipios.length > 0 ? (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-card shadow-lg">
                  {municipios.map((mun) => (
                    <button
                      key={mun.codigo}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex justify-between"
                      onClick={() => selectMunicipio(mun)}
                    >
                      <span className="font-medium">{mun.nome}</span>
                      <span className="text-muted-foreground text-xs">{mun.codigo}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {form.codigoMunicipio ? (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Código IBGE: {form.codigoMunicipio}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="form-group">
              <label className="form-label">Regime Tributário</label>
              <select
                className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm shadow-inner-glow transition-all hover:border-primary/30 focus:ring-2 focus:ring-primary/25 focus:border-primary/50 focus:outline-none"
                value={form.regimeTributario}
                onChange={(e) => setForm((prev) => ({ ...prev, regimeTributario: parseInt(e.target.value) }))}
              >
                <option value={1}>Simples Nacional</option>
                <option value={2}>Lucro Presumido</option>
                <option value={3}>Lucro Real</option>
                <option value={4}>MEI</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Natureza da Operação</label>
              <select
                className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm shadow-inner-glow transition-all hover:border-primary/30 focus:ring-2 focus:ring-primary/25 focus:border-primary/50 focus:outline-none"
                value={form.naturezaOperacao}
                onChange={(e) => setForm((prev) => ({ ...prev, naturezaOperacao: parseInt(e.target.value) }))}
              >
                <option value={1}>Tributação no município</option>
                <option value={2}>Tributação fora do município</option>
                <option value={3}>Isenção</option>
                <option value={4}>Imune</option>
                <option value={5}>Exigibilidade suspensa por decisão judicial</option>
                <option value={6}>Exigibilidade suspensa por procedimento administrativo</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">ISS Retido?</label>
              <select
                className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm shadow-inner-glow transition-all hover:border-primary/30 focus:ring-2 focus:ring-primary/25 focus:border-primary/50 focus:outline-none"
                value={form.issRetido ? "true" : "false"}
                onChange={(e) => setForm((prev) => ({ ...prev, issRetido: e.target.value === "true" }))}
              >
                <option value="false">Não</option>
                <option value="true">Sim</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Serviço e ISS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" />
            Configuração do Serviço (Lava Jato)
          </CardTitle>
          <CardDescription>
            Dados do serviço para cálculo de ISS e discriminação na NFS-e.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="form-group">
              <label className="form-label">Item Lista de Serviço</label>
              <Input
                placeholder="14.01"
                value={form.itemListaServico}
                onChange={(e) => setForm((prev) => ({ ...prev, itemListaServico: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                14.01 = Lavagem e conservação de veículos
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Código Tributário Municipal</label>
              <Input
                placeholder="1401"
                value={form.codigoTributarioMunicipio}
                onChange={(e) => setForm((prev) => ({ ...prev, codigoTributarioMunicipio: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Alíquota ISS (%)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="5.00"
                value={(form.aliquotaIss * 100).toFixed(2)}
                onChange={(e) => setForm((prev) => ({ ...prev, aliquotaIss: parseFloat(e.target.value) / 100 || 0 }))}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Normalmente 2% a 5% conforme município na BA
              </p>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Descrição Padrão do Serviço</label>
            <textarea
              className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm shadow-inner-glow transition-all hover:border-primary/30 focus:ring-2 focus:ring-primary/25 focus:border-primary/50 focus:outline-none min-h-20 resize-none"
              placeholder="Descrição que aparecerá na NFS-e..."
              value={form.descricaoPadrao}
              onChange={(e) => setForm((prev) => ({ ...prev, descricaoPadrao: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Variáveis disponíveis: {"{servico}"}, {"{data}"}, {"{cliente}"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Automação */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Automação
          </CardTitle>
          <CardDescription>
            Configure emissão automática e envio por WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={form.autoEmitir}
                onChange={(e) => setForm((prev) => ({ ...prev, autoEmitir: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  Emitir NFS-e automaticamente
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Emite a nota fiscal automaticamente ao concluir um serviço/agendamento.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={form.enviarWhatsapp}
                onChange={(e) => setForm((prev) => ({ ...prev, enviarWhatsapp: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  Enviar PDF por WhatsApp
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Envia o PDF da NFS-e para o cliente automaticamente via WhatsApp.
                </p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Feedback & Save */}
      {feedback ? (
        <div className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          feedbackType === "success"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-400",
        )}>
          {feedback}
        </div>
      ) : null}

      <Button type="submit" disabled={saving} className="w-full sm:w-auto">
        <Save className="mr-1.5 h-4 w-4" />
        {saving ? "Salvando..." : "Salvar Configuração"}
      </Button>
    </form>
  );
}

// ─── Main NFS-e Panel ─────────────────────────────────────────────────────

interface NfsePanelProps {
  token: string;
}

export function NfsePanel({ token }: NfsePanelProps) {
  const [tab, setTab] = useState<"notas" | "config">("notas");
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
      setDocuments(listRes.data ?? listRes.items ?? []);
      setTotal(listRes.total ?? 0);
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

  if (loading && tab === "notas") {
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
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 border-b border-border/50 pb-0">
        <button
          type="button"
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px",
            tab === "notas"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
          )}
          onClick={() => setTab("notas")}
        >
          <FileCheck2 className="inline-block mr-1.5 h-4 w-4" />
          Notas Emitidas
        </button>
        <button
          type="button"
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px",
            tab === "config"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
          )}
          onClick={() => setTab("config")}
        >
          <Settings2 className="inline-block mr-1.5 h-4 w-4" />
          Configurações
        </button>
      </div>

      {/* Config Tab */}
      {tab === "config" ? (
        <NfseConfigPanel
          token={token}
          onConfigured={() => {
            setTab("notas");
            setLoading(true);
            void loadData();
          }}
        />
      ) : null}

      {/* Notes Tab */}
      {tab === "notas" ? (
        <>
          {/* Dashboard KPIs */}
      {dashboard ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Total" value={(dashboard.totals?.authorized ?? 0) + (dashboard.totals?.processing ?? 0) + (dashboard.totals?.pending ?? 0) + (dashboard.totals?.error ?? 0)} icon={FileCheck2} accent="bg-blue-500/20" />
          <StatCard label="Autorizadas" value={dashboard.totals?.authorized ?? 0} icon={CheckCircle2} accent="bg-emerald-500/20" />
          <StatCard label="Processando" value={(dashboard.totals?.processing ?? 0) + (dashboard.totals?.pending ?? 0)} icon={Clock3} accent="bg-yellow-500/20" />
          <StatCard label="Erros" value={(dashboard.totals?.rejected ?? 0) + (dashboard.totals?.error ?? 0)} icon={AlertTriangle} accent="bg-red-500/20" />
          <StatCard label="Valor Mês" value={formatMoney(dashboard.month?.total ?? 0)} icon={FileCheck2} accent="bg-purple-500/20" />
          <StatCard label="Mês Qtd" value={dashboard.month?.count ?? 0} icon={Send} accent="bg-green-500/20" />
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
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{doc.providerRef || doc.id.slice(0, 10)}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{doc.tomadorNome || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{doc.tomadorDocumento || ""}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground max-w-50 truncate">{doc.discriminacao}</td>
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
        </>
      ) : null}
    </div>
  );
}
