# LifeOS — Feature Catalogue & Audit

> Audited 2026-07-21 against a **local** stack (FastAPI :8001 + Mongo `lifeos-mongo`), logged in as `cg3@lifeos.com`.
> Method: every endpoint called with real data, every write re-read back, and the result verified **directly in MongoDB**.
> All test data was tagged `ZZAUDIT` and removed; final DB state confirmed identical to pre-audit.
>
> **Result: 32/32 read endpoints and 81/81 write assertions pass.** 3 real defects found — all 3 fixed (§14).
>
> **Sessions 2–4 extended this**: the UI was driven in a real browser (§15), five queued improvements
> plus a timezone bug shipped (§16), NEXT UP intelligence and body-weight tracking landed (§17), and
> the live workout session — the most stateful screen in the app — was clicked through end to end (§18).

---

## 1. Auth & accounts

**What it is.** Email + password, JWT in an httpOnly cookie, invite-gated when `INVITE_CODE` is set. Roles: `admin` | `user`.

**How it works.** `POST /auth/login` returns a cookie *and* a bearer token. `get_current_user` tries **every credential presented** (cookie and `Authorization` header) and accepts the first that validates — see §16 ⑦ for why reading only the cookie was a bug.

**User logs / clicks.** Login and Register pages — the only two `onSubmit` forms in the app. Register takes email, password, name, invite code.

**Can modify.** `PUT /auth/profile` — name, age, height_cm, weight_kg, sex.

**Verified.** Login OK · unauthenticated request → 401 · profile round-trips name + weight · role gating on `/admin/*`.

**Improve.**
- ~~A stale cookie shadows a valid bearer token → 401.~~ **Fixed** in session 2 (§16 ⑦).
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
| `~63 min` | `estimateSessionMinutes(workouts, …)` — **learned** from your real sessions, falls back to `max(15, totalSets × 3.5)` |
| Cooldown | If `daysSince < cooldown_days` (default 7) → `window.confirm` "Train it again anyway?" |
| `Trained today ✓` | Any workout dated today; card still starts the same day |

**Honest read (updated 2026-07-31): two of the three complaints below are now stale.** Recovery
*is* used — `suggestedDayIndex(days, recovery)` prefers the day you're most recovered for — and the
duration estimate *does* learn, via `estimateSessionMinutes(workouts, …)` which reports whether the
figure is `learned`. **What is still true: it reads `plans[0]` only, so every plan after the first is
invisible to it.**

### 2b. "Recommended for you" (fresh accounts only)

Three gates, all required: zero workouts logged **and** `lifeos:built-manually` unset **and** `lifeos:reco-dismissed` unset. Then filters the 14 programs by goal chip (`muscle`→hypertrophy+aesthetic, `strength`, `cut`, `fit`→general) and takes `level==="beginner"`, else first match. Dismissal is permanent, no auto-replacement.

### 2c. Logging a session

**User clicks.** Start workout → per set: kg, reps, RPE, set type (working/warmup/dropset/failure/amrap), tick to complete → Finish. Plus: rest timer (+15/−15, audio + vibrate), plate calculator, supersets, swap exercise, inline stopwatch, bodyweight mode, save-as-routine, per-exercise notes, interval/EMOM/HIIT timer.

**Can modify.** Everything above, *and* a saved workout after the fact — `PUT /workouts/{id}` edits kg / reps / RPE / set type, adds or removes sets and exercises, keeps the original date.

**Verified.** Volume matches a hand-computed `Σ kg×reps` (4080.0 = 4080.0) · e1rm stored per set (Epley) · RPE, set types and notes all round-trip · `/previous` returns the session · records, history, muscle-volume and progression all update · edit recomputes volume and preserves the date.

**Improve.**
1. **NEXT UP reads `plans[0]` only** — every plan after the first is invisible to the hero. The other
   two parts of this item (use recovery data, learn duration) are **done**; see §2a. A user with two
   plans gets suggestions from one of them and no indication why.
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

**User clicks.** Add habit · tick a check habit · +/− a count habit · **edit** (pencil on each card) · delete.

**Can modify.** Name, emoji, type, target, unit.

⚠️ **This entry used to list "edit" as a user click when no edit button existed.** `PUT /habits/{id}`
was implemented and API-tested from day one, but nothing in the UI ever called it, so the only way
to change a habit was delete-and-recreate — which threw away the streak and every logged day. The
button was added **2026-07-31**. Lesson for this file: *verified at the API* is not *reachable by a
user*, and writing it in the click list hid a real gap for months.

⚠️ **A count habit's completion is judged against the CURRENT target**, not the one in force on the
day. Log 150 against a 150 goal and you're on a streak; raise the goal to 165 and that day stops
counting and the streak drops to zero. That is the right semantics — a streak should mean "I hit my
goal", not "I hit some goal I used to have" — and it is fully reversible, because nothing is
destroyed: set the target back and the days return. The edit dialog now says so when the target
actually changes.

**Verified.** Both types create · count stores value, stays incomplete below target and **auto-completes at target** · check toggles on **and** off · **edit from the UI keeps the streak and the log** · switching count → check clears the target · raising a target re-scores history and lowering it restores it · streak and history strip present · delete cascades to `habit_logs` (0 orphans left). 4 tests in `test_habit_edit.py`.

**Improve.**
- ~~Habits are not in the AI coach context.~~ **Stale — they are.** `build_user_context()` has fed
  the coach 7-day per-habit adherence (hits/7 at target, plus the average for count habits) for some
  time; this entry simply was never updated. Verified in the source 2026-07-31.
- ~~`POST /habits/{id}/log` with no request body → 422.~~ **Fixed 2026-07-31.** The body is now
  `Optional[HabitLogIn] = None`; a bodyless POST is a valid "tick today". Tested for all three
  shapes (no body, `Content-Type: application/json` with an empty body, explicit `{}`).

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

**Working iPhone recipe (2026-07-31, verified on device).** `Find Health Samples` (Steps, today)
→ **`Calculate Statistics` (Sum)** → POST the **`Sum`** variable to
`/api/health/ingest/raw?metric=steps`. Full write-up in `HEALTH_SYNC_SETUP.md`.
Android equivalent = Tasker/Macrodroid reading Health Connect, posting to plain `/ingest`.

