import React, { useState } from "react";
import api from "@/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Dumbbell, Target, Save, Sparkles, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Hevy-style program detail.
 * Shows the full program info, all routines, each routine's exercises with images + sets×reps.
 * "Save Program" imports it as ONE multi-day plan (each program routine becomes a day)
 * into the user's My Plans, where days can be trained in any order.
 */
export default function ProgramDetailDialog({ program, open, onClose, onSelectExercise, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();

  if (!program) return null;

  const savePlan = async () => {
    setSaving(true);
    try {
      const days = (program.routines || []).map((r) => ({
        name: r.name,
        exercises: (r.exercises || []).map((ex) => ({
          exercise_id: ex.exercise_id,
          sets: ex.sets ?? 3,
          reps: ex.reps ?? 10,
          notes: "",
        })),
      }));
      const { data: plan } = await api.post("/plans", {
        name: program.name,
        source_program_id: program.id,
        days,
      });
      // Also copy the days into real routines so they're editable on their own
      // (foldered under the program name). Best-effort — the plan works regardless.
      let asRoutines = false;
      try {
        if (plan?.id) {
          await api.post(`/plans/${plan.id}/import-days`);
          asRoutines = true;
        }
      } catch { /* plan alone is still usable */ }
      setSaved(true);
      toast({
        title: "Plan saved",
        description: asRoutines
          ? `${days.length} days added — also saved as editable routines in a "${program.name}" folder.`
          : `${days.length} days added to My Plans — train them in any order.`,
      });
      onSaved?.();
    } catch (e) {
      toast({ title: "Failed to save", description: String(e.message || e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden p-0 gap-0">
        {/* Header */}
        <div className="bg-maroon text-white p-6 relative overflow-hidden">
          <div className="absolute inset-0 grain opacity-30 pointer-events-none" />
          <DialogHeader className="text-left space-y-2 relative">
            <div className="flex items-center gap-2">
              <Badge className="bg-white/15 text-white border border-white/20 capitalize hover:bg-white/15">
                {program.level}
              </Badge>
              <Badge className="bg-white/15 text-white border border-white/20 capitalize hover:bg-white/15">
                {program.duration_weeks} weeks
              </Badge>
            </div>
            <DialogTitle className="text-3xl font-semibold text-white tracking-tight">
              {program.name}
            </DialogTitle>
            <DialogDescription className="text-white/85 max-w-xl leading-relaxed">
              {program.description}
            </DialogDescription>
            <div className="flex items-center gap-5 pt-2 text-sm">
              <span className="flex items-center gap-1.5"><BarChart3 className="h-4 w-4" /> <span className="capitalize">{program.level}</span></span>
              <span className="flex items-center gap-1.5"><Dumbbell className="h-4 w-4" /> <span className="capitalize">{program.equipment}</span></span>
              <span className="flex items-center gap-1.5"><Target className="h-4 w-4" /> <span className="capitalize">{program.goal}</span></span>
              <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> {program.routines?.length || 0} Routines</span>
            </div>
          </DialogHeader>

          <Button
            data-testid="program-save-button"
            disabled={saving || saved}
            onClick={savePlan}
            className="mt-5 w-full bg-white text-maroon hover:bg-white/90 font-semibold"
          >
            {saved ? (
              <><CheckCircle2 className="h-4 w-4 mr-2" /> Saved to My Plans</>
            ) : saving ? "Saving…" : (
              <><Save className="h-4 w-4 mr-2" /> Save Program as Plan</>
            )}
          </Button>
        </div>

        {/* Routines list */}
        <div className="overflow-y-auto flex-1 p-6 space-y-7" style={{ maxHeight: "calc(85vh - 280px)" }}>
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Routines</div>
          {(program.routines || []).map((routine, ri) => (
            <RoutineSection
              key={ri}
              routine={routine}
              onSelectExercise={onSelectExercise}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoutineSection({ routine, onSelectExercise }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold tracking-tight">{routine.name}</h3>
        <Badge variant="outline" className="text-[10px]">
          {routine.exercises?.length || 0} exercises
        </Badge>
      </div>
      <div className="space-y-2">
        {(routine.exercises || []).map((ex, i) => (
          <button
            key={i}
            data-testid="program-exercise-item"
            onClick={() => onSelectExercise?.(ex.exercise_id)}
            className="w-full flex items-center gap-3 rounded-xl border border-border bg-card hover:border-maroon/40 hover:bg-muted/40 px-3 py-2.5 text-left transition group"
          >
            <img
              src={ex.image_url || `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Plank/0.jpg`}
              alt=""
              className="h-14 w-14 rounded-full object-cover bg-white border border-border"
              onError={(e) => { e.currentTarget.style.opacity = 0.3; }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-maroon group-hover:underline truncate">
                {ex.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {ex.sets} sets · {ex.reps} reps
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
