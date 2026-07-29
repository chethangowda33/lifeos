import React, { useEffect, useState } from "react";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Flame, Check, Trash2, Minus, ListChecks } from "lucide-react";
import { sendOrQueue } from "@/lib/offlineQueue";
import localDate from "@/lib/localDate";
import LoadError from "@/components/LoadError";

const EMOJI_CHOICES = ["✅", "💧", "🏃", "📚", "🧘", "🥗", "💊", "😴", "🚭", "🧠", "☀️", "💪"];

// last 14 days as YYYY-MM-DD, oldest first
function last14() {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function Habits() {
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const days = last14();

  const load = async () => {
    try {
      const { data } = await api.get("/habits");
      setHabits(data || []);
      setFailed(false);
    } catch {
      // Without this the page fell through to its empty state and a failed
      // request looked exactly like "you have no habits".
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggleCheck = async (h) => {
    setHabits((arr) => arr.map((x) => (x.id === h.id ? { ...x, today_done: !x.today_done } : x))); // optimistic
    // Offline the tick is queued and the optimistic state stands — reloading here
    // would refetch the server's old value and silently undo the user's tap.
    const r = await sendOrQueue({
      url: `/habits/${h.id}/log`, body: { date: localDate() }, label: h.name,
    }).catch(() => null);
    if (r?.queued) return;
    load();
  };

  const setCount = async (h, value) => {
    const v = Math.max(0, value);
    setHabits((arr) => arr.map((x) => (x.id === h.id ? { ...x, today_value: v, today_done: v >= (x.target || 1) } : x)));
    const r = await sendOrQueue({
      url: `/habits/${h.id}/log`, body: { value: v, date: localDate() }, label: h.name,
    }).catch(() => null);
    if (r?.queued) return;
    load();
  };

  const remove = async (h) => {
    if (!window.confirm(`Delete habit "${h.name}"?`)) return;
    await api.delete(`/habits/${h.id}`);
    load();
  };

  return (
    <div className="max-w-3xl space-y-6 animate-fade-up">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Consistency</div>
          <h1 className="text-4xl font-semibold tracking-tight mt-1">Habits</h1>
          <p className="text-muted-foreground text-sm mt-1">Daily check-ins, streaks, and momentum.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
          <Plus className="h-4 w-4 mr-1.5" /> New habit
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : failed ? (
        <LoadError what="your habits" onRetry={() => { setLoading(true); load(); }} />
      ) : habits.length === 0 ? (
        <Card className="p-10 text-center border-dashed">
          <ListChecks className="h-9 w-9 mx-auto text-maroon" />
          <h3 className="mt-3 text-lg font-semibold">Build your first habit</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Small daily wins compound. Water, reading, steps — start with one.</p>
          <Button onClick={() => setDialogOpen(true)} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
            <Plus className="h-4 w-4 mr-1.5" /> New habit
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {habits.map((h) => (
            <Card key={h.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl shrink-0">{h.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{h.name}</span>
                    {h.streak > 0 && (
                      <Badge className="bg-[hsl(var(--maroon)/0.12)] text-maroon hover:bg-[hsl(var(--maroon)/0.12)] text-[10px]">
                        <Flame className="h-3 w-3 mr-0.5" /> {h.streak}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-0.5 mt-1.5">
                    {days.map((d) => (
                      <span
                        key={d}
                        title={d}
                        className={`h-2.5 w-2.5 rounded-[3px] transition-colors ${h.history?.[d] ? "bar-accent" : "bg-muted"}`}
                      />
                    ))}
                  </div>
                </div>

                {h.type === "count" ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setCount(h, (h.today_value || 0) - 1)}
                      aria-label={`Decrease ${h.name}`}
                      className="h-8 w-8 rounded-full border border-border flex items-center justify-center hover:bg-muted"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <div className="text-center w-12">
                      <div className="text-sm font-semibold tabular-nums">{h.today_value || 0}<span className="text-muted-foreground font-normal">/{h.target}</span></div>
                      {h.unit && <div className="text-[9px] text-muted-foreground">{h.unit}</div>}
                    </div>
                    <button
                      onClick={() => setCount(h, (h.today_value || 0) + 1)}
                      aria-label={`Increase ${h.name}`}
                      className="h-8 w-8 rounded-full border border-border flex items-center justify-center hover:bg-muted"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => toggleCheck(h)}
                    aria-label="Toggle habit"
                    className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 border transition-all duration-200 active:scale-90 ${
                      h.today_done ? "bg-gradient-to-br from-[hsl(var(--maroon))] to-[hsl(var(--maroon-hover))] border-transparent text-white elev-accent scale-105" : "border-border text-muted-foreground hover:border-[hsl(var(--maroon)/0.5)] hover:text-maroon"
                    }`}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                )}

                <button onClick={() => remove(h)} aria-label="Delete habit" className="text-muted-foreground/60 hover:text-destructive shrink-0 p-1">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <HabitDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={() => { setDialogOpen(false); load(); }} />
    </div>
  );
}

function HabitDialog({ open, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("✅");
  const [type, setType] = useState("check");
  const [target, setTarget] = useState(8);
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setEmoji("✅"); setType("check"); setTarget(8); setUnit(""); }
  }, [open]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post("/habits", {
        name, emoji, type,
        target: type === "count" ? Number(target) || 1 : null,
        unit: type === "count" ? unit : "",
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New habit</DialogTitle>
          <DialogDescription>A daily check-in or a target to hit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Drink water" autoFocus />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Icon</div>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`h-9 w-9 rounded-lg text-lg flex items-center justify-center border transition ${emoji === e ? "border-maroon bg-[hsl(var(--maroon)/0.1)]" : "border-border hover:bg-muted"}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Type</div>
            <div className="flex gap-2">
              {[["check", "Simple check"], ["count", "Hit a target"]].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setType(k)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${type === k ? "bg-maroon text-white border-transparent" : "border-border text-muted-foreground hover:border-[hsl(var(--maroon)/0.5)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {type === "count" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Daily target</div>
                <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} min={1} />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Unit</div>
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="glasses" />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !name.trim()} onClick={save} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
            {saving ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
