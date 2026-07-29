import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Send, BookOpen, AlertTriangle, MessageSquarePlus, Copy, Check, RotateCw,
} from "lucide-react";
import { COACH } from "@/constants/testIds";
import { useToast } from "@/hooks/use-toast";
import CoachPlanAction from "@/features/intake/CoachPlanAction";

const QUICK_PROMPTS = [
  "How much protein should I eat to build muscle?",
  "Am I training legs enough this week?",
  "Why am I sore after leg day, and how do I recover?",
  "Design a simple weekly split around my plans.",
];

const HISTORY_KEY = "lifeos:coach:v1:history";
const HISTORY_LIMIT = 30; // keep the last N messages

/* ── Minimal, safe markdown: headings, **bold**, `code`, bullet & numbered lists. ── */
function renderInline(text) {
  // Split by inline code first, then walk each chunk for **bold**.
  const parts = [];
  text.split(/(`[^`]+`)/g).forEach((chunk, i) => {
    if (chunk.startsWith("`") && chunk.endsWith("`")) {
      parts.push(
        <code key={`c-${i}`} className="rounded bg-background/70 border border-border/60 px-1 py-[1px] font-mono text-[0.85em]">
          {chunk.slice(1, -1)}
        </code>,
      );
    } else {
      chunk.split(/(\*\*[^*]+\*\*)/g).forEach((p, j) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          parts.push(<strong key={`b-${i}-${j}`}>{p.slice(2, -2)}</strong>);
        } else if (p) {
          parts.push(<span key={`t-${i}-${j}`}>{p}</span>);
        }
      });
    }
  });
  return parts;
}

function Markdown({ text }) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let list = null; // { ordered: bool, items: [] }

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag
        key={`l-${blocks.length}`}
        className={`${list.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}
      >
        {list.items.map((l, i) => <li key={i}>{renderInline(l)}</li>)}
      </Tag>,
    );
    list = null;
  };

  lines.forEach((ln, idx) => {
    const t = ln.trim();
    const h = t.match(/^(#{1,3})\s+(.+)$/);
    const ul = t.match(/^[-*•]\s+(.+)$/);
    const ol = t.match(/^\d+[.)]\s+(.+)$/);
    if (ul) {
      if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; }
      list.items.push(ul[1]);
    } else if (ol) {
      if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; }
      list.items.push(ol[1]);
    } else {
      flush();
      if (h) {
        const level = h[1].length;
        const cls =
          level === 1 ? "text-base font-semibold mt-1"
          : level === 2 ? "text-sm font-semibold mt-1"
          : "text-xs uppercase tracking-widest text-muted-foreground mt-1";
        blocks.push(<div key={`h-${idx}`} className={cls}>{renderInline(h[2])}</div>);
      } else if (t) {
        blocks.push(<p key={`p-${idx}`} className="leading-relaxed">{renderInline(t)}</p>);
      }
    }
  });
  flush();
  return <div className="space-y-2 text-sm">{blocks}</div>;
}

/* ── History persistence ─────────────────────────────────────────────────── */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.messages) ? parsed.messages.slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ v: 1, messages: messages.slice(-HISTORY_LIMIT), savedAt: Date.now() }),
    );
  } catch { /* quota — ignore */ }
}

/* ── Auto-resizing textarea ──────────────────────────────────────────────── */
function useAutosize(ref, value, max = 140) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, value, max]);
}

