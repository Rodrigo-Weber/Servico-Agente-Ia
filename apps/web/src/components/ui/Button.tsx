import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variants = {
      default:
        "bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-[0_0_20px_rgba(34,197,94,0.25)] hover:shadow-[0_0_30px_rgba(34,197,94,0.4)] hover:brightness-110",
      destructive:
        "bg-gradient-to-r from-red-600 to-red-700 text-white shadow-[0_0_15px_rgba(220,38,38,0.2)] hover:shadow-[0_0_25px_rgba(220,38,38,0.35)]",
      outline:
        "border border-white/15 bg-white/[0.04] text-white/80 hover:bg-white/[0.08] hover:text-white hover:border-white/25",
      secondary:
        "bg-white/[0.06] text-white/80 hover:bg-white/[0.1] hover:text-white",
      ghost:
        "text-white/50 hover:bg-white/[0.06] hover:text-white/90",
      link:
        "text-green-400 underline-offset-4 hover:underline hover:text-green-300",
    };

    const sizes = {
      default: "h-10 px-4 py-2",
      sm: "h-9 rounded-xl px-3 text-xs",
      lg: "h-11 rounded-xl px-8",
      icon: "h-10 w-10",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900",
          "disabled:pointer-events-none disabled:opacity-45",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { Button };
