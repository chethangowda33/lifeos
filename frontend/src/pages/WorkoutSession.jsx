import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import api from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { enqueue, isNetworkError } from "@/lib/offlineQueue";
import {
  Timer, ChevronDown, Plus, Check, Play, Pause, MoreVertical, X, Flame, Trash2,
  ArrowUp, ArrowDown, Repeat, Dumbbell, Calculator, Link2, Unlink, Info, Sparkles, Trophy, StickyNote,
} from "lucide-react";
import PlateCalculator from "@/components/PlateCalculator";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import ExerciseDetailDialog from "@/components/ExerciseDetailDialog";
import ShareWorkoutButton from "@/components/ShareWorkoutCard";
import IntervalTimer from "@/components/IntervalTimer";
import ExercisePicker from "@/components/ExercisePicker";
import SetRow from "@/features/workout/session/SetRow";
import RestTimerRow from "@/features/workout/session/RestTimer";
import { fmtClock, fmtDuration, fmtRelative } from "@/features/workout/lib/format";
import { buildWorkoutPayload, describeApiError } from "@/features/workout/lib/payload";
import { sessionStats } from "@/features/workout/lib/stats";
import confetti from "canvas-confetti";
import { SESSION } from "@/constants/testIds";

// Read the themed accent color as hex (for confetti particles).
function accentHex() {
  const probe = document.createElement("span");
  probe.style.color = "hsl(var(--maroon))";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = rgb.match(/\d+/g) || [200, 20, 40];
  return "#" + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

// Muscle groups that are time-based (no kg/reps — use duration). Core is rep-based
// (sit-ups, crunches, leg raises); only cardio defaults to duration.
const TIME_BASED = new Set(["cardio"]);

// Rest-timer end alert — short beep (Web Audio) + haptic buzz. (exported: reused by IntervalTimer)
let _audioCtx = null;
export function restAlert() {
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* unsupported */ }
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    [0, 0.18].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.16);
    });
  } catch { /* audio blocked */ }
}

// Warm-up ramp: percentage of working weight × reps (pure function, no ML).
const WARMUP_RAMP = [
  [0.4, 10],
  [0.6, 5],
  [0.8, 3],
];

function generateWarmupSets(workingKg) {
  return WARMUP_RAMP.map(([pct, reps]) => ({
    set_type: "warmup",
    kg: Math.max(2.5, Math.round((workingKg * pct) / 2.5) * 2.5),
    reps,
    duration_seconds: null,
    rpe: null,
    completed: false,
    previous: null,
  }));
}

