# Health sync — get your watch data into LifeOS

LifeOS is **brand-agnostic**. It never talks to Garmin/Fitbit/Fastrack APIs. Instead your
watch already syncs into your phone's health hub — **Apple Health** on iPhone, **Health
Connect** on Android — and a phone automation pushes a daily summary to LifeOS.

That means any watch works, including a Fastrack, as long as its app is allowed to write
to Apple Health / Health Connect.

---

## What you need first

1. **Your ingest key.** Open LifeOS → **Connections** → reveal and copy the key.
2. **Your endpoint** (same for everyone):
   `https://lifeos-api-g6hq.onrender.com/api/health/ingest`
3. The key goes in a header called `X-Health-Token`. It is *not* your password — anyone
   with it can only write health numbers to your account. Regenerate it any time from
   the same screen if you ever paste it somewhere public.

> The backend runs on Render's free tier and sleeps after 15 minutes idle. The first
> request of the day may take 30–50 seconds. That is normal — let the automation finish.

---

## ⭐ The recipe that actually works (3 actions) — verified on a real iPhone 2026-07-31

**Shortcuts → Automation → Time of Day → 11:30 PM, Daily, Run Immediately**, then:

| # | Action | Settings |
|---|---|---|
| 1 | **Find Health Samples** | Type `Steps`, Start Date `is today`, Limit **off**, Group by `None` |
| 2 | **Calculate Statistics** | Operation **`Sum`**, Input = the **Health Samples** from step 1 |
| 3 | **Get Contents of URL** | see below |
| 4 | **Quick Look** *(while setting up)* | shows the server's reply; delete it once it works |

**Get Contents of URL:**
- URL: `https://lifeos-api-g6hq.onrender.com/api/health/ingest/raw?metric=steps`
- Method: **POST**
- Headers: `X-Health-Token` → your key
- Request Body: **File** (not JSON) → choose the **`Sum`** variable from step 2
  (Shortcuts names that variable after the operation, so it reads "Sum", not "Statistics")

The response tells you exactly what happened:

```json
{"ok": true, "metric": "steps", "stored": true, "total": 412,
 "samples": 37, "parsed_as": "text-lines", "received_preview": "..."}
```

- `stored: true` → it worked
- `stored: false` → `received_preview` shows precisely what your phone sent, so the
  problem is visible rather than guessed at. Send that preview along if you need help.

### ⚠️ Do NOT drop Calculate Statistics — it fails by storing a WRONG number

An earlier version of this file recommended a 2-action recipe that posted the **Health
Samples** variable straight to `/ingest/raw` and let the server sum it. On a real iPhone
(iOS 26, 2026-07-31) that variable serialises to **the number of samples, not the steps**.

The failure is nasty because it looks like success:

```json
{"ok":true,"stored":true,"total":8,"samples":1,
 "received_preview":"8","parsed_as":"json-number"}
```

Health showed **52** steps that moment, across 8 chunks of walking. The phone sent `8`.
`stored: true`, no error, a plausible-looking small number written to the database.

**The tell:** `parsed_as: "json-number"` with `samples: 1` and a total that is suspiciously
small and **doesn't move when you walk** — re-run after a walk and the number barely
changes, because sample *count* grows far slower than step count.

The server cannot detect this. A correct `Sum` and a wrong sample count arrive as the
identical payload — a bare number. Only the Health app can tell you which one you sent, so
**always check the first run against Health → Steps → today before trusting it.**

Change `?metric=steps` to any field in the table below — `resting_hr`, `active_energy`,
`sleep_hours`, etc. Add one more **Find Health Samples → Get Contents of URL** pair per
metric you want.

**Deleting a bad sync:** `DELETE /api/health/daily/{YYYY-MM-DD}` (needs a normal login,
not the health token) removes a day that was written with wrong numbers.

---

## iPhone — Apple Shortcuts (the supported path)

### Step 1 — let your watch write to Apple Health
Open your watch's own app (Fastrack / Garmin Connect / Fitbit / Zepp…) → its settings →
enable writing to **Apple Health**, and turn on every metric you care about (steps,
heart rate, sleep, SpO2). Confirm it worked: open **Health → Browse → Activity → Steps**
and check today has a number.

### Step 2 — build the Shortcut
**Shortcuts app → Automation tab → + → Time of Day.**

