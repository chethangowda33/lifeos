import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dumbbell, MoreVertical, Plus, Trash2, ArrowUp, ArrowDown, Repeat, Link2, Unlink,
  Flame, Info, Check, Replace, StickyNote, Sparkles,
} from "lucide-react";
import { SESSION } from "@/constants/testIds";
import SetRow from "@/features/workout/session/SetRow";
import RestTimerRow from "@/features/workout/session/RestTimer";

/* One exercise inside a live session: header/menu, notes, rest timer, set table. */
export default function ExerciseSessionCard({
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
