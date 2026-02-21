import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "../../lib/utils";

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastMessage {
    id: number;
    text: string;
    variant: ToastVariant;
}

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
    success: CheckCircle2,
    error: XCircle,
    info: Info,
    warning: AlertTriangle,
};

const VARIANT_STYLES: Record<ToastVariant, string> = {
    success: "border-green-500/30 bg-green-500/10 text-green-400",
    error: "border-red-500/30 bg-red-500/10 text-red-400",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
};

const DISMISS_MS = 5000;

let globalId = 0;

export function useToast() {
    const [messages, setMessages] = useState<ToastMessage[]>([]);

    const addToast = useCallback((text: string, variant: ToastVariant = "info") => {
        const id = ++globalId;
        setMessages((prev) => [...prev, { id, text, variant }]);
    }, []);

    const removeToast = useCallback((id: number) => {
        setMessages((prev) => prev.filter((msg) => msg.id !== id));
    }, []);

    const toast = useMemo(
        () => ({
            success: (text: string) => addToast(text, "success"),
            error: (text: string) => addToast(text, "error"),
            info: (text: string) => addToast(text, "info"),
            warning: (text: string) => addToast(text, "warning"),
        }),
        [addToast],
    );

    return { messages, removeToast, toast };
}

function ToastItem({ message, onDismiss }: { message: ToastMessage; onDismiss: () => void }) {
    const [visible, setVisible] = useState(false);
    const [exiting, setExiting] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        requestAnimationFrame(() => setVisible(true));

        timerRef.current = setTimeout(() => {
            setExiting(true);
            setTimeout(onDismiss, 300);
        }, DISMISS_MS);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [onDismiss]);

    function handleManualDismiss() {
        if (timerRef.current) clearTimeout(timerRef.current);
        setExiting(true);
        setTimeout(onDismiss, 300);
    }

    const Icon = ICONS[message.variant];

    return (
        <div
            className={cn(
                "flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-md transition-all duration-300 ease-out",
                VARIANT_STYLES[message.variant],
                visible && !exiting ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
            )}
        >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 text-sm font-semibold leading-snug">{message.text}</p>
            <button type="button" onClick={handleManualDismiss} className="shrink-0 rounded p-0.5 transition hover:bg-accent">
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

export function ToastContainer({ messages, removeToast }: { messages: ToastMessage[]; removeToast: (id: number) => void }) {
    if (messages.length === 0) return null;

    return (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
            {messages.map((msg) => (
                <div key={msg.id} className="pointer-events-auto">
                    <ToastItem message={msg} onDismiss={() => removeToast(msg.id)} />
                </div>
            ))}
        </div>
    );
}
