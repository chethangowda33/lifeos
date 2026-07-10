import React, { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// Greedy plates-per-side breakdown for a target barbell weight.
export function computePlates(targetKg, barKg, inventory) {
  const perSide = (Number(targetKg) - Number(barKg)) / 2;
  if (!Number.isFinite(perSide) || perSide < 0) return { plates: [], remainder: 0, perSide: 0 };
  const sorted = [...(inventory || [])].sort((a, b) => b - a);
  let left = perSide;
  const plates = [];
  for (const p of sorted) {
    while (left >= p - 1e-9) {
      plates.push(p);
      left = Math.round((left - p) * 1000) / 1000;
    }
  }
  return { plates, remainder: left, perSide };
}

export default function PlateCalculator({ open, onClose, initialWeight, settings }) {
  const [target, setTarget] = useState(initialWeight || "");
  const [bar, setBar] = useState(settings?.bar_weight_kg ?? 20);
  const inventory = useMemo(
    () => (settings?.plate_inventory?.length ? settings.plate_inventory : [25, 20, 15, 10, 5, 2.5, 1.25]),
    [settings?.plate_inventory],
  );

  // Re-seed target when reopened for a different set
  React.useEffect(() => {
    if (open) setTarget(initialWeight || "");
  }, [open, initialWeight]);

  const { plates, remainder } = useMemo(
    () => computePlates(target, bar, inventory),
    [target, bar, inventory],
  );

  const counts = useMemo(() => {
    const m = new Map();
    plates.forEach((p) => m.set(p, (m.get(p) || 0) + 1));
    return [...m.entries()];
  }, [plates]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Plate Calculator</DialogTitle>
          <DialogDescription>Plates needed per side of the bar.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Target (kg)</div>
            <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Bar (kg)</div>
            <Input type="number" value={bar} onChange={(e) => setBar(e.target.value)} />
          </div>
        </div>

        {Number(target) > 0 && (
          <div className="mt-2">
            {Number(target) < Number(bar) ? (
              <p className="text-sm text-destructive">Target is lighter than the bar.</p>
            ) : (
              <>
                <div className="flex items-end justify-center gap-1 py-4">
                  {/* bar stub */}
                  <div className="h-2 w-8 rounded-sm bg-muted-foreground/40" />
                  {plates.map((p, i) => (
                    <div
                      key={i}
                      className="rounded-sm bg-maroon text-white text-[10px] font-semibold flex items-center justify-center"
                      style={{ height: `${28 + p * 2.2}px`, width: p >= 10 ? 22 : 16 }}
                    >
                      {p}
                    </div>
                  ))}
                  <div className="h-2 w-4 rounded-sm bg-muted-foreground/40" />
                </div>
                <div className="text-center text-sm">
                  {counts.length === 0 ? (
                    <span className="text-muted-foreground">Empty bar — no plates needed.</span>
                  ) : (
                    <span className="font-medium">
                      Per side: {counts.map(([p, n]) => `${n}×${p}kg`).join(" + ")}
                    </span>
                  )}
                  {remainder > 0.01 && (
                    <div className="text-xs text-warning mt-1" style={{ color: "hsl(var(--warning, 38 92% 50%))" }}>
                      {remainder.toFixed(2)} kg per side can&apos;t be loaded with your plates —
                      closest load: {(Number(bar) + (Number(target) - Number(bar) - remainder * 2))} kg
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
