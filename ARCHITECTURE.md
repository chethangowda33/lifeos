# LifeOS — How This Thing Is Actually Built

> Written 2026-07-31, from the source, not from memory. Every number here was counted;
> every file path exists. If something below doesn't match the code, the code wins — and
> the doc is wrong, which has happened before (see §14).
>
> **Who this is for:** you in six months, a new collaborator, or anyone asking "how does this
> work?" It goes from the 10,000-foot view down to how a single button gets its colour.

---

## 0. The one-paragraph version

LifeOS is a **React single-page app** talking to a **Python API** over HTTP, with data in
**MongoDB**. The browser holds no business logic worth speaking of — it renders what the API
computes. The API is one big FastAPI file. The site is static files on **Vercel**; the API runs
on **Render**; the database is **MongoDB Atlas**. A thin **Android wrapper** (TWA) points at the
live site so it can be installed like a native app. Nothing is server-rendered, there is no
build step on the backend, and there is no ORM.

```
  Phone / browser
        │
        │  HTTPS
        ▼
  ┌─────────────────────┐        ┌──────────────────────┐        ┌────────────────┐
  │ Vercel              │  /api  │ Render               │ TCP    │ MongoDB Atlas  │
  │ static React bundle │───────▶│ FastAPI + uvicorn    │───────▶│ 25 collections │
  │ + service worker    │ proxy  │ server.py, intake.py │ motor  │                │
  └─────────────────────┘        └──────────────────────┘        └────────────────┘
        ▲                                  ▲
        │ wraps                            │ POSTs every 15 min
  ┌─────────────┐                  ┌───────────────┐
  │ Android TWA │                  │ cron-job.org  │
  │ com.cglifeos│                  │ push dispatch │
  └─────────────┘                  └───────────────┘
                                           ▲
                                  ┌────────────────────┐
                                  │ iPhone Shortcuts   │ POSTs health data
                                  │ (Apple Health)     │
                                  └────────────────────┘
```

**Scale, counted:** 4,380 lines in `server.py`, 1,092 in `intake.py`, 98 API routes,
25 MongoDB collections, 18 page components, 46 UI primitives, 17 shared components,
224 backend tests, 113 frontend tests.

---

## 1. The stack, and *why* each piece is there

### Frontend

| Technology | Version | What it does here | Why this and not something else |
|---|---|---|---|
| **React** | 19.0.0 | The whole UI | — |
| **Create React App + CRACO** | react-scripts 5.0.1 | Build tooling | CRA is unfashionable but zero-config. **CRACO** wraps it so we can add the `@/` path alias without ejecting. |
| **React Router** | 7.15.0 | Client-side routing, 22 routes | SPA — the server never renders a page |
| **Tailwind CSS** | 3.x | Every style in the app | No CSS files per component; classes live next to the markup |
| **shadcn/ui** | vendored | 46 UI primitives in `components/ui/` | **Not an npm dependency** — the source is copied into the repo and edited freely. See §5. |
| **Radix UI** | ~30 packages | The behaviour under shadcn (focus traps, ARIA, keyboard nav) | Accessibility is genuinely hard; Radix is unstyled and handles it |
| **axios** | 1.16.0 | One shared HTTP client (`src/api.js`) | Interceptors give us "attach the token to every request" in one place |
| **Recharts** | 3.6.0 | Every chart | React-native-feeling API, SVG output |
| **lucide-react** | 0.516.0 | Every icon | Tree-shakeable SVG components |
| **framer-motion** | 11.18.0 | Animation | Used sparingly |
| **canvas-confetti** | 1.9.4 | PR celebration | Yes, really |
| **html-to-image** | 1.11.13 | Turns the workout summary into a shareable PNG | Renders a DOM node to a canvas client-side |
| **react-body-highlighter** | 2.0.5 | The muscle heatmap | |
| **class-variance-authority** | 0.7.1 | Typed style variants for components | See §5 — this is how a button gets its look |
| **clsx + tailwind-merge** | | The `cn()` helper | See §5.2 — resolves Tailwind class conflicts |

