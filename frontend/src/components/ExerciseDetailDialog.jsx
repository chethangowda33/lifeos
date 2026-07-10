import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import ExerciseDetailContent from "@/components/ExerciseDetailContent";

/**
 * Exercise detail dialog — full Hevy-style detail everywhere an exercise is
 * clicked: Summary (animation, muscles, trend, PRs), History, and How-to.
 */
export default function ExerciseDetailDialog({ exerciseId, exercise: initialExercise, open, onClose }) {
  const [name, setName] = useState("");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight">
            {name || initialExercise?.name || "Exercise"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Animated demonstration, progress, records, and how-to.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ExerciseDetailContent
            exerciseId={exerciseId || initialExercise?.id}
            exercise={initialExercise}
            onLoaded={(ex) => setName(ex?.name || "")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
