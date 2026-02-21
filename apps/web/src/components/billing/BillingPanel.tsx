import { useState, useEffect } from "react";
import { BillingDashboard } from "./BillingDashboard";
import { BillingCollectionsView } from "./BillingCollectionsView";
import { CrmPanelView } from "./CrmPanelView";
import { SkeletonDashboard } from "../ui/Skeleton";
import { api } from "../../api";

interface BillingPanelProps {
    token: string;
    activeView: string;
}

export function BillingPanel({ token, activeView }: BillingPanelProps) {
    const [companyName, setCompanyName] = useState("Empresa");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const me = await api.getCompanyMe(token);
                if (me.company) {
                    setCompanyName(me.company.name);
                }
            } catch (err) {
                console.error("Error loading company me", err);
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [token]);

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
                <h2 className="text-xl font-bold">Configurações</h2>
                <p className="text-muted-foreground">Em breve: Opções de integração com ERP e templates de notificação.</p>
            </div>
        );
    }

    return (
        <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
            Nenhuma tela selecionada
        </div>
    );
}
