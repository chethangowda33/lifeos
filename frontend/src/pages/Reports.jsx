import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Dumbbell, Weight, Layers, Clock, Trophy,
  Moon, Footprints, HeartPulse, Sparkles, RotateCw, Flame, Apple,
} from "lucide-react";

import api from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import LoadError from "@/components/LoadError";
import AiText from "@/components/AiText";
import localDate from "@/lib/localDate";
import { compact, fmtDuration } from "@/features/progress/analytics";
import { PERIODS, delta, barPct, relativeTime, sleepVerdict } from "@/features/reports/report";
import { REPORTS } from "@/constants/testIds";

/* One period, reviewed.

   Progress answers "how am I trending"; this answers "how did that week go" —
   the numbers for one closed slice of time, plus the coach's read of them. The
   split matters: every figure the narrative can cite is on the page as text
   beside it, so the AI is never the only source for a number. */
export default function Reports() {
  const [period, setPeriod] = useState("week");
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [writing, setWriting] = useState(false);
  const [aiError, setAiError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setAiError("");
    try {
      const { data } = await api.get("/reports", {
        params: { period, offset, today: localDate() },
      });
      setReport(data);
      setFailed(false);
    } catch {
      // The report IS the page — an empty state here would read as "you logged
      // nothing that week", which is the one thing it must never say wrongly.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [period, offset]);

  useEffect(() => { load(); }, [load]);

  const writeNarrative = async () => {
    setWriting(true);
    setAiError("");
    try {
      const { data } = await api.post("/reports/narrative", null, {
        params: { period, offset, today: localDate() },
      });
      if (data.configured === false) setAiError("Connect the AI coach to get a written report.");
      else setReport(data);
    } catch {
      setAiError("Couldn't write the report just now — try again in a moment.");
    } finally {
      setWriting(false);
    }
  };

  const noun = (PERIODS.find((p) => p.key === period) || PERIODS[0]).noun;

  const header = (
    <div>
      <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Review</div>
      <h1 className="text-4xl font-semibold tracking-tight mt-1">Reports</h1>
      <p className="text-muted-foreground mt-1">
        Your {noun} in numbers, with the coach&apos;s read on it.
      </p>
    </div>
  );

  if (failed) {
    return (
      <div className="space-y-6 animate-fade-up" data-testid={REPORTS.root}>
        {header}
        <LoadError onRetry={load} what="your report" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up" data-testid={REPORTS.root}>
      {header}

      {/* One control row scopes the whole page — same rule as Progress: every
          number below always describes the same slice of time. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              data-testid={REPORTS.periodTab(p.key)}
              onClick={() => { setPeriod(p.key); setOffset(0); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                period === p.key ? "bg-maroon text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1 ml-auto">
          <Button
            variant="outline" size="icon" className="h-8 w-8"
            data-testid={REPORTS.prevButton}
            aria-label={`Previous ${noun}`}
            onClick={() => setOffset((o) => o + 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="text-sm font-medium min-w-[10.5rem] text-center"
            data-testid={REPORTS.periodLabel}
          >
            {loading && !report ? "…" : report?.label}
          </span>
          <Button
            variant="outline" size="icon" className="h-8 w-8"
            data-testid={REPORTS.nextButton}
            aria-label={`Next ${noun}`}
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading && !report ? (
        <Skeleton />
      ) : !report?.has_data ? (
        <EmptyPeriod noun={noun} current={report?.current} />
      ) : (
        <>
          <Headline report={report} noun={noun} />
          <NarrativeCard
            report={report} noun={noun} writing={writing} error={aiError}
            onWrite={writeNarrative}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopExercises training={report.training} />
            <MuscleSplit training={report.training} />
          </div>
          <PRList prs={report.training.prs} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Recovery recovery={report.recovery} nutrition={report.nutrition} />
            <Habits habits={report.habits} />
          </div>
        </>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-4 h-24 animate-pulse bg-muted/40" />
      ))}
    </div>
  );
}

function EmptyPeriod({ noun, current }) {
  return (
    <Card className="p-10 text-center border-dashed" data-testid={REPORTS.empty}>
      <Dumbbell className="h-8 w-8 mx-auto text-muted-foreground" />
      <h3 className="mt-3 font-semibold">Nothing logged this {noun}</h3>
      <p className="text-sm text-muted-foreground mt-1">
        {current
          ? "Log a workout, a night's sleep or a habit and the report fills itself in."
          : "Step back further to find a period you were tracking."}
      </p>
      {current && (
        <Button asChild size="sm" className="mt-4 bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
          <Link to="/workout">Start a workout</Link>
        </Button>
      )}
    </Card>
  );
}

/* Headline four, each against the same period a week/month earlier. */
function Headline({ report, noun }) {
  const t = report.training;
  const p = report.previous;
  const cards = [
    {
      icon: Dumbbell, label: "Workouts", value: t.workouts,
      hint: `${t.days_trained} ${t.days_trained === 1 ? "day" : "days"} · target ${report.workout_target}`,
      d: delta(t.workouts, p.workouts), testId: REPORTS.statWorkouts,
    },
    {
      icon: Weight, label: "Volume", value: `${compact(t.volume_kg)} kg`,
      hint: t.workouts ? `${compact(Math.round(t.volume_kg / t.workouts))} kg per session` : "—",
      d: delta(t.volume_kg, p.volume_kg), testId: REPORTS.statVolume,
    },
    {
      icon: Layers, label: "Sets", value: t.sets,
      hint: `${t.prs.length} ${t.prs.length === 1 ? "record" : "records"} set`,
      d: delta(t.sets, p.sets), testId: REPORTS.statSets,
    },
    {
      icon: Clock, label: "Time", value: fmtDuration(t.duration_seconds),
      hint: t.workouts ? `${fmtDuration(t.duration_seconds / t.workouts)} per session` : "—",
      d: delta(t.duration_seconds, p.duration_seconds), testId: REPORTS.statTime,
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ icon: Icon, label, value, hint, d, testId }) => (
        <Card key={label} className="p-4" data-testid={testId}>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider">{label}</span>
          </div>
          <div className="text-2xl font-semibold tracking-tight mt-2">{value}</div>
          <div className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</div>
          <Delta d={d} noun={noun} />
        </Card>
      ))}
    </div>
  );
}

function Delta({ d, noun }) {
  if (!d) return <div className="h-4 mt-1" />;
  const tone = d.dir === "up" ? "text-emerald-500" : d.dir === "down" ? "text-amber-500" : "text-muted-foreground";
  const arrow = d.dir === "up" ? "↑" : d.dir === "down" ? "↓" : "→";
  // With no previous period to divide by there is no percentage to show —
  // saying so beats inventing a "+100%" against a week that never happened.
  return (
    <div className={`text-[11px] mt-1 ${tone}`}>
      {arrow} {d.pct === null ? "" : `${d.pct}% `}
      <span className="text-muted-foreground">
        {d.pct === null ? `none last ${noun}` : `vs last ${noun}`}
      </span>
    </div>
  );
}

/* The coach's read. Cached server-side: writing it is an explicit action, and a
   stale one says so rather than quietly describing numbers that have moved. */
function NarrativeCard({ report, noun, writing, error, onWrite }) {
  const n = report.narrative;
  return (
    <Card className="p-5" data-testid={REPORTS.narrative}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-maroon" /> Coach&apos;s read
        </h3>
        {n && !writing && (
          <button
            onClick={onWrite}
            data-testid={REPORTS.regenerateButton}
            className="text-[11px] text-maroon hover:underline inline-flex items-center gap-1"
          >
            <RotateCw className="h-3 w-3" /> Rewrite
          </button>
        )}
      </div>

      {writing && (
        <p className="text-sm text-muted-foreground py-3 text-center animate-pulse">
          Reading your {noun}…
        </p>
      )}

      {!writing && !n && (
        <div className="text-center py-3">
          <p className="text-sm text-muted-foreground mb-3">
            A written summary of the numbers above — wins, watch-outs, and one focus for next {noun}.
          </p>
          <Button
            size="sm" onClick={onWrite} data-testid={REPORTS.writeButton}
            disabled={!report.ai_configured}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Write my report
          </Button>
          {!report.ai_configured && (
            <p className="text-[11px] text-muted-foreground mt-2">The AI coach isn&apos;t connected yet.</p>
          )}
        </div>
      )}

      {!writing && n && (
        <>
          {n.stale && (
            <p className="text-[11px] text-amber-500 mb-2" data-testid={REPORTS.staleFlag}>
              Your numbers have changed since this was written — rewrite it for the current picture.
            </p>
          )}
          <AiText text={n.text} />
          <p className="text-[11px] text-muted-foreground mt-3">
            Written {relativeTime(n.generated_at)}{n.provider ? ` · ${n.provider}` : ""}
          </p>
        </>
      )}

      {error && <p className="text-sm text-muted-foreground mt-2">{error}</p>}
    </Card>
  );
}

/* A labelled bar row — the same shape used for exercises, muscles and habits so
   the page has one way of showing "share of the biggest". */
function BarRow({ label, value, sub, pct }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate">{label}</span>
        <span className="text-muted-foreground text-xs whitespace-nowrap">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
        <div className="h-full rounded-full bg-maroon" style={{ width: `${pct}%` }} />
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function TopExercises({ training }) {
  const rows = training.top_exercises;
  const max = rows.length ? rows[0].volume_kg : 0;
  return (
    <Card className="p-5" data-testid={REPORTS.topExercises}>
      <h3 className="font-semibold tracking-tight flex items-center gap-2 mb-4">
        <Flame className="h-4 w-4 text-maroon" /> Most volume
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sets logged in this period.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((x) => (
            <BarRow
              key={x.name} label={x.name} value={`${compact(x.volume_kg)} kg`}
              sub={`${x.sets} ${x.sets === 1 ? "set" : "sets"} · best e1RM ${Math.round(x.best_e1rm)} kg`}
              pct={barPct(x.volume_kg, max)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function MuscleSplit({ training }) {
  const rows = training.muscles;
  const max = rows.length ? rows[0].hard_sets : 0;
  return (
    <Card className="p-5" data-testid={REPORTS.muscles}>
      <h3 className="font-semibold tracking-tight flex items-center gap-2 mb-1">
        <Layers className="h-4 w-4 text-maroon" /> Hard sets by muscle
      </h3>
      <p className="text-[11px] text-muted-foreground mb-4">Working sets only — warm-ups and RPE under 6 excluded.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hard sets logged in this period.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((m) => (
            <BarRow
              key={m.muscle_group} label={<span className="capitalize">{m.muscle_group}</span>}
              value={`${m.hard_sets} sets`} pct={barPct(m.hard_sets, max)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function PRList({ prs }) {
  if (!prs.length) return null;
  return (
    <Card className="p-5" data-testid={REPORTS.prs}>
      <h3 className="font-semibold tracking-tight flex items-center gap-2 mb-4">
        <Trophy className="h-4 w-4 text-maroon" /> Records set ({prs.length})
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {prs.map((p, i) => (
          <div key={`${p.exercise}-${p.label}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{p.exercise}</span>
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {p.label} · <span className="text-foreground">{p.value}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-sm">
          <span className="font-medium">{value}</span>{" "}
          <span className="text-muted-foreground">{label}</span>
        </div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

function Recovery({ recovery, nutrition }) {
  const r = recovery;
  const nothing = !r.sleep_nights && !r.days_synced && !nutrition;
  return (
    <Card className="p-5" data-testid={REPORTS.recovery}>
      <h3 className="font-semibold tracking-tight flex items-center gap-2 mb-4">
        <Moon className="h-4 w-4 text-maroon" /> Recovery &amp; fuel
      </h3>
      {nothing ? (
        <p className="text-sm text-muted-foreground">
          No sleep, watch or intake data in this period — log a night&apos;s sleep and it appears here.
        </p>
      ) : (
        <div className="space-y-3">
          {r.sleep_avg_hours != null && (
            <Stat
              icon={Moon} value={`${r.sleep_avg_hours} h`} label="average sleep"
              sub={`${r.sleep_nights} ${r.sleep_nights === 1 ? "night" : "nights"} logged · ${sleepVerdict(r.sleep_avg_hours)}${
                r.sleep_quality != null ? ` · quality ${r.sleep_quality}/5` : ""
              }`}
            />
          )}
          {r.steps_avg != null && (
            <Stat icon={Footprints} value={compact(r.steps_avg)} label="steps a day"
              sub={`${r.days_synced} ${r.days_synced === 1 ? "day" : "days"} synced from your watch`} />
          )}
          {r.resting_hr_avg != null && (
            <Stat icon={HeartPulse} value={`${r.resting_hr_avg} bpm`} label="resting heart rate"
              sub={r.hrv_avg != null ? `HRV ${r.hrv_avg} ms` : null} />
          )}
          {nutrition && (
            <Stat icon={Apple} value={`${compact(nutrition.avg_calories)} kcal`} label="a day"
              sub={`${nutrition.avg_protein_g} g protein · ${nutrition.days_logged} ${
                nutrition.days_logged === 1 ? "day" : "days"} logged`} />
          )}
        </div>
      )}
    </Card>
  );
}

function Habits({ habits }) {
  return (
    <Card className="p-5" data-testid={REPORTS.habits}>
      <h3 className="font-semibold tracking-tight flex items-center gap-2 mb-4">
        <Flame className="h-4 w-4 text-maroon" /> Habits
      </h3>
      {habits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No habits tracked in this period. <Link to="/habits" className="text-maroon hover:underline">Add one →</Link>
        </p>
      ) : (
        <div className="space-y-3">
          {habits.map((h) => (
            <BarRow
              key={h.name}
              label={`${h.emoji ? `${h.emoji} ` : ""}${h.name}`}
              value={`${h.done}/${h.days} days`}
              pct={barPct(h.done, h.days)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