**Present in `package.json` but barely used:** `@tanstack/react-query`, `swr`, `react-hook-form`,
`date-fns`, `dayjs`, `lodash`, `next-themes`, `embla-carousel`. These arrived with the initial
scaffold. Data fetching is plain `useEffect` + `axios`, not React Query. **Don't assume a library
is in use just because it's installed** — grep first.

### Backend

| Technology | Version | What it does here |
|---|---|---|
| **FastAPI** | 0.110.1 | The whole API. Routes, validation, dependency injection, OpenAPI docs for free |
| **uvicorn** | 0.25.0 | The ASGI server that actually listens on a port |
| **Motor** | 3.3.1 | **Async** MongoDB driver — every DB call is `await`ed |
| **PyMongo** | 4.6.3 | Motor sits on top of it; we use its `ObjectId` directly |
| **Pydantic** | 2.x | Request validation. Every `class XxxIn(BaseModel)` is a contract enforced before your code runs |
| **PyJWT** | 2.10+ | Signs and verifies the auth token |
| **bcrypt** | 4.1.3 | Password hashing — slow on purpose |
| **pywebpush** | 2.0+ | Sends browser push notifications (VAPID) |
| **anthropic** | 0.69+ | AI coach client; **Groq** is called over plain HTTP via `httpx` |
| **dnspython** | 2.6+ | Required for `mongodb+srv://` Atlas URLs. Miss it and prod won't boot |
| **python-dotenv** | | Loads `backend/.env` locally |

**No ORM, no migrations, no Alembic.** Documents are plain dicts. Adding a field means writing
it; old documents simply don't have it, and the code uses `.get(key)` with defaults everywhere.
That's a deliberate trade: fast to change, no schema safety net.

---

## 2. How a request actually travels

Follow one real click — you tap **"Change password"**.

**1. The browser** has already downloaded `main.<hash>.js`. React is running. `BodyMetrics.jsx`
renders `<ChangePassword />`, you fill the form and click the button.

**2. The component calls** `api.post("/auth/change-password", {...})`.

**3. `src/api.js`** — the single axios instance — does two things:

```js
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API_BASE = `${BACKEND_URL}/api`;

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

- **Locally** `REACT_APP_BACKEND_URL=http://localhost:8001`, so the URL is absolute.
- **In production** that variable is empty, so the URL is **`/api/auth/change-password`** —
  same-origin, relative.
- The interceptor attaches the bearer token to *every* request. `withCredentials: true` also
  sends the auth cookie.

**4. Vercel proxies it.** `frontend/vercel.json`:

```json
{ "rewrites": [{ "source": "/api/:path*",
                 "destination": "https://lifeos-api-g6hq.onrender.com/api/:path*" }] }
```

This is the single most important config in the project. Because the browser thinks it's
talking to its own origin, there is **no CORS preflight and no third-party cookie problem** —
the two things that make split frontend/backend deployments painful. The proxy makes one origin
out of two hosts.

**5. FastAPI receives it.** The route is on a router mounted at `/api`:

```python
api = APIRouter(prefix="/api")
...
app.include_router(api)
```

**6. Dependency injection runs first.** `user=Depends(get_current_user)` executes *before* the
handler body. It reads the `Authorization` header **and** the cookie, tries every credential
presented, and accepts the first that validates. (Reading only the cookie was a real bug — a
stale cookie shadowed a valid token and produced a 401.) No valid credential → 401, and your
handler never runs.

**7. Pydantic validates the body.** `payload: PasswordChangeIn` — if `new_password` is under 6
characters, FastAPI returns **422** before a line of your code executes.

**8. The handler runs**, calls `await db.users.update_one(...)` through Motor, returns a dict.
FastAPI serialises it to JSON.

**9. Back through the proxy**, axios resolves the promise, React setState, DOM updates.

**Every single feature in this app is that same nine-step path.** Learn it once.

---

## 3. Authentication, precisely

**Login** (`POST /api/auth/login`) returns **both**:
- an **httpOnly cookie** — the browser sends it automatically, JavaScript cannot read it (XSS protection)
- an **`access_token` in the JSON body** — stored in `localStorage` by `AuthContext`

