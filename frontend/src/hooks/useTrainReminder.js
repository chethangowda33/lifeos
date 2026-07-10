import { useEffect } from "react";
import api from "@/api";
import { suggestedDayIndex } from "@/pages/Workout";

const FIRED_KEY = "lifeos:train-reminder-fired";

/* In-app train reminder: while the app is open, fire a browser notification at the
   configured time naming the next day in the rotation. Background push (app closed)
   arrives with the PWA task. */
export default function useTrainReminder() {
  useEffect(() => {
    const check = async () => {
      try {
        if (typeof Notification === "undefined") return;
        const { data: s } = await api.get("/workout-settings");
        if (!s.train_reminder_enabled || !s.train_reminder_time) return;
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        if (hhmm < s.train_reminder_time || localStorage.getItem(FIRED_KEY) === now.toDateString()) return;
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
