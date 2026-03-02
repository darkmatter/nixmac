"use client";

import { ActionTiles, type ActionTile } from "@/components/widget/action-tiles";
import { ConfirmationDialog } from "@/components/widget/confirmation-dialog";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { SummaryOrDiff } from "@/components/widget/summary-or-diff";
import { SystemDefaultsCTA } from "@/components/widget/system-defaults-cta";
import { useApply } from "@/hooks/use-apply";
import { useRollback } from "@/hooks/use-rollback";
import { useWidgetStore } from "@/stores/widget-store";
import { Eraser, MessageSquare, Undo2, Wrench } from "lucide-react";
import { useState } from "react";

/**
 * Evolve Step component, allowing users to plan, apply, or clear configuration changes.
 */
export function EvolveStep() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);

  const { handleApply } = useApply();
  const { handleRollback } = useRollback();


  const [showRebuildDialog, setShowRebuildDialog] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const isEvolving = Boolean(gitStatus?.diff)

  // On a branch with builds, clearing will trigger a rebuild to restore main's config
  const needsRebuild = !gitStatus?.isMainBranch && gitStatus?.branchHasBuiltCommit;

  const tiles: ActionTile[] = [
    {
      name: isEvolving ? "Evolve" : "Begin",
      icon: MessageSquare,
      iconSrc: "/outline-white.png",
      color: "white",
      isActive: true,
      onAction: () => {},
    },
    {
      name: "Build",
      icon: Wrench,
      color: "teal",
      disabled: !isEvolving,
      onAction: () => setShowRebuildDialog(true),
    },
    {
      name: needsRebuild ? "Rollback" : "Clear",
      icon: needsRebuild ? Undo2 : Eraser,
      color: needsRebuild ? "amber" : "white",
      disabled: !isEvolving,
      onAction: () => setShowClearDialog(true),
    },
  ];

  if (!gitStatus) {
    return null;
  }

  return (
    <>
      <ActionTiles
        tiles={tiles}
        title={isEvolving ? "Evolve changes" : "Get started"}
        subtitle={
          isEvolving
            ? "or hit build when you're ready for a test-drive"
            : "ask nixmac to help modify your configuration"
        }
      />
      <SummaryOrDiff />
      <PromptInputSection />
      <SystemDefaultsCTA />

      <ConfirmationDialog
        open={showRebuildDialog}
        onOpenChange={setShowRebuildDialog}
        message="Rebuild with these configuration changes?"
        onConfirm={handleApply}
        color="teal"
      />

      <ConfirmationDialog
        open={showClearDialog}
        onOpenChange={setShowClearDialog}
        message={needsRebuild ? "Discard changes and rebuild to previous state?" : "Discard all current changes?"}
        onConfirm={handleRollback}
        color="amber"
      />
    </>
  );
}
