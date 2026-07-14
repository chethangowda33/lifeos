// Every network call the Intake feature makes. Nothing outside this folder
// talks to /api/intake, so the backend contract has exactly one consumer.
import api from "@/api";

export const getMeta = () => api.get("/intake/meta").then((r) => r.data);
export const getStatus = () => api.get("/intake/status").then((r) => r.data);

export const getDay = (date) =>
  api.get("/intake/day", { params: date ? { date } : {} }).then((r) => r.data);

export const getHistory = (days = 14) =>
  api.get("/intake/history", { params: { days } }).then((r) => r.data);

export const getTargets = () => api.get("/intake/targets").then((r) => r.data);
export const saveTargets = (targets) =>
  api.put("/intake/targets", targets).then((r) => r.data);

// Analysis never writes. It returns candidates; the user confirms, then we
// call createEntry for each accepted item.
export const analyzePhoto = (image, hint = "") =>
  api.post("/intake/analyze/photo", { image, hint }).then((r) => r.data);

export const analyzeText = (text) =>
  api.post("/intake/analyze/text", { text }).then((r) => r.data);

export const createEntry = (entry) =>
  api.post("/intake/entries", entry).then((r) => r.data);

export const updateEntry = (id, entry) =>
  api.put(`/intake/entries/${id}`, entry).then((r) => r.data);

export const deleteEntry = (id) =>
  api.delete(`/intake/entries/${id}`).then((r) => r.data);

// ── Coach → Intake bridge ────────────────────────────────────────────────────
// extractPlan reads a proposal out of what the coach said and returns it as a
// diff. applyPlan writes only the parts the user ticked. Neither assumes yes.
export const extractPlan = (messages) =>
  api.post("/intake/plan/extract", { messages }).then((r) => r.data);

export const applyPlan = (selection) =>
  api.post("/intake/plan/apply", selection).then((r) => r.data);

export const getPlan = () => api.get("/intake/plan").then((r) => r.data);
export const deletePlan = () => api.delete("/intake/plan").then((r) => r.data);

// "What should I eat now?" — suggests, never logs.
export const suggestMeal = (date) =>
  api.post("/intake/suggest", null, { params: date ? { date } : {} }).then((r) => r.data);
