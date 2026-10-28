import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Dumbbell, ChevronUp } from "lucide-react";
import {
  ACTIVE_SESSION_EVENT, readActiveSession, readSessionSnapshot,
  sessionElapsedSecs, isSessionPaused,
} from "@/features/workout/lib/activeSession";
import { fmtDuration } from "@/features/workout/lib/format";

/* Floating "resume workout" bar. Appears app-wide whenever a workout has been
 * minimized, and disappears on the session screen itself (where the real header
 * lives). Tapping it jumps back into the session, which resumes seamlessly. */
export default function MiniWorkoutBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [ptr, setPtr] = useState(() => readActiveSession());
  const [, setTick] = useState(0);

  // Re-read the pointer when it changes (same-tab event + cross-tab storage) and
  // on every route change.
  useEffect(() => {
    const refresh = () => setPtr(readActiveSession());
    refresh();
    window.addEventListener(ACTIVE_SESSION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ACTIVE_SESSION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [location.pathname]);

  const onSessionPage = location.pathname.startsWith("/workout/session");
  const snap = ptr ? readSessionSnapshot(ptr.storageKey) : null;
  const visible = !!ptr && !onSessionPage && !!snap;

  // Tick once a second (only while visible) so the duration keeps counting up.
  useEffect(() => {
    if (!visible) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const paused = isSessionPaused(snap);
  const secs = sessionElapsedSecs(snap);

  return (
    <button
      data-testid="mini-workout-bar"
      onClick={() => navigate(ptr.path)}
      className="fixed bottom-4 inset-x-4 sm:left-auto sm:right-6 sm:w-80 z-40 flex items-center gap-3 rounded-xl border border-[hsl(var(--maroon)/0.45)] bg-card/95 backdrop-blur px-4 py-3 shadow-lg hover:border-maroon transition text-left animate-fade-up"
    >
      <span className="h-9 w-9 rounded-lg bg-[hsl(var(--maroon)/0.15)] text-maroon flex items-center justify-center shrink-0">
        <Dumbbell className="h-5 w-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold truncate">{ptr.name || snap.name || "Workout"}</span>
        <span className="block text-[11px] text-muted-foreground tabular-nums">
          {paused ? "Paused" : "In progress"} · {fmtDuration(secs)}
        </span>
      </span>
      <span className="shrink-0 h-8 px-3 rounded-lg bg-maroon text-white text-xs font-medium flex items-center gap-1">
        <ChevronUp className="h-3.5 w-3.5" /> Resume
      </span>
    </button>
  );
}
