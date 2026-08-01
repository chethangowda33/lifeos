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

- [x] ~~**Get steps flowing.**~~ ✅ **2026-07-31 — steps are syncing.** The blocker was never
      the filters (Type/Start Date/Limit were right all along) and never the server. Two
      things, in order: the 2-action recipe posted the **Health Samples** variable raw, which
      on iOS 26 serialises to the **sample count** — it stored `8` while Health showed `52`,
      with `stored: true` and no error. Adding **Calculate Statistics → Sum** and posting the
      **`Sum`** variable to `/api/health/ingest/raw?metric=steps` fixed it. `HEALTH_SYNC_SETUP.md`
      now carries the working recipe and the warning; the old 2-action advice was wrong and
      is retracted there.
      → unlocked: Life Score (needs 2+ tracked areas), AI coach recovery context, the Recovery
      block in reports, the steps achievements, and the HR/HRV half of `/readiness` (§26)
      once `resting_hr` / `hrv` get their own action pairs.
- [x] ~~**Push cron.**~~ ✅ **2026-07-31** — live on cron-job.org ("LifeOS push"), every 15 min,
      `POST /api/push/dispatch` with `X-Dispatch-Secret`, 30s timeout. Test run returned
      **200 `{"ok":true,"sent":0,"dropped":0,"weekly_sent":0}`** in 3.9s. Both the train
      reminder and the Sunday weekly recap (§27) are now armed — they fire once the user turns
      the toggles on in Workout settings and subscribes a device. Side benefit: the 15-minute
      ping keeps the free Render tier awake, so cold starts are gone.
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
`GET /readiness` + a card on the **Workout** page (the roadmap said dashboard; that was wrong —
it's a decision, and it belongs next to the button you press). Score out of 100, verdict, what to train, what to avoid,
and every reason with the points it cost. Not an LLM call — the arithmetic is the product.
32 tests. **The HR/HRV inputs stay dormant until the steps/health sync in Phase 0 is fixed;**
the verdict works from training + sleep alone until then.

### 4. ~~Progress photos + before/after~~ ❌ **DROPPED by the user 2026-07-31**
Decision made after costing it out: storage is genuinely free at this scale (~95 MB over three
years for two users on Cloudflare R2's 10 GB tier), so money was never the issue. The cost is
the privacy work — private bucket, short-lived signed URLs, real file deletion on account
delete — and that is only worth paying **if the photos get taken**. The user's answer was no.
**Don't re-propose it.** If it ever comes back, the storage note above is the starting point.

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
