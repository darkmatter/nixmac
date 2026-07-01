"use client";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CheckConfirmationOff } from "@/components/widget/controls/check-confirmation-off";
import { ConfirmationDialog } from "@/components/widget/controls/confirmation-dialog";
import { MergeSection } from "@/components/widget/layout/merge-section";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useConfirm } from "@/hooks/use-confirm";
import { useRollback } from "@/hooks/use-rollback";
import { CheckCircle, MoreVertical, RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";

/**
 * Commit step: changes are built and ready to commit. Shared by AI evolution
 * (`commit`) and manual drift (`manualCommit`) — the only difference is the
 * undo label, since manual drift undoes a single ad-hoc build while an AI
 * session undoes the whole evolution.
 */
export function CommitStep({ isManual = false }: { isManual?: boolean }) {
  const { handleRollback } = useRollback();
  const [action] = useState<"commit" | "amend">("commit");
  const rollbackConfirm = useConfirm({
    confirmPrefKey: "confirmRollback",
    onConfirm: handleRollback,
  });

  return (
    <>
      <div className="flex items-center justify-between py-3">
        <h3 className="text-base font-bold flex items-center gap-2 text-zinc-900 dark:text-zinc-200/90">
          <CheckCircle className="size-4 text-green-500" />
          Your changes have been activated successfully
        </h3>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" aria-label="More actions" size="icon-sm" className="outline-none hover:outline-none">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={rollbackConfirm.request}>
                <Undo2 />
                {isManual ? "Undo last build" : "Undo All"}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Button variant="link" size="sm">
                  <RefreshCw />
                  {action === "commit" ? "Continue editing" : "Back to commit"}
                </Button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ConfirmationDialog
        open={rollbackConfirm.open}
        onOpenChange={rollbackConfirm.setOpen}
        message="Discard changes and rebuild to previous commit?"
        onConfirm={rollbackConfirm.handleConfirm}
        color="amber"
      >
        <CheckConfirmationOff onCheckedChange={rollbackConfirm.setDisable} />
      </ConfirmationDialog>

      <p className="text-sm mb-2 text-zinc-900 dark:text-zinc-200/90 leading-relaxed tracking-tight">
        If you're happy with your changes, click the "Commit" button below to add it to your version history.
      </p>
      <br />
      <SummaryOrDiff />
      <br />
      {action === "commit" && <MergeSection />}
      {action === "amend" && <PromptInputSection />}
    </>
  );
}
