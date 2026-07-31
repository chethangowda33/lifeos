import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Trash2, Play, Dumbbell, ArrowUpRight, Layers,
  ArrowUp, ArrowDown, Settings2, ChevronDown, ChevronRight, MoreVertical, ArrowLeft, ClipboardList, Folder,
  Home, Building2, HeartPulse, Sparkles, Flame, Zap,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { WORKOUT, SESSION } from "@/constants/testIds";
import ExercisePicker from "@/components/ExercisePicker";
import SplitEditor from "@/features/workout/components/SplitEditor";
import ReadinessCard from "@/features/workout/components/ReadinessCard";
import ProgramDetailDialog from "@/components/ProgramDetailDialog";
import ExerciseDetailDialog from "@/components/ExerciseDetailDialog";
import SwipeToDismiss from "@/components/SwipeToDismiss";
import LoadError from "@/components/LoadError";

const RECO_DISMISSED_KEY = "lifeos:reco-dismissed";       // user dismissed the recommendation
const BUILT_MANUALLY_KEY = "lifeos:built-manually";       // user has built a routine/plan by hand

const EXPLORE_CATEGORIES = [
  { key: "home", label: "At home", icon: Home, test: (p) => p.equipment === "bodyweight" },
  { key: "gym", label: "Gym", icon: Building2, test: (p) => ["barbell", "machine", "cable"].includes(p.equipment) },
  { key: "dumbbell", label: "Dumbbells only", icon: Dumbbell, test: (p) => p.equipment === "dumbbell" },
  { key: "cut", label: "Cardio & cut", icon: HeartPulse, test: (p) => ["cut", "general"].includes(p.goal) },
  { key: "beginner", label: "Beginner", icon: Play, test: (p) => p.level === "beginner" },
  { key: "advanced", label: "Advanced", icon: Layers, test: (p) => p.level === "advanced" },
];

