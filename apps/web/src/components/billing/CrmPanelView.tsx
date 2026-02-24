import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { BillingConversation, BillingMessage } from "../../types";
import {
  Clock3,
  Loader2,
  MessageSquare,
  Phone,
  Search,
  Send,
  Trash2,
  User,
} from "lucide-react";
import { SkeletonDashboard } from "../ui/Skeleton";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/Card";
import { ToastContainer, useToast } from "../ui/Toast";

interface CrmPanelViewProps {
  token: string;
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  return isToday
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function getConversationName(conversation: BillingConversation): string {
  return conversation.userName?.trim() || `+${conversation.phoneE164}`;
}

function getInitials(conversation: BillingConversation): string {
  const name = getConversationName(conversation)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();

  if (!name) {
    return "CR";
  }

  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";

  return `${first}${second || ""}`.toUpperCase();
}

function formatMessageTime(value: string): string {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function CrmPanelView({ token }: CrmPanelViewProps) {
  const [conversations, setConversations] = useState<BillingConversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [crmMessages, setCrmMessages] = useState<BillingMessage[]>([]);
  const [loadingConv, setLoadingConv] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages: toastMessages, removeToast, toast } = useToast();

  const loadConversations = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoadingConv(true);
      }

      try {
        const data = await api.getBillingConversations(token);
        setConversations(data);

        setSelectedPhone((current) => {
          if (data.length === 0) {
            return null;
          }

          if (current && data.some((item) => item.phoneE164 === current)) {
            return current;
          }

          return data[0]?.phoneE164 ?? null;
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao carregar conversas do CRM.");
      } finally {
        if (!options?.silent) {
          setLoadingConv(false);
        }
      }
    },
    [token, toast],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedPhone) {
      setCrmMessages([]);
      return;
    }

    const phone = selectedPhone;

    async function loadMessages() {
      setLoadingMsgs(true);
      try {
        const data = await api.getBillingMessages(token, phone);
        setCrmMessages(data);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao carregar mensagens.");
      } finally {
        setLoadingMsgs(false);
      }
    }

