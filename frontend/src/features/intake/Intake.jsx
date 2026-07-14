import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import {
  Camera, Plus, Pencil, Trash2, Target, ChevronLeft, ChevronRight, Utensils, Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AnalyzeDialog from "./components/AnalyzeDialog";
import EntryDialog from "./components/EntryDialog";
import TargetsDialog from "./components/TargetsDialog";
import SuggestDialog from "./components/SuggestDialog";
import PlanCard from "./components/PlanCard";
import { getDay, getHistory, getMeta, getStatus, getPlan, deleteEntry } from "./api";
import { HEADLINE, MEAL_LABELS, fmt, prettyDate, shiftDate, todayISO } from "./lib";

/* A target the user should stay UNDER (sodium, sugar) turns red past 100%;
   one they should HIT (protein) turns green. */
function NutrientBar({ nutrient, value, target }) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  const over = target > 0 && value > target;
  const color = nutrient.limit
    ? over ? "bg-destructive" : "bg-maroon"
    : over ? "bg-[hsl(var(--success,142_71%_45%))]" : "bg-maroon";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] text-muted-foreground">{nutrient.label}</span>
        <span className="text-[11px] tabular-nums">
          <span className="text-foreground font-semibold">{fmt(value, nutrient.unit)}</span>
          <span className="text-muted-foreground/70"> / {fmt(target, nutrient.unit)}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Intake() {
  const { toast } = useToast();

  const [meta, setMeta] = useState(null);
  const [aiStatus, setAiStatus] = useState({ configured: false });
  const [date, setDate] = useState(todayISO());
  const [day, setDay] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);

  const [plan, setPlan] = useState(null);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  // Meta and AI status are static for the session; the day reloads as you navigate.
  useEffect(() => {
    Promise.all([getMeta(), getStatus()])
      .then(([m, s]) => { setMeta(m); setAiStatus(s); })
      .catch(() => setMeta({ nutrients: [], meals: [] }));
  }, []);

  const loadDay = useCallback(async () => {
    setLoading(true);
    try {
      setDay(await getDay(date));
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadPlan = useCallback(() => {
    getPlan().then((d) => setPlan(d.plan)).catch(() => setPlan(null));
  }, []);

  useEffect(() => { loadDay(); }, [loadDay]);
  useEffect(() => { loadPlan(); }, [loadPlan]);
  useEffect(() => { getHistory(14).then(setHistory).catch(() => {}); }, [day]);

  const nutrientBy = useMemo(
    () => Object.fromEntries((meta?.nutrients || []).map((n) => [n.key, n])),
    [meta],
  );

  const remove = async (entry) => {
    if (!window.confirm(`Remove ${entry.name} from ${prettyDate(date)}?`)) return;
    await deleteEntry(entry.id);
    toast({ title: "Removed", description: `${entry.name} is no longer counted.` });
    loadDay();
  };

  const afterSave = (count) => {
    setAnalyzeOpen(false);
    setEntryOpen(false);
    setEditing(null);
    if (count) {
      toast({
        title: count === 1 ? "Added to your tracker" : `${count} items added`,
        description: `Counted towards ${prettyDate(date).toLowerCase()}.`,
      });
    }
    loadDay();
  };

  if (!meta) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const totals = day?.totals || {};
  const targets = day?.targets || {};
  const calorieTarget = targets.calories || 0;
  const caloriesLeft = Math.round((day?.remaining?.calories) || 0);
  const caloriePct = calorieTarget > 0 ? Math.min((totals.calories / calorieTarget) * 100, 100) : 0;

  const micros = (meta.nutrients || []).filter((n) => n.group === "micro");
  const mealsWithFood = (meta.meals || []).filter((m) => day?.by_meal?.[m]?.length);
  const isEmpty = !loading && day && day.entries.length === 0;

  const chartData = (history?.days || []).map((d) => ({
    label: d.date.slice(5),
    calories: Math.round(d.calories),
  }));

  return (
    <div className="max-w-3xl space-y-6 animate-fade-up" data-testid="intake-root">
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Fuel</div>
          <h1 className="text-4xl font-semibold tracking-tight mt-1">Intake</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Calories, macros and micros — photograph a meal or enter it yourself.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setTargetsOpen(true)} className="gap-1.5">
          <Target className="h-4 w-4" /> Targets
        </Button>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setDate((d) => shiftDate(d, -1))}
          aria-label="Previous day"
          className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => setDate(todayISO())}
          className="text-sm font-medium hover:text-maroon transition-colors"
        >
          {prettyDate(date)}
        </button>
        <button
          onClick={() => setDate((d) => shiftDate(d, 1))}
          disabled={date >= todayISO()}
          aria-label="Next day"
          className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Today's numbers */}
      <Card className="p-5">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-3xl font-semibold tabular-nums">
              {loading ? "—" : Math.round(totals.calories || 0)}
              <span className="text-base text-muted-foreground font-normal">
                {" "}/ {Math.round(calorieTarget)} kcal
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {loading
                ? " "
                : caloriesLeft >= 0
                  ? `${caloriesLeft} kcal left`
                  : `${Math.abs(caloriesLeft)} kcal over`}
            </div>
          </div>
        </div>

        <div className="h-2 rounded-full bg-muted overflow-hidden mb-5">
          <div
            className={`h-full rounded-full transition-all ${caloriesLeft < 0 ? "bg-destructive" : "bg-maroon"}`}
            style={{ width: `${caloriePct}%` }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {HEADLINE.filter((k) => k !== "calories").map((key) => (
            <NutrientBar
              key={key}
              nutrient={nutrientBy[key]}
              value={totals[key] || 0}
              target={targets[key] || 0}
            />
          ))}
        </div>
      </Card>

      {/* Actions — the photo path is the headline, so it gets the primary button */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button
          onClick={() => setAnalyzeOpen(true)}
          className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white h-12 gap-2"
        >
          <Camera className="h-4 w-4" /> Snap a meal
        </Button>
        <Button
          variant="outline"
          onClick={() => { setEditing(null); setEntryOpen(true); }}
          className="h-12 gap-2"
        >
          <Plus className="h-4 w-4" /> Enter it manually
        </Button>
      </div>

      {/* Only offer a suggestion for a day still in play — proposing dinner for
          last Tuesday is nonsense. */}
      {aiStatus.configured && date === todayISO() && (
        <Button
          variant="outline"
          onClick={() => setSuggestOpen(true)}
          className="w-full h-11 gap-2 border-dashed"
        >
          <Sparkles className="h-4 w-4 text-maroon" />
          What should I eat now?
          {calorieTarget > 0 && !loading && (
            <span className="text-muted-foreground font-normal">
              · {Math.max(caloriesLeft, 0)} kcal and {Math.max(Math.round(day?.remaining?.protein_g || 0), 0)}g protein left
            </span>
          )}
        </Button>
      )}

      <PlanCard
        plan={plan}
        date={date}
        loggedNames={new Set((day?.entries || []).map((e) => e.name.toLowerCase()))}
        onLogged={loadDay}
        onRemoved={() => { setPlan(null); toast({ title: "Plan removed", description: "Nothing you logged was touched." }); }}
      />

      {!aiStatus.configured && (
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 shrink-0 mt-px text-maroon" />
          Photo logging needs an AI key. Add <code className="text-foreground">ANTHROPIC_API_KEY</code>{" "}
          or <code className="text-foreground">GROQ_API_KEY</code> to <code>backend/.env</code> and
          restart the backend. Manual entry works either way.
        </p>
      )}

      {/* Entries */}
      {isEmpty ? (
        <Card className="p-10 text-center border-dashed">
          <Utensils className="h-9 w-9 mx-auto text-maroon" />
          <h3 className="mt-3 text-lg font-semibold">Nothing logged {prettyDate(date).toLowerCase()}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Take a photo of your next meal and we'll do the counting.
          </p>
        </Card>
      ) : (
        mealsWithFood.map((m) => (
          <Card key={m} className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold tracking-tight">{MEAL_LABELS[m]}</h3>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {Math.round(day.by_meal[m].reduce((s, e) => s + e.totals.calories, 0))} kcal
              </span>
            </div>
            <div className="divide-y divide-border">
              {day.by_meal[m].map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-3">
                  {e.source === "photo" && (
                    <Camera className="h-3.5 w-3.5 text-maroon shrink-0" aria-label="Logged from a photo" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {e.name}
                      {e.quantity !== 1 && (
                        <span className="text-muted-foreground font-normal"> × {e.quantity}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {[
                        e.serving,
                        `${Math.round(e.totals.protein_g)}g protein`,
                        `${Math.round(e.totals.carbs_g)}g carbs`,
                        `${Math.round(e.totals.fat_g)}g fat`,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums shrink-0">
                    {Math.round(e.totals.calories)}
                  </div>
                  <button
                    onClick={() => { setEditing(e); setEntryOpen(true); }}
                    aria-label={`Edit ${e.name}`}
                    className="text-muted-foreground/60 hover:text-foreground p-1 shrink-0"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(e)}
                    aria-label={`Delete ${e.name}`}
                    className="text-muted-foreground/60 hover:text-destructive p-1 shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}

      {/* Micronutrients */}
      {!isEmpty && day && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold tracking-tight">Micronutrients</h3>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              vs daily target
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {micros.map((n) => (
              <NutrientBar
                key={n.key}
                nutrient={n}
                value={totals[n.key] || 0}
                target={targets[n.key] || 0}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Trend */}
      {chartData.length > 1 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold tracking-tight">Calories</h3>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              last 14 days
            </span>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="intakeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--maroon))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--maroon))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis hide domain={[0, "dataMax + 200"]} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                  formatter={(v) => [`${v} kcal`, "Eaten"]}
                />
                {calorieTarget > 0 && (
                  <ReferenceLine
                    y={calorieTarget}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="calories"
                  stroke="hsl(var(--maroon))"
                  strokeWidth={2}
                  fill="url(#intakeFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <AnalyzeDialog
        open={analyzeOpen}
        onClose={() => setAnalyzeOpen(false)}
        onSaved={afterSave}
        meta={meta}
        date={date}
      />
      <EntryDialog
        open={entryOpen}
        onClose={() => { setEntryOpen(false); setEditing(null); }}
        onSaved={() => afterSave(editing ? 0 : 1)}
        meta={meta}
        date={date}
        entry={editing}
      />
      <SuggestDialog
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        onLogged={(n) => { setSuggestOpen(false); afterSave(n); }}
        meta={meta}
        date={date}
      />
      <TargetsDialog
        open={targetsOpen}
        onClose={() => setTargetsOpen(false)}
        onSaved={() => { setTargetsOpen(false); loadDay(); }}
        meta={meta}
        targets={targets}
        auto={day?.auto}
        profileComplete={day?.profile_complete}
      />
    </div>
  );
}
