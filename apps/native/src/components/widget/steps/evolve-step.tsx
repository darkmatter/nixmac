"use client";

import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/widget/confirmation-dialog";
import { KeepBranchCheckbox } from "@/components/widget/keep-branch-checkbox";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { SummaryOrDiff } from "@/components/widget/summary-or-diff";
import { useApply } from "@/hooks/use-apply";
import { useRollback } from "@/hooks/use-rollback";
import { useWidgetStore } from "@/stores/widget-store";
import { Eraser, Undo2, Wrench } from "lucide-react";
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
  const [keepBranch, setKeepBranch] = useState(false);

  const cleanOnMain = gitStatus?.cleanHead && gitStatus?.isMainBranch;
  const isEvolving = !cleanOnMain

  // On a branch with builds, clearing will trigger a rebuild to restore main's config
  const needsRebuild = !gitStatus?.isMainBranch && gitStatus?.branchHasBuiltCommit;

  if (!gitStatus) {
    return null;
  }

  if (!isEvolving) {
    return (
      <div className="relative flex flex-1 flex-col items-center">
        <img src="/outline-white.png" alt="" className="mb-3 h-12 w-12 object-contain" />
        <h3 className="font-semibold text-lg">Get started</h3>
        <div className="absolute inset-0 flex w-full items-center">
          <div className="w-full">
            <PromptInputSection />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between py-3">
        <p className="text-muted-foreground text-sm">
          Ready to test-drive your changes?
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setShowClearDialog(true)}
          >
            {needsRebuild ? (
              <Undo2 className="h-3.5 w-3.5" />
            ) : (
              <Eraser className="h-3.5 w-3.5" />
            )}
            {needsRebuild ? "Undo All" : "Discard"}
          </Button>
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-500 text-white"
            onClick={() => setShowRebuildDialog(true)}
          >
            <Wrench className="h-3.5 w-3.5" />
            Build & Test
          </Button>
        </div>
      </div>

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
        message={needsRebuild ? "Discard changes and rebuild to previous state?" : "Discard all current changes?"}
        onConfirm={() => handleRollback(keepBranch)}
        color="amber"
      >
        <KeepBranchCheckbox checked={keepBranch} onCheckedChange={setKeepBranch} />
      </ConfirmationDialog>
    </>
  );
}
