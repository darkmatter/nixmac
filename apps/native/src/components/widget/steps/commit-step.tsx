"use client";

import { MergeSection } from "@/components/widget/layout/merge-section";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import { useState } from "react";

/**
 * Commit step: changes are built and ready to commit. Shared by AI evolution
 * (`commit`) and manual drift (`manualCommit`) — the only difference is the
 * undo label, since manual drift undoes a single ad-hoc build while an AI
 * session undoes the whole evolution.
 */
export function CommitStep({ isManual = false }: { isManual?: boolean }) {
  const [action, setAction] = useState<"review" | "commit" | "amend">("review");

  return (
    <>
      <SummaryOrDiff
        undoLabel={isManual ? "Undo last build" : "Undo All"}
        onKeepChanges={() => setAction("commit")}
        onRefineFurther={() => setAction("amend")}
        actionSlot={
          action === "commit" ? (
            <MergeSection />
          ) : action === "amend" ? (
            <PromptInputSection />
          ) : null
        }
      />
    </>
  );
}
