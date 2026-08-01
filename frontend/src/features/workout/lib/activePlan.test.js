import { activePlan } from "./activePlan";

const plan = (name, ...dates) => ({
  name,
  days: dates.map((d, i) => ({ name: `${name} day ${i + 1}`, last_completed_at: d })),
});

describe("activePlan", () => {
  it("returns null when there are no plans", () => {
    expect(activePlan([])).toBeNull();
    expect(activePlan(null)).toBeNull();
    expect(activePlan(undefined)).toBeNull();
  });

  it("falls back to the first plan when nothing has been trained", () => {
    const a = plan("PPL", null, null);
    const b = plan("Upper/Lower", null);
    expect(activePlan([a, b])).toBe(a);
  });

  it("picks the plan containing the most recently completed day", () => {
    const old = plan("Old split", "2026-07-01T10:00:00Z", "2026-07-03T10:00:00Z");
    const current = plan("New split", "2026-07-28T10:00:00Z");
    // Order deliberately puts the stale plan first — that was the whole bug.
    expect(activePlan([old, current])).toBe(current);
  });

  it("still works when the active plan is already first", () => {
    const current = plan("New split", "2026-07-28T10:00:00Z");
    const old = plan("Old split", "2026-07-01T10:00:00Z");
    expect(activePlan([current, old])).toBe(current);
  });

  it("compares across every day, not just the first of each plan", () => {
    const a = plan("A", "2026-07-02T10:00:00Z", "2026-07-05T10:00:00Z");
    const b = plan("B", "2026-07-04T10:00:00Z", null);
    expect(activePlan([b, a])).toBe(a); // A's second day is the most recent overall
  });

  it("ignores plans with no days at all", () => {
    const empty = { name: "Empty", days: [] };
    const trained = plan("Real", "2026-07-20T10:00:00Z");
    expect(activePlan([empty, trained])).toBe(trained);
  });

  it("tolerates a missing days array", () => {
    const broken = { name: "No days key" };
    const trained = plan("Real", "2026-07-20T10:00:00Z");
    expect(() => activePlan([broken, trained])).not.toThrow();
    expect(activePlan([broken, trained])).toBe(trained);
  });

  it("does not let an unparseable timestamp win", () => {
    // new Date("whenever").getTime() is NaN; every comparison against it is
    // false, so a guard is needed or the plan silently never wins — and worse,
    // a NaN could be picked if the comparison were written the other way round.
    const junk = plan("Junk", "whenever");
    const real = plan("Real", "2026-07-20T10:00:00Z");
    expect(activePlan([junk, real])).toBe(real);
    expect(activePlan([junk])).toBe(junk); // only option, so still returned
  });
});
