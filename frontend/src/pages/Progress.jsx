import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dumbbell, TrendingUp, Calendar, Trash2, Flame, Trophy, Pencil } from "lucide-react";
import EditWorkoutDialog from "@/components/EditWorkoutDialog";
import {
  Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from "recharts";
import { PROGRESS } from "@/constants/testIds";
import MuscleHeatmap from "@/components/MuscleHeatmap";

// Weekly training volume for the last `n` weeks — pure function over workout history.
function weeklyVolume(workouts, n = 10) {
  const startOfWeek = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
    return x;
  };
  const thisWeek = startOfWeek(new Date());
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = new Date(thisWeek);
    ws.setDate(ws.getDate() - i * 7);
    weeks.push({ t: ws.getTime(), label: ws.toLocaleDateString(undefined, { month: "short", day: "numeric" }), volume: 0 });
  }
  (workouts || []).forEach((w) => {
    const t = startOfWeek(new Date(w.created_at)).getTime();
    const b = weeks.find((x) => x.t === t);
    if (b) b.volume += w.total_volume_kg || 0;
  });
  weeks.forEach((b) => { b.volume = Math.round(b.volume); });
  return weeks;
}

function fmtMinutes(secs) {
  if (!secs) return "0m";
  const m = Math.floor(secs / 60);
  const r = secs % 60;
  if (m === 0) return `${r}s`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${r}s`;
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const ZONE_STYLE = {
  under: { color: "#ef4444", label: "Under MEV — undertrained" },
  optimal: { color: "#22c55e", label: "MEV–MAV — optimal" },
  high: { color: "#f59e0b", label: "MAV–MRV — high" },
  excessive: { color: "#f97316", label: "Above MRV — excessive" },
};

export default function Progress() {
  const [workouts, setWorkouts] = useState([]);
  const [stats, setStats] = useState({ total_workouts: 0, total_volume: 0, total_sets: 0, total_duration: 0 });
  const [muscleVolume, setMuscleVolume] = useState([]);
  const [strength, setStrength] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // workout being edited

  const load = async () => {
    setLoading(true);
    try {
      const [w, s] = await Promise.all([
        api.get("/workouts"),
        api.get("/workouts/stats"),
      ]);
      setWorkouts(w.data);
      setStats(s.data);
      api.get("/workouts/muscle-volume").then((r) => setMuscleVolume(r.data)).catch(() => {});
      api.get("/strength-standards").then((r) => setStrength(r.data.filter((x) => x.e1rm))).catch(() => {});
      api.get("/records").then((r) => setRecords(r.data.records || [])).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onDelete = async (id) => {
    if (!window.confirm("Delete this workout from history?")) return;
    await api.delete(`/workouts/${id}`);
    await load();
  };

  return (
    <div data-testid={PROGRESS.root} className="max-w-5xl space-y-6 animate-fade-up">
      <div>
        <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Track</div>
        <h1 className="text-4xl font-semibold tracking-tight mt-1">Progress</h1>
        <p className="text-muted-foreground text-sm mt-1">Workout history, total volume, streaks.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox icon={Flame} label="Workouts" value={stats.total_workouts} />
        <StatBox icon={Dumbbell} label="Total Volume" value={`${stats.total_volume.toFixed(0)} kg`} />
        <StatBox icon={TrendingUp} label="Total Sets" value={stats.total_sets} />
        <StatBox icon={Calendar} label="Total Time" value={fmtMinutes(stats.total_duration)} />
      </div>

      <VolumeTrend workouts={workouts} loading={loading} />

      <PRShelf records={records} />

      <WorkoutCalendar workouts={workouts} />

      <MuscleHeatmap />

      {/* Weekly muscle volume vs MEV/MAV/MRV landmarks */}
      {muscleVolume.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold tracking-tight">Weekly Muscle Volume</h3>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">hard sets · last 7 days</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            <span style={{ color: ZONE_STYLE.under.color }}>● under</span>{" · "}
            <span style={{ color: ZONE_STYLE.optimal.color }}>● optimal</span>{" · "}
            <span style={{ color: ZONE_STYLE.high.color }}>● high</span>{" · "}
            <span style={{ color: ZONE_STYLE.excessive.color }}>● excessive</span>
          </p>
          <div className="space-y-3">
            {muscleVolume.map((m) => {
              const st = ZONE_STYLE[m.zone] || ZONE_STYLE.optimal;
              const pct = Math.min(100, (m.hard_sets / m.mrv) * 100);
              return (
                <div key={m.muscle_group}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="capitalize font-medium flex items-center gap-1.5">
                      {m.muscle_group}
                      {m.recovery === "worked" && <span className="text-[9px] px-1.5 rounded-full bg-red-500/15 text-red-400">worked today</span>}
                      {m.recovery === "recovering" && <span className="text-[9px] px-1.5 rounded-full bg-amber-500/15 text-amber-400">recovering</span>}
                      {m.recovery === "fresh" && <span className="text-[9px] px-1.5 rounded-full bg-green-500/15 text-green-400">recovered</span>}
                    </span>
                    <span className="text-muted-foreground">
                      {m.hard_sets} sets · <span style={{ color: st.color }}>{st.label}</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted relative overflow-visible">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: st.color }} />
                    {/* MEV / MAV markers */}
                    <div className="absolute top-[-2px] h-3 w-px bg-foreground/30" style={{ left: `${(m.mev / m.mrv) * 100}%` }} title={`MEV ${m.mev}`} />
                    <div className="absolute top-[-2px] h-3 w-px bg-foreground/30" style={{ left: `${(m.mav / m.mrv) * 100}%` }} title={`MAV ${m.mav}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Relative strength — e1RM / bodyweight vs published standards */}
      {strength.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold tracking-tight">Relative Strength</h3>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">est. 1RM ÷ bodyweight</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {strength.map((s) => (
              <div key={s.lift} className="rounded-lg bg-muted p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">{s.lift}</div>
                <div className="text-xl font-bold mt-0.5">{s.ratio}× <span className="text-xs font-normal text-muted-foreground">bw</span></div>
                <div className="text-xs text-maroon font-semibold capitalize mt-0.5">{s.level}</div>
                <div className="text-[10px] text-muted-foreground">e1RM {s.e1rm} kg</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : workouts.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Flame className="h-10 w-10 mx-auto text-maroon" />
          <h3 className="mt-3 text-lg font-semibold">No workouts logged yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Start a routine from <Link to="/workout" className="text-maroon underline-offset-2 hover:underline">/workout</Link>, log your sets, and tap Finish.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {workouts.map((w) => (
            <Card
              key={w.id}
              data-testid={PROGRESS.workoutCard}
              className="p-5 hover:border-maroon/40 transition group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold tracking-tight">{w.name}</h3>
                    <Badge variant="outline" className="text-[10px]">{fmtRelative(w.created_at)}</Badge>
                  </div>
                  {w.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{w.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2.5 text-xs text-muted-foreground">
                    <span>⏱ {fmtMinutes(w.duration_seconds)}</span>
                    <span>🏋️ {w.total_volume_kg?.toFixed?.(0) || 0} kg</span>
                    <span>📊 {w.completed_sets} / {w.total_sets} sets</span>
                  </div>
                  {w.exercises?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {w.exercises.slice(0, 6).map((ex, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">
                          {ex.name}
                        </Badge>
                      ))}
                      {w.exercises.length > 6 && (
                        <Badge variant="outline" className="text-[10px]">+{w.exercises.length - 6}</Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-maroon"
                    onClick={() => setEditing(w)}
                    aria-label="Edit workout"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    data-testid={PROGRESS.deleteButton}
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(w.id)}
                    aria-label="Delete workout"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <EditWorkoutDialog
        workout={editing}
        open={!!editing}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </div>
  );
}

// GitHub-style training calendar — last 12 weeks, one cell per day.
/* Personal-record trophy shelf — heaviest lift per exercise. */
function PRShelf({ records }) {
  if (!records || records.length === 0) return null;
  const top = records.slice(0, 9);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <Trophy className="h-4 w-4 text-maroon" /> Personal records
        </h3>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{records.length} lifts</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {top.map((r) => (
          <div key={r.exercise_id} className="rounded-xl border border-border bg-card p-3 card-interactive">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold tabular-nums">{r.headline_value}<span className="text-[11px] text-muted-foreground font-normal"> kg</span></span>
              <Trophy className="h-3.5 w-3.5 text-maroon/70 shrink-0" />
            </div>
            <p className="text-xs font-medium truncate mt-1">{r.exercise_name}</p>
            {r.muscle_group && <span className="text-[10px] text-muted-foreground capitalize">{r.muscle_group}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* Weekly training-volume trend — visualizes progressive overload over time. */
function VolumeTrend({ workouts, loading }) {
  const data = useMemo(() => weeklyVolume(workouts, 10), [workouts]);
  const hasData = data.some((d) => d.volume > 0);
  if (loading || !hasData) return null;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold tracking-tight">Training volume</h3>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">kg lifted · last 10 weeks</span>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--maroon))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--maroon))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              cursor={{ stroke: "hsl(var(--maroon))", strokeOpacity: 0.3 }}
              contentStyle={{ background: "hsl(var(--bg-elevated, var(--card)))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              formatter={(v) => [`${v.toLocaleString()} kg`, "Volume"]}
            />
            <Area type="monotone" dataKey="volume" stroke="hsl(var(--maroon))" strokeWidth={2} fill="url(#volFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function WorkoutCalendar({ workouts }) {
  const trained = new Set(
    (workouts || []).map((w) => new Date(w.created_at).toDateString()),
  );
  const weeks = 12;
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7); // Monday, 12 weeks back
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      days.push({ future: day > today, on: trained.has(day.toDateString()) });
    }
    cols.push(days);
  }
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Training calendar</h3>
        <span className="text-[10px] text-muted-foreground">last 12 weeks</span>
      </div>
      <div className="flex gap-1 overflow-x-auto">
        {cols.map((days, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {days.map((c, di) => (
              <div
                key={di}
                title={c.on ? "Trained" : ""}
                className={`h-3 w-3 rounded-sm transition-colors ${c.future ? "opacity-0" : c.on ? "bar-accent" : "bg-muted"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatBox({ icon: Icon, label, value }) {
  return (
    <Card className="p-4 card-interactive">
      <div className="flex items-center gap-2 text-muted-foreground text-[10px] uppercase tracking-widest">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight mt-1.5">{value}</div>
    </Card>
  );
}