Two mechanisms because the cookie fails in some contexts (the Android wrapper, cross-origin
edge cases) and the bearer token fails in others. `get_current_user` accepts either.

**The token is a JWT** signed with `JWT_SECRET`. It carries the user id and an expiry. The
server doesn't store sessions — it verifies the signature on each request. That's why **there
is no logout-everywhere**: nothing to revoke. Changing your password stops *new* logins with
the old password; it does not invalidate tokens already issued. The UI says exactly that.

**Passwords** are bcrypt-hashed. `verify_password(plain, hashed)` on login; the plaintext is
never stored or logged.

**Registration is invite-gated** when `INVITE_CODE` is set on Render — the check runs *before*
the duplicate-email check and before anything is created.

**Roles** are a single `role` field: `admin` or `user`. Admin routes are triple-gated — nav link
hidden, route redirects, and the API returns 403. UI gating alone is not security.

---

## 4. The frontend, file by file

```
frontend/src/
├── index.js              entry point; registers the service worker in PRODUCTION ONLY
├── index.css             161 lines of CSS custom properties — the design system
├── App.js                <Routes>: 22 routes, public vs protected
├── api.js                the axios instance (§2.3)
│
├── context/
│   └── AuthContext.jsx   login/register/logout/updateProfile + the current user
│
├── pages/                18 files — one per route
│   ├── Dashboard.jsx     status only, six sections
│   ├── Workout.jsx       the biggest page — routines, plans, explore, NEXT UP hero
│   ├── WorkoutSession.jsx the live logger; the most stateful screen in the app
│   ├── Progress.jsx      all analytics: charts, PR shelf, calendar, heatmap
│   ├── Habits.jsx  Sleep.jsx  Intake.jsx  Coach.jsx  Reports.jsx
│   ├── Achievements.jsx  Challenges.jsx  Connections.jsx  BodyMetrics.jsx
│   ├── Admin.jsx         read-only by design — zero click handlers
│   └── Login.jsx  Register.jsx  WorkoutSettings.jsx  ExerciseDetail.jsx
│
├── components/           17 shared components (Layout, ExercisePicker, LoadError, …)
│   └── ui/               46 shadcn primitives — see §5
│
├── features/             feature-scoped code, the newer and better pattern
│   ├── workout/
│   │   ├── lib/          PURE FUNCTIONS — payload.js, stats.js, parseSetEntry.js, activePlan.js
│   │   ├── session/      SetRow, ExerciseCard, RestTimer, StatPill, QuickLog
│   │   └── components/   ReadinessCard, SplitEditor
│   ├── progress/  reports/  achievements/  challenges/  intake/
│
├── hooks/                usePushSubscription, useOfflineQueue, useTrainReminder
├── lib/                  utils.js (cn), offlineQueue.js, localDate.js
└── constants/testIds/    every data-testid string, centralised
```

### The `features/*/lib/` rule — the most useful convention here

**Anything that is pure maths goes in a `lib/` file and gets unit-tested.** Components are hard
to test; pure functions are trivial. All 113 frontend tests are tests of pure functions — not a
single component is rendered in the test suite.

This exists because of a specific recurring bug: workout payloads were built inline in three
places, drifted apart, and produced a stream of 422s and "volume 0" reports. Now
`features/workout/lib/payload.js` is **the only** place a workout API body is constructed, and
`stats.js` is **the only** place volume/e1RM maths happens.

**If you find yourself computing the same thing in two components, that's the bug, not a style
preference.**

---

## 5. How a button is made — the full chain

You asked for this specifically. Here is every layer, bottom to top.

### 5.1 Layer 1 — a CSS custom property

`src/index.css` defines the palette as **HSL components without the `hsl()` wrapper**:

```css
.dark {
  --maroon:       353 79% 52%;
  --maroon-hover: 353 79% 44%;
  --primary:      353 79% 52%;
  --background:   0 0% 7%;
  --border:       0 0% 18%;
}
```

