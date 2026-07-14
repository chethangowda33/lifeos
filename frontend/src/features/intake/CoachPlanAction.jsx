import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ApplyPlanDialog from "./components/ApplyPlanDialog";

/**
 * The bridge from a coach reply into the Intake tracker.
 *
 * Drops a single button under an assistant message. The coach's text is only
 * parsed when the user presses it — we don't run an extraction on every reply,
 * and we don't write anything without the review step.
 *
 * The whole Coach page only needs to render this one component.
 */
export default function CoachPlanAction({ messages }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const onApplied = (res) => {
    setOpen(false);
    if (!res.applied.length) {
      toast({ title: "Nothing applied", description: "Your tracker is unchanged." });
      return;
    }
    const what = res.applied
      .map((a) => ({ profile: "body stats", targets: "daily targets", meals: "meal plan" }[a]))
      .join(" and ");
    toast({
      title: `Updated your ${what}`,
      description: "Open Intake to see it.",
      action: (
        <button
          onClick={() => navigate("/intake")}
          className="text-xs font-medium text-maroon hover:underline"
        >
          Open
        </button>
      ),
    });
  };

  return (
    <>
      <div className="mt-2.5 pt-2 border-t border-border/60">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--maroon)/0.4)] px-2.5 py-1 text-[11px] text-maroon hover:bg-[hsl(var(--maroon)/0.08)] transition"
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          Apply to Intake
        </button>
      </div>

      {/* Mounted only once opened, so the extraction runs on demand — not on every reply. */}
      {open && (
        <ApplyPlanDialog
          open={open}
          onClose={() => setOpen(false)}
          onApplied={onApplied}
          messages={messages}
        />
      )}
    </>
  );
}
