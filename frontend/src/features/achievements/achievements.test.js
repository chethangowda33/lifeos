import { progressLabel, groupAchievements, unlockedOn } from "./achievements";

const badge = (over = {}) => ({
  key: "k", group: "Consistency", metric: "workouts", value: 3, target: 10,
  progress: 0.3, unlocked: false, ...over,
});

describe("progressLabel", () => {
  it("writes volume in the units the app uses everywhere else", () => {
    expect(progressLabel({ metric: "volume_kg", value: 6495, target: 10000 }))
      .toBe("6.5k / 10k kg");
  });

  it("writes training time as hours, not seconds", () => {
    // "5846 / 36000" is a number nobody can read as progress toward 10 hours.
    expect(progressLabel({ metric: "duration_seconds", value: 5846, target: 36000 }))
      .toBe("1h 37m / 10h 0m");
  });

  it("labels steps", () => {
    expect(progressLabel({ metric: "best_steps", value: 8200, target: 10000 }))
      .toBe("8.2k / 10k steps");
  });

  it("leaves plain counts plain", () => {
    expect(progressLabel({ metric: "workouts", value: 13, target: 25 })).toBe("13 / 25");
  });

  it("survives a missing badge", () => {
    expect(progressLabel()).toBe("0 / 0");
  });
});

describe("groupAchievements", () => {
  const list = [
    badge({ key: "a", group: "Volume", unlocked: false, progress: 0.2 }),
    badge({ key: "b", group: "Consistency", unlocked: true, progress: 1 }),
    badge({ key: "c", group: "Consistency", unlocked: false, progress: 0.9 }),
    badge({ key: "d", group: "Consistency", unlocked: false, progress: 0.1 }),
  ];

  it("keeps the catalogue's section order, not the payload's", () => {
    const out = groupAchievements(list, ["Consistency", "Volume"]);
    expect(out.map((s) => s.group)).toEqual(["Consistency", "Volume"]);
  });

  it("puts earned badges first, then the nearest misses", () => {
    const [consistency] = groupAchievements(list, ["Consistency", "Volume"]);
    expect(consistency.items.map((a) => a.key)).toEqual(["b", "c", "d"]);
  });

  it("drops sections the user has no badges in", () => {
    const out = groupAchievements(list, ["Consistency", "Volume", "Nutrition"]);
    expect(out.map((s) => s.group)).not.toContain("Nutrition");
  });

  it("falls back to the order it finds when the server sends no groups", () => {
    expect(groupAchievements(list).map((s) => s.group)).toEqual(["Volume", "Consistency"]);
  });

  it("handles an empty payload", () => {
    expect(groupAchievements()).toEqual([]);
  });
});

describe("unlockedOn", () => {
  it("writes an absolute date", () => {
    expect(unlockedOn("2026-07-30T12:00:00Z")).toMatch(/2026/);
  });

  it("returns empty for a locked badge or a broken stamp", () => {
    expect(unlockedOn(null)).toBe("");
    expect(unlockedOn("nope")).toBe("");
  });
});
