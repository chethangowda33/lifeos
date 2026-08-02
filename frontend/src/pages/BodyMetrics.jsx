import React, { useEffect, useState } from "react";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceArea,
} from "recharts";
import { Plus, Pencil, RotateCcw, Eraser } from "lucide-react";
import { BODY_METRICS, BODY_METRICS_V2 } from "@/constants/testIds";
import LoadError from "@/components/LoadError";

export default function BodyMetrics() {
  const { user, updateProfile } = useAuth();
  const [defs, setDefs] = useState({});
  const [latest, setLatest] = useState({});
  const [history, setHistory] = useState({}); // metric -> array
  const [profileOpen, setProfileOpen] = useState(false);

  const [logOpen, setLogOpen] = useState(false);
  const [logMetric, setLogMetric] = useState(null);
  const [logValue, setLogValue] = useState("");

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = async () => {
    try {
      const [d, l] = await Promise.all([
        api.get("/body-metrics/definitions"),
        api.get("/body-metrics/latest"),
      ]);
      setDefs(d.data);
      setLatest(l.data);
      // Histories are per-metric sparklines. One failing must not blank the whole
      // page, so they settle independently of the cards above.
      const keys = Object.keys(d.data).filter((k) => !d.data[k].auto);
      const hists = await Promise.all(
        keys.map((k) => api.get(`/body-metrics/history/${k}`)
          .then((r) => [k, r.data])
          .catch(() => [k, []])),
      );
      setHistory(Object.fromEntries(hists));
      setFailed(false);
    } catch {
      // Previously an unhandled rejection: the page rendered with no cards at all.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const openLog = (metric) => {
    setLogMetric(metric);
    setLogValue("");
    setLogOpen(true);
  };

  const submitLog = async () => {
    const v = parseFloat(logValue);
    if (Number.isNaN(v)) return;
    await api.post("/body-metrics", { metric: logMetric, value: v });
    setLogOpen(false);
    await refresh();
  };

  return (
    <div data-testid={BODY_METRICS.root} className="max-w-6xl space-y-6 animate-fade-up">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Composition</div>
          <h1 className="text-4xl font-semibold tracking-tight mt-1">Body Metrics</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Enter age + height + weight and every metric auto-predicts. Log a real reading any time to override an estimate and build a trend.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            data-testid={BODY_METRICS_V2.refreshButton}
            variant="outline"
            onClick={refresh}
            title="Recompute estimates from profile"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => setProfileOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            Profile (age, height, weight)
          </Button>
        </div>
      </div>

      {/* Inline profile summary banner */}
      <ProfileBanner user={user} onEdit={() => setProfileOpen(true)} />

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {failed && !loading && (
        <LoadError what="your body metrics" onRetry={() => { setLoading(true); refresh(); }} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(defs).map(([key, def]) => (
          <MetricCard
            key={key}
            metricKey={key}
            def={def}
            latest={latest[key]}
            history={history[key] || []}
            onAdd={() => openLog(key)}
            onClearLog={async () => {
              if (!window.confirm(`Remove your logged ${def.label} values? It will revert to the predicted estimate.`)) return;
              await api.delete(`/body-metrics/${key}`);
              await refresh();
            }}
          />
        ))}
      </div>

      {/* Account — this page already owns the profile, and it was the only
          place a "your account" section could sensibly live. Until now there
          was no way to change a password anywhere in the app at all. */}
      <ChangePassword />

      <ProfileDialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        onSaved={async (p) => { await updateProfile(p); setProfileOpen(false); await refresh(); }}
      />

      <Dialog open={logOpen} onOpenChange={(o) => !o && setLogOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Log {logMetric && defs[logMetric]?.label}
            </DialogTitle>
            <DialogDescription>
              {logMetric && `Ideal range: ${defs[logMetric]?.ideal_min}–${defs[logMetric]?.ideal_max} ${defs[logMetric]?.unit}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="logval">Value ({logMetric && defs[logMetric]?.unit})</Label>
            <Input
              id="logval"
              type="number"
              step="0.1"
              data-testid={BODY_METRICS.valueInput}
              value={logValue}
              onChange={(e) => setLogValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLogOpen(false)}>Cancel</Button>
            <Button data-testid={BODY_METRICS.submitButton} onClick={submitLog} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ metricKey, def, latest, history, onAdd, onClearLog }) {
  const v = latest?.value;
  const isEstimated = latest?.source === "estimated";
  const isAuto = def.auto;
  const inRange = v != null && v >= def.ideal_min && v <= def.ideal_max;
  const status = v == null || v === 0
    ? null
    : inRange ? "in-range" : (v < def.ideal_min ? "low" : "high");

  // Build chart data
  const chartData = history.map((h, i) => ({
    i,
    value: h.value,
    date: new Date(h.recorded_at).toLocaleDateString(),
  }));

  return (
    <Card data-testid={BODY_METRICS.card} className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{def.label}</div>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            <div className="text-3xl font-semibold tracking-tight">
              {v != null && v !== 0 ? v : "—"}
            </div>
            <div className="text-xs text-muted-foreground">{def.unit}</div>
          </div>
        </div>
        {!isAuto && (
          <div className="flex flex-col gap-1">
            <Button
              data-testid={BODY_METRICS.addButton}
              size="sm"
              variant="outline"
              onClick={onAdd}
              className="h-8"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Log
            </Button>
            {latest?.source === "manual" && onClearLog && (
              <Button
                data-testid={BODY_METRICS_V2.clearLogButton}
                size="sm"
                variant="ghost"
                onClick={onClearLog}
                className="h-7 text-[10px] text-muted-foreground hover:text-destructive"
                title="Clear log → revert to estimate"
              >
                <Eraser className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <Badge variant="outline" className="text-[10px]">
          Ideal {def.ideal_min}–{def.ideal_max} {def.unit}
        </Badge>
        {status && (
          <Badge className={`text-[10px] ${
            status === "in-range"
              ? "bg-green-600/15 text-green-700 dark:text-green-400 hover:bg-green-600/15"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15"
          }`}>
            {status === "in-range" ? "In range" : status === "low" ? "Below ideal" : "Above ideal"}
          </Badge>
        )}
        {isAuto && <Badge variant="secondary" className="text-[10px]">Auto</Badge>}
        {isEstimated && !isAuto && (
          <Badge variant="secondary" className="text-[10px]">Estimated</Badge>
        )}
        {latest?.source === "manual" && (
          <Badge className="text-[10px] bg-maroon text-white hover:bg-maroon">Logged</Badge>
        )}
      </div>

      {/* Mini chart */}
      <div className="h-20 mt-4 min-w-[120px]">
        {chartData.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={120} minHeight={60}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <ReferenceArea y1={def.ideal_min} y2={def.ideal_max} fill="hsl(var(--maroon))" fillOpacity={0.06} />
              <XAxis dataKey="i" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "hsl(var(--popover-foreground))",
                }}
                labelFormatter={(_, p) => p?.[0]?.payload?.date || ""}
                formatter={(val) => [`${val} ${def.unit}`, def.label]}
              />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--maroon))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
            {isAuto
              ? "Edit profile to update"
              : isEstimated
                ? "Estimated from your profile — log to track real trend"
                : "Log at least 2 values to see trend"}
          </div>
        )}
      </div>
    </Card>
  );
}

function ProfileDialog({ open, onClose, user, onSaved }) {
  const p = user?.profile || {};
  const [age, setAge] = useState(p.age || "");
  const [height, setHeight] = useState(p.height_cm || "");
  const [weight, setWeight] = useState(p.weight_kg || "");
  const [sex, setSex] = useState(p.sex || "male");

  useEffect(() => {
    if (open) {
      const pp = user?.profile || {};
      setAge(pp.age || ""); setHeight(pp.height_cm || "");
      setWeight(pp.weight_kg || ""); setSex(pp.sex || "male");
    }
  }, [open, user]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Profile</DialogTitle>
          <DialogDescription>Powers your BMI and BMR auto-calculations.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="age">Age</Label>
            <Input id="age" type="number" value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sex">Sex</Label>
            <select
              id="sex"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={sex}
              onChange={(e) => setSex(e.target.value)}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div>
            <Label htmlFor="height">Height (cm)</Label>
            <Input id="height" type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="weight">Weight (kg)</Label>
            <Input id="weight" type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            onClick={() => onSaved({
              age: age ? Number(age) : null,
              height_cm: height ? Number(height) : null,
              weight_kg: weight ? Number(weight) : null,
              sex,
            })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Change your own password. Requires the current one, so a borrowed session
   can't lock the owner out. Note there is no session revocation in this app:
   changing the password stops NEW logins with the old one, it does not sign
   other devices out — so the copy says exactly that rather than implying it. */
function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setError(""); setDone(false); };

  // Returns whether it worked, so the caller can close the dialog only on
  // success — leaving it open with cleared fields reads as "nothing happened".
  const save = async () => {
    setError("");
    if (next.length < 6) { setError("New password must be at least 6 characters."); return false; }
    if (next !== confirm) { setError("The two new passwords don't match."); return false; }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      setCurrent(""); setNext(""); setConfirm("");
      setDone(true);
      return true;
    } catch (e) {
      setError(e?.response?.data?.detail || "Couldn't change your password — try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold tracking-tight">Password</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {done ? "Password changed. Other signed-in devices stay signed in until their session expires."
                  : "Change the password you sign in with."}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { reset(); setOpen(true); }}>Change</Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); reset(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              You&apos;ll need your current password. Devices already signed in stay signed in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">Current password</Label>
              <Input type="password" value={current} autoComplete="current-password"
                     onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">New password</Label>
              <Input type="password" value={next} autoComplete="new-password"
                     onChange={(e) => setNext(e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">Confirm new password</Label>
              <Input type="password" value={confirm} autoComplete="new-password"
                     onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && <p className="text-xs text-maroon">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button
              disabled={saving || !current || !next || !confirm}
              onClick={async () => { if (await save()) setOpen(false); }}
              className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            >
              {saving ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ProfileBanner({ user, onEdit }) {
  const p = user?.profile || {};
  const filled = Boolean(p.age && p.height_cm && p.weight_kg);
  if (!filled) {
    return (
      <Card className="p-4 border-maroon/30 bg-maroon/5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-maroon">Add your age, height & weight to predict everything</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Until you do, only the metrics you log will show real values.
          </div>
        </div>
        <Button onClick={onEdit} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
          <Pencil className="h-4 w-4 mr-2" /> Set Profile
        </Button>
      </Card>
    );
  }
  return (
    <Card className="p-4 flex items-center gap-4 flex-wrap">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Profile</div>
      <div className="flex gap-4 text-sm">
        <span><b>{p.age}</b> <span className="text-muted-foreground">yrs</span></span>
        <span><b>{p.height_cm}</b> <span className="text-muted-foreground">cm</span></span>
        <span><b>{p.weight_kg}</b> <span className="text-muted-foreground">kg</span></span>
        <span className="capitalize"><b>{p.sex}</b></span>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit} className="ml-auto">
        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
      </Button>
    </Card>
  );
}
