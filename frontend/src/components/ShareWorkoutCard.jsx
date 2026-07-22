import React, { useRef, useState } from "react";
import { toPng } from "html-to-image";
import Model from "react-body-highlighter";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MUSCLE_MAP } from "@/components/MuscleHeatmap";
import { useToast } from "@/hooks/use-toast";

function fmtDur(secs) {
  const m = Math.floor((secs || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/* Resolve a CSS custom property to a literal colour.

   The body-map SVGs below are serialised into a standalone data URL, and custom
   properties do NOT resolve in that context — `hsl(var(--maroon))` survives as
   literal text, the SVG fails to parse, and the Image built from it fires neither
   load nor error. html-to-image then awaits it forever, so the button sticks on
   "Creating image…" with no way back. Passing concrete colours avoids that. */
function cssColor(varName, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v ? `hsl(${v})` : fallback;
  } catch {
    return fallback;
  }
}

const PNG_TIMEOUT_MS = 15000;

/* Share button + hidden 380px summary card rendered to PNG via html-to-image. */
export default function ShareWorkoutButton({ summary }) {
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const muscleData = (summary?.muscles || [])
    .filter((g) => MUSCLE_MAP[g])
    .map((g) => ({ name: g, muscles: MUSCLE_MAP[g], frequency: 2 }));

  // Literal colours, not var() — see cssColor above.
  const bodyColor = cssColor("--muted", "#e5e7eb");
  const maroon = cssColor("--maroon", "#c0152a");
  const highlightColors = [cssColor("--maroon-light", maroon), maroon];

  const share = async () => {
    setBusy(true);
    try {
      // skipFonts: embedding the cross-origin Google Fonts stylesheet throws SecurityError and can hang.
      // The timeout is the backstop: html-to-image can hang indefinitely on a resource that never
      // settles, and a share button that never comes back is worse than one that reports failure.
      const dataUrl = await Promise.race([
        toPng(cardRef.current, { pixelRatio: 2, cacheBust: true, skipFonts: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timed out building the image")), PNG_TIMEOUT_MS)),
      ]);
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "lifeos-workout.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: summary?.name || "Workout" });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "lifeos-workout.png";
        a.click();
      }
    } catch (e) {
      if (e?.name !== "AbortError") toast({ title: "Could not create image", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!summary) return null;
  return (
    <>
      <Button variant="outline" onClick={share} disabled={busy} className="w-full">
        <Share2 className="h-4 w-4 mr-2" /> {busy ? "Creating image…" : "Share"}
      </Button>

      {/* Off-screen card that becomes the PNG */}
      <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
        <div
          ref={cardRef}
          className="w-[380px] bg-background text-foreground border border-border rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-maroon font-bold tracking-widest text-sm">LIFEOS</span>
            <span className="text-[11px] text-muted-foreground">
              {new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
          <div className="text-xl font-semibold tracking-tight">{summary.name || "Workout"}</div>
          {summary.lifetime?.total_workouts > 0 && (
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tracking-tight text-maroon leading-none">
                {summary.lifetime.total_workouts}
              </span>
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                workouts<br />all time
              </span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Duration", fmtDur(summary.duration)], ["Volume", `${(summary.volume || 0).toFixed(0)} kg`], ["Sets", summary.sets || 0]].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-muted/30 py-2">
                <div className="text-base font-semibold">{value}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          {muscleData.length > 0 && (
            <div className="flex justify-center gap-2">
              <Model type="anterior" data={muscleData} bodyColor={bodyColor} highlightedColors={highlightColors} style={{ width: 110, padding: 0 }} />
              <Model type="posterior" data={muscleData} bodyColor={bodyColor} highlightedColors={highlightColors} style={{ width: 110, padding: 0 }} />
            </div>
          )}
          {summary.prs?.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
              <div className="text-xs font-semibold text-maroon">🏆 {summary.prs.length} new PR{summary.prs.length > 1 ? "s" : ""}</div>
              {summary.prs.slice(0, 4).map((pr, i) => (
                <div key={i} className="text-[11px] text-muted-foreground">
                  <span className="text-foreground font-medium">{pr.exercise_name}</span> — {pr.label}: {pr.value}
                </div>
              ))}
            </div>
          )}
          {summary.lifetime?.total_workouts > 0 && (
            <div className="text-[11px] text-muted-foreground text-center">
              {fmtDur(summary.lifetime.total_duration)} of effort ·{" "}
              {Math.round(summary.lifetime.total_volume || 0).toLocaleString()} kg lifted
            </div>
          )}
          <div className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            Track everything · lifeos
          </div>
        </div>
      </div>
    </>
  );
}
