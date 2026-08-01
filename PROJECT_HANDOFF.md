# LifeOS — Handoff (current as of 2026-07-30)

> Paste this whole file at the start of a new chat. It is complete context — don't re-read old chats.
> **Read §0 first** — it is the only part you need before doing anything.

## 0. Start here

**State (end of session 11):** deployed, live, healthy, and **everything is pushed**.
Backend **211 tests**, frontend **105 tests**, both green — the backend suite run locally
against Mongo, so today's shared-code changes are covered, not just the new endpoints.

**`ROADMAP.md` is the queue.** Read it before picking up work. This file is the chronological log.

**PHASE 0 IS CLEARED — the three long-running user-side blockers are done:**
1. ~~Push cron~~ ✅ live on cron-job.org, every 15 min, verified 200. Train reminders AND the
   Sunday weekly recap are both armed. Side effect: the ping keeps the free Render tier awake,
   so the 30-50s cold start is gone.
2. ~~Health sync~~ ✅ **steps are flowing.** The bug was never the filters and never the server —
   the recipe this repo recommended made Shortcuts send the *sample count*. See §7 session 11d
   and `HEALTH_SYNC_SETUP.md`.
3. **Tap Share** after a workout — STILL OPEN, and now the only one left. The permanent hang is
   fixed; whether the PNG actually generates has never been settled outside a headless pane.
   One tap on a real phone answers it.

**The APK is built and signed** (session 11). ⚠️ `C:\Users\chethan\lifeos-android\android.keystore`
+ `KEYSTORE-PASSWORD.txt` are the only irreplaceable artifacts in this project — lose them and
the app can never be updated by anyone, ever.

**The build queue is empty.** Roadmap items 1-3 shipped, item 4 (progress photos) was **dropped
by the user** after costing it out, item 5 (form check) is parked. Nothing is waiting on code.

