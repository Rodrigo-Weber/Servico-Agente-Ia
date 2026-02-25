import { useState, useEffect } from "react";
import { BillingDashboard } from "./BillingDashboard";
import { BillingCollectionsView } from "./BillingCollectionsView";
import { CrmPanelView } from "./CrmPanelView";
import { SkeletonDashboard } from "../ui/Skeleton";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/Card";
import { Phone, RefreshCw } from "lucide-react";
import { api } from "../../api";

interface BillingPanelProps {
  token: string;
  activeView: string;
}

interface BillingImportResult {
  suppliersCreated: number;
  suppliersUpdated: number;
  documentsCreated: number;
  documentsUpdated: number;
  suppliersTotal: number;
  documentsTotal: number;
  skippedDocuments: number;
  fornecedoresPath: string;
  documentosPath: string;
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim();
  if (!normalized || normalized === "[object Object]") {
    return "unknown";
  }

  return normalized;
}

function normalizeQrForDisplay(qr: string): string {
  if (qr.startsWith("data:image")) {
    return qr;
  }

  const compact = qr.replace(/\s/g, "");
  if (compact.length > 120 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    return `data:image/png;base64,${compact}`;
  }

  return qr;
}

function getStatusTone(status: string): { text: string; badge: "default" | "secondary" | "destructive" | "outline" } {
  const normalized = status.toLowerCase();
  if (normalized.includes("open") || normalized.includes("connected")) {
    return { text: "Conectado", badge: "default" };
  }

  if (normalized.includes("qrcode") || normalized.includes("connect") || normalized.includes("init")) {
    return { text: "Aguardando conexao", badge: "secondary" };
  }

  return { text: "Offline", badge: "destructive" };
}