// Build live-session exercises from a routine/plan-day exercise list (fetches "previous").
async function buildSessionExercises(list, settings) {
  const items = list || [];
  const mode = settings?.previous_workout_values_mode || "default";
  const restDefault = settings?.default_rest_timer_seconds ?? 90;
  const prevAll = await Promise.all(
    items.map((ex) =>
      api.get(`/exercises/${ex.exercise_id}/previous`, { params: { mode } }).then((r) => r.data.sets).catch(() => []),
    ),
  );
  return items.map((ex, i) => {
    const muscle = ex.muscle_group || "";
    const isTime = TIME_BASED.has(muscle);
    const prev = prevAll[i] || [];
    return {
      uid: `${ex.exercise_id}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      exercise_id: ex.exercise_id,
      name: ex.name,
      image_url: ex.image_url,
      muscle_group: muscle,
      equipment: ex.equipment,
      instructions: ex.instructions,
      notes: "",
      rest_timer_seconds: restDefault,
      superset_group_id: null,
      target_reps: ex.reps || 10,
      time_based: isTime,
      sets: Array.from({ length: ex.sets || 3 }, (_, idx) => ({
        set_type: "working", kg: null, reps: null, duration_seconds: null,
        distance_m: null, rpe: null, completed: false, previous: prev[idx] || null,
      })),
    };
  });
}

// ── In-progress session persistence (survives refresh / accidental navigation) ─
const SESSION_STORAGE_PREFIX = "lifeos:session:v1:";

function sessionStorageKey({ planId, dayIndex, routineId }) {
  if (planId) return `${SESSION_STORAGE_PREFIX}plan:${planId}:${dayIndex}`;
  return `${SESSION_STORAGE_PREFIX}routine:${routineId || "empty"}`;
}

function readSnapshot(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Worth resuming only if the user actually logged something.
function sessionHasProgress(exs) {
  return (exs || []).some(
    (ex) =>
      (ex.notes && ex.notes.trim()) ||
      (ex.sets || []).some((s) => s.completed || s.kg || s.reps || s.duration_seconds),
  );
}

function snapshotCompletedSets(exs) {
  let n = 0;
  (exs || []).forEach((ex) => (ex.sets || []).forEach((s) => { if (s.completed) n += 1; }));
  return n;
}

export default function WorkoutSession() {
  const navigate = useNavigate();
  const { routineId, planId, dayIndex } = useParams();
  const location = useLocation();
  const { toast } = useToast();

  const storageKey = sessionStorageKey({ planId, dayIndex, routineId });

  const [name, setName] = useState("Workout");
  const [exercises, setExercises] = useState([]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [savingOpen, setSavingOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [saveAsRoutine, setSaveAsRoutine] = useState(false);
  const [summary, setSummary] = useState(null); // post-save celebration
  const [saving, setSaving] = useState(false);
  const [exerciseDetailId, setExerciseDetailId] = useState(null);
  const [restState, setRestState] = useState({}); // { uid: { remaining, total, running } }
  const [picker, setPicker] = useState(null); // null | { mode: 'add' } | { mode: 'replace', uid } | { mode: 'swap', uid }
  const [hydrated, setHydrated] = useState(false); // gates persistence until resume decision
  const [resumeSnapshot, setResumeSnapshot] = useState(null); // saved session awaiting resume/discard
  const [settings, setSettings] = useState(null); // workout settings (rest default, PR toasts, …)
  const [progression, setProgression] = useState({}); // { exercise_id: { suggested_kg, trend, … } }
  const [exerciseNotes, setExerciseNotes] = useState({}); // { exercise_id: persistent note }
  const [plateCalc, setPlateCalc] = useState(null); // null | { weight }
  const [intervalOpen, setIntervalOpen] = useState(false); // interval/EMOM/HIIT timer dialog
  const [rpeInfoOpen, setRpeInfoOpen] = useState(false);
  const recordsRef = useRef({}); // { exercise_id: records } — live PR checks
  const wakeLockRef = useRef(null);
  const tickRef = useRef();

  // Keep screen awake during the workout (Screen Wake Lock API)
  useEffect(() => {
    if (!settings?.keep_screen_awake_during_workout || !navigator.wakeLock) return undefined;
    let released = false;
    const acquire = async () => {
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      } catch { /* unsupported / denied — fine */ }
    };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible" && !released) acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVis);
      try { wakeLockRef.current?.release(); } catch { /* ignore */ }
    };
  }, [settings?.keep_screen_awake_during_workout]);

  // Prefetch stored PRs for live PR notifications
  const ensureRecords = (exerciseId) => {
    if (!exerciseId || recordsRef.current[exerciseId]) return;
    recordsRef.current[exerciseId] = {}; // mark as pending
    api.get(`/exercises/${exerciseId}/records`)
      .then((r) => { recordsRef.current[exerciseId] = r.data.records || {}; })
      .catch(() => {});
  };
  useEffect(() => { exercises.forEach((ex) => ensureRecords(ex.exercise_id)); }, [exercises]);

  // Celebrate on the post-workout summary — extra bursts when PRs were set.
  useEffect(() => {
    if (!summary) return;
    let cancelled = false;
    const colors = [accentHex(), "#f5a623", "#ffffff"];
    const bursts = summary.prs?.length ? 3 : 1;
    for (let i = 0; i < bursts; i++) {
      setTimeout(() => {
        if (!cancelled) confetti({ particleCount: 80, spread: 75, startVelocity: 42, origin: { y: 0.65 }, colors });
      }, i * 300);
    }
    return () => { cancelled = true; };
  }, [summary]);

  // Load a plan day, a routine, or start empty — then offer to resume any saved session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let freshName = "Workout";
      let freshExercises = [];
      let prefs = null;
      try {
        prefs = await api.get("/workout-settings").then((r) => r.data).catch(() => null);
        if (!cancelled) setSettings(prefs);
        api.get("/progression").then((r) => { if (!cancelled) setProgression(r.data || {}); }).catch(() => {});
        api.get("/exercises/notes").then((r) => { if (!cancelled) setExerciseNotes(r.data || {}); }).catch(() => {});
        if (planId) {
          const { data: plans } = await api.get("/plans");
          const plan = plans.find((p) => p.id === planId);
          const di = Number(dayIndex);
          const day = plan?.days?.[di];
          if (!plan || !day) {
            toast({ title: "Plan day not found", variant: "destructive" });
            navigate("/workout");
            return;
          }
          freshName = `${plan.name} — ${day.name}`;
          freshExercises = await buildSessionExercises(day.exercises, prefs);
        } else if (routineId === "empty") {
          freshName = "Quick Workout";
          freshExercises = [];
        } else {
          const { data: routines } = await api.get("/routines");
          const r = routines.find((x) => x.id === routineId);
          if (!r) {
            toast({ title: "Routine not found", variant: "destructive" });
            navigate("/workout");
            return;
          }
          freshName = r.name;
          freshExercises = await buildSessionExercises(r.exercises, prefs);
        }
      } catch (e) {
        toast({ title: "Could not load", description: String(e.message || e), variant: "destructive" });
        return;
      }
      if (cancelled) return;

      // Show the fresh plan first, then check for a resumable in-progress session.
      setName(freshName);
      setExercises(freshExercises);
      const saved = readSnapshot(storageKey);
      if (saved && sessionHasProgress(saved.exercises)) {
        setResumeSnapshot(saved); // opens the resume dialog; persistence stays paused
      } else {
        if (saved) localStorage.removeItem(storageKey);
        setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [routineId, planId, dayIndex, navigate, toast, storageKey]);

  // Persist the in-progress session (only after the resume decision is made)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ v: 1, name, description, startedAt, exercises, savedAt: Date.now() }),
      );
    } catch { /* ignore quota errors */ }
  }, [hydrated, storageKey, name, description, startedAt, exercises]);

  const resumeSession = () => {
    const s = resumeSnapshot;
    if (s) {
      if (s.name) setName(s.name);
      setDescription(s.description || "");
      setExercises(s.exercises || []);
      if (s.startedAt) setStartedAt(s.startedAt);
    }
    setResumeSnapshot(null);
    setHydrated(true);
  };

  const discardSaved = () => {
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    setResumeSnapshot(null);
    setHydrated(true);
  };

  // Heartbeat for duration + rest timers
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setNow(Date.now());
      setRestState((rs) => {
        const out = { ...rs };
        for (const k of Object.keys(out)) {
          if (out[k].running && out[k].remaining > 0) {
            out[k] = { ...out[k], remaining: out[k].remaining - 1 };
            if (out[k].remaining === 0) {
              out[k].running = false;
              restAlert(); // beep + vibrate when rest ends
            }
          }
        }
        return out;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, []);

  const durationSecs = Math.floor((now - startedAt) / 1000);
  const stats = useMemo(() => sessionStats(exercises), [exercises]);

  const setEx = (i, fn) =>
    setExercises((arr) => arr.map((e, idx) => (idx === i ? fn(e) : e)));

  const saveExerciseNote = (exerciseId, note) => {
    setExerciseNotes((m) => ({ ...m, [exerciseId]: note }));
    api.put(`/exercises/${exerciseId}/note`, { note }).catch(() => {});
  };

  const updateSet = (exIdx, setIdx, patch) =>
    setEx(exIdx, (e) => ({
      ...e,
      sets: e.sets.map((s, j) => (j === setIdx ? { ...s, ...patch } : s)),
    }));

  const addSet = (exIdx) =>
    setEx(exIdx, (e) => ({
      ...e,
      sets: [...e.sets, {
        set_type: "working", kg: null, reps: null, duration_seconds: null, rpe: null, completed: false, previous: null,
      }],
    }));

  const removeSet = (exIdx, setIdx) =>
    setEx(exIdx, (e) => ({ ...e, sets: e.sets.filter((_, j) => j !== setIdx) }));

  const toggleComplete = (exIdx, setIdx) => {
    const ex = exercises[exIdx];
    const s = ex.sets[setIdx];
    const newVal = !s.completed;
    // Completing a set adopts the greyed "previous" values you see if you didn't
    // type your own — so tapping ✓ actually logs weight/reps (fixes volume = 0).
    const patch = { completed: newVal };
    const empty = (v) => v === "" || v == null;
    // Adopt the greyed "previous" values only if you left the field blank AND the
    // previous value is real (never overwrite with a meaningless 0).
    if (newVal && s.previous) {
      if (empty(s.kg) && s.previous.kg) patch.kg = s.previous.kg;
      if (empty(s.reps) && s.previous.reps) patch.reps = s.previous.reps;
      if (empty(s.duration_seconds) && s.previous.duration_seconds) patch.duration_seconds = s.previous.duration_seconds;
    }
    updateSet(exIdx, setIdx, patch);
    // Start rest timer
    if (newVal && ex.rest_timer_seconds > 0) {
      setRestState((rs) => ({
        ...rs,
        [ex.uid]: { remaining: ex.rest_timer_seconds, total: ex.rest_timer_seconds, running: true },
      }));
    }
    if (!newVal) return;

    // Live PR check — real-time against stored records
    if (settings?.live_pr_notification_enabled !== false && s.set_type !== "warmup") {
      const rec = recordsRef.current[ex.exercise_id] || {};
      const kg = Number(s.kg) || 0;
      const reps = Number(s.reps) || 0;
      const dur = Number(s.duration_seconds) || 0;
      const dist = Number(s.distance_m) || 0;
      const beats = [];
      if (kg && kg > (rec.weight?.value || 0)) beats.push(`${kg} kg — heaviest weight`);
      if (kg && reps && kg * reps > (rec.volume?.value || 0)) beats.push(`${(kg * reps).toFixed(0)} kg set volume`);
      if (dur && dur > (rec.duration?.value || 0)) beats.push("longest duration");
      if (dist && dist > (rec.distance?.value || 0)) beats.push(`${dist} m — longest distance`);
      if (beats.length && Object.keys(rec).length) {
        try { navigator.vibrate?.(200); } catch { /* ignore */ }
        toast({ title: `🏆 New PR — ${ex.name}`, description: beats.join(" · ") });
      }
    }

    // Smart superset scrolling — jump to the next exercise in the same group
    if (settings?.smart_superset_scrolling !== false && ex.superset_group_id) {
      const group = exercises.filter((e) => e.superset_group_id === ex.superset_group_id);
      const pos = group.findIndex((e) => e.uid === ex.uid);
      const next = group[(pos + 1) % group.length];
      if (next && next.uid !== ex.uid) {
        setTimeout(() => {
          document.getElementById(`ex-card-${next.uid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 250);
      }
    }
  };

  // ── Superset grouping ──────────────────────────────────────────────────────
  const supersetWithNext = (exIdx) => {
    setExercises((arr) => {
      if (exIdx >= arr.length - 1) return arr;
      const gid = arr[exIdx].superset_group_id || arr[exIdx + 1].superset_group_id
        || `ss-${Math.random().toString(36).slice(2, 8)}`;
      return arr.map((e, i) => (i === exIdx || i === exIdx + 1 ? { ...e, superset_group_id: gid } : e));
    });
  };

  const removeFromSuperset = (exIdx) =>
    setEx(exIdx, (e) => ({ ...e, superset_group_id: null }));

  // ── Warm-up calculator: prefill percentage-ramp warm-up rows ───────────────
  const [warmupDialog, setWarmupDialog] = useState(null); // { exIdx, weight }
  const addWarmups = (exIdx) => {
    const ex = exercises[exIdx];
    const detected = Number(ex.sets.find((s) => s.set_type !== "warmup" && s.kg)?.kg)
      || Number(ex.sets.find((s) => s.previous?.kg)?.previous.kg) || "";
    // Always ask (pre-filled when we can detect it) so the ramp is never a mystery.
    setWarmupDialog({ exIdx, weight: detected });
  };
  const confirmWarmups = () => {
    const { exIdx, weight } = warmupDialog || {};
    const working = Number(weight);
    setWarmupDialog(null);
    if (!working || working <= 0) {
      toast({ title: "Enter a valid working weight", variant: "destructive" });
      return;
    }
    setEx(exIdx, (e) => ({
      ...e,
      sets: [...generateWarmupSets(working), ...e.sets.filter((s) => s.set_type !== "warmup")],
    }));
    toast({ title: "Warm-up sets added", description: `Ramp to ${working} kg: 40% × 10 · 60% × 5 · 80% × 3` });
  };

  const setRestTimer = (exIdx, seconds) =>
    setEx(exIdx, (e) => ({ ...e, rest_timer_seconds: seconds }));

  const setNotes = (exIdx, notes) =>
    setEx(exIdx, (e) => ({ ...e, notes }));

  // ── Mid-session exercise management ───────────────────────────────────────
  const buildExercise = async (picked, setCount, uid) => {
    const muscle = picked.muscle_group || "";
    const isTime = TIME_BASED.has(muscle);
    let prev = [];
    try {
      const res = await api.get(`/exercises/${picked.id}/previous`, {
        params: { mode: settings?.previous_workout_values_mode || "default" },
      });
      prev = res.data.sets || [];
    } catch { /* no previous — fine */ }
    return {
      uid: uid || `${picked.id}-${Math.random().toString(36).slice(2, 8)}`,
      exercise_id: picked.id,
      name: picked.name,
      image_url: picked.image_url,
      muscle_group: muscle,
      equipment: picked.equipment,
      instructions: picked.instructions,
      notes: "",
      rest_timer_seconds: settings?.default_rest_timer_seconds ?? 90,
      superset_group_id: null,
      target_reps: 10,
      time_based: isTime,
      sets: Array.from({ length: Math.max(1, setCount) }, (_, idx) => ({
        set_type: "working", kg: null, reps: null, duration_seconds: null,
        distance_m: null, rpe: null, completed: false, previous: prev[idx] || null,
      })),
    };
  };

  // Replace mode → single pick swaps one exercise in place.
  const onPickExercise = async (picked) => {
    const replaceUid = picker?.uid;
    setPicker(null);
    const target = exercises.find((e) => e.uid === replaceUid);
    const built = await buildExercise(picked, target ? target.sets.length : 1, replaceUid);
    setExercises((arr) => arr.map((e) => (e.uid === replaceUid ? built : e)));
    toast({ title: "Exercise replaced", description: picked.name });
  };

  // Add mode → add one or many exercises at once.
  const onAddExercises = async (list) => {
    setPicker(null);
    const built = await Promise.all(list.map((ex) => buildExercise(ex, 1)));
    setExercises((arr) => [...arr, ...built]);
  };

  const removeExercise = (uid) => {
    const ex = exercises.find((e) => e.uid === uid);
    if (ex && !window.confirm(`Remove ${ex.name} from this workout?`)) return;
    setExercises((arr) => arr.filter((e) => e.uid !== uid));
  };

  const moveExercise = (uid, dir) =>
    setExercises((arr) => {
      const i = arr.findIndex((e) => e.uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return arr;
      const copy = arr.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  // ── Swap for a similar exercise (same muscle + movement pattern) ───────────
  const [swapDialog, setSwapDialog] = useState(null); // { uid, subs: [] }
  const openSwap = async (uid) => {
    const ex = exercises.find((e) => e.uid === uid);
    if (!ex) return;
    try {
      const { data } = await api.get(`/exercises/${ex.exercise_id}/substitutes`);
      setSwapDialog({ uid, subs: data.substitutes || [] });
    } catch {
      toast({ title: "No substitutes found", variant: "destructive" });
    }
  };
  const doSwap = async (picked) => {
    const uid = swapDialog?.uid;
    setSwapDialog(null);
    if (!uid) return;
    const target = exercises.find((e) => e.uid === uid);
    const built = await buildExercise(picked, target ? target.sets.length : 1, uid);
    setExercises((arr) => arr.map((e) => (e.uid === uid ? built : e)));
    toast({ title: "Exercise swapped", description: picked.name });
  };

  // Save flow
  const submitSave = async () => {
    setSaving(true);
    const workoutPayload = buildWorkoutPayload({
      name, description, durationSecs, routineId, planId, dayIndex, exercises,
    });
    const routinePayload = {
      name,
      exercises: exercises.map((ex) => ({
        exercise_id: ex.exercise_id,
        sets: ex.sets.filter((s) => s.set_type !== "warmup").length || ex.sets.length,
        reps: ex.target_reps || 10,
        notes: "",
      })),
    };

    // Shared completion — clears the draft and shows the post-workout summary.
    const finishLocal = (saved) => {
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      setSavingOpen(false);
      setSummary({
        name,
        sets: stats.sets,
        volume: stats.volume,
        duration: durationSecs,
        prs: saved?.pr_events || [], // no server PRs when saved offline
        muscles: [...new Set(exercises.map((ex) => ex.muscle_group).filter(Boolean))],
      });
    };

    try {
      const { data: saved } = await api.post("/workouts", workoutPayload);
      if (saveAsRoutine && exercises.length) {
        try {
          await api.post("/routines", routinePayload);
          toast({ title: "Routine saved", description: `"${name}" added to your routines` });
        } catch { /* non-blocking */ }
      }
      finishLocal(saved);
    } catch (e) {
      // Offline / server unreachable → queue it and finish anyway. It syncs on reconnect.
      if (isNetworkError(e) || !navigator.onLine) {
        enqueue({ url: "/workouts", method: "post", body: workoutPayload, label: name });
        if (saveAsRoutine && exercises.length) {
          enqueue({ url: "/routines", method: "post", body: routinePayload, label: `${name} (routine)` });
        }
        toast({ title: "Saved offline", description: "This workout will sync automatically when you're back online." });
        finishLocal(null);
      } else {
        // Surface the real validation error (which field) instead of a bare "422".
        toast({ title: "Could not save", description: describeApiError(e), variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (!window.confirm("Discard this workout? All entered sets will be lost.")) return;
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    navigate("/workout");
  };

  return (
    <div data-testid={SESSION.root} className="max-w-3xl mx-auto -mx-4 sm:-mx-6 lg:-mx-10 -my-6 lg:-my-10">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3">
          <button onClick={() => navigate("/workout")} className="p-2 -ml-2 rounded-md hover:bg-muted">
            <ChevronDown className="h-5 w-5" />
          </button>
          <div className="font-semibold tracking-tight truncate flex-1 px-3">{name}</div>
          <button
            onClick={() => setIntervalOpen(true)}
            aria-label="Interval timer"
            className="p-2 mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <Timer className="h-5 w-5" />
          </button>
          <Button
            data-testid={SESSION.finishButton}
            onClick={() => setSavingOpen(true)}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            Finish
          </Button>
        </div>
        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3 px-4 sm:px-6 pb-3 text-sm">
          <StatPill testId={SESSION.duration} label="Duration" value={fmtDuration(durationSecs)} accent />
          <StatPill testId={SESSION.volume} label="Volume" value={`${stats.volume.toFixed(0)} kg`} />
          <StatPill testId={SESSION.setsCount} label="Sets" value={stats.sets} />
        </div>
      </div>

      {/* Exercises */}
      <div className="px-4 sm:px-6 py-6 space-y-6">
        {exercises.length === 0 && (
          <Card className="p-10 text-center border-dashed">
            <Flame className="h-10 w-10 mx-auto text-maroon" />
            <h3 className="text-lg font-semibold mt-3">Empty workout</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Add exercises as you go — finish whenever you&apos;re done.
            </p>
            <Button
              data-testid={SESSION.addExerciseButton}
              onClick={() => setPicker({ mode: "add" })}
              className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            >
              <Plus className="h-4 w-4 mr-2" /> Add Exercise
            </Button>
          </Card>
        )}
        {exercises.map((ex, i) => (
          <ExerciseSessionCard
            key={ex.uid}
            exercise={ex}
            index={i}
            total={exercises.length}
            restState={restState[ex.uid]}
            settings={settings}
            progression={progression[ex.exercise_id]}
            exerciseNote={exerciseNotes[ex.exercise_id] || ""}
            onSaveExerciseNote={(text) => saveExerciseNote(ex.exercise_id, text)}
            onSetUpdate={(setIdx, patch) => updateSet(i, setIdx, patch)}
            onAddSet={() => addSet(i)}
            onRemoveSet={(j) => removeSet(i, j)}
            onToggleComplete={(setIdx) => toggleComplete(i, setIdx)}
            onSetRest={(secs) => setRestTimer(i, secs)}
            onSetNotes={(notes) => setNotes(i, notes)}
            onShowDetail={() => setExerciseDetailId(ex.exercise_id)}
            onSkipRest={() => setRestState((rs) => ({ ...rs, [ex.uid]: { ...rs[ex.uid], running: false, remaining: 0 } }))}
            onAdjustRest={(delta) => setRestState((rs) => ({ ...rs, [ex.uid]: { ...rs[ex.uid], remaining: Math.max(0, (rs[ex.uid]?.remaining || 0) + delta) } }))}
            onMoveUp={() => moveExercise(ex.uid, -1)}
            onMoveDown={() => moveExercise(ex.uid, +1)}
            onReplace={() => setPicker({ mode: "replace", uid: ex.uid })}
            onSwap={() => openSwap(ex.uid)}
            onRemoveExercise={() => removeExercise(ex.uid)}
            onSupersetWithNext={() => supersetWithNext(i)}
            onRemoveSuperset={() => removeFromSuperset(i)}
            onAddWarmups={() => addWarmups(i)}
            onOpenPlateCalc={(weight) => setPlateCalc({ weight })}
            onRpeInfo={() => setRpeInfoOpen(true)}
          />
        ))}

        {exercises.length > 0 && (
          <Button
            data-testid={SESSION.addExerciseButton}
            variant="outline"
            onClick={() => setPicker({ mode: "add" })}
            className="w-full border-dashed hover:border-[hsl(var(--maroon)/0.5)] hover:text-maroon"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Exercise
          </Button>
        )}

        <Button
          data-testid={SESSION.discardButton}
          variant="outline"
          onClick={discard}
          className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-4 w-4 mr-2" /> Discard Workout
        </Button>
      </div>

      {/* Resume in-progress session dialog */}
      <Dialog open={!!resumeSnapshot} onOpenChange={(o) => { if (!o) resumeSession(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resume unfinished workout?</DialogTitle>
            <DialogDescription>
              You have an in-progress session
              {resumeSnapshot?.savedAt ? ` saved ${fmtRelative(new Date(resumeSnapshot.savedAt).toISOString())}` : ""}.
              Pick up where you left off, or start fresh.
            </DialogDescription>
          </DialogHeader>
          {resumeSnapshot && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="font-medium truncate">{resumeSnapshot.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {snapshotCompletedSets(resumeSnapshot.exercises)} sets logged · {resumeSnapshot.exercises?.length || 0} exercises
              </div>
            </div>
          )}
          <DialogFooter>
            <Button data-testid={SESSION.discardSavedButton} variant="ghost" onClick={discardSaved}>
              Discard &amp; start fresh
            </Button>
            <Button
              data-testid={SESSION.resumeButton}
              onClick={resumeSession}
              className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            >
              <Play className="h-3.5 w-3.5 mr-1.5" /> Resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save dialog */}
      <Dialog open={savingOpen} onOpenChange={(o) => !o && setSavingOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save Workout</DialogTitle>
            <DialogDescription>Add a title and a quick note about how it went.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Title</div>
              <Input
                data-testid={SESSION.saveTitle}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Duration" value={fmtDuration(durationSecs)} />
              <MiniStat label="Volume" value={`${stats.volume.toFixed(0)} kg`} />
              <MiniStat label="Sets" value={stats.sets} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Description</div>
              <Textarea
                data-testid={SESSION.saveDescription}
                placeholder="How did your workout go? Leave some notes here…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Save as routine</div>
                <div className="text-[11px] text-muted-foreground">Reuse these exercises anytime</div>
              </div>
              <Switch checked={saveAsRoutine} onCheckedChange={setSaveAsRoutine} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSavingOpen(false)}>Cancel</Button>
            <Button
              data-testid={SESSION.saveSubmit}
              disabled={saving}
              onClick={submitSave}
              className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            >
              {saving ? "Saving…" : "Save Workout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-save celebration summary */}
      <Dialog open={!!summary} onOpenChange={(o) => { if (!o) { setSummary(null); navigate("/progress"); } }}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader>
            <DialogTitle className="text-2xl">Workout complete 💪</DialogTitle>
            <DialogDescription>Nice work — here&apos;s how it went.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Duration" value={fmtDuration(summary?.duration || 0)} />
            <MiniStat label="Volume" value={`${(summary?.volume || 0).toFixed(0)} kg`} />
            <MiniStat label="Sets" value={summary?.sets || 0} />
          </div>
          {summary?.prs?.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-left space-y-1.5">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                <Trophy className="h-4 w-4 text-maroon" /> {summary.prs.length} new personal record{summary.prs.length > 1 ? "s" : ""}
              </div>
              {summary.prs.slice(0, 5).map((pr, i) => (
                <div key={i} className="text-xs text-muted-foreground">
                  <span className="text-foreground font-medium">{pr.exercise_name}</span> — {pr.label}: {pr.value}
                  {pr.pr_type === "reps" ? " reps" : pr.pr_type === "duration" ? "s" : pr.pr_type === "distance" ? " m" : pr.pr_type === "pace" ? " km/h" : " kg"}
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <ShareWorkoutButton summary={summary} />
            <Button
              onClick={() => { setSummary(null); navigate("/progress"); }}
              className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IntervalTimer open={intervalOpen} onClose={() => setIntervalOpen(false)} onAlert={restAlert} />

      <ExerciseDetailDialog
        open={!!exerciseDetailId}
        exerciseId={exerciseDetailId}
        onClose={() => setExerciseDetailId(null)}
      />

      <ExercisePicker
        open={!!picker}
        onClose={() => setPicker(null)}
        multiSelect={picker?.mode !== "replace"}
        onPick={onPickExercise}
        onAdd={onAddExercises}
      />

      {/* Plate calculator */}
      <PlateCalculator
        open={!!plateCalc}
        onClose={() => setPlateCalc(null)}
        initialWeight={plateCalc?.weight || ""}
        settings={settings}
      />

      {/* Warm-up ramp dialog */}
      <Dialog open={!!warmupDialog} onOpenChange={(o) => !o && setWarmupDialog(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Warm-up Calculator</DialogTitle>
            <DialogDescription>
              Generates a ramp from your working weight: 40% × 10, 60% × 5, 80% × 3.
            </DialogDescription>
          </DialogHeader>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Working weight (kg)</div>
            <Input
              type="number"
              autoFocus
              value={warmupDialog?.weight ?? ""}
              onChange={(e) => setWarmupDialog((d) => ({ ...d, weight: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && confirmWarmups()}
              placeholder="e.g. 80"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWarmupDialog(null)}>Cancel</Button>
            <Button onClick={confirmWarmups} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
              Add Warm-ups
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RPE explainer */}
      <Dialog open={rpeInfoOpen} onOpenChange={setRpeInfoOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>What is RPE?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              RPE (Rate of Perceived Exertion) is a subjective <b>6–10 scale</b> for how hard a set felt,
              in 0.5 increments.
            </p>
            <ul className="space-y-1">
              <li><b>10</b> — max effort, no reps left</li>
              <li><b>9</b> — 1 rep left in the tank</li>
              <li><b>8</b> — 2 reps left</li>
              <li><b>7</b> — 3 reps left, bar speed still fast</li>
              <li><b>6</b> — warm-up territory, very comfortable</li>
            </ul>
            <p>Logging RPE powers your progressive-overload suggestions and deload detection.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Swap exercise — same muscle + movement pattern */}
      <Dialog open={!!swapDialog} onOpenChange={(o) => !o && setSwapDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Swap for a similar exercise</DialogTitle>
            <DialogDescription>Same muscle group and movement pattern.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {(swapDialog?.subs || []).length === 0 && (
              <p className="text-sm text-muted-foreground">No close substitutes found — use Replace to pick anything.</p>
            )}
            {(swapDialog?.subs || []).map((s) => (
              <button
                key={s.id}
                onClick={() => doSwap(s)}
                className="w-full flex items-center gap-3 rounded-lg border border-border p-2.5 hover:border-[hsl(var(--maroon)/0.5)] hover:bg-muted/50 transition text-left"
              >
                <img src={s.image_url} alt="" className="h-10 w-10 rounded-full object-cover bg-white border border-border" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="text-[11px] text-muted-foreground capitalize">{s.equipment} · {s.movement_pattern}</div>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub components ────────────────────────────────────────────────────────

function StatPill({ label, value, accent, testId }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${accent ? "bg-maroon text-white" : "bg-muted"}`}>
      <div className={`text-[10px] uppercase tracking-widest ${accent ? "text-white/80" : "text-muted-foreground"}`}>{label}</div>
      <div data-testid={testId} className="text-base font-semibold">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-md bg-muted py-2 px-1">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function ExerciseSessionCard({
  exercise, index, total, restState, settings, progression, onSetUpdate, onAddSet, onRemoveSet,
  onToggleComplete, onSetRest, onSetNotes, onShowDetail, onSkipRest, onAdjustRest,
  onMoveUp, onMoveDown, onReplace, onSwap, onRemoveExercise,
  onSupersetWithNext, onRemoveSuperset, onAddWarmups, onOpenPlateCalc, onRpeInfo,
  exerciseNote, onSaveExerciseNote,
}) {
  const ex = exercise;
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const restRunning = !!restState?.running;
  const restRemaining = restState?.remaining ?? 0;
  const isBarbell = (ex.equipment || "").toLowerCase() === "barbell";
  const isBodyweight = (ex.equipment || "").toLowerCase() === "bodyweight";
  const showPlateCalc = isBarbell && settings?.plate_calculator_enabled !== false;
  const showRpe = settings?.rpe_tracking_enabled !== false;
  const suggestion = progression && !ex.time_based ? progression : null;

  let workingIdx = 0; // running number for working sets (warm-ups show "W")

  return (
    <Card
      id={`ex-card-${ex.uid}`}
      data-testid={SESSION.exerciseCard}
      className={`p-4 sm:p-5 ${ex.superset_group_id ? "border-l-4 border-l-[hsl(var(--maroon))]" : ""}`}
    >
      <div className="flex items-start gap-3">
        <button onClick={onShowDetail} className="shrink-0">
          <img
            src={ex.image_url}
            alt=""
            className="h-12 w-12 rounded-full object-cover bg-white border border-border"
            onError={(e) => { e.currentTarget.style.opacity = 0.3; }}
          />
        </button>
        <div className="flex-1 min-w-0">
          <button onClick={onShowDetail} className="text-maroon font-semibold tracking-tight hover:underline text-left">
            {ex.name}
          </button>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <Badge variant="secondary" className="text-[10px] capitalize">{ex.muscle_group}</Badge>
            <Badge variant="outline" className="text-[10px] capitalize">{ex.equipment}</Badge>
            {ex.superset_group_id && (
              <Badge className="text-[10px] bg-maroon text-white hover:bg-maroon">
                <Link2 className="h-2.5 w-2.5 mr-1" /> Superset
              </Badge>
            )}
          </div>
          {suggestion?.suggested_kg ? (
            <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${suggestion.deload_flag ? "text-orange-400" : "text-muted-foreground"}`}>
              <Sparkles className="h-3 w-3 text-maroon shrink-0" />
              <span>
                {suggestion.deload_flag
                  ? "Deload recommended — RPE has been maxed with no progress"
                  : suggestion.plateau
                    ? "Plateaued — consider a deload or swapping this exercise"
                    : `Suggested: ${suggestion.suggested_kg} kg${suggestion.trend === "increase" ? " (+2.5)" : ""}`}
              </span>
              {!suggestion.deload_flag && !suggestion.plateau && (
                <button
                  onClick={() => ex.sets.forEach((s, i) => {
                    if (s.set_type !== "warmup" && !s.completed) onSetUpdate(i, { kg: suggestion.suggested_kg });
                  })}
                  className="ml-0.5 px-1.5 py-0.5 rounded border border-[hsl(var(--maroon)/0.4)] text-maroon hover:bg-[hsl(var(--maroon)/0.1)] transition"
                >
                  Apply
                </button>
              )}
            </div>
          ) : null}
          {editingNote ? (
            <Textarea
              autoFocus
              rows={2}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => { setEditingNote(false); onSaveExerciseNote(noteDraft.trim()); }}
              placeholder="Form cue for this exercise — shows every session"
              className="mt-1.5 text-xs min-h-0"
            />
          ) : (
            <button
              onClick={() => { setNoteDraft(exerciseNote); setEditingNote(true); }}
              className="flex items-center gap-1.5 mt-1.5 text-xs text-left transition hover:text-foreground"
            >
              <StickyNote className={`h-3 w-3 shrink-0 ${exerciseNote ? "text-amber-400" : "text-muted-foreground"}`} />
              <span className={exerciseNote ? "text-foreground/80" : "text-muted-foreground"}>
                {exerciseNote || "Add note"}
              </span>
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid={SESSION.exerciseMenuButton}
              aria-label="Exercise options"
              className="shrink-0 p-1.5 -mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onMoveUp} disabled={index === 0}>
              <ArrowUp className="h-4 w-4 mr-2" /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMoveDown} disabled={index === total - 1}>
              <ArrowDown className="h-4 w-4 mr-2" /> Move down
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReplace}>
              <Repeat className="h-4 w-4 mr-2" /> Replace exercise
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSwap}>
              <Dumbbell className="h-4 w-4 mr-2" /> Swap similar
            </DropdownMenuItem>
            {!ex.time_based && (
              <DropdownMenuItem onClick={onAddWarmups}>
                <Flame className="h-4 w-4 mr-2" /> Add warm-up sets
              </DropdownMenuItem>
            )}
            {ex.superset_group_id ? (
              <DropdownMenuItem onClick={onRemoveSuperset}>
                <Unlink className="h-4 w-4 mr-2" /> Remove from superset
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onSupersetWithNext} disabled={index === total - 1}>
                <Link2 className="h-4 w-4 mr-2" /> Superset with next
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onRemoveExercise}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Remove exercise
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Textarea
        data-testid={SESSION.notesInput}
        value={ex.notes}
        onChange={(e) => onSetNotes(e.target.value)}
        placeholder="Add notes here…"
        rows={1}
        className="mt-3 resize-none text-sm min-h-[36px]"
      />

      {/* Rest timer row */}
      <RestTimerRow
        seconds={ex.rest_timer_seconds}
        onChange={onSetRest}
        running={restRunning}
        remaining={restRemaining}
        onSkip={onSkipRest}
        onAdjust={onAdjustRest}
      />

      {/* Set table */}
      <div className="mt-4 overflow-x-auto">
        {(() => {
          // Mobile-first column widths — the old fixed widths overflowed a phone,
          // which collapsed "Previous" to nothing and squeezed RPE out.
          const gridCls = ex.time_based
            ? "grid-cols-[26px_minmax(46px,1fr)_1fr_52px_30px_24px] sm:grid-cols-[36px_1fr_1fr_70px_36px_32px]"
            : showRpe
              ? "grid-cols-[24px_minmax(44px,1fr)_48px_44px_38px_30px_24px] sm:grid-cols-[36px_1fr_60px_60px_44px_36px_32px]"
              : "grid-cols-[26px_minmax(54px,1fr)_54px_50px_30px_24px] sm:grid-cols-[36px_1fr_60px_60px_36px_32px]";
          return (
            <>
              <div className={`grid ${gridCls} gap-1 sm:gap-2 text-[10px] uppercase tracking-widest text-muted-foreground pb-2 border-b border-border`}>
                <span>Set</span>
                <span>Previous</span>
                {ex.time_based ? (
                  <>
                    <span className="text-center">Time</span>
                    <span className="text-center">Dist (m)</span>
                  </>
                ) : (
                  <>
                    <span className="text-center">{isBodyweight ? "+Kg" : "Kg"}</span>
                    <span className="text-center">Reps</span>
                    {showRpe && (
                      <button onClick={onRpeInfo} className="text-center flex items-center justify-center gap-0.5 hover:text-foreground">
                        RPE <Info className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </>
                )}
                <Check className="h-3 w-3 mx-auto" />
                <span aria-hidden />
              </div>
              {ex.sets.map((s, i) => {
                const label = s.set_type === "warmup" ? "W"
                  : s.set_type === "dropset" ? "D"
                  : s.set_type === "failure" ? "F"
                  : s.set_type === "amrap" ? "A"
                  : String(++workingIdx);
                return (
                  <SetRow
                    key={i}
                    set={s}
                    index={i}
                    label={label}
                    gridCls={gridCls}
                    showRpe={showRpe}
                    timeBased={ex.time_based}
                    bodyweight={isBodyweight}
                    inlineTimer={ex.time_based && settings?.inline_timer_enabled !== false}
                    onOpenPlateCalc={showPlateCalc ? () => onOpenPlateCalc(s.kg || s.previous?.kg || "") : null}
                    onUpdate={(patch) => onSetUpdate(i, patch)}
                    onRemove={() => onRemoveSet(i)}
                    onToggleComplete={() => onToggleComplete(i)}
                  />
                );
              })}
            </>
          );
        })()}
      </div>

      <Button
        data-testid={SESSION.addSetButton}
        variant="ghost"
        className="w-full mt-2 text-muted-foreground hover:text-foreground"
        onClick={onAddSet}
      >
        <Plus className="h-4 w-4 mr-2" /> Add Set
      </Button>
    </Card>
  );
}
