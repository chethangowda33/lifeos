import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";

/**
 * Number inputs for every nutrient, built from the backend's `meta.nutrients`.
 * Macros are always visible; micros hide behind a toggle so manual logging
 * stays a four-field job unless you want the detail.
 */
export default function NutrientFields({ nutrients, values, onChange, autoFocusFirst }) {
  const [showMicros, setShowMicros] = useState(false);

  const main = nutrients.filter((n) => n.group !== "micro");
  const micros = nutrients.filter((n) => n.group === "micro");
  const filledMicros = micros.filter((n) => Number(values[n.key]) > 0).length;

  const field = (n, i) => (
    <div key={n.key}>
      <label htmlFor={`nutrient-${n.key}`} className="text-[11px] text-muted-foreground block mb-1">
        {n.label} <span className="text-muted-foreground/60">({n.unit})</span>
      </label>
      <Input
        id={`nutrient-${n.key}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        autoFocus={autoFocusFirst && i === 0}
        value={values[n.key] ?? ""}
        onChange={(e) => onChange(n.key, e.target.value)}
        placeholder="0"
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{main.map(field)}</div>

      <button
        type="button"
        onClick={() => setShowMicros((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMicros ? "rotate-180" : ""}`} />
        Micronutrients
        {filledMicros > 0 && <span className="text-maroon">· {filledMicros} set</span>}
      </button>

      {showMicros && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">{micros.map(field)}</div>
      )}
    </div>
  );
}
