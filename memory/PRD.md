# CG's LifeOS — Product Requirements Document

## Original Problem Statement
A "personal OS" for fitness & life tracking, built around 8 pillars.
Test user: `cg3@lifeos.com` (local seed; password from `backend/.env`). Maroon accent (#c0152a). Light theme default.

## Architecture
- **Backend**: FastAPI + Motor (async MongoDB) — `server.py` + `seed_data.py`.
- **Frontend**: React 19 + Tailwind + shadcn/ui + recharts + lucide-react + react-router v7.
- **Auth**: JWT in httpOnly cookies + Bearer fallback; bcrypt; idempotent admin seed.
- **Theme**: CSS-variable based, light default, persisted to `localStorage` (`lifeos-theme`).
- **Database**: `lifeos_database` — `users`, `exercises` (66 seeded), `programs` (14 seeded), `routines`, `body_metrics` (time-series), `workout_sessions`.
- **Exercise illustrations**: `raw.githubusercontent.com/yuhonas/free-exercise-db` (start + end position photos).

## User Personas
1. **CG (owner)** — runs routines, logs workouts, tracks body composition.
2. **Athlete / hobbyist** — explores programs, customises routines, monitors body trends, reviews progress.

## Core Requirements (stable)
- Single sign-in (email/password), persistent across refresh.
- 8 pillars in sidebar.
- Maroon (#c0152a) accent in light & dark.
- `data-testid` on every interactive element.

## What's Been Implemented

### 2026-06-28 — Iteration 1 (Step A + B initial build)
- Auth, 66 exercises, 14 programs, Custom Routines CRUD, Body Metrics (BMI/BMR auto), Light/Dark toggle, Layout + Sidebar with Body Metrics, /workout (Routines + Explore + Builder + Picker), /body-metrics, placeholders. Test: 20/20 + 24/24.

### 2026-06-28 — Iteration 2 (Hevy-style polish + body composition)
- **ProgramDetailDialog** + clickable program cards + "Save Program" → imports all routines.
- **ExerciseDetailDialog** with start + end position images and "How to do it" instructions.
- **Real exercise images** from free-exercise-db (curated `EXERCISE_IMAGE_SLUGS`).
- **All body metrics auto-estimate** from profile (Deurenberg body fat, muscle/bone/hydration formulas, metabolic age). `source` field: `manual` / `estimated` / `missing`.
- PUT /api/auth/profile partial merge fix.
- Test: 27/27 + 14/14.

### 2026-06-28 — Iteration 3 (Live workout session + Progress + Body-metrics V2)
**Backend**
- New schemas: `WorkoutSetIn`, `WorkoutExerciseIn`, `WorkoutSessionIn`.
- `POST/GET/DELETE /api/workouts` — list endpoint enriches each exercise with name + image_url + muscle_group.
- `GET /api/workouts/stats` — aggregates total_workouts, total_volume, total_sets, total_duration.
- `GET /api/exercises/{id}/previous` — last completed sets, used to fill the "Previous" column in the session.
- `DELETE /api/body-metrics/{metric}` — clears all manual logs, card reverts to `source=estimated`.
- New collection `workout_sessions` with index `(user_id, created_at desc)`.

**Frontend**
- **`/workout/session/:routineId`** — full Hevy-style live tracker:
  - Sticky header (back · routine name · `Finish`).
  - Stats pills: Duration (maroon, ticks every second), Volume, Sets.
  - Per-exercise card: thumbnail + name (click → ExerciseDetailDialog), Notes textarea, Rest Timer dropdown (Off/30s/60s/90s/2m/3m/4m/5m), set table `SET | PREVIOUS | KG | REPS | RPE | ✓`.
  - Time-based exercises (cardio/core) switch to `SET | PREVIOUS | TIME | ✓` with `session-time-input`.
  - "Previous" auto-fills from last session.
  - Completing a set turns the row green, updates Volume/Sets, **auto-starts rest timer** with skip.
  - `+ Add Set`, `Discard Workout`.
  - **Finish** → Save dialog (title, mini-stats, description) → POST /api/workouts → navigate to /progress.
  - `/workout/session/empty` for quick unplanned workouts.
- **`/progress`** — workout history:
  - 4 stat boxes (Workouts, Total Volume, Total Sets, Total Time).
  - Cards with relative timestamp, exercise badges, hover-trash delete (`progress-delete-button`).
- **/workout** updates — `Start Empty Workout` button + `Start Routine` now navigates to live session.
- **/body-metrics V2** — `Refresh` button, `Clear` button per logged metric (reverts to estimate), `ProfileBanner` showing current profile inline with `Edit` shortcut, copy: "Enter age + height + weight and all 7 metrics auto-predict."
- Test: 39/39 pytest + 17/17 E2E flows.

## Prioritized Backlog
### P1 — Other pillars
- Nutrition: meals/macros/water.
- Habits: streaks.
- AI Coach: Claude Sonnet 4.5 chat using metrics + routine context.
- Journal, Sleep.

### P2 — Workout deeper
- Floating "live workout" mini-bar when navigating away mid-session.
- Drag-reorder exercises in Routine Builder.
- Three-dot menu per routine (Edit / Duplicate / Rename / Move to folder).
- Personal records (highest 1RM/volume per exercise) on /progress.
- Routine folders.
- Add a cardio-only routine to exercise the time-based UI variant (TIME column).

### P3 — Niceties
- Brute-force login lockout.
- Mobile bottom-nav.
- PWA / offline.
- Shareable public routines.
- Photo/video upload on saved workouts.
- Body silhouette graphic highlighting trained muscles.

## Next Tasks
1. Build the next pillar (Nutrition or AI Coach).
2. Floating "live workout" mini-bar for cross-page persistence.
3. Personal records + per-exercise progression chart on /progress.
