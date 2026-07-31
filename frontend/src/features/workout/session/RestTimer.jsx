import React from "react";
import { Timer } from "lucide-react";
import { SESSION } from "@/constants/testIds";
import { fmtClock } from "@/features/workout/lib/format";

/* Rest-timer row under each exercise: preset picker + running countdown. */
export default function RestTimerRow({ seconds, onChange, running, remaining, onSkip, onAdjust }) {
  const presets = [0, 30, 60, 90, 120, 180, 240, 300];
  const label = seconds === 0 ? "OFF" : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  // Wraps rather than overflows: label + select + the running controls total
  // ~376px, which is 12px past the right edge on a 375px phone.
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <div className="flex items-center gap-1.5 text-maroon font-medium">
        <Timer className="h-4 w-4" />
        Rest Timer: <span data-testid={SESSION.restTimerToggle}>{label}</span>
      </div>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        value={seconds}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {presets.map((p) => (
          <option key={p} value={p}>{p === 0 ? "Off" : `${p}s`}</option>
        ))}
      </select>
      {running && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs">
          <button onClick={() => onAdjust?.(-15)} className="h-6 px-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-[hsl(var(--maroon)/0.4)]">−15</button>
          <span className="font-mono text-maroon font-semibold w-12 text-center">{fmtClock(remaining)}</span>
          <button onClick={() => onAdjust?.(15)} className="h-6 px-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-[hsl(var(--maroon)/0.4)]">+15</button>
          <button onClick={onSkip} className="ml-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
            skip
          </button>
        </div>
      )}
    </div>
  );
}
