import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Wand2, Send, AlertTriangle, MessageSquarePlus, RotateCw, Check, X,
} from "lucide-react";
import { ASSISTANT } from "@/constants/testIds";

const QUICK_PROMPTS = [
  "Create a Push/Pull/Legs split for me",
  "Log my workout: bench press 3 sets of 60kg x 10",
  "Add lateral raises and face pulls to my Pull Day",
  "I slept 7.5 hours last night, log it",
];

const HISTORY_KEY = "lifeos:assistant:v1:history";
const HISTORY_LIMIT = 30;

/* ── Minimal markdown: **bold**, `code`, bullet & numbered lists. ─────────────── */
function renderInline(text) {
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
        if (p.startsWith("**") && p.endsWith("**")) parts.push(<strong key={`b-${i}-${j}`}>{p.slice(2, -2)}</strong>);
        else if (p) parts.push(<span key={`t-${i}-${j}`}>{p}</span>);
      });
    }
  });
  return parts;
}

function Markdown({ text }) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let list = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l-${blocks.length}`} className={`${list.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}>
        {list.items.map((l, i) => <li key={i}>{renderInline(l)}</li>)}
      </Tag>,
    );
    list = null;
  };
  lines.forEach((ln, idx) => {
    const t = ln.trim();
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
      if (t) blocks.push(<p key={`p-${idx}`} className="leading-relaxed">{renderInline(t)}</p>);
    }
  });
  flush();
  return <div className="space-y-2 text-sm">{blocks}</div>;
}

/* ── Action chips: what the assistant actually did. ───────────────────────────── */
function Actions({ actions }) {
  if (!actions?.length) return null;
  // Show successes if any; otherwise surface the failures so the user knows why.
  const successes = actions.filter((a) => a.ok);
  const shown = successes.length ? successes : actions;
  return (
    <div className="mt-2.5 pt-2 border-t border-border/60 space-y-1.5">
      {shown.map((a, i) => (
        <div key={i} data-testid={ASSISTANT.action} className="flex items-start gap-1.5 text-xs">
          <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full flex items-center justify-center ${
            a.ok ? "bg-[hsl(var(--maroon)/0.15)] text-maroon" : "bg-destructive/15 text-destructive"
          }`}>
            {a.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
          </span>
          <span className={a.ok ? "text-foreground" : "text-destructive"}>{a.summary}</span>
        </div>
      ))}
    </div>
  );
}

/* ── History persistence ──────────────────────────────────────────────────────── */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.messages) ? parsed.messages.slice(-HISTORY_LIMIT) : [];
  } catch { return []; }
}
function saveHistory(messages) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ v: 1, messages: messages.slice(-HISTORY_LIMIT) }));
  } catch { /* quota — ignore */ }
}

function useAutosize(ref, value, max = 140) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, value, max]);
}

export default function Assistant() {
  const [messages, setMessages] = useState(() => loadHistory());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [errored, setErrored] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  useAutosize(inputRef, input);

  useEffect(() => { api.get("/assistant/status").then(({ data }) => setStatus(data)).catch(() => {}); }, []);
  useEffect(() => { saveHistory(messages); }, [messages]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 60); return () => clearTimeout(t); }, []);

  const doSend = useCallback(async (msgs) => {
    setLoading(true);
    setErrored(false);
    try {
      const { data } = await api.post("/assistant/chat", {
        messages: msgs.map(({ role, content }) => ({ role, content })),
      });
      setMessages((m) => [...m, { role: "assistant", content: data.reply, actions: data.actions, at: Date.now() }]);
      if (typeof data.configured === "boolean") setStatus((s) => ({ ...(s || {}), configured: data.configured }));
    } catch (e) {
      setErrored(true);
      setMessages((m) => [...m, {
        role: "assistant",
        content: `Sorry — that didn't go through. ${e.response?.data?.detail || e.message}`,
        error: true, at: Date.now(),
      }]);
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
    setMessages((m) => {
      const stripped = m[m.length - 1]?.error ? m.slice(0, -1) : m;
      const lastUserIdx = [...stripped].reverse().findIndex((x) => x.role === "user");
      if (lastUserIdx < 0) return stripped;
      const upto = stripped.slice(0, stripped.length - lastUserIdx);
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

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const notConfigured = status && status.configured === false;
  const showQuickPrompts = messages.length === 0;
  const lastIsUserOrError = useMemo(() => {
    const last = messages[messages.length - 1];
    return last && (last.role === "user" || last.error);
  }, [messages]);

  return (
    <div data-testid={ASSISTANT.root} className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-9rem)] animate-fade-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Assistant</div>
          <h1 className="text-3xl font-semibold tracking-tight mt-1 flex items-center gap-2">
            <Wand2 className="h-6 w-6 text-maroon" /> AI Assistant
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tell me what to do and I&apos;ll do it — create routines, add exercises, log workouts, habits &amp; sleep.
          </p>
        </div>
        {messages.length > 0 && (
          <Button data-testid={ASSISTANT.newChatButton} variant="outline" size="sm" onClick={newChat} className="shrink-0">
            <MessageSquarePlus className="h-4 w-4 mr-1.5" /> New chat
          </Button>
        )}
      </div>

      {notConfigured && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[hsl(var(--maroon)/0.3)] bg-[hsl(var(--maroon)/0.06)] px-3 py-2 text-xs">
          <AlertTriangle className="h-4 w-4 text-maroon shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            The assistant isn&apos;t connected to an LLM yet. Add
            {" "}<span className="font-mono text-foreground">GROQ_API_KEY</span> (free) or
            {" "}<span className="font-mono text-foreground">ANTHROPIC_API_KEY</span> to
            {" "}<span className="font-mono text-foreground">backend/.env</span> and restart the backend.
          </span>
        </div>
      )}

      {/* Messages */}
      <Card className="flex-1 overflow-hidden flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {showQuickPrompts ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="h-12 w-12 rounded-2xl bg-[hsl(var(--maroon)/0.1)] text-maroon flex items-center justify-center">
                <Wand2 className="h-6 w-6" />
              </div>
              <h3 className="mt-3 font-semibold">What should I do for you?</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                I can build and edit your routines, log workouts and sets, tick habits, and log sleep &amp; body stats — just ask in plain English.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 justify-center">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    data-testid={ASSISTANT.quickPrompt}
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
              <div key={i} data-testid={ASSISTANT.message} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  m.role === "user"
                    ? "bg-gradient-to-br from-[hsl(var(--maroon))] to-[hsl(var(--maroon-hover))] text-white rounded-br-md elev-accent"
                    : m.error
                      ? "bg-destructive/10 border border-destructive/30 rounded-bl-md"
                      : "bg-muted border border-border/60 rounded-bl-md"
                }`}>
                  {m.role === "user"
                    ? <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    : <><Markdown text={m.content} />{!m.error && <Actions actions={m.actions} />}</>}
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
              <Button data-testid={ASSISTANT.retryButton} variant="outline" size="sm" onClick={retryLast} className="text-xs h-7">
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
              data-testid={ASSISTANT.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="e.g. Create a Push Day with bench, overhead press and dips… (Enter to send)"
              rows={1}
              className="resize-none min-h-[44px] max-h-[140px] overflow-y-auto"
            />
            <Button
              data-testid={ASSISTANT.sendButton}
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
