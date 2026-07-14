import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, AlertTriangle, Check } from "lucide-react";
import { formatApiErrorDetail } from "@/api";
import { extractPlan, applyPlan, getMeta } from "../api";
import { MEAL_LABELS, fmt } from "../lib";

const PROFILE_FIELDS = [
  { key: "weight_kg", label: "Weight", unit: "kg" },
  { key: "height_cm", label: "Height", unit: "cm" },
  { key: "age", label: "Age", unit: "" },
  { key: "sex", label: "Sex", unit: "" },
];

/**
 * One before → after row. The "after" value is EDITABLE: the model can misread a
 * range, or miss a number entirely (a small model will happily skip the height
 * you gave it in feet). Rather than trusting it, let the user correct any value
 * before it's written. Non-numeric values (sex) are shown as-is.
 */
function Row({ checked, onToggle, label, from, to, unit, onChange, id }) {
  const editable = onChange && typeof to === "number";
  return (
    <div className={`flex items-center gap-2 py-2 transition ${checked ? "" : "opacity-45"}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 accent-[hsl(var(--maroon))] shrink-0"
      />
      <label htmlFor={id} className="text-sm flex-1 min-w-0 truncate cursor-pointer">
        {label}
      </label>
      <span className="text-xs tabular-nums text-muted-foreground shrink-0">
        {from ?? "not set"}
      </span>
      <ArrowRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      {editable ? (
        <span className="shrink-0 inline-flex items-center gap-1">
          <Input
            type="number"
            min="0"
            step="any"
            value={to}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} target`}
            className="h-7 w-20 px-2 text-xs text-right tabular-nums font-semibold text-maroon"
          />
          <span className="text-[10px] text-muted-foreground w-6">{unit}</span>
        </span>
      ) : (
        <span className="text-xs font-semibold text-maroon shrink-0 w-[104px] text-right pr-8">
          {to}
        </span>
      )}
    </div>
  );
}

/**
 * Reads a plan out of what the coach actually said, shows it as a
 * before → after diff against the user's real profile and targets, and writes
 * only the rows they tick. "No thanks" writes nothing at all.
 *
 * Every row here is derived at runtime — there are no default numbers, foods or
 * nutrients in this file.
 */
