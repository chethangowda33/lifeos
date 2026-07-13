import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Dumbbell, Zap, Flame, HeartPulse, Sparkles } from "lucide-react";

const GOALS = [
  { key: "muscle", label: "Build muscle", icon: Dumbbell },
  { key: "strength", label: "Get stronger", icon: Zap },
  { key: "cut", label: "Lose fat", icon: Flame },
  { key: "fit", label: "Stay fit", icon: HeartPulse },
];
const LEVELS = [["beginner", "New to it"], ["intermediate", "Some experience"], ["advanced", "Advanced"]];
const DAYS = [2, 3, 4, 5, 6];

/* First-run onboarding — 3 quick questions, then steer to a recommended plan.
   Answers are saved by the caller; goal pre-selects the workout recommendation. */
export default function Onboarding({ open, onComplete }) {
  const [goal, setGoal] = useState(null);
  const [level, setLevel] = useState(null);
  const [days, setDays] = useState(null);
  const ready = goal && level && days;

  const Chip = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-sm transition ${
        active ? "bg-maroon text-white border-transparent" : "border-border text-muted-foreground hover:border-[hsl(var(--maroon)/0.5)]"
      }`}
    >
      {children}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onComplete({}); }}>
      <DialogContent className="max-w-md">
        <div className="text-center mb-1">
          <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-maroon font-semibold">
            <Sparkles className="h-3.5 w-3.5" /> Welcome to LifeOS
          </div>
          <h2 className="text-2xl font-semibold tracking-tight mt-1">Let&apos;s set you up</h2>
          <p className="text-sm text-muted-foreground mt-1">Three quick questions to pick your starting plan.</p>
        </div>

        <div className="space-y-4 mt-2">
          <div>
            <p className="text-xs text-muted-foreground mb-2">What&apos;s your main goal?</p>
            <div className="grid grid-cols-2 gap-2">
              {GOALS.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setGoal(g.key)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                    goal === g.key ? "bg-maroon text-white border-transparent" : "border-border text-muted-foreground hover:border-[hsl(var(--maroon)/0.5)]"
                  }`}
                >
                  <g.icon className="h-4 w-4 shrink-0" /> {g.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">Your experience</p>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map(([k, label]) => (
                <Chip key={k} active={level === k} onClick={() => setLevel(k)}>{label}</Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">Days per week</p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <Chip key={d} active={days === d} onClick={() => setDays(d)}>{d}</Chip>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <Button variant="ghost" onClick={() => onComplete({})} className="flex-1">Skip</Button>
          <Button
            disabled={!ready}
            onClick={() => onComplete({ goal, level, days })}
            className="flex-1 bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            Show my plan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