// Goal filter chips for the recommendation empty state — map friendly goals to program.goal values.
const RECO_GOALS = [
  { key: "muscle", label: "Muscle", icon: Dumbbell, goals: ["hypertrophy", "aesthetic"] },
  { key: "strength", label: "Strength", icon: Zap, goals: ["strength"] },
  { key: "cut", label: "Lose fat", icon: Flame, goals: ["cut"] },
  { key: "fit", label: "Stay fit", icon: HeartPulse, goals: ["general"] },
];
// Which weekdays a plan lands on, by days-per-week — for the "your week" preview.
const WEEK_PRESETS = {
  1: ["Mon"], 2: ["Mon", "Thu"], 3: ["Mon", "Wed", "Fri"],
  4: ["Mon", "Tue", "Thu", "Fri"], 5: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  6: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

export default function Workout() {
  const navigate = useNavigate();
  const [view, setView] = useState("home"); // "home" | "explore"
  const [routines, setRoutines] = useState([]);
  const [plans, setPlans] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [planBuilderOpen, setPlanBuilderOpen] = useState(false);
  const [splitEditorOpen, setSplitEditorOpen] = useState(false);
  const [activeRoutine, setActiveRoutine] = useState(null); // for viewing
  const [category, setCategory] = useState(null); // explore drill-down: null = tiles
  const [programDetail, setProgramDetail] = useState(null); // full program object with routines
  const [exerciseDetailId, setExerciseDetailId] = useState(null);

  const [loadFailed, setLoadFailed] = useState(false);
  const [heroReady, setHeroReady] = useState(false); // all four hero inputs have landed
  const [workouts, setWorkouts] = useState([]); // history — powers week strip + hero
  const loadWorkouts = async () => {
    try {
      const { data } = await api.get("/workouts");
      setWorkouts(data);
    } catch { /* strip just stays empty */ }
  };

  // Per-muscle recovery, so the hero can prefer a day you're actually ready for.
  const [recovery, setRecovery] = useState(null);
  const loadRecovery = async () => {
    try {
      const { data } = await api.get("/workouts/muscle-volume");
      setRecovery(Object.fromEntries(data.map((m) => [m.muscle_group, m.recovery])));
    } catch { /* hero falls back to the rest-based order */ }
  };

  const loadRoutines = async () => {
    try {
      const { data } = await api.get("/routines");
      setRoutines(data);
      setLoadFailed(false);
    } catch {
      // The empty state here invites "Create a routine" — so a failed load could
      // walk the user into duplicating routines they already have.
      setLoadFailed(true);
    }
  };

  // Copy a plan's days into standalone, editable routines (non-destructive —
  // the plan keeps its days; the routines get foldered under the plan name).
  const importPlanDays = async (plan) => {
    try {
      await api.post(`/plans/${plan.id}/import-days`);
      await Promise.all([loadPlans(), loadRoutines()]);
    } catch { /* non-blocking */ }
  };

  // Move a routine into/out of a folder (additive field on the routine).
  const setRoutineFolder = async (routine, folder) => {
    try {
      await api.put(`/routines/${routine.id}/folder`, { folder });
      await loadRoutines();
    } catch { /* non-blocking */ }
  };

  const reorderRoutine = async (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= routines.length) return;
    const next = routines.slice();
    [next[index], next[j]] = [next[j], next[index]];
    setRoutines(next); // optimistic
    await api.put("/routines/reorder", { ids: next.map((r) => r.id) }).catch(() => {});
  };
  const loadPlans = async () => {
    try {
      const { data } = await api.get("/plans");
      setPlans(data);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  };

  const reorderPlanDay = async (plan, dayIndex, dir) => {
    const j = dayIndex + dir;
    if (j < 0 || j >= plan.days.length) return;
    const days = plan.days.slice();
    [days[dayIndex], days[j]] = [days[j], days[dayIndex]];
    // optimistic update
    setPlans((arr) => arr.map((p) => (p.id === plan.id ? { ...p, days } : p)));
    await api.put(`/plans/${plan.id}`, { name: plan.name, days, next_day_index: plan.next_day_index });
    await loadPlans();
  };

  const deletePlan = async (plan) => {
    if (!window.confirm(`Delete plan "${plan.name}"?`)) return;
    await api.delete(`/plans/${plan.id}`);
    await loadPlans();
  };

  const setPlanCooldown = async (plan, cooldownDays) => {
    setPlans((arr) => arr.map((p) => (p.id === plan.id ? { ...p, cooldown_days: cooldownDays } : p)));
    await api.put(`/plans/${plan.id}`, {
      name: plan.name,
      days: plan.days.map((d) => ({
        name: d.name,
        exercises: (d.exercises || []).map((e) => ({
          exercise_id: e.exercise_id, sets: e.sets ?? 3, reps: e.reps ?? 10, notes: "",
        })),
        last_completed_at: d.last_completed_at,
      })),
      next_day_index: plan.next_day_index,
      cooldown_days: cooldownDays,
    });
    await loadPlans();
  };
  const loadPrograms = async () => {
    const { data } = await api.get("/programs");
    setPrograms(data);
  };

  const openProgram = async (programId) => {
    const { data } = await api.get(`/programs/${programId}`);
    setProgramDetail(data);
  };

  // The hero's empty state branches on routines + plans + workouts + programs at
  // once, so rendering it while they're still arriving flashed the recommendation
  // in and out (/programs resolves before /workouts). Wait for all four.
  useEffect(() => {
    Promise.allSettled([loadRoutines(), loadPlans(), loadWorkouts(), loadPrograms()])
      .then(() => setHeroReady(true));
    loadRecovery();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Explore view (programs) ────────────────────────────────────────────────
  if (view === "explore") {
    return (
      <div data-testid={WORKOUT.root} className="max-w-3xl mx-auto space-y-5 animate-fade-up">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setView("home")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Explore</h1>
        </div>

        {category ? (
          /* ── Drill-down: programs in the tapped category ── */
          <>
            <button
              onClick={() => setCategory(null)}
              className="text-xs text-muted-foreground hover:text-foreground -mt-2"
            >
              ← All categories
            </button>
            <h2 className="font-semibold text-lg -mt-2">{category.label}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {programs.filter(category.test).map((p) => (
                <ProgramCard key={p.id} program={p} onOpen={() => openProgram(p.id)} />
              ))}
              {programs.filter(category.test).length === 0 && (
                <div className="col-span-full text-center text-muted-foreground py-12">
                  No programs here yet.
                </div>
              )}
            </div>
          </>
        ) : (
          /* ── Category tiles + Popular row ── */
          <>
            <div className="grid grid-cols-2 gap-3">
              {EXPLORE_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCategory(c)}
                  className="rounded-xl border border-border bg-card p-4 text-left hover:border-[hsl(var(--maroon)/0.5)] transition"
                >
                  <c.icon className="h-5 w-5 text-maroon mb-2" />
                  <div className="font-semibold text-sm">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {programs.filter(c.test).length} programs
                  </div>
                </button>
              ))}
            </div>

            <div>
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-2">Popular</h2>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {programs.slice(0, 8).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => openProgram(p.id)}
                    className="min-w-[150px] rounded-xl border border-border bg-card p-3.5 text-left hover:border-[hsl(var(--maroon)/0.5)] transition shrink-0"
                  >
                    <Badge className="bg-maroon text-white capitalize text-[9px] px-1.5">{p.level}</Badge>
                    <div className="font-medium text-sm mt-2 leading-snug line-clamp-2">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {p.routines?.length || 0} days · {p.duration_weeks} wks
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <ProgramDetailDialog
          open={!!programDetail}
          program={programDetail}
          onClose={() => setProgramDetail(null)}
          onSelectExercise={(id) => setExerciseDetailId(id)}
          onSaved={async () => { await loadPlans(); setView("home"); }}
        />
        <ExerciseDetailDialog
          open={!!exerciseDetailId}
          exerciseId={exerciseDetailId}
          onClose={() => setExerciseDetailId(null)}
        />
      </div>
    );
  }

  // ── Home view — one minimal list: quick start, then plans as folders + routines
  return (
    <div data-testid={WORKOUT.root} className="max-w-3xl mx-auto space-y-5 animate-fade-up">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Workout</h1>
        <Button
          variant="ghost"
          size="icon"
          title="Workout settings"
          onClick={() => navigate("/workout/settings")}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      <WeekStrip workouts={workouts} />

      {/* Should I train today? — sits directly above "next up" on purpose: the
          verdict and the button you press about it belong in one glance. */}
      <ReadinessCard />

      {loadFailed ? (
        /* Replaces the hero rather than sitting above it — the hero's empty state
           is the misleading "Nothing queued yet, create a routine". */
        <LoadError
          what="your routines"
          onRetry={() => { loadRoutines(); loadPlans(); loadWorkouts(); }}
        />
      ) : !heroReady ? (
        <Card className="h-44 border-dashed animate-pulse" />
      ) : (
        <HeroCard
          plans={plans}
          routines={routines}
          workouts={workouts}
          programs={programs}
          recovery={recovery}
          onOpenProgram={openProgram}
          onStartDay={(planId, dayIdx) => navigate(`/workout/session/plan/${planId}/${dayIdx}`)}
          onStartRoutine={(id) => navigate(`/workout/session/${id}`)}
          onCreate={() => setBuilderOpen(true)}
          onExplore={() => setView("explore")}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          data-testid={SESSION.startEmptyButton}
          onClick={() => navigate("/workout/session/empty")}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 hover:border-[hsl(var(--maroon)/0.5)] transition text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Empty
        </button>
        <button
          data-testid={WORKOUT.newRoutineButton}
          onClick={() => setBuilderOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 hover:border-[hsl(var(--maroon)/0.5)] transition text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ClipboardList className="h-3.5 w-3.5" /> New routine
        </button>
        <button
          data-testid={WORKOUT.newPlanButton}
          onClick={() => setPlanBuilderOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 hover:border-[hsl(var(--maroon)/0.5)] transition text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Layers className="h-3.5 w-3.5" /> New plan
        </button>
        <button
          data-testid={WORKOUT.exploreButton}
          onClick={() => setView("explore")}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 hover:border-[hsl(var(--maroon)/0.5)] transition text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" /> Explore
        </button>
      </div>

      <div className="space-y-2.5">
        {plans.map((p) => (
          <PlanFolder
            key={p.id}
            plan={p}
            onStartDay={(dayIdx) => navigate(`/workout/session/plan/${p.id}/${dayIdx}`)}
            onReorder={(dayIdx, dir) => reorderPlanDay(p, dayIdx, dir)}
            onDelete={() => deletePlan(p)}
            onSetCooldown={(days) => setPlanCooldown(p, days)}
            onImportDays={() => importPlanDays(p)}
            recovery={recovery}
          />
        ))}

        {(() => {
          // Hevy-style grouping: folders first, then ungrouped routines.
          const folderNames = [...new Set(routines.map((r) => (r.folder || "").trim()).filter(Boolean))].sort();
          const row = (r, i) => (
            <RoutineRow
              key={r.id}
              routine={r}
              isFirst={i === 0}
              isLast={i === routines.length - 1}
              folders={folderNames}
              onSetFolder={(folder) => setRoutineFolder(r, folder)}
              onMoveUp={() => reorderRoutine(i, -1)}
              onMoveDown={() => reorderRoutine(i, +1)}
              onStart={() => navigate(`/workout/session/${r.id}`)}
              onView={() => setActiveRoutine(r)}
              onDelete={async () => {
                if (!window.confirm(`Delete routine "${r.name}"?`)) return;
                await api.delete(`/routines/${r.id}`);
                await loadRoutines();
              }}
            />
          );
          const inFolder = (name) => routines.map((r, i) => [r, i]).filter(([r]) => (r.folder || "").trim() === name);
          const loose = routines.map((r, i) => [r, i]).filter(([r]) => !(r.folder || "").trim());
          return (
            <>
              {folderNames.map((name) => (
                <RoutineFolder key={name} name={name} count={inFolder(name).length}>
                  {inFolder(name).map(([r, i]) => row(r, i))}
                </RoutineFolder>
              ))}
              {loose.map(([r, i]) => row(r, i))}
            </>
          );
        })()}
      </div>

      {/* Routine Builder */}
      <RoutineBuilder
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        onSaved={async () => { setBuilderOpen(false); await loadRoutines(); }}
      />

      {/* Plan Builder */}
      <PlanBuilder
        open={planBuilderOpen}
        onClose={() => setPlanBuilderOpen(false)}
        onUseRoutines={() => { setPlanBuilderOpen(false); setSplitEditorOpen(true); }}
        onSaved={async () => { setPlanBuilderOpen(false); await loadPlans(); }}
      />

      <SplitEditor
        open={splitEditorOpen}
        routines={routines}
        onClose={() => setSplitEditorOpen(false)}
        onSaved={async () => { setSplitEditorOpen(false); await loadPlans(); }}
      />

      {/* Active routine view */}
      <Dialog open={!!activeRoutine} onOpenChange={(o) => !o && setActiveRoutine(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">{activeRoutine?.name}</DialogTitle>
            <DialogDescription>
              {activeRoutine?.exercises?.length ?? 0} exercises queued
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {activeRoutine?.exercises?.map((ex, i) => (
              <button
                key={i}
                onClick={() => setExerciseDetailId(ex.exercise_id)}
                className="w-full flex items-center justify-between rounded-md border border-border px-3 py-2 bg-muted/30 hover:border-maroon/40 hover:bg-muted/60 transition text-left"
              >
                <div>
                  <div className="font-medium text-sm text-maroon">{ex.name || ex.exercise_id}</div>
                  <div className="text-[11px] text-muted-foreground">Tap to see how-to</div>
                </div>
                <Badge variant="secondary">{ex.sets}×{ex.reps}</Badge>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Program detail */}
      <ProgramDetailDialog
        open={!!programDetail}
        program={programDetail}
        onClose={() => setProgramDetail(null)}
        onSelectExercise={(id) => setExerciseDetailId(id)}
        onSaved={async () => { await loadPlans(); }}
      />

      {/* Exercise detail */}
      <ExerciseDetailDialog
        open={!!exerciseDetailId}
        exerciseId={exerciseDetailId}
        onClose={() => setExerciseDetailId(null)}
      />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function recencyLabel(iso) {
  const n = daysSince(iso);
  if (n === Infinity) return "not yet";
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  return `${n}d ago`;
}

// How tired a muscle is, per /workouts/muscle-volume. Lower = readier to train.
const FATIGUE_RANK = { fresh: 0, recovering: 1, worked: 2 };

/* Suggested next day.
   Base rule: the day gone longest without training (never-done ranks first).
   When recovery data is available it takes precedence, so a day whose muscles were
   hit today or yesterday waits behind one that's actually ready — the calendar
   saying "it's been a while" doesn't mean the tissue has recovered. If every day is
   equally fatigued the rest-based order still decides, so a pick is always made.
   Called with one argument (no recovery map) it behaves exactly as before.
   (exported: reused by useTrainReminder) */
export function suggestedDayIndex(days, recoveryByMuscle = null) {
  let best = 0, bestFatigue = Infinity, bestT = Infinity;
  days.forEach((d, i) => {
    const t = d.last_completed_at ? new Date(d.last_completed_at).getTime() : -Infinity;
    let fatigue = 0;
    if (recoveryByMuscle) {
      const groups = [...new Set((d.exercises || []).map((e) => e.muscle_group).filter(Boolean))];
      fatigue = groups.reduce((m, g) => Math.max(m, FATIGUE_RANK[recoveryByMuscle[g]] ?? 0), 0);
    }
    if (fatigue < bestFatigue || (fatigue === bestFatigue && t < bestT)) {
      bestFatigue = fatigue; bestT = t; best = i;
    }
  });
  return best;
}

/* How long this session actually takes YOU. `sets × 3.5` was a constant that never
   learned; the median of your own past sessions for this day/routine is a real
   number. Falls back to the estimate until there's history to learn from. */
export function estimateSessionMinutes(workouts, { planId, dayIndex, routineId }, totalSets) {
  const past = (workouts || [])
    .filter((w) => (
      (planId && w.plan_id === planId && w.day_index === dayIndex) ||
      (routineId && w.routine_id === routineId)
    ))
    .map((w) => w.duration_seconds)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  if (past.length) return { minutes: Math.round(past[Math.floor(past.length / 2)] / 60), learned: true };
  return { minutes: Math.max(15, Math.round(totalSets * 3.5)), learned: false };
}

const COOLDOWN_OPTIONS = [["0", "Off"], ["3", "3 days"], ["5", "5 days"], ["7", "7 days"], ["14", "14 days"]];

/* Thin Mon–Sun consistency strip: filled = trained, outlined = today. */
function WeekStrip({ workouts }) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const trained = new Set(
    (workouts || [])
      .map((w) => new Date(w.created_at))
      .filter((d) => d >= monday)
      .map((d) => (d.getDay() + 6) % 7),
  );
  const todayIdx = (now.getDay() + 6) % 7;
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {labels.map((l, i) => (
          <div key={i} className="text-center">
            <div className={`text-[10px] ${i === todayIdx ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{l}</div>
            <div
              className={`h-1.5 rounded-full mt-1 ${
                trained.has(i)
                  ? "bg-maroon"
                  : i === todayIdx
                    ? "border border-[hsl(var(--maroon)/0.7)]"
                    : "bg-muted"
              }`}
            />
          </div>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground text-center mt-1.5">
        {trained.size === 0 ? "No workouts yet this week" : `${trained.size} workout day${trained.size > 1 ? "s" : ""} this week`}
      </div>
    </div>
  );
}

/* "Next up" hero — the app picks today's workout: the day you're most recovered
   for, breaking ties by which has gone longest untrained. */
function HeroCard({ plans, routines, workouts, programs = [], recovery = null, onOpenProgram, onStartDay, onStartRoutine, onCreate }) {
  const [pickOpen, setPickOpen] = useState(false);
  const [goalKey, setGoalKey] = useState(() => {
    try { return localStorage.getItem("lifeos:reco-goal") || null; } catch { return null; }
  }); // recommendation goal filter (empty state) — seeded from onboarding
  // Once the user dismisses the recommendation, we stop suggesting anything in
  // this context — no auto-replacement, ever (persisted).
  const [recoDismissed, setRecoDismissed] = useState(() => {
    try { return localStorage.getItem(RECO_DISMISSED_KEY) === "1"; } catch { return false; }
  });
  const dismissRecommendation = () => {
    setRecoDismissed(true);
    try { localStorage.setItem(RECO_DISMISSED_KEY, "1"); } catch { /* ignore */ }
  };
  // Set the first time the user builds a routine/plan by hand — after that the
  // goal prompt + recommendation never appear again.
  let builtManually = false;
  try { builtManually = localStorage.getItem(BUILT_MANUALLY_KEY) === "1"; } catch { /* ignore */ }

  const trainedToday = (workouts || []).some(
    (w) => new Date(w.created_at).toDateString() === new Date().toDateString(),
  );

  const plan = plans[0];
  const days = plan?.days || [];
  const nextIdx = plan ? suggestedDayIndex(days, recovery) : 0;
  const day = days[nextIdx];
  const routine = !plan ? routines[0] : null;
  const target = day || routine;

  const exs = target?.exercises || [];
  const totalSets = exs.reduce((n, e) => n + (e.sets || 3), 0);
  const { minutes: estMinutes, learned: estLearned } = estimateSessionMinutes(
    workouts,
    { planId: plan?.id, dayIndex: nextIdx, routineId: routine?.id },
    totalSets,
  );
  // Surfaced next to the title so the pick is explainable, not a black box.
  const readiness = recovery
    ? [...new Set(exs.map((e) => e.muscle_group).filter(Boolean))]
        .map((g) => recovery[g]).filter(Boolean)
    : [];
  const anyWorked = readiness.includes("worked");
  const anyRecovering = readiness.includes("recovering");
  const restedDays = day ? daysSince(day.last_completed_at) : null;
  const cooldown = plan?.cooldown_days ?? 7;

  const start = () => {
    if (day) {
      if (cooldown > 0 && daysSince(day.last_completed_at) < cooldown &&
          !window.confirm(`You trained ${day.name} ${recencyLabel(day.last_completed_at)}. Train it again anyway?`)) return;
      onStartDay(plan.id, nextIdx);
    } else if (routine) {
      onStartRoutine(routine.id);
    }
  };

  if (!target) {
    const workoutsEmpty = (workouts?.length || 0) === 0;
    // Only recommend on a genuinely fresh start (new user / full reset), and only
    // until the user dismisses it or builds a routine/plan by hand.
    const showReco = !builtManually && !recoDismissed && workoutsEmpty;
    const freshStart = workoutsEmpty && !builtManually;

    const activeGoal = RECO_GOALS.find((g) => g.key === goalKey);
    const inGoal = activeGoal ? programs.filter((p) => activeGoal.goals.includes(p.goal)) : programs;
    const recommended = showReco ? (inGoal.find((p) => p.level === "beginner") || inGoal[0] || null) : null;
    const weekDays = recommended ? WEEK_PRESETS[recommended.routines?.length] || [] : [];

    // Nothing to recommend (or recommendation dismissed / user has history) → plain empty state.
    if (!recommended) {
      return (
        <Card className="p-8 text-center border-dashed">
          <Dumbbell className="h-8 w-8 mx-auto text-maroon" />
          <h3 className="mt-3 font-semibold">Nothing queued yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Create a routine to get started.</p>
          <div className="flex gap-2 justify-center">
            {recoDismissed && freshStart && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setRecoDismissed(false); try { localStorage.removeItem(RECO_DISMISSED_KEY); } catch { /* ignore */ } }}
              >
                Show recommendation
              </Button>
            )}
            <Button size="sm" onClick={onCreate} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
              <Plus className="h-3.5 w-3.5 mr-1.5" /> New routine
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground mb-2">What&apos;s your goal?</p>
          <div className="flex gap-2">
            {RECO_GOALS.map((g) => {
              const active = g.key === goalKey;
              return (
                <button
                  key={g.key}
                  onClick={() => setGoalKey(active ? null : g.key)}
                  className={`flex-1 flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-[11px] transition ${
                    active
                      ? "bg-maroon text-white border-transparent"
                      : "border-border text-muted-foreground hover:border-[hsl(var(--maroon)/0.5)]"
                  }`}
                >
                  <g.icon className="h-4 w-4" />
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* One best-fit recommendation. Swipe/dismiss → we stop suggesting entirely. */}
        <SwipeToDismiss onDismiss={dismissRecommendation} className="group">
        <Card className="relative overflow-hidden p-5 border-[hsl(var(--maroon)/0.35)]">
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-maroon" />
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="h-3 w-3 text-maroon" />
            <span className="text-[10px] tracking-widest uppercase text-maroon">Recommended for you</span>
          </div>
          <h3 className="text-lg font-semibold leading-snug">{recommended.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3 line-clamp-2 leading-relaxed">{recommended.description}</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Badge variant="outline" className="text-[10px] capitalize">{recommended.level}</Badge>
            <Badge variant="outline" className="text-[10px]">{recommended.routines?.length || 0} days/wk</Badge>
            <Badge variant="outline" className="text-[10px]">{recommended.duration_weeks} weeks</Badge>
            <Badge variant="outline" className="text-[10px] capitalize">{recommended.equipment}</Badge>
          </div>
          {weekDays.length > 0 && (
            <div className="flex items-center gap-1.5 mb-4">
              <span className="text-[10px] text-muted-foreground mr-0.5">Your week</span>
              {weekDays.map((d) => (
                <span key={d} className="text-[10px] px-2 py-0.5 rounded bg-maroon text-white">{d}</span>
              ))}
            </div>
          )}
          <Button
            size="sm"
            onClick={() => onOpenProgram?.(recommended.id)}
            className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            Start this plan
          </Button>
        </Card>
        </SwipeToDismiss>
      </div>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <Badge className="bg-[hsl(var(--maroon)/0.12)] text-maroon hover:bg-[hsl(var(--maroon)/0.12)] text-[10px] tracking-widest uppercase">
          {trainedToday ? "Trained today ✓" : "Next up"}
        </Badge>
        {restedDays !== null && (
          <span className="text-[11px] text-muted-foreground">
            {restedDays === Infinity ? "not trained yet" : `rested ${restedDays}d`}
          </span>
        )}
      </div>

      <h2 className="text-xl font-bold tracking-tight mt-2.5">{day ? day.name : routine.name}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        {plan ? `${plan.name} · ` : ""}{exs.length} exercises · ~{estMinutes} min
        {estLearned && <span className="text-muted-foreground/70"> (your average)</span>}
      </p>
      {readiness.length > 0 && (
        <p className="text-[11px] mt-1.5 text-muted-foreground">
          {anyWorked
            ? "Heads up — you trained these muscles today."
            : anyRecovering
              ? "These muscles are still recovering from yesterday."
              : "These muscles are recovered and ready."}
        </p>
      )}

      <div className="flex items-center gap-1.5 mt-3.5">
        {exs.slice(0, 5).map((e, i) => (
          <img
            key={i}
            src={e.image_url}
            alt=""
            title={e.name}
            className="h-10 w-10 rounded-full object-cover bg-white border border-border"
            onError={(ev) => { ev.currentTarget.style.opacity = 0.25; }}
          />
        ))}
        {exs.length > 5 && <span className="text-xs text-muted-foreground ml-1">+{exs.length - 5}</span>}
      </div>

      <Button
        onClick={start}
        className="w-full mt-4 bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white h-11 text-[15px]"
      >
        <Play className="h-4 w-4 mr-2" /> Start workout
      </Button>

      {day && days.length > 1 && (
        <div className="mt-2.5 text-center">
          <button
            onClick={() => setPickOpen((o) => !o)}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Not feeling it? Pick another day {pickOpen ? "▴" : "▾"}
          </button>
          {pickOpen && (
            <div className="mt-2 space-y-1 text-left">
              {days.map((d, di) => di !== nextIdx && (
                <button
                  key={di}
                  onClick={() => onStartDay(plan.id, di)}
                  className="w-full flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:border-[hsl(var(--maroon)/0.4)] transition"
                >
                  <span>{d.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {daysSince(d.last_completed_at) === Infinity ? "not yet" : `trained ${recencyLabel(d.last_completed_at)}`} · <Play className="h-3 w-3 inline" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* A plan is presented as a folder of routines (Hevy-style) — collapsed by default,
 * with all management tucked into a kebab menu. */
function PlanFolder({ plan, onStartDay, onReorder, onDelete, onSetCooldown, onImportDays, recovery = null }) {
  const days = plan.days || [];
  const hasRoutines = (plan.routines || []).length > 0;
  const cooldown = plan.cooldown_days ?? 7;
  // Same recovery-aware rule the hero uses — otherwise the two disagree about
  // which day is "Next" on the same screen.
  const nextIdx = suggestedDayIndex(days, recovery);
  const [open, setOpen] = useState(true);
  const [confirmDay, setConfirmDay] = useState(null);

  const handleStart = (di) => {
    if (cooldown > 0 && daysSince(days[di].last_completed_at) < cooldown) {
      setConfirmDay(di);
    } else {
      onStartDay(di);
    }
  };

  return (
    <div data-testid={WORKOUT.planCard} className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <Folder className="h-4 w-4 text-maroon shrink-0" />
          <span className="font-medium text-sm truncate">{plan.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {days.length} days · next: {days[nextIdx]?.name}
          </span>
          {hasRoutines && (
            <Badge variant="outline" className="text-[9px] shrink-0" title="Days are saved as routines you can edit">
              <ClipboardList className="h-2.5 w-2.5 mr-0.5" /> routines
            </Badge>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition" aria-label="Plan options">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Repeat guard: {cooldown === 0 ? "Off" : `${cooldown}d`}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-testid={WORKOUT.planCooldownSelect}>
                {COOLDOWN_OPTIONS.map(([v, l]) => (
                  <DropdownMenuItem key={v} onClick={() => onSetCooldown(Number(v))} className={String(cooldown) === v ? "bg-muted" : ""}>
                    {l}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {!hasRoutines && (
              <DropdownMenuItem onClick={onImportDays}>
                <ClipboardList className="h-4 w-4 mr-2" /> Save days as routines
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" /> Delete plan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && (
        <div className="border-t border-border divide-y divide-border">
          {days.map((day, di) => {
            const isNext = di === nextIdx;
            const n = daysSince(day.last_completed_at);
            return (
              <div key={di} className="flex items-center gap-3 px-3 py-2.5 group">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    {day.name}
                    {isNext && <Badge className="bg-maroon text-white text-[9px] px-1.5 py-0 hover:bg-maroon">Next</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {day.exercises?.length || 0} exercises · {n === Infinity ? "not trained yet" : `trained ${recencyLabel(day.last_completed_at)}`}
                  </div>
                </div>
                <div className="flex flex-col shrink-0">
                  <button
                    onClick={() => onReorder(di, -1)}
                    disabled={di === 0}
                    className="h-7 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-maroon hover:bg-muted active:scale-90 transition disabled:opacity-20"
                    aria-label="Move day up"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onReorder(di, +1)}
                    disabled={di === days.length - 1}
                    className="h-7 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-maroon hover:bg-muted active:scale-90 transition disabled:opacity-20"
                    aria-label="Move day down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
                <Button
                  data-testid={WORKOUT.startPlanDayButton}
                  size="sm"
                  variant={isNext ? "default" : "ghost"}
                  className={isNext ? "bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white h-8" : "h-8 text-muted-foreground"}
                  onClick={() => handleStart(di)}
                >
                  <Play className="h-3 w-3 mr-1" /> Start
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Soft repeat confirmation */}
      <Dialog open={confirmDay !== null} onOpenChange={(o) => !o && setConfirmDay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Train this day again?</DialogTitle>
            <DialogDescription>
              {confirmDay !== null && (
                <>You trained <span className="font-medium text-foreground">{days[confirmDay]?.name}</span> {recencyLabel(days[confirmDay]?.last_completed_at)}. You usually don&apos;t need to repeat it within {cooldown} days — but it&apos;s your call.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDay(null)}>Cancel</Button>
            <Button
              data-testid={WORKOUT.planRepeatConfirm}
              className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
              onClick={() => { const di = confirmDay; setConfirmDay(null); onStartDay(di); }}
            >
              <Play className="h-3.5 w-3.5 mr-1.5" /> Train anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Single-day routine as a simple minimal row. */
/* Collapsible folder of routines (Hevy-style grouping). */
function RoutineFolder({ name, count, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition"
      >
        <Folder className="h-4 w-4 text-maroon shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{name}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && <div className="px-2 pb-2 space-y-2">{children}</div>}
    </div>
  );
}

function RoutineRow({ routine, onStart, onView, onDelete, onMoveUp, onMoveDown, isFirst, isLast, folders = [], onSetFolder }) {
  const preview = (routine.exercises || []).map((e) => e.name).filter(Boolean).slice(0, 3).join(", ");
  return (
    <div data-testid={WORKOUT.routineCard} className="rounded-xl border border-border bg-card px-3 py-2.5 flex items-center gap-3 hover:border-[hsl(var(--maroon)/0.4)] transition group">
      <button onClick={onView} className="flex-1 min-w-0 text-left">
        <div className="text-sm font-medium truncate">{routine.name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {routine.exercises?.length ?? 0} exercises{preview ? ` · ${preview}` : ""}
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition" aria-label="Routine options">
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={onView}>View exercises</DropdownMenuItem>
          <DropdownMenuItem onClick={onMoveUp} disabled={isFirst}>
            <ArrowUp className="h-4 w-4 mr-2" /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onMoveDown} disabled={isLast}>
            <ArrowDown className="h-4 w-4 mr-2" /> Move down
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Folder className="h-4 w-4 mr-2" /> Move to folder
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {folders.filter((f) => f !== routine.folder).map((f) => (
                <DropdownMenuItem key={f} onClick={() => onSetFolder?.(f)}>{f}</DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => {
                  const n = window.prompt("Folder name");
                  if (n && n.trim()) onSetFolder?.(n.trim());
                }}
              >
                <Plus className="h-4 w-4 mr-2" /> New folder…
              </DropdownMenuItem>
              {routine.folder ? (
                <DropdownMenuItem onClick={() => onSetFolder?.("")}>Remove from folder</DropdownMenuItem>
              ) : null}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="h-4 w-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        data-testid={WORKOUT.startRoutineButton}
        size="sm"
        className="h-8 bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
        onClick={onStart}
      >
        <Play className="h-3 w-3 mr-1" /> Start
      </Button>
    </div>
  );
}

function ProgramCard({ program, onOpen }) {
  return (
    <Card
      data-testid={WORKOUT.programCard}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen?.(); }}
      className="p-5 hover:border-maroon/60 hover:shadow-md cursor-pointer transition group"
    >
      <div className="flex items-center justify-between">
        <Badge className="bg-maroon text-white capitalize">{program.level}</Badge>
        <span className="text-[11px] text-muted-foreground">{program.duration_weeks} weeks</span>
      </div>
      <div className="flex items-start justify-between mt-3 gap-2">
        <h3 className="font-semibold leading-snug">{program.name}</h3>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-maroon transition" />
      </div>
      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
        {program.description}
      </p>
      <div className="flex flex-wrap gap-1 mt-3">
        <Badge variant="outline" className="text-[10px] capitalize">{program.goal}</Badge>
        <Badge variant="outline" className="text-[10px] capitalize">{program.equipment}</Badge>
        <Badge variant="outline" className="text-[10px]">{program.routines?.length || 0} routines</Badge>
      </div>
    </Card>
  );
}

function RoutineBuilder({ open, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [exercises, setExercises] = useState([]); // [{exercise, sets, reps}]
  const [pickerOpen, setPickerOpen] = useState(false);
  const [buildId, setBuildId] = useState(0); // bumps each new build → picker filters reset
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setExercises([]); setBuildId((n) => n + 1); }
  }, [open]);

  // Add one or many at once; skip anything already in the routine (no duplicates).
  const addExercises = (list) => {
    setExercises((arr) => {
      const have = new Set(arr.map((r) => r.exercise.id));
      const fresh = list.filter((ex) => !have.has(ex.id)).map((ex) => ({ exercise: ex, sets: 3, reps: 10 }));
      return [...arr, ...fresh];
    });
  };

  const removeExercise = (idx) => {
    setExercises((arr) => arr.filter((_, i) => i !== idx));
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post("/routines", {
        name: name.trim(),
        exercises: exercises.map((e) => ({
          exercise_id: e.exercise.id,
          sets: e.sets,
          reps: e.reps,
          notes: "",
        })),
      });
      try { localStorage.setItem(BUILT_MANUALLY_KEY, "1"); } catch { /* ignore */ }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Routine</DialogTitle>
          <DialogDescription>Name it, then add exercises from the library.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            data-testid={WORKOUT.builderNameInput}
            placeholder="e.g. Push Day"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="space-y-2">
            {exercises.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <img src={row.exercise.image_url} alt="" className="h-10 w-10 rounded object-cover bg-muted" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{row.exercise.name}</div>
                  <div className="text-[11px] text-muted-foreground capitalize">
                    {row.exercise.muscle_group} · {row.exercise.equipment}
                  </div>
                </div>
                <Input
                  type="number"
                  className="w-16"
                  value={row.sets}
                  min={1}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 1;
                    setExercises((arr) => arr.map((r, i) => i === idx ? { ...r, sets: v } : r));
                  }}
                />
                <span className="text-xs text-muted-foreground">×</span>
                <Input
                  type="number"
                  className="w-16"
                  value={row.reps}
                  min={1}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 1;
                    setExercises((arr) => arr.map((r, i) => i === idx ? { ...r, reps: v } : r));
                  }}
                />
                <button onClick={() => removeExercise(idx)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {exercises.length === 0 && (
              <div className="text-sm text-muted-foreground border border-dashed rounded-md py-6 text-center">
                No exercises added yet
              </div>
            )}
          </div>

          <Button
            data-testid={WORKOUT.builderAddExerciseButton}
            variant="outline"
            className="w-full"
            onClick={() => setPickerOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" /> Add exercises
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            data-testid={WORKOUT.builderSaveButton}
            disabled={saving || !name.trim() || exercises.length === 0}
            onClick={save}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            {saving ? "Saving…" : "Save routine"}
          </Button>
        </DialogFooter>

        <ExercisePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onAdd={addExercises}
          existingIds={exercises.map((r) => r.exercise.id)}
          resetSignal={buildId}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ── Custom Plan Builder ────────────────────────────────────────────────────
 * Build a multi-day plan from scratch. Any number of days, any order,
 * any exercises per day. Uses the existing ExercisePicker + backend /plans.
 */

function PlanBuilder({ open, onClose, onSaved, onUseRoutines }) {
  const [name, setName] = useState("");
  const [days, setDays] = useState([]); // [{ name, exercises: [{exercise, sets, reps}] }]
  const [picker, setPicker] = useState(null); // { dayIdx } | null
  const [buildId, setBuildId] = useState(0); // bumps each new build → picker filters reset
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setDays([{ name: "Day 1", exercises: [] }]); setBuildId((n) => n + 1); }
  }, [open]);

  const addDay = () =>
    setDays((arr) => [...arr, { name: `Day ${arr.length + 1}`, exercises: [] }]);

  const removeDay = (idx) =>
    setDays((arr) => arr.filter((_, i) => i !== idx));

  const renameDay = (idx, next) =>
    setDays((arr) => arr.map((d, i) => (i === idx ? { ...d, name: next } : d)));

  const moveDay = (idx, dir) =>
    setDays((arr) => {
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return arr;
      const copy = arr.slice();
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });

  // Add one or many to a day at once; skip any already in that day (no duplicates per day).
  const addExercisesToDay = (dayIdx, list) =>
    setDays((arr) =>
      arr.map((d, i) => {
        if (i !== dayIdx) return d;
        const have = new Set(d.exercises.map((e) => e.exercise.id));
        const fresh = list.filter((ex) => !have.has(ex.id)).map((ex) => ({ exercise: ex, sets: 3, reps: 10 }));
        return { ...d, exercises: [...d.exercises, ...fresh] };
      }),
    );

  const patchExercise = (dayIdx, exIdx, patch) =>
    setDays((arr) =>
      arr.map((d, i) =>
        i === dayIdx
          ? { ...d, exercises: d.exercises.map((e, j) => (j === exIdx ? { ...e, ...patch } : e)) }
          : d,
      ),
    );

  const removeExercise = (dayIdx, exIdx) =>
    setDays((arr) =>
      arr.map((d, i) => (i === dayIdx ? { ...d, exercises: d.exercises.filter((_, j) => j !== exIdx) } : d)),
    );

  const canSave =
    !!name.trim() &&
    days.length > 0 &&
    days.every((d) => d.name.trim() && d.exercises.length > 0);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.post("/plans", {
        name: name.trim(),
        days: days.map((d) => ({
          name: d.name.trim(),
          exercises: d.exercises.map((e) => ({
            exercise_id: e.exercise.id, sets: e.sets, reps: e.reps, notes: "",
          })),
        })),
      });
      try { localStorage.setItem(BUILT_MANUALLY_KEY, "1"); } catch { /* ignore */ }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>New Plan</DialogTitle>
          <DialogDescription>
            Build a multi-day split. Add as many days as you like, in any order — train them however you want.
            {onUseRoutines && (
              <>
                {" "}
                <button type="button" onClick={onUseRoutines} className="text-maroon hover:underline">
                  Or build it from your saved routines.
                </button>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Plan name</div>
            <Input
              data-testid={WORKOUT.planBuilderNameInput}
              placeholder="e.g. My PPL Split"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            {days.map((day, di) => (
              <div key={di} className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col -my-1">
                    <button
                      onClick={() => moveDay(di, -1)}
                      disabled={di === 0}
                      className="h-7 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-maroon hover:bg-muted active:scale-90 transition disabled:opacity-20"
                      aria-label="Move day up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => moveDay(di, +1)}
                      disabled={di === days.length - 1}
                      className="h-7 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-maroon hover:bg-muted active:scale-90 transition disabled:opacity-20"
                      aria-label="Move day down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                  <Input
                    data-testid={WORKOUT.planBuilderDayNameInput}
                    className="flex-1 h-9 font-medium"
                    value={day.name}
                    onChange={(e) => renameDay(di, e.target.value)}
                    placeholder="Day name (e.g. Push Day)"
                  />
                  <button
                    onClick={() => removeDay(di)}
                    disabled={days.length === 1}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="Remove day"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  {day.exercises.map((row, ei) => (
                    <div key={ei} className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                      <img src={row.exercise.image_url} alt="" className="h-8 w-8 rounded object-cover bg-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{row.exercise.name}</div>
                        <div className="text-[10px] text-muted-foreground capitalize">
                          {row.exercise.muscle_group} · {row.exercise.equipment}
                        </div>
                      </div>
                      <Input
                        type="number"
                        className="w-14 h-8 text-center"
                        value={row.sets}
                        min={1}
                        onChange={(e) => patchExercise(di, ei, { sets: Number(e.target.value) || 1 })}
                      />
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input
                        type="number"
                        className="w-14 h-8 text-center"
                        value={row.reps}
                        min={1}
                        onChange={(e) => patchExercise(di, ei, { reps: Number(e.target.value) || 1 })}
                      />
                      <button
                        onClick={() => removeExercise(di, ei)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remove exercise"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {day.exercises.length === 0 && (
                    <div className="text-xs text-muted-foreground border border-dashed rounded-md py-3 text-center">
                      No exercises in this day yet
                    </div>
                  )}
                </div>

                <Button
                  data-testid={WORKOUT.planBuilderAddExerciseButton}
                  variant="outline"
                  size="sm"
                  className="w-full h-8"
                  onClick={() => setPicker({ dayIdx: di })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add exercise
                </Button>
              </div>
            ))}
          </div>

          <Button
            data-testid={WORKOUT.planBuilderAddDayButton}
            variant="outline"
            className="w-full border-dashed"
            onClick={addDay}
          >
            <Plus className="h-4 w-4 mr-2" /> Add day
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            data-testid={WORKOUT.planBuilderSaveButton}
            disabled={saving || !canSave}
            onClick={save}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            {saving ? "Saving…" : "Save plan"}
          </Button>
        </DialogFooter>

        <ExercisePicker
          open={picker !== null}
          onClose={() => setPicker(null)}
          onAdd={(list) => { if (picker) addExercisesToDay(picker.dayIdx, list); }}
          existingIds={picker ? (days[picker.dayIdx]?.exercises || []).map((e) => e.exercise.id) : []}
          resetSignal={buildId}
        />
      </DialogContent>
    </Dialog>
  );
}
