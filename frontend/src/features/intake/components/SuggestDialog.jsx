import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, RotateCw, Utensils } from "lucide-react";
import { formatApiErrorDetail } from "@/api";
import { suggestMeal, createEntry } from "../api";
import { MEAL_LABELS, HEADLINE } from "../lib";

/**
 * "What should I eat now?" — the coach reads what's left of today's targets and
 * proposes the next meal. It suggests; it never logs. You can log it, ask for a
 * different idea, or walk away.
 */
export default function SuggestDialog({ open, onClose, onLogged, meta, date }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState(null);
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await suggestMeal(date);
      if (!data.items?.length) {
        setError("The coach couldn't come up with a meal. Try again.");
        return;
      }
      setSuggestion(data);
      setItems(data.items.map((i) => ({ ...i, selected: true, quantity: 1 })));
    } catch (err) {
      setError(
        formatApiErrorDetail(err.response?.data?.detail) || "Couldn't get a suggestion.",
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (!open) return;
    setSuggestion(null);
    setItems([]);
    load();
  }, [open, load]);

  const chosen = items.filter((i) => i.selected);
  const kcal = chosen.reduce((s, i) => s + i.nutrients.calories * i.quantity, 0);

  const log = async () => {
    setSaving(true);
    setError("");
    try {
      for (const item of chosen) {
        await createEntry({
          name: item.name,
          meal: suggestion.meal,
          date,
          serving: item.serving,
          quantity: item.quantity,
          source: "text",
          confidence: item.confidence,
          notes: item.notes,
          nutrients: item.nutrients,
        });
      }
      onLogged(chosen.length);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Could not log it.");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Utensils className="h-4 w-4 text-maroon" />
            {suggestion ? suggestion.title : "What should I eat?"}
          </DialogTitle>
          <DialogDescription>
            {suggestion
              ? `Suggested for ${MEAL_LABELS[suggestion.meal].toLowerCase()}, based on what's left today.`
              : "Reading what's left of today's targets…"}
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground py-6">Thinking…</p>}

        {suggestion && !loading && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{suggestion.reason}</p>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className={`rounded-xl border p-3 transition ${
                    item.selected ? "border-maroon/40 bg-maroon/[0.04]" : "border-border opacity-55"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={(e) =>
                        setItems((s) =>
                          s.map((it, i) => (i === idx ? { ...it, selected: e.target.checked } : it)),
                        )
                      }
                      aria-label={`Include ${item.name}`}
                      className="mt-1 h-4 w-4 accent-[hsl(var(--maroon))]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-[11px] text-muted-foreground">{item.serving}</div>
                      <div className="flex flex-wrap gap-x-3 mt-1 text-[11px] tabular-nums text-muted-foreground">
                        {HEADLINE.map((key) => {
                          const n = meta.nutrients.find((x) => x.key === key);
                          const v = item.nutrients[key] * item.quantity;
                          return (
                            <span key={key}>
                              <span className="text-foreground font-semibold">
                                {Math.round(v * 10) / 10}
                              </span>
                              {n.unit === "kcal" ? " kcal" : `${n.unit} ${n.label.toLowerCase()}`}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <Input
                      type="number"
                      min="0.25"
                      step="0.25"
                      value={item.quantity}
                      onChange={(e) =>
                        setItems((s) =>
                          s.map((it, i) =>
                            i === idx
                              ? { ...it, quantity: Math.max(Number(e.target.value) || 0.25, 0.25) }
                              : it,
                          ),
                        )
                      }
                      aria-label={`Servings of ${item.name}`}
                      className="h-8 w-16 text-center px-1 shrink-0"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Not now
          </Button>
          <Button
            variant="outline"
            onClick={load}
            disabled={loading || saving}
            className="gap-1.5"
          >
            <RotateCw className="h-4 w-4" /> Something else
          </Button>
          <Button
            onClick={log}
            disabled={loading || saving || chosen.length === 0}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            {saving ? "Logging…" : `Log it · ${Math.round(kcal)} kcal`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