**⚠️ A standing gap worth knowing:** several 2026-07-31 features — the readiness card, the
weekly-recap toggle, the reworked dashboard, the rest-timer fix — **have never been seen
rendered.** No logged-in browser session is possible from the agent side (logging in means
typing a password, which the assistant won't do). They pass build + tests and fail safe, but
a human has looked at none of them. Two minutes on a phone closes it.

**The honest recommendation, unchanged for six sessions and now the only thing left: use the
app in a real gym session.** Six modules, none used under real conditions. Every bug that
remains is the kind that surfaces on set four with chalk on your hands.

## 1. What LifeOS is
Personal life-tracking app for me (chethan), going multi-user (me + a friend, invite-only). Started as a Hevy-style workout tracker with an AI progressive-overload layer; now also has habits, sleep, an AI coach, progress analytics, an admin panel, and a health-sync ingest layer. **It is deployed and LIVE.**

## 2. Stack & how to run locally
- **Backend:** FastAPI + Motor(MongoDB), single file `backend/server.py` (~2200 lines), Pydantic models inline, JWT cookie auth (`get_current_user`; `get_optional_user`). Token-auth variant for health ingest.
- **Frontend:** React 19, CRA + craco, Tailwind, shadcn/ui in `frontend/src/components/ui/`. Charts = Recharts. Animation = framer-motion. Confetti = canvas-confetti. Icons = lucide-react.
- **DB:** Mongo in Docker container `lifeos-mongo`. Start: ensure Docker Desktop running, then `docker start lifeos-mongo`. Quirk: sometimes starts without binding host port 27017 right after Docker boots → `docker restart lifeos-mongo` fixes it.
- **Run backend:** `cd backend && python -m uvicorn server:app --host 0.0.0.0 --port 8001` (kill old :8001 process first).
- **Run frontend:** CRA dev server on :3000 (`frontend/.env` has `REACT_APP_BACKEND_URL=http://localhost:8001`).
- **Test login:** `cg3@lifeos.com` / `test1234` (admin). Second real account:
  `chethangowda9@gmail.com` / `cg123456`.
- **Backend tests:** `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -p xdist -p asyncio`
  → **211 passing**. Most hit a LIVE backend on :8001, so start it first or they fail on
  connection-refused (that is not a regression — check the error before believing it).
  **The pure ones don't need a server**: `compute_readiness`, `weekly_push_due`,
  `weekly_push_body`, `merge_daily_metrics` import `server` directly, so
  `-k "not endpoint and not resync"`-style runs work with nothing running.
  `REACT_APP_BACKEND_URL=https://lifeos-api-g6hq.onrender.com` points the suite at prod —
  only do that with **read-only** files (`test_readiness.py`, `test_health_merge.py` clean up
  after themselves); the others create data.
- **Frontend tests:** `cd frontend && CI=true npx craco test --watchAll=false` → **105 passing**
  (pure functions: `features/progress/`, `features/reports/`, `features/workout/lib/`).
- **Build gate before any push:** `cd frontend && CI=true npx craco build` — Vercel builds with
  `CI=true`, so an ESLint warning fails the deploy.
- **npm installs:** always use `--legacy-peer-deps` (pre-existing react-day-picker/date-fns@4 peer conflict).

## 3. Deployment (LIVE)
- **Frontend:** https://lifeos-nine-eta.vercel.app (Vercel, root=`frontend`, `frontend/.npmrc` has `legacy-peer-deps=true`).
- **Backend:** https://lifeos-api-g6hq.onrender.com (Render free tier — sleeps after 15 min idle, first hit ~30-50s).
- **DB:** MongoDB Atlas cluster `lifeos-cluster`.
- **Wiring:** `frontend/vercel.json` rewrites `/api/*` → Render backend (same-origin proxy → no CORS/cookie issues). `api.js` `API_BASE` is absolute locally, `/api` in prod.
- **Deploy flow:** `git push` to `main` auto-deploys BOTH Vercel + Render. Full beginner guide in `DEPLOYMENT.md`.
- **Env vars on Render:** MONGO_URL, DB_NAME=lifeos, JWT_SECRET, FRONTEND_URL, COOKIE_SECURE=true, INVITE_CODE, ADMIN_EMAIL, ADMIN_PASSWORD, GROQ_API_KEY.
- **Prod admins:** `cg3@lifeos.com`/`test1234` (migrated) + `chethangowda98654@gmail.com` (pw = ADMIN_PASSWORD env, hashed/unrecoverable). Both role=admin.
- **Prod requirements notes:** `backend/requirements.txt` needs `httpx` + `dnspython` (for mongodb+srv); unused build-breakers (jq etc.) removed. Seeding is skipped on boot when unchanged via `_seed_signature()` (was a ~10 min cold start).

## 4. Working rules (follow every step)
- **Library-first:** for every block of code, ask "can a library / already-installed dep / built-in do this?" If yes, use it. Fewer lines, simpler.
- **Minimal edits:** change only the lines needed; don't rewrite whole files. Only touch files the task needs.
- **Keep design simple**, no over-engineering. Use `--maroon` / CSS-var tokens, NEVER hardcode colors (accent is user-themeable — currently cyan).
- **Few tokens:** don't re-read old chats/unrelated files; keep replies short.
- Backend: after any `server.py` edit, `python -c "import ast; ast.parse(open('server.py',encoding='utf-8').read())"` before restart; kill old uvicorn first.
- **Verify each feature end-to-end** (curl for API, browser preview for UI) before moving on. Clean up any test data created on `cg3`. Run pytest after backend changes.
- Commit + push each finished feature separately (auto-deploys).

## 5. What's built & LIVE
**Core (working):** Auth (invite-only when `INVITE_CODE` set), Dashboard, Body Metrics, Workout module, AI Coach, Progress. Roles: admin vs user.

**Workout module** (`pages/Workout.jsx`, `WorkoutSession.jsx`, `WorkoutSettings.jsx`, `ExerciseDetail.jsx`):
- Routines + multi-day Plans, Explore programs (14), hero "next up", week strip, custom accent theme.
- Live session: set types, supersets, plate calculator, RPE, rest timer (+15/−15, audio+vibrate), inline stopwatch, bodyweight mode, swap exercise, save-as-routine, post-workout PR celebration **+ confetti**.
- **Apply progression** one-tap, **per-exercise persistent notes** (`exercise_notes`), **share workout image** (`ShareWorkoutCard.jsx`, html-to-image, `skipFonts:true`), **interval/EMOM/HIIT timer** (`IntervalTimer.jsx`).
- Exercise picker (`ExercisePicker.jsx`, Recent + create custom), exercise detail (charts/PRs), muscle heatmap.
  - **Picker refined 2026-07-15** (routine-builder fixes): (1) **multi-select** — tick any number of exercises, footer "Add N" adds them all in one pass (`onAdd(list)`); replace-mode in a live session stays single-tap (`multiSelect={picker?.mode!=='replace'}`, `onPick`). (2) **No duplicates** — `existingIds` prop marks exercises already in the routine/day as "Added" + disabled (RoutineBuilder dedupes across the routine; PlanBuilder per day; both also filter dupes on add). (3) **Filters persist** across close/reopen for the whole build session — filters only reset when the parent bumps `resetSignal` (a `buildId` incremented each new routine/plan build), NOT on every open. (4) **Inline detail** — each row has an info button → opens `ExerciseDetailDialog` (Summary/History/How-to) without leaving the picker.
- Intelligence: progression suggestions, PRs, volume landmarks, plateau/deload flags.

**Workout restructure (2026-07-16) — phases 1-6 done, all deployed & verified**
- **Shared libs** (`features/workout/lib/`): `payload.js` = the ONLY place a workout
  API body is built (numeric coercion; reps/target_reps→int, rest_timer never null,
  drops exercises without `exercise_id`) + `describeApiError`. `stats.js` = the ONLY
  volume/sets/e1rm maths. Used by live save, edit-workout and the offline queue —
  this is what killed the recurring 422 / "volume 0" class of bugs. **Don't
  reintroduce inline payload or volume code.**
- **Session split**: `features/workout/session/` = `SetRow`, `ExerciseCard`,
  `RestTimer`, `StatPill`. `WorkoutSession.jsx` 1431→~950 lines (orchestrator).
- **Routine folders** (Hevy-style): `folder` field on routines, `PUT /routines/{id}/folder`,
  collapsible groups + "Move to folder" in the routine menu.
- **Plans/Splits**: plans now ALSO carry `routine_ids[]` (+`routine_count`, enriched
  `routines[]` on GET). `POST /plans/{id}/import-days` copies embedded days into real
  routines foldered under the plan name — **non-destructive, `days[]` is kept**, no-ops
  if already imported. Applying an Explore program runs this automatically.
- **Two Hevy features shipped**: (1) **"Update routine?"** — a session started from a
  routine that drifts (added/removed exercises) offers to save changes back on finish
  (`routineBaseRef` baseline → diff → `PUT /routines/{id}`). (2) **Finish milestone** —
  "This is your 9th workout" + "That's 4 hours of effort and 7,168 kg lifted", also on
  the share PNG (`/workouts/stats` fetched post-save).
- **Edit a saved workout**: `PUT /workouts/{id}` + `EditWorkoutDialog` (Progress → pencil).
  Edits kg/reps/**RPE**/**set type**, add/remove sets & exercises. Recomputes volume/e1rm,
  keeps the original date. Does NOT re-award PRs.
- **Delete custom exercises**: `DELETE /exercises/{id}` scoped to `{user_id, custom:true}` —
  library exercises are impossible to delete. Trash icon on custom rows in the picker.
- **Mobile fixes**: set-row grid was ~316px of fixed columns on a ~311px phone, which
  collapsed PREVIOUS (rendering "60 kg × 10" truncated to a meaningless "0") and squeezed
  RPE out entirely. Now mobile-first columns + `gap-1` + `px-1` inputs; previous text is
  compact ("60×10"). **Recurring bug pattern: `opacity-0 group-hover:*` = invisible on
  mobile** — this hit the plan-day reorder arrows, routine menu, and Progress edit/delete.
  All made always-visible. Check for this whenever adding row actions.
- **New plan builder**: day-by-day builder (`PlanBuilder`, add days + exercises per day) is
  the flow the user wants. I removed it once (3b70085) thinking it duplicated the routine
  builder — **that was wrong, it was restored**. `SplitEditor` (build a plan by picking
  existing routines) is kept as a secondary option, linked from inside the New Plan dialog.
- **Empty state = goal-filtered recommendation** (RECO_GOALS → program.goal, week-day preview). **Reworked 2026-07-15:** shows exactly **one** best-fit recommendation (no "More programs" list). Dismissing it (× or swipe, `SwipeToDismiss.jsx`) sets `lifeos:reco-dismissed` and stops all recommendations — **no auto-replacement**. The goal prompt + recommendation only appear for a genuine fresh start (`workouts` empty AND not previously built by hand); building a routine/plan manually sets `lifeos:built-manually` which suppresses them permanently. A "Show recommendation" button lets a fresh user un-dismiss. (Old per-program `lifeos:dismissed-programs` key retired.)

**Dashboard** (`pages/Dashboard.jsx`): `TodayHero` band (SVG weekly-goal ring, streak, muscle-recovery chips from `/workouts/muscle-volume`), stat cards, **Weekly AI recap** card (`GET /coach/recap`, Groq), resume/volume chart, records, muscle focus. **First-run onboarding** (`Onboarding.jsx`, redesigned 2026-07-14) for fresh accounts — **full-screen, one-question-per-screen wizard** (name → age → height → weight → sex → goal). Rendered via **`createPortal` to `document.body`** (must — Dashboard's `animate-fade-up` transform would otherwise trap the `fixed inset-0` overlay inside the content area). Progress bar + back arrow + Skip (finishes early). Age/height/weight use `ScalePicker.jsx` (draggable horizontal ruler, scroll-snap; value stays null until the user scrolls, so untouched fields aren't saved). Sex/goal = big card radios. Saved via `updateProfile` (name → top-level, rest → `profile`) → **Body Metrics** auto-fills BMI/BMR + 7 estimates. `PUT /auth/profile` accepts `name`.

**Progress** (`pages/Progress.jsx`): stat boxes, **VolumeTrend** Recharts area (10-wk), **PR trophy shelf** (`GET /records`), WorkoutCalendar, MuscleHeatmap, muscle-volume bars w/ recovery, strength standards, history.

**Habits** (`pages/Habits.jsx`, DONE 2026-07-14): backend `habits`+`habit_logs`; `GET /habits` (today status/streak/history), `POST/PUT/DELETE /habits`, `POST /habits/{id}/log` (check=toggle, count=set value). Two types: check + count(target/unit). Cards w/ emoji, streak, 14-day strip, controls, add/delete dialog.

**Sleep** (`pages/Sleep.jsx`, DONE 2026-07-14): backend `sleep_logs` (upsert per user+date); `GET /sleep` (logs+stats), `POST /sleep`, `DELETE /sleep/{id}`. Stat tiles, Recharts duration trend (≥2 nights), nights list w/ quality stars, log dialog (bedtime/wake auto-computes hours, 1-5 stars).

**Intake** (`features/intake/`, backend `backend/intake.py` self-contained router; DONE): calorie/macro/micro tracker. Log by **photo** (`analyze/photo`) or **text** (`analyze/text`) → LLM (Groq, falls back to Claude) returns structured items via `ANALYZE_SCHEMA`; also manual entry, targets, and a "what should I eat now" suggest. Entries stored per item with `nutrients` + `quantity`; **daily totals = nutrients × quantity** everywhere (`_scaled`/`_scaled_totals`, frontend shows `× qty`). `AnalyzeDialog.jsx` = the "Is this right?" confirm screen.
  - **Fixed 2026-07-15 (3 changes):** (1) **QTY field** — was `Math.max(Number(v)||0.25, 0.25)` so it snapped to 0.25 and couldn't be cleared or set to 0.5. Now a free-typing decimal (`type=text` + `inputMode=decimal`, regex-guarded), fully clearable, accepts 0.5/2/etc.; normalized to `1` on blur; math uses a `qtyNum()` parse helper (empty→0 live, `||1` on save). (2) **Per-piece quantity model (HealthifyMe-style)** — analyze schema now returns **`unit_count`** (piece count for countable foods: dosa/roti/idli/egg/…) with nutrients **PER SINGLE PIECE**; non-countable (rice/dal/chutney) → `unit_count=1`, whole-portion macros. Frontend seeds QTY from `unit_count`, so "3 ragi dosa" shows **QTY 3** with per-piece macros (edit the count directly, scale by piece). `_clean_item` clamps unit_count 1–50. (3) **Accuracy** — `ANALYZE_SYSTEM` now calibrates Indian portions (ragi dosa ~120-160 kcal/piece, coconut chutney ~90-130 kcal, don't under-count oil/ghee) + "be consistent between runs". Verified live: "3 ragi dosa + coconut chutney" → dosa unit_count 3 @ 140 kcal/piece = **420 kcal/12g protein** (matches HealthifyMe 410/11; was 210/5), chutney **120 kcal** (was 20). Backend 39 tests still pass.

