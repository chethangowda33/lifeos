import React, { useCallback, useEffect, useState } from "react";
import {
  Dumbbell, Weight, Clock, Trophy, Flame, Moon, Footprints, Apple, CalendarCheck, Lock,
} from "lucide-react";

import api from "@/api";
import { Card } from "@/components/ui/card";
import LoadError from "@/components/LoadError";
import { progressLabel, groupAchievements, unlockedOn } from "@/features/achievements/achievements";
import { ACHIEVEMENTS } from "@/constants/testIds";

const ICONS = {
  dumbbell: Dumbbell, weight: Weight, clock: Clock, trophy: Trophy, flame: Flame,
  moon: Moon, footprints: Footprints, apple: Apple, calendar: CalendarCheck,
};

/* The badge wall.

   Everything here is derived from data already logged — nothing to tick off, no
   second thing to track. Locked badges show their progress rather than hiding
   behind a padlock: "13 of 25 workouts" is the half that motivates. */
export default function Achievements() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get("/achievements");
      setData(d);
      setFailed(false);
      // Seen once it is on screen — but the response already in hand keeps its
      // "New" flags, so this render still celebrates what was just earned.
      if (d.new_count) api.post("/achievements/seen").catch(() => {});
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const header = (
    <div>
      <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Earned</div>
      <h1 className="text-4xl font-semibold tracking-tight mt-1">Achievements</h1>
      <p className="text-muted-foreground mt-1">
        Milestones from what you already log — nothing extra to track.
      </p>
    </div>
  );

  if (failed) {
    return (
      <div className="space-y-6 animate-fade-up" data-testid={ACHIEVEMENTS.root}>
        {header}
        <LoadError onRetry={load} what="your achievements" />
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="space-y-6 animate-fade-up" data-testid={ACHIEVEMENTS.root}>
        {header}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Card key={i} className="p-4 h-24 animate-pulse bg-muted/40" />)}
        </div>
      </div>
    );
  }

  const sections = groupAchievements(data.achievements, data.groups);
  const pct = data.total ? Math.round((data.unlocked_count / data.total) * 100) : 0;

  return (
    <div className="space-y-6 animate-fade-up" data-testid={ACHIEVEMENTS.root}>
      {header}

      <Card className="p-5" data-testid={ACHIEVEMENTS.summary}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-2xl font-semibold tracking-tight">
            {data.unlocked_count}
            <span className="text-muted-foreground text-base font-normal"> of {data.total} unlocked</span>
          </div>
          {data.new_count > 0 && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full bg-maroon text-white"
              data-testid={ACHIEVEMENTS.newCount}
            >
              {data.new_count} new
            </span>
          )}
        </div>
        <div className="h-2 rounded-full bg-muted mt-3 overflow-hidden">
          <div className="h-full rounded-full bg-maroon transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      {data.next_up.length > 0 && (
        <Card className="p-5" data-testid={ACHIEVEMENTS.nextUp}>
          <h3 className="font-semibold tracking-tight mb-4">Closest to unlocking</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {data.next_up.map((a) => (
              <div key={a.key}>
                <div className="text-sm font-medium truncate">{a.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{a.description}</div>
                <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
                  <div className="h-full rounded-full bg-maroon" style={{ width: `${Math.round(a.progress * 100)}%` }} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">{progressLabel(a)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {sections.map(({ group, items }) => (
        <div key={group} data-testid={ACHIEVEMENTS.section(group)}>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {group}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((a) => <Badge key={a.key} a={a} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Badge({ a }) {
  const Icon = ICONS[a.icon] || Trophy;
  return (
    <Card
      className={`p-4 flex gap-3 ${a.unlocked ? "border-maroon/40" : ""}`}
      data-testid={ACHIEVEMENTS.badge(a.key)}
      data-unlocked={a.unlocked ? "true" : "false"}
    >
      <div
        className={`h-10 w-10 rounded-xl shrink-0 grid place-items-center ${
          a.unlocked ? "bg-maroon text-white" : "bg-muted text-muted-foreground"
        }`}
        aria-hidden="true"
      >
        {a.unlocked ? <Icon className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${a.unlocked ? "" : "text-muted-foreground"}`}>
            {a.name}
          </span>
          {a.new && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-maroon text-white shrink-0">New</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">{a.description}</p>
        {a.unlocked ? (
          <p className="text-[11px] text-maroon mt-1.5">Earned {unlockedOn(a.unlocked_at)}</p>
        ) : (
          <>
            <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
              <div className="h-full rounded-full bg-maroon/60" style={{ width: `${Math.round(a.progress * 100)}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{progressLabel(a)}</p>
          </>
        )}
      </div>
    </Card>
  );
}
