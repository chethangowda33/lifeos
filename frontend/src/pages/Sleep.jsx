import React, { useEffect, useState } from "react";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from "recharts";
import { Moon, Plus, Star, Trash2 } from "lucide-react";

// hours between a bedtime and wake time (handles crossing midnight)
function hoursBetween(bed, wake) {
  if (!bed || !wake) return 0;
  const [bh, bm] = bed.split(":").map(Number);
  const [wh, wm] = wake.split(":").map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 10) / 10;
}

function Stars({ n }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-3 w-3 ${i <= (n || 0) ? "text-maroon fill-maroon" : "text-muted"}`} />
      ))}
    </span>
  );
}

export default function Sleep() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/sleep");
      setLogs(data.logs || []);
      setStats(data.stats || {});
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    if (!window.confirm("Delete this night?")) return;
    await api.delete(`/sleep/${id}`);
    load();
  };

  const chartData = [...logs].reverse().map((l) => ({
    label: (l.date || "").slice(5),
    hours: l.hours,
  }));

  const tiles = [
    { label: "Avg sleep", value: stats.avg_hours != null ? `${stats.avg_hours}h` : "—", hint: "last 7 nights" },
    { label: "Avg quality", value: stats.avg_quality != null ? `${stats.avg_quality}/5` : "—", hint: "last 7 nights" },
    { label: "Last night", value: stats.last_hours != null ? `${stats.last_hours}h` : "—", hint: "most recent" },
    { label: "Nights logged", value: stats.nights_logged ?? 0, hint: "total" },
  ];

  return (
    <div className="max-w-3xl space-y-6 animate-fade-up">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Recovery</div>
          <h1 className="text-4xl font-semibold tracking-tight mt-1">Sleep</h1>
          <p className="text-muted-foreground text-sm mt-1">Duration, quality, and trends over time.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
          <Plus className="h-4 w-4 mr-1.5" /> Log sleep
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <div className="text-2xl font-semibold tabular-nums">{loading ? "—" : t.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{t.label}</div>
            <div className="text-[10px] text-muted-foreground/70">{t.hint}</div>
          </Card>
        ))}
      </div>

      {chartData.length > 1 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold tracking-tight">Sleep duration</h3>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">hours per night</span>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="sleepFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--maroon))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--maroon))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis hide domain={[0, "dataMax + 1"]} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                  formatter={(v) => [`${v} h`, "Sleep"]}
                />
                <Area type="monotone" dataKey="hours" stroke="hsl(var(--maroon))" strokeWidth={2} fill="url(#sleepFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : logs.length === 0 ? (
        <Card className="p-10 text-center border-dashed">
          <Moon className="h-9 w-9 mx-auto text-maroon" />
          <h3 className="mt-3 text-lg font-semibold">Log your first night</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Track sleep to see how recovery affects your training.</p>
          <Button onClick={() => setDialogOpen(true)} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
            <Plus className="h-4 w-4 mr-1.5" /> Log sleep
          </Button>
        </Card>
      ) : (
        <Card className="p-5">
          <h3 className="font-semibold tracking-tight mb-3">Recent nights</h3>
          <div className="divide-y divide-border">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-3">
                <Moon className="h-4 w-4 text-maroon shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{l.date}</div>
                  {(l.bedtime || l.wake_time) && (
                    <div className="text-[11px] text-muted-foreground">{l.bedtime} → {l.wake_time}</div>
                  )}
                </div>
                <Stars n={l.quality} />
                <div className="text-sm font-semibold tabular-nums w-14 text-right">{l.hours}h</div>
                <button onClick={() => remove(l.id)} aria-label="Delete night" className="text-muted-foreground/60 hover:text-destructive p-1 shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <SleepDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={() => { setDialogOpen(false); load(); }} />
    </div>
  );
}

function SleepDialog({ open, onClose, onSaved }) {
  const [bedtime, setBedtime] = useState("23:00");
  const [wake, setWake] = useState("07:00");
  const [quality, setQuality] = useState(3);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setBedtime("23:00"); setWake("07:00"); setQuality(3); }
  }, [open]);

  const hours = hoursBetween(bedtime, wake);

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/sleep", { hours, quality, bedtime, wake_time: wake });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Log sleep</DialogTitle>
          <DialogDescription>Last night&apos;s rest.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Bedtime</div>
              <Input type="time" value={bedtime} onChange={(e) => setBedtime(e.target.value)} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Wake</div>
              <Input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
            </div>
          </div>
          <div className="text-center text-sm text-muted-foreground">
            Duration: <span className="text-foreground font-semibold">{hours}h</span>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">Quality</div>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} onClick={() => setQuality(i)} aria-label={`Quality ${i}`}>
                  <Star className={`h-7 w-7 transition ${i <= quality ? "text-maroon fill-maroon" : "text-muted hover:text-maroon/50"}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
