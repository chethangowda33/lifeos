/* Pure helpers for the Challenges page.

   The backend computes the run itself (which days are done, where the current
   run starts, whether it is still alive). What lives here is the reading of it:
   the grid of days, the one-line status, and how a rule is worded before the
   challenge exists. All three are easy to get subtly wrong — a day painted
   "missed" that is actually still winnable is the kind of bug that makes someone
   quit a 75-day run on day 3. */
import localDate from "@/lib/localDate";

/* The full duration as coloured cells, not just the days that have happened.

   `day_states` stops at today, so the remainder has to be padded out — a 75-day
   challenge showing 3 cells on day 3 hides the size of what was committed to. */
export function dayGrid(challenge, today) {
  if (!challenge?.days || !challenge.start_date) return [];
  const states = new Map((challenge.day_states || []).map((d) => [d.date, d]));
  const start = new Date(`${challenge.start_date}T00:00:00`);
  const out = [];
  for (let i = 0; i < challenge.days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    // localDate, not toISOString: the latter converts to UTC first, which east
    // of Greenwich shifts every cell in the grid back by a day.
    const date = localDate(d);
    const s = states.get(date);
    let state = "future";
    if (date === today) state = s?.complete ? "done" : "today";
    else if (s) state = s.complete ? "done" : "missed";
    out.push({ date, day: i + 1, state, met: s?.met ?? 0, of: s?.of ?? 0 });
  }
  return out;
}

/* The headline under the challenge name. */
export function statusLabel(c) {
  if (!c) return "";
  if (c.status === "upcoming") return `Starts ${c.start_date}`;
  if (c.status === "completed") return `Completed — all ${c.days} days`;
  if (c.status === "abandoned") return `Abandoned on day ${c.current_day}`;
  if (c.status === "ended") return `Ended — ${c.days_done} of ${c.days} days done`;
  return `Day ${c.current_day} of ${c.days}`;
}

/* How a rule reads before there is any data behind it — used on the template
   cards and in the builder, where `value` doesn't exist yet. */
export function ruleSummary(rule, metrics = {}) {
  const meta = metrics[rule.metric] || {};
  const t = Number(rule.target) || 0;
  const n = t.toLocaleString();
  switch (rule.metric) {
    case "manual": return "you tick it";
    case "intake_logged": return "food logged";
    case "habits_all": return "every habit done";
    case "calories_max": return `under ${n} kcal`;
    case "workouts": return `${n} ${t === 1 ? "session" : "sessions"}`;
    default: return `${n}${meta.unit ? ` ${meta.unit}` : ""}`;
  }
}

/* Live progress wording for a rule inside a running challenge. */
export function ruleProgress(rule) {
  if (rule.metric === "manual") return rule.met ? "done" : "not yet";
  const value = Number(rule.value) || 0;
  const target = Number(rule.target) || 0;
  if (rule.compare === "max") return `${value.toLocaleString()} / ${target.toLocaleString()} max`;
  return `${value.toLocaleString()} / ${target.toLocaleString()}`;
}
