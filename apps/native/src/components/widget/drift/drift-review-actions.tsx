"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmButton } from "@/components/widget/controls/confirm-button";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronDown,
  CircleAlert,
  GitCommitHorizontal,
  Loader2,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";

const busyButtonSheenClassName =
  "relative overflow-hidden disabled:opacity-100 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.3),transparent)] after:bg-size-[200%_100%] after:content-[''] motion-safe:after:animate-shimmer";

interface DriftReviewActionsProps {
  buildChecking: boolean;
  buildCheckFailed: boolean;
  buildReady: boolean;
  isApplyBusy: boolean;
  isManualDrift: boolean;
  onApply: () => void;
  onBackToPrompt: () => void;
  onRefineWithAi: () => void;
  onRequestDiscard: () => void;
  rebuildRunning: boolean;
}

export function DriftReviewActions({
  buildChecking,
  buildCheckFailed,
  buildReady,
  isApplyBusy,
  isManualDrift,
  onApply,
  onBackToPrompt,
  onRefineWithAi,
  onRequestDiscard,
  rebuildRunning,
}: DriftReviewActionsProps) {
  const isBusy = buildChecking || isApplyBusy || rebuildRunning;
  let statusMessage: string | null = null;
  let buildButtonLabel = "Build & Test";

  if (buildCheckFailed) {
    statusMessage = "Build check failed";
    buildButtonLabel = "Check failed";
  }

  if (isApplyBusy) {
    statusMessage = "Applying configuration";
    buildButtonLabel = "Applying…";
  }

  if (rebuildRunning) {
    statusMessage = "Building and testing changes";
    buildButtonLabel = "Building…";
  }

  if (buildChecking) {
    statusMessage = "Checking changes before build";
    buildButtonLabel = "Checking…";
  }

  return (
    <footer className="flex items-center justify-between gap-3 border-border/60 border-t pt-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={onRequestDiscard}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Discard
      </Button>

      <div className="flex items-center gap-2">
        {statusMessage && (
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              buildCheckFailed && !isBusy ? "text-destructive" : "text-muted-foreground",
            )}
            role={buildCheckFailed && !isBusy ? "alert" : "status"}
          >
            {isBusy ? (
              <Loader2 className="h-3 w-3 animate-spin text-teal-500" aria-hidden="true" />
            ) : (
              <CircleAlert className="h-3 w-3" aria-hidden="true" />
            )}
            {statusMessage}
          </span>
        )}

        {!isManualDrift && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToPrompt}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Prompt
          </Button>
        )}

        <div className="flex items-center">
          <ConfirmButton
            size="sm"
            disabled={!buildReady}
            aria-busy={isBusy}
            title={statusMessage ?? undefined}
            className={cn(isManualDrift && "rounded-r-none", isBusy && busyButtonSheenClassName)}
            confirmPrefKey="confirmBuild"
            onConfirm={onApply}
            message="Rebuild with these configuration changes?"
            color="teal"
          >
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            {buildButtonLabel}
          </ConfirmButton>

          {isManualDrift && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={isBusy}
                  aria-busy={isBusy}
                  aria-label="More build options"
                  className={cn(
                    "rounded-l-none border-primary-foreground/20 border-l px-2",
                    isBusy && busyButtonSheenClassName,
                  )}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="w-56">
                <DropdownMenuItem onSelect={onRefineWithAi}>
                  <Sparkles />
                  <span>
                    Refine with AI first
                    <span className="block text-[10px] text-muted-foreground">
                      Adopt these changes into an AI session
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <GitCommitHorizontal />
                  <span>
                    Commit without building
                    <span className="block text-[10px] text-muted-foreground">
                      Track as-is, skip rebuild — coming soon
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </footer>
  );
}
