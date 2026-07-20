import { useCallback, useEffect, useState } from "react";
import api from "@/api";

/* Background push for train reminders — works with the app CLOSED, unlike
   useTrainReminder which needs an open tab.

   iOS only delivers web push to a PWA the user has installed to the Home Screen,
   so `supported` stays false in Safari's normal browsing tab. That is a platform
   rule, not a bug — the UI should say "add to Home Screen first" rather than
   offering a toggle that silently does nothing. */

// VAPID keys travel as base64url; PushManager wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function usePushSubscription() {
  const [configured, setConfigured] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined";

  useEffect(() => {
    if (!supported) return;
    api.get("/push/config")
      .then(({ data }) => { setConfigured(!!data.configured); setPublicKey(data.public_key || ""); })
      .catch(() => setConfigured(false));
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false));
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported || !configured || !publicKey) return false;
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== "granted") return false;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      await api.post("/push/subscribe", { endpoint: json.endpoint, keys: json.keys });
      // Reminder times are local wall clock; the dispatcher runs in UTC and needs the offset.
      await api.put("/workout-settings", { tz_offset_minutes: -new Date().getTimezoneOffset() });
      setSubscribed(true);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, configured, publicKey]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, [supported]);

  return { supported, configured, subscribed, busy, subscribe, unsubscribe };
}
