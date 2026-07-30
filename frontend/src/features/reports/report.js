/* Pure helpers for the Reports page.

   The report's numbers are computed by the backend (GET /reports) — everything
   here is presentation: how a period compares to the one before it, how wide a
   bar is, and how old a cached narrative is. Kept out of the component so the
   awkward cases (no previous period, a max of zero) are unit-tested rather than
   discovered on screen. */

export const PERIODS = [
  { key: "week", label: "Week", noun: "week" },
  { key: "month", label: "Month", noun: "month" },
];

/* Change vs the previous period.

   Returns null when there is nothing worth saying (both zero) and a null `pct`
   when the previous period was empty — "+100%" against a week you didn't train
   is noise dressed up as insight. */
export function delta(now, prev) {
  const a = Number(now) || 0;
  const b = Number(prev) || 0;
  if (!a && !b) return null;
  if (!b) return { dir: "up", pct: null };
  const pct = Math.round(((a - b) / b) * 100);
  return { dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct: Math.abs(pct) };
}

/* Bar width as a share of the row with the largest value. */
export function barPct(value, max) {
  const v = Number(value) || 0;
  const m = Number(max) || 0;
  if (m <= 0 || v <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((v / m) * 100)));
}

/* Age of a cached narrative — it is stamped with when it was written, so a
   report read a week later doesn't look freshly considered. */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* Sleep read as a word, using the same 7.5h ideal the Life Score scores against. */
export function sleepVerdict(hours) {
  if (hours == null) return null;
  if (hours < 6) return "short";
  if (hours < 7) return "a little short";
  if (hours <= 9) return "on target";
  return "long";
}
