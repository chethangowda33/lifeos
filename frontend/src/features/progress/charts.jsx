import React from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { compact, fmtDuration } from "./analytics";

/* Chart conventions used throughout this file — deliberately uniform so the set
   reads as one system:
     · every series is the themeable accent (hsl(var(--maroon))). One series per
       chart means no categorical palette and no legend box: the card title
       already says what is plotted.
     · marks: bars ≤24px with a 4px rounded data-end square at the baseline;
       lines 2px round-capped; dots r=4 ringed 2px in the surface colour so they
       stay legible where they cross the line.
     · grid: solid hairlines, horizontal only, one step off the surface.
     · text never wears the series colour — labels/axes use muted-foreground.
   Colours are read from CSS vars, so the user's accent theme and dark mode both
   flow through without a second palette. */

const ACCENT = "hsl(var(--maroon))";
const SURFACE = "hsl(var(--card))";
const GRID = "hsl(var(--border))";
const INK_MUTED = "hsl(var(--muted-foreground))";

const AXIS = {
  stroke: "transparent",
  tick: { fill: INK_MUTED, fontSize: 10 },
  tickLine: false,
  axisLine: false,
};

/* Tooltips enhance, never gate: every value here is also in the table view. */
function ChartTip({ active, payload, label, unit = "", fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="text-sm font-semibold tabular-nums">
          {fmt ? fmt(p.value) : `${Number(p.value).toLocaleString()}${unit}`}
        </div>
      ))}
    </div>
  );
}

function ChartCard({ title, hint, children, empty, emptyText }) {
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        {hint && <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{hint}</span>}
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground py-10 text-center">{emptyText}</p>
      ) : children}
    </Card>
  );
}

/* Height is the plot PLUS the x-axis band, so the axis labels are never cut off
   into a nested scrollbar. */
const PLOT_H = 200;

