import { dayGrid, statusLabel, ruleSummary, ruleProgress } from "./challenges";

const challenge = (over = {}) => ({
  days: 5,
  start_date: "2026-07-27",
  status: "active",
  current_day: 4,
  days_done: 2,
  day_states: [
    { date: "2026-07-27", complete: true, met: 2, of: 2 },
    { date: "2026-07-28", complete: false, met: 1, of: 2 },
    { date: "2026-07-29", complete: true, met: 2, of: 2 },
    { date: "2026-07-30", complete: false, met: 1, of: 2 },
  ],
  ...over,
});

describe("dayGrid", () => {
  it("pads the days that haven't happened yet", () => {
    // Day 3 of 75 showing three cells hides the size of what was committed to.
    const grid = dayGrid(challenge(), "2026-07-30");
    expect(grid).toHaveLength(5);
    expect(grid.map((g) => g.state)).toEqual(["done", "missed", "done", "today", "future"]);
    expect(grid[4].date).toBe("2026-07-31");
  });

  it("never paints today as missed", () => {
    // Today is still winnable — marking it failed is how someone quits on day 3.
    const grid = dayGrid(challenge(), "2026-07-28");
    expect(grid.find((g) => g.date === "2026-07-28").state).toBe("today");
  });

  it("shows a finished today as done, not merely current", () => {
    const grid = dayGrid(challenge(), "2026-07-29");
    expect(grid.find((g) => g.date === "2026-07-29").state).toBe("done");
  });

  it("carries the partial count so a cell can say 1 of 2", () => {
    const grid = dayGrid(challenge(), "2026-07-30");
    expect(grid[1]).toMatchObject({ day: 2, met: 1, of: 2 });
  });

  it("handles a challenge that hasn't started", () => {
    const grid = dayGrid(challenge({ day_states: [] }), "2026-07-20");
    expect(grid).toHaveLength(5);
    expect(new Set(grid.map((g) => g.state))).toEqual(new Set(["future"]));
  });

  it("returns nothing without a challenge", () => {
    expect(dayGrid(null, "2026-07-30")).toEqual([]);
    expect(dayGrid({}, "2026-07-30")).toEqual([]);
  });
});

describe("statusLabel", () => {
  it("counts the day you are on while it runs", () => {
    expect(statusLabel(challenge())).toBe("Day 4 of 5");
  });

  it("says how it ended", () => {
    expect(statusLabel(challenge({ status: "completed" }))).toBe("Completed — all 5 days");
    expect(statusLabel(challenge({ status: "ended" }))).toBe("Ended — 2 of 5 days done");
    expect(statusLabel(challenge({ status: "abandoned" }))).toBe("Abandoned on day 4");
    expect(statusLabel(challenge({ status: "upcoming" }))).toBe("Starts 2026-07-27");
  });
});

describe("ruleSummary", () => {
  const metrics = { steps: { unit: "steps" }, sleep_hours: { unit: "h" }, protein_g: { unit: "g" } };

  it("words each metric the way a person would say it", () => {
    expect(ruleSummary({ metric: "workouts", target: 2 }, metrics)).toBe("2 sessions");
    expect(ruleSummary({ metric: "workouts", target: 1 }, metrics)).toBe("1 session");
    expect(ruleSummary({ metric: "calories_max", target: 2000 }, metrics)).toBe("under 2,000 kcal");
    expect(ruleSummary({ metric: "steps", target: 8000 }, metrics)).toBe("8,000 steps");
    expect(ruleSummary({ metric: "manual", target: 1 }, metrics)).toBe("you tick it");
    expect(ruleSummary({ metric: "habits_all", target: 1 }, metrics)).toBe("every habit done");
  });
});

describe("ruleProgress", () => {
  it("reads a manual rule as a state, not a number", () => {
    expect(ruleProgress({ metric: "manual", met: true })).toBe("done");
    expect(ruleProgress({ metric: "manual", met: false })).toBe("not yet");
  });

  it("shows a ceiling rule as a ceiling", () => {
    expect(ruleProgress({ metric: "calories_max", compare: "max", value: 1840, target: 2000 }))
      .toBe("1,840 / 2,000 max");
  });

  it("shows a floor rule as progress toward it", () => {
    expect(ruleProgress({ metric: "steps", compare: "min", value: 6200, target: 8000 }))
      .toBe("6,200 / 8,000");
  });
});
