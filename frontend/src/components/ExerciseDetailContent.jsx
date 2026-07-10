import React, { useEffect, useMemo, useState } from "react";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Trophy, Dumbbell } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const WINDOWS = [
  ["3m", "3 months", 90],
  ["6m", "6 months", 180],
  ["all", "All time", 100000],
];

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtClock(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Full exercise detail — Summary (animation, muscles, trend chart, PRs),
 * History, and How-to. Used by both the /exercise/:id page and the
 * in-session dialog so every exercise shows everything, everywhere.
 */
export default function ExerciseDetailContent({ exerciseId, exercise: preloaded, onLoaded }) {
  const [exercise, setExercise] = useState(preloaded || null);
  const [history, setHistory] = useState([]);
  const [records, setRecords] = useState({});
  const [labels, setLabels] = useState({});
  const [metric, setMetric] = useState("best_weight");
  const [windowKey, setWindowKey] = useState("3m");

  useEffect(() => {
    if (!exerciseId) return;
    api.get(`/exercises/${exerciseId}`).then((r) => { setExercise(r.data); onLoaded?.(r.data); }).catch(() => {});
    api.get(`/exercises/${exerciseId}/history`).then((r) => setHistory(r.data)).catch(() => {});
    api.get(`/exercises/${exerciseId}/records`).then((r) => {
      setRecords(r.data.records || {});
      setLabels(r.data.labels || {});
    }).catch(() => {});
  }, [exerciseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeBased = exercise && ["cardio", "core"].includes(exercise.muscle_group);

  const metricOptions = timeBased
    ? [["total_duration", "Total Time"]]
    : [["best_weight", "Best Weight"], ["best_e1rm", "Est. 1RM"], ["total_volume", "Total Volume"]];

  const chartData = useMemo(() => {
    const days = WINDOWS.find(([k]) => k === windowKey)?.[2] ?? 90;
    const cutoff = Date.now() - days * 86400000;
    return [...history]
      .filter((h) => new Date(h.date).getTime() >= cutoff)
      .reverse()
      .map((h) => ({ date: fmtDate(h.date), value: Math.round((h[metric] || 0) * 10) / 10 }));
  }, [history, metric, windowKey]);

  const prEntries = Object.entries(records).filter(([, v]) => v?.value);

  const demo = exercise && (
    exercise.animation_url ? (
      <div className="bg-white rounded-xl p-3 border border-border flex justify-center">
        <img
          src={exercise.animation_url}
          alt={`${exercise.name} — animated demonstration`}
          className="rounded-lg object-contain"
          style={{ width: "min(320px, 100%)" }}
        />
      </div>
    ) : exercise.video_url ? (
      <video
        src={exercise.video_url}
        autoPlay loop muted playsInline controls={false}
        className="w-full max-h-80 rounded-lg bg-black object-contain"
      />
    ) : null
  );

  return (
    <Tabs defaultValue="summary">
      <TabsList className="grid grid-cols-3 w-full">
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="howto">How to</TabsTrigger>
      </TabsList>

      {/* ── SUMMARY ── */}
      <TabsContent value="summary" className="space-y-4 mt-4">
        {demo}

        {exercise && (
          <div className="space-y-1">
            <div className="text-sm">
              <span className="text-muted-foreground">Primary: </span>
              <span className="font-medium capitalize text-maroon">{exercise.muscle_group}</span>
            </div>
            {(exercise.secondary_muscles || []).length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Secondary: </span>
                <span className="capitalize">{exercise.secondary_muscles.join(", ")}</span>
              </div>
            )}
            <div className="text-sm">
              <span className="text-muted-foreground">Equipment: </span>
              <span className="capitalize">{exercise.equipment}</span>
            </div>
          </div>
        )}

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex gap-1.5">
              {metricOptions.map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setMetric(val)}
                  className={`px-2.5 py-1 rounded-md text-xs border transition ${
                    metric === val ? "bg-maroon text-white border-transparent" : "bg-muted border-border"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-1.5">
              {WINDOWS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setWindowKey(k)}
                  className={`px-2 py-1 rounded-md text-xs transition ${
                    windowKey === k ? "text-maroon font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {chartData.length < 2 ? (
            <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
              {chartData.length === 0 ? "No data yet — log this exercise to see a trend." : "Log this exercise again to see a trend."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: 8, fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="value" stroke="hsl(var(--maroon))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-4">
          <div className="font-semibold flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-maroon" /> Personal Records
          </div>
          {prEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No records yet — complete some sets to start tracking PRs.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {prEntries.map(([type, v]) => (
                <div key={type} className="rounded-lg bg-muted p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{labels[type] || type}</div>
                  <div className="text-lg font-bold mt-0.5">
                    {type === "duration" ? fmtClock(v.value)
                      : type === "distance" ? `${v.value} m`
                      : type === "pace" ? `${v.value} km/h`
                      : `${v.value}${type === "reps" ? "" : " kg"}`}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{fmtDate(v.date)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </TabsContent>

      {/* ── HISTORY ── */}
      <TabsContent value="history" className="space-y-3 mt-4">
        {history.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <Dumbbell className="h-8 w-8 mx-auto mb-2 text-maroon" />
            No logged sessions with this exercise yet.
          </Card>
        )}
        {history.map((h) => (
          <Card key={h.session_id + h.date} className="p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm truncate">{h.session_name}</div>
              <div className="text-xs text-muted-foreground">{fmtDate(h.date)}</div>
            </div>
            <div className="mt-2 space-y-1">
              {h.sets.map((s, i) => (
                <div key={i} className="text-sm text-muted-foreground flex gap-3">
                  <span className={`w-6 font-semibold ${s.set_type === "warmup" ? "text-orange-400" : ""}`}>
                    {s.set_type === "warmup" ? "W" : i + 1}
                  </span>
                  <span>
                    {s.duration_seconds
                      ? `${fmtClock(s.duration_seconds)}${s.distance_m ? ` · ${s.distance_m} m` : ""}`
                      : `${s.kg ?? "-"} kg × ${s.reps ?? "-"}`}
                    {s.rpe ? ` @ RPE ${s.rpe}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </TabsContent>

      {/* ── HOW TO ── */}
      <TabsContent value="howto" className="mt-4">
        <Card className="p-5 space-y-4">
          {exercise && (
            <>
              {demo}
              <div>
                <div className="font-semibold mb-1.5">Muscles targeted</div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="capitalize bg-maroon text-white hover:bg-maroon">{exercise.muscle_group}</Badge>
                  {(exercise.secondary_muscles || []).map((m) => (
                    <Badge key={m} variant="secondary" className="capitalize">{m}</Badge>
                  ))}
                  <Badge variant="outline" className="capitalize">{exercise.equipment}</Badge>
                </div>
              </div>
              <div>
                <div className="font-semibold mb-1.5">Instructions</div>
                {(exercise.instructions || "").includes("\n") ? (
                  <ol className="space-y-2">
                    {exercise.instructions.split("\n").filter(Boolean).map((step, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
                        <span className="shrink-0 h-5 w-5 rounded-full bg-[hsl(var(--maroon)/0.12)] text-maroon text-[11px] font-semibold flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground leading-relaxed">{exercise.instructions || "No instructions available."}</p>
                )}
              </div>
            </>
          )}
        </Card>
      </TabsContent>
    </Tabs>
  );
}