export function VolumeChart({ data }) {
  const empty = !data.some((d) => d.volume > 0);
  return (
    <ChartCard
      title="Training volume"
      hint="kg lifted"
      empty={empty}
      emptyText="No volume logged in this range."
    >
      <div style={{ height: PLOT_H }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={120}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...AXIS} width={52} tickFormatter={compact} />
            <Tooltip content={<ChartTip unit=" kg" />} cursor={{ stroke: GRID, strokeWidth: 1 }} />
            <Area
              type="monotone" dataKey="volume" stroke={ACCENT} strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" fill="url(#volFill)"
              dot={false} activeDot={{ r: 5, fill: ACCENT, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function FrequencyChart({ data, mode }) {
  const empty = !data.some((d) => d.sessions > 0);
  return (
    <ChartCard
      title="Training frequency"
      hint={mode === "month" ? "sessions per month" : "sessions per week"}
      empty={empty}
      emptyText="No sessions in this range."
    >
      <div style={{ height: PLOT_H }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={120}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...AXIS} width={52} allowDecimals={false} />
            <Tooltip
              content={<ChartTip fmt={(v) => `${v} session${v === 1 ? "" : "s"}`} />}
              cursor={{ fill: GRID, fillOpacity: 0.35 }}
            />
            {/* 4px rounded data-end, square at the baseline; capped so the band keeps its air */}
            <Bar dataKey="sessions" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function DurationChart({ data }) {
  const empty = !data.some((d) => d.minutes > 0);
  return (
    <ChartCard
      title="Time under the bar"
      hint="minutes trained"
      empty={empty}
      emptyText="No sessions in this range."
    >
      <div style={{ height: PLOT_H }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={120}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...AXIS} width={52} tickFormatter={compact} />
            <Tooltip
              content={<ChartTip fmt={(v) => fmtDuration(v * 60)} />}
              cursor={{ fill: GRID, fillOpacity: 0.35 }}
            />
            <Bar dataKey="minutes" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function StrengthChart({ data, exercises, selected, onSelect }) {
  const empty = data.length === 0;
  const last = data[data.length - 1];
  const first = data[0];
  const delta = last && first ? Math.round((last.e1rm - first.e1rm) * 10) / 10 : 0;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h3 className="font-semibold tracking-tight">Strength progression</h3>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          estimated 1RM
        </span>
      </div>
      {/* Emphasis form: one exercise at a time, so identity never needs a second hue. */}
      <select
        value={selected || ""}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Choose exercise for strength progression"
        className="mb-4 h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm"
      >
        {exercises.map((ex) => (
          <option key={ex.id} value={ex.id}>{ex.name}</option>
        ))}
      </select>

      {empty ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Log this lift with a completed working set to see its trend.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-semibold">{last.e1rm} kg</span>
            {data.length > 1 && (
              <span className={`text-xs font-medium ${delta > 0 ? "text-emerald-500" : delta < 0 ? "text-muted-foreground" : "text-muted-foreground"}`}>
                {delta > 0 ? "+" : ""}{delta} kg over {data.length} sessions
              </span>
            )}
          </div>
          <div style={{ height: PLOT_H }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={120}>
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
                <YAxis {...AXIS} width={52} domain={["auto", "auto"]} tickFormatter={compact} />
                <Tooltip content={<ChartTip unit=" kg" />} cursor={{ stroke: GRID, strokeWidth: 1 }} />
                {/* r=4 → an 8px marker, the spec floor; the 2px surface ring keeps
                    it readable where it sits on the line. */}
                <Line
                  type="monotone" dataKey="e1rm" stroke={ACCENT} strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round"
                  dot={{ r: 4, fill: ACCENT, stroke: SURFACE, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: ACCENT, stroke: SURFACE, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}

/* Ranked horizontal bars. Muscle groups are NOMINAL — every bar is the same
   colour on purpose. Shading them by size would double-encode the length the
   chart already shows. */
export function MuscleSplitChart({ data }) {
  const top = data.slice(0, 8);
  const max = top.reduce((m, d) => Math.max(m, d.volume), 0) || 1;
  return (
    <ChartCard
      title="Volume by muscle"
      hint="working sets only"
      empty={top.length === 0}
      emptyText="No completed working sets in this range."
    >
      <div className="space-y-2.5">
        {top.map((m) => (
          <div key={m.muscle} className="grid grid-cols-[88px_1fr_auto] items-center gap-3">
            <span className="text-xs capitalize text-muted-foreground truncate">{m.muscle}</span>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(2, (m.volume / max) * 100)}%`, background: ACCENT }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">
              {compact(m.volume)} kg · {m.sets}×
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

/* The table-view twin. Tooltips must never be the only way to read a value, so
   every series above is reachable here as text. */
export function DataTable({ series, muscles, strength, exerciseName, mode }) {
  const Th = ({ children, right }) => (
    <th className={`py-1.5 px-2 font-medium text-[11px] uppercase tracking-widest text-muted-foreground ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
  const Td = ({ children, right }) => (
    <td className={`py-1.5 px-2 tabular-nums ${right ? "text-right" : ""}`}>{children}</td>
  );

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold tracking-tight mb-3">
          Per {mode === "month" ? "month" : "week"}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              <Th>{mode === "month" ? "Month" : "Week of"}</Th>
              <Th right>Sessions</Th><Th right>Volume</Th><Th right>Time</Th>
            </tr></thead>
            <tbody>
              {series.map((b) => (
                <tr key={b.t} className="border-b border-border/50 last:border-0">
                  <Td>{b.label}</Td>
                  <Td right>{b.sessions}</Td>
                  <Td right>{b.volume.toLocaleString()} kg</Td>
                  <Td right>{fmtDuration(b.duration)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold tracking-tight mb-3">Volume by muscle</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              <Th>Muscle</Th><Th right>Volume</Th><Th right>Working sets</Th>
            </tr></thead>
            <tbody>
              {muscles.map((m) => (
                <tr key={m.muscle} className="border-b border-border/50 last:border-0">
                  <Td><span className="capitalize">{m.muscle}</span></Td>
                  <Td right>{m.volume.toLocaleString()} kg</Td>
                  <Td right>{m.sets}</Td>
                </tr>
              ))}
              {muscles.length === 0 && (
                <tr><Td>No working sets in this range.</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {strength.length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold tracking-tight mb-3">
            Estimated 1RM — {exerciseName}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border">
                <Th>Date</Th><Th right>Top set</Th><Th right>e1RM</Th>
              </tr></thead>
              <tbody>
                {strength.map((p) => (
                  <tr key={p.t} className="border-b border-border/50 last:border-0">
                    <Td>{p.label}</Td>
                    <Td right>{p.topSet?.kg ?? "—"} kg × {p.topSet?.reps ?? "—"}</Td>
                    <Td right>{p.e1rm} kg</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
