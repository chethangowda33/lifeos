import React, { useEffect, useState } from "react";
import api, { API_BASE } from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footprints, HeartPulse, Flame, Watch, Copy, Check, RefreshCw, Eye, EyeOff } from "lucide-react";

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

export default function Connections() {
  const [conn, setConn] = useState(null);
  const [daily, setDaily] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [c, d] = await Promise.all([api.get("/health/connection"), api.get("/health/daily")]);
      setConn(c.data);
      setDaily(d.data);
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
  const ingestUrl = /^https?:\/\//.test(API_BASE)
    ? `${API_BASE}/health/ingest`
    : `${window.location.origin}${API_BASE}/health/ingest`;
  const token = conn?.token || "";
  const masked = token ? token.slice(0, 4) + "•".repeat(Math.max(0, token.length - 8)) + token.slice(-4) : "";
  const today = daily?.today;

  const sampleBody = `{
  "steps": 8432,
  "resting_hr": 58,
  "sleep_hours": 7.2,
  "sleep_quality": 4
}`;

  return (
    <div className="max-w-3xl space-y-6 animate-fade-up">
      <div>
        <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Sync</div>
        <h1 className="text-4xl font-semibold tracking-tight mt-1">Connections</h1>
        <p className="text-muted-foreground text-sm mt-1">Auto-import steps, heart rate, and sleep from your watch or phone.</p>
      </div>

      {/* Live status */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <Footprints className="h-4 w-4 text-maroon mb-2" />
          <div className="text-2xl font-semibold tabular-nums">{loading ? "—" : (today?.steps?.toLocaleString() ?? "—")}</div>
          <div className="text-[11px] text-muted-foreground">steps today</div>
        </Card>
        <Card className="p-4">
          <HeartPulse className="h-4 w-4 text-maroon mb-2" />
          <div className="text-2xl font-semibold tabular-nums">{loading ? "—" : (today?.resting_hr ?? "—")}</div>
          <div className="text-[11px] text-muted-foreground">resting HR</div>
        </Card>
        <Card className="p-4">
          <Flame className="h-4 w-4 text-maroon mb-2" />
          <div className="text-2xl font-semibold tabular-nums">{loading ? "—" : (today?.active_energy != null ? Math.round(today.active_energy) : "—")}</div>
          <div className="text-[11px] text-muted-foreground">kcal active</div>
        </Card>
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
            <div className="font-medium flex items-center gap-1.5"><span className="text-maroon">iPhone</span></div>
            <p className="text-muted-foreground text-[13px] mt-0.5">
              Use the <b>Shortcuts</b> app: “Get Health Sample” for steps/sleep → “Get Contents of URL” (POST) with the
              header + JSON. Add a Personal Automation to run each morning.
            </p>
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
