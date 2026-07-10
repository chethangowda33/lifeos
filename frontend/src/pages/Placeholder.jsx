import React from "react";
import { Card } from "@/components/ui/card";

export default function Placeholder({ title, description, icon: Icon }) {
  return (
    <div className="max-w-3xl animate-fade-up">
      <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Coming next</div>
      <h1 className="text-4xl font-semibold tracking-tight mt-1">{title}</h1>
      <p className="text-muted-foreground text-sm mt-2 max-w-xl">{description}</p>

      <Card className="mt-6 p-12 text-center border-dashed">
        {Icon && (
          <div className="h-14 w-14 mx-auto rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] flex items-center justify-center">
            <Icon className="h-6 w-6" />
          </div>
        )}
        <h3 className="mt-4 text-lg font-semibold">In development</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          This pillar is on the roadmap. Focus this iteration is the Workout + Body Metrics + Theme system.
        </p>
      </Card>
    </div>
  );
}
