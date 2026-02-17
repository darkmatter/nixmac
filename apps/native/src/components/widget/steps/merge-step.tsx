"use client";

import { ActionTiles, type ActionTile } from "@/components/widget/action-tiles";
import { ConfirmationDialog } from "@/components/widget/confirmation-dialog";
import { MergeSection } from "@/components/widget/merge-section";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { SummaryOrDiff } from "@/components/widget/summary-or-diff";
import { useRollback } from "@/hooks/use-rollback";
import { GitBranch, RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";

/**
 * Commit Step component, allowing users to commit their changes, evolve further or roll back.
 */
export function MergeStep() {
  const { handleRollback } = useRollback();
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [action, setAction] = useState<"merge" | "amend">("merge");

  const tiles: ActionTile[] = [
    {
      name: "Merge",
      icon: GitBranch,
      color: "white",
      isActive: action === "merge",
      onAction: () => setAction("merge"),
    },
    {
      name: "Evolve",
      icon: RefreshCw,
      color: "teal",
      isActive: action === "amend",
      onAction: () => setAction("amend"),
    },
    {
      name: "Rollback",
      icon: Undo2,
      color: "amber",
      onAction: () => setShowRollbackDialog(true),
    },
  ];

  return (
    <>
      <ActionTiles
        tiles={tiles}
        title="All changes active!"
        subtitle="Don't forget to merge your changes if you are satisfied"
      />
      <SummaryOrDiff />
      {action === "merge" && (<MergeSection />)}
      {action === "amend" && <PromptInputSection />}

      <ConfirmationDialog
        open={showRollbackDialog}
        onOpenChange={setShowRollbackDialog}
        message="Discard changes and rebuild to previous commit?"
        onConfirm={handleRollback}
        color="amber"
      />
    </>
  );
}