Values are bare (`353 79% 52%`, not `hsl(353 79% 52%)`) so opacity can be injected later:
`hsl(var(--maroon) / 0.4)` gives 40% maroon. That trick is why the whole palette is one variable
per colour instead of one per colour *and* opacity.

Light mode redefines the same names under `:root`; dark mode under `.dark`. **Nothing else in
the app hardcodes a colour** — that's how the theme switches with one class on `<html>`.

### 5.2 Layer 2 — Tailwind maps names to those variables

`tailwind.config.js`:

```js
colors: {
  primary:    { DEFAULT: 'hsl(var(--primary))',    foreground: 'hsl(var(--primary-foreground))' },
  background: 'hsl(var(--background))',
  border:     'hsl(var(--border))',
}
```

Now the class `bg-primary` compiles to `background-color: hsl(var(--primary))`. Tailwind never
sees a hex code. Change the variable, every button changes.

Tailwind scans `./src/**/*.{js,jsx,ts,tsx}` and generates CSS **only for classes it literally
finds in the source**. This has one sharp edge: **dynamically built class names don't exist at
build time and silently produce no CSS.** `` `bg-${color}-500` `` will not work. Write the full
class or use a lookup object with complete strings.

### 5.3 Layer 3 — `cn()` resolves conflicts

`src/lib/utils.js`:

```js
export function cn(...inputs) { return twMerge(clsx(inputs)); }
```

- **clsx** flattens conditionals: `cn("a", isX && "b", { c: isY })` → `"a b c"`
- **tailwind-merge** resolves *conflicts*: `cn("px-4", "px-8")` → `"px-8"`, not both.

Without `twMerge`, passing `className="px-8"` to a component whose base style is `px-4` would
produce both classes and the winner would depend on CSS source order. This is the reason every
component takes a `className` prop and pipes it through `cn()` last.

### 5.4 Layer 4 — CVA defines the variants

`components/ui/button.jsx`:

```js
const buttonVariants = cva(
  // base — applies to every button
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium \
   transition-all duration-200 active:scale-[0.98] \
   focus-visible:ring-2 focus-visible:ring-ring \
   disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:     "bg-primary text-primary-foreground elev-accent hover:bg-[hsl(var(--maroon-hover))]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:     "border border-input hover:bg-accent hover:border-[hsl(var(--maroon)/0.4)]",
        secondary:   "bg-secondary hover:bg-secondary/80",
        ghost:       "hover:bg-accent hover:text-accent-foreground",
        link:        "text-primary underline-offset-4 hover:underline",
      },
      size: { default: "h-9 px-4 py-2", sm: "h-8 px-3 text-xs",
              lg: "h-11 rounded-xl px-8", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)
```

Three details worth noticing:

- `active:scale-[0.98]` — the button physically presses in. Cheap, and it's most of why the app
  feels responsive on a phone.
- `[&_svg]:size-4` — an arbitrary child selector. **Any icon inside any button is 16px**, so no
  one has to remember to size icons.
- `disabled:opacity-50` + `disabled:pointer-events-none` — disabled state is free everywhere.

### 5.5 Layer 5 — the component

```js
const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
})
```

- **`forwardRef`** — Radix needs a real DOM ref to position popovers and manage focus.
- **`asChild` + Radix `Slot`** — the escape hatch. `<Button asChild><Link to="/x">Go</Link></Button>`
  renders an `<a>` with the button's styles. Solves "I need a link that looks like a button"
  without a second component or an invalid `<a>` inside `<button>`.
- **`{...props}`** last — so `onClick`, `type`, `aria-*`, anything, passes straight through.
- **`className` goes into `buttonVariants()`**, so `cn` merges it *after* the variant classes and
  a caller's `px-8` beats the variant's `px-4`.

### 5.6 Layer 6 — using it

```jsx
<Button size="sm" onClick={save} className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
  {saving ? "Saving…" : "Change password"}
</Button>
```

**The full path for one class:** `bg-primary` → Tailwind config → `hsl(var(--primary))` →
`index.css` `.dark` block → `353 79% 52%` → the maroon you see.

