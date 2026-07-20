# LifeOS — Feature Catalogue & Audit

> Audited 2026-07-21 against a **local** stack (FastAPI :8001 + Mongo `lifeos-mongo`), logged in as `cg3@lifeos.com`.
> Method: every endpoint called with real data, every write re-read back, and the result verified **directly in MongoDB**.
> All test data was tagged `ZZAUDIT` and removed; final DB state confirmed identical to pre-audit.
>
> **Result: 32/32 read endpoints and 81/81 write assertions pass.** 3 real defects found — all 3 fixed (§14).
>
> Scope note: this is a **backend + data-layer** audit. Per-button UI clicking was *not* performed (see §15).

---

## 1. Auth & accounts

**What it is.** Email + password, JWT in an httpOnly cookie, invite-gated when `INVITE_CODE` is set. Roles: `admin` | `user`.

**How it works.** `POST /auth/login` returns a cookie *and* a bearer token. `get_current_user` reads the **cookie first**, falling back to the `Authorization` header only when no cookie exists.

**User logs / clicks.** Login and Register pages — the only two `onSubmit` forms in the app. Register takes email, password, name, invite code.

**Can modify.** `PUT /auth/profile` — name, age, height_cm, weight_kg, sex.

**Verified.** Login OK · unauthenticated request → 401 · profile round-trips name + weight · role gating on `/admin/*`.

**Improve.**
- *(carried from handoff)* A stale cookie shadows a valid bearer token → 401. Bit local cross-origin testing; harmless in prod. Fix: try Bearer when the cookie fails to validate.
- No password reset, no email verification, no session revocation.

---

## 2. Workout — the core module

**What it is.** The biggest feature by far: `Workout.jsx` (55.8 KB, ~50 click targets) + `WorkoutSession.jsx` (45 KB). Routines, multi-day Plans, 14 Explore programs, live session logging, PRs, progression.

### 2a. "NEXT UP" hero card — how the suggestion actually works

The whole algorithm is 6 lines in [`suggestedDayIndex()`](frontend/src/pages/Workout.jsx):

```js
let best = 0, bestT = Infinity;
days.forEach((d, i) => {
  const t = d.last_completed_at ? new Date(d.last_completed_at).getTime() : -Infinity;
  if (t < bestT) { bestT = t; best = i; }
});
```

**It picks the plan day you have gone longest without training.** Never-trained days win (`-Infinity`); ties break to plan order.

| Element | Source |
|---|---|
| Which plan | **`plans[0]` only** — plans 2+ are invisible to it |
| Fallback | `routines[0]` if no plan exists |
| `rested 4d` | `daysSince(last_completed_at)`, floored |
| `~63 min` | `max(15, totalSets × 3.5)` — a **constant**, not learned |
| Cooldown | If `daysSince < cooldown_days` (default 7) → `window.confirm` "Train it again anyway?" |
| `Trained today ✓` | Any workout dated today; card still starts the same day |

**Honest read: this is a rotation tracker, not intelligence.** It ignores the muscle-recovery data the app *already computes* at `/workouts/muscle-volume`, ignores every plan after the first, and the duration estimate never learns from your real session times.

### 2b. "Recommended for you" (fresh accounts only)

Three gates, all required: zero workouts logged **and** `lifeos:built-manually` unset **and** `lifeos:reco-dismissed` unset. Then filters the 14 programs by goal chip (`muscle`→hypertrophy+aesthetic, `strength`, `cut`, `fit`→general) and takes `level==="beginner"`, else first match. Dismissal is permanent, no auto-replacement.

### 2c. Logging a session

**User clicks.** Start workout → per set: kg, reps, RPE, set type (working/warmup/dropset/failure/amrap), tick to complete → Finish. Plus: rest timer (+15/−15, audio + vibrate), plate calculator, supersets, swap exercise, inline stopwatch, bodyweight mode, save-as-routine, per-exercise notes, interval/EMOM/HIIT timer.

**Can modify.** Everything above, *and* a saved workout after the fact — `PUT /workouts/{id}` edits kg / reps / RPE / set type, adds or removes sets and exercises, keeps the original date.

**Verified.** Volume matches a hand-computed `Σ kg×reps` (4080.0 = 4080.0) · e1rm stored per set (Epley) · RPE, set types and notes all round-trip · `/previous` returns the session · records, history, muscle-volume and progression all update · edit recomputes volume and preserves the date.

**Improve.**
1. **Make NEXT UP actually smart** — it already has muscle-recovery data; use it. Also read all plans, and learn duration from real sessions. *Highest-value item in the module.*
2. Session `mode="edit"` was deliberately skipped (draft/resume/timer logic is fragile) — the dialog covers the gap.
3. Share-card extras not built: multiple variants, carousel, "Workout Link", "Copy Text".

---

## 3. Routines & Plans

**What it is.** Routines = one ordered exercise list. Plans ("splits") = a multi-day rotation. Hevy-style folders group routines.

