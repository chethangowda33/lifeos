import React, { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, ImageUp, Sparkles, Trash2, X, AlertTriangle } from "lucide-react";
import { formatApiErrorDetail } from "@/api";
import { analyzePhoto, analyzeText, createEntry } from "../api";
import { MEAL_LABELS, CONFIDENCE_COPY, HEADLINE, fileToCompressedDataUrl } from "../lib";

const CONFIDENCE_STYLE = {
  high: "text-[hsl(var(--success,142_71%_45%))]",
  medium: "text-amber-500",
  low: "text-destructive",
};

/**
 * The AI path: photograph or describe a meal, see what the model thinks it is,
 * then decide whether it goes into the day. Nothing is written to the tracker
 * until the user presses "Add to tracker" — declining just closes the dialog.
 */
export default function AnalyzeDialog({ open, onClose, onSaved, meta, date, defaultMeal }) {
  const [tab, setTab] = useState("photo");     // photo | describe
  const [image, setImage] = useState(null);    // compressed data URL
  const [hint, setHint] = useState("");
  const [text, setText] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);  // { items, summary, provider }
  const [meal, setMeal] = useState(defaultMeal || "snack");

  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTab("photo"); setImage(null); setHint(""); setText("");
    setAnalyzing(false); setSaving(false); setError(""); setResult(null);
    setMeal(defaultMeal || "snack");
  }, [open, defaultMeal]);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a reset
    if (!file) return;
    setError("");
    try {
      setImage(await fileToCompressedDataUrl(file));
    } catch (err) {
      setError(err.message);
    }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError("");
    try {
      const data = tab === "photo" ? await analyzePhoto(image, hint) : await analyzeText(text);
      if (!data.items?.length) {
        setError(
          data.summary ||
            (tab === "photo"
              ? "No food found in that photo. Try a clearer shot of the plate."
              : "Couldn't work out what that meal was. Add a bit more detail."),
        );
        return;
      }
      // Every item starts selected. QTY is seeded from unit_count so countable foods
      // (e.g. "3 dosa") show quantity 3 with per-piece macros — edit the count directly.
      setResult({
        ...data,
        items: data.items.map((i) => ({
          ...i,
          selected: true,
          quantity: String(i.unit_count && i.unit_count > 0 ? i.unit_count : 1),
        })),
      });
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Analysis failed. Try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const patchItem = (idx, patch) =>
    setResult((r) => ({
      ...r,
      items: r.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));

  const chosen = result?.items.filter((i) => i.selected) || [];

  // Quantity is held as a raw string (so the field can be cleared / partially typed).
  // Treat empty / invalid as 0 for live math; blur normalizes it back to a real number.
  const qtyNum = (q) => {
    const n = parseFloat(q);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // Live total of what's about to be logged, so the number the user sees on the
  // confirm button is the number that lands in the tracker.
  const previewTotals = HEADLINE.reduce((acc, key) => {
    acc[key] = chosen.reduce((s, i) => s + (i.nutrients[key] || 0) * qtyNum(i.quantity), 0);
    return acc;
  }, {});

  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      for (const item of chosen) {
        await createEntry({
          name: item.name,
          meal,
          date,
          serving: item.serving,
          quantity: qtyNum(item.quantity) || 1,
          source: tab === "photo" ? "photo" : "text",
          confidence: item.confidence,
          notes: item.notes,
          nutrients: item.nutrients,
        });
      }
      onSaved(chosen.length);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Could not save. Try again.");
      setSaving(false);
    }
  };

  const canAnalyze = tab === "photo" ? !!image : text.trim().length > 2;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-maroon" />
            {result ? "Is this right?" : "Log a meal with AI"}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Check the numbers, then decide whether they go into today."
              : "Snap the plate or describe it — we'll work out the nutrition."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Capture step ─────────────────────────────────────────────── */}
        {!result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
              {[["photo", "Photo"], ["describe", "Describe"]].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => { setTab(id); setError(""); }}
                  className={`rounded-md py-1.5 text-xs transition ${
                    tab === id
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "photo" ? (
              image ? (
                <div className="space-y-3">
                  <div className="relative">
                    <img
                      src={image}
                      alt="The meal you're about to log"
                      className="w-full rounded-xl border border-border object-cover max-h-64"
                    />
                    <button
                      onClick={() => setImage(null)}
                      aria-label="Remove photo"
                      className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/85 backdrop-blur border border-border flex items-center justify-center hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <Input
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder="Anything we should know? (e.g. no oil, half portion)"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => cameraRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 hover:border-maroon hover:bg-muted/40 transition"
                  >
                    <Camera className="h-7 w-7 text-maroon" />
                    <span className="text-sm font-medium">Take photo</span>
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 hover:border-maroon hover:bg-muted/40 transition"
                  >
                    <ImageUp className="h-7 w-7 text-maroon" />
                    <span className="text-sm font-medium">Upload</span>
                  </button>
                  {/* capture= opens the camera directly on phones; the plain input is the desktop path */}
                  <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={pickFile} className="hidden" />
                  <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} className="hidden" />
                </div>
              )
            ) : (
              <Textarea
                autoFocus
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="2 rotis, a bowl of dal, and some curd"
              />
            )}
          </div>
        )}

        {/* ── Review step ──────────────────────────────────────────────── */}
        {result && (
          <div className="space-y-4">
            {result.summary && (
              <p className="text-sm text-muted-foreground">{result.summary}</p>
            )}

            <div className="space-y-2">
              {result.items.map((item, idx) => (
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
                      onChange={(e) => patchItem(idx, { selected: e.target.checked })}
                      aria-label={`Include ${item.name}`}
                      className="mt-1 h-4 w-4 accent-[hsl(var(--maroon))]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {item.serving}
                        {item.confidence && (
                          <>
                            {" · "}
                            <span className={CONFIDENCE_STYLE[item.confidence]}>
                              {CONFIDENCE_COPY[item.confidence]}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] tabular-nums">
                        {HEADLINE.map((key) => {
                          const n = meta.nutrients.find((x) => x.key === key);
                          const v = (item.nutrients[key] || 0) * qtyNum(item.quantity);
                          return (
                            <span key={key} className="text-muted-foreground">
                              <span className="text-foreground font-semibold">
                                {Math.round(v * 10) / 10}
                              </span>
                              {n.unit === "kcal" ? " kcal" : `${n.unit} ${n.label.toLowerCase()}`}
                            </span>
                          );
                        })}
                      </div>

                      {item.notes && (
                        <p className="text-[11px] text-muted-foreground/80 mt-1 italic">{item.notes}</p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <label className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-1">
                        Qty
                      </label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={(e) => {
                          const raw = e.target.value;
                          // Allow empty or a partial decimal while typing (so it's fully
                          // clearable and you can enter 0.5, 2, etc.). Normalized on blur.
                          if (raw === "" || /^\d*\.?\d*$/.test(raw)) patchItem(idx, { quantity: raw });
                        }}
                        onBlur={() => {
                          const n = parseFloat(item.quantity);
                          patchItem(idx, { quantity: Number.isFinite(n) && n > 0 ? String(n) : "1" });
                        }}
                        className="h-8 w-16 text-center px-1"
                        aria-label={`Servings of ${item.name}`}
                      />
                    </div>

                    <button
                      onClick={() =>
                        setResult((r) => ({ ...r, items: r.items.filter((_, i) => i !== idx) }))
                      }
                      aria-label={`Remove ${item.name}`}
                      className="shrink-0 text-muted-foreground/60 hover:text-destructive p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
                Log as
              </div>
              <div className="flex flex-wrap gap-1.5">
                {meta.meals.map((m) => (
                  <button
                    key={m}
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

            <p className="text-[11px] text-muted-foreground">
              These are estimates. Edit any entry after adding it if you know better.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {!result ? (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                disabled={!canAnalyze || analyzing}
                onClick={runAnalysis}
                className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
              >
                {analyzing ? "Reading your meal…" : "Analyze"}
              </Button>
            </>
          ) : (
            <>
              {/* Declining is a first-class outcome, not a cancel. */}
              <Button variant="ghost" disabled={saving} onClick={onClose}>
                Not now
              </Button>
              <Button
                disabled={saving || chosen.length === 0}
                onClick={confirm}
                className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
              >
                {saving
                  ? "Adding…"
                  : `Add ${chosen.length} item${chosen.length === 1 ? "" : "s"} · ${Math.round(previewTotals.calories)} kcal`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
