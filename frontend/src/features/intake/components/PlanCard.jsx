import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { ClipboardList, Plus, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { createEntry, deletePlan } from "../api";
import { MEAL_LABELS } from "../lib";

/**
 * The meal plan the user accepted from the coach. It's a template, not a diary:
 * nothing here counts towards a day until it's explicitly logged. Each meal has
 * its own Log button, and the whole plan can be binned without touching anything
 * already eaten.
 */
export default function PlanCard({ plan, date, loggedNames, onLogged, onRemoved }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(-1);

  if (!plan?.meals?.length) return null;

  const log = async (meal, idx) => {
    setBusy(idx);
    try {
      await createEntry({
        name: meal.name,
        meal: meal.meal,
        date,
        serving: meal.serving,
        quantity: 1,
        source: "manual",
        nutrients: meal.nutrients,
      });
      toast({ title: `Logged ${meal.name}` });
      onLogged();
    } finally {
      setBusy(-1);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove this meal plan? Anything you've already logged stays.")) return;
    await deletePlan();
    onRemoved();
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-maroon" /> Your plan
        </h3>
        <button
          onClick={remove}
          className="text-[11px] text-muted-foreground hover:text-destructive transition inline-flex items-center gap-1"
        >
          <X className="h-3 w-3" /> Remove
        </button>
      </div>
      {plan.summary && (
        <p className="text-[11px] text-muted-foreground mb-3">{plan.summary}</p>
      )}

      <div className="divide-y divide-border">
        {plan.meals.map((m, i) => {
          // Already eaten today? Then offer nothing — just show it's done.
          const done = loggedNames.has(m.name.toLowerCase());
          return (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  <span className="text-maroon text-[11px] uppercase tracking-wide mr-1.5">
                    {MEAL_LABELS[m.meal]}
                  </span>
                  {m.name}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[m.serving,
                    `${Math.round(m.nutrients.calories)} kcal`,
                    `${Math.round(m.nutrients.protein_g)}g protein`,
                  ].filter(Boolean).join(" · ")}
                </div>
              </div>
              {done ? (
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
                  <Check className="h-3.5 w-3.5 text-[hsl(var(--success,142_71%_45%))]" /> Logged
                </span>
              ) : (
                <button
                  onClick={() => log(m, i)}
                  disabled={busy === i}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] hover:border-maroon hover:text-maroon transition disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" /> {busy === i ? "Logging…" : "Log"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
