"use client";

import { ConfirmButton } from "@/components/widget/controls/confirm-button";
import { cn } from "@/lib/utils";
import { Wrench, CircleCheckBig } from "lucide-react";

const busyButtonSheenClassName =
  "relative overflow-hidden disabled:opacity-100 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.3),transparent)] after:bg-size-[200%_100%] after:content-[''] motion-safe:after:animate-shimmer";

interface DriftReviewBuildCardProps {
  buildReady: boolean;
  isApplyBusy: boolean;
  rebuildRunning: boolean;
  onApply: () => void;
}

export function DriftReviewBuildCard({
  buildReady,
  isApplyBusy,
  rebuildRunning,
  onApply,
}: DriftReviewBuildCardProps) {
  const isBusy = isApplyBusy || rebuildRunning;
  let buildButtonLabel = "Build & Test";
  let buildButtonTitle: string | undefined;

  if (isApplyBusy) {
    buildButtonLabel = "Applying…";
    buildButtonTitle = "Applying configuration";
  }

  if (rebuildRunning) {
    buildButtonLabel = "Building…";
    buildButtonTitle = "Building and testing changes";
  }

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border/70 bg-card/50 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-teal-500/10 p-2 text-teal-500">
          <CircleCheckBig className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="font-semibold text-foreground">New configuration updates are available</h2>
          <p className="max-w-xl text-muted-foreground text-sm leading-relaxed">
            This Mac isn’t using the latest configuration yet. Apply the updates to bring it up to
            date.
          </p>
        </div>
      </div>

      <footer className="flex justify-end border-border/60 border-t pt-4">
        <ConfirmButton
          size="sm"
          disabled={!buildReady}
          aria-busy={isBusy}
          title={buildButtonTitle}
          className={cn(isBusy && busyButtonSheenClassName)}
          confirmPrefKey="confirmBuild"
          onConfirm={onApply}
          message="Build and apply your saved configuration?"
          color="teal"
        >
          <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
          {buildButtonLabel}
        </ConfirmButton>
      </footer>
    </div>
  );
}
