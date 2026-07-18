/* Single source of truth for workout maths.
 *
 * Volume/sets used to be recomputed inline in the session header, the save
 * dialog and the summary. When those drifted (or relied on JS string coercion
 * for "20" * "10") the screens disagreed and volume could read 0 while sets
 * read 15. One implementation, explicitly numeric, used everywhere.
 *
 * Mirrors the backend: only COMPLETED sets count toward volume and sets.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Volume for one set (kg × reps). 0 for bodyweight/blank. */
export function setVolume(s) {
  return num(s?.kg) * num(s?.reps);
}

/**
 * Aggregate a live/edited session.
 * @returns {{ sets:number, volume:number, totalSets:number }}
 *   sets = completed sets, totalSets = every set incl. unfinished.
 */
export function sessionStats(exercises = []) {
  let sets = 0;
  let totalSets = 0;
  let volume = 0;
  for (const ex of exercises) {
    for (const s of ex?.sets || []) {
      totalSets += 1;
      if (s.completed) {
        sets += 1;
        volume += setVolume(s);
      }
    }
  }
  return { sets, totalSets, volume };
}

/** Estimated 1RM (Epley) — matches the backend's _epley. */
export function epley(kg, reps) {
  const w = num(kg);
  const r = num(reps);
  if (!w || !r) return 0;
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

/** "1,234" / "12.3k" for compact stat display. */
export function fmtVolume(v) {
  const n = Math.round(num(v));
  return n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : n.toLocaleString();
}
