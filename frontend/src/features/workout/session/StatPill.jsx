import React from "react";

/* Small stat readouts used in the session header and post-workout summary. */
export function StatPill({ label, value, accent, testId }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${accent ? "bg-maroon text-white" : "bg-muted"}`}>
      <div className={`text-[10px] uppercase tracking-widest ${accent ? "text-white/80" : "text-muted-foreground"}`}>{label}</div>
      <div data-testid={testId} className="text-base font-semibold">{value}</div>
    </div>
  );
}

export function MiniStat({ label, value }) {
  return (
    <div className="rounded-md bg-muted py-2 px-1">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
