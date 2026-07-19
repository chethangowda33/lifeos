/* Shared time/label formatting for the workout feature.
 * Lived inside WorkoutSession.jsx; extracted so the session sub-components
 * (SetRow, RestTimer, ExerciseCard) can be split out without duplicating them.
 */

/** 3725 -> "1h 2m", 125 -> "2m 5s", 9 -> "9s" */
export function fmtDuration(secs) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

/** 125 -> "02:05" — countdown/stopwatch display. */
export function fmtClock(secs) {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** ISO -> "just now" / "5m ago" / "3d ago" */
export function fmtRelative(iso) {
  if (!iso) return "just now";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
