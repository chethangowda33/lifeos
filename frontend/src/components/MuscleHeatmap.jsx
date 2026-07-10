import React, { useEffect, useMemo, useState } from "react";
import Model from "react-body-highlighter";
import api from "@/api";
import { Card } from "@/components/ui/card";

// our muscle_group -> react-body-highlighter muscle names
export const MUSCLE_MAP = {
  chest: ["chest"],
  back: ["upper-back"],
  "lower back": ["lower-back"],
  traps: ["trapezius"],
  shoulders: ["front-deltoids", "back-deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  forearms: ["forearm"],
  quads: ["quadriceps"],
  hamstrings: ["hamstring"],
  glutes: ["gluteal", "abductors", "adductor"],
  calves: ["calves", "left-soleus", "right-soleus"],
  core: ["abs", "obliques"],
};

// which view best shows the highlighted group
const POSTERIOR = new Set(["back", "lower back", "traps", "triceps", "hamstrings", "glutes"]);

// Live CSS-var colors — re-resolve automatically when the accent changes.
const HEAT_COLORS = [
  "hsl(var(--maroon) / 0.3)",
  "hsl(var(--maroon) / 0.55)",
  "hsl(var(--maroon) / 0.8)",
  "hsl(var(--maroon))",
];

/* Tiny body figure highlighting one muscle group — for filter menus. */
export function MuscleThumb({ group, size = 34 }) {
  const muscles = MUSCLE_MAP[group];
  if (!muscles) return null;
  return (
    <Model
      type={POSTERIOR.has(group) ? "posterior" : "anterior"}
      data={[{ name: group, muscles, frequency: 1 }]}
      bodyColor="hsl(var(--muted-foreground) / 0.35)"
      highlightedColors={["hsl(var(--maroon))"]}
      style={{ width: size, padding: 0 }}
    />
  );
}

const ZONE_FREQ = { under: 1, optimal: 2, high: 3, excessive: 4 };
const ZONE_LABELS = [
  ["Light", 1],
  ["Optimal", 2],
  ["High", 3],
  ["Excessive", 4],
];

/* Hevy-style body heatmap — muscles shaded by hard sets over the last 7 days. */
export default function MuscleHeatmap() {
  const [volume, setVolume] = useState(null);

  useEffect(() => {
    api.get("/workouts/muscle-volume").then((r) => setVolume(r.data)).catch(() => setVolume([]));
  }, []);

  const { data, colors, bodyColor } = useMemo(() => {
    const entries = (volume || [])
      .filter((v) => MUSCLE_MAP[v.muscle_group])
      .map((v) => ({
        name: v.muscle_group,
        muscles: MUSCLE_MAP[v.muscle_group],
        frequency: ZONE_FREQ[v.zone] || 1,
      }));
    return {
      data: entries,
      colors: HEAT_COLORS,
      bodyColor: "hsl(var(--muted))",
    };
  }, [volume]);

  if (!volume || volume.length === 0) return null; // nothing trained this week — stay quiet

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Muscles trained</h3>
        <span className="text-[10px] text-muted-foreground">last 7 days</span>
      </div>
      <div className="flex justify-center gap-2">
        <Model type="anterior" data={data} bodyColor={bodyColor} highlightedColors={colors} style={{ width: 120, padding: 0 }} />
        <Model type="posterior" data={data} bodyColor={bodyColor} highlightedColors={colors} style={{ width: 120, padding: 0 }} />
      </div>
      <div className="flex justify-center gap-3 mt-1">
        {ZONE_LABELS.map(([label, f]) => (
          <span key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-2 w-2 rounded-sm" style={{ background: colors[f - 1] }} /> {label}
          </span>
        ))}
      </div>
    </Card>
  );
}