export function BillingPanel({ token, activeView }: BillingPanelProps) {
  const [companyName, setCompanyName] = useState("Empresa");
  const [companyInstanceName, setCompanyInstanceName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<BillingImportResult | null>(null);
  const [waStatus, setWaStatus] = useState("unknown");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingWhatsappAction, setLoadingWhatsappAction] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [me, sessionData] = await Promise.all([
          api.getBillingMe(token),
          api.getBillingWhatsappSession(token).catch(() => null),
        ]);
        setCompanyName(me.company.name);
        setCompanyInstanceName(me.company.evolutionInstanceName || null);
        setWaStatus(normalizeStatus(sessionData?.session?.status || "unknown"));
      } catch (err) {
        console.error("Error loading company me", err);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [token]);

  async function handleImportCsv() {
    if (importingCsv) {
      return;
    }

    setImportingCsv(true);
    setImportError("");
    try {
      const result = await api.importBillingCsv(token);
      setImportResult(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Falha ao importar CSV");
    } finally {
      setImportingCsv(false);
    }
  }

  const statusTone = getStatusTone(waStatus);
  const isWhatsappConnected = waStatus.toLowerCase().includes("open") || waStatus.toLowerCase().includes("connected");

  async function handleConnectWhatsappSession() {
    setImportError("");
    setLoadingWhatsappAction(true);
    try {
      const result = await api.startBillingWhatsappSession(token);
      const status = normalizeStatus(result.status);
      setWaStatus(status);

      if (result.qr) {
        setQrCode(normalizeQrForDisplay(result.qr));
      } else if (status.toLowerCase().includes("open") || status.toLowerCase().includes("connected")) {
        setQrCode(null);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Falha ao conectar WhatsApp");
    } finally {
      setLoadingWhatsappAction(false);
    }
  }

  async function handleDisconnectWhatsappSession() {
    const confirm = window.confirm("Deseja desconectar o WhatsApp da empresa agora?");
    if (!confirm) {
      return;
    }

    setImportError("");
    setLoadingWhatsappAction(true);
    try {
      const result = await api.disconnectBillingWhatsappSession(token);
      const status = normalizeStatus(result.status);
      setWaStatus(status);
      if (!status.toLowerCase().includes("open") && !status.toLowerCase().includes("connected")) {
        setQrCode(null);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Falha ao desconectar sessao");
    } finally {
      setLoadingWhatsappAction(false);
    }
  }

  async function handleRefreshWhatsappSession() {
    setImportError("");
    setLoadingWhatsappAction(true);
    try {
      const [sessionData, qrData] = await Promise.all([
        api.getBillingWhatsappSession(token),
        api.getBillingWhatsappQr(token).catch(() => null),
      ]);

      const status = normalizeStatus(qrData?.status || sessionData.session.status);
      setWaStatus(status);
      if (qrData?.qr) {
        setQrCode(normalizeQrForDisplay(qrData.qr));
      } else {
        setQrCode(null);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Falha ao atualizar status do WhatsApp");
    } finally {
      setLoadingWhatsappAction(false);
    }
  }

  if (loading) {
    return <SkeletonDashboard />;
  }

  if (activeView === "dashboard") {
    return <BillingDashboard token={token} companyName={companyName} />;
  }

  if (activeView === "collections") {
    return <BillingCollectionsView token={token} />;
  }

  if (activeView === "crm") {
    return <CrmPanelView token={token} />;
  }

  if (activeView === "settings") {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold">Configuracoes</h2>

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-green-400" />
                Sessao WhatsApp da empresa
              </CardTitle>
              <CardDescription>As mensagens de cobranca e CRM sao enviadas pela instancia configurada para esta empresa.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instancia da empresa</p>
                <p className="mt-1 text-sm font-semibold">{companyInstanceName || "Nao configurada pelo admin"}</p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-muted-foreground">Status:</span>
                <Badge variant={statusTone.badge}>{statusTone.text}</Badge>
                <span className="text-xs text-muted-foreground">{waStatus}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={isWhatsappConnected ? handleDisconnectWhatsappSession : handleConnectWhatsappSession}
                  variant={isWhatsappConnected ? "destructive" : "default"}
                  size="sm"
                  disabled={loadingWhatsappAction || !companyInstanceName}
                >
                  <Phone className="mr-1.5 h-4 w-4" />
                  {loadingWhatsappAction ? "Processando..." : isWhatsappConnected ? "Desconectar WhatsApp" : "Conectar WhatsApp"}
                </Button>
                <Button
                  onClick={handleRefreshWhatsappSession}
                  variant="outline"
                  size="sm"
                  disabled={loadingWhatsappAction || !companyInstanceName}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Atualizar status/QR
                </Button>
              </div>

              {!companyInstanceName ? (
                <p className="text-xs text-amber-400">
                  Peça ao administrador para configurar a instancia Evolution desta empresa na tela de Empresas.
                </p>
              ) : null}

              {qrCode ? (
                <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-white p-5">
                  {qrCode.startsWith("data:image") ? (
                    <img src={qrCode} alt="QR Code" className="h-auto w-full max-w-[230px] rounded-md" />
                  ) : (
                    <pre className="max-h-44 w-full overflow-auto text-xs">{qrCode}</pre>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Importacao de Base CSV</CardTitle>
              <CardDescription>Importa os dados de `Fornecedores.csv` e `Documentos.csv` para o banco deste modulo de cobrancas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={() => void handleImportCsv()} disabled={importingCsv}>
                {importingCsv ? "Importando..." : "Importar base CSV"}
              </Button>

              {importError ? <p className="text-sm font-medium text-red-500">{importError}</p> : null}

              {importResult ? (
                <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                  <p>
                    Fornecedores: +{importResult.suppliersCreated} criados, ~{importResult.suppliersUpdated} atualizados (total {importResult.suppliersTotal})
                  </p>
                  <p className="mt-1">
                    Documentos: +{importResult.documentsCreated} criados, ~{importResult.documentsUpdated} atualizados (total {importResult.documentsTotal})
                  </p>
                  <p className="mt-1">Documentos ignorados: {importResult.skippedDocuments}</p>
                  <p className="mt-3 text-xs">Fornecedores CSV: {importResult.fornecedoresPath}</p>
                  <p className="text-xs">Documentos CSV: {importResult.documentosPath}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <div className="flex h-full items-center justify-center p-6 text-muted-foreground">Nenhuma tela selecionada</div>;
}
