import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatApiErrorDetail } from "@/api";
import NutrientFields from "./NutrientFields";
import { saveTargets } from "../api";

/**
 * Daily goals. Anything left blank is computed from the user's body stats
 * (BMR-derived calories, 1.8 g/kg protein) or the standard RDA — so the tracker
 * has sensible targets from day one and the user only overrides what they care about.
 */
export default function TargetsDialog({ open, onClose, onSaved, meta, targets, auto, profileComplete }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);
    // Show auto-computed values as placeholders-in-fact: prefill them, but the
    // user clearing a field hands it back to the automatic default.
    setValues(Object.fromEntries(meta.nutrients.map((n) => [n.key, targets[n.key] ?? ""])));
  }, [open, meta, targets]);

  const setValue = (key, raw) =>
    setValues((v) => ({ ...v, [key]: raw === "" ? "" : Number(raw) }));

  const save = async () => {
    setSaving(true);
    setError("");
    // null tells the backend "go back to computing this one for me".
    const payload = Object.fromEntries(
      meta.nutrients.map((n) => [n.key, values[n.key] === "" || values[n.key] == null ? null : Number(values[n.key])]),
    );
    try {
      onSaved(await saveTargets(payload));
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Could not save targets.");
      setSaving(false);
    }
  };

  const autoCount = meta.nutrients.filter((n) => auto?.[n.key]).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Daily targets</DialogTitle>
          <DialogDescription>
            {autoCount > 0
              ? `${autoCount} of these are set for you${profileComplete ? " from your body stats" : ""}. Change any of them — clear a field to go back to automatic.`
              : "Clear a field to go back to the automatic value."}
          </DialogDescription>
        </DialogHeader>

        {!profileComplete && (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Add your height, weight and age in Body Metrics and we'll compute your calorie
            and protein targets from them instead of using generic defaults.
          </p>
        )}

        <NutrientFields nutrients={meta.nutrients} values={values} onChange={setValue} />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            {saving ? "Saving…" : "Save targets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