**The Connections page now carries that recipe itself** — the three actions, a copyable
`/ingest/raw?metric=…` URL per metric with the right statistic for each (Average for heart
rate, Sum for the rest), and both traps stated in the UI: posting `Health Samples` sends the
sample *count* and still reports success, and a background automation can never show the iOS
Health permission prompt. The page previously said *"Get Health Sample → Get Contents of URL
with JSON"*, which is the recipe that fails. **This is the app's weakest onboarding path and
the first thing a new user hits — keep the in-app copy and `HEALTH_SYNC_SETUP.md` in step.**

**Each metric shows whether it is actually connected** (`✓ last <date>` vs `not set up`, with an
`N of 6 connected` count). Every metric needs its own trio of actions, and nothing used to say
which ones you'd done — so someone wires steps, assumes health sync is finished, and never
notices sleep and resting HR are empty while `/readiness` quietly scores on training data alone.
Sleep is detected via the `source: "sync"` marker in `sleep_logs` rather than `health_daily`, so
a night logged by hand doesn't count as connected.

**An ingest must never destroy data it wasn't given.** Three bugs of this family surfaced on
2026-07-31 and the rule is worth stating outright: build the `$set` from what actually arrived,
not from the full model. Pydantic optionals default to `None`, and a `None` in a `$set` is a
delete. Concretely — `/health/ingest` wrote `"quality": payload.sleep_quality` unconditionally,
so the everyday sleep payload (duration only, because a watch has no 1-5 rating) nulled out
whatever the user had rated that night by hand, on every single sync.

**Deleting a bad synced day is now a button** (Connections → Recent synced days). The endpoint existed from the start with nothing calling it, and the monotonic guard below made it essential: a wrong HIGH value is sticky by design, so a correct lower resync is refused and clearing the day is the only way back.

**A resync cannot erase a real day (added 2026-07-31).** `steps`, `distance_km` and
`active_energy` only accumulate, so a sync reporting *less* than what is already stored for
that date is never a correction — it is a broken automation or a second device that wasn't
carried. `merge_daily_metrics` keeps the higher figure and reports the rejection as
`kept_existing`; both `/ingest` and `/ingest/raw` are guarded. Everything else still
overwrites, because **a resting HR that falls is the good news, not a bug** — freezing those
at their worst reading would be the opposite of useful.

Why it exists: the earlier 2-action recipe posted the raw sample list and Shortcuts
serialised it to the **sample count** — the server stored `8` over a genuine `52` with
`ok: true`. Bounds checking can't catch that (8 is a legal step count) and neither can the
payload shape (a correct Sum arrives as a bare number too). Only the day's own history can.
**17 pure tests + 2 end-to-end** that write to an isolated 2019 date and delete it again.

---

## 12. Dashboard, Progress, Admin

- **Dashboard** (reworked 2026-07-31) — six sections: greeting → Life Score → week band (goal ring + streak + weekly volume) → health strip (with sync age) → two all-time stats → weekly AI recap → resume. **A dashboard answers "how am I doing" and offers one way in — status, not workspace.** The volume chart, recent list, PR shelf and muscle-focus bars were deleted: Progress already owns all four, better. The muscle-recovery chips went with the readiness card to Workout. Week count and streak were being shown twice (hero ring *and* their own stat cards) — 4 stat cards down to 2. Still **almost entirely passive**. If a new widget is a *decision* or a *deep-dive*, it belongs on the page that owns the thing.
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

## 15. UI click-through (2026-07-21, session 2)

Driven in a real browser against the local stack — logged in through the form, clicked
buttons, verified each result in MongoDB.

**All 11 routes render with real data and zero console errors:** `/login`, `/dashboard`,
`/workout`, `/workout/settings`, `/habits`, `/sleep`, `/progress`, `/intake`, `/coach`,
`/connections`, `/admin`, `/body-metrics`.

Flows exercised end-to-end by clicking:

| Flow | Result |
|---|---|
| Login form | Authenticated, dashboard rendered |
| Create habit (name, emoji, "Hit a target", unit) | Correct doc in Mongo — target 8, unit `glasses`, emoji 💧 |
| Conditional UI | "Hit a target" revealed the target/unit fields |
| Habit counter +8 | `1/8 → 8/8`, streak badge appeared, `habit_logs.value=8` |
| **Offline habit write** | Backend killed → click → queued in localStorage, **UI held at 9/8** |
| **Queue flush** | Backend restarted → `online` event → queue drained → `value=9` in Mongo |
| Log sleep (quality 4, Save) | Stored — and dated **local** day, see §16 |
| Coach chat via UI | Asked lifetime workouts → answered **13** with sources cited |

**A real environment caveat, confirmed:** after a Radix dialog closes, its overlay can stay
mounted and swallow clicks — three counter clicks fired no network request at all. The
network log is what caught it (`POST /habits` present, `/log` absent). Press Escape and
re-read the page before concluding a button is broken.

## 16. Second round of fixes (2026-07-21, session 2)

### ④ Habit and sleep logs landed on the wrong day — **fixed**
`_today_str()` uses the **UTC** date. In IST (+5:30) anything logged between midnight and
05:30 recorded against *yesterday* — silently breaking streaks for exactly the habits people
tick late at night ("read before bed", "sleep by 11"). The API already accepted an optional
`date`; the client never sent one. Added `lib/localDate.js` and now sends the user's own
calendar date from Habits and Sleep. Verified live: at 00:50 IST the sleep log stored
`2026-07-21` while UTC was still `2026-07-20`.

### ⑤ Habits are now in the AI coach context
7-day adherence per habit (`x/7 days at target`, plus the average for count habits) is fed
to `build_user_context`, and `COACH_SYSTEM` tells it to treat a slipping habit as a lead
rather than a scolding. Verified: the coach listed each habit with its adherence.

### ⑥ Offline queue extended beyond workouts
`sendOrQueue()` in `lib/offlineQueue.js` is the shared path. Now used by habit check/count
logs, sleep, and manual intake entries. Callers keep their optimistic UI when a write is
queued — previously the habit toggle refetched and **silently reverted the user's tap**.
Analyze-by-photo/text stay online-only (they need the model).

