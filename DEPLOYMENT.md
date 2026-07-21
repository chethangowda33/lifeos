# LifeOS — Deploy It Yourself (Beginner Guide)

## 0. What "deploying" means and why you need it

Right now LifeOS only exists on **your laptop**. It works because three programs are running there:

| Piece | What it is | Where it runs now |
|---|---|---|
| Database (MongoDB) | Stores all your workouts, users, notes | Docker container `lifeos-mongo` on your laptop |
| Backend (FastAPI) | The brain — API at `localhost:8001` | Terminal on your laptop |
| Frontend (React) | The website you see | `localhost:3000` on your laptop |

If you close your laptop, the app is gone. Your friend can't open `localhost:3000` — that address only means "this same computer".

**Deploying** = moving those 3 pieces onto computers that run 24/7 on the internet (called "cloud hosting"), so the app gets a real URL like `https://lifeos-cg.vercel.app` that works from any phone, anywhere, anytime.

We'll use free tiers of 3 services (this is the standard way, not a hack):

- **MongoDB Atlas** → hosts the database (free 512 MB — plenty for years of workouts)
- **Render** → runs the FastAPI backend (free)
- **Vercel** → serves the React frontend (free)

**About your Docker Mongo:** Docker on your laptop was perfect for development, but it can't be reached from the internet. Atlas is literally the same MongoDB, hosted by the company that makes MongoDB. We'll copy your existing data into Atlas (Step 2) so you lose nothing. Keep the Docker one for local development.

Total time: ~1–1.5 hours first time. Cost: ₹0.

---

## Before you start — create 3 free accounts (use the same email everywhere)

1. https://github.com — sign up (stores your code; Render and Vercel read it from here)
2. https://www.mongodb.com/cloud/atlas/register — sign up
3. https://render.com — sign up **with your GitHub account** ("Sign in with GitHub")
4. https://vercel.com — sign up **with your GitHub account**

---

## Step 1 — Put the code on GitHub

Render and Vercel deploy whatever is in a GitHub repository. Every future `git push` will auto-redeploy the app — that's how you "keep building after deploy".

Open PowerShell in the project folder (`tracking-main`) and run, one line at a time:

```powershell
git init
git add .
git commit -m "LifeOS initial commit"
```

> Safety check: run `git status` — you should NOT see `backend/.env` or `frontend/.env` anywhere in the output. They hold your secret keys and are already git-ignored. If you see them, STOP and tell Claude.

Now on github.com: click **+** (top right) → **New repository** → name it `lifeos` → set it to **Private** → Create. GitHub then shows commands under "push an existing repository" — run those two:

```powershell
git remote add origin https://github.com/YOUR-USERNAME/lifeos.git
git push -u origin main
```

(If it complains about branch name: `git branch -M main` first, then push.)

Refresh the GitHub page — you should see all your code. ✅

---

## Step 2 — Database on MongoDB Atlas + copy your data