**How it works.** Plans carry **both** shapes: legacy embedded `days[]` *and* `routine_ids[]`. `POST /plans/{id}/import-days` copies embedded days into real routines foldered under the plan name.

**User clicks.** New routine (picker → multi-select → Add N) · New plan (day-by-day `PlanBuilder`) · SplitEditor (build from existing routines) · Move to folder · reorder · delete.

**Can modify.** Name, folder, exercise list, per-exercise sets/reps/notes, plan `cooldown_days`, day order.

**Verified.** CRUD + folder move + reorder all pass · `import-days` creates routines, is **non-destructive** (`days[]` kept) and **idempotent** (re-run creates no duplicates) · **`PUT /plans/{id}` does not wipe `routine_ids`** — the guard holds.

**Improve.** The dual `days[]` + `routine_ids[]` shape is the module's main complexity tax; worth collapsing to one model eventually.

---

## 4. Exercise library

**What it is.** 1,432 exercises with muscle group, equipment, instructions, animation, secondary muscles.

**User clicks.** Search, filter by muscle/equipment, multi-select add, info button → detail dialog (Summary / History / How-to), create custom, trash icon on your own customs.

**Can modify.** Create custom exercises · delete **your own** customs · persistent per-exercise notes.

**Verified.** Custom create → searchable → note persists → delete works · **deleting a library exercise is blocked (404) and the exercise stays intact.**

**Improve.** *(fixed today, §14)* Deleting a custom exercise used to orphan its note.

---

## 5. PRs & progression engine

**What it is.** Per-exercise personal records (weight, reps, volume, e1rm, duration, distance, pace) + an auto-regulated progression state (suggested next weight, trend, plateau and deload flags).

**How it works.** On save, `_update_prs_and_progression` folds the session into the previous state — **incrementally**. Progression reads top-set RPE vs the routine's `target_reps`: RPE ≤7 and reps ≥ target → `increase` (+2.5 kg); two consecutive high-RPE sessions without progress → `deload`; e1rm flat across 3 sessions (±1%) → `plateau`.

**Verified.** PRs award correctly · progression produced a coherent state · e1rm history tracks.

**Improve.** *(fixed today, §14)* The incremental design meant deleted/corrected sessions left permanent ghost PRs.

---

## 6. Habits

**What it is.** Two types — `check` (toggle) and `count` (target + unit). Emoji, streak, 14-day strip.

**User clicks.** Add habit · tick a check habit · +/− a count habit · edit · delete.

**Can modify.** Name, emoji, type, target, unit.

**Verified.** Both types create · count stores value, stays incomplete below target and **auto-completes at target** · check toggles on **and** off · edit updates name + target · streak and history strip present · delete cascades to `habit_logs` (0 orphans left).

**Improve.**
- **Habits still are not in the AI coach context** (sleep + health are). The coach is blind to the habit data it should be coaching on.
- `POST /habits/{id}/log` with **no request body at all** → 422. All fields are optional, so an empty body should be valid; the frontend must always send `{}`. Latent trap for the offline queue and any future client.

---

## 7. Sleep

**What it is.** Per-night log: hours, quality (1–5 stars), bedtime, wake time. Upserts on `user+date`.

**User clicks.** Log sleep dialog (bedtime + wake auto-computes hours, star rating) · delete a night.

**Verified.** Create · stats (avg hours, avg quality, nights) · **same-date re-POST upserts rather than duplicating** (8.8h replaced 6.0h, still 1 row) · delete.

**Improve.** No bedtime-consistency metric or sleep-debt view yet.

---

## 8. Body metrics

**What it is.** body_fat, muscle_mass, bone_mass, hydration, metabolic_age (manual) + **bmi, bmr (auto-computed, never manually loggable)**. Manual logs override profile-based estimates.

**User clicks.** Log a metric · clear a metric's logs (reverts to estimate).

**Verified.** Log → history → `latest` flips `source` to `manual` · BMI auto-computes (23.7) · **auto metrics reject manual logs (400)** · clearing reverts to `estimated`.

**Improve — significant gap.** **Body weight has no time series.** It lives only as `profile.weight_kg`, a single scalar that each update overwrites. So a body-tracking app cannot draw a weight trend — the one chart users most expect. Weight should become a first-class logged metric with history.

---

## 9. Intake / Nutrition

**What it is.** Calorie + macro + micro tracker. Log by photo, by plain-English text (LLM → structured items), or manually.

**How it works.** Nutrients are stored **per single unit**, and daily totals are always `nutrients × quantity`. Countable Indian foods return `unit_count` (3 dosa → QTY 3 with per-piece macros).

**User clicks.** Photo · text · manual entry · the "Is this right?" confirm screen · edit quantity · delete · set targets · "what should I eat now".

**Verified.** Create → appears in `/intake/day` → **totals scale by quantity** (180×2 = 360, then ×3 = 540) · targets persist · `by_meal` grouping across all 6 meal slots · `remaining` computed · delete.

