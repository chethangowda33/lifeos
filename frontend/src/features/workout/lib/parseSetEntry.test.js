import {
  parseSetEntry, normalizeNumberWords, scoreExerciseMatch, matchExercise, describeSet,
} from "./parseSetEntry";

const ex = (name, sets = [{ completed: false }]) => ({ name, sets });

const SESSION = [
  ex("Barbell Bench Press"),
  ex("Barbell Incline Bench Press"),
  ex("Overhead Press"),
  ex("Pull Up"),
];

const parse = (text, exercises = SESSION, defaultIdx = 0) =>
  parseSetEntry(text, exercises, defaultIdx);

describe("normalizeNumberWords", () => {
  it("converts the words speech recognition returns instead of digits", () => {
    expect(normalizeNumberWords("eighty by eight")).toBe("80 by 8");
    expect(normalizeNumberWords("twelve")).toBe("12");
  });

  it("joins tens-ones compounds", () => {
    expect(normalizeNumberWords("eighty five by five")).toBe("85 by 5");
    expect(normalizeNumberWords("twenty two")).toBe("22");
  });

  it("handles hundreds, with and without the filler words", () => {
    expect(normalizeNumberWords("one hundred by five")).toBe("100 by 5");
    expect(normalizeNumberWords("a hundred")).toBe("100");
    expect(normalizeNumberWords("two hundred twenty")).toBe("220");
    expect(normalizeNumberWords("one hundred and ten")).toBe("110");
  });

  it("leaves everything else alone", () => {
    expect(normalizeNumberWords("bench press by")).toBe("bench press by");
    expect(normalizeNumberWords("80 x 8")).toBe("80 x 8");
  });
});

describe("parseSetEntry — the shapes people actually type", () => {
  it.each([
    ["80x8"],
    ["80 x 8"],
    ["80*8"],
    ["80 × 8"],
    ["80kg x 8"],
    ["80 kg x 8"],
    ["80 kilos x 8"],
    ["80 by 8"],
    ["80 for 8"],
    ["80 x 8 reps"],
  ])("parses %s as 80 kg for 8", (input) => {
    const r = parse(input);
    expect(r.ok).toBe(true);
    expect(r.set.kg).toBe(80);
    expect(r.set.reps).toBe(8);
  });

  it("keeps fractional plate weights", () => {
    expect(parse("82.5x5").set.kg).toBe(82.5);
  });

  it("reads it spoken end to end", () => {
    // What the Web Speech API actually hands back for "bench eighty by eight".
    const r = parse("bench eighty by eight");
    expect(r.ok).toBe(true);
    expect(r.exerciseName).toBe("Barbell Bench Press");
    expect(r.set).toMatchObject({ kg: 80, reps: 8 });
  });
});

describe("parseSetEntry — RPE", () => {
  it("reads @ and the word rpe", () => {
    expect(parse("80x8 @ 8").set.rpe).toBe(8);
    expect(parse("80x8 rpe 9").set.rpe).toBe(9);
    expect(parse("80x8 @8.5").set.rpe).toBe(8.5);
  });

  it("does NOT read a bare 'at' as RPE", () => {
    // "3 sets at 80" means weight. Guessing here writes a bogus RPE onto the set.
    const r = parse("80x8 at 8");
    expect(r.ok).toBe(true);
    expect(r.set.rpe).toBeNull();
  });

  it("ignores an out-of-range RPE rather than storing it", () => {
    expect(parse("80x8 @ 40").set.rpe).toBeNull();
  });
});

describe("parseSetEntry — set types", () => {
  it.each([
    ["warmup 40x10", "warmup"],
    ["warm up 40x10", "warmup"],
    ["warm-up 40x10", "warmup"],
    ["drop set 40x10", "dropset"],
    ["40x10 to failure", "failure"],
    ["amrap 40x10", "amrap"],
  ])("reads %s as %s", (input, type) => {
    const r = parse(input);
    expect(r.ok).toBe(true);
    expect(r.set.set_type).toBe(type);
    expect(r.set.reps).toBe(10);
  });

  it("defaults to a working set", () => {
    expect(parse("80x8").set.set_type).toBe("working");
  });

  it("strips the keyword before looking for an exercise name", () => {
    // "warmup" must not be mistaken for part of the lift's name.
    const r = parse("warmup bench 40x10");
    expect(r.exerciseName).toBe("Barbell Bench Press");
    expect(r.set.set_type).toBe("warmup");
  });
});