export default function Coach() {
  const { toast } = useToast();
  const [messages, setMessages] = useState(() => loadHistory());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [errored, setErrored] = useState(false); // last send failed?
  const [copiedIdx, setCopiedIdx] = useState(-1);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  useAutosize(inputRef, input);

  // Coach status (provider / kb size)
  useEffect(() => {
    api.get("/coach/status").then(({ data }) => setStatus(data)).catch(() => {});
  }, []);

  // Persist history
  useEffect(() => { saveHistory(messages); }, [messages]);

  // Auto-scroll to bottom on new message or while loading
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Focus the input when Coach loads
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const doSend = useCallback(async (msgs) => {
    setLoading(true);
    setErrored(false);
    try {
      const { data } = await api.post("/coach/chat", {
        messages: msgs.map(({ role, content }) => ({ role, content })),
      });
      setMessages((m) => [...m, { role: "assistant", content: data.reply, sources: data.sources, at: Date.now() }]);
      if (typeof data.configured === "boolean") setStatus((s) => ({ ...(s || {}), configured: data.configured }));
    } catch (e) {
      setErrored(true);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Sorry — I couldn't reach the coach. ${e.response?.data?.detail || e.message}`,
          error: true,
          at: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  const send = (text) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    const next = [...messages, { role: "user", content: q, at: Date.now() }];
    setMessages(next);
    setInput("");
    doSend(next);
  };

  const retryLast = () => {
    // Drop the last assistant-error message, resend from the last user message.
    setMessages((m) => {
      const stripped = m[m.length - 1]?.error ? m.slice(0, -1) : m;
      const lastUserIdx = [...stripped].reverse().findIndex((x) => x.role === "user");
      if (lastUserIdx < 0) return stripped;
      const cut = stripped.length - lastUserIdx;
      const upto = stripped.slice(0, cut);
      doSend(upto);
      return upto;
    });
  };

  const newChat = () => {
    if (messages.length && !window.confirm("Start a new chat? The current conversation will be cleared.")) return;
    setMessages([]);
    setErrored(false);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const copyMessage = async (idx, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(-1), 1400);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const notConfigured = status && status.configured === false;
  const showQuickPrompts = messages.length === 0;
  const lastIsUserOrError = useMemo(() => {
    const last = messages[messages.length - 1];
    return last && (last.role === "user" || last.error);
  }, [messages]);

  return (
    <div data-testid={COACH.root} className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-9rem)] animate-fade-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Coach</div>
          <h1 className="text-3xl font-semibold tracking-tight mt-1 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-maroon" /> AI Coach
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Grounded in your workouts, plans &amp; body metrics{status?.knowledge_chunks ? ` + ${status.knowledge_chunks} fitness notes` : ""}.
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            data-testid={COACH.newChatButton}
            variant="outline"
            size="sm"
            onClick={newChat}
            className="shrink-0"
          >
            <MessageSquarePlus className="h-4 w-4 mr-1.5" /> New chat
          </Button>
        )}
      </div>

      {notConfigured && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[hsl(var(--maroon)/0.3)] bg-[hsl(var(--maroon)/0.06)] px-3 py-2 text-xs">
          <AlertTriangle className="h-4 w-4 text-maroon shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            The coach isn&apos;t connected to an LLM yet. Add
            {" "}<span className="font-mono text-foreground">GROQ_API_KEY</span> (free) or
            {" "}<span className="font-mono text-foreground">ANTHROPIC_API_KEY</span> to
            {" "}<span className="font-mono text-foreground">backend/.env</span> and restart the backend. Retrieval &amp; your data are already working.
          </span>
        </div>
      )}

      {/* Messages */}
      <Card className="flex-1 overflow-hidden flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {showQuickPrompts ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="h-12 w-12 rounded-2xl bg-[hsl(var(--maroon)/0.1)] text-maroon flex items-center justify-center">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="mt-3 font-semibold">Ask your coach anything</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                It sees your real training data and answers from a fitness knowledge base — no generic advice.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 justify-center">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    data-testid={COACH.quickPrompt}
                    onClick={() => send(p)}
                    className="text-xs rounded-full border border-border px-3 py-1.5 hover:border-[hsl(var(--maroon)/0.5)] hover:text-maroon transition text-left"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                data-testid={COACH.message}
                className={`group flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 relative ${
                    m.role === "user"
                      ? "bg-gradient-to-br from-[hsl(var(--maroon))] to-[hsl(var(--maroon-hover))] text-white rounded-br-md elev-accent"
                      : m.error
                        ? "bg-destructive/10 border border-destructive/30 rounded-bl-md"
                        : "bg-muted border border-border/60 rounded-bl-md"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <>
                      <Markdown text={m.content} />
                      {m.sources?.length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-border/60 flex flex-wrap items-center gap-1.5">
                          <BookOpen className="h-3 w-3 text-muted-foreground" />
                          {m.sources.map((s) => (
                            <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                          ))}
                        </div>
                      )}
                      {/* Coach proposes, you dispose — reads targets/meals out of
                          this reply and lets you apply them to Intake. */}
                      {!m.error && (
                        <CoachPlanAction messages={messages.slice(Math.max(0, i - 1), i + 1)} />
                      )}
                      {!m.error && (
                        <button
                          data-testid={COACH.copyButton}
                          onClick={() => copyMessage(i, m.content)}
                          aria-label="Copy reply"
                          /* Always visible on touch — there is no hover on a phone,
                             so hover-only reveal made Copy unreachable there. */
                          className="absolute -bottom-2 -right-2 h-7 w-7 rounded-full bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition flex items-center justify-center"
                        >
                          {copiedIdx === i
                            ? <Check className="h-3.5 w-3.5 text-green-600" />
                            : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-maroon/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 rounded-full bg-maroon/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 rounded-full bg-maroon/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          {errored && !loading && lastIsUserOrError && (
            <div className="flex justify-start">
              <Button
                data-testid={COACH.retryButton}
                variant="outline"
                size="sm"
                onClick={retryLast}
                className="text-xs h-7"
              >
                <RotateCw className="h-3 w-3 mr-1.5" /> Retry
              </Button>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              data-testid={COACH.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about training, nutrition, recovery… (Enter to send · Shift+Enter for newline)"
              rows={1}
              className="resize-none min-h-[44px] max-h-[140px] overflow-y-auto"
            />
            <Button
              data-testid={COACH.sendButton}
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white h-11 w-11 p-0 shrink-0"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
