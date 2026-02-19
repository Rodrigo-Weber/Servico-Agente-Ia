import { type SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    fullWidth?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, fullWidth = true, ...props }, ref) => {
    return (
        <select
            ref={ref}
            className={cn(
                "h-10 rounded-xl border border-white/10 bg-dark-700/80 px-3 text-sm text-white",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40",
                "disabled:cursor-not-allowed disabled:opacity-50",
                fullWidth && "w-full",
                className,
            )}
            {...props}
        />
    );
});

Select.displayName = "Select";