### 5.7 Why shadcn is *copied in*, not installed

`components/ui/*.jsx` are **not** an npm package. shadcn/ui is a set of files you copy into your
project and then own. Consequences:

- ✅ Edit them freely. The Card's `rounded-2xl` and `elev-card` shadow are local edits.
- ✅ No version upgrades breaking your UI.
- ❌ No upstream bug fixes either — you maintain them.
- ❌ 46 files you didn't write sitting in your repo. Many are unused (`carousel`, `menubar`,
  `input-otp`) because the whole set was pulled in at scaffold time.

Underneath, most wrap **Radix UI** — the actual npm dependencies. Radix supplies unstyled,
accessible behaviour (focus trapping, `Escape` to close, ARIA wiring, keyboard nav); shadcn adds
the Tailwind classes. `dialog.jsx` is ~40 lines of styling over `@radix-ui/react-dialog`.

---

## 6. The backend, in detail

### One file, on purpose

`server.py` is **4,380 lines**. That is not an accident of neglect — it means one place to look,
no import cycles, no cross-module refactors. `intake.py` (1,092 lines) is the exception: a
self-contained router for nutrition, mounted separately.

Its shape, top to bottom:
1. Imports, `.env` loading, Mongo client, JWT/bcrypt helpers
2. **Pydantic models** — every `XxxIn(BaseModel)` request contract
3. Constants — `VOLUME_LANDMARKS`, `DEFAULT_WORKOUT_SETTINGS`, `ACHIEVEMENTS`, …
4. Auth routes, then feature routes grouped by domain
5. The intelligence layer — PRs, e1RM, progression, readiness
6. AI coach — context building, Groq/Claude calls
7. Startup hooks — index creation, seeding

### The 98 routes, grouped

| Group | Count | Examples |
|---|---|---|
| exercises | 9 | library, search, custom CRUD, notes, records |
| auth | 6 | login, register, logout, profile, **change-password** |
| health | 6 | connection, regenerate, **ingest**, **ingest/raw**, daily, delete-day |
| workouts | 6 | list, create, update, delete, stats, muscle-volume |
| routines / plans | 9 | CRUD, reorder, folders, import-days |
| push | 4 | config, subscribe, unsubscribe, **dispatch** |
| coach | 4 | chat, recap, ingest, knowledge |
| body-metrics | 4 | latest, log, history, clear |
| habits / sleep / challenges / achievements / reports / intake / admin | rest | |

**Five routes are called by something other than the app** and that's correct: `GET /` (Render's
health check), the two health-ingest routes (your iPhone), and `/push/dispatch` (cron-job.org).

### Data access

No ORM. Every call is Motor directly:

```python
docs = await db.workout_sessions.find({"user_id": uid}).sort("created_at", -1).to_list(200)
```

Three conventions that matter:

1. **Every query filters by `user_id`.** That's the entire multi-tenancy model. Miss it once and
   a user sees someone else's data. There is no row-level security backstop.
2. **`_id` is a BSON `ObjectId`**, not a string. It's converted at the edges: `ObjectId(id_str)`
   going in, `str(doc["_id"])` coming out, exposed as `id`. A malformed id raises, so `_oid()`
   wraps it into a clean 404 instead of a 500.
3. **`$set` only writes what you pass.** Which leads to the rule below.

### The rule that came from three bugs in one day

> **An ingest must never destroy data it wasn't given.**

Pydantic optionals default to `None`, and a `None` in a `$set` is a **delete**. Three real bugs
of this exact shape surfaced on 2026-07-31:

- a sleep sync wrote `"quality": None` over a hand-set rating, every sync
- a resync could overwrite a real step count with a lower wrong one
- (the trigger) a Shortcuts recipe sent the *sample count* and stored 8 over a genuine 52

Build the `$set` from **what actually arrived**:

```python
night = {"user_id": uid, "date": d, "hours": payload.sleep_hours, "source": "sync"}
if payload.sleep_quality is not None:
    night["quality"] = payload.sleep_quality
```

