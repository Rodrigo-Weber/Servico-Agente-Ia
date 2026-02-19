import { cn } from "../../lib/utils";

interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
    return <div className={cn("animate-pulse rounded-lg bg-white/[0.06]", className)} />;
}

export function SkeletonCard() {
    return (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
            <div className="flex items-center gap-3">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-5 w-16" />
                </div>
            </div>
        </div>
    );
}

export function SkeletonRow() {
    return (
        <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-3">
            <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
        </div>
    );
}

export function SkeletonDashboard() {
    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonCard key={i} />
                ))}
            </div>
            <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonRow key={i} />
                ))}
            </div>
        </div>
    );
}