### 2a. Create the cluster
1. Log in to Atlas → it asks you to create a cluster → choose **M0 (Free)**, provider AWS, region **Mumbai (ap-south-1)** → Create.
2. It asks for a **database user**: username `lifeos`, click "autogenerate password" — **copy the password into Notepad now**.
3. Network access: choose **"Allow access from anywhere"** (0.0.0.0/0). (Required — Render's servers have changing addresses. Safe because the password protects the DB.)

### 2b. Get the connection string
Cluster page → **Connect** → **Drivers** → copy the string that looks like:

```
mongodb+srv://lifeos:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

Replace `<password>` with the password from Notepad. Save the full string in Notepad — this is your **MONGO_URL** for Step 3.

### 2c. Copy your existing data from Docker into Atlas
In PowerShell (Docker Desktop running, `lifeos-mongo` started):

```powershell
docker exec lifeos-mongo mongodump --db lifeos --archive=/tmp/lifeos.dump
docker exec lifeos-mongo mongorestore --uri "PASTE-YOUR-ATLAS-STRING-HERE" --archive=/tmp/lifeos.dump
```

(First command exports everything to a file inside the container; second uploads it to Atlas. Keep the quotes around the URI.)

Verify: in Atlas click **Browse Collections** — you should see the `lifeos` database with `users`, `workout_sessions`, `exercises`, etc. ✅

---

## Step 3 — Backend on Render

1. render.com dashboard → **New** → **Web Service** → connect your GitHub → pick the `lifeos` repo.
2. Fill the form:
   - **Name:** `lifeos-api` (this becomes your backend URL)
   - **Root Directory:** `backend`
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn server:app --host 0.0.0.0 --port $PORT` (Render sets `$PORT` itself — never hardcode a number here or the health check hits a dead port and the deploy fails)
   - **Instance Type:** Free
3. Scroll to **Environment Variables** → add these (copy API keys from your local `backend/.env`):

| Key | Value |
|---|---|
| `MONGO_URL` | your Atlas string from Step 2b |
| `DB_NAME` | `lifeos` |
| `JWT_SECRET` | a long random string — generate one with the PowerShell line below |
| `FRONTEND_URL` | `http://localhost:3000` for now — you'll change it in Step 4 |
| `COOKIE_SECURE` | `true` |
| `INVITE_CODE` | any secret word you choose, e.g. `beast-mode-2026` — only people who know it can register |
| `ADMIN_EMAIL` | your real email — this account is auto-created as **admin** |
| `ADMIN_PASSWORD` | a STRONG password (NOT test1234 — this is the public internet) |
| `GROQ_API_KEY` | copy from local `backend/.env` (AI coach) |
| `ANTHROPIC_API_KEY` | copy from local `.env` if you have one, else skip |

Generate a JWT secret:
```powershell
python -c "import secrets; print(secrets.token_hex(48))"
```

4. Click **Create Web Service** and watch the log. First build takes ~5 min. Done when the log says `Uvicorn running`. 
5. Your backend URL appears at the top, e.g. `https://lifeos-api.onrender.com`. Test it: open `https://lifeos-api.onrender.com/api/exercises/meta` in the browser — you should see JSON. ✅ Copy this URL to Notepad.

---

## Step 4 — Frontend on Vercel

1. **First, on your laptop:** open `frontend/vercel.json` and replace `YOUR-BACKEND.onrender.com` with your actual Render URL host (e.g. `lifeos-api.onrender.com`). Then push:
   ```powershell
   git add frontend/vercel.json
   git commit -m "point vercel proxy at render backend"
   git push
   ```
   (This file makes Vercel forward every `/api/...` request to your backend behind the scenes — so the browser thinks everything is one website. That avoids all cookie/CORS headaches.)
2. vercel.com → **Add New** → **Project** → import the `lifeos` repo.
3. Settings on the import screen:
   - **Root Directory:** click Edit → select `frontend`
   - **Framework Preset:** Create React App (auto-detected)
   - Leave build command as is (`npm run build`). **Add nothing in Environment Variables.**
   - If the build fails with a dependency error: Project → Settings → General → Install Command → override to `npm install --legacy-peer-deps` → redeploy.
4. Click **Deploy** (~3 min). You get your app URL, e.g. `https://lifeos-cg.vercel.app`. 
5. **Last wiring step:** back on Render → your service → Environment → change `FRONTEND_URL` to your Vercel URL (`https://lifeos-cg.vercel.app`) → Save (it auto-redeploys, ~1 min).

---

## Step 5 — First login + invite your friend

1. Open your Vercel URL on your phone. 🎉
2. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` — this is your **admin** account.
3. Your friend: send them the URL + the `INVITE_CODE`. They tap **Create one** → fill the form incl. invite code → they get a normal **user** account. They can never see your data; you (admin) can list accounts via the API; nobody without the code can register.
4. Your old local data is all there (came over in Step 2c).

---

## Updating the app later (the whole point!)

Keep building with Claude locally as usual. When a feature works:

```powershell
git add .
git commit -m "what you built"
git push
```

Render and Vercel both watch GitHub — **push = live in ~3 minutes.** Nothing else to do.

---

## Troubleshooting / quirks

- **First open of the day is slow (~50 s):** Render's free tier puts the backend to sleep after 15 min of no traffic; first request wakes it. Fix options: just wait, or create a free https://uptimerobot.com monitor that pings your `/api/exercises/meta` URL every 10 min to keep it awake.
- **"Invalid invite code" while testing locally:** local dev has no `INVITE_CODE` env var set, so local registration stays open. Only the deployed app is invite-only.
- **Backend errors:** Render dashboard → your service → **Logs** tab shows the same output you see in your local terminal.
- **Changed an env var on Render?** It redeploys automatically after Save.
- **AI coach not answering in prod:** confirm `GROQ_API_KEY` (or `ANTHROPIC_API_KEY`) was added on Render.
- **Never commit `.env` files.** They're git-ignored; keep it that way. Secrets live in Render's Environment tab only.
