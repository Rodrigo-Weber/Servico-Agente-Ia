import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "warning" | "info";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    secondary:
      "border-border bg-muted/50 text-muted-foreground",
    destructive:
      "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400",
    outline:
      "border-border bg-transparent text-muted-foreground",
    warning:
      "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    info:
      "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
