# LifeOS

A personal life-tracking app — workouts, habits, sleep, nutrition, body metrics, and an AI
coach that reads all of it. Built for one person, now invite-only for a couple more.

**Live:** https://lifeos-nine-eta.vercel.app · **API:** https://lifeos-api-g6hq.onrender.com
· **Android:** installable APK (a TWA wrapper around the live site)

React 19 SPA → FastAPI → MongoDB. Static frontend on Vercel, API on Render, database on Atlas.
Installable as a PWA, with offline support for workout logging.

---

## Start here

| If you want to… | Read |
|---|---|
| **Understand how it's built** — stack, request flow, how a button gets its colour | **[ARCHITECTURE.md](ARCHITECTURE.md)** |
| Know what happened and why | [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) — **§0 first** |
| Know what exists and what's verified | [FEATURES.md](FEATURES.md) |
| Know what's next | [ROADMAP.md](ROADMAP.md) |
| Deploy it | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Sync a watch / phone health data | [HEALTH_SYNC_SETUP.md](HEALTH_SYNC_SETUP.md) |
| Build the Android app | [APK_SETUP.md](APK_SETUP.md) |

---

## Run it locally

**Prerequisites:** Node 18+, Python 3.12, Docker Desktop.

```bash
# 1. Database — Mongo in a container
docker start lifeos-mongo
# Quirk: sometimes starts without binding host port 27017 right after Docker boots.
# If the backend can't connect: docker restart lifeos-mongo

# 2. Backend — needs backend/.env (MONGO_URL, DB_NAME, JWT_SECRET, …)
cd backend
python -m uvicorn server:app --host 0.0.0.0 --port 8001

# 3. Frontend — frontend/.env already points at localhost:8001
cd frontend
npm install --legacy-peer-deps    # the flag is required, see below
npm start                          # → http://localhost:3000
```

**Test login:** `cg3@lifeos.com` / `test1234` (admin).

---

## Tests

```bash
# Backend — 224 tests. Most hit a LIVE server, so start it first.
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -p xdist -p asyncio

# Frontend — 113 tests, all pure functions. Needs nothing running.
cd frontend && CI=true npx craco test --watchAll=false
```

If every backend test fails on connection-refused, the server isn't running. That's not a
regression — check the error before believing it.

---

## Before you push

```bash
cd frontend && CI=true npx craco build
```

**This is not optional.** Vercel builds with `CI=true`, which turns every ESLint warning into
an error — a single unused import fails the deploy. `git push` to `main` deploys **both**
Vercel and Render; there is no staging environment, so the build gate is the only safety net.

`npm install` always needs `--legacy-peer-deps` (a pre-existing react-day-picker / date-fns@4
peer conflict). `frontend/.npmrc` sets this for CI.

---

## Layout

```
backend/
  server.py        4,380 lines — the whole API except nutrition
  intake.py        1,092 lines — nutrition, self-contained router
  tests/           224 tests
frontend/
  src/pages/       18 route components
  src/features/    feature-scoped code; pure logic in */lib/ with unit tests
  src/components/  17 shared + 46 shadcn/ui primitives
  vercel.json      the /api proxy — the most important 5 lines in the repo
```

The full explanation of every folder, dependency and convention is in
**[ARCHITECTURE.md](ARCHITECTURE.md)**.
