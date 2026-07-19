import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ArrowUp, Calculator, Check, Pause, Play, Trash2 } from "lucide-react";
import { SESSION } from "@/constants/testIds";
import { fmtClock } from "@/features/workout/lib/format";

/* One logged set: type, previous, kg/reps (or time/distance), RPE, complete. */
export default function SetRow({
  set, index, label, gridCls, showRpe, timeBased, bodyweight, inlineTimer,
  onOpenPlateCalc, onUpdate, onRemove, onToggleComplete,
}) {
  const prevTxt = set.previous
    ? (timeBased
        ? `${fmtClock(set.previous.duration_seconds || 0)}${set.previous.distance_m ? ` · ${set.previous.distance_m}m` : ""}`
        // Compact ("60×10") so it stays readable in the narrow phone column —
        // "60 kg × 10" used to overflow and truncate to a meaningless "0".
        : `${set.previous.kg ?? "-"}×${set.previous.reps ?? "-"}`)
    : "—";
  const completed = set.completed;
  // Beat last time? (higher volume, or longer for time-based)
  const beatPrev = completed && set.previous && (
    timeBased
      ? (Number(set.duration_seconds) || 0) > (set.previous.duration_seconds || 0)
      : (Number(set.kg) || 0) * (Number(set.reps) || 0) > (set.previous.kg || 0) * (set.previous.reps || 0)
  );

  // Inline stopwatch for duration-based exercises
  const [timing, setTiming] = useState(false);
  useEffect(() => {
    if (!timing) return undefined;
    const id = setInterval(() => onUpdate({ duration_seconds: (Number(set.duration_seconds) || 0) + 1 }), 1000);
    return () => clearInterval(id);
  }, [timing, set.duration_seconds]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      data-testid={SESSION.setRow}
      className={`grid ${gridCls} gap-1 sm:gap-2 items-center py-1.5 transition-colors ${completed ? "bg-green-500/10" : ""}`}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            title="Set type"
            className={`text-sm font-semibold rounded hover:bg-muted ${
              set.set_type === "warmup" ? "text-orange-400"
                : set.set_type === "dropset" ? "text-purple-400"
                : set.set_type === "failure" ? "text-red-500"
                : set.set_type === "amrap" ? "text-blue-400"
                : "text-muted-foreground"
            }`}
          >
            {label ?? index + 1}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36">
          {[
            ["working", "Working set", "text-foreground"],
            ["warmup", "W — Warm-up", "text-orange-400"],
            ["dropset", "D — Drop set", "text-purple-400"],
            ["failure", "F — Failure", "text-red-500"],
            ["amrap", "A — AMRAP", "text-blue-400"],
          ].map(([val, lbl, cls]) => (
            <DropdownMenuItem
              key={val}
              onClick={() => onUpdate({ set_type: val })}
              className={`${cls} ${set.set_type === val ? "bg-muted" : ""}`}
            >
              {lbl}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className={`text-xs truncate flex items-center gap-0.5 ${beatPrev ? "text-green-500 font-medium" : "text-muted-foreground"}`}>
        {beatPrev && <ArrowUp className="h-3 w-3 shrink-0" />}{prevTxt}
      </div>
      {timeBased ? (
        <>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              data-testid={SESSION.timeInput}
              value={set.duration_seconds ?? ""}
              onChange={(e) => onUpdate({ duration_seconds: e.target.value })}
              placeholder="sec"
              className="h-8 text-center px-1"
            />
            {inlineTimer && (
              <button
                onClick={() => setTiming((t) => !t)}
                title={timing ? "Stop timer" : "Start timer"}
                className={`h-8 w-8 shrink-0 rounded-md flex items-center justify-center border transition ${
                  timing ? "bg-maroon text-white border-transparent" : "bg-muted border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {timing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          <Input
            type="number"
            value={set.distance_m ?? ""}
            onChange={(e) => onUpdate({ distance_m: e.target.value })}
            placeholder="—"
            className="h-8 text-center text-xs px-1"
          />
        </>
      ) : (
        <>
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              data-testid={SESSION.kgInput}
              value={set.kg ?? ""}
              onChange={(e) => onUpdate({ kg: e.target.value })}
              onBlur={(e) => onUpdate({ kg: e.target.value })}
              placeholder={bodyweight ? "BW" : "0"}
              title={bodyweight ? "Added weight on top of bodyweight (leave blank for bodyweight only)" : undefined}
              className="h-8 text-center px-1"
            />
            {onOpenPlateCalc && (
              <button
                onClick={onOpenPlateCalc}
                title="Plate calculator"
                className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-maroon text-white flex items-center justify-center"
              >
                <Calculator className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
          <Input
            type="number"
            inputMode="numeric"
            data-testid={SESSION.repsInput}
            value={set.reps ?? ""}
            onChange={(e) => onUpdate({ reps: e.target.value })}
            onBlur={(e) => onUpdate({ reps: e.target.value })}
            placeholder="0"
            className="h-8 text-center px-1"
          />
          {showRpe && (
            <Input
              type="number"
              data-testid={SESSION.rpeInput}
              value={set.rpe ?? ""}
              onChange={(e) => onUpdate({ rpe: e.target.value })}
              placeholder="—"
              min={6}
              max={10}
              step={0.5}
              className="h-8 text-center text-xs px-1"
            />
          )}
        </>
      )}
      <button
        data-testid={SESSION.completeSetButton}
        onClick={onToggleComplete}
        className={`h-7 w-7 mx-auto rounded-md flex items-center justify-center transition-all duration-150 active:scale-90 border ${
          completed
            ? "bg-green-600 text-white border-green-600 shadow-[0_0_12px_-2px_rgba(22,163,74,0.7)]"
            : "bg-muted border-border hover:border-[hsl(var(--maroon)/0.5)] hover:text-maroon"
        }`}
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        data-testid={SESSION.deleteSetButton}
        onClick={onRemove}
        aria-label={`Delete set ${index + 1}`}
        className="h-7 w-7 mx-auto rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
