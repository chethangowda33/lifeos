import React, { useCallback, useEffect, useState } from "react";
import {
  Flag, Check, X, Plus, Trash2, Zap, Circle, RotateCcw, Trophy, Minus,
} from "lucide-react";

import api from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import LoadError from "@/components/LoadError";
import localDate from "@/lib/localDate";
import { dayGrid, statusLabel, ruleSummary, ruleProgress } from "@/features/challenges/challenges";
import { CHALLENGES } from "@/constants/testIds";

/* Challenges.

   A challenge is a run of days with rules that all have to be met. Wherever the
   app can already see the answer it checks itself — only what it genuinely
   cannot observe (pages read, a photo taken) is a tick. One runs at a time. */
export default function Challenges() {
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState(null);   // template being configured
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, t] = await Promise.all([
        api.get("/challenges", { params: { today: localDate() } }),
        api.get("/challenges/templates"),
      ]);
      setData(c.data);
      setTemplates(t.data.templates);
      setMetrics(t.data.metrics);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const start = async (body) => {
    setBusy(true);
    setError("");
    try {
      await api.post("/challenges", body);
      setStarting(null);
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || "Couldn't start that challenge.");
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (rule) => {
    if (rule.metric !== "manual") return;
    try {
      const { data: updated } = await api.post(`/challenges/${data.active.id}/log`, {
        rule_key: rule.key, done: !rule.met, date: localDate(),
      });
      setData((d) => ({
        ...d,
        active: updated,
        challenges: d.challenges.map((c) => (c.id === updated.id ? updated : c)),
      }));
    } catch {
      setError("Couldn't save that — check your connection.");
    }
  };

  const abandon = async () => {
    if (!window.confirm("Abandon this challenge? It stays in your history.")) return;
    await api.delete(`/challenges/${data.active.id}`);
    await load();
  };

  const header = (
    <div>
      <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Commit</div>
      <h1 className="text-4xl font-semibold tracking-tight mt-1">Challenges</h1>
      <p className="text-muted-foreground mt-1">
        A run of days with rules. The app checks off everything it can already see.
      </p>
    </div>
  );

  if (failed) {
    return (
      <div className="space-y-6 animate-fade-up" data-testid={CHALLENGES.root}>
        {header}
        <LoadError onRetry={load} what="your challenges" />
      </div>
    );
  }

  const active = data?.active;
  const past = (data?.challenges || []).filter((c) => c.id !== active?.id);

  return (
    <div className="space-y-6 animate-fade-up" data-testid={CHALLENGES.root}>
      {header}

      {error && <p className="text-sm text-amber-500">{error}</p>}

      {loading && !data && <Card className="p-8 h-32 animate-pulse bg-muted/40" />}

      {!loading && active && (
        <ActiveChallenge
          c={active} today={data.today} onToggle={toggleRule} onAbandon={abandon}
        />
      )}

      {!loading && !active && (
        <>
          <p className="text-sm text-muted-foreground">
            Pick one. You can only run a single challenge at a time — two sets of daily rules is
            a way to fail both.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {templates.map((t) => (
              <TemplateCard key={t.key} t={t} metrics={metrics} onStart={() => setStarting(t)} />
            ))}
            <CustomCard onStart={() => setStarting({ custom: true, name: "", days: 30, strict: false, rules: [] })} />
          </div>
        </>
      )}

      {past.length > 0 && <History past={past} />}

      {starting && (
        <StartDialog
          template={starting} metrics={metrics} busy={busy}
          onClose={() => { setStarting(null); setError(""); }}
          onConfirm={start}
        />
      )}
    </div>
  );
}

/* ── Active ────────────────────────────────────────────────────────────────── */

