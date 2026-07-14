import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ScalePicker from "@/components/ScalePicker";
import { Dumbbell, Zap, Flame, HeartPulse, ArrowLeft, Check } from "lucide-react";

const GOALS = [
  { key: "muscle", label: "Build muscle", icon: Dumbbell },
  { key: "strength", label: "Get stronger", icon: Zap },
  { key: "cut", label: "Lose fat", icon: Flame },
  { key: "fit", label: "Stay fit", icon: HeartPulse },
];

const STEPS = ["name", "age", "height", "weight", "sex", "goal"];

/* Full-screen, one-question-per-screen first-run onboarding.
   Everything is optional — Skip finishes early, saving whatever's been set.
   Collected profile is persisted by the caller (Dashboard) via onComplete. */
export default function Onboarding({ open, onComplete, defaultName = "" }) {
  const [i, setI] = useState(0);
  const [name, setName] = useState(defaultName);
  const [age, setAge] = useState(null);
  const [height, setHeight] = useState(null);
  const [weight, setWeight] = useState(null);
  const [sex, setSex] = useState(null);
  const [goal, setGoal] = useState(null);

  useEffect(() => { if (open) setName((n) => n || defaultName); }, [open, defaultName]);

  if (!open) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const finish = () => onComplete({
    name: name.trim() || undefined,
    age: age ?? undefined,
    height_cm: height ?? undefined,
    weight_kg: weight ?? undefined,
    sex: sex || undefined,
    goal,
  });

  const next = () => (last ? finish() : setI(i + 1));
  const back = () => setI(Math.max(0, i - 1));

  const OptionRow = ({ active, onClick, icon, children }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition ${
        active ? "border-maroon bg-[hsl(var(--maroon)/0.06)]" : "border-border hover:border-[hsl(var(--maroon)/0.5)]"
      }`}
    >
      <span className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center shrink-0 text-foreground">{icon}</span>
      <span className="flex-1 font-medium">{children}</span>
      <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? "border-maroon bg-maroon" : "border-muted-foreground/40"}`}>
        {active && <Check className="h-3 w-3 text-white" />}
      </span>
    </button>
  );

  const TITLES = {
    name: ["What should we call you?", "This is how you'll be greeted."],
    age: ["How old are you?", "Used to personalise your metrics."],
    height: ["What's your height?", "Feeds your BMI and body estimates."],
    weight: ["What's your weight?", "Drag the scale — you can update it anytime."],
    sex: ["Which best describes you?", "Helps calculate body composition."],
    goal: ["What's your main goal?", "We'll suggest a plan to match."],
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      {/* Top bar: back · progress · skip */}
      <div className="flex items-center gap-3 px-5 pt-5">
        {i > 0 ? (
          <button onClick={back} aria-label="Back" className="h-8 w-8 -ml-1 rounded-lg flex items-center justify-center hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : <div className="h-8 w-8 -ml-1" />}
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-maroon transition-all duration-300" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
        </div>
        <button onClick={finish} className="text-sm text-muted-foreground hover:text-foreground">Skip</button>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col justify-center px-6 max-w-md w-full mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight">{TITLES[step][0]}</h1>
        <p className="text-muted-foreground mt-2 mb-8">{TITLES[step][1]}</p>

        {step === "name" && (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="h-14 text-lg"
          />
        )}
        {step === "age" && (
          <ScalePicker min={13} max={90} value={age} onChange={setAge} unit="yrs" fallback={25} majorEvery={5} />
        )}
        {step === "height" && (
          <ScalePicker min={120} max={220} value={height} onChange={setHeight} unit="cm" fallback={170} majorEvery={10} />
        )}
        {step === "weight" && (
          <ScalePicker min={30} max={200} value={weight} onChange={setWeight} unit="kg" fallback={70} majorEvery={10} />
        )}
        {step === "sex" && (
          <div className="space-y-3">
            <OptionRow active={sex === "male"} onClick={() => setSex("male")} icon={<span className="text-lg">♂</span>}>Male</OptionRow>
            <OptionRow active={sex === "female"} onClick={() => setSex("female")} icon={<span className="text-lg">♀</span>}>Female</OptionRow>
          </div>
        )}
        {step === "goal" && (
          <div className="space-y-3">
            {GOALS.map((g) => (
              <OptionRow key={g.key} active={goal === g.key} onClick={() => setGoal(g.key)} icon={<g.icon className="h-4 w-4" />}>
                {g.label}
              </OptionRow>
            ))}
          </div>
        )}
      </div>

      {/* Continue */}
      <div className="px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 max-w-md w-full mx-auto">
        <Button onClick={next} className="w-full h-14 text-base rounded-2xl bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
          {last ? "Finish" : "Continue"}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
