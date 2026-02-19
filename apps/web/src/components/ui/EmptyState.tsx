import type { ComponentType, ReactNode } from "react";
import { cn } from "../../lib/utils";

interface EmptyStateProps {
    icon?: ComponentType<{ className?: string }>;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
    className?: string;
    children?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action, className, children }: EmptyStateProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center",
                className,
            )}
        >
            {Icon ? (
                <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-white/[0.04]">
                    <Icon className="h-6 w-6 text-muted-foreground" />
                </div>
            ) : null}
            <p className="text-sm font-semibold text-white/80">{title}</p>
            {description ? <p className="mt-1 max-w-xs text-xs text-muted-foreground">{description}</p> : null}
            {action ? (
                <button
                    type="button"
                    onClick={action.onClick}
                    className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08]"
                >
                    {action.label}
                </button>
            ) : null}
            {children}
        </div>
    );
}
