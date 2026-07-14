import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatApiErrorDetail } from "@/api";
import NutrientFields from "./NutrientFields";
import { createEntry, updateEntry } from "../api";
import { MEAL_LABELS } from "../lib";

/**
 * The manual path: type the numbers yourself. Doubles as the editor for any
 * entry already in the tracker, including ones the AI created — so a wrong
 * estimate is a correction, not a delete-and-redo.
 */
export default function EntryDialog({ open, onClose, onSaved, meta, date, entry, defaultMeal }) {
  const editing = !!entry;
  const [name, setName] = useState("");
  const [serving, setServing] = useState("");
  const [meal, setMeal] = useState("snack");
  const [quantity, setQuantity] = useState(1);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);
    setName(entry?.name || "");
    setServing(entry?.serving || "");
    setMeal(entry?.meal || defaultMeal || "snack");
    setQuantity(entry?.quantity ?? 1);
    setValues(entry?.nutrients || {});
  }, [open, entry, defaultMeal]);

  const setValue = (key, raw) =>
    setValues((v) => ({ ...v, [key]: raw === "" ? "" : Number(raw) }));

  const save = async () => {
    if (!name.trim()) {
      setError("Give it a name so you can recognise it later.");
      return;
    }
    setSaving(true);
    setError("");

    const nutrients = {};
    for (const n of meta.nutrients) nutrients[n.key] = Number(values[n.key]) || 0;

    const payload = {
      name: name.trim(),
      meal,
      date,
      serving: serving.trim(),
      quantity: Number(quantity) || 1,
      source: entry?.source || "manual",
      nutrients,
    };

    try {
      if (editing) await updateEntry(entry.id, payload);
      else await createEntry(payload);
      onSaved();
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Could not save. Try again.");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit entry" : "Add food"}</DialogTitle>
          <DialogDescription>
            {editing ? "Fix anything that isn't right." : "Enter the values yourself."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="entry-name" className="text-[11px] text-muted-foreground block mb-1">
                Food
              </label>
              <Input
                id="entry-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Chicken curry"
              />
            </div>
            <div>
              <label htmlFor="entry-serving" className="text-[11px] text-muted-foreground block mb-1">
                Serving <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <Input
                id="entry-serving"
                value={serving}
                onChange={(e) => setServing(e.target.value)}
                placeholder="1 bowl (200g)"
              />
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">Meal</div>
            <div className="flex flex-wrap gap-1.5">
              {meta.meals.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMeal(m)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    meal === m
                      ? "border-maroon bg-maroon text-white"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {MEAL_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <NutrientFields
            nutrients={meta.nutrients}
            values={values}
            onChange={setValue}
          />

          <div className="w-28">
            <label htmlFor="entry-qty" className="text-[11px] text-muted-foreground block mb-1">
              Servings
            </label>
            <Input
              id="entry-qty"
              type="number"
              min="0.25"
              step="0.25"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add to tracker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