**The deliberate exception:** a `PUT` carries a *whole object*, so writing `None` is correct
there — `PUT /habits/{id}` must clear `target` when you switch a count habit to a check habit.
There is a test for each so nobody "makes them consistent" later.

**And the monotonic guard:** `steps`, `distance_km`, `active_energy` only accumulate within a
day, so a lower resync is refused and reported as `kept_existing`. Which is why deleting a bad
day needs to be possible from the UI — a wrong *high* value is sticky by design.

---

## 7. The database — 25 collections

| Collection | Holds | Notes |
|---|---|---|
| `users` | account, `password_hash`, `role`, `profile`, `workout_settings`, `health_token` | settings are nested, not separate |
| `workout_sessions` | every logged workout, exercises and sets embedded | the core document |
| `routines` / `plans` | templates; plans are multi-day | plans carry both `days[]` and `routine_ids[]` — the main complexity tax |
| `exercises` | 1,432 seeded + user customs | `custom: true` marks yours |
| `exercise_notes` | persistent per-exercise notes | |
| `personal_records` / `pr_events` | current PRs / the event log | events let PRs be recomputed |
| `progression_states` | suggested weight, trend, deload/plateau flags | one per exercise |
| `habits` / `habit_logs` | definitions / daily entries | logs survive edits — that's why editing keeps your streak |
| `sleep_logs` | one night per date | `source: "sync"` marks watch-written nights |
| `health_daily` | steps, HR, HRV, SpO2, energy per day | one doc per user per date |
| `body_metrics` | weight and measurement history | |
| `intake_entries` / `intake_targets` / `intake_plans` | nutrition | |
| `challenges` / `challenge_logs` | 75 Hard etc. | rules are derived from data, not ticked |
| `achievement_unlocks` | **only first-observed moments** | badges are derived; if the data falls below the threshold the record is *deleted* and the badge re-locks |
| `reports` | cached AI narratives + a `signature` hash | stale narrative shows a banner instead of lying |
| `push_subscriptions` | browser push endpoints | dropped automatically on 404/410 |
| `knowledge` | AI coach knowledge base | |
| `programs` | the 14 Explore programs | |
| `meta` | seed signature | lets boot skip re-seeding — it used to cost ~10 min |

**Embedded vs referenced:** sets live inside exercises inside a workout document (always read
together). Habits and their logs are separate (logs are queried by date across habits). That
choice is per-collection and driven by read patterns.

---

## 8. Deployment

### Frontend → Vercel
- Root directory `frontend`, auto-deploys on push to `main`
- Build: `npx craco build` with **`CI=true`** — which turns **every ESLint warning into an error**.
  An unused import fails the deploy. Hence: always run `CI=true npx craco build` before pushing.
- `frontend/.npmrc` sets `legacy-peer-deps=true` — a pre-existing react-day-picker / date-fns@4
  peer conflict would otherwise fail install
- Output: hashed static files (`main.<hash>.js`), served from CDN

### Backend → Render
- Free tier: **sleeps after 15 minutes idle**, cold start 30–50s. The push cron pinging every 15
  minutes keeps it awake as a side effect — a real performance win nobody planned
- Auto-deploys on push. Config is env vars: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `FRONTEND_URL`,
  `COOKIE_SECURE`, `INVITE_CODE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUSH_DISPATCH_SECRET`,
  `VAPID_*`, `GROQ_API_KEY`, and `ADMIN_PASSWORD_RESET` (break-glass — see §12)

### Database → MongoDB Atlas
Free M0 tier, 512 MB. Text data is tiny; this is why **progress photos must never go in Mongo**.

### One push deploys everything
`git push origin main` → Vercel and Render both rebuild. No staging environment. The build gate
is your only safety net, which is why it isn't optional.

---

## 9. PWA and offline

- **`public/manifest.json`** — name, icons (192/512/maskable), `display: standalone`,
  `start_url: /dashboard`, maroon `theme_color`. This is what makes "Add to Home Screen" produce
  an app-looking thing rather than a bookmark.