function ActiveChallenge({ c, today, onToggle, onAbandon }) {
  const grid = dayGrid(c, today);
  const upcoming = c.status === "upcoming";
  return (
    <>
      <Card className="p-5" data-testid={CHALLENGES.active}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight truncate">{c.name}</h2>
              {c.strict && (
                <Badge variant="outline" className="text-[10px] border-maroon/50 text-maroon shrink-0">
                  <Zap className="h-3 w-3 mr-1" /> Strict
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5" data-testid={CHALLENGES.status}>
              {statusLabel(c)}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onAbandon} data-testid={CHALLENGES.abandonButton}>
            Abandon
          </Button>
        </div>

        {c.description && <p className="text-sm text-muted-foreground mt-3">{c.description}</p>}

        <div className="h-2 rounded-full bg-muted mt-4 overflow-hidden">
          <div className="h-full rounded-full bg-maroon transition-all" style={{ width: `${c.percent}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground mt-2">
          <span>
            <span className="text-foreground font-medium">{c.streak}</span>{" "}
            {c.strict ? "in this run" : c.streak === 1 ? "day done" : "days done"}
          </span>
          <span><span className="text-foreground font-medium">{c.days - c.streak}</span> to go</span>
          {c.strict && c.restarts > 0 && (
            <span className="text-amber-500">
              <RotateCcw className="h-3 w-3 inline mr-1" />
              restarted {c.restarts}×
            </span>
          )}
          <span>Ends {c.end_date}</span>
        </div>
      </Card>

      {!upcoming && (
        <Card className="p-5" data-testid={CHALLENGES.today}>
          <h3 className="font-semibold tracking-tight mb-1">Today</h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Ticked rules are yours to mark. The rest are read from what you&apos;ve logged.
          </p>
          <div className="space-y-2">
            {c.today_rules.map((r) => (
              <RuleRow key={r.key} r={r} onToggle={() => onToggle(r)} />
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5" data-testid={CHALLENGES.grid}>
        <h3 className="font-semibold tracking-tight mb-4">All {c.days} days</h3>
        <div className="flex flex-wrap gap-1.5">
          {grid.map((d) => <DayCell key={d.date} d={d} />)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground mt-4">
          <Legend className="bg-maroon" label="Done" />
          <Legend className="bg-amber-500/70" label="Missed" />
          <Legend className="bg-maroon/30 ring-1 ring-maroon" label="Today" />
          <Legend className="bg-muted" label="To come" />
        </div>
      </Card>
    </>
  );
}

function Legend({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${className}`} />{label}
    </span>
  );
}

const CELL = {
  done: "bg-maroon",
  missed: "bg-amber-500/70",
  today: "bg-maroon/30 ring-1 ring-maroon",
  future: "bg-muted",
};

function DayCell({ d }) {
  return (
    <span
      className={`h-5 w-5 rounded-sm ${CELL[d.state]}`}
      title={`Day ${d.day} · ${d.date}${d.of ? ` · ${d.met}/${d.of} rules` : ""}`}
      data-testid={CHALLENGES.dayCell(d.day)}
      data-state={d.state}
    />
  );
}

function RuleRow({ r, onToggle }) {
  const manual = r.metric === "manual";
  const Icon = r.met ? Check : manual ? Circle : X;
  const body = (
    <>
      <span
        className={`h-7 w-7 rounded-lg grid place-items-center shrink-0 ${
          r.met ? "bg-maroon text-white" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className={`text-sm block truncate ${r.met ? "" : "text-muted-foreground"}`}>{r.label}</span>
        <span className="text-[11px] text-muted-foreground">
          {ruleProgress(r)}{manual ? "" : " · from your logs"}
        </span>
      </span>
    </>
  );
  return manual ? (
    <button
      type="button" onClick={onToggle}
      aria-pressed={r.met}
      aria-label={`${r.met ? "Undo" : "Mark done"}: ${r.label}`}
      data-testid={CHALLENGES.ruleToggle(r.key)}
      className="w-full flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted/50 transition-colors"
    >
      {body}
    </button>
  ) : (
    <div className="w-full flex items-center gap-3 p-2 -mx-2" data-testid={CHALLENGES.ruleRow(r.key)}>
      {body}
    </div>
  );
}

/* ── Choosing one ──────────────────────────────────────────────────────────── */

function TemplateCard({ t, metrics, onStart }) {
  return (
    <Card className="p-5 flex flex-col" data-testid={CHALLENGES.template(t.key)}>
      <div className="flex items-center gap-2">
        <Flag className="h-4 w-4 text-maroon" />
        <h3 className="font-semibold tracking-tight">{t.name}</h3>
        <Badge variant="outline" className="text-[10px] ml-auto">{t.days} days</Badge>
        {t.strict && (
          <Badge variant="outline" className="text-[10px] border-maroon/50 text-maroon">Strict</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-2 flex-1">{t.description}</p>
      <ul className="mt-3 space-y-1">
        {t.rules.map((r, i) => (
          <li key={i} className="text-[11px] text-muted-foreground flex gap-2">
            <span className="text-maroon">•</span>
            <span>{r.label} <span className="opacity-70">— {ruleSummary(r, metrics)}</span></span>
          </li>
        ))}
      </ul>
      <Button
        size="sm" onClick={onStart} data-testid={CHALLENGES.startButton(t.key)}
        className="mt-4 bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
      >
        Start {t.name}
      </Button>
    </Card>
  );
}

function CustomCard({ onStart }) {
  return (
    <Card className="p-5 flex flex-col border-dashed" data-testid={CHALLENGES.customCard}>
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-maroon" />
        <h3 className="font-semibold tracking-tight">Build your own</h3>
      </div>
      <p className="text-sm text-muted-foreground mt-2 flex-1">
        Any length, any rules. Mix things the app can check for you with things only you know.
      </p>
      <Button size="sm" variant="outline" onClick={onStart} className="mt-4">Create a challenge</Button>
    </Card>
  );
}

/* One dialog for both paths: a template arrives with its rules filled in, a
   custom challenge arrives empty. Numeric targets are editable either way —
   a fixed 2,000 kcal is useless to half the people who'd start it. */
function StartDialog({ template, metrics, busy, onClose, onConfirm }) {
  const [name, setName] = useState(template.name || "");
  const [days, setDays] = useState(String(template.days || 30));
  const [strict, setStrict] = useState(!!template.strict);
  const [rules, setRules] = useState(
    (template.rules || []).map((r) => ({ ...r, target: String(r.target ?? 1) })),
  );

  const setRule = (i, patch) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const addRule = () =>
    setRules((rs) => [...rs, { label: "", metric: "manual", target: "1" }]);

  const valid = name.trim() && Number(days) >= 1 && rules.length > 0
    && rules.every((r) => r.label.trim());

  const submit = () => onConfirm({
    name: name.trim(),
    description: template.description || "",
    days: Number(days),
    strict,
    template: template.key || null,
    start_date: localDate(),
    rules: rules.map((r) => ({
      label: r.label.trim(), metric: r.metric, target: Number(r.target) || 1,
    })),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.custom ? "Build a challenge" : `Start ${template.name}`}</DialogTitle>
          <DialogDescription>
            {template.custom
              ? "Give it a name, a length, and the rules you'll be held to."
              : "Adjust the targets to your own numbers before you commit."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground" htmlFor="ch-name">Name</label>
              <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)}
                     data-testid={CHALLENGES.nameInput} placeholder="30 days of…" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground" htmlFor="ch-days">Days</label>
              <Input id="ch-days" type="number" min="1" max="365" value={days}
                     data-testid={CHALLENGES.daysInput}
                     onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>

          <button
            type="button" onClick={() => setStrict((s) => !s)}
            aria-pressed={strict}
            aria-label="Strict mode — a missed day restarts the run"
            data-testid={CHALLENGES.strictToggle}
            className="w-full flex items-start gap-3 text-left p-3 rounded-lg border border-border hover:bg-muted/40"
          >
            <span className={`h-5 w-5 rounded grid place-items-center shrink-0 mt-0.5 ${
              strict ? "bg-maroon text-white" : "bg-muted text-muted-foreground"}`}>
              {strict ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            </span>
            <span>
              <span className="text-sm block">Strict — a missed day restarts the run</span>
              <span className="text-[11px] text-muted-foreground">
                Nothing is deleted; the count simply starts again from the day after a miss.
              </span>
            </span>
          </button>

          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground">Daily rules</div>
            {rules.map((r, i) => (
              <div key={i} className="flex gap-2 items-start" data-testid={CHALLENGES.ruleEditor(i)}>
                <div className="flex-1 min-w-0 space-y-1">
                  <Input
                    value={r.label} placeholder="What has to happen"
                    onChange={(e) => setRule(i, { label: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <select
                      value={r.metric}
                      onChange={(e) => setRule(i, { metric: e.target.value })}
                      className="flex-1 min-w-0 h-9 rounded-md border border-input bg-background px-2 text-xs"
                      aria-label="How this rule is checked"
                    >
                      {Object.entries(metrics).map(([k, m]) => (
                        <option key={k} value={k}>{m.label}</option>
                      ))}
                    </select>
                    {r.metric !== "manual" && r.metric !== "habits_all" && r.metric !== "intake_logged" && (
                      <Input
                        type="number" min="0" value={r.target} className="w-24 h-9 text-xs"
                        aria-label={`Target for ${r.label || `rule ${i + 1}`}`}
                        onChange={(e) => setRule(i, { target: e.target.value })}
                      />
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                  aria-label={`Remove rule ${i + 1}`}
                  onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {rules.length < 8 && (
              <Button variant="outline" size="sm" onClick={addRule} data-testid={CHALLENGES.addRuleButton}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add a rule
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit} disabled={!valid || busy} data-testid={CHALLENGES.confirmButton}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            {busy ? "Starting…" : "Start challenge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function History({ past }) {
  return (
    <Card className="p-5" data-testid={CHALLENGES.history}>
      <h3 className="font-semibold tracking-tight flex items-center gap-2 mb-4">
        <Trophy className="h-4 w-4 text-maroon" /> Past challenges
      </h3>
      <div className="space-y-2">
        {past.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {statusLabel(c)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
