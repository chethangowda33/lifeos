# LifeOS — Handoff (current as of 2026-07-14)

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
- Exercise picker (Recent + create custom), exercise detail (charts/PRs), muscle heatmap.
- Intelligence: progression suggestions, PRs, volume landmarks, plateau/deload flags.
- **Empty state = goal-filtered recommendations** (RECO_GOALS → program.goal, week-day preview) + **swipe-to-dismiss** (`SwipeToDismiss.jsx`, framer-motion; dismissed ids in localStorage `lifeos:dismissed-programs`).

**Dashboard** (`pages/Dashboard.jsx`): `TodayHero` band (SVG weekly-goal ring, streak, muscle-recovery chips from `/workouts/muscle-volume`), stat cards, **Weekly AI recap** card (`GET /coach/recap`, Groq), resume/volume chart, records, muscle focus. **First-run onboarding** (`Onboarding.jsx`) for fresh accounts → 3 questions → seeds `lifeos:reco-goal`.

**Progress** (`pages/Progress.jsx`): stat boxes, **VolumeTrend** Recharts area (10-wk), **PR trophy shelf** (`GET /records`), WorkoutCalendar, MuscleHeatmap, muscle-volume bars w/ recovery, strength standards, history.

**Habits** (`pages/Habits.jsx`, DONE 2026-07-14): backend `habits`+`habit_logs`; `GET /habits` (today status/streak/history), `POST/PUT/DELETE /habits`, `POST /habits/{id}/log` (check=toggle, count=set value). Two types: check + count(target/unit). Cards w/ emoji, streak, 14-day strip, controls, add/delete dialog.

**Sleep** (`pages/Sleep.jsx`, DONE 2026-07-14): backend `sleep_logs` (upsert per user+date); `GET /sleep` (logs+stats), `POST /sleep`, `DELETE /sleep/{id}`. Stat tiles, Recharts duration trend (≥2 nights), nights list w/ quality stars, log dialog (bedtime/wake auto-computes hours, 1-5 stars).

**Admin panel** (`pages/Admin.jsx`, admin-only): `GET /admin/users` (+workout_count), `GET /admin/stats`. Triple-gated: nav link only for admin, route redirect for non-admins, API 403.

**Health sync / Connections** (`pages/Connections.jsx`, DONE 2026-07-14; ingest widened 2026-07-14): brand-agnostic ingest — **goal is ANY watch/phone, not one brand**. The hub is Apple Health (iPhone) / Health Connect (Android); any device (Apple Watch, Garmin, Fitbit, Fastrack, phone pedometer) writes there and a phone automation POSTs to us. Backend: per-user `health_token`; `GET /health/connection`, `POST /health/connection/regenerate`, token-authed `POST /health/ingest` (X-Health-Token). Ingest now accepts a wide param set via `HEALTH_DAILY_FIELDS`: steps, distance_km, resting_hr, avg_hr, hrv, spo2, stress, respiratory_rate, active_energy → `health_daily`; sleep_hours/quality → `sleep_logs`. `GET /health/daily`. Page: live tiles (config-driven: core steps/HR/kcal always, distance/HRV/stress/SpO2 show when synced), masked key (reveal/copy/regenerate), endpoint, per-platform setup guide. **Dashboard** shows a "Today's health · from your watch" strip (`HealthStrip`, renders only when today has data). Health + sleep now feed the AI coach (see §6).

## 6. AI coach
Prod uses **Groq Llama 3.3 70B** (`GROQ_API_KEY` set → `coach_provider()`="groq", `GROQ_MODEL`=llama-3.3-70b-versatile). Falls back to Claude if only `ANTHROPIC_API_KEY`. `build_user_context()` feeds the coach the user's real data; `/coach/chat` + `/coach/recap`. **Context now includes** a 7-day health-sync avg (steps/distance/resting HR/HRV/stress/SpO2/active energy) + recent sleep (avg hours + quality); `COACH_SYSTEM` tells it to factor low sleep / high stress before pushing hard training.

## 7. Open threads / pending
- **Universal health sync (user's explicit direction 2026-07-14):** NOT Fastrack-specific — support any watch/any phone (steps, stress, HR, HRV, SpO2, distance, sleep…). Architecture = read from the phone's health hub, never per-brand APIs. iPhone → Apple Health; Android → Health Connect. User's Fastrack app syncs the watch over Bluetooth (+QR pairing) and **can write to Apple Health if allowed** → confirms iPhone path is viable. Backend ingest already widened to accept the full param set. **NEXT: confirm iPhone (implied) then hand user the exact Apple Shortcuts "Automation" recipe** — read the health metrics + POST JSON to `https://lifeos-api-g6hq.onrender.com/api/health/ingest` with header `X-Health-Token`, on a daily schedule. (Android equivalent = Tasker/Macrodroid + Health Connect, build later if needed.)
- **PWA / offline logging** — the big remaining item. Manifest + service worker + installable + offline set logging + background sync; then upgrade train reminders to real background push (currently in-app only via `hooks/useTrainReminder.js`). HTTPS is live so it's now possible.
- **Journal page** — still a `Placeholder` in `App.js` (only unbuilt page left besides Nutrition).
- **Nutrition** — user has explicitly EXCLUDED it for now (still a `Placeholder`).
- Optional polish: wire **habits** into the AI coach context + a life-score (sleep + health_daily already wired 2026-07-14); more Progress charts (e1RM lines, time-range selector). Cosmetic: coach context prints step avg as float (e.g. "9120.0/day") — harmless.
