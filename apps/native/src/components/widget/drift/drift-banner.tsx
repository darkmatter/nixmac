"use client";

import { Button } from "@/components/ui/button";
import { ConfigDirBadge } from "@/components/widget/badges/config-dir-badge";
import { TriangleAlert, X } from "lucide-react";

interface DriftBannerProps {
  fileCount: number;
  configDir: string;
  onDismiss: () => void;
}

/**
 * Warning banner shown above the drift review card: tells the user how many
 * manual changes were detected and where the config drifted.
 */
export function DriftBanner({ fileCount, configDir, onDismiss }: DriftBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-800/5 px-4 py-3">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground text-sm">
          {fileCount} manual {fileCount === 1 ? "change" : "changes"} detected since your last build
        </p>
        <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
          {"Your system drifted from the tracked config in "}
          <ConfigDirBadge configDir={configDir} />
          {". Choose what to do with these changes below."}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDismiss}
        aria-label="Dismiss drift notice"
        className="-mr-1 -mt-1 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
