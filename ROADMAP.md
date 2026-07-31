# LifeOS — Roadmap

> What we're building next, in order. `PROJECT_HANDOFF.md` is the chronological log
> (where we've been); `FEATURES.md` is the catalogue (what exists). This file is the
> queue. Tick items off as they ship and move them into the other two.

**Rule: one feature per session, `/clear` in between.** Context is the dominant cost —
a long session re-reads its whole history on every tool call. Three features in three
fresh sessions costs a fraction of three features in one. Also: fast mode off and normal
thinking for implementation work; save deep reasoning for design calls.

---

## Phase 0 — Free, and everything else depends on it

None of this costs credits. Three modules are already built and sitting idle because the
data never arrives. **Do this before spending on new features.**

- [ ] **Get steps flowing.** `Find Health Samples` returns empty on the phone while Health
      shows 400+ steps. First: add a **Quick Look** action right after it and run the
      shortcut — that distinguishes "returns 0 samples" from "returns samples that later
      actions drop", which are different bugs. Likely causes, in order: a date filter that
      doesn't match how samples are timestamped; a Limit / get-first-item setting
      truncating the result; a **Source** filter pinned to a device that isn't writing (the
      Fastrack app writes as its own source, not as "iPhone").
      **Escape hatch:** stop fighting Shortcuts — use a health-export app that POSTs to a
      REST endpoint natively (e.g. Health Auto Export). Verify its JSON against
      `POST /api/health/ingest` before committing to it. The server side is proven: pushing
      450 steps through with the user's own token stored fine.
      → unlocks: Life Score (needs 2+ tracked areas), AI coach recovery context,
      the Recovery block in reports, the steps achievements.
- [ ] **Push cron.** cron-job.org, every 15 min, `POST /api/push/dispatch` with header
      `X-Dispatch-Secret`. Keys are already on Render; delivery is proven on a real iPhone.
      **Now the single highest-leverage item on this list** — one setup switches on BOTH the
      train reminder AND the Sunday weekly recap (§27), which are otherwise built and dormant.
- [ ] **Tap Share once** after a real workout. The permanent hang is fixed and a 15s timeout
      recovers, but whether the PNG actually generates has never been settled outside a
      headless pane. One tap answers it.
- [x] ~~**Push the three unpushed commits**~~ ✅ **2026-07-31** — pushed all four
      (`761b571` reports, `616e850` achievements, `daaea8a` challenges, `2787672` quick-log).
      Vercel + Render both redeployed.
- [ ] **Sideload the APK and back up the keystore.** Both files in
      `C:\Users\chethan\lifeos-android\` (`android.keystore` + `KEYSTORE-PASSWORD.txt`) —
      lose them and the app can never be updated. See `APK_SETUP.md`.

---

## Phase 1 — Build queue, in order

### 1. ~~Voice / quick-text set logging~~ ✅ **shipped** — see `FEATURES.md` §25
Mid-set you are sweaty, one-handed, and tapping through a set grid. Let the user type or
speak `bench 80 by 8 rpe 8` and have it log the set.

- **Parse locally first, LLM only as fallback.** Most gym entries are `80x8`. A local regex
  parse is instant, free, and works with no signal — which a gym app must. Sending every set
  to an API round-trip between sets would be the wrong architecture.
- Reuses the proven structured-extraction pattern from Intake (`analyze/text` →
  `ANALYZE_SCHEMA`) for the fallback path only.
- Voice via the **Web Speech API** (on-device, no audio upload, no API cost) — not a
  server-side transcription service.
- **Undo, not confirm.** A confirm step costs a tap in the exact moment we're optimising;
  a mis-parse is recoverable with an undo toast.

### 2. ~~Weekly report push~~ ✅ **shipped 2026-07-31** — see `FEATURES.md` §27
Sunday 19:00 local, idempotent per ISO week, riding the existing dispatch cron. Opt-in in
Workout settings. **Dormant until the Phase 0 cron exists** — that one setup now switches on
both the train reminder and this.

### 3. ~~Should-I-train-today~~ ✅ **shipped 2026-07-31** — see `FEATURES.md` §26
`GET /readiness` + a dashboard card. Score out of 100, verdict, what to train, what to avoid,
and every reason with the points it cost. Not an LLM call — the arithmetic is the product.
32 tests. **The HR/HRV inputs stay dormant until the steps/health sync in Phase 0 is fixed;**
the verdict works from training + sleep alone until then.

### 4. Progress photos + before/after
In the original vision, never built. Progress has no visual dimension today. Costs more than
the others (storage, upload, privacy) — worth it **only if the photos actually get taken**.
Decide that before building it.

### 5. Form check from video
Upload a set, AI critiques the movement. The most differentiating idea here and the most fun;
also the most expensive per use and the hardest to make reliably good. **Parked until the
basics are proven in real use.**

---

## Standing

- **Use it in a real gym session.** The handoff has said this for five sessions running.
  Six modules, none used under real conditions. The bugs left are the kind that only surface
  on set four with chalk on your hands — they can't be found from here.
- **APK** — **DONE 2026-07-31.** Built locally with Bubblewrap; signed APK + AAB are in
  `C:\Users\chethan\lifeos-android\twa\`, the real signing fingerprint is live in
  `assetlinks.json`. See `APK_SETUP.md`. Left for the user: sideload it, and (optional)
  the $25 Play Console account + AAB upload.
- **Offline queue beyond workouts** — deliberately parked by the user.
- **Nutrition** — explicitly excluded. **Journal** — removed 2026-07-14, don't re-add.