### ⑦ Stale cookie no longer shadows a valid Bearer token
`get_current_user` read the cookie first and stopped there, so an expired cookie returned
401 while the caller held good credentials. It now tries **every** credential presented.
Verified: valid Bearer + junk cookie → 200; junk cookie alone → **still 401**.

### ⑧ Background push for train reminders
`useTrainReminder` only fires with a tab open. Added the full path: `push`/`notificationclick`
handlers in `sw.js` (cache bumped to `lifeos-v3`), `usePushSubscription` hook, a toggle in
Workout Settings, and backend `/push/config`, `/push/subscribe`, `/push/unsubscribe`,
`/push/dispatch`. Verified subscribe/unsubscribe round-trip and that `/push/dispatch`
rejects a bad secret (401).

**Deployment note — this is not live until you do two things:**
1. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_DISPATCH_SECRET` on Render.
   Generate keys with `python -c "from py_vapid import Vapid01; v=Vapid01(); v.generate_keys(); print(v.public_key, v.private_key)"`.
2. Point an **external** scheduler (cron-job.org, GitHub Actions) at
   `POST /api/push/dispatch` with header `X-Dispatch-Secret`, every ~15 min. The free Render
   tier sleeps, so the app cannot wake itself — this is why dispatch is a pulled endpoint
   rather than an internal loop. Until both are done, `/push/config` reports
   `configured: false` and the UI simply doesn't offer the toggle.

Also: iOS delivers web push **only to a PWA installed to the Home Screen**. The toggle copy
says so rather than silently doing nothing in a Safari tab.

### Health sync last mile — `HEALTH_SYNC_SETUP.md`
Step-by-step Apple Shortcuts recipe (which Health samples, which actions, the exact JSON),
the full accepted field table, the Android/Health Connect equivalent, and a troubleshooting
table. This was the remaining manual gap in the health feature.

**After both sessions: backend suite 43 passed · `CI=true npx craco build` compiles clean.**

## 17. The two big-ticket items (2026-07-21, session 3)

These were flagged across sessions as the highest-value work left. Both done and verified live.

### ⑨ NEXT UP is now recovery-aware and learns its time estimate
Previously a pure rotation tracker: it read only `plans[0]`, ignored the muscle-recovery data
the app already computes, and showed a constant `sets × 3.5` for duration.

- **Recovery-aware pick.** `suggestedDayIndex(days, recoveryByMuscle)` now prefers the day
  whose muscles are most recovered (`fresh` < `recovering` < `worked` from
  `/workouts/muscle-volume`), breaking ties by longest-untrained. Called with one argument it
  behaves exactly as before, so `useTrainReminder` is unaffected.
- **Explained, not black-box.** The hero shows "you trained these muscles today" /
  "still recovering from yesterday" / "recovered and ready" so the pick is legible.
- **Consistency.** The plan folder's "Next" badge uses the same rule — the hero and the plan
  card no longer disagree on the same screen (they did before this change).
- **Learned duration.** `estimateSessionMinutes()` takes the median of your own past sessions
  for that day/routine and tags it "(your average)", falling back to the old estimate until
  there's history.

**Verified live, driving the real UI:** built a 2-day plan where the rested-since-June day
uses chest and the recently-trained day uses legs. With chest `fresh`, the hero picked the
chest day (as the old rule would). Logged a chest session today → chest became `worked` →
**the hero flipped to the legs day** while the old rule would still have said chest. After
logging two legs sessions of 45 and 55 min, the hero showed **"~55 min (your average)"**
instead of the constant.

### ⑩ Body weight is now a real tracked metric with a trend
It was a single overwritable scalar on `profile.weight_kg` — the app literally could not draw
the one chart users most expect.

- `weight` added to `METRIC_DEFS`; its healthy range is **personalised to the user's height**
  (BMI 18.5–24.9 → kg) in `metric_definitions()`, which is now optional-auth.
- The Body Metrics page is fully generic, so weight gets a **card and a trend line** for free.
- **Two-way sync:** logging a weight updates `profile.weight_kg` (so BMI/BMR/body-fat estimates
  move with it); editing weight in the profile/onboarding records a history point (so the trend
  isn't stuck at one dot). Re-saving the same weight does **not** duplicate a point.

**Verified live:** logged 75.5 → 75.0 → 74.4; the weight card rendered with **Ideal
58.6–78.9 kg** (from the 178 cm height), a descending trend line confirmed in the DOM, BMI
recomputed 23.7 → 23.5, and the profile weight followed. 4 new backend tests (`TestWeightMetric`).

**Backend suite: 47 passed.** `CI=true npx craco build` compiles clean.

## 18. Live workout session — clicked through (2026-07-21, session 4)

The most stateful screen in the app, and the one previously listed as untested. Driven in a
real browser from a 3-exercise routine (Bench / Row / Curl).

| Control | Result |
|---|---|
| Start from routine | Session opened, duration timer ticking |
| "Previous" column | Showed real history — `99×5`, `50×10` |
| Progression hint | "Suggested: 99 kg" from `/progression` |
| **Apply** button | Filled **all three** bench sets with 99 kg in one tap |
| kg / reps / RPE entry | Accepted 99 / 8 / 8 |
| Complete set (✓) | **Volume → 792 kg** (99×8 exactly), SETS → 1 |
| Rest timer | **Auto-started** on set completion, counted down from 90s |
| Rest timer ±15 / skip | All three respond |
| Set-type menu | Working / Warm-up / Drop set / Failure / AMRAP all listed |
| Set → Warm-up | Row relabelled **W**, and correctly **excluded from volume** |
| **Plate calculator** | For 99 kg / 20 kg bar: `1×25 + 1×10 + 1×2.5 + 1×1.25` per side, and it warned **"0.75 kg per side can't be loaded with your plates — closest load: 97.5 kg"** |
| Draft autosave | `lifeos:session:v1:routine:<id>` held every set with type/kg/reps/rpe/completed |
| **Reload mid-session** | Prompt: *"Resume unfinished workout? … 1 sets logged · 3 exercises"* |
| **Resume** | Restored volume 792 kg, SETS 1, all inputs **and** the warm-up type |

The draft/resume path — flagged in the handoff as "the fragile part", and the reason session
`mode="edit"` was never built — **survived a full page reload with zero data loss**.

### Finish → save → PR, verified end to end
Logged three sets through the UI (Bench 100×5 @RPE 8, Row 60×10 @RPE 7, Curl 20×12 @RPE 7),
watched the header read **1340 kg / 3 sets** (the exact hand-computed total), clicked **Finish**,
filled the Save dialog, and clicked **Save Workout**. Verified in MongoDB:

| Check | Result |
|---|---|
| Workout written | `ZZLIVE Finish Test`, count 13 → 14 |
| Volume | **1340.0 kg** — matches the UI and the hand calculation |
| Sets | 8 logged / 3 completed, duration 122 s |
| Title + description | Both persisted from the dialog |
| RPE | Round-tripped per set — 8 / 7 / 7 |
| e1RM | Computed per set at write time — 116.7 / 80.0 / 28.0 |
| **PR awarded** | Bench **99 → 100 kg**, e1RM 116.7, progression `last_weight` updated |
| **PR retracted on delete** | Deleting it put the PR **back to 99 kg** and progression back to 99 |

That last row matters: it proves the §14 rollback fix works on a **genuinely UI-created** workout,
not only on API-constructed test data.

### Environment artifact worth knowing (not a product bug)
In headless Chrome, Radix dialogs/menus stay mounted at `data-state="closed"` with
`pointer-events: auto` because the CSS `animationend` Radix waits on never fires. The stuck
overlay silently swallows subsequent clicks. This is what made three habit-counter clicks fire
no network request in session 2. **Real browsers fire `animationend` and unmount normally** —
but if a stuck-overlay report ever comes in from a real device, this is the first thing to check.
Workaround while testing: reload the page, or remove `[data-state=closed]` overlays.

## 19. The last gaps closed (2026-07-21, session 5)

### Multi-user isolation — 8/8, no leaks
Registered a real second user and checked separation from both sides:

| Check | Result |
|---|---|
| B sees A's workouts | **No** — A=13, B=0 |
| A sees B's routine | **No** |
| A deletes B's routine by id | **Blocked (404)** — B still has it |
| B inherits A's PRs | **No** — B records = 0 |
| B reaches `/admin/users` | **Blocked (403)** |
| Health tokens | **Per-user**, not shared |
| A's health token writes into B | **No** — B days = 0 |

### Push dispatch with real VAPID keys — and a bug it caught
Generated a real VAPID keypair, ran the backend with it, and drove `/push/dispatch`.
`config` flipped to `configured: true`, subscribe/unsubscribe round-tripped, and dispatch
rejected both a wrong secret and a missing one (401).

**Bug found:** the handler only caught `WebPushException`. A subscription whose stored
`p256dh` key is corrupt raises `ValueError` deep in the crypto layer instead — which **500'd
the entire dispatch run**. Since that one endpoint serves *every* user, a single bad row would
have cost everybody their reminder. Now unusable subscriptions are logged, dropped, and the
run continues; the response reports `dropped` alongside `sent`. Re-verified: `dropped: 1`,
run completed, second dispatch sent 0 (pruned + the per-day guard holding).

### Superset replace/remove orphaning — found and fixed
Deliberate test: superset Bench+Row, then **replace** Bench.

- **Before:** the replacement came back with `superset_group_id: null` (because `buildExercise`
  starts every exercise at null) while Row kept the group id — leaving Row **alone in a
  superset of one**, rendered as a superset and saved with a meaningless group id.
- **After:** the replacement **inherits** the group (swapping a lift inside a superset should
  keep the pairing), and a new `pruneLoneSupersets()` helper clears any group left with fewer
  than two members. Wired into both replace and remove.
- Verified live: replace → both exercises share `ss-lcqczb`, group size 2, **zero orphans**;
  remove a member → the survivor's `superset_group_id` is `null`.

### Add-exercise mid-session
The picker opens from the session, search filters correctly (typing "Lateral Raise" narrowed
to matching lifts), and selection adds to the session. Multi-select mode is active for add and
single-tap for replace, as designed.

## 20. Polish pass (2026-07-29, session 7)

Not a feature — a sweep across every page and model looking for what was quietly wrong.

### A failed load rendered the EMPTY state
The worst find. Seven pages caught nothing on load, so a server hiccup was
indistinguishable from an empty account:

| Page | What a failure looked like |
|---|---|
| Workout | "Nothing queued yet — **Create a routine**" → invites duplicating routines you own |
| Habits | "Build your first habit" |
| Sleep | "Log your first night" |
| Body Metrics | **No cards at all** — `refresh()` had no `try`, so it was an unhandled rejection |
| Connections | A **blank sync key** — reads as "you don't have one", invites a needless regenerate |
| Admin | Zeroed tiles, empty member list |
| Progress | Empty history |

One shared `LoadError` card with retry now covers all seven, and pages whose remaining
content would render blank return early rather than showing empty fields under an error.

**Verified** by forcing every `/api` call to fail at the XHR layer in a logged-in session:
all seven show the error, none show the misleading empty state, and **Try again recovers**.

### Values that silently corrupted derived data

| Was | Now |
|---|---|
| `hours: float` unbounded | `0-24` — a 9999 wrecked the 7-night average *and* the Life Score |
| `quality` documented 1-5, unenforced | `1-5` |
| habit `type` free text | `check`\|`count` — a typo silently became a check habit that ignored its target |
| `date` unvalidated | `YYYY-MM-DD` — these are raw lookup keys, so a bad one was written then never matched again; the log just vanished |
| health metrics unbounded | generous ceilings, aimed at catching a mis-mapped automation field |
| body metric one global bound | **per metric** in `METRIC_DEFS["max"]` |

That last row is worth noting: the first attempt used a single ceiling and rejected a
legitimate **BMR of 1700 kcal/day**. An existing test caught it — which is the argument for
running the suite rather than trusting new code.

`/health/ingest/raw` writes directly, so it now revalidates through `HealthIngestIn` — it
must not become a way around the bounds the JSON endpoint enforces.

### Consistency and reach
- A malformed path id returned **500** on habits and sleep where every other module returned
  404. One `_oid()` helper — a client mistake is not a server fault.
- Icon-only buttons had **no accessible name**, including the complete-set button (the most
  pressed control in the app). Now `"Complete set 3"` / `"Undo set 3"` with `aria-pressed`.
  An unnamed control is also unaddressable by anything driving the UI by name — which is
  exactly why these were the hardest things to reach in testing.
- The AI Coach **copy button was hover-only**, so it was unreachable on mobile.

### Click-through
11 routes, 128 buttons, **0 console errors, 0 unhandled rejections**. Exercised end to end:
all 7 settings toggles + rest presets + the weekly-goal picker (round-trip, zero drift),
habit create→count→delete, body-metric log + ceiling rejection with a readable message
(*"Body Fat cannot exceed 100 %"*), sleep log → Life Score unlocking at two signals
(0 + 93 → **46**), and intake create→update→delete with correct quantity scaling
(180×2=360, ×3=540).

**Backend suite 66 → 85.** The offline queue was left untouched by request.

## 21. Progress as an analytics view (2026-07-30, session 8)

`features/progress/analytics.js` (pure, 22 unit tests) + `charts.jsx`; `Progress.jsx` consumes
them. The old inline `weeklyVolume` / `VolumeTrend` path is gone.

### Structure
**One filter row scopes the entire page** — 4W / 12W / 6M / 1Y / All, plus a Charts/Table
switch. Per-chart filters are an anti-pattern: every number on the page must describe the
same slice. Bucket width follows the range (weeks ≤ ~12, months beyond), so "consistency"
relabels itself between *weeks trained* and *months trained*.

### The five charts, and why each form

| Chart | Job | Form |
|---|---|---|
| Training volume | change over time | area |
| Training frequency | magnitude over time | bars |
| Strength progression | change over time, one lift | line + picker |
| Volume by muscle | compare magnitude | ranked bars |
| Time under the bar | magnitude over time | bars |

**Every chart is a single series in `hsl(var(--maroon))`.** That is the load-bearing decision:
one series means no categorical palette, so the user's themeable accent and dark mode flow
through with nothing to keep in sync. Muscle groups are *nominal*, so every bar is the same
colour — shading them by size would double-encode the length the bar already shows. Strength
uses the **emphasis** form (one exercise at a time) rather than several coloured lines.

⚠️ **Adding a multi-hue palette here means validating it for colour-blindness first.** The
current design avoids that problem rather than solving it.

### Two KPI rows
Range totals, then the derived numbers a report is actually read for: average volume,
duration and sets per session, and **consistency = share of buckets containing ≥1 session** —
a fairer read of showing up than a raw count.

### The table view is not decoration
It is the reason tooltips are permitted: a tooltip must never be the only way to read a
value. Any chart added here needs its values reachable as text too.

### Two bugs found by testing rather than reading
- **Duplicate x-labels.** Training a lift twice in a day produced several points sharing one
  label ("Jul 2, Jul 2, Jul 2") — it reads as a broken axis. `strengthSeries` now groups **by
  day**, taking the day's best *working* set (warm-ups would understate the day). Two unit
  tests guard it, confirmed to fail against a deliberately reverted implementation.
- **A silent under-report.** `GET /workouts` caps at **200** sessions, so "All" would quietly
  show wrong totals for a long history. When the cap is in play the headline falls back to
  the server's own `/workouts/stats` aggregate.

### Verified
Mark specs checked **in the DOM**, not assumed: bars exactly 24px with 4px rounded tops square
at the baseline, 2px round-capped lines, r=4 dots with a 2px surface ring, solid hairline grid,
axis text in muted ink. Range switching, the exercise picker, the table view and the empty
states were each exercised against real history, and the totals reconcile
(4,580 + 1,915 = 6,495 kg; 27m + 1h10m = 1h37m). 375px and desktop: charts size to their card,
no horizontal scroll, no console errors.

**Chart animation is off on purpose** — deterministic render, and it removes a class of
"chart is blank" failures.

## 22. Period reports (2026-07-30, session 9)

`/reports` — one week or one month, reviewed. Backend `GET /reports` +
`POST /reports/narrative` (server.py, after the coach section); frontend `pages/Reports.jsx`
with pure helpers in `features/reports/report.js` (12 unit tests).

### Numbers first, narrative second
`GET /reports` returns **only computed figures** — training (sessions, days trained, volume,
sets, duration, top five lifts by volume, hard sets per muscle, PRs), the same block for the
**previous** period, recovery (sleep, watch data), habit adherence, and intake averages. The
page renders fully with the AI switched off.

The narrative is a second, explicit call, and it is handed **exactly those numbers as JSON** —
not `build_user_context`. That is the point of the split: every figure the coach can cite is
already on the page as text beside it, so the AI is never the only source for a number. It
cannot mention a lift the summary doesn't contain.

### Why the narrative is cached
Generating on every page view would be slow, costly and non-deterministic — the same week
would read differently each visit. It is stored per `(user, period, start)` in `db.reports`
with a `signature` (a hash of the headline numbers). When the data moves under a stored
narrative the report comes back `stale: true` and the card says so rather than quietly
describing numbers that have changed. **Don't make generation implicit** — a narrative the user
didn't ask for is an LLM call they didn't ask for.

### Judgement calls worth keeping
- **A running period is scored against the days that have happened.** A habit at 2/7 on a
  Tuesday reads as failure; `days_elapsed` makes it 2/2. Finished periods use all 7 (or 28-31).
- **`today` is the caller's local date**, as with `/life-score`. Habits, sleep and intake are
  keyed on the user's own calendar day, so a UTC boundary puts an IST user in the wrong week
  between 00:00 and 05:30.
- **No percentage against an empty period.** `delta()` returns `pct: null` when the previous
  period was zero — "+100%" against a week you didn't train is noise dressed as insight — and
  `null` when both are zero, so a rest week doesn't grow a row of grey 0% chips.
- **Hard sets use the same rule as `/workouts/muscle-volume`** (no warm-ups, no RPE<6). Volume
  counts everything, exactly as `/workouts` does. Two different questions, two different rules
  — kept identical to the existing endpoints so no two screens disagree.
- **Monthly target = weekly setting × weeks in the month**, not ×4.
- `RecapText` moved out of `Dashboard.jsx` to `components/AiText.jsx` and is now shared by the
  dashboard recap and the report — one renderer, one behaviour.

### Verified
- Backend **24 new tests** (period bounds incl. Sunday, leap year and year rollover; the
  partial period; validation; auth). The training figures are checked by *delta*: a workout
  logged through the API moves workouts/sets/volume/duration/hard-sets/signature by exactly the
  hand-computed amount, and deleting it returns every one of them to the baseline. Runs on a
  throwaway custom exercise, so real PR state is never touched.
- The July report reconciles exactly with `/workouts/stats` (13 sessions, 6,495 kg, 26 sets,
  5,846 s) — an independent aggregation agreeing with the existing one.
- Clicked in the browser: period switch, stepping back through months, the stale banner (forced
  by corrupting the stored signature), Rewrite clearing it, the AI-not-configured state, and the
  failure state via XHR sabotage → `LoadError` + Try again recovers. A habit and a night of
  sleep logged for today rendered "1/4 days" and "6.4 h · a little short · quality 3/5", then
  were deleted and the report returned to empty. 375px: no horizontal overflow, 0 console errors.

## 23. Achievements (2026-07-30, session 9)

`/achievements` — 29 badges in 6 groups. Backend `GET /achievements` +
`POST /achievements/seen`; frontend `pages/Achievements.jsx` with pure helpers in
`features/achievements/achievements.js` (13 unit tests).

### Derived, never logged
Every badge is a threshold on data the user already records — workouts, volume, time, PRs,
weekly-goal streak, habit streaks, sleep, steps, food logs. **Nothing new has to be tracked to
earn one.** The catalogue is a single list of `{key, group, icon, metric, target, name,
description}` and `_achievement_metrics()` computes every metric it can be checked against.

The only thing stored is the moment each was first observed (`db.achievement_unlocks`). State
is recomputed on every read, which is what keeps a badge from drifting away from the data —
**and when the data goes, the badge goes with it.** Deleting the sessions that earned it drops
the stored record too, so it can be genuinely re-earned later. That is the §14 ghost-PR lesson
applied before it could happen again: derived state must never outlive its source.

### Judgement calls worth keeping
- **Locked badges show progress**, not a padlock. "13 of 25 workouts" is the half that
  motivates; `next_up` surfaces the three nearest misses at the top of the page.
- **The first read of an account with history is recorded as already seen.** Otherwise a user
  who has trained for months opens the page to 18 "New" flags and the one they actually just
  earned is buried. After that first pass, `new` is real and *survives being read* — it clears
  only on `POST /achievements/seen`, which the page fires on view. Reading the list somewhere
  else (a dashboard card, later) can't eat the news.
- **An unfinished week can't break the weekly-goal streak** — the count starts from last week
  when this one hasn't met the target yet, the same rule the habit streak uses for "today".
- **A locked badge never carries an unlock date** (asserted in the tests) — a date beside a
  locked badge reads as earned.
- **The unit lives with the metric.** The API returns `metric`, so the client can render
  "6.5k / 10k kg" and "1h 37m / 10h 0m" instead of "6495 / 10000" and "5846 / 36000".

### Verified
- Backend **11 tests**: shape invariants across the whole catalogue (unique keys, progress ==
  the ratio the bar draws, no unlock date while locked, counts agreeing with the list), plus a
  full lifecycle — seven nights of sleep logged through the API unlock two badges as `new`,
  `new` survives a second read, `seen` clears it, deleting the nights retracts both badges and
  their stored records, and partial progress still shows.
- Clicked in the browser: all 29 badges in 6 sections, unit labels, the "2 new" chip and per-
  badge New pills appearing on a real unlock and gone after the page marked them seen, the
  badges retracting when the data was deleted, and `LoadError` → Try again recovering in place.
  375px: no overflow, no clipped cards, 0 console errors.
- `craco.config.js` gained a Jest `moduleNameMapper` for `@/` — webpack had the alias and Jest
  didn't, so a module importing `@/...` built fine and failed only under test.

## 24. Challenges (2026-07-30, session 9)

`/challenges` — a run of days with rules that all have to be met. Backend `GET /challenges`,
`GET /challenges/templates`, `POST /challenges`, `POST /challenges/{id}/log`,
`DELETE /challenges/{id}[?purge=true]`; frontend `pages/Challenges.jsx` + pure helpers in
`features/challenges/challenges.js` (12 unit tests).

### The app checks what it can already see
A rule names a metric. Seven of the eight are read straight from logged data — workouts, steps,
sleep, calories (a ceiling), protein, food logged, all-habits-done. Only `manual` is a tick, for
the things the app genuinely cannot observe: pages read, a photo taken, water drunk.

**Hand-ticking a derived rule is refused with a 400.** If the box could disagree with the data
underneath it, the challenge stops meaning anything — and "log your workout, then also tick that
you worked out" is how a tracker turns into a chore.

Two consequences worth knowing: a *ceiling* rule (calories under 2,000) is only met once
something has been logged — an untouched food diary is not a day under target — and
`habits_all` can't be satisfied with no habits set up, because 0 of 0 would hand out a free
tick every day.

### Strict mode is derived, not destructive
`strict` is the 75 Hard rule: miss a day and you start again. Nothing is reset or deleted — the
current run is simply measured from the day after the last miss. So the day grid keeps every day
you did complete, `days_done` still counts them, and `restarts` is a fact about the data rather
than a counter someone has to keep in sync. Three missed days in a row is **one** collapse, not
three, and a run that never got going was never broken.

**Today is never a miss.** Only days strictly before today can fail; today is still winnable.
It counts toward `current_day` ("Day 12 of 75" — the day you are *on*) but toward `streak` only
once its rules are actually met.

### Other judgement calls
- **One challenge at a time** (400 if another is active or upcoming). Two sets of conflicting
  daily rules is a way to fail both.
- **Rule keys are assigned server-side** (`r1`, `r2`…), never taken from the client — they are
  the join key for manual ticks, so a duplicate would tie two rules together.
- **Template targets are editable before you commit.** A fixed 2,000 kcal is useless to half the
  people who would start a cut; the start dialog is the same component as the custom builder.
- **Abandon keeps it in history; `?purge=true` erases it** (and its logs).
- **The grid is padded to the full duration** — a 75-day challenge showing 3 cells on day 3
  hides the size of what was committed to.

### Verified
- Backend **20 tests**: template integrity (every template rule uses a known metric; 75 Hard is
  75 days and strict), validation (unknown metric, no rules, second challenge, bad id → 404),
  the manual/derived boundary in both directions, ticks outside the run refused, and a 5-day
  strict run with days -4..-2 missed asserting `run_start`, `current_day`, `streak`, `restarts`,
  that an unfinished today is neither banked nor a miss, and that history survives the restart.
- Clicked in the browser: started 30-Day Cut with an **edited** calorie target, built a custom
  challenge from empty (add rule → pick metric → the target box appears only for numeric rules),
  ticked a manual rule (`aria-pressed` flips, day cell reads 1/2 rules), logged a real workout
  and watched the derived rule turn 0/1 → 1/1 and the day flip to done, abandoned into history.
  A 75-day grid wraps to 7 rows at 375px with no horizontal scroll; 0 console errors. All probe
  challenges, logs, workouts and exercises purged afterwards — DB confirmed clean.
- **Found by testing, not reading:** `dayGrid` built its dates with `toISOString()`, which
  converts to UTC first — east of Greenwich every cell in the grid shifted back a day. It now
  uses `lib/localDate`, and a unit test covers it.

## 25. Quick-log: typing or saying a set (2026-07-31, session 10)

A text field + mic in the live session's sticky header. Type or say `bench 80 by 8 rpe 8`
and the set is logged. `features/workout/lib/parseSetEntry.js` (pure, **47 unit tests**) +
`features/workout/session/QuickLog.jsx`.

### Local parse, not a round trip
The moment this exists for is the worst UX moment in the app: mid-set, one-handed, and the
gym has no signal. So the parse is **local and instant** — no network call in the one place
the app most needs to be fast, and no dependency on a connection that isn't there. An LLM
fallback would be for phrasings the grammar can't reach; it is deliberately **not** on the
common path, which is `80x8`.

Speech uses the browser's own recogniser (`webkitSpeechRecognition`) — on-device, no audio
upload, no API cost — and the mic simply isn't rendered where the API doesn't exist.

### What the grammar takes
`80x8` · `80 x 8` · `80*8` · `80 by 8` · `80 for 8` · `80kg x 8` · `82.5x5` · `bw x 12` ·
`warmup 40x10` · `drop set 40x10` · `40x10 to failure` · `amrap 40x10` · `@ 8` / `rpe 9`,
with an optional exercise name in front. Speech-specific handling lives in the parser, not
the mic code, because the two things recognition reliably does are transcribe "×" as **"by"**
and spell numbers out — `eighty by eight` → 80 × 8, including tens-ones compounds
(`eighty five`) and hundreds (`one hundred and ten`).

### Judgement calls worth keeping
- **Undo, not confirm.** A confirm step costs a tap in the exact moment being optimised. The
  log fires immediately and the toast carries Undo, which restores the *prior* set rather
  than deleting — a mis-read costs one tap and loses nothing already typed.
- **"at" is not RPE.** `@` and the literal word `rpe` are accepted; a bare "at" is not,
  because "3 sets at 80" means weight and guessing writes a bogus RPE onto the set.
- **Bounds are the real safety net.** Weight >1000 kg or reps >500 are refused. An undo toast
  can rescue a number the user *noticed*; it can't rescue one they didn't, and a bogus
  8000 kg moves volume, e1RM, PRs, the report and the achievements all at once.
- **A name that matches nothing is refused, not guessed.** `deadlift 100x5` in a session with
  no deadlift errors rather than logging onto whatever is in focus.
- **No units conversion.** `lbs` is rejected rather than accepted-and-stored-as-kg, which
  would silently corrupt every volume figure downstream.
- **No name means "the lift I'm on"** — the first exercise with an unfinished set. This is
  the fast path and it must not require typing a name.
- **Ties break toward the unfinished lift.** If two lifts match equally, the one you haven't
  finished is the one you meant.
- The **live PR check was extracted** out of `toggleComplete` into `celebratePR()` and is now
  shared, so a PR set logged by voice celebrates exactly as a tapped one does. Quick-log also
  starts the rest timer, so both paths behave identically.

### Verified
- 47 parser tests, green first run; suite 58 → 105.
- Driven in the browser on a live session with two deliberately ambiguous lifts (Barbell
  Bench Press + Barbell Incline Bench Press, both containing "bench"): `80x8 @ 8` filled and
  completed the open set with volume moving **400 → 1040 kg** (400 + 80×8, exact) and the
  toast reading *"Barbell Bench Press · 80 kg × 8 · RPE 8"*; **Undo** restored it to 400 kg
  with the row intact and un-completed; `incline 60 x 5` routed by **name** to the second
  lift rather than the one in focus; `incline 62.5 by 5 rpe 9` **appended** a row because
  that lift's sets were all done; `warmup bench bw x 12` logged bodyweight; the rest timer
  started. Final volume 1012.5 reconciles exactly (400 + 300 + 312.5).
- Refusals verified live: `deadlift 100x5` → *"No 'deadlift' in this workout."*, junk text →
  *"Couldn't find a set in that"*, and the session snapshot was **unchanged** after both.
- 375px: QuickLog itself contributes **zero** horizontal overflow. ⚠️ The measurement did
  surface a **pre-existing** overflow in the *rest timer* row (`−15 / 00:42 / +15 / skip`
  lands ~12px past the right edge) — it only appears while a timer is running, which is why
  earlier mobile passes missed it. Filed separately, not fixed here.
- **Environment note (again):** closing a Radix dialog in the headless pane leaves
  `body{pointer-events:none}` and `data-state="closed"` nodes, so real pointer clicks land
  nowhere. This is the artifact documented in sessions 2/4/7. Reload clears it; the React
  handlers were then driven directly, which is the documented workaround.

## 26. Should I train today? (2026-07-31, session 11)

`GET /readiness` + a card on the **Workout** page, directly above the "next up" hero. Muscle
recovery, weekly hard sets vs MEV/MAV/MRV, plateau/deload flags, last night's sleep and
resting HR/HRV were all being computed already and nothing combined them into an answer.

### Why it isn't on the dashboard
It shipped there first, and that was wrong. This is a **decision**, and the dashboard is a
status surface — so the app could say *"chest is over MRV, train legs"* on one screen while
offering you Push Day A on another, neither referencing the other. The verdict and the button
you press about it have to be in one glance. `features/workout/components/ReadinessCard.jsx`
self-fetches (like the dashboard's `WeeklyRecap`) and renders nothing if the request fails, so
it can be dropped on any page without touching that page's load orchestration.

### It shows its own working
The card is a score out of 100, a verdict (`train` / `light` / `rest`), what to train, what
to leave alone — and every reason with **the points it cost**:

```
  −25  Slept 5.4h last night
  −10  Chest is over MRV (24 of 22 hard sets)
  −10  2 exercises flagged for deload
   +5  Slept 8.2h — well rested
