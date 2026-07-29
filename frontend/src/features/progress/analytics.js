/* Progress analytics — pure functions over workout history.
 *
 * All of it is derived client-side from GET /workouts, which already returns the
 * full session documents (sets carry kg/reps/e1rm, exercises carry muscle_group).
 * Keeping it pure means the charts have no logic of their own and every number
 * below is unit-testable without a browser.
 */

export const RANGES = [
  { key: "4w", label: "4W", days: 28 },
  { key: "12w", label: "12W", days: 84 },
  { key: "6m", label: "6M", days: 182 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "All", days: null },
];

const DAY = 86400000;

export function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x;
}

/** Sessions inside the range. `days: null` means everything. */
export function filterByRange(workouts, days) {
  if (!days) return [...(workouts || [])];
  const cutoff = Date.now() - days * DAY;
  return (workouts || []).filter((w) => new Date(w.created_at).getTime() >= cutoff);
}

/* Bucket width follows the range: weekly stays readable up to ~12 weeks, beyond
   that a year would be 52 columns of noise, so switch to months. */
export function bucketMode(days) {
  return days === null || days > 120 ? "month" : "week";
}

/**
 * Volume / sessions / duration per bucket across the whole range, including
 * empty buckets — a gap in training is information, so it must occupy space
 * rather than being collapsed away.
 */
export function timeSeries(workouts, days) {
  const mode = bucketMode(days);
  const startOf = mode === "month" ? startOfMonth : startOfWeek;
  const now = new Date();

  // Anchor the first bucket on the range, or on the oldest session for "All".
  let first;
  if (days) {
    first = startOf(new Date(Date.now() - days * DAY));
  } else {
    const oldest = (workouts || []).reduce(
      (min, w) => Math.min(min, new Date(w.created_at).getTime()),
      Date.now(),
    );
    first = startOf(new Date(oldest));
  }

  const buckets = [];
  const cursor = new Date(first);
  const guard = 400; // never loop away on a bad date
  while (cursor <= now && buckets.length < guard) {
    buckets.push({
      t: cursor.getTime(),
      label: mode === "month"
        ? cursor.toLocaleDateString(undefined, { month: "short" })
        : cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      volume: 0,
      sessions: 0,
      duration: 0,
    });
    if (mode === "month") cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + 7);
  }

  const byT = new Map(buckets.map((b) => [b.t, b]));
  (workouts || []).forEach((w) => {
    const b = byT.get(startOf(new Date(w.created_at)).getTime());
    if (!b) return;
    b.volume += w.total_volume_kg || 0;
    b.sessions += 1;
    b.duration += w.duration_seconds || 0;
  });

  return buckets.map((b) => ({
    ...b,
    volume: Math.round(b.volume),
    minutes: Math.round(b.duration / 60),
  }));
}

/** Every exercise the user has actually trained, most-trained first. */
export function exerciseOptions(workouts) {
  const byId = new Map();
  (workouts || []).forEach((w) => {
    (w.exercises || []).forEach((ex) => {
      if (!ex.exercise_id || !ex.name) return;
      const cur = byId.get(ex.exercise_id) || { id: ex.exercise_id, name: ex.name, sessions: 0 };
      cur.sessions += 1;
      byId.set(ex.exercise_id, cur);
    });
  });
  return [...byId.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

/**
 * Estimated 1RM per DAY for one exercise, oldest → newest.
 *
 * Grouped by day, not by session: training the same lift twice in a day is
 * normal, and plotting each session separately produced several points sharing
 * one x-label ("Jul 2, Jul 2, Jul 2…"), which reads as a broken axis. The day's
 * best working set is also the honest answer to "how strong was I then".
 * Warm-ups are excluded — they would drag the line down and misstate the day.
 */
export function strengthSeries(workouts, exerciseId) {
  if (!exerciseId) return [];
  const byDay = new Map();

  (workouts || []).forEach((w) => {
    const ex = (w.exercises || []).find((e) => e.exercise_id === exerciseId);
    if (!ex) return;
    const working = (ex.sets || []).filter((s) => s.completed && s.set_type !== "warmup");
    if (!working.length) return;

    const top = working.reduce((m, s) => ((s.e1rm || 0) > (m?.e1rm || 0) ? s : m), null);
    if (!top || !(top.e1rm > 0)) return;

    const d = new Date(w.created_at);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    const cur = byDay.get(key);
    if (!cur || top.e1rm > cur.e1rm) {
      byDay.set(key, {
        t: key,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        e1rm: Math.round(top.e1rm * 10) / 10,
        topSet: top,
      });
    }
  });

  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

/** Working-set volume per muscle group across the range, biggest first. */
export function muscleTotals(workouts) {
  const by = new Map();
  (workouts || []).forEach((w) => {
    (w.exercises || []).forEach((ex) => {
      const g = ex.muscle_group;
      if (!g) return;
      const cur = by.get(g) || { muscle: g, volume: 0, sets: 0 };
      (ex.sets || []).forEach((s) => {
        if (!s.completed || s.set_type === "warmup") return;
        cur.volume += (s.kg || 0) * (s.reps || 0);
        cur.sets += 1;
      });
      by.set(g, cur);
    });
  });
  return [...by.values()]
    .filter((m) => m.sets > 0)
    .map((m) => ({ ...m, volume: Math.round(m.volume) }))
    .sort((a, b) => b.volume - a.volume);
}

/** Headline numbers for the range — the KPI row and the report. */
export function summary(workouts, days) {
  const list = workouts || [];
  const sessions = list.length;
  const volume = list.reduce((n, w) => n + (w.total_volume_kg || 0), 0);
  const sets = list.reduce((n, w) => n + (w.completed_sets || 0), 0);
  const duration = list.reduce((n, w) => n + (w.duration_seconds || 0), 0);

  const buckets = timeSeries(list, days);
  const active = buckets.filter((b) => b.sessions > 0).length;
  const best = buckets.reduce((m, b) => (b.volume > (m?.volume ?? -1) ? b : m), null);

  return {
    sessions,
    volume: Math.round(volume),
    sets,
    duration,
    avgVolume: sessions ? Math.round(volume / sessions) : 0,
    avgDuration: sessions ? Math.round(duration / sessions) : 0,
    avgSets: sessions ? Math.round((sets / sessions) * 10) / 10 : 0,
    // Share of buckets in the range that contain at least one session — "did you
    // show up", which is a fairer read of consistency than raw session count.
    consistency: buckets.length ? Math.round((active / buckets.length) * 100) : 0,
    activeBuckets: active,
    totalBuckets: buckets.length,
    bucketMode: bucketMode(days),
    bestBucket: best && best.volume > 0 ? best : null,
  };
}

/** Compact number for stat tiles: 1284 → 1.3k, 1284000 → 1.3M. */
export function compact(n) {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(v);
}

export function fmtDuration(secs) {
  const s = Math.round(secs || 0);
  if (!s) return "0m";
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}