**PWA** (DONE 2026-07-14): installable + offline app shell. `public/manifest.json` (name/short_name, maroon `theme_color` #c0152a, standalone, start_url `/dashboard`, 192/512/maskable icons), `public/sw.js` (cache `lifeos-v1`: precache shell, network-first navigations w/ offline fallback to cached `index.html`, stale-while-revalidate for static, **skips `/api`**), registered in `src/index.js` **prod-only** (avoids dev HMR cache issues). iOS meta + `apple-touch-icon` in `index.html`. Icons generated by Pillow (maroon dumbbell). Verified: SW active/controlling, hashed JS+CSS cached → boots offline. **Offline write-queue DONE 2026-07-14** (`lib/offlineQueue.js` + `hooks/useOfflineQueue.js`): if `POST /workouts` (or save-as-routine) fails with a network error / `!navigator.onLine`, `WorkoutSession.submitSave` enqueues it to localStorage (`lifeos:offline-queue`), still shows the summary, and toasts "Saved offline". Auto-flushes on the `online` event + 1.5s after load; replays via `api` (re-attaches Bearer), drops on 4xx, keeps on network/5xx. Header shows a "N to sync" pill (`useOfflineQueue`), Layout toasts on flush. App-level (works on iOS, unlike Background Sync). **Not yet:** real background push (train reminder still in-app via `hooks/useTrainReminder.js`); queue currently only wired to workout save (habits/sleep/health still fail hard offline).

**Navigation** (`components/Layout.jsx`): desktop = fixed left sidebar (`hidden md:flex`); **mobile = hamburger in header → slide-in `Sheet` drawer** (added 2026-07-14; both share one `SidebarBody`). Before this, mobile had NO nav at all. Testid `nav-mobile-toggle`.

**Admin panel** (`pages/Admin.jsx`, admin-only): `GET /admin/users` (+workout_count), `GET /admin/stats`. Triple-gated: nav link only for admin, route redirect for non-admins, API 403.

**Health sync / Connections** (`pages/Connections.jsx`, DONE 2026-07-14; ingest widened 2026-07-14): brand-agnostic ingest — **goal is ANY watch/phone, not one brand**. The hub is Apple Health (iPhone) / Health Connect (Android); any device (Apple Watch, Garmin, Fitbit, Fastrack, phone pedometer) writes there and a phone automation POSTs to us. Backend: per-user `health_token`; `GET /health/connection`, `POST /health/connection/regenerate`, token-authed `POST /health/ingest` (X-Health-Token). Ingest now accepts a wide param set via `HEALTH_DAILY_FIELDS`: steps, distance_km, resting_hr, avg_hr, hrv, spo2, stress, respiratory_rate, active_energy → `health_daily`; sleep_hours/quality → `sleep_logs`. `GET /health/daily`. Page: live tiles (config-driven: core steps/HR/kcal always, distance/HRV/stress/SpO2 show when synced), masked key (reveal/copy/regenerate), endpoint, per-platform setup guide. **Dashboard** shows a "Today's health · from your watch" strip (`HealthStrip`, renders only when today has data). Health + sleep now feed the AI coach (see §6).

## 6. AI coach
Prod uses **Groq Llama 3.3 70B** (`GROQ_API_KEY` set → `coach_provider()`="groq", `GROQ_MODEL`=llama-3.3-70b-versatile). Falls back to Claude if only `ANTHROPIC_API_KEY`. `build_user_context()` feeds the coach the user's real data; `/coach/chat` + `/coach/recap`. **Context now includes** a 7-day health-sync avg (steps/distance/resting HR/HRV/stress/SpO2/active energy) + recent sleep (avg hours + quality); `COACH_SYSTEM` tells it to factor low sleep / high stress before pushing hard training.

## 7. Open threads / pending

**SESSION 11g (2026-07-31) — the health-sync recipe is now in the app, not just the docs.**
- `Connections.jsx` shipped guidance that produced the broken shortcut (*"Get Health Sample →
  Get Contents of URL with JSON"*). It now carries the **verified three-action recipe**, a
  copyable `/health/ingest/raw?metric=…` URL per metric, and the right statistic for each —
  **Average for resting HR and HRV, Sum for the rest**, because summing a heart rate is
  meaningless.
- Both traps are stated in the UI, not only in `HEALTH_SYNC_SETUP.md`: posting the
  `Health Samples` variable sends the **sample count** and still reports `stored: true`, and a
  **background automation can never show the iOS Health permission prompt**.
- `rawUrl(metric)` is derived from `API_BASE` the same way `ingestUrl` already was, so it is
  correct in local dev (absolute) and prod (origin + `/api`).
- ⚠️ **This is the app's weakest onboarding path** — the first thing a new user hits, and the
  only feature whose setup happens entirely outside the app. Keep the in-app copy and
  `HEALTH_SYNC_SETUP.md` in step; they drifted once and it cost a user an hour.
- **Each recipe row now shows whether that metric has ever arrived** — solid + `✓ last <date>`,
  or dashed + `not set up`, with an `N of 6 connected` count. Wiring one shortcut per metric is
  the fiddliest thing in the app and nothing used to say which ones you'd actually done: a user
  wires steps, assumes "health sync is set up", and never notices sleep and resting HR are empty
  — so `/readiness` silently scores on training data alone.
- **Sleep is detected differently** — it lands in `sleep_logs`, not `health_daily`, so it's found
  via the `source: "sync"` marker the ingest writes. A night logged by hand on the Sleep page
  correctly does NOT count as connected. `/health/daily` returns `days` date-desc, so the first
  hit for a metric is its most recent.
- Verified against real API responses on a local backend (steps + resting HR via `health_daily`,
  sleep via the sync marker, the other three correctly absent), test rows deleted afterwards.
- Only `steps` is wired on the user's phone so far. Sleep and resting HR are the two worth
  adding next — both feed `/readiness`, whose sleep and HR branches are otherwise dormant.

**SESSION 11f (2026-07-31) — dashboard rethought. Readiness moved to Workout.**
- **`ReadinessCard` now lives on the Workout page**, directly above the "next up" hero, in
  `features/workout/components/ReadinessCard.jsx`. It is a **decision, not a status**, and on
  the dashboard it was split from the button you press about it — the app could say "chest is
  over MRV, train legs" on one screen while offering Push Day A on another. It self-fetches
  like `WeeklyRecap` and renders nothing if `/readiness` fails, so it needs nothing from the
  host page's load orchestration.
- **The dashboard lost four sections that duplicated Progress**: volume chart, recent-workouts
  list, PR shelf, muscle-focus bars. Progress already has `VolumeChart`, `PRShelf`, the workout
  list, and the weekly muscle-volume bars + `MuscleHeatmap` — all better. Half the dashboard was
  a second, worse analytics page. **Verified against `Progress.jsx` before deleting**, not
  against the docs.
- **Also deduped earlier in the session**: week count and streak were in the hero ring AND in
  their own stat cards below it (4 stat cards → 2, weekly volume folded into the hero subtitle);
  the hero's recovery chips went with the readiness card. `/workouts/muscle-volume` is no longer
  fetched by the dashboard at all.
- **Dashboard is now six sections**: greeting (links to Progress) · Life Score · week band ·
  health strip · two all-time stats · weekly AI recap · resume. Recharts is no longer imported
  there. Orphaned testids removed rather than left pointing at deleted elements.
- **The rule to keep:** a dashboard answers *"how am I doing"* and offers one way in. Status,
  not workspace. If a new widget is a decision or a deep-dive, it belongs on the page that owns
  the thing.
- Verified: build clean, 105 frontend tests green, and the **full backend suite — 211 — run
  locally against Mongo**, so the session's shared-code edits (`_muscle_volume` extraction,
  the `push_dispatch` refactor, both ingest paths) are covered, not just the new endpoints.
  ⚠️ **Still never seen rendered** — no logged-in browser session is possible here.

**SESSION 11e (2026-07-31) — a resync can no longer erase a real health day. `FEATURES.md` §11.**
- `steps` / `distance_km` / `active_energy` are **monotonic within a day** — `merge_daily_metrics`
  keeps the higher value and returns `kept_existing`. Guards BOTH `/health/ingest` and
  `/health/ingest/raw`. Everything else still overwrites: a falling resting HR is real.
- Written because of the §11d bug — the sample-count sync stored `8` over `52` with `ok:true`.
  **Neither bounds nor payload shape can catch that class**: 8 is a legal step count, and a
  correct `Sum` arrives as a bare number exactly like a wrong count does. The day's own
  history is the only signal available, so that is what the guard uses.
- Also closes the two-device case the user asked about — a phone left on a desk can't clobber
  the day recorded by the phone actually carried.
- Verified: **19 tests** (17 pure + 2 end-to-end). The e2e ones take a health token, write to
  **2019-03-14 / 2019-03-15** on `cg3` and delete both in a fixture that also runs *before* the
  tests, so a failed run can't leave residue. Confirmed clean afterwards — no 2019 rows left.
  **The two e2e tests must not share a date** — the guard is stateful, and 11,000 steps from
  the first test would make the second one's 9,000 look like a decrease.
- Ran with the other new suites against the deployed backend: **71 passing.**

**SESSION 11d (2026-07-31) — PHASE 0 IS CLEARED. Push cron live, steps syncing.**
- **Push cron is live** — cron-job.org "LifeOS push", every 15 min, `POST /api/push/dispatch`
  with `X-Dispatch-Secret`, 30s timeout. Verified 200 / `{"ok":true,...}` in 3.9s. Train
  reminders and the Sunday recap are both armed and the toggles are on. Side benefit: the
  15-minute ping keeps the free Render tier awake, so cold starts are gone.
- **Steps are syncing.** Five sessions of "blocked inside Shortcuts" — and the filters were
  never wrong. Type/Start Date/Limit were all correct from the start.
  **The actual bug:** the 2-action recipe THIS FILE recommended (post the `Health Samples`
  variable straight to `/ingest/raw`, let the server sum it) serialises on iOS 26 to **the
  number of samples**. It sent `8` while Health showed `52` — `stored: true`, no error, a
  plausible small number written to the DB. Worst failure mode there is.
  **Fix:** `Find Health Samples → Calculate Statistics (Sum) → POST the Sum variable to
  /api/health/ingest/raw?metric=steps`. The variable is named **`Sum`** in the picker, not
  "Statistics". `HEALTH_SYNC_SETUP.md` now leads with this and retracts the old advice.
- **The server cannot detect this class of error.** A correct Sum and a wrong sample count
  arrive as the identical payload — a bare number. Only the Health app can say which. So the
  setup doc now says: check the first run against Health → Steps → today before trusting it.
- **Also worth keeping:** a background automation can never show iOS's Health permission
  prompt, so a shortcut that was only ever run on a schedule fails silently forever. Run it
  by hand once with ▶ first.
- Left for the user: `resting_hr` / `hrv` / `sleep_hours` each need their own
  Find→Sum→POST pair (change `?metric=`); only `steps` is wired so far.

**SESSION 11c (2026-07-31) — Sunday weekly recap push shipped. See `FEATURES.md` §27.**
- **`/push/dispatch` now runs two passes** — train reminders, then weekly recaps. One cron
  drives both; no second schedule. Response gains `weekly_sent`, existing keys unchanged.
- **`weekly_push_due(settings, local_now)` is pure** — Sunday, from 19:00 local, 180-minute
  window, keyed `YYYY-Www` from `isocalendar()` and stamped on `workout_settings.last_weekly_push`.
  Zero-padded, ISO year not calendar year (Sunday 2027-01-03 → `2026-W53`, or it double-fires
  across new year). A cron running 4× in the window sends once; a missed Sunday sends nothing.
- **A quiet week stamps but doesn't send.** Zero sessions → no body → no push, but the week is
  still stamped or it retries every 15 minutes all evening.
- **Body comes from `_report_training`** over the same bounds `/reports` uses — the push must
  never say something the page contradicts. Sending is one shared `_send_push`.
- Opt-in toggle in Workout settings (`weekly_report_push_enabled`, off by default), shown only
  when push is supported + configured. Enabling it re-stamps `tz_offset_minutes`, since the one
  saved at subscribe time can be a timezone or a DST change out of date.
- Verified: **19 tests** (18 pure + the dispatch-secret guard), run against the deployed
  backend along with the readiness suite — **52 passing**. Frontend build clean.
- ⚠️ **Delivery itself is still unproven for this payload** and cannot be proven from here: it
  needs the Phase 0 cron, a real Sunday evening, and a subscribed device.

**SESSION 11b (2026-07-31) — should-I-train-today shipped. See `FEATURES.md` §26.**
- **`GET /readiness`** + `ReadinessCard` on the dashboard, above the Life Score. Score 0-100 →
  `train` / `light` / `rest`, plus what to train, what to leave alone, and every reason with
  the points it cost. `score == 100 + sum(effects)`, and a test says so.
- **Not an LLM call, on purpose.** Every input is a number; an AI summary would cost a round
  trip to restate figures the page already holds and would be free to drift from them.
- **`_muscle_volume` is now one helper** read by `/workouts/muscle-volume` and `/readiness` —
  a test asserts the two agree, so the dashboard bars can't contradict the verdict.
- **The trap worth remembering:** a muscle untrained for 7 days has no rows to aggregate, so it
  is absent from muscle-volume entirely. Those are the freshest groups — they're passed in
  separately and lead the suggestion. And a full week off must not fake a preference: the
  headline becomes "everything is recovered" rather than naming two groups at random.
- **HR/HRV branches are dormant** until the Phase 0 health sync is fixed; sleep + training data
  carry the verdict alone until then. Baselines exclude the day being judged, and a baseline
  from a single synced day is `None` and never compared.
- Verified: **32 tests** (25 pure scoring, run with no server; 7 endpoint contract) — the
  endpoint ones run **against the deployed Render backend**, because Docker Desktop would not
  start locally this session. Frontend build clean, 105 frontend tests green. Live output on
  `cg3` reads correctly (95/100, "2 exercises plateaued", −5).
- ⚠️ **Not browser-verified.** The card has never been seen rendered — no logged-in session was
  possible here. It fails safe (the fetch `.catch`es to null and the card returns null), but
  the layout at 375px is unconfirmed.

**SESSION 11 (2026-07-31) — APK shipped. See `APK_SETUP.md`.**
- **Sessions 9-10 pushed** (reports, achievements, challenges, quick-log) — that clears the
  last Phase 0 code item. Vercel + Render both redeployed.
- **Signed APK + AAB built locally** with Bubblewrap (TWA around the live site), outside the
  repo in `C:\Users\chethan\lifeos-android\`. Package `com.cglifeos.app`, v1.0.0, minSdk 21 /
  target 36, `POST_NOTIFICATIONS` included so web push works inside the shell.
- **The real signing SHA-256 is live in `assetlinks.json`** — verified served from the domain,
  and it matches the APK's signer. That's what removes the URL bar.
- ⚠️ **`android.keystore` + `KEYSTORE-PASSWORD.txt` are the only irreplaceable artifacts in
  this project.** Lose them and the app can never be updated by anyone, ever. Not in git
  (correctly — they're secrets). Backing them up is on the user.
- Rebuild = `bash C:/Users/chethan/lifeos-android/twa/rebuild.sh`, and is only needed for
  name/icon/colour/version changes. Features reach the app via `git push`, no re-release.
- Toolchain gotchas that cost time are written up in `APK_SETUP.md` (broken `@bubblewrap/cli@1.25.0`,
  SDK layout, build-tools 36.1.0, `appVersion` not `appVersionName`).
- **Bug fixed:** the workout hero flashed the goal prompt + recommendation for ~a second on
  mount — `/programs` resolved before `/workouts`, so the empty state briefly saw "programs
  loaded, zero workouts". Now all four loads settle before the hero renders (skeleton until
  then). Most visible returning from workout settings. Not browser-verified logged-in; build
  gate clean.

**SESSION 9 (2026-07-30) — weekly/monthly reports shipped. See `FEATURES.md` §22.**
- **New route `/reports`** (nav item between Progress and Connections, plus a "Full report →"
  link on the dashboard recap card). One week or one month at a time, stepped with ‹ ›.
- **`GET /reports` returns computed numbers only**; `POST /reports/narrative` writes the AI
  summary and is handed **exactly those numbers as JSON**, not `build_user_context`. Every
  figure the coach cites is on the page as text beside it — keep it that way. The page works
  fully with no AI configured.
- **Narratives are cached** per `(user, period, start)` in `db.reports` with a `signature` hash
  of the headline numbers; when the data moves the card shows a stale banner and a Rewrite
  button. Don't make generation implicit — one page view must not equal one LLM call.
- **A running period is scored on `days_elapsed`**, not the full 7/30 — a habit at 2/7 on a
  Tuesday reads as failure. `today` is the caller's local date, same as `/life-score`.
- **Hard sets reuse the `/workouts/muscle-volume` rule** (no warm-ups, no RPE<6) while volume
  counts everything, matching `/workouts`. Deliberate — no two screens should disagree.
- **`RecapText` moved to `components/AiText.jsx`**, now shared by the dashboard and the report.
- Verified: 24 new backend tests (bounds incl. leap year, year rollover, Sunday; delta-based
  training assertions that revert exactly on delete); July report reconciles with
  `/workouts/stats` (13 / 6,495 kg / 26 / 5,846 s); browser click-through of period switching,
  the stale banner, Rewrite, `LoadError` + retry via XHR sabotage; 375px clean, 0 console errors.
- **Not included on purpose:** no charts (Progress owns those), no export/share of a report,
  no scheduled "your week is ready" push. Those are the obvious next steps if it gets used.

**SESSION 9b (2026-07-30) — achievements shipped. See `FEATURES.md` §23.**
- **New route `/achievements`** (nav item after Reports, plus a "Badges →" link on the
  dashboard Personal-records card). 29 badges across Consistency / Volume / Strength / Habits /
  Recovery / Nutrition.
- **Badges are DERIVED, never logged.** The catalogue is one list in `server.py`
  (`ACHIEVEMENTS`) of `{key, group, icon, metric, target, name, description}`; every metric is
  recomputed per request by `_achievement_metrics()`. Adding a badge = adding one dict.
- **A badge cannot outlive its data.** Only the first-observed moment is stored
  (`db.achievement_unlocks`); if the numbers fall back below the threshold the stored record is
  **deleted** and the badge locks again. Deliberate — same lesson as the §14 ghost PRs.
- **First read of an existing account is recorded as already seen**, so months of history don't
  produce 18 simultaneous "New" flags. After that, `new` survives being read and clears only on
  `POST /achievements/seen` (fired by the page on view).
- **Locked badges show progress** (`next_up` = the three nearest misses). A locked badge must
  never carry an `unlocked_at` — there's a test for it.
- `craco.config.js` now maps `@/` for **Jest** too; webpack had the alias and Jest didn't, so a
  pure module importing `@/...` built fine and failed only under test.
- Verified: 11 new backend tests incl. the full earn → new → seen → delete → retract lifecycle;
  browser click-through of the same lifecycle on real data (2 badges lit up, chip cleared,
  both retracted on delete); LoadError + retry in place; 375px clean, 0 console errors.

**SESSION 10 (2026-07-31) — quick-log shipped + `ROADMAP.md` created. See `FEATURES.md` §25.**
- **`ROADMAP.md`** is the new queue: Phase 0 is the free, user-side work everything else
  depends on (steps sync, push cron, tap Share, push the commits), then a ranked build list.
- **Quick-log** — type or say `bench 80 by 8 rpe 8` in the live session's sticky header.
  `features/workout/lib/parseSetEntry.js` (pure, 47 tests) + `session/QuickLog.jsx`.
- **The parse is LOCAL and must stay that way.** A gym has no signal and you're mid-set — an
  API round-trip on the common path (`80x8`) would be the wrong architecture. An LLM fallback
  is for phrasings the grammar can't reach, never the default.
- **Voice is the browser's own recogniser** — on-device, no upload, no API cost, mic hidden
  where unsupported. Speech quirks are handled *in the parser*: "×" transcribes as **"by"**,
  and numbers come back as words (`eighty by eight`).
- **Undo, not confirm** — a confirm costs a tap in the moment being optimised; undo restores
  the prior set rather than deleting.
- **Guard rails that matter:** `@`/`rpe` only (a bare "at" means weight); weight >1000 kg and
  reps >500 refused; an unmatched exercise name errors rather than logging onto whatever is in
  focus; `lbs` rejected rather than stored as kg.
- **`celebratePR()` extracted** from `toggleComplete` and shared, so a PR logged by voice
  celebrates like a tapped one. Quick-log starts the rest timer too — the paths match.
- Verified live on two deliberately ambiguous lifts: volume moved 400 → 1040 kg exactly, undo
  restored it, name-routing beat focus, append-when-full worked, bodyweight and warm-up
  parsed, refusals changed nothing. 105 frontend tests green, build clean.
- ⚠️ **Surfaced a pre-existing mobile bug, not fixed here:** the *rest timer* row
  (`−15 / 00:42 / +15 / skip`) overflows ~12px past the right edge at 375px. It only shows
  while a timer runs, which is why earlier mobile passes missed it. Filed separately.
- Backend untouched this session — pytest not re-run (nothing to regress).

**SESSION 9c (2026-07-30) — challenges shipped. See `FEATURES.md` §24.**
- **New route `/challenges`** (nav item after Achievements). Four templates (75 Hard, 30-Day
  Cut, 21-Day Reset, 14-Day Consistency) plus a custom builder. **One challenge at a time.**
- **A rule names a metric; seven of the eight are read from logged data** (workouts, steps,
  sleep, calories ceiling, protein, food logged, all-habits-done). Only `manual` is a tick.
  **Hand-ticking a derived rule returns 400** — if the box can disagree with the data underneath
  it the challenge means nothing. Keep that boundary.
- **Strict mode (75 Hard) is derived, not destructive.** Nothing is reset; the current run is
  measured from the day after the last miss, so the grid keeps every completed day and
  `restarts` is a fact about the data. Three misses in a row = **one** collapse. **Today can
  never be a miss** — it counts toward `current_day` but toward `streak` only once met.
- **Rule keys are assigned server-side** (`r1`…) because they are the join key for manual ticks.
- Two guards worth keeping: a ceiling rule needs *something* logged before it can pass (an empty
  food diary is not a day under 2,000 kcal), and `habits_all` fails when no habits exist (0 of 0
  would be a free tick).
- Verified: 20 backend tests incl. the full strict-restart maths; browser click-through of a
  template start with an edited target, the custom builder, a manual tick, a real workout
  flipping a derived rule, and abandon → history. 75-day grid wraps at 375px, 0 console errors.
  **Bug found by testing:** `dayGrid` used `toISOString()`, shifting every cell back a day east
  of UTC — now `lib/localDate`, with a test.
- **Not included on purpose:** no challenge reminders/push, no sharing, no rest-day allowance
  (75 Hard has none by definition; a "days off" rule would be the first thing to add if asked).

**SESSION 8 (2026-07-30) — Progress rebuilt as a full analytics view. See `FEATURES.md` §21.**
- **New:** `features/progress/analytics.js` (pure functions, 22 unit tests) + `charts.jsx`.
  `Progress.jsx` consumes them; the old inline `weeklyVolume`/`VolumeTrend` path is replaced.
- **One filter row scopes the whole page** — 4W/12W/6M/1Y/All + a Charts/Table switch. Never
  add per-chart filters; every number on the page must describe the same slice.
- **Bucket width follows the range**: weeks ≤ ~12, months beyond (a year as 52 weekly columns
  is noise). `bucketMode()` owns this — consistency is "share of buckets with ≥1 session", so
  its label changes between "weeks trained" and "months trained".
- **Five charts, all SINGLE-series in `hsl(var(--maroon))`** — deliberate: one series means no
  categorical palette, so the user's themeable accent and dark mode flow through untouched.
  **Do not add a multi-hue palette here without validating it for colour-blindness.**
  Muscle groups are nominal → every bar the same colour (shading by size double-encodes the
  length the bar already shows). Strength uses the *emphasis* form: one exercise at a time.
- **Table view is not optional decoration** — it is the reason tooltips are allowed to exist.
  Any new chart needs its values reachable as text too.
- **Two bugs found by testing, not reading:**
  - Training a lift twice in a day produced several points sharing one x-label ("Jul 2, Jul 2,
    Jul 2") — reads as a broken axis. `strengthSeries` now groups **by day**, taking the day's
    best *working* set. Two unit tests guard this; they were confirmed to fail against a
    deliberately reverted implementation.
  - `GET /workouts` caps at **200** sessions, so "All" would silently under-report a long
    history. When the cap is in play the headline falls back to `/workouts/stats`.
- **Mark specs were verified in the DOM**, not assumed: bars exactly 24px with 4px rounded tops
  square at the baseline, 2px round-capped lines, r=4 dots ringed 2px in the surface colour,
  solid hairline grid, axis text in muted ink (never the series colour).
- **Chart animation is off on purpose** (`isAnimationActive={false}`) — deterministic render,
  and it removes a class of "chart is blank" failures.
- **Could NOT be verified in this environment** (both confirmed environment-only via a control
  test against an untouched chart): chart **hover/tooltips** (Recharts uses React synthetic
  events; the pane does not composite) and **live window-resize re-measurement** (ResizeObserver
  callbacks are delivered during the rendering steps, which a hidden page skips). Charts size
  correctly **on mount** at both 375px and desktop, with no horizontal scroll.

**SESSION 7 (2026-07-29) — systematic polish pass. Suite 66 → 85.**
- **A failed load no longer looks like an empty account.** Habits, Sleep, Progress, Body
  Metrics, Connections, Admin and Workout all caught nothing on load, so a server hiccup
  rendered the EMPTY state — indistinguishable from "you have no habits yet". Workout was
  worst (its empty state invites "Create a routine", so a failure could cause duplicates);
  Body Metrics worse still (`refresh()` had no `try` at all → unhandled rejection, zero cards).
  New shared `components/LoadError.jsx` with retry, wired into all seven. Pages whose
  remaining content would render blank return early instead.
  **Verified by forcing every /api call to fail at the XHR layer**: all 7 show the error,
  none show the misleading empty state, and Try again recovers.
- **Input validation at the edge.** Sleep hours were unbounded (a 9999 wrecked the average
  AND the Life Score); `quality` had a documented 1-5 that was never enforced; habit `type`
  was free text so a typo silently became a check habit ignoring its target; date fields were
  raw lookup keys with no format check, so a bad one was written then never matched again —
  the log just vanished. All bounded now. Health payload bounds are deliberately generous
  (catch a mis-mapped automation field, not police physiology), and `/health/ingest/raw`
  reuses the same model so it can't bypass them.
  - **Body-metric ceilings are PER METRIC** in `METRIC_DEFS["max"]`. My first attempt used one
    global bound and rejected a legitimate BMR of 1700 kcal/day — caught by an existing test.
- **Malformed path id returned 500** on habits/sleep where every other module returned 404.
  One `_oid()` helper; all consistent now.
- **Icon-only buttons had no accessible name** — including the complete-set button, the most
  pressed control in the app. Now "Complete set 3" / "Undo set 3" with `aria-pressed`. The
  habit +/− are named too. (Also why they were the hardest things to drive in testing.)
- **AI Coach copy button was hover-only** → unreachable on mobile, the primary platform.
- **Clicked through everything**: 11 routes, 128 buttons, **0 console errors, 0 unhandled
  rejections**. Exercised: all 7 settings toggles + rest presets + the new weekly-goal picker
  (all round-trip with zero drift), habit create→count→delete, body-metric log + ceiling
  rejection, sleep log → Life Score unlocking at 2 signals (0 + 93 → 46), intake
  create→update→delete with correct quantity scaling.
- **Left alone deliberately:** the offline queue (user asked to hold it).
- **Note for testing:** headless Radix leaves a `data-state="closed"` overlay AND
  `body{pointer-events:none}`; clicks silently miss until both are cleared. Real browsers are
  fine. Also — do NOT remove `[data-state=closed]` nodes wholesale via JS, it damages the app
  DOM; reload instead.

**SESSION 6 (2026-07-22) — push live on a real phone, share-button hang fixed, Life Score built.**
- **Push notifications are LIVE and proven on the user's iPhone.** VAPID keys +
  `PUSH_DISPATCH_SECRET` are set on Render; `/push/config` reports `configured: true`.
  A real dispatch returned `sent: 1` and the phone buzzed with the app closed.
  **Still missing: the cron.** Reminders only fire when something POSTs
  `/api/push/dispatch` with header `X-Dispatch-Secret`. Set up cron-job.org (every 15 min)
  or they never fire on their own.
- **Train reminders were firing hours late** — a 2 PM reminder fired at 5:17 PM the moment
  the app was opened, because both paths only checked "now >= set time" with a once-a-day
  guard. Both now use a **120-minute grace window** (`GRACE_MINUTES` frontend,
  `PUSH_GRACE_MINUTES` backend, kept equal). Verified at the boundary.
- **Share button hung forever.** Tapping Share left it disabled on "Creating image…"
  permanently — `toPng` neither resolved nor rejected, so `finally` never ran. Added a
  15s timeout (verified live: fails at 15.2s with a toast, button recovers) and resolved
  the body-map colours to literals since CSS vars don't survive SVG serialisation.
  **The image still doesn't generate in headless Chrome** — root cause narrowed to the
  `rbh` SVGs rendering at `width="100%"`, not confirmed. **Ask the user to tap Share on a
  real device**; that settles whether it's a real-device bug or a headless artefact.
- **Life Score shipped** — `GET /life-score` + dashboard ring. Fitness / Nutrition /
  Habits / Sleep / Activity, each 0-100, averaged. **Design rule: only score what the user
  actually tracks** — averaging zeros for unused modules would tell a dedicated lifter their
  life is a 40. Sleep scores by *distance* from 7.5h so 9h ≈ 6h. Testing on real data caught
  that a single tracked area produced a demoralising "0", so the overall is now **withheld
  until 2+ areas** are tracked with a nudge instead.
- **Weekly training goal is now a setting** (`weekly_workout_target`, default 4) instead of
  two hardcoded 4s that had to stay in sync — a 6x/week lifter was capped at 67% Fitness.
- **Health sync is BLOCKED on the phone, not the server.** Proven: pushing 450 steps through
  with the user's own token stored fine. `Find Health Samples` returns empty on their device
  despite Steps permission being on and Health showing 400+ steps. Added
  `POST /health/ingest/raw?metric=steps` (sums samples server-side, 2-action recipe) and
  `DELETE /health/daily/{date}`. Next diagnostic: **Quick Look after Find Health Samples**.
- ⚠️ **The integration suite has NOT run since the Life Score work.** Docker refused to start
  all evening (4 attempts). Every test fails on connection-refused without local Mongo.
  **Run `pytest` first thing when Docker is back.** The last verified state was 47 passing.

**SESSION 5 (2026-07-21) — every remaining gap closed. 2 more real bugs found + fixed. See `FEATURES.md` §19.**
- **Multi-user isolation: 8/8, no leaks.** Registered a real second user. B can't see A's
  workouts or routines, A **can't delete B's routine** (404), B inherits no PRs, B is 403'd from
  admin, health tokens are per-user, and A's token can't write into B's data.
- **Push tested with REAL VAPID keys — and it caught a bug.** The dispatch handler only caught
  `WebPushException`; a corrupt stored `p256dh` raises `ValueError` in the crypto layer instead,
  which **500'd the whole dispatch run**. That endpoint serves EVERY user, so one bad
  subscription row would have cost everyone their reminder. Now bad subs are logged, dropped and
  the run continues (`{sent, dropped}`). Verified: dropped=1, run OK, re-dispatch sent 0.
- **Superset orphaning — found and fixed.** Superset Bench+Row then **replace** Bench: the
  replacement came back with `superset_group_id: null` (buildExercise starts at null) while Row
  kept the group id — Row was left **alone in a superset of one** and saved with a meaningless
  group id. Fix: the replacement now **inherits** the group, plus a new `pruneLoneSupersets()`
  clears any group with <2 members, wired into both replace and remove. Verified both ways.
- **Add-exercise mid-session** works — picker opens, search filters, selection adds.
- **47 tests pass · `CI=true npx craco build` clean · DB restored** (13 workouts, Bench PR 99 kg,
  5 users, zero ZZ leftovers, test user purged).
- **Genuinely remaining:** real push delivery to a device (needs keys deployed + a real
  subscription), interval/EMOM timer, share-workout image. Prod never touched.

**SESSION 4 (2026-07-21) — live workout session fully clicked through + the port question settled.**
- **Remaining click-gaps are now only: supersets, Add-Exercise mid-session, real push delivery,
  and multi-user isolation.** Everything else in the app has been driven by hand.
- **47 tests pass · `CI=true npx craco build` clean · DB restored to the 13-workout baseline
  (Bench PR back to 99 kg, profile weight 75, zero ZZ leftovers).**
- **The `$PORT` question — RESOLVED, doc fixed.** The uncommitted `DEPLOYMENT.md` edit that changed
  the Render start command to `--port 8001` was **wrong**. Evidence: `render.yaml` (the blueprint
  Render actually deploys from) uses `--port $PORT`, and prod
  (`https://lifeos-api-g6hq.onrender.com/api/`) answers `{"app":"LifeOS","status":"ok"}` — proving
  it binds Render's dynamically-assigned `$PORT`. Hardcoding a number makes Render's health check
  hit a dead port and the deploy fail. DEPLOYMENT.md is now back to `$PORT` **with a warning note**
  so nobody re-applies that edit.
- **Live workout session tested end to end** (the screen previously listed as untested — see
  `FEATURES.md` §18). Verified by clicking: start-from-routine, previous-values column, progression
  "Apply" (filled all 3 sets with 99 kg at one tap), kg/reps/RPE entry, set completion →
  **volume computed exactly right (99×8 = 792 kg)**, rest timer auto-start + ±15 + skip, the
  set-type menu, warm-up correctly **excluded from volume**, and the plate calculator — which
  correctly warned *"0.75 kg per side can't be loaded with your plates — closest load: 97.5 kg"*.
- **Draft/resume survived a full page reload** — the "fragile part" the handoff warned about, and
  the reason session `mode="edit"` was never built. Reloading mid-session prompted
  *"Resume unfinished workout? … 1 sets logged · 3 exercises"* and Resume restored volume, set
  count, every input **and** the warm-up set type. No data loss.
- **Environment artifact (NOT a product bug):** in headless Chrome, Radix dialogs/menus stay
  mounted at `data-state="closed"` with `pointer-events:auto` because the CSS `animationend` they
  wait on never fires — the invisible overlay then swallows clicks. This is what made 3 clicks fire
  no network request in session 2. Real browsers unmount normally. If a stuck-overlay report ever
  arrives from a real device, check this first.
- **Finish → save → PR: DONE and verified.** (Docker died mid-session and blocked this for a
  while; after it recovered the flow was completed.) Logged Bench 100×5 @RPE 8, Row 60×10 @RPE 7,
  Curl 20×12 @RPE 7 through the UI → header read **1340 kg / 3 sets** (exact hand-computed total)
  → Finish → Save dialog → Save Workout. In MongoDB: volume **1340.0 kg**, 8 sets / 3 completed,
  122 s, title + description persisted, **RPE round-tripped** (8/7/7), **e1RM per set**
  (116.7/80.0/28.0), and the **PR moved 99 → 100 kg** with progression following.
  **Then deleting it retracted the PR back to 99** — proving the §14 rollback fix works on a
  genuinely UI-created workout, not just API-constructed test data.
- **Docker recovery (it WILL happen again):** `wsl --shutdown`, kill every `*ocker*` process
  (stale hung `docker` CLI processes block a clean relaunch), then relaunch Docker Desktop.
  **Watch for `vmmemWSL` in the process list — if it is absent the Linux VM has not booted no
  matter what `docker ps` says.** Its failure signature in
  `%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log` is IPC `/ping` "context deadline
  exceeded" → `stopping local engine linux/wsl` → an error dialog it quits on.
- **Beware exit codes from polling scripts.** Four background waiters reported
  "completed (exit 0)" while their output actually said `TIMED OUT` / `ENGINE NEVER CAME UP` /
  `mongo not responding` — a trailing bare `echo` exits 0 regardless. **Read the output file,
  never trust the summary line.** End such scripts with `exit 1` on the failure path.

**SESSION 3 (2026-07-21) — the two big-ticket items done. See `FEATURES.md` §17.**
- **NEXT UP is no longer a dumb rotation tracker.** `suggestedDayIndex(days, recoveryByMuscle)`
  now prefers the most-recovered day (fresh<recovering<worked from /workouts/muscle-volume),
  ties broken by longest-untrained. One-arg calls behave as before, so useTrainReminder is
  untouched. The hero explains itself ("you trained these muscles today" etc.), the plan
  folder's "Next" badge uses the SAME rule (they used to disagree), and duration is now the
  median of your real sessions tagged "(your average)" via `estimateSessionMinutes()` instead
  of the `sets × 3.5` constant. Verified live: logging a chest session today flipped the pick
  from the rested-since-June chest day to the fresh legs day; duration showed "~55 min".
- **Body weight is a first-class metric now.** Added `weight` to METRIC_DEFS; range is
  personalised from height (BMI band → kg) in `metric_definitions()` (now optional-auth).
  Two-way sync: logging weight updates profile.weight_kg (drives BMI/BMR/estimates); editing
  the profile records a history point; re-saving the same value doesn't duplicate. The generic
  Body Metrics page gives it a card + trend line for free. Verified live: 75.5→75.0→74.4 drew a
  descending trend, ideal 58.6–78.9 kg from 178cm, BMI recomputed. 4 new tests.
- **47 tests pass** (43 + 4 weight) · `CI=true npx craco build` clean · DB restored (13
  workouts, weight history 0, profile 75, Barbell Bench PR 99).
- **Remaining known items:** deep workout-session UI still not clicked (needs a live session);
  push not verified actually delivering (needs VAPID keys + external cron — see session 2);
  `DEPLOYMENT.md` still has the bad `--port 8001` edit (untouched, please confirm). NEXT UP
  learned-duration is keyed on `plan_id + day_index`, which shifts if you reorder/remove plan
  days — acceptable (worst case it reverts to the estimate), noted here so it isn't a surprise.

**SESSION 2 (2026-07-21) — 5 improvements shipped + UI click-through. See `FEATURES.md` §15-17.**
- **UI was driven in a real browser this time.** All 11 routes render with real data and
  **zero console errors**. Clicked through: login, habit create (emoji/type/target), habit
  counter to target, sleep logging, coach chat. Each result verified in Mongo.
  - **Environment gotcha confirmed:** a closed Radix dialog can leave an overlay that
    swallows clicks — 3 clicks fired NO network request. The network log caught it. Press
    Escape / re-navigate before believing a button is broken.
- **The 5 queued items are done:**
  1. **Habits → AI coach context** (7-day adherence per habit; coach verified listing them).
  2. **Offline queue beyond workouts** — shared `sendOrQueue()`, now covers habit logs, sleep
     and manual intake. Callers keep optimistic UI when queued; the habit toggle used to
     **silently revert the user's tap** offline. Verified end-to-end: killed the backend →
     click queued + UI held at 9/8 → restarted → queue drained → `value=9` in Mongo.
  3. **Background push** — `sw.js` push/notificationclick (cache `lifeos-v3`),
     `usePushSubscription`, settings toggle, and `/push/config|subscribe|unsubscribe|dispatch`.
     **NOT live until you set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_DISPATCH_SECRET`
     on Render AND point an external cron at `POST /api/push/dispatch` (header
     `X-Dispatch-Secret`).** Dispatch is a *pulled* endpoint on purpose — the free Render tier
     sleeps and cannot wake itself. Degrades safely: no keys → toggle isn't offered.
     Added `pywebpush` to requirements.
  4. **Auth cookie/Bearer** — `get_current_user` now tries EVERY credential, not just the
     cookie. Valid Bearer + junk cookie → 200; junk cookie alone → still 401.
  5. **Health sync last mile** — `HEALTH_SYNC_SETUP.md`: the exact Apple Shortcuts recipe,
     full field table, Android/Health Connect path, troubleshooting.
- **Bonus bug found while clicking (④):** habit/sleep logs used the **UTC** date, so in IST
  anything logged 00:00–05:30 recorded against *yesterday* and broke streaks. Added
  `lib/localDate.js`; clients now send their own calendar date. Verified at 00:50 IST: stored
  `2026-07-21` while UTC was `2026-07-20`.
- **Still not done:** deep workout-session UI (live logging/supersets/rest timer) not clicked —
  most stateful screen, needs a started session; real gym use is the test. Push not verified
  actually delivering (needs the keys + cron above). NEXT UP intelligence and body-weight
  time series still open — still the two highest-value items.
- **43 tests pass · `CI=true npx craco build` compiles clean.**

**FULL AUDIT + 3 FIXES (2026-07-21) — read `FEATURES.md` first**
- **`FEATURES.md` is new** — a complete per-feature catalogue (what it is, how it works, what
  the user clicks, what they can modify, what to improve) plus the audit evidence. It is the
  best entry point for "where are we"; this file stays the chronological log.
- **Local dev is UP again** (the "Docker is down" note below is stale). `lifeos-mongo` runs;
  backend starts with `cd backend && python -m uvicorn server:app --host 0.0.0.0 --port 8001`.
- **Audit method**: all 80 endpoints exercised against LOCAL Mongo with real data, every write
  re-read AND verified directly in Mongo. **32/32 reads + 81/81 write assertions pass.** All
  test data was tagged `ZZAUDIT` and removed; final DB state confirmed equal to pre-audit.
- **3 real defects found and fixed** (details + reproduction in `FEATURES.md` §14):
  1. **Ghost PRs — the important one.** `delete_workout` only deleted the session document.
     PRs/progression are computed **incrementally**, so a mistyped 500 kg set left a permanent
     500 kg PR and kept being prescribed *after the workout was deleted*. Same on edit
     (300→30 kg left the 300 kg PR). Fix = `_rebuild_exercise_state()`: wipe the derived docs
     for the affected exercises and **replay surviving sessions in order**
     (`_update_prs_and_progression` now takes `at=` so replays keep original dates). Wired into
     both DELETE and PUT `/workouts/{id}`. **Don't reintroduce in-place PR mutation on
     delete/edit — it cannot be correct, the state is incremental.**
  2. Deleting a custom exercise orphaned its `exercise_notes` row → cascade delete added.
  3. AI coach reported "10 workouts" to anyone with more — `build_user_context` capped at
     `to_list(10)` then described that slice as the total. Now injects a real lifetime
     `count_documents`. Verified: answers 13 where it used to answer 10.
- **Tests: 43 passing** (39 + 4 new `TestDerivedStateRollback`, which run on a throwaway custom
  exercise so they never touch real PR data).
- **Top improvement candidates surfaced** (not yet done, ranked): (a) **NEXT UP is a rotation
  tracker, not intelligence** — it ignores the muscle-recovery data the app already computes,
  only ever reads `plans[0]`, and the "~63 min" estimate is the constant `sets × 3.5`;
  (b) **body weight has no time series** — it is a single overwritable scalar on `profile`, so
  the app cannot draw a weight trend at all; (c) habits still absent from AI coach context;
  (d) offline queue still workout-only.
- **Uncommitted `DEPLOYMENT.md` edit looks wrong** — it changes the Render start command from
  `--port $PORT` to `--port 8001`. Render injects `$PORT`; hardcoding breaks the deploy for
  anyone following the guide. I did not touch it — please confirm before it is committed.

**NEXT UP (2026-07-16) — start here**
- **APK / Android** — DELIBERATELY PARKED by the user ("hold apk for later"). All repo-side
  prep is DONE and deployed: `frontend/public/.well-known/assetlinks.json` (package
  `com.cglifeos.app`, placeholder fingerprint) is live and serving, manifest is TWA-ready,
  and `APK_SETUP.md` has the full step-by-step. Remaining work is the user's: generate the
  APK via pwabuilder.com, paste the real SHA-256 fingerprint into assetlinks.json, push.
  **Don't start this until the user says go.**
- **Use the app for real sessions** — the user's own suggestion-worthy next step. The
  backend/data layer is audited clean (see below); remaining issues are UX papercuts that
  only surface in the gym.
- **Local dev is DOWN** — Docker Desktop isn't running, so local Mongo (:27017) and the
  backend can't start. Fix: open Docker Desktop manually, then `docker start lifeos-mongo`.
  Everything since 2026-07-16 was verified against **prod** instead (works fine, but
  remember to clean up test data — see below).
- **Verifying against prod**: login `cg3@lifeos.com`/`test1234` works on the Render API.
  ALWAYS delete test routines/plans/workouts afterwards, and never leave a real workout
  modified (I edited one during testing and restored it exactly).

**Workout feature audit (2026-07-16): 18/18 reads + 14/14 write flows PASS.**
Library/search/filters, programs, routines CRUD+folder+reorder, plans CRUD+import-days,
workouts create/edit/delete, previous/records/history/substitutes, progression,
muscle-volume, strength-standards, settings — all green. One gap found and fixed
(custom exercises had no delete). Confirmed `PUT /plans/{id}` does NOT wipe `routine_ids`
(guarded conditionally) — so reordering a day or changing the repeat guard is safe.

**Known caveats for the next session**
- `computer{action:"screenshot"}` **times out** in this environment, and real-click
  coordinate targeting is unreliable (clicks silently miss, which once looked like a save
  bug but wasn't). Verify UI work by reading the DOM via `javascript_tool` AND confirming
  the result against the API/DB — the DB check is what carries the weight.
- Radix dropdowns don't open from a synthetic `.click()`; they need a real pointer event,
  and a synthetic click on a menu item can leave the menu stuck open and swallowing clicks.
- Vercel builds with `CI=true`, so **ESLint warnings fail the build** — always run
  `CI=true npx craco build` before pushing.
- The PWA service worker caches aggressively; after a deploy the user must fully close and
  reopen the app. SW cache is at `lifeos-v2` (bump it when caching strategy changes).

**Not built / deferred**
- Phase 5 as originally scoped (session `mode="edit"` replacing `EditWorkoutDialog`) was
  deliberately NOT done — the session's draft/resume/timer logic is the fragile part. The
  actual gap it targeted (RPE + set types when editing) was closed inside the dialog instead.
- Hevy share-card extras: multiple card variants / carousel, "Workout Link", "Copy Text".
- Offline queue only covers workout saves (habits/sleep/health still fail hard offline).
- **Universal health sync (user's explicit direction 2026-07-14):** NOT Fastrack-specific — support any watch/any phone (steps, stress, HR, HRV, SpO2, distance, sleep…). Architecture = read from the phone's health hub, never per-brand APIs. iPhone → Apple Health; Android → Health Connect. User's Fastrack app syncs the watch over Bluetooth (+QR pairing) and **can write to Apple Health if allowed** → confirms iPhone path is viable. Backend ingest already widened to accept the full param set. **NEXT: confirm iPhone (implied) then hand user the exact Apple Shortcuts "Automation" recipe** — read the health metrics + POST JSON to `https://lifeos-api-g6hq.onrender.com/api/health/ingest` with header `X-Health-Token`, on a daily schedule. (Android equivalent = Tasker/Macrodroid + Health Connect, build later if needed.)
- **PWA** — installable + offline app shell + **offline workout write-queue DONE** (2026-07-14, see §5 PWA). Remaining: extend the queue to habits/sleep/health writes, and real **background push** for train reminders (currently in-app only via `hooks/useTrainReminder.js`).
- **Journal** — REMOVED entirely 2026-07-14 (route, nav item, `itemJournal` testId all deleted; no backend code existed). Do not re-add unless asked.
- **Nutrition** — user has explicitly EXCLUDED it for now (still a `Placeholder`; nav item + `/nutrition` route remain).
- Optional polish: wire **habits** into the AI coach context + a life-score (sleep + health_daily already wired 2026-07-14); more Progress charts (e1RM lines, time-range selector). Cosmetic: coach context prints step avg as float (e.g. "9120.0/day") — harmless.
- **Minor auth robustness** (`get_current_user`, server.py ~168): reads the cookie FIRST, only falls back to the `Authorization: Bearer` header if there's NO cookie. A stale/expired `access_token` cookie therefore shadows a valid Bearer token → 401. Harmless in prod (same-origin, fresh cookie) but bit local cross-origin testing. If ever fixed: try Bearer when the cookie token fails to validate.