**Improve.** `PUT /intake/entries/{id}` requires the **entire** entry object — a partial `{quantity: 3}` returns 422. It's a full-replace by design, but it makes the endpoint hostile to any partial-update client.

---

## 10. AI Coach

**What it is.** Groq Llama 3.3 70B (`llama-3.3-70b-versatile`), falls back to Claude. Grounded in the user's real data + a 137-chunk knowledge base.

**How it works.** `build_user_context()` assembles profile, workouts, plans, a 7-day health average and recent sleep; `retrieve_knowledge()` adds cited sources.

**Verified.** Configured, provider `groq` · chat answers from real data and cites sources (e.g. "Physical fitness", "Strength training") · weekly recap generates.

**Improve.**
- *(fixed today, §14)* It reported "10 workouts" to a user with more, because the context slice was being described as the total.
- Habits still absent from context (§6).
- Cosmetic: step average prints as a float ("9120.0/day").

---

## 11. Health sync (brand-agnostic)

**What it is.** Any watch/phone → Apple Health or Health Connect → a phone automation POSTs to us. Not per-brand APIs.

**How it works.** Per-user `health_token`, `POST /health/ingest` authed by `X-Health-Token`. Accepts steps, distance, resting HR, avg HR, HRV, SpO2, stress, respiratory rate, active energy → `health_daily`; sleep hours/quality → `sleep_logs`.

**User clicks.** Reveal / copy / regenerate key · per-platform setup guide.

**Verified.** Ingest stored all 9 metrics · **also wrote through to `sleep_logs`** (7.1h landed in the sleep module) · `/health/daily` returns it · **a bogus token is rejected with 401.**

**Improve.** The last mile is still manual: the user needs the exact Apple Shortcuts recipe (read metrics → POST daily with the header). Android equivalent = Tasker/Macrodroid.

---

## 12. Dashboard, Progress, Admin

- **Dashboard** — TodayHero (weekly-goal ring, streak, muscle-recovery chips), stat cards, weekly AI recap, volume chart, records, health strip, first-run onboarding wizard. Only **2 click targets** — it is almost entirely passive.
- **Progress** — stat boxes, 10-week volume area chart, PR trophy shelf, calendar, muscle heatmap, strength standards, history, edit/delete a workout.
- **Admin** — `GET /admin/users` (+workout_count), `GET /admin/stats`. Triple-gated: nav link, route redirect, API 403. **Zero click handlers — read-only.** No promote/demote/disable/delete-user actions exist.

---

## 13. PWA & offline

Installable, offline app shell, service worker `lifeos-v2` (network-first navigation, SWR for static, **skips `/api`**).

**Offline write queue covers workout saves only.** Habits, sleep, intake and health writes still fail hard offline. Train reminders are in-app only (`useTrainReminder`) — no background push.

---

## 14. Defects found and fixed (2026-07-21)

### ① Deleting or correcting a workout left permanent ghost PRs — **fixed**
`delete_workout` was 6 lines: delete the session, return `{ok: true}`. Because PRs are computed **incrementally**, the records and progression state a session produced outlived the session itself.

Demonstrated: logged a mistyped **500 kg** set → PR became 500 kg and progression began prescribing 500 kg → deleted the workout → **the 500 kg PR and the suggestion remained**. Same via edit: correcting 300 kg → 30 kg left the 300 kg PR standing.

Fix: `_rebuild_exercise_state()` wipes `personal_records` / `progression_states` / `pr_events` for the affected exercises and **replays the surviving sessions in chronological order** (`_update_prs_and_progression` gained an `at=` parameter so replays stamp the original session date). Wired into both `DELETE` and `PUT /workouts/{id}`.

Verified: 500 kg PR retracts to 60 kg on delete; 300 kg retracts to 30 kg on edit; deleting the last session clears the PR entirely. Locked in by 4 new tests (`TestDerivedStateRollback`) that run on a throwaway custom exercise.

### ② Deleting a custom exercise orphaned its note — **fixed**
`exercise_notes` is keyed by `exercise_id`; the row survived the exercise. One-line cascade delete added.

### ③ The AI coach misreported total workouts — **fixed**
`build_user_context` capped at `to_list(10)` and then described that slice as the count — "Workouts: 10 recent". Asked "how many workouts have I logged all-time?", the coach answered **10** when the true total was 13. Now injects a real `count_documents` lifetime total; re-asked, it answers **13**.

**Backend suite: 43 passed** (39 existing + 4 new).

---

## 15. What this audit did *not* cover

Stated plainly so it isn't mistaken for more than it is:

- **Per-button UI interaction was not clicked through.** The environment's own constraints (documented in `PROJECT_HANDOFF.md` §7) make it unreliable: screenshots time out, click coordinate targeting silently misses, and Radix dropdowns don't open from synthetic clicks. What is verified is that every endpoint each button calls behaves correctly with real data.
- **The frontend was not rebuilt** this session (no frontend files were changed). Run `CI=true npx craco build` before any push that touches `frontend/`.
- **Prod was not touched** — everything ran against local Mongo.
