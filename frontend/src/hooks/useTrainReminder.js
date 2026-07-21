import { useEffect } from "react";
import api from "@/api";
import { suggestedDayIndex } from "@/pages/Workout";

const FIRED_KEY = "lifeos:train-reminder-fired";
// Only remind within this long after the set time. Without it, opening the app at
// 11pm on a 2pm reminder fires instantly — "you should have trained 9 hours ago"
// helps nobody, and it reads as a bug rather than a reminder.
const GRACE_MINUTES = 120;

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

/* In-app train reminder: while the app is open, fire a browser notification at the
   configured time naming the next day in the rotation. Background push (app closed)
   is handled by the service worker + /push/dispatch. */
export default function useTrainReminder() {
  useEffect(() => {
    const check = async () => {
      try {
        if (typeof Notification === "undefined") return;
        const { data: s } = await api.get("/workout-settings");
        if (!s.train_reminder_enabled || !s.train_reminder_time) return;
        const now = new Date();
        const target = toMinutes(s.train_reminder_time);
        if (target === null) return;
        const minsNow = now.getHours() * 60 + now.getMinutes();
        const late = minsNow - target;
        if (late < 0 || late > GRACE_MINUTES) return;      // too early, or missed it
        if (localStorage.getItem(FIRED_KEY) === now.toDateString()) return;
        if (Notification.permission === "default") await Notification.requestPermission();
        if (Notification.permission !== "granted") return;
        let body = "Time to train.";
        try {
          const { data: plans } = await api.get("/plans");
          const days = plans?.[0]?.days || [];
          const day = days[suggestedDayIndex(days)];
          if (day?.name) body = `${day.name} is next in your rotation.`;
        } catch { /* keep generic body */ }
        localStorage.setItem(FIRED_KEY, now.toDateString());
        new Notification("Time to train 🏋️", { body, tag: "lifeos-train-reminder" });
      } catch { /* logged out / offline — try again next tick */ }
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, []);
}
