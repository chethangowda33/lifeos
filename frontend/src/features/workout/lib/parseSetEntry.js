/* Parse a typed or spoken set entry into a loggable set.

   The moment this exists for is the worst UX moment in the app: you are mid-set,
   one-handed, sweaty, and the gym has no signal. So this parses **locally and
   instantly** — no network round-trip in the one place the app most needs to be
   fast, and no dependency on a connection that isn't there. An LLM fallback is
   for phrasings this can't reach, never for the common case, which is "80x8".

   Voice feeds the same parser. The two things speech recognition reliably does
   to a set entry are transcribing "×" as the word "by" and spelling numbers out
   ("eighty by eight"), so both are handled here rather than in the mic code. */

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/* "eighty by eight" → "80 by 8". Handles tens-ones compounds ("eighty five") and
   hundreds ("two hundred", "a hundred"), which covers the range a barbell lives in. */
export function normalizeNumberWords(text) {
  const words = String(text || "").split(/\s+/);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];

    // "<n> hundred" / "a hundred"
    if (next === "hundred" && (w in ONES || w === "a")) {
      let value = (w === "a" ? 1 : ONES[w]) * 100;
      const after = words[i + 2];
      // "two hundred twenty" and "two hundred and twenty"
      let skip = 2;
      const tail = after === "and" ? words[i + 3] : after;
      const tailAt = after === "and" ? 3 : 2;
      if (tail in TENS) {
        value += TENS[tail];
        skip = tailAt + 1;
        if (words[i + skip] in ONES && TENS[tail] >= 20) value += ONES[words[i + skip++]];
      } else if (tail in ONES) {
        value += ONES[tail];
        skip = tailAt + 1;
      }
      out.push(String(value));
      i += skip - 1;
      continue;
    }

    // "eighty five" → 85 (but not "eighty eight by" style false joins — a tens word
    // followed by a ones word is unambiguous in this grammar)
    if (w in TENS && next in ONES && ONES[next] > 0 && ONES[next] < 10) {
      out.push(String(TENS[w] + ONES[next]));
      i++;
      continue;
    }
    if (w in TENS) { out.push(String(TENS[w])); continue; }
    if (w in ONES) { out.push(String(ONES[w])); continue; }
    out.push(w);
  }
  return out.join(" ");
}

const SET_TYPES = [
  [/\bwarm[\s-]?ups?\b/, "warmup"],
  [/\bdrop[\s-]?sets?\b|\bdrops?\b/, "dropset"],
  [/\b(?:to\s+)?failure\b|\bfail\b/, "failure"],
  [/\bamrap\b/, "amrap"],
];

/* RPE requires "@" or the literal word "rpe". "at" is deliberately NOT accepted:
   "3 sets at 80" means weight, and guessing wrong writes a bogus RPE onto a set. */
const RPE = /(?:@|\brpe\b)\s*(\d+(?:\.\d+)?)/;

/* <weight> (x|by|for|*) <reps>. Weight may be bodyweight; units are optional and
   ignored — the app is kg throughout, so accepting "lbs" and storing it as kg
   would silently corrupt volume. */
const CORE = /(?:^|\s)(bw|bodyweight|body\s*weight|\d+(?:\.\d+)?)\s*(?:kgs?|kilos?|kilograms?)?\s*(?:x|×|\*|by|for)\s*(\d+)(?:\s*reps?)?(?=\s|$)/;

const MAX_KG = 1000;
const MAX_REPS = 500;

/* Score how well a typed name refers to one of the session's exercises.
   0 = no match. Higher is better. */
export function scoreExerciseMatch(query, name) {
  const q = String(query || "").trim().toLowerCase();
  const n = String(name || "").trim().toLowerCase();
  if (!q || !n) return 0;
  if (q === n) return 100;
  if (n.startsWith(q)) return 80;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.every((w) => n.includes(w))) {
    // Earlier hits are stronger: "bench" should prefer "Bench Press" over "Band Bench Press".
    return 60 - Math.min(19, n.indexOf(words[0]));
  }
  return 0;
}

/* Resolve a name to an index in `exercises`. Ties break toward an exercise that
   still has an unfinished set — if two lifts match equally, the one you haven't
   finished is the one you're talking about. */
export function matchExercise(query, exercises = []) {
  let best = -1;
  let bestScore = 0;
  exercises.forEach((ex, i) => {
    const score = scoreExerciseMatch(query, ex?.name);
    if (score === 0) return;
    const unfinished = (ex.sets || []).some((s) => !s.completed);
    const tie = score === bestScore && unfinished
      && !(exercises[best]?.sets || []).some((s) => !s.completed);
    if (score > bestScore || tie) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/* Parse one entry.

   `defaultIdx` is the exercise to fall back to when no name is given — "80x8" on
   its own means "the lift I'm on", which is the fastest and most common path. */
export function parseSetEntry(input, exercises = [], defaultIdx = null) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, reason: "empty" };

  let text = normalizeNumberWords(raw.toLowerCase()).replace(/[,]/g, " ");

  let setType = "working";
  for (const [re, type] of SET_TYPES) {
    if (re.test(text)) {
      setType = type;
      text = text.replace(re, " ");
      break;
    }
  }

  let rpe = null;
  const rpeMatch = text.match(RPE);
  if (rpeMatch) {
    const v = parseFloat(rpeMatch[1]);
    if (v >= 1 && v <= 10) rpe = v;
    text = text.replace(RPE, " ");
  }

  const core = text.match(CORE);
  if (!core) return { ok: false, reason: "no-set", input: raw };

  const bodyweight = /^b/.test(core[1]);
  const kg = bodyweight ? null : Math.round(parseFloat(core[1]) * 100) / 100;
  const reps = parseInt(core[2], 10);

  // The safety net against a mis-parse. An undo toast can rescue a wrong number;
  // it can't rescue one the user never noticed, and a bogus 8000 kg would move
  // every downstream figure — volume, e1RM, PRs, the report, the achievements.
  if (kg !== null && (!(kg >= 0) || kg > MAX_KG)) return { ok: false, reason: "kg-range", input: raw };
  if (!(reps >= 1) || reps > MAX_REPS) return { ok: false, reason: "reps-range", input: raw };

  const namePart = text.slice(0, core.index).replace(/\s+/g, " ").trim();
  const matchedIdx = namePart ? matchExercise(namePart, exercises) : -1;
  if (namePart && matchedIdx === -1) {
    return { ok: false, reason: "no-exercise", query: namePart, input: raw };
  }

  const exIdx = matchedIdx === -1 ? defaultIdx : matchedIdx;
  if (exIdx === null || exIdx === undefined || !exercises[exIdx]) {
    return { ok: false, reason: "no-target", input: raw };
  }

  return {
    ok: true,
    exIdx,
    exerciseName: exercises[exIdx].name,
    namedExercise: matchedIdx !== -1,
    set: { kg, reps, rpe, set_type: setType, bodyweight },
  };
}

/* One-line human readback, for the preview chip and the undo toast. */
export function describeSet({ exerciseName, set } = {}) {
  if (!set) return "";
  const weight = set.kg === null || set.kg === undefined ? "bodyweight" : `${set.kg} kg`;
  const parts = [`${weight} × ${set.reps}`];
  if (set.rpe) parts.push(`RPE ${set.rpe}`);
  if (set.set_type && set.set_type !== "working") parts.push(set.set_type);
  return `${exerciseName ? `${exerciseName} · ` : ""}${parts.join(" · ")}`;
}
