import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PRESETS = [
  { label: "Tabata", work: 20, rest: 10, rounds: 8 },
  { label: "EMOM 10", work: 60, rest: 0, rounds: 10 },
  { label: "HIIT 40/20", work: 40, rest: 20, rounds: 10 },
];

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/* Interval / EMOM / HIIT round timer — separate from the per-set rest timer. */
export default function IntervalTimer({ open, onClose, onAlert }) {
  const [work, setWork] = useState(40);
  const [rest, setRest] = useState(20);
  const [rounds, setRounds] = useState(8);
  const [state, setState] = useState({ phase: "idle", round: 1, remaining: 0, running: false });
  const tickRef = useRef();

  // 1s tick — advance phase / round when the current window hits zero
  useEffect(() => {
    if (!state.running) return undefined;
    tickRef.current = setInterval(() => {
      setState((s) => {
        if (s.remaining > 1) return { ...s, remaining: s.remaining - 1 };
        onAlert?.(); // beep + vibrate on every transition
        if (s.phase === "work" && rest > 0) return { ...s, phase: "rest", remaining: rest };
        if (s.round < rounds) return { phase: "work", round: s.round + 1, remaining: work, running: true };
        return { phase: "done", round: s.round, remaining: 0, running: false };
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [state.running, work, rest, rounds, onAlert]);

  const start = () => setState({ phase: "work", round: 1, remaining: work, running: true });
  const reset = () => setState({ phase: "idle", round: 1, remaining: 0, running: false });
  const idle = state.phase === "idle" || state.phase === "done";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Interval Timer</DialogTitle>
          <DialogDescription>Rounds of work / rest for conditioning — Tabata, EMOM, HIIT.</DialogDescription>
        </DialogHeader>

        {idle ? (
          <div className="space-y-3">
            <div className="flex gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setWork(p.work); setRest(p.rest); setRounds(p.rounds); }}
                  className="px-2.5 py-1 rounded-full border border-border text-xs hover:border-[hsl(var(--maroon))] hover:text-maroon transition"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[["Work (s)", work, setWork, 5], ["Rest (s)", rest, setRest, 0], ["Rounds", rounds, setRounds, 1]].map(([label, val, set, min]) => (
                <div key={label}>
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={min}
                    value={val}
                    onChange={(e) => set(Math.max(min, Number(e.target.value) || 0))}
                  />
                </div>
              ))}
            </div>
            {state.phase === "done" && (
              <div className="text-center text-sm text-maroon font-semibold">Done — {rounds} rounds complete 🔥</div>
            )}
            <Button onClick={start} className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
              Start
            </Button>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <div className={`inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-widest ${state.phase === "work" ? "bg-maroon text-white" : "bg-blue-500/15 text-blue-400"}`}>
              {state.phase}
            </div>
            <div className="text-6xl font-bold tabular-nums tracking-tight">{fmt(state.remaining)}</div>
            <div className="text-sm text-muted-foreground">Round {state.round} / {rounds}</div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setState((s) => ({ ...s, running: !s.running }))}
                className="flex-1"
              >
                {state.running ? "Pause" : "Resume"}
              </Button>
              <Button variant="ghost" onClick={reset} className="flex-1">Reset</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
