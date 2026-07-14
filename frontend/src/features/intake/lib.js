// Shared helpers for the Intake feature. No React, no network — pure functions.

export const MEAL_LABELS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  pre_workout: "Pre-workout",
  post_workout: "Post-workout",
};

// The four the user actually watches. Everything else lives in the micros panel.
export const HEADLINE = ["calories", "protein_g", "carbs_g", "fat_g"];

export const CONFIDENCE_COPY = {
  high: "Confident",
  medium: "Rough estimate",
  low: "Low confidence — check this",
};

// Dates here are calendar days in the user's own timezone, never instants.
// toISOString() would convert to UTC and shift the day for anyone east or west
// of Greenwich (IST is +5:30, so local midnight is the *previous* UTC day),
// so format from the local parts instead.
function toISO(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function prettyDate(iso) {
  if (iso === todayISO()) return "Today";
  if (iso === shiftDate(todayISO(), -1)) return "Yesterday";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmt(value, unit) {
  const n = Math.round((value || 0) * 10) / 10;
  return unit === "kcal" ? String(Math.round(n)) : `${n}${unit}`;
}

// Photos go through the model as tokens, so shrink before upload: long edge
// 1024px is plenty for food identification and keeps us well under the 5 MB cap.
export function fileToCompressedDataUrl(file, maxEdge = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a readable image."));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
