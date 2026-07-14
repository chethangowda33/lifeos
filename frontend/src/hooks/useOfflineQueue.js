import { useEffect, useState } from "react";
import { queueSize, QUEUE_CHANGED, QUEUE_SYNCED } from "@/lib/offlineQueue";

// Reactive count of pending offline writes.
export default function useOfflineQueue() {
  const [size, setSize] = useState(queueSize());
  useEffect(() => {
    const update = () => setSize(queueSize());
    window.addEventListener(QUEUE_CHANGED, update);
    window.addEventListener(QUEUE_SYNCED, update);
    window.addEventListener("online", update);
    return () => {
      window.removeEventListener(QUEUE_CHANGED, update);
      window.removeEventListener(QUEUE_SYNCED, update);
      window.removeEventListener("online", update);
    };
  }, []);
  return size;
}
