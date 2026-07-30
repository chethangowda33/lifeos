import { delta, barPct, relativeTime, sleepVerdict } from "./report";

describe("delta", () => {
  it("reports the direction and size of a change", () => {
    expect(delta(120, 100)).toEqual({ dir: "up", pct: 20 });
    expect(delta(80, 100)).toEqual({ dir: "down", pct: 20 });
    expect(delta(100, 100)).toEqual({ dir: "flat", pct: 0 });
  });

  it("says nothing when both periods are empty", () => {
    // A row of grey "0%" chips on a rest week is noise, not information.
    expect(delta(0, 0)).toBeNull();
    expect(delta(undefined, null)).toBeNull();
  });

  it("withholds a percentage when the previous period was empty", () => {
    // Dividing by zero would render "+Infinity%"; "+100%" would be a lie.
    expect(delta(5, 0)).toEqual({ dir: "up", pct: null });
  });

  it("survives a period dropping to zero", () => {
    expect(delta(0, 4)).toEqual({ dir: "down", pct: 100 });
  });
});

describe("barPct", () => {
  it("scales against the largest row", () => {
    expect(barPct(50, 100)).toBe(50);
    expect(barPct(100, 100)).toBe(100);
  });

  it("keeps a non-zero value visible", () => {
    // 1 of 900 rounds to 0% — an invisible bar reads as missing data.
    expect(barPct(1, 900)).toBe(2);
  });

  it("never divides by an empty max", () => {
    expect(barPct(5, 0)).toBe(0);
    expect(barPct(0, 0)).toBe(0);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-07-30T12:00:00Z").getTime();
  it("counts up through the units", () => {
    expect(relativeTime("2026-07-30T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-07-30T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-07-30T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-07-28T12:00:00Z", now)).toBe("2d ago");
  });

  it("falls back to a date once it is over a week old", () => {
    expect(relativeTime("2026-07-01T12:00:00Z", now)).toMatch(/Jul/);
  });

  it("returns empty for a missing or unparseable stamp", () => {
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("sleepVerdict", () => {
  it("reads distance from the 7.5h ideal, in both directions", () => {
    expect(sleepVerdict(5.5)).toBe("short");
    expect(sleepVerdict(6.5)).toBe("a little short");
    expect(sleepVerdict(7.5)).toBe("on target");
    expect(sleepVerdict(10)).toBe("long");
  });

  it("says nothing when no nights were logged", () => {
    expect(sleepVerdict(null)).toBeNull();
  });
});
