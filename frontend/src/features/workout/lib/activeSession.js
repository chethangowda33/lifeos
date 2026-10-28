// A lightweight pointer to the workout that's currently minimized, so a floating
// "resume" bar (rendered app-wide in the Layout) can find it and jump back. The
// full session lives under its own `lifeos:session:v1:*` key — this only records
// WHICH one is active and the route to return to. Cleared when the workout is
// finished or discarded.
export const ACTIVE_SESSION_KEY = "lifeos:active-session:v1";
// Same-tab storage writes don't fire the native `storage` event, so we announce
// changes ourselves for the in-page bar to react to.
export const ACTIVE_SESSION_EVENT = "lifeos:active-session-changed";

export function setActiveSession(ptr) {
  try { localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(ptr)); } catch { /* quota */ }
  try { window.dispatchEvent(new Event(ACTIVE_SESSION_EVENT)); } catch { /* SSR / no window */ }
}

export function clearActiveSession() {
  try { localStorage.removeItem(ACTIVE_SESSION_KEY); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(ACTIVE_SESSION_EVENT)); } catch { /* ignore */ }
}

export function readActiveSession() {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function readSessionSnapshot(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Elapsed *active* seconds — paused time is excluded. A snapshot carries
// `startedAt`, `pausedAccumMs` (time already spent paused) and `pausedAt`
// (when the current pause began, or null while running). Kept identical to the
// live calculation in WorkoutSession so the bar and the session never disagree.
export function sessionElapsedSecs(snap, nowMs = Date.now()) {
  if (!snap || !snap.startedAt) return 0;
  const accum = snap.pausedAccumMs || 0;
  const end = snap.pausedAt || nowMs;
  return Math.max(0, Math.floor((end - snap.startedAt - accum) / 1000));
}

export function isSessionPaused(snap) {
  return !!(snap && snap.pausedAt);
}
