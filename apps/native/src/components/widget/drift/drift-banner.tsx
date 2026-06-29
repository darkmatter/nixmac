"use client";

import { Button } from "@/components/ui/button";
import { ConfigDirBadge } from "@/components/widget/badges/config-dir-badge";
import { cn } from "@/lib/utils";
import { Sparkles, TriangleAlert, X } from "lucide-react";

interface DriftBannerProps {
  isManualDrift: boolean;
  fileCount: number;
  configDir: string;
  onDismiss: () => void;
}

/**
 * Context banner above the review card. Manual drift gets an amber warning
 * ("your system drifted"); an AI session gets a neutral informational banner
 * ("changes proposed for review").
 */
export function DriftBanner({ isManualDrift, fileCount, configDir, onDismiss }: DriftBannerProps) {
  const noun = fileCount === 1 ? "change" : "changes";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        isManualDrift ? "border-amber-500/30 bg-amber-800/5" : "border-border bg-muted/40",
      )}
    >
      {isManualDrift ? (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
      ) : (
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}

      <div className="min-w-0 flex-1">
        {isManualDrift ? (
          <>
            <p className="font-medium text-foreground text-sm">
              {fileCount} manual {noun} detected since your last build
            </p>
            <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
              {"Your system drifted from the tracked config in "}
              <ConfigDirBadge configDir={configDir} />
              {". Choose what to do with these changes below."}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-foreground text-sm">
              {fileCount} {noun} ready to apply
            </p>
            <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
              Press <span className="font-medium text-foreground">Build &amp; Test</span> to activate
              the changes you asked for. Reviewing the diffs below is optional.
            </p>
          </>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="-mr-1 -mt-1 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