- **`public/sw.js`** — cache `lifeos-v1`: precache the shell, **network-first** for navigations
  with an offline fallback to cached `index.html`, stale-while-revalidate for static assets, and
  **skips `/api` entirely** (stale API data would be worse than an error).
- **Registered in `src/index.js` production-only** — a service worker in dev caches your
  hot-reloads and you spend an hour wondering why edits don't appear.
- **Offline write queue** (`lib/offlineQueue.js`): if `POST /workouts` fails on a network error,
  the body is stored in `localStorage` and replayed on the `online` event. Wired to workout saves
  and habit logs only; sleep/health still fail hard offline.

---

## 10. The Android app

**A TWA — Trusted Web Activity.** Not React Native, not Capacitor: a native shell that opens the
live site full-screen in a Chrome engine with no URL bar.

- Package `com.cglifeos.app`, built with **Bubblewrap** (Google's TWA CLI)
- Lives **outside the repo** in `C:\Users\chethan\lifeos-android\`
- **`frontend/public/.well-known/assetlinks.json`** carries the signing key's SHA-256. That file
  is what removes the URL bar — Android fetches it and verifies the app owns the domain
- **`git push` updates the app.** The APK is a window onto the live site; you rebuild it only for
  a name/icon/version change
- ⚠️ `android.keystore` + its password are **the only irreplaceable artifacts in this project**.
  Lose them and the app can never be updated by anyone, ever
- **Limitation:** a TWA cannot read Health Connect or do native push. That would need Capacitor —
  same React build, different shell

---

## 11. Health sync — the most complex integration

The goal is brand-agnostic: **any** watch writes to Apple Health / Health Connect, and a phone
automation pushes a daily summary to us. No per-brand APIs.

```
Watch/phone → Apple Health → Shortcuts automation (11:30 PM daily)
                                    │
                                    │ POST, header X-Health-Token
                                    ▼
                        /api/health/ingest/raw?metric=steps
                                    │
                          server sums the samples
                                    ▼
                          health_daily / sleep_logs
```

**Auth is a per-user `health_token`**, not the JWT — an automation can't do a login flow. It's a
password for your health data.

**Two endpoints:**
- `/health/ingest` — clean JSON (`{"steps": 8432}`). Android automation apps use this.
- `/health/ingest/raw?metric=steps` — takes Shortcuts' output *directly* and sums server-side,
  echoing `received_preview` so a wrong shape is visible instead of guessed at.

**The bug that cost an evening,** documented so nobody repeats it: posting the raw `Health
Samples` variable sends **the number of samples**, not the total. It stored `8` while Health
showed `52` — with `ok: true` and no error. The fix is a `Calculate Statistics → Sum` action and
posting **the `Sum` variable**. The server cannot detect this: a correct sum and a wrong count
arrive as the same thing, a bare number. Only the Health app can tell you which you sent.

**Second trap:** a background automation **can never show the iOS Health permission prompt**, so
a schedule-only shortcut fails silently forever. Run it by hand once with ▶ first.

---

## 12. Push notifications

Web Push with VAPID keys. Two jobs share one dispatcher:

1. **Train reminder** — at your set time, naming the next day in your rotation
2. **Sunday weekly recap** — 19:00 local, "4 sessions · 18.4k kg · 2 PRs", opening `/reports`

**Render's free tier sleeps, so the app cannot wake itself.** An external scheduler
(cron-job.org) POSTs `/api/push/dispatch` every 15 minutes with `X-Dispatch-Secret`. The endpoint
figures out who is due and sends.

**Idempotency** is the whole design: reminders are keyed per user per **day**, recaps per user
per **ISO week** (`2026-W31`, zero-padded, ISO year — so Sunday 2027-01-03 stamps `2026-W53` and
doesn't double-fire across the new year). A cron running four times inside the window sends once;
a cron that misses Sunday sends *nothing*, because a stale "your week" on Tuesday is worse than
none.

---

## 13. Testing

| Suite | Count | Command | Needs |
|---|---|---|---|
| Backend | **219** + 5 opt-in | `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -p xdist -p asyncio` | most need a **live** server on :8001 + Mongo |
| Frontend | **113** | `cd frontend && CI=true npx craco test --watchAll=false` | nothing |

**Backend tests hit a real running server over HTTP** rather than mocking. Slower, but they test
the actual stack — routing, validation, serialisation, Mongo. If they all fail on
connection-refused, the server isn't running; that's not a regression.

**The pure ones need no server:** `compute_readiness`, `weekly_push_due`, `merge_daily_metrics`,
`activePlan` import directly.

**Frontend tests render nothing.** All 113 test pure functions in `features/*/lib/`. Testing
React components well is expensive; testing the maths is cheap and catches the bugs that matter.

⚠️ **`test_change_password.py` is local-only AND opt-in** (`RUN_PASSWORD_TESTS=1`). It changes the
shared admin password and restores it in a `finally` — including it in normal runs made them flaky,
because any suite authenticating inside that window gets a 401. Never point it at prod.

⚠️ **`uvicorn --reload` takes 30–60s here.** Running tests too soon after a backend edit silently
exercises the *old* code. That produced both a false pass and a false fail in one session.

---

## 14. Things that will bite you

1. **`CI=true` turns warnings into errors.** An unused import fails the Vercel deploy. Run the
   build gate before every push.
2. **Dynamic Tailwind classes silently produce no CSS.** `` `bg-${x}-500` `` never works.
3. **`opacity-0 group-hover:opacity-100` is invisible on a phone.** There is no hover on touch.
   This bug has recurred at least four times here. Row actions must be always-visible.
4. **Every Mongo query needs `user_id`.** No safety net exists.
5. **`None` in a `$set` is a delete.** §6.
6. **The docs drift, in both directions.** FEATURES.md once listed "edit habit" as a user click
   when no button existed, *and* listed three fixed things as still broken. **Verified at the API
   is not reachable by a user.** Trust the code; correct the doc when they disagree.
7. **A prefix-matching route audit lies.** `PUT /habits/{id}` looks "called" because
   `api.get("/habits")` shares the prefix. Match verb + path together.
8. **Installed ≠ used.** React Query, SWR, lodash, date-fns are all in `package.json` and
   essentially unused. Grep before assuming.

---

## 15. Adding a feature — the actual checklist

1. **Model** — a `class XxxIn(BaseModel)` in `server.py` with real constraints (`ge`, `le`,
   `min_length`). This is your validation; there is no other layer.
2. **Route** — `@api.get/post(...)` with `user=Depends(get_current_user)`. Filter by `user_id`.
3. **Pure logic in a named function**, not inline in the handler, so it can be tested without a
   server (`compute_readiness` is the model to copy).
4. **Backend test** — pure tests for the maths, HTTP tests for the contract. Clean up any data
   you create on the shared account.
5. **Frontend** — page or component; pure maths goes in `features/*/lib/` with a `.test.js`.
6. **testids** — add to `constants/testIds/`, and delete them when the element goes.
7. **Build gate** — `CI=true npx craco build`.
8. **Both suites green.**
9. **Commit and push** — that deploys it.
10. **Update `FEATURES.md` and `PROJECT_HANDOFF.md`.** Write down what you decided and *why*,
    especially the things you deliberately didn't do.

---

## 16. Where everything is

| File | What it's for |
|---|---|
| `ARCHITECTURE.md` | this file — how it's built |
| `PROJECT_HANDOFF.md` | the chronological log — what happened, session by session. **§0 first** |
| `FEATURES.md` | the catalogue — what exists, what's verified, what to improve |
| `ROADMAP.md` | the queue — what's next, in order |
| `HEALTH_SYNC_SETUP.md` | the Shortcuts recipe, including the traps |
| `APK_SETUP.md` | building and shipping the Android app |
| `DEPLOYMENT.md` | Vercel + Render setup, beginner-level |
| `backend/server.py` | 4,380 lines: everything except nutrition |
| `backend/intake.py` | 1,092 lines: nutrition, self-contained |
| `frontend/vercel.json` | the `/api` proxy — the most important 5 lines in the repo |
