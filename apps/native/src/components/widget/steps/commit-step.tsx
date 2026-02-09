"use client";

import { ActionTiles, type ActionTile } from "@/components/widget/action-tiles";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { CommitSection } from "@/components/widget/commit-section";
import { ConfirmationDialog } from "@/components/widget/confirmation-dialog";
import { SummaryOrDiff } from "@/components/widget/summary-or-diff";
import { useCommit } from "@/hooks/use-commit";
import { useWidgetStore } from "@/stores/widget-store";
import { GitBranch, RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";

/**
 * Commit Step component, allowing users to commit their changes, evolve further or roll back.
 */
export function CommitStep() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);

  const { handleCancel } = useCommit();
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [action, setAction] = useState<"commit" | "amend">("commit");

  const stagedFiles = gitStatus?.files || [];
  const allChangesCleanlyStaged = gitStatus?.allChangesCleanlyStaged ?? false;

  const tiles: ActionTile[] = [
    {
      name: "Commit",
      icon: GitBranch,
      color: "white",
      disabled: !allChangesCleanlyStaged || stagedFiles.length === 0,
      isActive: action === "commit",
      onAction: () => setAction("commit"),
    },
    {
      name: "Evolve",
      icon: RefreshCw,
      color: "blue",
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
        title="Test your changes!"
        subtitle="Commit to make them final, evolve further or roll back"
      />
      <SummaryOrDiff />
      {action === "commit" && (<CommitSection />)}
      {action === "amend" && <PromptInputSection />}

      <ConfirmationDialog
        open={showRollbackDialog}
        onOpenChange={setShowRollbackDialog}
        message="Discard changes and rebuild to previous commit?"
        onConfirm={handleCancel}
        color="amber"
      />
    </>
  );
}
