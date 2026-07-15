# Turn LifeOS into an Android app (APK)

Your app is already a PWA, so we wrap the live site in a thin Android shell (a
**TWA** — Trusted Web Activity). The app opens `https://lifeos-nine-eta.vercel.app`
full-screen with no browser bar, and **every `git push` updates the app** — you
never re-release for content changes.

Two tracks below. **Track A (PWABuilder) is the easiest — no tools to install.**

Your values (already filled in everywhere):
- **URL:** `https://lifeos-nine-eta.vercel.app`
- **Package / App ID:** `com.cglifeos.app`
- **App name:** `CG's LifeOS`  ·  **Launcher name:** `LifeOS`

---

## Track A — PWABuilder (web, ~15 min, recommended)

1. Open **https://www.pwabuilder.com** and paste `https://lifeos-nine-eta.vercel.app`, hit **Start**.
2. It scores your PWA (should pass — manifest + service worker + icons are all set). Click **Package For Stores → Android**.
3. In the Android options set:
   - **Package ID:** `com.cglifeos.app`
   - **App name:** `CG's LifeOS`
   - Leave "Signing key" as **"Create new"** the first time (PWABuilder generates your keystore — **download and keep the `.zip`, it contains your signing key; if you lose it you can't update the app later**).
4. Click **Download**. The zip contains:
   - `app-release-signed.apk`  → for installing on your phone right now (sideload)
   - `app-release-bundle.aab`  → for the Play Store (later)
   - `assetlinks.json`         → the domain-verification file **with your real fingerprint**
   - a `signing.keystore` + `signing-key-info.txt` → **back these up somewhere safe**

5. **Wire up domain verification** (removes the URL bar):
   - Open the `assetlinks.json` from the zip, copy the `sha256_cert_fingerprints` value.
   - Paste it into `frontend/public/.well-known/assetlinks.json` (already in your repo), replacing `REPLACE_ME_WITH_YOUR_APP_SIGNING_SHA256_FINGERPRINT`.
   - `git commit && git push` → Vercel serves it at
     `https://lifeos-nine-eta.vercel.app/.well-known/assetlinks.json`.
   - Verify it's live: open that URL in a browser, you should see your JSON.

6. **Install on your phone (sideload):**
   - Send `app-release-signed.apk` to your phone (AirDrop-equivalent, email, Google Drive, USB).
   - Tap it → Android asks to allow "install unknown apps" → allow → Install.
   - Open it. If the URL bar still shows, it means step 5 hasn't propagated yet — reinstall after `assetlinks.json` is live.

Done. That APK is shareable with your friend the same way.

---

## Track B — Bubblewrap (Google's CLI, more control)

Prereqs: **Node 18+** and **JDK 17** installed.

```bash
# 1. Install
npm i -g @bubblewrap/cli

# 2. Generate the Android project from your live manifest
bubblewrap init --manifest https://lifeos-nine-eta.vercel.app/manifest.json
#   When prompted, use:
#     Application ID:  com.cglifeos.app
#     Launcher name:   LifeOS
#     Start URL:       /dashboard
#     Signing key:     let it create ./android.keystore (BACK THIS UP)

# 3. Build the APK + AAB
bubblewrap build
#   -> app-release-signed.apk  (sideload)
#   -> app-release-bundle.aab  (Play Store)

# 4. Print your signing fingerprint for assetlinks.json
bubblewrap fingerprint list
#   Copy the SHA-256 value into frontend/public/.well-known/assetlinks.json
#   (replace REPLACE_ME_...), then git push.
```

---

## Putting it on the Google Play Store (optional, later)

1. One-time **Google Play Developer account** — $25.
2. Upload the **`.aab`** (not the apk), add a short description, screenshots, and the 512 icon.
3. Google reviews it (usually 1–3 days). After that it's a normal Play Store app.
4. For Play Store, Google re-signs your app, so you'll swap in **Play's** signing
   fingerprint in `assetlinks.json` (Play Console → Setup → App integrity shows it).
   You can list **both** fingerprints in the file — see below.

---

## `assetlinks.json` reference

The file at `frontend/public/.well-known/assetlinks.json` can hold multiple
fingerprints (e.g. your local key **and** Play's key), so both the sideloaded
APK and the Play Store build verify:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.cglifeos.app",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:...your local/PWABuilder key...",
        "11:22:33:...Play App Signing key (add when you publish)..."
      ]
    }
  }
]
```

---

## Notes for LifeOS specifically

- **Auth/cookies still work** — the TWA uses Chrome under the hood, same-origin,
  so your JWT cookie flow is unchanged.
- **Offline** — your service worker already gives an offline shell inside the app.
- **Push notifications & watch/health sync**: a TWA can't do native push or read
  Apple Health / Health Connect directly. When you want those, migrate the wrapper
  to **Capacitor** (keep the same React build, add native plugins). The web app
  code doesn't change; only the shell does. That's the natural next step for the
  universal health-sync goal.
