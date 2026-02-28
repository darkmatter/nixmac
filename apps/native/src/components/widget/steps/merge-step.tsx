"use client";

import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/widget/confirmation-dialog";
import { KeepBranchCheckbox } from "@/components/widget/keep-branch-checkbox";
import { MergeSection } from "@/components/widget/merge-section";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { SummaryOrDiff } from "@/components/widget/summary-or-diff";
import { useRollback } from "@/hooks/use-rollback";
import { RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";

/**
 * Commit Step component, allowing users to commit their changes, evolve further or roll back.
 */
export function MergeStep() {
  const { handleRollback } = useRollback();

  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [keepBranch, setKeepBranch] = useState(false);
  const [action, setAction] = useState<"merge" | "amend">("merge");

  return (
    <>
      <div className="flex items-center justify-between py-3">
        <p className="text-muted-foreground text-sm">
          All changes active!
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-400 hover:text-rose-300 hover:bg-rose-400/10"
            onClick={() => setShowRollbackDialog(true)}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Rollback
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setAction(action === "merge" ? "amend" : "merge")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {action === "merge" ? "Continue editing" : "Back to merge"}
          </Button>
        </div>
      </div>

      <SummaryOrDiff />
      {action === "merge" && <MergeSection />}
      {action === "amend" && <PromptInputSection />}

      <ConfirmationDialog
        open={showRollbackDialog}
        onOpenChange={setShowRollbackDialog}
        message="Discard changes and rebuild to previous commit?"
        onConfirm={() => handleRollback(keepBranch)}
        color="amber"
      >
        <KeepBranchCheckbox checked={keepBranch} onCheckedChange={setKeepBranch} />
      </ConfirmationDialog>
    </>
  );
}