describe("parseSetEntry — bodyweight", () => {
  it.each(["bw x 12", "bodyweight x 12", "pull up bw x 12"])("parses %s", (input) => {
    const r = parse(input);
    expect(r.ok).toBe(true);
    expect(r.set.kg).toBeNull();
    expect(r.set.bodyweight).toBe(true);
    expect(r.set.reps).toBe(12);
  });
});

describe("parseSetEntry — which exercise", () => {
  it("falls back to the lift you're on when no name is given", () => {
    // "80x8" alone is the fastest and most common path — it must not need a name.
    expect(parse("80x8", SESSION, 2).exerciseName).toBe("Overhead Press");
    expect(parse("80x8", SESSION, 2).namedExercise).toBe(false);
  });

  it("resolves a partial name", () => {
    expect(parse("overhead 60x5").exerciseName).toBe("Overhead Press");
    expect(parse("incline 60x5").exerciseName).toBe("Barbell Incline Bench Press");
  });

  it("prefers the earlier, tighter match on an ambiguous word", () => {
    // "bench" appears in two lifts; the one it leads in wins.
    expect(parse("bench 80x8").exerciseName).toBe("Barbell Bench Press");
  });

  it("breaks a tie toward the lift with an unfinished set", () => {
    const finished = [
      ex("Cable Fly", [{ completed: true }]),
      ex("Cable Fly", [{ completed: false }]),
    ];
    expect(parse("cable fly 20x12", finished, 0).exIdx).toBe(1);
  });

  it("refuses rather than guessing when the name matches nothing", () => {
    // Silently logging this onto whatever lift is in focus is the bad outcome.
    const r = parse("deadlift 100x5");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-exercise");
    expect(r.query).toBe("deadlift");
  });
});

describe("parseSetEntry — refusals", () => {
  it("rejects text with no set in it", () => {
    expect(parse("how much did i lift").ok).toBe(false);
    expect(parse("").reason).toBe("empty");
    expect(parse("   ").reason).toBe("empty");
  });

  it("rejects an implausible weight", () => {
    // The real risk: a mis-parse moves volume, e1RM, PRs, reports and achievements
    // all at once, and an undo toast can't rescue what the user didn't notice.
    expect(parse("8000x8").reason).toBe("kg-range");
  });

  it("rejects an implausible rep count", () => {
    expect(parse("80x900").reason).toBe("reps-range");
    expect(parse("80x0").reason).toBe("reps-range");
  });

  it("reports when there is nothing to log against", () => {
    expect(parseSetEntry("80x8", [], null).reason).toBe("no-target");
  });

  it("never throws on junk", () => {
    for (const junk of [null, undefined, 42, "x", "xx", "@@@", "by"]) {
      expect(() => parseSetEntry(junk, SESSION, 0)).not.toThrow();
      expect(parseSetEntry(junk, SESSION, 0).ok).toBe(false);
    }
  });
});

describe("units", () => {
  it("ignores a unit suffix rather than converting it", () => {
    // The app is kg throughout. Accepting "lbs" and storing the number as kg would
    // silently corrupt every volume figure downstream, so lbs isn't a weight here.
    const r = parse("80 lbs x 8");
    expect(r.ok).toBe(false);
  });
});

describe("scoreExerciseMatch", () => {
  it("ranks exact over prefix over contains", () => {
    expect(scoreExerciseMatch("bench press", "Bench Press")).toBe(100);
    expect(scoreExerciseMatch("bench", "Bench Press")).toBe(80);
    expect(scoreExerciseMatch("bench", "Barbell Bench Press")).toBeGreaterThan(0);
    expect(scoreExerciseMatch("bench", "Barbell Bench Press"))
      .toBeLessThan(scoreExerciseMatch("bench", "Bench Press"));
  });

  it("scores nothing for an unrelated name", () => {
    expect(scoreExerciseMatch("squat", "Bench Press")).toBe(0);
    expect(scoreExerciseMatch("", "Bench Press")).toBe(0);
  });
});

describe("matchExercise", () => {
  it("returns -1 when nothing matches", () => {
    expect(matchExercise("squat", SESSION)).toBe(-1);
    expect(matchExercise("bench", [])).toBe(-1);
  });
});

describe("describeSet", () => {
  it("reads back what was logged", () => {
    expect(describeSet({ exerciseName: "Bench", set: { kg: 80, reps: 8, rpe: 8, set_type: "working" } }))
      .toBe("Bench · 80 kg × 8 · RPE 8");
  });

  it("names bodyweight and non-working sets", () => {
    expect(describeSet({ exerciseName: "Pull Up", set: { kg: null, reps: 12, set_type: "warmup" } }))
      .toBe("Pull Up · bodyweight × 12 · warmup");
  });

  it("survives an empty call", () => {
    expect(describeSet()).toBe("");
  });
});
