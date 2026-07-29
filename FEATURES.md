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

## 21. Still not covered

- **Push has not delivered to a real browser endpoint** — the dispatch path, auth, pruning and
  idempotency are all tested, but an actual notification arriving on a device needs the keys
  deployed and a real subscription.
- **Prod was never touched** — everything ran against local Mongo.
- **Interval/EMOM timer** and **share-workout image** were not click-tested.
