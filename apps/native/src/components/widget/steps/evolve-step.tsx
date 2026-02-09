"use client";

import { ActionTiles, type ActionTile } from "@/components/widget/action-tiles";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { ConfirmationDialog } from "@/components/widget/confirmation-dialog";
import { SummaryOrDiff } from "@/components/widget/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useCommit } from "@/hooks/use-commit";
import { useWidgetStore } from "@/stores/widget-store";
import { Eraser, MessageSquare, Wrench } from "lucide-react";
import { useState } from "react";

/**
 * Evolve Step component, allowing users to plan, apply, or clear configuration changes.
 */
export function EvolveStep() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);

  const { handleApply } = useApply();
  const { handleCancel } = useCommit();

  const [showRebuildDialog, setShowRebuildDialog] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const hasChanges = (gitStatus?.files?.length ?? 0) > 0;

  const tiles: ActionTile[] = [
    {
      name: hasChanges ? "Evolve" : "Begin",
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
      disabled: !hasChanges,
      onAction: () => setShowRebuildDialog(true),
    },
    {
      name: "Clear",
      icon: Eraser,
      color: "white",
      disabled: !hasChanges,
      onAction: () => setShowClearDialog(true),
    },
  ];

  return (
    <>
      <ActionTiles
        tiles={tiles}
        title={hasChanges ? "Evolve changes" : "Get started"}
        subtitle={
          hasChanges
            ? "or hit build when you're ready for a test-drive"
            : "ask nixmac to help modify your configuration"
        }
      />
      <SummaryOrDiff />
      <PromptInputSection />

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
        message="Discard all current changes?"
        onConfirm={handleCancel}
        color="amber"
      />
    </>
  );
}
