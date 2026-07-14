import React, { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dumbbell, Zap, Flame, HeartPulse, Sparkles, User } from "lucide-react";

const GOALS = [
  { key: "muscle", label: "Build muscle", icon: Dumbbell },
  { key: "strength", label: "Get stronger", icon: Zap },
  { key: "cut", label: "Lose fat", icon: Flame },
  { key: "fit", label: "Stay fit", icon: HeartPulse },
];
const LEVELS = [["beginner", "New to it"], ["intermediate", "Some experience"], ["advanced", "Advanced"]];
const DAYS = [2, 3, 4, 5, 6];

/* First-run onboarding — two quick, skippable steps:
   1) About you (name/age/height/weight/sex) → saved to profile, powers Body Metrics.
   2) Training (goal/level/days) → pre-selects the workout recommendation.
   The caller (Dashboard) persists everything via onComplete. */
export default function Onboarding({ open, onComplete, defaultName = "" }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(defaultName);
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [sex, setSex] = useState(null);
  const [goal, setGoal] = useState(null);
  const [level, setLevel] = useState(null);
  const [days, setDays] = useState(null);

  // Prefill name from the registration name once the dialog opens.
  useEffect(() => { if (open) setName((n) => n || defaultName); }, [open, defaultName]);

  const finish = () => onComplete({
    name: name.trim() || undefined,
    age: age ? Number(age) : undefined,
    height_cm: height ? Number(height) : undefined,
    weight_kg: weight ? Number(weight) : undefined,
    sex: sex || undefined,
    goal, level, days,
  });

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
        {step === 1 ? (
          <>
            <div className="text-center mb-1">
              <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-maroon font-semibold">
                <User className="h-3.5 w-3.5" /> Welcome to LifeOS
              </div>
              <h2 className="text-2xl font-semibold tracking-tight mt-1">A bit about you</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Powers your Body Metrics (BMI, BMR &amp; more). You can skip and add these later.
              </p>
            </div>

            <div className="space-y-3 mt-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Name</p>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Age</p>
                  <Input type="number" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} placeholder="28" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Height</p>
                  <Input type="number" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="cm" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Weight</p>
                  <Input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="kg" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Sex</p>
                <div className="flex gap-2">
                  <Chip active={sex === "male"} onClick={() => setSex("male")}>Male</Chip>
                  <Chip active={sex === "female"} onClick={() => setSex("female")}>Female</Chip>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <Button variant="ghost" onClick={() => onComplete({})} className="flex-1">Skip</Button>
              <Button onClick={() => setStep(2)} className="flex-1 bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
                Next
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="text-center mb-1">
              <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-maroon font-semibold">
                <Sparkles className="h-3.5 w-3.5" /> Almost there
              </div>
              <h2 className="text-2xl font-semibold tracking-tight mt-1">Your training</h2>
              <p className="text-sm text-muted-foreground mt-1">Helps pick your starting plan. Optional.</p>
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
              <Button variant="ghost" onClick={() => setStep(1)} className="flex-1">Back</Button>
              <Button onClick={finish} className="flex-1 bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
                {goal ? "Show my plan" : "Finish"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
