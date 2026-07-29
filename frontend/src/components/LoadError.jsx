import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/* Shown when a page's data failed to load.

   Without this a rejected request left the page rendering its EMPTY state — a
   server hiccup was indistinguishable from "you have no habits yet", which
   invites the user to re-create data they already have. An explicit failure
   with a retry is the honest version, and it keeps every page saying it the
   same way. */
export default function LoadError({ onRetry, what = "this page", compact = false }) {
  const body = (
    <div className="text-center">
      <AlertTriangle className="h-7 w-7 mx-auto text-amber-400" />
      <h3 className="mt-3 font-semibold">Couldn&apos;t load {what}</h3>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Check your connection — your data is safe.
      </p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Try again
        </Button>
      )}
    </div>
  );
  return compact ? body : <Card className="p-8 border-dashed">{body}</Card>;
}
