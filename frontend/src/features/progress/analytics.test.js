import {
  RANGES, filterByRange, bucketMode, timeSeries, strengthSeries,
  muscleTotals, exerciseOptions, summary, compact, fmtDuration,
} from "./analytics";

/* Fixed "now" so week/month bucketing is deterministic. 2026-07-30 is a Thursday,
   so the current week starts Mon 2026-07-27.
   setSystemTime (not a Date.now spy) because the module also calls `new Date()`
   directly — spying on the static alone left the two disagreeing. */
beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(new Date("2026-07-30T12:00:00Z"));
});
afterAll(() => jest.useRealTimers());

const iso = (d) => new Date(d).toISOString();

/** A session. `sets` entries default to a completed working set. */
const session = (date, { volume = 100, duration = 600, sets = 1, exercises = [] } = {}) => ({
  created_at: iso(date),
  total_volume_kg: volume,
  duration_seconds: duration,
  completed_sets: sets,
  exercises,
});

const ex = (id, name, muscle, sets) => ({
  exercise_id: id, name, muscle_group: muscle, sets,
});
const set = (kg, reps, e1rm, { completed = true, type = "working" } = {}) => ({
  kg, reps, e1rm, completed, set_type: type,
});

describe("filterByRange", () => {
  const ws = [
    session("2026-07-29T10:00:00Z"),  // 1 day ago
    session("2026-07-01T10:00:00Z"),  // 29 days ago
    session("2026-01-01T10:00:00Z"),  // ~7 months ago
  ];

  it("keeps only sessions inside the window", () => {
    expect(filterByRange(ws, 28)).toHaveLength(1);
    expect(filterByRange(ws, 84)).toHaveLength(2);
  });

  it("treats null days as everything", () => {
    expect(filterByRange(ws, null)).toHaveLength(3);
  });

  it("survives empty input", () => {
    expect(filterByRange(null, 28)).toEqual([]);
  });
});

describe("bucketMode", () => {
  it("uses weeks for short ranges and months beyond ~4 months", () => {
    expect(bucketMode(28)).toBe("week");
    expect(bucketMode(84)).toBe("week");
    expect(bucketMode(182)).toBe("month");
    expect(bucketMode(null)).toBe("month"); // "All"
  });

  it("matches every declared range", () => {
    RANGES.forEach((r) => expect(["week", "month"]).toContain(bucketMode(r.days)));
  });
});

describe("timeSeries", () => {
  it("keeps empty buckets — a gap in training is information", () => {
    const s = timeSeries([session("2026-07-28T10:00:00Z")], 28);
    expect(s.length).toBeGreaterThan(1);
    expect(s.filter((b) => b.sessions === 0).length).toBeGreaterThan(0);
  });

  it("sums volume, sessions and duration into the right bucket", () => {
    const s = timeSeries([
      session("2026-07-28T10:00:00Z", { volume: 100, duration: 600 }),
      session("2026-07-29T10:00:00Z", { volume: 250, duration: 900 }),
    ], 28);
    const wk = s.find((b) => b.sessions > 0);
    expect(wk.sessions).toBe(2);
    expect(wk.volume).toBe(350);
    expect(wk.minutes).toBe(25); // (600+900)/60
  });

  it("ignores sessions outside the range rather than mis-bucketing them", () => {
    const s = timeSeries([session("2020-01-01T10:00:00Z")], 28);
    expect(s.every((b) => b.sessions === 0)).toBe(true);
  });
});

