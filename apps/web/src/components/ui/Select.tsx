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
                "h-10 rounded-lg border border-input bg-background/50 px-3 text-sm text-foreground shadow-inner-glow",
                "transition-all duration-200 hover:border-primary/30",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:border-primary/50",
                "disabled:cursor-not-allowed disabled:opacity-50",
                fullWidth && "w-full",
                className,
            )}
            {...props}
        />
    );
});

Select.displayName = "Select";
