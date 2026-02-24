import { useState, useEffect } from "react";
import { BillingDashboard } from "./BillingDashboard";
import { BillingCollectionsView } from "./BillingCollectionsView";
import { CrmPanelView } from "./CrmPanelView";
import { SkeletonDashboard } from "../ui/Skeleton";
import { Button } from "../ui/Button";
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

export function BillingPanel({ token, activeView }: BillingPanelProps) {
  const [companyName, setCompanyName] = useState("Empresa");
  const [loading, setLoading] = useState(true);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<BillingImportResult | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const me = await api.getBillingMe(token);
        setCompanyName(me.company.name);
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

        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div>
            <h3 className="text-base font-semibold">Importacao de Base CSV</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Importa os dados de `Fornecedores.csv` e `Documentos.csv` para o banco deste modulo de cobrancas.
            </p>
          </div>

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
        </div>
      </div>
    );
  }

  return <div className="flex h-full items-center justify-center p-6 text-muted-foreground">Nenhuma tela selecionada</div>;
}