- Time: **11:30 PM** (late enough that the day's data is complete)
- Repeat: **Daily**
- **Run Immediately** (turn OFF "Notify When Run" once you've confirmed it works)

Now add these actions in order:

| # | Action | Settings |
|---|---|---|
| 1 | **Find Health Samples** | Type `Steps`, Sort `Start Date`, Limit **off**, Date range **Today** |
| 2 | **Calculate Statistics** | Operation `Sum`, Input = the Health Samples from step 1 |
| 3 | **Set Variable** | Name it `steps` |
| 4 | **Find Health Samples** | Type `Resting Heart Rate`, Date range **Today**, Limit `1` |
| 5 | **Calculate Statistics** | Operation `Average` |
| 6 | **Set Variable** | Name it `rhr` |
| 7 | **Find Health Samples** | Type `Sleep Analysis`, Date range **Today** |
| 8 | **Calculate Statistics** | Operation `Sum` (this gives sleep in **minutes**) |
| 9 | **Set Variable** | Name it `sleepmin` |
| 10 | **Get Contents of URL** | see below |

**Action 10 — Get Contents of URL**

- URL: `https://lifeos-api-g6hq.onrender.com/api/health/ingest`
- Method: **POST**
- Headers:
  - `X-Health-Token` → *paste your key*
  - `Content-Type` → `application/json`
- Request Body: **JSON**, with these fields:

| Key | Type | Value |
|---|---|---|
| `steps` | Number | the `steps` variable |
| `resting_hr` | Number | the `rhr` variable |
| `sleep_hours` | Number | the `sleepmin` variable **÷ 60** |

For `sleep_hours`, insert a **Calculate** action between 9 and 10: `sleepmin ÷ 60`, and
use that result.

### Step 3 — test it
Tap the ▶︎ button in the Shortcut editor. You should get a response containing
`"ok": true` and a `stored` list naming each field it saved. Then open LifeOS →
**Dashboard** — a "Today's health · from your watch" strip appears once today has data.

If it returns **401**, the token is wrong or has a stray space. Re-copy it.

---

## Adding more metrics (optional)

Every field below is accepted. Send only the ones your watch actually records — missing
fields are simply skipped, they don't error.

| Field | Unit | Apple Health sample name |
|---|---|---|
| `steps` | count | Steps |
| `distance_km` | km | Walking + Running Distance |
| `resting_hr` | bpm | Resting Heart Rate |
| `avg_hr` | bpm | Heart Rate (average) |
| `hrv` | ms | Heart Rate Variability (SDNN) |
| `spo2` | % | Blood Oxygen |
| `respiratory_rate` | breaths/min | Respiratory Rate |
| `active_energy` | kcal | Active Energy |
| `stress` | 0–100 | (watch-specific; skip if unavailable) |
| `sleep_hours` | hours | Sleep Analysis ÷ 60 |
| `sleep_quality` | 1–5 | your own rating; usually left out |

You can also pass `date` as `YYYY-MM-DD` to backfill a past day. Without it the server
uses **today in UTC** — if you run the automation after midnight local time, send `date`
explicitly or the data lands on the wrong day.

Sleep is special: `sleep_hours` and `sleep_quality` are written into the **Sleep** module
(upserted per night), not just the health strip — so one automation feeds both.

---

## Android — Health Connect

Same endpoint, same header, same JSON. Use **Tasker** (paid) or **Macrodroid** (free):

1. Grant the automation app **Health Connect** read permission for the metrics you want.
2. Trigger: daily at 23:30.
3. Action: **HTTP Request** → POST → the URL above → header `X-Health-Token` → JSON body
   with the same field names.

---

## Verifying it stuck

- **Connections** page shows live tiles once data arrives.
- **Dashboard** shows the "Today's health" strip only on days that have data.
- The **AI Coach** picks up a 7-day average (steps, resting HR, HRV, stress, SpO2) plus
  your sleep, and is told to factor low sleep or high stress in before pushing hard
  training. So this genuinely changes the coaching, not just a widget.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401` | Wrong/stale token, or a space when pasting. Re-copy from Connections. |
| Request hangs ~40s then works | Render free tier waking up. Expected. |
| `"stored": []` **with `ok: true`** | The token is fine — the value arrived as `null`. Shortcuts does this when a **Number**-typed JSON field holds a variable it can't resolve, or when Calculate Statistics returned nothing. Post to `/ingest/raw` instead so the reply shows you what was actually sent. |
| **A small number that doesn't grow when you walk** | You posted the raw **Health Samples** variable instead of the **Sum** — that serialises to the sample *count*. `stored: true` and no error, but the figure is wrong. See the warning under the recipe above. |
| `Find Health Samples` returns nothing at all | Shortcuts may never have been granted Health read access. A **background automation cannot show a permission prompt**, so it fails silently forever. Open the shortcut and run it by hand once with ▶ — that's what makes iOS ask. |
| `"stored": []` **and you sent JSON** | Field name doesn't match the table exactly (it's `steps`, not `Steps`). |
| Data on the wrong day | Automation ran after local midnight; send `date` explicitly. |
| Nothing in Apple Health to read | The watch's own app isn't writing to Health yet (Step 1). |
| Health reads return nothing despite data existing | Shortcuts lacks Health permission. **Settings → Health → Data Access & Devices → Shortcuts** → enable the metrics. iOS fails this *silently* — it returns an empty set, not an error. |

### Verified payload behaviour
Tested directly against prod, so these are facts not guesses:

| Sent | Result |
|---|---|
| `{"steps": 437}` | stored ✓ |
| `{"steps": "437"}` | stored ✓ (strings are coerced) |
| `{"steps": null}` | **`stored: []`** — the silent-failure case |
| `{"steps": ""}` | `422` validation error |
