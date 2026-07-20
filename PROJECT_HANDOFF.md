# LifeOS — Handoff (current as of 2026-07-16)

> Paste this whole file at the start of a new chat. It is complete context — don't re-read old chats.

## 1. What LifeOS is
Personal life-tracking app for me (chethan), going multi-user (me + a friend, invite-only). Started as a Hevy-style workout tracker with an AI progressive-overload layer; now also has habits, sleep, an AI coach, progress analytics, an admin panel, and a health-sync ingest layer. **It is deployed and LIVE.**

## 2. Stack & how to run locally
- **Backend:** FastAPI + Motor(MongoDB), single file `backend/server.py` (~2200 lines), Pydantic models inline, JWT cookie auth (`get_current_user`; `get_optional_user`). Token-auth variant for health ingest.
- **Frontend:** React 19, CRA + craco, Tailwind, shadcn/ui in `frontend/src/components/ui/`. Charts = Recharts. Animation = framer-motion. Confetti = canvas-confetti. Icons = lucide-react.
- **DB:** Mongo in Docker container `lifeos-mongo`. Start: ensure Docker Desktop running, then `docker start lifeos-mongo`. Quirk: sometimes starts without binding host port 27017 right after Docker boots → `docker restart lifeos-mongo` fixes it.
- **Run backend:** `cd backend && python -m uvicorn server:app --host 0.0.0.0 --port 8001` (kill old :8001 process first).
- **Run frontend:** CRA dev server on :3000 (`frontend/.env` has `REACT_APP_BACKEND_URL=http://localhost:8001`).
- **Test login:** `cg3@lifeos.com` / `test1234` (admin).
- **Backend tests:** `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -p xdist -p asyncio` → **39 passing**.
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
