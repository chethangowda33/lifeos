import React, { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { WORKOUT } from "@/constants/testIds";

/* Should I train today?

   Lives on the Workout page, directly above the "next up" hero, because this is
   a DECISION, not a status — and the decision and the button you press to act on
   it have to be in the same glance. It started life on the dashboard, which meant
   the app could say "chest is over MRV, train legs" on one screen while offering
   you Push Day A on another, with neither referencing the other.

   The card shows its own working: every reason carries the points it cost, so a
   verdict you disagree with points at a threshold, not at a black box. Same rule
   as the reports narrative — no figure without the number beside it.

   Self-fetching, like the dashboard's WeeklyRecap: it owns one endpoint and
   renders nothing at all if that endpoint fails, so it can be dropped onto any
   page without touching that page's load orchestration. */

const pad = (n) => String(n).padStart(2, "0");
// Send OUR local day — sleep is stored against it, and the server's UTC default
// would read the wrong night east of UTC before ~06:00.
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const tone = (n) => (n >= 70 ? "text-emerald-400" : n >= 40 ? "text-amber-400" : "text-maroon");

export default function ReadinessCard() {
  const [readiness, setReadiness] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .get("/readiness", { params: { date: localKey(new Date()) } })
      .then(({ data }) => { if (alive) setReadiness(data); })
      .catch(() => { /* the card simply doesn't appear */ });
    return () => { alive = false; };
  }, []);

  if (!readiness) return null;

  if (readiness.has_data === false) {
    return (
      <Card data-testid={WORKOUT.readiness} className="p-5">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <Gauge className="h-4 w-4 text-maroon" /> Should I train today?
        </h3>
        <p className="text-sm text-muted-foreground mt-2">
          Log a workout or a night&apos;s sleep and this will start answering — recovery,
          weekly volume and sleep, combined into one call.
        </p>
      </Card>
    );
  }

  return (
    <Card data-testid={WORKOUT.readiness} className="p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <Gauge className="h-4 w-4 text-maroon" /> Should I train today?
        </h3>
        <span className={`text-sm font-semibold ${tone(readiness.score)}`}>
          {readiness.score}<span className="text-[11px] text-muted-foreground font-normal">/100</span>
        </span>
      </div>

      <p className={`text-xl font-semibold tracking-tight ${tone(readiness.score)}`}>
        {readiness.headline}
      </p>

      {readiness.train?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {readiness.train.map((m) => (
            <span key={m} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-[11px] capitalize">
              {m}
            </span>
          ))}
        </div>
      )}
      {readiness.avoid?.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Go easy on: <span className="capitalize">{readiness.avoid.join(" · ")}</span>
        </p>
      )}

      {readiness.reasons?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border space-y-1.5">
          {readiness.reasons.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 text-xs">
              <span
                className={`font-mono shrink-0 w-8 text-right ${
                  r.effect < 0 ? "text-maroon" : "text-emerald-400"
                }`}
              >
                {r.effect > 0 ? `+${r.effect}` : r.effect}
              </span>
              <span className="text-muted-foreground leading-snug">{r.text}</span>
            </div>
          ))}
        </div>
      )}
      {readiness.reasons?.length === 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Nothing is holding you back — recovered, under your weekly ceiling, and rested.
        </p>
      )}
    </Card>
  );
}
