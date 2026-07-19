import React, { useEffect, useMemo, useState } from "react";
import api from "@/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ArrowUp, ArrowDown, ClipboardList, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Build a multi-day split by PICKING EXISTING ROUTINES in order — instead of
 * re-entering every exercise (which is what the old plan builder made you do).
 *
 * Saves both shapes so nothing regresses:
 *  - `routine_ids` → the split references your routines (new model)
 *  - `days`        → derived from those routines, so the existing plan card,
 *                    "next up" rotation and day-start flow keep working as-is.
 */
export default function SplitEditor({ open, onClose, onSaved, routines = [] }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState([]); // ordered routine ids
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setPicked([]); }
  }, [open]);

  const byId = useMemo(() => Object.fromEntries(routines.map((r) => [r.id, r])), [routines]);
  const available = routines.filter((r) => !picked.includes(r.id));

  const add = (id) => setPicked((p) => (p.includes(id) ? p : [...p, id]));
  const remove = (id) => setPicked((p) => p.filter((x) => x !== id));
  const move = (i, dir) =>
    setPicked((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const c = p.slice();
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  const canSave = !!name.trim() && picked.length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // Derive days from the chosen routines so existing rendering/rotation works.
      const days = picked.map((id) => {
        const r = byId[id] || {};
        return {
          name: r.name || "Day",
          exercises: (r.exercises || [])
            .filter((e) => e.exercise_id)
            .map((e) => ({
              exercise_id: e.exercise_id,
              sets: e.sets ?? 3,
              reps: e.reps ?? 10,
              notes: e.notes || "",
            })),
        };
      });
      await api.post("/plans", { name: name.trim(), routine_ids: picked, days });
      toast({ title: "Split created", description: `${picked.length} days from your routines` });
      onSaved?.();
      onClose();
    } catch (e) {
      toast({
        title: "Couldn't create split",
        description: String(e.response?.data?.detail || e.message || e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>New split</DialogTitle>
          <DialogDescription>
            Pick your routines in the order you train them. The app tracks what&apos;s next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Split name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Push Pull Legs" />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
              Order ({picked.length})
            </div>
            {picked.length === 0 ? (
              <div className="text-xs text-muted-foreground border border-dashed rounded-lg py-6 text-center">
                Add routines below to build your split
              </div>
            ) : (
              <div className="space-y-1.5">
                {picked.map((id, i) => {
                  const r = byId[id];
                  if (!r) return null;
                  return (
                    <div key={id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
                      <span className="h-6 w-6 shrink-0 rounded-md bg-[hsl(var(--maroon)/0.12)] text-maroon flex items-center justify-center text-xs font-semibold">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {(r.exercises || []).length} exercises
                        </div>
                      </div>
                      <div className="flex flex-col shrink-0">
                        <button
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          className="h-6 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-maroon hover:bg-muted active:scale-90 transition disabled:opacity-20"
                          aria-label="Move up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => move(i, +1)}
                          disabled={i === picked.length - 1}
                          className="h-6 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-maroon hover:bg-muted active:scale-90 transition disabled:opacity-20"
                          aria-label="Move down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </div>
                      <button
                        onClick={() => remove(id)}
                        className="text-muted-foreground hover:text-destructive p-1 shrink-0"
                        aria-label="Remove from split"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
              Your routines
            </div>
            {routines.length === 0 ? (
              <div className="text-xs text-muted-foreground border border-dashed rounded-lg py-6 text-center">
                Create a routine first, then build a split from your routines.
              </div>
            ) : available.length === 0 ? (
              <div className="text-xs text-muted-foreground py-3 text-center">
                <Check className="h-4 w-4 mx-auto mb-1 text-maroon" /> All routines added
              </div>
            ) : (
              <div className="space-y-1.5">
                {available.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => add(r.id)}
                    className="w-full flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left hover:border-[hsl(var(--maroon)/0.5)] transition"
                  >
                    <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {(r.exercises || []).length} exercises{r.folder ? ` · ${r.folder}` : ""}
                      </div>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !canSave}
            onClick={save}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            {saving ? "Saving…" : "Create split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
