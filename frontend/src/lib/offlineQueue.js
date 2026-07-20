// Offline write-queue — persists failed/offline POSTs and replays them on reconnect.
// App-level (works on iOS too, unlike Background Sync). Payloads are small JSON.
import api from "@/api";

const KEY = "lifeos:offline-queue";
export const QUEUE_CHANGED = "lifeos:queue-changed";
export const QUEUE_SYNCED = "lifeos:queue-synced";

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function write(q) {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* quota — ignore */ }
  window.dispatchEvent(new CustomEvent(QUEUE_CHANGED, { detail: { size: q.length } }));
}

export function queueSize() { return read().length; }

// axios network failure has no `response`; that's our "still offline / unreachable" signal.
export function isNetworkError(e) { return !e?.response; }

export function enqueue({ url, method = "post", body, label }) {
  const q = read();
  q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url, method, body, label, ts: Date.now() });
  write(q);
}

/* Send a write, falling back to the queue when the network is the problem.
   Returns `{ queued: true }` if it was parked — callers should keep their
   optimistic UI in that case instead of refetching (a refetch would revert it).
   Real API errors (4xx/5xx) still throw so the caller can surface them. */
export async function sendOrQueue({ url, method = "post", body, label }) {
  try {
    return await api.request({ url, method, data: body });
  } catch (e) {
    if (isNetworkError(e) || !navigator.onLine) {
      enqueue({ url, method, body, label });
      return { queued: true };
    }
    throw e;
  }
}

let flushing = false;

// Replay queued requests in order. Stops on network/5xx (retry later), drops on 4xx (won't succeed).
export async function flushQueue() {
  if (flushing || !navigator.onLine) return 0;
  if (!read().length) return 0;
  flushing = true;
  let synced = 0;
  try {
    for (const item of read()) {
      try {
        await api.request({ url: item.url, method: item.method, data: item.body });
        synced += 1;
        write(read().filter((x) => x.id !== item.id));
      } catch (e) {
        if (isNetworkError(e) || (e.response && e.response.status >= 500)) break; // transient — keep & retry later
        write(read().filter((x) => x.id !== item.id)); // 4xx — drop so it can't wedge the queue
      }
    }
  } finally {
    flushing = false;
  }
  if (synced > 0) window.dispatchEvent(new CustomEvent(QUEUE_SYNCED, { detail: { synced } }));
  return synced;
}

// Flush whenever the connection returns, and once shortly after load (auth ready).
if (typeof window !== "undefined") {
  window.addEventListener("online", () => flushQueue());
  setTimeout(() => flushQueue(), 1500);
}