describe("strengthSeries", () => {
  const BENCH = "ex1";
  /* The regression this guards: several sessions of the same lift on one day
     used to produce several points sharing one x-label ("Jul 2, Jul 2, Jul 2"),
     which reads as a broken axis. */
  const sameDay = [
    session("2026-07-02T08:00:00Z", { exercises: [ex(BENCH, "Bench", "chest", [set(60, 8, 74)])] }),
    session("2026-07-02T18:00:00Z", { exercises: [ex(BENCH, "Bench", "chest", [set(80, 5, 93)])] }),
    session("2026-07-05T10:00:00Z", { exercises: [ex(BENCH, "Bench", "chest", [set(70, 6, 84)])] }),
  ];

  it("returns one point per DAY, not per session", () => {
    const pts = strengthSeries(sameDay, BENCH);
    expect(pts).toHaveLength(2);
    expect(new Set(pts.map((p) => p.label)).size).toBe(2);
  });

  it("takes the day's best e1RM", () => {
    expect(strengthSeries(sameDay, BENCH)[0].e1rm).toBe(93);
  });

  it("is ordered oldest to newest", () => {
    const pts = strengthSeries(sameDay, BENCH);
    expect(pts[0].t).toBeLessThan(pts[1].t);
  });

  it("ignores warm-ups, which would understate the day", () => {
    const pts = strengthSeries([
      session("2026-07-02T08:00:00Z", {
        exercises: [ex(BENCH, "Bench", "chest", [
          set(100, 3, 110, { type: "warmup" }),
          set(60, 8, 74),
        ])],
      }),
    ], BENCH);
    expect(pts[0].e1rm).toBe(74);
  });

  it("ignores sets that were never completed", () => {
    const pts = strengthSeries([
      session("2026-07-02T08:00:00Z", {
        exercises: [ex(BENCH, "Bench", "chest", [set(100, 5, 112, { completed: false })])],
      }),
    ], BENCH);
    expect(pts).toEqual([]);
  });

  it("returns nothing without a selected exercise", () => {
    expect(strengthSeries(sameDay, null)).toEqual([]);
  });
});

describe("muscleTotals", () => {
  const ws = [session("2026-07-02T08:00:00Z", {
    exercises: [
      ex("a", "Bench", "chest", [set(60, 10, 80), set(60, 10, 80)]),
      ex("b", "Curl", "biceps", [set(20, 10, 27)]),
      ex("c", "Fly", "chest", [set(30, 12, 42, { type: "warmup" })]), // excluded
    ],
  })];

  it("sums working-set volume per muscle, biggest first", () => {
    const m = muscleTotals(ws);
    expect(m[0]).toMatchObject({ muscle: "chest", volume: 1200, sets: 2 });
    expect(m[1]).toMatchObject({ muscle: "biceps", volume: 200, sets: 1 });
  });

  it("drops muscles whose only sets were warm-ups", () => {
    const only = muscleTotals([session("2026-07-02T08:00:00Z", {
      exercises: [ex("c", "Fly", "chest", [set(30, 12, 42, { type: "warmup" })])],
    })]);
    expect(only).toEqual([]);
  });
});

describe("exerciseOptions", () => {
  it("lists each exercise once, most-trained first", () => {
    const opts = exerciseOptions([
      session("2026-07-01T08:00:00Z", { exercises: [ex("a", "Bench", "chest", [])] }),
      session("2026-07-02T08:00:00Z", { exercises: [ex("a", "Bench", "chest", []), ex("b", "Squat", "quads", [])] }),
    ]);
    expect(opts.map((o) => o.name)).toEqual(["Bench", "Squat"]);
    expect(opts[0].sessions).toBe(2);
  });
});

describe("summary", () => {
  it("computes per-session averages", () => {
    const s = summary([
      session("2026-07-28T10:00:00Z", { volume: 100, duration: 600, sets: 4 }),
      session("2026-07-29T10:00:00Z", { volume: 300, duration: 1200, sets: 6 }),
    ], 28);
    expect(s.sessions).toBe(2);
    expect(s.volume).toBe(400);
    expect(s.avgVolume).toBe(200);
    expect(s.avgDuration).toBe(900);
    expect(s.avgSets).toBe(5);
  });

  it("reads consistency as buckets-trained / buckets-in-range", () => {
    // Both sessions land in the same week, so exactly one bucket is active.
    const s = summary([
      session("2026-07-28T10:00:00Z"),
      session("2026-07-29T10:00:00Z"),
    ], 28);
    expect(s.activeBuckets).toBe(1);
    expect(s.consistency).toBe(Math.round((1 / s.totalBuckets) * 100));
  });

  it("never divides by zero on an empty history", () => {
    const s = summary([], 28);
    expect(s).toMatchObject({ sessions: 0, avgVolume: 0, avgDuration: 0, avgSets: 0 });
    expect(Number.isFinite(s.consistency)).toBe(true);
    expect(s.bestBucket).toBeNull();
  });
});

describe("formatters", () => {
  it("compacts thousands and millions without trailing .0", () => {
    expect(compact(950)).toBe("950");
    expect(compact(6495)).toBe("6.5k");
    expect(compact(2000)).toBe("2k");
    expect(compact(1250000)).toBe("1.3M");
  });

  it("formats durations", () => {
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(600)).toBe("10m");
    expect(fmtDuration(5820)).toBe("1h 37m");
  });
});