export default function ApplyPlanDialog({ open, onClose, onApplied, messages }) {
  const [meta, setMeta] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Ticked rows, and the values that will actually be written (editable, so a
  // number the model got wrong or skipped can be fixed here rather than trusted).
  const [pickProfile, setPickProfile] = useState({});
  const [pickTargets, setPickTargets] = useState({});
  const [pickMeals, setPickMeals] = useState([]);
  const [valProfile, setValProfile] = useState({});
  const [valTargets, setValTargets] = useState({});

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setPlan(null);

    Promise.all([meta ? Promise.resolve(meta) : getMeta(), extractPlan(messages)])
      .then(([m, p]) => {
        setMeta(m);
        setPlan(p);

        // If the body came up at all, show every stat — including ones the model
        // failed to pick up — pre-filled with what it proposed, else what's on
        // file. Only genuine changes start ticked.
        const touchedBody = Object.keys(p.proposed.profile).length > 0;
        setValProfile(
          touchedBody
            ? Object.fromEntries(
                PROFILE_FIELDS.map(({ key }) => [
                  key,
                  p.proposed.profile[key] ?? p.current.profile[key] ?? "",
                ]),
              )
            : {},
        );
        setPickProfile(Object.fromEntries(Object.keys(p.proposed.profile).map((k) => [k, true])));

        setValTargets({ ...p.proposed.targets });
        setPickTargets(Object.fromEntries(Object.keys(p.proposed.targets).map((k) => [k, true])));
        setPickMeals(p.proposed.meals.map(() => true));
      })
      .catch((err) =>
        setError(
          formatApiErrorDetail(err.response?.data?.detail) ||
            "Couldn't read a plan out of that reply.",
        ),
      )
      .finally(() => setLoading(false));
    // `messages` is a fresh array each render; keying off `open` is deliberate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = async () => {
    setSaving(true);
    setError("");

    // Send what's on screen, not what the model said — the user may have edited it.
    const profile = Object.fromEntries(
      Object.entries(valProfile)
        .filter(([k, v]) => pickProfile[k] && v !== "" && v != null)
        .map(([k, v]) => [k, k === "sex" ? v : Number(v)]),
    );
    const targets = Object.fromEntries(
      Object.entries(valTargets)
        .filter(([k, v]) => pickTargets[k] && v !== "" && v != null)
        .map(([k, v]) => [k, Number(v)]),
    );
    const meals = plan.proposed.meals.filter((_, i) => pickMeals[i]);

    try {
      const res = await applyPlan({
        profile: Object.keys(profile).length ? profile : null,
        targets: Object.keys(targets).length ? targets : null,
        meals: meals.length ? meals : null,
        summary: plan.summary,
      });
      onApplied(res);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Could not apply. Try again.");
      setSaving(false);
    }
  };

  const nutrient = (key) => meta?.nutrients.find((n) => n.key === key);
  const picked =
    Object.values(pickProfile).filter(Boolean).length +
    Object.values(pickTargets).filter(Boolean).length +
    pickMeals.filter(Boolean).length;

  const nothingProposed = plan && !plan.proposes_changes;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply this plan?</DialogTitle>
          <DialogDescription>
            Nothing changes until you say so. Untick anything you don&apos;t want.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground py-6">Reading the plan…</p>}

        {nothingProposed && (
          <p className="text-sm text-muted-foreground py-4">
            That reply didn&apos;t contain any targets, body stats or meals to apply — it was just advice.
          </p>
        )}

        {plan?.proposes_changes && (
          <div className="space-y-5">
            {plan.summary && <p className="text-sm text-muted-foreground">{plan.summary}</p>}

            {/* Body stats — shown whenever the conversation touched the body at all,
                so a stat the model failed to pick up can still be corrected here. */}
            {Object.keys(valProfile).length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">
                  Your body stats
                </div>
                <p className="text-[11px] text-muted-foreground/80 mb-1.5">
                  Your profile disagrees with what you told the coach. Fixing it here also fixes
                  every future answer it gives you — check each number is right.
                </p>
                <div className="divide-y divide-border">
                  {PROFILE_FIELDS.filter((f) => f.key !== "sex").map((f) => (
                    <Row
                      key={f.key}
                      id={`plan-profile-${f.key}`}
                      checked={!!pickProfile[f.key]}
                      onToggle={() => setPickProfile((p) => ({ ...p, [f.key]: !p[f.key] }))}
                      label={f.label}
                      unit={f.unit}
                      from={
                        plan.current.profile[f.key] != null
                          ? `${plan.current.profile[f.key]}${f.unit}`
                          : null
                      }
                      to={valProfile[f.key] === "" ? "" : Number(valProfile[f.key])}
                      onChange={(v) => {
                        setValProfile((p) => ({ ...p, [f.key]: v }));
                        // Editing a row is intent to apply it.
                        setPickProfile((p) => ({ ...p, [f.key]: true }));
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Daily targets */}
            {Object.keys(valTargets).length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
                  Daily targets
                </div>
                <div className="divide-y divide-border">
                  {Object.entries(valTargets).map(([key, value]) => {
                    const n = nutrient(key);
                    if (!n) return null;
                    return (
                      <Row
                        key={key}
                        id={`plan-target-${key}`}
                        checked={!!pickTargets[key]}
                        onToggle={() => setPickTargets((p) => ({ ...p, [key]: !p[key] }))}
                        label={n.label}
                        unit={n.unit}
                        from={fmt(plan.current.targets[key], n.unit)}
                        to={value === "" ? "" : Number(value)}
                        onChange={(v) => {
                          setValTargets((p) => ({ ...p, [key]: v }));
                          setPickTargets((p) => ({ ...p, [key]: true }));
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Meals — saved as a plan, not logged as eaten. */}
            {plan.proposed.meals.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">
                  Meal plan
                </div>
                <p className="text-[11px] text-muted-foreground/80 mb-1.5">
                  Saved as a plan you can log in one tap — not counted as eaten.
                </p>
                <div className="space-y-1.5">
                  {plan.proposed.meals.map((m, i) => (
                    <label
                      key={i}
                      htmlFor={`plan-meal-${i}`}
                      className={`flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer transition ${
                        pickMeals[i] ? "border-maroon/40 bg-maroon/[0.04]" : "border-border opacity-45"
                      }`}
                    >
                      <input
                        id={`plan-meal-${i}`}
                        type="checkbox"
                        checked={!!pickMeals[i]}
                        onChange={() =>
                          setPickMeals((p) => p.map((v, j) => (j === i ? !v : v)))
                        }
                        className="mt-0.5 h-4 w-4 accent-[hsl(var(--maroon))] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          <span className="text-maroon">{MEAL_LABELS[m.meal]}</span> · {m.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {[m.serving,
                            `${Math.round(m.nutrients.calories)} kcal`,
                            `${Math.round(m.nutrients.protein_g)}g protein`,
                          ].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
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
            No thanks
          </Button>
          <Button
            onClick={apply}
            disabled={saving || loading || picked === 0}
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white gap-1.5"
          >
            <Check className="h-4 w-4" />
            {saving ? "Applying…" : `Apply ${picked} change${picked === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
