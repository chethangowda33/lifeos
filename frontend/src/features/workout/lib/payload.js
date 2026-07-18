/* Single source of truth for the workout API payload.
 *
 * Every screen that writes a workout (live session save, edit-a-saved-workout,
 * the offline queue replay) builds its body here. The API validates strict
 * types — reps/target_reps must be whole numbers, rest_timer_seconds must be a
 * real int, exercise_id is required — and a single stray value used to 422 the
 * entire save. Coercing in one place means a fix can't land in one screen and
 * be missing in another.
 */

/** "" / null / "abc" -> null, otherwise a finite number. */
export function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Same as numOrNull, rounded — the API rejects decimals for int fields. */
export function intOrNull(v) {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
}

/** One set -> API shape. */
export function buildSet(s) {
  return {
    set_type: s.set_type || "working",
    kg: numOrNull(s.kg),
    reps: intOrNull(s.reps),
    duration_seconds: intOrNull(s.duration_seconds),
    distance_m: numOrNull(s.distance_m),
    rpe: numOrNull(s.rpe),
    completed: !!s.completed,
  };
}

/** One exercise -> API shape. */
export function buildExerciseEntry(ex) {
  return {
    exercise_id: ex.exercise_id,
    notes: ex.notes || "",
    rest_timer_seconds: intOrNull(ex.rest_timer_seconds) ?? 90, // required int
    superset_group_id: ex.superset_group_id || null,
    target_reps: intOrNull(ex.target_reps),
    sets: (ex.sets || []).map(buildSet),
  };
}

/**
 * Full body for POST /workouts and PUT /workouts/{id}.
 * Exercises without an id are dropped — exercise_id is required by the API.
 */
export function buildWorkoutPayload({
  name,
  description = "",
  durationSecs = 0,
  routineId = null,
  planId = null,
  dayIndex = null,
  exercises = [],
}) {
  return {
    name: (name || "").trim() || "Workout",
    routine_id: routineId && routineId !== "empty" ? routineId : null,
    plan_id: planId || null,
    day_index: planId != null && Number.isFinite(Number(dayIndex)) ? Number(dayIndex) : null,
    duration_seconds: intOrNull(durationSecs) || 0,
    description: description || "",
    exercises: exercises.filter((ex) => ex.exercise_id).map(buildExerciseEntry),
  };
}

/** Turn an API validation error into "field: what's wrong" instead of "422". */
export function describeApiError(e) {
  const detail = e?.response?.data?.detail;
  if (Array.isArray(detail) && detail[0]) {
    const loc = (detail[0].loc || []).slice(-2).join(" ");
    return `${loc}: ${detail[0].msg}`;
  }
  if (typeof detail === "string") return detail;
  return String(e?.message || e);
}
