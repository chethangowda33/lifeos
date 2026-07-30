import React from "react";

/* Markdown-lite renderer for coach output — bold and bullets, nothing else.

   The models are asked for exactly those two things, so a full markdown
   dependency would be weight for nothing. Shared by the dashboard recap and the
   period report so both render the same prose the same way. */
export default function AiText({ text }) {
  const boldify = (s) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={i} className="text-foreground font-medium">{p.slice(2, -2)}</strong>
        : <span key={i}>{p}</span>);
  return (
    <div className="space-y-1.5 text-sm text-muted-foreground">
      {(text || "").split("\n").filter((l) => l.trim()).map((l, i) => {
        const t = l.trim();
        if (/^[-*]\s/.test(t)) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-maroon">•</span>
              <span>{boldify(t.replace(/^[-*]\s/, ""))}</span>
            </div>
          );
        }
        return <p key={i}>{boldify(t)}</p>;
      })}
    </div>
  );
}
