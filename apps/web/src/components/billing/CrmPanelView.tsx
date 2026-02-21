import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { MessageSquare, Send, User } from "lucide-react";
import { SkeletonDashboard } from "../ui/Skeleton";

interface CrmPanelViewProps {
    token: string;
}

export function CrmPanelView({ token }: CrmPanelViewProps) {
    const [conversations, setConversations] = useState<any[]>([]);
    const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [loadingConv, setLoadingConv] = useState(true);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [inputText, setInputText] = useState("");
    const [sending, setSending] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        async function load() {
            try {
                const data = await api.getBillingConversations(token);
                setConversations(data);
            } catch (err) {
                console.error("Error loading conversations", err);
            } finally {
                setLoadingConv(false);
            }
        }
        void load();
    }, [token]);

    useEffect(() => {
        if (!selectedPhone) return;

        async function loadMsgs() {
            setLoadingMsgs(true);
            try {
                const data = await api.getBillingMessages(token, selectedPhone!);
                setMessages(data);
            } catch (err) {
                console.error("Error loading mock messages", err);
            } finally {
                setLoadingMsgs(false);
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }
        }
        void loadMsgs();
    }, [selectedPhone, token]);

    async function handleSendMessage(e: React.FormEvent) {
        e.preventDefault();
        if (!inputText.trim() || !selectedPhone || sending) return;

        setSending(true);
        try {
            const newMsg = await api.sendBillingMessage(token, selectedPhone, inputText);
            setMessages((prev) => [...prev, newMsg]);
            setInputText("");
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
        } catch (err) {
            console.error("Failed to send message", err);
        } finally {
            setSending(false);
        }
    }

    if (loadingConv) {
        return <SkeletonDashboard />;
    }

    const selectedConv = conversations.find(c => c.phoneE164 === selectedPhone);

    return (
        <div className="flex h-[calc(100vh-140px)] gap-4 overflow-hidden rounded-xl border border-border bg-card">
            {/* Sidebar: Lista de Conversas */}
            <div className="w-1/3 flex-shrink-0 flex-col overflow-y-auto border-r border-border bg-card">
                <div className="sticky top-0 bg-card/80 p-4 font-semibold text-foreground backdrop-blur-md">
                    Conversas CRM
                </div>
                <div className="divide-y divide-border">
                    {conversations.length === 0 && (
                        <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
                    )}
                    {conversations.map((conv) => (
                        <button
                            key={conv.id}
                            onClick={() => setSelectedPhone(conv.phoneE164)}
                            className={`w-full p-4 text-left transition hover:bg-muted/50 ${selectedPhone === conv.phoneE164 ? "bg-muted" : ""
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-foreground">{conv.userName || conv.phoneE164}</span>
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{conv.lastMessage}</p>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Panel: Chat */}
            <div className="flex flex-1 flex-col bg-background">
                {selectedPhone ? (
                    <>
                        <div className="flex items-center gap-3 border-b border-border p-4 bg-card">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
                                <User className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="font-semibold text-foreground">{selectedConv?.userName || "Cliente"}</p>
                                <p className="text-xs text-muted-foreground">+{selectedPhone}</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {loadingMsgs ? (
                                <div className="flex justify-center p-4">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-green-500 border-t-transparent"></div>
                                </div>
                            ) : messages.length === 0 ? (
                                <p className="text-center text-sm text-muted-foreground">Nenhuma mensagem nesta conversa.</p>
                            ) : (
                                messages.map((msg) => {
                                    const isOut = msg.direction === "out";
                                    return (
                                        <div key={msg.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                                            <div className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${isOut
                                                ? "bg-green-600/20 text-foreground border border-green-500/20 rounded-tr-sm"
                                                : "bg-card text-foreground border border-border rounded-tl-sm"
                                                }`}>
                                                {msg.content}
                                                <div className="mt-1 text-[10px] opacity-50 text-right">
                                                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        <form onSubmit={handleSendMessage} className="border-t border-border p-4 bg-card">
                            <div className="relative flex items-center">
                                <input
                                    type="text"
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    placeholder="Digite uma mensagem..."
                                    className="w-full rounded-xl border border-input bg-background py-3 pl-4 pr-12 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                                    disabled={sending}
                                />
                                <button
                                    type="submit"
                                    disabled={sending || !inputText.trim()}
                                    className="absolute right-2 grid h-8 w-8 place-items-center rounded-lg bg-green-500/10 text-green-400 transition hover:bg-green-500/20 disabled:opacity-50"
                                >
                                    <Send className="h-4 w-4" />
                                </button>
                            </div>
                        </form>
                    </>
                ) : (
                    <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-6">
                        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-card border border-border">
                            <MessageSquare className="h-6 w-6 opacity-50" />
                        </div>
                        <p>Selecione uma conversa para ver as mensagens CRM</p>
                    </div>
                )}
            </div>
        </div>
    );
}
