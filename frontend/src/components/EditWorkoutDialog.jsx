import React, { useEffect, useState } from "react";
import api from "@/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Check } from "lucide-react";
import ExercisePicker from "@/components/ExercisePicker";
import { useToast } from "@/hooks/use-toast";

// Same coercion the live session uses, so an edit never 422s on a stray value.
const numOrNull = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v) => {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
};

const GRID = "grid grid-cols-[1.5rem_1fr_1fr_2rem_1.5rem] gap-2 items-center";

/* Edit a previously-saved workout: fix weights/reps, toggle completed, add or
 * remove sets, add or remove exercises. Saves via PUT /workouts/{id}. */
export default function EditWorkoutDialog({ workout, open, onClose, onSaved }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [exercises, setExercises] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !workout) return;
    setName(workout.name || "Workout");
    setDescription(workout.description || "");
    setExercises((workout.exercises || []).map((ex, i) => ({
      uid: `${ex.exercise_id}-${i}`,
      exercise_id: ex.exercise_id,
      name: ex.name || "Exercise",
      image_url: ex.image_url,
      muscle_group: ex.muscle_group,
      notes: ex.notes || "",
      rest_timer_seconds: ex.rest_timer_seconds ?? 90,
      superset_group_id: ex.superset_group_id || null,
      target_reps: ex.target_reps ?? null,
      sets: (ex.sets || []).map((s) => ({ ...s })),
    })));
  }, [open, workout]);

  const patchSet = (ei, si, patch) =>
    setExercises((arr) => arr.map((e, i) => (i === ei
      ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : e)));
  const addSet = (ei) =>
    setExercises((arr) => arr.map((e, i) => (i === ei
      ? { ...e, sets: [...e.sets, { set_type: "working", kg: null, reps: null, duration_seconds: null, distance_m: null, rpe: null, completed: true }] } : e)));
  const removeSet = (ei, si) =>
    setExercises((arr) => arr.map((e, i) => (i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)));
  const removeExercise = (ei) => setExercises((arr) => arr.filter((_, i) => i !== ei));
  const addExercises = (list) =>
    setExercises((arr) => {
      const have = new Set(arr.map((e) => e.exercise_id));
      const fresh = list.filter((ex) => !have.has(ex.id)).map((ex, k) => ({
        uid: `${ex.id}-new-${Date.now()}-${k}`,
        exercise_id: ex.id, name: ex.name, image_url: ex.image_url, muscle_group: ex.muscle_group,
        notes: "", rest_timer_seconds: 90, superset_group_id: null, target_reps: null,
        sets: [{ set_type: "working", kg: null, reps: null, duration_seconds: null, distance_m: null, rpe: null, completed: true }],
      }));
      return [...arr, ...fresh];
    });

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || "Workout",
        description,
        duration_seconds: workout.duration_seconds || 0,
        exercises: exercises.filter((ex) => ex.exercise_id).map((ex) => ({
          exercise_id: ex.exercise_id,
          notes: ex.notes || "",
          rest_timer_seconds: intOrNull(ex.rest_timer_seconds) ?? 90,
          superset_group_id: ex.superset_group_id || null,
          target_reps: intOrNull(ex.target_reps),
          sets: ex.sets.map((s) => ({
            set_type: s.set_type || "working",
            kg: numOrNull(s.kg),
            reps: intOrNull(s.reps),
            duration_seconds: intOrNull(s.duration_seconds),
            distance_m: numOrNull(s.distance_m),
            rpe: numOrNull(s.rpe),
            completed: !!s.completed,
          })),
        })),
      };
      await api.put(`/workouts/${workout.id}`, payload);
      toast({ title: "Workout updated" });
      onSaved?.();
      onClose();
    } catch (e) {
      const detail = e.response?.data?.detail;
      let msg = String(e.message || e);
      if (Array.isArray(detail) && detail[0]) {
        msg = `${(detail[0].loc || []).slice(-2).join(" ")}: ${detail[0].msg}`;
      } else if (typeof detail === "string") msg = detail;
      toast({ title: "Couldn't save changes", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit workout</DialogTitle>
          <DialogDescription>Fix weights and reps, or add sets and exercises you missed.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Title</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {exercises.map((ex, ei) => (
            <div key={ex.uid} className="rounded-xl border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2 mb-2.5">
                {ex.image_url
                  ? <img src={ex.image_url} alt="" className="h-8 w-8 rounded object-cover bg-muted" />
                  : <div className="h-8 w-8 rounded bg-muted" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{ex.name}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{ex.muscle_group}</div>
                </div>
                <button onClick={() => removeExercise(ei)} className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove exercise">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className={`${GRID} text-[10px] uppercase tracking-wider text-muted-foreground mb-1 px-0.5`}>
                <span>Set</span><span className="text-center">Kg</span><span className="text-center">Reps</span><span className="text-center">Done</span><span />
              </div>
              {ex.sets.map((s, si) => (
                <div key={si} className={`${GRID} mb-1.5`}>
                  <span className="text-xs text-muted-foreground text-center">{si + 1}</span>
                  <Input
                    type="number" inputMode="decimal" value={s.kg ?? ""}
                    onChange={(e) => patchSet(ei, si, { kg: e.target.value })}
                    onBlur={(e) => patchSet(ei, si, { kg: e.target.value })}
                    placeholder="0" className="h-8 text-center"
                  />
                  <Input
                    type="number" inputMode="numeric" value={s.reps ?? ""}
                    onChange={(e) => patchSet(ei, si, { reps: e.target.value })}
                    onBlur={(e) => patchSet(ei, si, { reps: e.target.value })}
                    placeholder="0" className="h-8 text-center"
                  />
                  <button
                    onClick={() => patchSet(ei, si, { completed: !s.completed })}
                    aria-label="Toggle completed"
                    className={`h-7 w-7 rounded-md flex items-center justify-center border mx-auto transition ${
                      s.completed ? "bg-green-600 border-green-600 text-white" : "bg-muted border-border text-muted-foreground"
                    }`}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => removeSet(ei, si)} className="text-muted-foreground hover:text-destructive mx-auto" aria-label="Remove set">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full h-8 mt-1" onClick={() => addSet(ei)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add set
              </Button>
            </div>
          ))}

          <Button variant="outline" className="w-full border-dashed" onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add exercise
          </Button>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Description</div>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="How did it go?" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>

        <ExercisePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onAdd={addExercises}
          existingIds={exercises.map((e) => e.exercise_id)}
        />
      </DialogContent>
    </Dialog>
  );
}
