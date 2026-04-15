"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useSummary } from "@/hooks/use-summary";
import { useWidgetStore } from "@/stores/widget-store";
import { GitMerge, Loader2 } from "lucide-react";
import { useEffect } from "react";

export function MergeSection() {
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const commitMessageSuggestion = useWidgetStore((s) => s.commitMessageSuggestion);

  const { handleCommit } = useGitOperations();
  const { generateCommitMessage } = useSummary();

  useEffect(() => {
    generateCommitMessage();
  }, [generateCommitMessage]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const msg = new FormData(e.currentTarget).get("commitMsg")?.toString() ?? "";
    await handleCommit({ message: msg });
    useWidgetStore.getState().setEvolvePrompt("");
  }

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-primary" />
          <h2 className="font-medium text-sm">Commit Changes</h2>
        </div>
      </div>

      <form className="pt-4" onSubmit={handleSubmit}>
        <div className="mb-4">
          <Input
            key={commitMessageSuggestion}
            className="border-border bg-background mb-2"
            defaultValue={commitMessageSuggestion ?? ""}
            disabled={isProcessing}
            name="commitMsg"
            placeholder="Loading..."
          />
        </div>

        <Button
          className="bg-teal-600 hover:bg-teal-500 text-white"
          disabled={isProcessing}
          type="submit"
        >
          {processingAction === "merge" ? (
            <Loader2 className="mx-1 h-4 w-4 animate-spin" />
          ) : (
            <GitMerge className="mx-1 h-4 w-4" />
          )}
          Commit
        </Button>
      </form>
    </div>
  );
}
