/* Which plan is the user actually running?

   The NEXT UP hero used to read `plans[0]`, so every plan after the first was
   invisible to it: build a new split, train it all week, and the hero keeps
   suggesting days from the old one — with no way to tell it otherwise.

   The signal is simply recency. The plan containing the most recently completed
   day is the one you're on. Nothing trained yet → the first plan, which is the
   old behaviour and the right answer when there's no evidence either way.

   Deliberately NOT "best day across all plans": mixing days from a split you
   abandoned into a split you're running would be worse than ignoring it. Pick
   one plan, then pick the day within it. */
export function activePlan(plans) {
  if (!plans || plans.length === 0) return null;
  let best = plans[0];
  let bestAt = -Infinity;
  for (const plan of plans) {
    for (const day of plan.days || []) {
      if (!day.last_completed_at) continue;
      const t = new Date(day.last_completed_at).getTime();
      // Ignore unparseable timestamps rather than let NaN poison the comparison.
      if (Number.isFinite(t) && t > bestAt) {
        bestAt = t;
        best = plan;
      }
    }
  }
  return best;
}

export default activePlan;
