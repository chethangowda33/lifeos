import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import usePushSubscription from "@/hooks/usePushSubscription";
import { ArrowLeft, Settings2 } from "lucide-react";

const REST_PRESETS = [0, 30, 60, 90, 120, 150, 180, 240, 300];

const TOGGLES = [
  ["keep_screen_awake_during_workout", "Keep screen awake during workout", "Uses the Screen Wake Lock API while a session is running."],
  ["plate_calculator_enabled", "Plate calculator", "Show the plate calculator button next to KG inputs on barbell exercises."],
  ["rpe_tracking_enabled", "RPE tracking", "Show the RPE column when logging sets."],
  ["smart_superset_scrolling", "Smart superset scrolling", "Auto-scroll to the next exercise in a superset when a set is completed."],
  ["inline_timer_enabled", "Inline timer", "Built-in stopwatch for duration-based exercises."],
  ["live_pr_notification_enabled", "Live PR notifications", "Get a toast the moment a set beats a stored personal record."],
];

export default function WorkoutSettings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [s, setS] = useState(null);
  const [platesText, setPlatesText] = useState("");
  const push = usePushSubscription();

  useEffect(() => {
    api.get("/workout-settings").then((r) => {
      setS(r.data);
      setPlatesText((r.data.plate_inventory || []).join(", "));
    });
  }, []);

  const save = async (patch) => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      await api.put("/workout-settings", patch);
    } catch (e) {
      toast({ title: "Could not save setting", description: String(e.message || e), variant: "destructive" });
    }
  };

  const savePlates = () => {
    const inv = platesText
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!inv.length) {
      toast({ title: "Invalid plate list", variant: "destructive" });
      return;
    }
    save({ plate_inventory: inv.sort((a, b) => b - a) });
    toast({ title: "Plate inventory saved" });
  };

  if (!s) return <div className="text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/workout")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-maroon" /> Workout Settings
          </h1>
          <p className="text-sm text-muted-foreground">Preferences for logging and live sessions.</p>
        </div>
      </div>

      <Card className="p-5 space-y-1">
        <div className="font-semibold">Weekly training goal</div>
        <div className="text-xs text-muted-foreground mb-2">
          Sessions per week. Drives the dashboard ring and the Fitness part of your Life Score.
        </div>
        <div className="flex flex-wrap gap-2">
          {[2, 3, 4, 5, 6, 7].map((n) => (
            <button
              key={n}
              onClick={() => save({ weekly_workout_target: n })}
              className={`px-3 py-1.5 rounded-md text-sm border transition ${
                (s.weekly_workout_target ?? 4) === n
                  ? "bg-maroon text-white border-transparent"
                  : "bg-muted border-border hover:border-[hsl(var(--maroon)/0.4)]"
              }`}
            >
              {n}×
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5 space-y-1">
        <div className="font-semibold mb-2">Default rest timer</div>
        <div className="flex flex-wrap gap-2">
          {REST_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => save({ default_rest_timer_seconds: p })}
              className={`px-3 py-1.5 rounded-md text-sm border transition ${
                s.default_rest_timer_seconds === p
                  ? "bg-maroon text-white border-transparent"
                  : "bg-muted border-border hover:border-[hsl(var(--maroon)/0.4)]"
              }`}
            >
              {p === 0 ? "Off" : `${p}s`}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5 space-y-1">
        <div className="font-semibold mb-2">Previous workout values</div>
        <p className="text-xs text-muted-foreground mb-3">What the &quot;Previous&quot; column shows for each set.</p>
        <div className="flex gap-2">
          {[
            ["default", "Set by set"],
            ["last_set", "Last set"],
            ["best_set", "Best set"],
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() => save({ previous_workout_values_mode: val })}
              className={`px-3 py-1.5 rounded-md text-sm border transition ${
                s.previous_workout_values_mode === val
                  ? "bg-maroon text-white border-transparent"
                  : "bg-muted border-border hover:border-[hsl(var(--maroon)/0.4)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5 divide-y divide-border">
        {TOGGLES.map(([key, label, desc]) => (
          <div key={key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0 gap-4">
            <div>
              <div className="font-medium text-sm">{label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
            </div>
            <Switch checked={!!s[key]} onCheckedChange={(v) => save({ [key]: v })} />
          </div>
        ))}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold">Train reminder</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Notification at your usual training time, naming the next day in your rotation. Fires while the app is open.
            </div>
          </div>
          <Switch
            checked={!!s.train_reminder_enabled}
            onCheckedChange={(v) => {
              if (v && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
              save({ train_reminder_enabled: v });
            }}
          />
        </div>
        {s.train_reminder_enabled && (
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Remind me at</div>
            <Input
              type="time"
              value={s.train_reminder_time || "18:00"}
              onChange={(e) => save({ train_reminder_time: e.target.value })}
              className="w-36"
            />
          </div>
        )}
        {s.train_reminder_enabled && push.supported && push.configured && (
          <div className="flex items-center justify-between gap-4 pt-3 border-t border-border">
            <div className="min-w-0">
              <div className="text-sm font-medium">Also remind me when the app is closed</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Sends a push notification even when LifeOS isn&apos;t open. On iPhone, add
                LifeOS to your Home Screen first — iOS only delivers push to installed apps.
              </div>
            </div>
            <Switch
              checked={push.subscribed}
              disabled={push.busy}
              onCheckedChange={(v) => (v ? push.subscribe() : push.unsubscribe())}
            />
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="font-semibold">Plate calculator setup</div>
        <div className="grid grid-cols-[110px_1fr] gap-3 items-end">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Bar weight (kg)</div>
            <Input
              type="number"
              value={s.bar_weight_kg}
              onChange={(e) => setS({ ...s, bar_weight_kg: e.target.value })}
              onBlur={() => save({ bar_weight_kg: Number(s.bar_weight_kg) || 20 })}
            />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Available plates (kg, per side)</div>
            <div className="flex gap-2">
              <Input value={platesText} onChange={(e) => setPlatesText(e.target.value)} placeholder="25, 20, 15, 10, 5, 2.5, 1.25" />
              <Button variant="outline" onClick={savePlates}>Save</Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
