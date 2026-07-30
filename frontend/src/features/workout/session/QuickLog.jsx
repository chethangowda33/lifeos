import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, CornerDownLeft } from "lucide-react";

import { Input } from "@/components/ui/input";
import { parseSetEntry, describeSet } from "@/features/workout/lib/parseSetEntry";
import { SESSION } from "@/constants/testIds";

/* Log a set by typing or saying it.

   Lives in the sticky header on purpose: mid-workout you're scrolled down to
   exercise four, and a control you have to scroll back up to find is a control
   you won't use. It costs ~44px of a phone screen and saves the scroll-find-tap
   sequence that the set grid otherwise demands between every set.

   Speech uses the browser's own recogniser — on-device, no audio upload, no API
   cost, and it degrades to a plain text field where the API doesn't exist. */

/* Chrome, Edge and iOS Safari expose this under the webkit prefix. */
function getRecognizer() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

const MESSAGES = {
  "no-set": "Couldn't find a set in that — try “80x8”.",
  "no-exercise": (r) => `No “${r.query}” in this workout.`,
  "no-target": "Add an exercise first.",
  "kg-range": "That weight looks wrong — check the number.",
  "reps-range": "That rep count looks wrong — check the number.",
};

export default function QuickLog({ exercises, defaultIdx, onLog }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  const [voiceSupported] = useState(() => !!getRecognizer());

  // Stop the mic if the user navigates away mid-utterance.
  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch { /* already gone */ }
  }, []);

  const submit = (value) => {
    const entry = String(value ?? text).trim();
    if (!entry) return;
    const parsed = parseSetEntry(entry, exercises, defaultIdx);
    if (!parsed.ok) {
      const msg = MESSAGES[parsed.reason];
      setError(typeof msg === "function" ? msg(parsed) : msg || "Couldn't read that.");
      return;
    }
    setError("");
    setText("");
    onLog(parsed);
  };

  const toggleMic = () => {
    const Recognizer = getRecognizer();
    if (!Recognizer) return;
    if (listening) {
      try { recognitionRef.current?.stop(); } catch { /* nothing running */ }
      return;
    }
    const recognition = new Recognizer();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const said = event.results?.[0]?.[0]?.transcript || "";
      setText(said);
      // Speak-and-it's-logged. A confirm step here would cost a tap in the exact
      // moment we're optimising; a wrong read is recoverable from the undo toast.
      submit(said);
    };
    recognition.onerror = (event) => {
      setListening(false);
      setError(
        event?.error === "not-allowed"
          ? "Microphone blocked — allow access in your browser settings."
          : "Didn't catch that.",
      );
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  };

  const target = exercises?.[defaultIdx];

  return (
    <div className="px-4 sm:px-6 pb-3" data-testid={SESSION.quickLog}>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Input
            ref={inputRef}
            value={text}
            data-testid={SESSION.quickLogInput}
            aria-label="Quick log a set"
            placeholder={target ? `Log a set — “80x8” or “${firstWord(target.name)} 80x8”` : "Log a set — “80x8”"}
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-10 pr-8 text-sm"
            onChange={(e) => { setText(e.target.value); if (error) setError(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submit(); }
              if (e.key === "Escape") { setText(""); setError(""); }
            }}
          />
          {text && (
            <CornerDownLeft
              className="h-3.5 w-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
          )}
        </div>
        {voiceSupported && (
          <button
            type="button"
            onClick={toggleMic}
            aria-label={listening ? "Stop listening" : "Log a set by voice"}
            aria-pressed={listening}
            data-testid={SESSION.quickLogMic}
            className={`h-10 w-10 shrink-0 rounded-lg grid place-items-center transition-colors ${
              listening ? "bg-maroon text-white animate-pulse" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {listening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </button>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-amber-500 mt-1.5" data-testid={SESSION.quickLogError}>{error}</p>
      )}
      {listening && !error && (
        <p className="text-[11px] text-muted-foreground mt-1.5">Listening… say “eighty by eight”.</p>
      )}
    </div>
  );
}

/* "Barbell Bench Press" → "Bench" — the word someone would actually say, so the
   placeholder teaches the shortest thing that works rather than the full name. */
function firstWord(name) {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  const skip = new Set(["barbell", "dumbbell", "cable", "machine", "band", "smith", "ez"]);
  const word = words.find((w) => !skip.has(w.toLowerCase())) || words[0] || "bench";
  return word.toLowerCase();
}

export { describeSet };