```

`score == 100 + sum(effects)`, and there's a test that says so. A verdict you disagree with
therefore points at a **threshold**, not at a black box — you can argue with "under 6h costs
25" in a way you can't argue with a sentence an LLM produced.

### Not an LLM call, deliberately
Every input is a number and the arithmetic is the product. An AI summary here would cost a
round trip to restate figures the page already has, and would be free to drift from them —
the same reason `GET /reports` returns computed numbers and the narrative is a separate,
explicitly-grounded call.

### The scoring
Starts at 100. Already trained today −35 · sleep <6h −25, <7h −12, ≥8h **+5**, quality ≤2/5
−8 · 3+ training days in a row −10 · each muscle over MRV −10 (max two named) · any muscle
near MRV −5 · deload flags −10 · plateaus −5 · resting HR ≥7bpm over your 7-day average −15
· HRV ≤80% of it −10. Clamped 0-100. **≥70 train · 40-69 light · <40 rest.**

### Two things that are easy to get wrong
- **A muscle you haven't trained all week doesn't appear in `/workouts/muscle-volume` at
  all** — it has no rows to aggregate. Those groups are the *freshest* thing available, so
  they're passed in separately and lead the suggestion. Reading only the endpoint's output
  would recommend the muscle you trained four days ago over the one you haven't touched.
- **A week off must not fake a preference.** With nothing trained, all 13 groups are equally
  fresh and the "top two" are just however `VOLUME_LANDMARKS` is written — so the headline
  becomes "Train — everything is recovered" rather than naming two at random.

### Health baselines exclude the day being judged
Resting HR and HRV are compared against the *prior* days in the window. A baseline that
included today would dilute the very spike being looked for, and a baseline built from a
single synced day is returned as `None` and never compared.

`_muscle_volume` is now one helper read by both `/workouts/muscle-volume` and `/readiness`,
so the dashboard bars and the verdict cannot disagree about whether a muscle is cooked.
**32 tests** (25 pure scoring + 7 endpoint), the pure ones needing no server.

---

## 27. Sunday weekly recap push (2026-07-31, session 11)

A Sunday-evening notification — **"4 sessions · 18.4k kg · 2 PRs"** — that opens `/reports`.
Reports are pull-only, and nobody opens an app to read a report they don't know exists.

Opt-in per user (`weekly_report_push_enabled`, off by default), in Workout settings under the
train reminder. Push-only by nature, so the toggle isn't offered when push is unsupported or
unconfigured.

### It rides the existing cron, it doesn't add a schedule
`POST /api/push/dispatch` now runs two passes — train reminders, then weekly recaps. One
external cron (cron-job.org, every 15 min) drives both. **Until that cron exists both stay
dormant**; nothing else is required to turn this on.

### Idempotent per ISO week, on the user's local Sunday
`weekly_push_due(settings, local_now)` is pure and returns the week key to stamp, or `None`:

- Sunday only, from **19:00 local**, with a **180-minute** window.
- Keyed `YYYY-Www` **zero-padded**, from `isocalendar()` — so Sunday 2027-01-03 stamps
  `2026-W53`, the week it actually closes. Keying it by calendar year would fire twice
  across the new year.
- A cron running four times inside the window sends **once**. A cron that misses Sunday
  entirely sends **nothing** — a stale "your week" on Tuesday is worse than none, the same
  rule the train reminder's grace window follows.

### A quiet week stamps but doesn't send
`weekly_push_body` returns `None` for zero sessions and the dispatcher stamps the week
anyway. Two reasons: a "0 sessions this week" push is a guilt-trip that costs notification
permission from exactly the people least likely to want it, and without the stamp an
untrained user would have it retried every 15 minutes until the window closed.

### The numbers come from the report itself
The body is built from `_report_training` over `_period_bounds("week", 0, local today)` —
the same call `/reports` makes. The push can't say something the page then contradicts.
Sending is extracted to one `_send_push` helper shared with the train reminder, so the two
can't drift on how a dead subscription is dropped.

**19 tests**, all pure except the dispatch-secret guard.

---

## 28. Still not covered

Accurate as of session 9 (challenges). Earlier entries here were superseded — push **has** since been
delivered to a real iPhone (session 6) and the interval/EMOM timer **was** click-tested and is
correct (full work→rest→round trace verified).

- **The share-workout PNG has never been confirmed to generate.** The permanent "Creating
  image…" hang is fixed and a 15s timeout now recovers with a toast, but whether a valid image
  comes out could not be settled in a headless pane. **One tap on a real device answers it.**
- **Push is deployed but dormant** — it needs an external cron POSTing `/api/push/dispatch`.
  Delivery itself is proven; the schedule is not wired.
- **Health sync is blocked on the phone, not the server** — pushing 450 steps through with the
  user's own token stored correctly. `Find Health Samples` returns empty on their device.
- **Chart hover and live-resize re-measurement** (§21) are unverifiable in a non-compositing
  pane; a control test against an untouched chart confirmed both are environment-only.
- **The live workout session's deep interactions** beyond what §18 covers — long multi-exercise
  sessions, supersets under load, rest-timer behaviour across backgrounding — only real gym
  use will exercise these.
