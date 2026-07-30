/* Pure helpers for the Achievements page.

   The badge state itself is computed by the backend (GET /achievements) — this
   is the part that turns "36000 seconds" into something a person reads, and
   orders the wall. Kept separate so the unit handling is unit-tested; getting it
   wrong shows a lifter "6495 / 10000" where they expect "6.5k / 10k kg". */
import { compact, fmtDuration } from "@/features/progress/analytics";

/* "How far along am I", in the metric's own units. */
export function progressLabel({ metric, value, target } = {}) {
  const v = Number(value) || 0;
  const t = Number(target) || 0;
  if (metric === "volume_kg") return `${compact(v)} / ${compact(t)} kg`;
  if (metric === "duration_seconds") return `${fmtDuration(v)} / ${fmtDuration(t)}`;
  if (metric === "best_steps") return `${compact(v)} / ${compact(t)} steps`;
  return `${Math.round(v)} / ${Math.round(t)}`;
}

/* Badges in their catalogue groups, unlocked first within each.

   `groups` comes from the server so the section order is the catalogue's, not
   whatever order the achievements happen to arrive in. */
export function groupAchievements(achievements = [], groups = []) {
  const order = groups.length
    ? groups
    : [...new Set(achievements.map((a) => a.group))];
  return order
    .map((group) => ({
      group,
      items: achievements
        .filter((a) => a.group === group)
        .sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0) || b.progress - a.progress),
    }))
    .filter((s) => s.items.length);
}

/* The date a badge was earned, written out. Relative time ("3d ago") is right
   for something you just did; a badge is a landmark and keeps its date. */
export function unlockedOn(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
