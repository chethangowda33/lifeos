import React, { useEffect, useState } from "react";
import api, { API_BASE } from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footprints, HeartPulse, Flame, Watch, Copy, Check, RefreshCw, Eye, EyeOff, Activity, Gauge, Droplets, Route } from "lucide-react";
import LoadError from "@/components/LoadError";

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}
      className="inline-flex items-center gap-1 text-xs text-maroon hover:underline shrink-0"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* The verified Shortcuts recipe, per metric. Each needs its own trio of actions;
   `stat` differs because summing a heart rate is meaningless. */
const RECIPE = [
  { metric: "steps", sample: "Steps", stat: "Sum" },
  { metric: "resting_hr", sample: "Resting Heart Rate", stat: "Average" },
  { metric: "hrv", sample: "Heart Rate Variability", stat: "Average" },
  { metric: "active_energy", sample: "Active Energy", stat: "Sum" },
  { metric: "distance_km", sample: "Walking + Running Distance", stat: "Sum" },
  { metric: "sleep_hours", sample: "Sleep Analysis", stat: "Sum", note: "in minutes — divide by 60 first" },
];

export default function Connections() {
  const [conn, setConn] = useState(null);
  const [daily, setDaily] = useState(null);
  const [sleepLogs, setSleepLogs] = useState([]);
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    try {
      const [c, d, sl] = await Promise.all([
        api.get("/health/connection"),
        api.get("/health/daily"),
        // Sleep lands in sleep_logs, not health_daily, so the checklist needs both.
        api.get("/sleep").catch(() => ({ data: { logs: [] } })),
      ]);
      setConn(c.data);
      setDaily(d.data);
      setSleepLogs(sl.data?.logs || []);
      setFailed(false);
    } catch {
      // A blank sync key reads as "you don't have one" — alarming, and it invites
      // a needless regenerate that would break a working automation.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const regenerate = async () => {
    if (!window.confirm("Generate a new key? Your old key stops working and any automation must be updated.")) return;
    const { data } = await api.post("/health/connection/regenerate");
    setConn((c) => ({ ...c, token: data.token }));
  };

  // API_BASE is absolute in local dev (http://host:8001/api) but relative in prod (/api via proxy).
  const apiRoot = /^https?:\/\//.test(API_BASE) ? API_BASE : `${window.location.origin}${API_BASE}`;
  const ingestUrl = `${apiRoot}/health/ingest`;
  // The /raw variant takes Shortcuts' output directly and sums it server-side.
  const rawUrl = (metric) => `${apiRoot}/health/ingest/raw?metric=${metric}`;
  const token = conn?.token || "";
  const masked = token ? token.slice(0, 4) + "•".repeat(Math.max(0, token.length - 8)) + token.slice(-4) : "";
  const today = daily?.today;

  /* Which metrics have EVER arrived. Wiring one shortcut per metric is the
     fiddliest thing in the app, and until now nothing told you which ones you
     had actually done — so the checklist closes itself. `days` is date-desc,
     so the first hit is the most recent. */
  const syncedOn = (metric) => {
    if (metric === "sleep_hours") return sleepLogs.find((l) => l.source === "sync")?.date || null;
    return (daily?.days || []).find((d) => d[metric] != null)?.date || null;
  };
  const connectedCount = RECIPE.filter((r) => syncedOn(r.metric)).length;

  // Core tiles always show; extended ones appear once that metric has synced.
  const TILES = [
    { key: "steps", label: "steps today", icon: Footprints, core: true, fmt: (v) => v.toLocaleString() },
    { key: "resting_hr", label: "resting HR", icon: HeartPulse, core: true },
    { key: "active_energy", label: "kcal active", icon: Flame, core: true, fmt: (v) => Math.round(v) },
    { key: "distance_km", label: "km distance", icon: Route, fmt: (v) => v.toFixed(1) },
    { key: "hrv", label: "HRV (ms)", icon: Activity, fmt: (v) => Math.round(v) },
    { key: "stress", label: "stress /100", icon: Gauge },
    { key: "spo2", label: "SpO₂ %", icon: Droplets, fmt: (v) => Math.round(v) },
  ];
  const tiles = TILES.filter((t) => t.core || today?.[t.key] != null);

  const sampleBody = `{
  "steps": 8432,
  "distance_km": 6.1,
  "resting_hr": 58,
  "hrv": 42,
  "stress": 34,
  "spo2": 98,
  "active_energy": 540,
  "sleep_hours": 7.2,
  "sleep_quality": 4
}`;

  const header = (
    <div>
      <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Sync</div>
      <h1 className="text-4xl font-semibold tracking-tight mt-1">Connections</h1>
      <p className="text-muted-foreground text-sm mt-1">Auto-import steps, heart rate, and sleep from your watch or phone.</p>
    </div>
  );

  // Bail before the key + tiles rather than rendering them blank.
  if (failed) {
    return (
      <div className="max-w-3xl space-y-6 animate-fade-up">
        {header}
        <LoadError what="your sync settings" onRetry={() => { setLoading(true); load(); }} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 animate-fade-up">
      {header}

      {/* Live status */}
      <div className="grid grid-cols-3 gap-3">
        {tiles.map(({ key, label, icon: Icon, fmt }) => {
          const val = today?.[key];
          return (
            <Card key={key} className="p-4">
              <Icon className="h-4 w-4 text-maroon mb-2" />
              <div className="text-2xl font-semibold tabular-nums">
                {loading ? "—" : (val != null ? (fmt ? fmt(val) : val) : "—")}
              </div>
              <div className="text-[11px] text-muted-foreground">{label}</div>
            </Card>
          );
        })}
      </div>

      {!loading && !daily?.connected && (
        <p className="text-xs text-muted-foreground -mt-2">No data synced yet — follow the setup below to start.</p>
      )}

      {/* Sync key */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Watch className="h-4 w-4 text-maroon" />
          <h3 className="font-semibold tracking-tight">Your sync key</h3>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">This is a password for your health data — keep it private. Paste it into your phone automation.</p>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Key</div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <code className="text-xs flex-1 truncate">{reveal ? token : masked}</code>
            <button onClick={() => setReveal((r) => !r)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Toggle key visibility">
              {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <CopyButton text={token} />
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Endpoint (POST)</div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <code className="text-xs flex-1 truncate">{ingestUrl}</code>
            <CopyButton text={ingestUrl} />
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={regenerate}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Regenerate key
        </Button>
      </Card>

      {/* Setup */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold tracking-tight">How to set it up</h3>
        <p className="text-sm text-muted-foreground">
          Any app that can make an HTTP request works — no matter your watch brand. Point it at the endpoint above,
          add the header <code className="text-xs text-foreground">X-Health-Token: your-key</code>, and send a JSON body like this:
        </p>
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <pre className="text-xs text-foreground overflow-x-auto"><code>{sampleBody}</code></pre>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <div className="font-medium flex items-center gap-1.5"><span className="text-maroon">Android</span> (any watch that syncs to Health Connect)</div>
            <p className="text-muted-foreground text-[13px] mt-0.5">
              Install <b>Macrodroid</b> or <b>Tasker</b> (free). Read steps/sleep from Health Connect, then add an
              “HTTP POST” action to the endpoint with the header + JSON above. Trigger it daily (e.g. 8 AM).
            </p>
          </div>
          <div>
            <div className="font-medium flex items-center gap-1.5">
              <span className="text-maroon">iPhone</span> — Shortcuts, verified recipe
            </div>
            <p className="text-muted-foreground text-[13px] mt-0.5">
              Automation → Time of Day → 11:30 PM, Daily, <b>Ask Before Running OFF</b>. Three actions,
              one set per metric:
            </p>
            <ol className="mt-2 space-y-1 text-[13px] text-muted-foreground list-decimal pl-4">
              <li><b className="text-foreground">Find Health Samples</b> — Type = the metric, Start Date <i>is today</i>, Limit off</li>
              <li><b className="text-foreground">Calculate Statistics</b> — the operation from the table below</li>
              <li>
                <b className="text-foreground">Get Contents of URL</b> — POST, header{" "}
                <code className="text-xs text-foreground">X-Health-Token</code>, Request Body ={" "}
                <b className="text-foreground">File</b> → pick the <b className="text-foreground">Sum</b>{" "}
                (or <b className="text-foreground">Average</b>) variable from step 2
              </li>
            </ol>

            <p className="text-[13px] mt-2 rounded-lg border border-[hsl(var(--maroon)/0.35)] bg-maroon/5 px-3 py-2">
              <b className="text-foreground">Post the Sum, never “Health Samples”.</b>{" "}
              <span className="text-muted-foreground">
                That variable serialises to the <i>number of samples</i>, not the total — it stores a
                small, believable, wrong number and reports success. Check your first run against the
                Health app before trusting it.
              </span>
            </p>
            <p className="text-muted-foreground text-[13px] mt-2">
              Run it once by hand with ▶ before relying on the schedule: a background automation can
              never show iOS&apos;s Health permission prompt, so a schedule-only shortcut fails silently
              forever. Add a <b>Quick Look</b> at the end while setting up to see the server&apos;s reply.
            </p>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Your metrics
              </div>
              <div className="text-[11px] text-muted-foreground">
                {loading ? "—" : `${connectedCount} of ${RECIPE.length} connected`}
              </div>
            </div>
            <div className="mt-1.5 space-y-1.5">
              {RECIPE.map((r) => {
                const on = syncedOn(r.metric);
                return (
                  <div
                    key={r.metric}
                    className={`rounded-lg border px-3 py-2 ${
                      on ? "border-border bg-muted/30" : "border-dashed border-border/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] min-w-0">
                        <b className="text-foreground">{r.sample}</b>
                        <span className="text-muted-foreground"> · {r.stat}</span>
                        {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
                      </div>
                      <CopyButton text={rawUrl(r.metric)} />
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <code className="text-[11px] text-muted-foreground break-all">{rawUrl(r.metric)}</code>
                      <span
                        className={`text-[11px] shrink-0 ${on ? "text-emerald-400" : "text-muted-foreground"}`}
                      >
                        {on ? `✓ last ${on}` : "not set up"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="font-medium flex items-center gap-1.5"><span className="text-maroon">Any platform</span></div>
            <p className="text-muted-foreground text-[13px] mt-0.5">
              Export apps like <b>Health Auto Export</b> (iOS) or your watch brand’s companion app (if it supports webhooks)
              can POST straight to the endpoint on a schedule.
            </p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Synced sleep shows on your Sleep page; steps and heart rate appear here. It’s scheduled sync (e.g. daily), not live.
        </p>
      </Card>
    </div>
  );
}
