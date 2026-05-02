"use client";

import { useWidgetStore } from "@/stores/widget-store";
import { Loader2 } from "lucide-react";

/**
 * Generic overlay for non-agent config edits that are being written into the repo.
 * This intentionally sits before the rebuild overlay: once a build starts,
 * `rebuild.isRunning` takes over with richer progress UI.
 */
export function ConfigEditOverlayPanel() {
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const rebuildRunning = useWidgetStore((s) => s.rebuild.isRunning);

  if (!(isProcessing && processingAction === "apply") || rebuildRunning) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-border bg-background/95 px-6 py-8 text-center shadow-2xl">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="space-y-1">
          <h2 className="font-medium text-base">Applying changes</h2>
          <p className="text-muted-foreground text-sm">
            Updating your configuration and preparing the review step.
          </p>
        </div>
      </div>
    </div>
  );
}