    void loadMessages();
  }, [selectedPhone, token, toast]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [crmMessages, loadingMsgs]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.phoneE164 === selectedPhone) ?? null,
    [conversations, selectedPhone],
  );

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      const userName = (conversation.userName || "").toLowerCase();
      const phone = conversation.phoneE164.toLowerCase();
      const lastMessage = conversation.lastMessage.toLowerCase();
      return userName.includes(query) || phone.includes(query) || lastMessage.includes(query);
    });
  }, [conversations, search]);

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedPhone || !inputText.trim() || sending) {
      return;
    }

    const content = inputText.trim();
    setSending(true);

    try {
      const created = await api.sendBillingMessage(token, selectedPhone, content);
      setCrmMessages((prev) => [...prev, created]);
      setInputText("");

      setConversations((prev) =>
        [...prev]
          .map((conversation) =>
            conversation.phoneE164 === selectedPhone
              ? {
                ...conversation,
                lastMessage: created.content,
                lastActivityAt: created.createdAt,
              }
              : conversation,
          )
          .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteConversation() {
    if (!selectedPhone || deletingConversation) {
      return;
    }

    const phone = selectedPhone;
    setDeletingConversation(true);

    try {
      await api.deleteBillingConversation(token, phone);
      setConfirmDeleteOpen(false);
      setCrmMessages([]);
      toast.success("Conversa excluida com sucesso.");
      await loadConversations({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel excluir a conversa.");
    } finally {
      setDeletingConversation(false);
    }
  }

  if (loadingConv) {
    return <SkeletonDashboard />;
  }

  return (
    <>
      <div className="grid h-[calc(100vh-150px)] min-h-[560px] grid-cols-1 gap-4 md:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/80">
          <div className="border-b border-border bg-muted/10 p-4">
            <h2 className="text-lg font-bold text-foreground">CRM Financeiro</h2>
            <p className="mt-1 text-xs text-muted-foreground">Central de conversas com clientes e histórico de cobrança.</p>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar conversa..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {filteredConversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border p-4 text-center">
                <MessageSquare className="mb-2 h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Nenhuma conversa encontrada</p>
                <p className="mt-1 text-xs text-muted-foreground">Ajuste a busca ou aguarde novas mensagens.</p>
              </div>
            ) : (
              filteredConversations.map((conversation) => {
                const selected = conversation.phoneE164 === selectedPhone;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedPhone(conversation.phoneE164)}
                    className={`w-full rounded-xl border p-3 text-left transition ${selected
                        ? "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]"
                        : "border-border bg-card/40 hover:border-emerald-500/30 hover:bg-muted/40"
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted font-semibold text-foreground">
                        {getInitials(conversation)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">{getConversationName(conversation)}</p>
                          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {formatConversationTime(conversation.lastActivityAt)}
                          </span>
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">+{conversation.phoneE164}</p>
                      </div>
                    </div>
                    <p className="mt-2 truncate text-xs text-muted-foreground">{conversation.lastMessage}</p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/80">
          {selectedConversation ? (
            <>
              <header className="flex items-center justify-between gap-4 border-b border-border bg-muted/10 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{getConversationName(selectedConversation)}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      <span>+{selectedConversation.phoneE164}</span>
                      <Clock3 className="h-3.5 w-3.5" />
                      <span>Atividade {formatConversationTime(selectedConversation.lastActivityAt)}</span>
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir chat
                </Button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto bg-background p-4">
                {loadingMsgs ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                  </div>
                ) : crmMessages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/30 p-6 text-center">
                    <MessageSquare className="mb-3 h-6 w-6 text-muted-foreground" />
                    <p className="text-sm font-semibold text-foreground">Nenhuma mensagem nesta conversa</p>
                    <p className="mt-1 text-xs text-muted-foreground">Envie uma mensagem para iniciar o atendimento.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {crmMessages.map((message) => {
                      const outgoing = message.direction === "out";
                      return (
                        <div key={message.id} className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[85%] rounded-2xl border px-4 py-2.5 shadow-sm ${outgoing
                                ? "rounded-br-md border-primary/20 bg-primary/10"
                                : "rounded-bl-md border-border bg-muted/20"
                              }`}
                          >
                            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{message.content}</p>
                            <div className="mt-1.5 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
                              <span>{outgoing ? "Voce" : "Cliente"}</span>
                              <span>•</span>
                              <span>{formatMessageTime(message.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="border-t border-border bg-background/80 p-4">
                <div className="flex items-end gap-2">
                  <textarea
                    value={inputText}
                    onChange={(event) => setInputText(event.target.value)}
                    placeholder="Digite uma mensagem para o cliente..."
                    rows={2}
                    disabled={sending}
                    className="min-h-[72px] w-full resize-none rounded-xl border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <Button type="submit" disabled={sending || !inputText.trim()} className="h-[42px] px-4">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    {sending ? "Enviando" : "Enviar"}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-border bg-card">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground">Selecione uma conversa</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Escolha um cliente na lista ao lado para visualizar o histórico e continuar o atendimento.
              </p>
            </div>
          )}
        </section>
      </div>

      {confirmDeleteOpen && selectedConversation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar popup"
            className="absolute inset-0 bg-background/85 backdrop-blur-sm"
            onClick={() => {
              if (!deletingConversation) {
                setConfirmDeleteOpen(false);
              }
            }}
          />

          <Card className="relative z-10 w-full max-w-lg border-border">
            <CardHeader>
              <CardTitle>Excluir conversa CRM</CardTitle>
              <CardDescription>
                Esta ação remove o histórico do chat para <strong>+{selectedConversation.phoneE164}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                A exclusão apaga as mensagens e o contexto dessa conversa no CRM. Esta ação não pode ser desfeita.
              </p>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={deletingConversation}
                >
                  Cancelar
                </Button>
                <Button type="button" variant="destructive" onClick={() => void handleDeleteConversation()} disabled={deletingConversation}>
                  {deletingConversation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  {deletingConversation ? "Excluindo..." : "Excluir chat"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <ToastContainer messages={toastMessages} removeToast={removeToast} />
    </>
  );
}
