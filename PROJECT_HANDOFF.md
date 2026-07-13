# LifeOS — Handoff

## 1. Vision
LifeOS = personal life-tracking app for me (chethan). Workout module goal: match Hevy Pro's UX (Phase 1), then beat it with an AI progressive-overload/coaching layer (Phase 2). Source spec: `lifeos-workout-upgrade-prompt.md` (repo root). Phase 1 UX parity is done; Phase 2 intelligence layer (progression suggestions, PRs, volume landmarks, plateau/deload detection) is also done and live.

## 2. Stack
- Backend: FastAPI + Motor(MongoDB), single file `backend/server.py` (~2000+ lines), Pydantic models inline, JWT cookie auth (`get_current_user`, optional variant `get_optional_user`).
- Frontend: React 19, CRA+craco, Tailwind, shadcn/ui components in `frontend/src/components/ui/`.
- DB: Mongo via Docker container `lifeos-mongo`. Start with `docker start lifeos-mongo` (Docker Desktop must be running first).
- Run backend: `cd backend && python -m uvicorn server:app --host 0.0.0.0 --port 8001`
- Run frontend: normal CRA dev server on :3000.
- Test login: `cg3@lifeos.com` / `test1234`.
- Backend tests: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -p xdist -p asyncio` → 39 passing.

## 3. What's built (A–Z)
- Auth, Dashboard, Body Metrics — untouched, working.
- **Workout module** (`frontend/src/pages/Workout.jsx`, `WorkoutSession.jsx`, `WorkoutSettings.jsx`, `ExerciseDetail.jsx`):
  - Routines + multi-day Plans (folders), Explore programs, hero "next up" card, week strip, custom accent theme.
  - Live session: sets (working/warmup/dropset/failure/amrap), superset grouping, plate calculator, RPE, rest timer with +15/−15 adjust + audio+vibration alert on expiry, inline stopwatch for timed exercises, bodyweight "+Kg" mode, swap-similar-exercise, save-as-routine toggle on finish, post-workout PR celebration dialog.
  - Exercise picker (`components/ExercisePicker.jsx`): search/filter by muscle+equipment (icons via `MuscleThumb`/`EQUIP_ICON`), **Recent** section (last 6 picked, localStorage key `lifeos:recent-exercises`), **Create custom exercise** inline form → `POST /exercises`.
  - Exercise detail (`components/ExerciseDetailContent.jsx`, shared by dialog + `/exercise/:id` page): animation, muscle diagram, e1RM/volume charts, PR history, instructions.
  - Muscle heatmap (`components/MuscleHeatmap.jsx`): body-diagram SVG colored by last-7-day volume, also exports `MuscleThumb` for picker icons. Rendered on Progress page.
  - Progress page: stat boxes, muscle-volume bars w/ **recovery tag** (worked today / recovering / recovered, from `days_since`/`recovery` fields backend now returns), **WorkoutCalendar** (12-week GitHub-style grid), strength standards, workout history list.
  - Intelligence: `/exercises/{id}/records`, `/exercises/{id}/history`, `/workouts/muscle-volume` (now includes `last_trained`/`days_since`/`recovery`), `/routines/reorder` (drag-order persisted), progression suggestions surfaced on each exercise card in session ("Suggested: X kg", deload/plateau flags).

## 4. Pending — 6 ranked items
1. **PWA / offline logging** — not started. Installable + offline set logging + background sync.
2. **Apply progression suggestion in one tap** — **DONE, verified end-to-end in browser (2026-07-10).** "Suggested: 15 kg (+2.5)" + Apply button rendered; clicking it filled the working set's kg input with 15. Plateau case hides Apply (verified earlier). Injected test doc deleted from `progression_states`. Note: correct `user_id` for test injections is `str(users._id)` e.g. `6a4665b994cd583b69026da9` for cg3, NOT a numeric uid. Also note: `lifeos-mongo` container sometimes starts without binding host port 27017 right after Docker Desktop boots — `docker restart lifeos-mongo` fixes it.
3. **Per-exercise persistent notes** — **DONE, verified end-to-end (2026-07-10).** Backend: `exercise_notes` collection (unique index user_id+exercise_id), `GET /exercises/notes` → `{exercise_id: note}` map (registered before `/exercises/{exercise_id}` to avoid route shadowing, next to `/exercises/meta`), `PUT /exercises/{exercise_id}/note` (empty note deletes doc). Frontend `WorkoutSession.jsx`: `exerciseNotes` state fetched with progression; each `ExerciseSessionCard` shows StickyNote line under badges ("Add note" when empty), tap → Textarea, saves on blur (optimistic). Verified: save, auto-show on next session, edit, delete-on-empty; 39 pytest still passing.
4. **Share / export workout** — **DONE, verified (2026-07-10).** New dep `html-to-image` (installed with `--legacy-peer-deps` — repo has a pre-existing react-day-picker/date-fns@4 peer conflict; always use that flag for installs). New `frontend/src/components/ShareWorkoutCard.jsx`: `ShareWorkoutButton({summary})` renders Share button + off-screen 380px card (brand, title, date, duration/volume/sets, react-body-highlighter muscle models, PRs) → `toPng` → Web Share API w/ file, fallback download. **Must pass `skipFonts: true`** — embedding the cross-origin Google Fonts stylesheet throws SecurityError. Wired into WorkoutSession celebration dialog footer; `setSummary` now also carries `name` + `muscles`. Verified via forced download path: 63KB PNG, correct content (checked visually). Note: in the hidden preview tab html-to-image hangs awaiting `requestAnimationFrame` — env quirk only, shim rAF with setTimeout when testing there.
5. **Interval/EMOM/HIIT timer** — **DONE, verified (2026-07-10).** New `frontend/src/components/IntervalTimer.jsx` (no new deps): dialog with presets (Tabata 20/10×8, EMOM 10, HIIT 40/20), work/rest/rounds inputs (work min 5s), big countdown, WORK/REST phase badge, round x/N, Pause/Resume/Reset; beeps+vibrates on every transition via `restAlert` (now exported from WorkoutSession.jsx, passed as `onAlert` prop to avoid an import cycle). Opened from Timer icon in session sticky header (`intervalOpen` state). Verified: full 2-round cycle incl. transitions + done state, pause freezes (one in-flight tick may slip ≤1s — accepted), reset.
6. **Train reminders** — **DONE (in-app scope), verified (2026-07-10).** Backend: `train_reminder_enabled` (default false) + `train_reminder_time` ("18:00") added to `WorkoutSettingsIn` + defaults. Frontend: new `hooks/useTrainReminder.js` called from `Layout.jsx` — checks every 60s; when enabled, time reached, and not yet fired today (localStorage `lifeos:train-reminder-fired`), shows browser Notification "Time to train 🏋️ — {next day} is next in your rotation" (reuses `suggestedDayIndex`, now exported from `pages/Workout.jsx`). Settings UI: "Train reminder" card in WorkoutSettings.jsx (switch requests Notification permission + `<input type=time>`). Verified: settings roundtrip, UI, and notification fire with correct rotation day (stubbed Notification in preview). **Background push (app closed) still needs #1 PWA — service worker + Push API.**

## 5. Rules for next session
- **MANDATORY at every step:** for every line of code — new or already existing — ask: "can this line/block be replaced with a library (or an already-installed dependency / built-in)?" If yes, use the library instead of hand-written code. Goal: simpler code, fewer lines.
- Use as few tokens as possible: don't re-read old chats or unrelated files, read only what the current task needs, keep replies short.
- Follow the user's instructions exactly — nothing extra.
- Do all 6 one by one, not in parallel.
- Only touch files required for the current task.
- Change only the specific lines needed — do not rewrite whole files/components.
- Keep design simple, no over-engineering, no new dependencies unless clearly necessary.
- Don't re-read old chat history — this file is complete context.
- Backend: after any server.py edit, syntax-check (`python -c "import ast; ast.parse(open('server.py',encoding='utf-8').read())"`) before restarting; kill old uvicorn process on :8001 first.
- Verify each feature end-to-end (curl for API, browser preview for UI) before moving to the next item.
- Run full pytest suite after backend changes to catch regressions (currently 39 passing).

## 6. Multi-user + deployment (added 2026-07-10, later session)
- **Multi-user restriction (DONE, verified):** registration is invite-only when env `INVITE_CODE` is set (unset locally → open, tests unaffected; 39 still passing). `RegisterIn.invite_code` + 403 check in `/auth/register`; Register page has an "Invite code" input (AuthContext.register takes 4th arg). Roles: seeded admin (`ADMIN_EMAIL`, role="admin" — cg3 already admin), all signups role="user"; `require_admin` dependency + `GET /admin/users` (403 for non-admins — verified). `COOKIE_SECURE` now env-driven (`COOKIE_SECURE=true` in prod).
- **Deploy prep (code-side DONE, actual deploy = user does it):** `frontend/vercel.json` proxies `/api/*` → Render backend (user must replace placeholder host); `api.js` falls back to same-origin `/api` when `REACT_APP_BACKEND_URL` unset (proxy mode). Root `.gitignore` already covers `.env`. Full beginner walkthrough in **`DEPLOYMENT.md`** (repo root): GitHub → Atlas M0 (+ mongodump/restore from the `lifeos-mongo` container) → Render (env table incl. INVITE_CODE, JWT_SECRET, COOKIE_SECURE=true, strong ADMIN_PASSWORD) → Vercel (root `frontend`, no env, `--legacy-peer-deps` install override if build fails) → set FRONTEND_URL back on Render. Not deployed yet — user is doing it themselves following the guide.

## 7. Deployment status (2026-07-11)
- **LIVE.** Frontend: `https://lifeos-nine-eta.vercel.app` (Vercel, root=frontend, `.npmrc` legacy-peer-deps). Backend: `https://lifeos-api-g6hq.onrender.com` (Render free, env incl. INVITE_CODE, COOKIE_SECURE=true). DB: MongoDB Atlas (`lifeos-cluster`). Vercel proxies `/api/*`→Render (`frontend/vercel.json`). Verified full chain: login, invite gate, data. Render free tier sleeps after 15min (first hit ~30-50s). Prod requirements fixes: added `httpx`+`dnspython`, removed unused `jq`/etc (build-breaking); seed-skip on boot via `_seed_signature()` (was ~10min cold start). Push to `main` = auto-deploy both.

## 8. UI enhancement batch (in progress, 2026-07-11) — user asked to "do all this"
Premium visual overhaul. Order + status:
1. **Workout empty state → recommendations (DONE, verified, committed).** `Workout.jsx`: replaced "Nothing queued yet" with goal chips (RECO_GOALS: muscle/strength/cut/fit → program.goal) + recommendation hero (best beginner program in goal, week-day preview via WEEK_PRESETS) + 2 more-program cards. Reuses `openProgram` flow. Falls back to simple prompt if no programs. Verified in browser: all 4 goals surface different programs, Start opens ProgramDetailDialog.
2. **Dashboard "today" band (DONE #2+#3+#4 merged, verified, pushed).** `Dashboard.jsx`: new `TodayHero` under greeting — SVG weekly-goal ring (weekCount/target=4), streak line, muscle recovery chips (ready/recovering/worked-today) from `/workouts/muscle-volume` (recovery field: fresh/worked/recovering). Chips only render when recent training exists. Verified with a logged workout.
3. **Streak & weekly goal ring** — DONE (part of #2 TodayHero).
4. **Recovery-based suggestion** — DONE (recovery chips in #2 TodayHero).
5. **PR trophy shelf** — page/section of all PRs as badges (data in pr_events/personal_records). TODO.
6. **Quick-add on dashboard** — one-tap log water/weight/start next. TODO.
7. **Progress analytics page (DONE core, verified, pushed).** Added `VolumeTrend` Recharts area chart (weekly kg volume, last 10 weeks — progressive overload). Note: bodyweight is NOT a time-series metric (lives in profile, not body_metrics); body_metrics keys are body_fat/muscle_mass/bmi/bmr etc. Muscle balance already covered by existing muscle-volume bars + MuscleHeatmap. Optional future: e1RM-per-lift lines, time-range selector, body_fat trend.
8. **Every empty state redone** — Nutrition/Habits/Journal/Sleep get the same treatment. TODO.
9. **Post-workout moment** — animated PR reveal + confetti on finish (share card already exists). TODO.
10. **Weekly recap** — AI Sunday digest. TODO.
11. **First-run onboarding** — 3 questions (goal/experience/days) → auto-recommend plan + seed habits. TODO.
- Rules for this batch: use `--maroon`/CSS-var tokens (NOT hardcoded colors — accent is user-themed, currently cyan), minimal edits, reuse existing data/flows, verify each in browser, commit+push each (auto-deploys). Mockups were shown & approved for #1, #2, #7.

### Extra features added on user request (2026-07-11)
- **Swipe-to-dismiss recommendations (DONE, verified, pushed).** `components/SwipeToDismiss.jsx` (framer-motion `drag`, already installed) + X button. Wraps hero + more-program cards in Workout empty state. Dismissed program ids in localStorage `lifeos:dismissed-programs`, filtered from recommendations; hero advances to next; "Show them again" reset when all dismissed. Verified dismiss + persistence across reload.
- **Admin-only panel (DONE, verified, pushed).** User picked "Users panel" + "App stats" (+ an unspecified "Something else" — ASK USER what it was). Backend: `GET /admin/stats` (total_users/members/active_this_week/total_workouts/workouts_this_week) + `workout_count` on `/admin/users`. Frontend: `pages/Admin.jsx` (stat tiles + accounts list), route `/admin`. Triple-gated: nav link only for role=admin (Layout.jsx `ADMIN_ITEM`), route `<Navigate>` redirect for non-admins, API 403. Verified admin sees it, regular user blocked all 3 ways. 39 tests pass.
- **NOTE for #8:** Nutrition/Habits/Journal/Sleep are `Placeholder` components (not built) — "redo their empty states" actually means BUILDING those pages. Bigger scope than a visual tweak.
- **AI coach model:** prod uses **Groq Llama 3.3 70B** (`GROQ_API_KEY` set → `coach_provider()` returns "groq"; `GROQ_MODEL` default `llama-3.3-70b-versatile`). Falls back to Claude if only `ANTHROPIC_API_KEY` set.
- **Prod admin accounts:** `cg3@lifeos.com` (pw `test1234`, migrated) + `chethangowda98654@gmail.com` (pw = ADMIN_PASSWORD env on Render, not recoverable — hashed). Both role=admin on Atlas.

## 9. Still pending (pre-UI-batch)
- **PWA / offline logging** — manifest + service worker + installable + offline set logging + background sync; then train reminders → real background push. Now possible (HTTPS live). Do after UI batch.
