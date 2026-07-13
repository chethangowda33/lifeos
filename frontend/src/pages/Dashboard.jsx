import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/api";
import Onboarding from "@/components/Onboarding";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from "recharts";
import {
  Dumbbell, Flame, TrendingUp, Scale, Trophy, Play, ArrowRight,
  Activity, Timer, Sparkles,
} from "lucide-react";
import { DASHBOARD } from "@/constants/testIds";

/* ── helpers ─────────────────────────────────────────────────────────────── */
const pad = (n) => String(n).padStart(2, "0");
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function startOfWeek(input) {
  const x = new Date(input);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

function fmtVol(n) {
  const v = Math.round(n || 0);
  return v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(v);
}

function fmtDuration(secs) {
  if (!secs) return "0m";
  const m = Math.floor(secs / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ── page ────────────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [workouts, setWorkouts] = useState([]);
  const [stats, setStats] = useState({ total_workouts: 0, total_volume: 0, total_sets: 0, total_duration: 0 });
  const [routines, setRoutines] = useState([]);
  const [bmi, setBmi] = useState(null);
  const [recovery, setRecovery] = useState([]); // muscle recovery status
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [w, s, r, m, mv] = await Promise.all([
          api.get("/workouts"),
          api.get("/workouts/stats"),
          api.get("/routines"),
          api.get("/body-metrics/latest").catch(() => ({ data: {} })),
          api.get("/workouts/muscle-volume").catch(() => ({ data: [] })),
        ]);
        if (!alive) return;
        setWorkouts(w.data || []);
        setStats(s.data || {});
        setRoutines(r.data || []);
        setBmi(m.data?.bmi?.value ?? null);
        setRecovery(mv.data || []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const derived = useMemo(() => computeDerived(workouts), [workouts]);

  // First-run onboarding — only for brand-new accounts that haven't seen it.
  useEffect(() => {
    if (loading) return;
    const seen = (() => { try { return localStorage.getItem("lifeos:onboarded"); } catch { return "1"; } })();
    if (!seen && workouts.length === 0 && routines.length === 0) setShowOnboarding(true);
  }, [loading, workouts, routines]);

  const finishOnboarding = ({ goal }) => {
    try {
      localStorage.setItem("lifeos:onboarded", "1");
      if (goal) localStorage.setItem("lifeos:reco-goal", goal);
    } catch { /* ignore */ }
    setShowOnboarding(false);
    if (goal) navigate("/workout");
  };

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = (user?.name || "Athlete").split(" ")[0];
  const weight = user?.profile?.weight_kg;

  /* Resume target: last routine trained → first routine → empty */
  const lastRoutineId = workouts.find((w) => w.routine_id)?.routine_id;
  const resumeRoutine =
    routines.find((r) => r.id === lastRoutineId) || routines[0] || null;

  return (
    <div data-testid={DASHBOARD.root} className="max-w-6xl space-y-6 animate-fade-up">
      <Onboarding open={showOnboarding} onComplete={finishOnboarding} />

      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-maroon font-semibold">{greet}</div>
          <h1 data-testid={DASHBOARD.greeting} className="text-4xl md:text-5xl font-semibold tracking-tight mt-1">
            Hello, {firstName}.
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl">
            Here&apos;s your training at a glance — momentum, records, and what&apos;s next.
          </p>
        </div>
      </div>

      {/* Today band — weekly goal ring + streak + muscle recovery */}
      <TodayHero
        weekCount={derived.weekCount}
        target={4}
        streak={derived.streak}
        recovery={recovery}
        loading={loading}
      />

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          testId={DASHBOARD.statThisWeek}
          icon={Activity}
          label="This week"
          value={loading ? "—" : derived.weekCount}
          unit={derived.weekCount === 1 ? "workout" : "workouts"}
          hint={loading ? "" : `${fmtVol(derived.weekVolume)} kg volume`}
          accent
        />
        <StatCard
          testId={DASHBOARD.statStreak}
          icon={Flame}
          label="Current streak"
          value={loading ? "—" : derived.streak}
          unit={derived.streak === 1 ? "day" : "days"}
          hint={loading ? "" : derived.streak > 0 ? "Keep it alive 🔥" : "Train today to start"}
        />
        <StatCard
          testId={DASHBOARD.statVolume}
          icon={Dumbbell}
          label="Total volume"
          value={loading ? "—" : `${fmtVol(stats.total_volume)}`}
          unit="kg lifted"
          hint={loading ? "" : `${stats.total_workouts} workouts · ${fmtDuration(stats.total_duration)}`}
        />
        <StatCard
          testId={DASHBOARD.statWeight}
          icon={Scale}
          label="Body weight"
          value={loading ? "—" : weight ? weight : "—"}
          unit={weight ? "kg" : ""}
          hint={
            loading ? "" : bmi
              ? `BMI ${Number(bmi).toFixed(1)}`
              : <Link to="/body-metrics" className="text-maroon hover:underline">Set your profile →</Link>
          }
        />
      </div>

      <WeeklyRecap />

      {/* Resume + Volume chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ResumeCard routine={resumeRoutine} hasHistory={workouts.length > 0} />
        <VolumeChartCard weeks={derived.weeks} loading={loading} empty={workouts.length === 0} />
      </div>

      {/* Recent + Records */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RecentWorkouts workouts={workouts} loading={loading} />
        <RecordsCard records={derived.records} loading={loading} />
      </div>

      {/* Muscle focus */}
      <MuscleFocus muscles={derived.muscles} loading={loading} />
    </div>
  );
}

/* Lightweight markdown for the AI recap — bold + bullets only. */
function RecapText({ text }) {
  const boldify = (s) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={i} className="text-foreground font-medium">{p.slice(2, -2)}</strong>
        : <span key={i}>{p}</span>);
  return (
    <div className="space-y-1.5 text-sm text-muted-foreground">
      {text.split("\n").filter((l) => l.trim()).map((l, i) => {
        const t = l.trim();
        if (/^[-*]\s/.test(t)) {
          return <div key={i} className="flex gap-2"><span className="text-maroon">•</span><span>{boldify(t.replace(/^[-*]\s/, ""))}</span></div>;
        }
        return <p key={i}>{boldify(t)}</p>;
      })}
    </div>
  );
}

/* One-tap AI weekly recap (Groq/Claude coach), grounded in the user's data. */
function WeeklyRecap() {
  const [recap, setRecap] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    setLoading(true); setError("");
    try {
      const { data } = await api.get("/coach/recap");
      if (data.configured === false) setError(data.recap);
      else setRecap(data.recap);
    } catch {
      setError("Couldn't generate a recap right now — try again in a moment.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-maroon" /> Weekly recap
        </h3>
        {(recap || error) && !loading && (
          <button onClick={generate} className="text-[11px] text-maroon hover:underline">Refresh</button>
        )}
      </div>
      {!recap && !error && !loading && (
        <div className="text-center py-3">
          <p className="text-sm text-muted-foreground mb-3">An AI summary of your week — wins, watch-outs, and what to focus on next.</p>
          <Button size="sm" onClick={generate} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate recap
          </Button>
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground py-3 text-center animate-pulse">Coach is reviewing your week…</p>}
      {error && !loading && <p className="text-sm text-muted-foreground py-1">{error}</p>}
      {recap && !loading && <RecapText text={recap} />}
    </Card>
  );
}

/* Today band: weekly goal ring, streak, and muscle recovery chips. */
function TodayHero({ weekCount, target, streak, recovery, loading }) {
  const pct = Math.min(1, target ? weekCount / target : 0);
  const R = 26, C = 2 * Math.PI * R;
  const chips = (recovery || []).slice(0, 6).map((m) => {
    const ready = m.recovery === "fresh";
    const worked = m.recovery === "worked";
    return {
      name: m.muscle_group,
      label: ready ? "ready" : worked ? "worked today" : "recovering",
      cls: ready
        ? "text-emerald-400 bg-emerald-500/10"
        : worked
          ? "text-muted-foreground bg-muted"
          : "text-amber-400 bg-amber-500/10",
    };
  });
  return (
    <Card className="p-5">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
            <circle
              cx="36" cy="36" r={R} fill="none" stroke="hsl(var(--maroon))" strokeWidth="7"
              strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
              transform="rotate(-90 36 36)" className="transition-all"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-semibold leading-none">
              {loading ? "—" : weekCount}<span className="text-xs text-muted-foreground">/{target}</span>
            </span>
            <span className="text-[9px] text-muted-foreground">this week</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Flame className={`h-4 w-4 ${streak > 0 ? "text-orange-400" : "text-muted-foreground"}`} />
            <span className="font-semibold">{streak}-day streak</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {weekCount >= target
              ? "Weekly goal hit — nice work."
              : `${Math.max(0, target - weekCount)} more to hit your weekly goal.`}
          </p>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Recovery</div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c.name} className={`text-[11px] px-2.5 py-1 rounded-full capitalize ${c.cls}`}>
                {c.name} · {c.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── derived data ────────────────────────────────────────────────────────── */
function computeDerived(workouts) {
  const now = new Date();
  const weekStart = startOfWeek(now);

  // This week
  let weekCount = 0, weekVolume = 0;
  workouts.forEach((w) => {
    if (new Date(w.created_at) >= weekStart) {
      weekCount += 1;
      weekVolume += w.total_volume_kg || 0;
    }
  });

  // Streak (consecutive calendar days with a workout, ending today or yesterday)
  const days = new Set(workouts.map((w) => localKey(new Date(w.created_at))));
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(localKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(localKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Weekly volume — last 8 weeks
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = new Date(weekStart);
    ws.setDate(ws.getDate() - i * 7);
    weeks.push({
      t: ws.getTime(),
      label: ws.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      volume: 0,
    });
  }
  workouts.forEach((w) => {
    const t = startOfWeek(new Date(w.created_at)).getTime();
    const bucket = weeks.find((b) => b.t === t);
    if (bucket) bucket.volume += w.total_volume_kg || 0;
  });
  weeks.forEach((b) => { b.volume = Math.round(b.volume); });

  // Personal records — heaviest completed set per exercise
  const prByName = {};
  workouts.forEach((w) => {
    (w.exercises || []).forEach((ex) => {
      const name = ex.name || "Exercise";
      (ex.sets || []).forEach((s) => {
        if (s.completed && s.kg) {
          const cur = prByName[name];
          if (!cur || s.kg > cur.kg) prByName[name] = { name, kg: s.kg, reps: s.reps || 0 };
        }
      });
    });
  });
  const records = Object.values(prByName).sort((a, b) => b.kg - a.kg).slice(0, 5);

  // Muscle focus — volume by muscle group, last 7 days
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  const muscleMap = {};
  workouts.forEach((w) => {
    if (new Date(w.created_at) < cutoff) return;
    (w.exercises || []).forEach((ex) => {
      const mg = ex.muscle_group || "other";
      (ex.sets || []).forEach((s) => {
        if (s.completed && s.kg && s.reps) muscleMap[mg] = (muscleMap[mg] || 0) + s.kg * s.reps;
      });
    });
  });
  const muscles = Object.entries(muscleMap)
    .map(([name, volume]) => ({ name, volume: Math.round(volume) }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 6);

  return { weekCount, weekVolume, streak, weeks, records, muscles };
}

/* ── components ──────────────────────────────────────────────────────────── */
function StatCard({ testId, icon: Icon, label, value, unit, hint, accent }) {
  return (
    <Card
      data-testid={testId}
      className={`p-4 relative overflow-hidden ${accent ? "border-[hsl(var(--maroon)/0.4)]" : ""}`}
    >
      {accent && (
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--maroon)/0.07)] to-transparent pointer-events-none" />
      )}
      <div className="relative">
        <div className="flex items-center gap-2 text-muted-foreground text-[10px] uppercase tracking-widest">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</div>
      </div>
    </Card>
  );
}

function ResumeCard({ routine, hasHistory }) {
  const to = routine ? `/workout/session/${routine.id}` : "/workout/session/empty";
  const title = routine ? routine.name : "Empty workout";
  const exCount = routine?.exercises?.length || 0;

  return (
    <Card
      data-testid={DASHBOARD.resumeCard}
      className="p-5 flex flex-col justify-between bg-gradient-to-br from-[hsl(var(--maroon)/0.10)] to-transparent border-[hsl(var(--maroon)/0.3)]"
    >
      <div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-maroon font-semibold">
          <Play className="h-3.5 w-3.5" />
          {hasHistory ? "Pick up where you left off" : "Start training"}
        </div>
        <h3 className="text-2xl font-semibold tracking-tight mt-3">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {routine
            ? `${exCount} exercise${exCount === 1 ? "" : "s"} · ready to go`
            : "Log any lifts on the fly"}
        </p>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <Button asChild className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
          <Link to={to}>
            {routine ? "Start workout" : "Start empty workout"}
            <ArrowRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="w-full text-muted-foreground hover:text-foreground">
          <Link to="/workout">Browse routines &amp; programs</Link>
        </Button>
      </div>
    </Card>
  );
}

function VolumeChartCard({ weeks, loading, empty }) {
  const hasData = weeks.some((w) => w.volume > 0);
  return (
    <Card data-testid={DASHBOARD.volumeChart} className="p-5 lg:col-span-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Weekly volume
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">Total kg lifted per week · last 8 weeks</div>
        </div>
      </div>
      <div className="h-[200px] mt-4">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : empty || !hasData ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Dumbbell className="h-8 w-8 text-[hsl(var(--maroon)/0.6)]" />
            <p className="text-sm text-muted-foreground mt-2">Your volume trend appears here after your first workout.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeks} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--maroon))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--maroon))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "hsl(var(--popover-foreground))",
                }}
                labelFormatter={(l) => `Week of ${l}`}
                formatter={(v) => [`${Number(v).toLocaleString()} kg`, "Volume"]}
              />
              <Area
                type="monotone"
                dataKey="volume"
                stroke="hsl(var(--maroon))"
                strokeWidth={2}
                fill="url(#volFill)"
                dot={{ r: 2, fill: "hsl(var(--maroon))" }}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function RecentWorkouts({ workouts, loading }) {
  const recent = workouts.slice(0, 4);
  return (
    <Card data-testid={DASHBOARD.recentList} className="p-5 lg:col-span-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <Timer className="h-3.5 w-3.5" />
          Recent workouts
        </div>
        {workouts.length > 0 && (
          <Link to="/progress" className="text-xs text-maroon hover:underline">View all</Link>
        )}
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
      ) : recent.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No workouts yet. Hit <span className="text-maroon font-medium">Start workout</span> to log your first session.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {recent.map((w) => (
            <div key={w.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{w.name}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                  <span>{fmtRelative(w.created_at)}</span>
                  <span>{fmtDuration(w.duration_seconds)}</span>
                  <span>{fmtVol(w.total_volume_kg)} kg</span>
                  <span>{w.completed_sets}/{w.total_sets} sets</span>
                </div>
              </div>
              <div className="hidden sm:flex flex-wrap gap-1 justify-end max-w-[45%]">
                {(w.exercises || []).slice(0, 2).map((ex, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{ex.name}</Badge>
                ))}
                {(w.exercises || []).length > 2 && (
                  <Badge variant="outline" className="text-[10px]">+{w.exercises.length - 2}</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecordsCard({ records, loading }) {
  return (
    <Card data-testid={DASHBOARD.recordsCard} className="p-5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
        <Trophy className="h-3.5 w-3.5 text-[#f5a623]" />
        Personal records
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
      ) : records.length === 0 ? (
        <div className="py-8 text-center">
          <Sparkles className="h-7 w-7 mx-auto text-[hsl(var(--maroon)/0.6)]" />
          <p className="text-sm text-muted-foreground mt-2">Log weighted sets and your top lifts show up here.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r, i) => (
            <div key={r.name} className="flex items-center gap-3">
              <div className="h-6 w-6 shrink-0 rounded-md bg-[hsl(var(--maroon)/0.1)] text-maroon flex items-center justify-center text-xs font-semibold">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
              </div>
              <div className="text-sm font-semibold tabular-nums whitespace-nowrap">
                {r.kg} kg<span className="text-[11px] text-muted-foreground font-normal"> × {r.reps}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MuscleFocus({ muscles, loading }) {
  const max = Math.max(1, ...muscles.map((m) => m.volume));
  if (loading || muscles.length === 0) {
    return (
      <Card data-testid={DASHBOARD.muscleFocus} className="p-5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
          <Activity className="h-3.5 w-3.5" />
          Muscle focus · last 7 days
        </div>
        <p className="text-sm text-muted-foreground py-4 text-center">
          {loading ? "Loading…" : "Train this week to see which muscle groups you're hitting most."}
        </p>
      </Card>
    );
  }
  return (
    <Card data-testid={DASHBOARD.muscleFocus} className="p-5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
        <Activity className="h-3.5 w-3.5" />
        Muscle focus · last 7 days
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
        {muscles.map((m) => (
          <div key={m.name}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="capitalize font-medium">{m.name}</span>
              <span className="text-muted-foreground tabular-nums">{fmtVol(m.volume)} kg</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-maroon transition-all"
                style={{ width: `${Math.max(6, (m.volume / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
