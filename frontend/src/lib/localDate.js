/* The user's own calendar date (YYYY-MM-DD).
   The backend defaults undated logs to the UTC date, so in IST (+5:30) anything
   logged between midnight and 05:30 would land on *yesterday* — which quietly
   breaks streaks for the late-night habits people actually track. Endpoints that
   accept an optional `date` should be given this instead of relying on the default. */
export default function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
