import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default:
      "border-green-500/30 bg-green-500/15 text-green-400",
    secondary:
      "border-white/10 bg-white/[0.06] text-white/70",
    destructive:
      "border-red-500/30 bg-red-500/15 text-red-400",
    outline:
      "border-white/15 bg-transparent text-white/60",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
