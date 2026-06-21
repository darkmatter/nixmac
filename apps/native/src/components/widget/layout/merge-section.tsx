"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownDescription } from "@/components/widget/summaries/markdown-description";
import { commitMessageBody } from "@/components/widget/summaries/markdown-utils";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useSummary } from "@/hooks/use-summary";
import { useViewModel } from "@nixmac/state";
import { useUiState } from "@nixmac/state";
import { GitMerge, Loader2 } from "lucide-react";
import { useEffect } from "react";

export function MergeSection() {
  const isProcessing = useUiState((s) => s.isProcessing);
  const processingAction = useUiState((s) => s.processingAction);
  const commitMessageSuggestion = useUiState((s) => s.commitMessageSuggestion);
  const changeMap = useViewModel((s) => s.changeMap);

  const { handleCommit } = useGitOperations();
  const { generateCommitMessage } = useSummary();

  useEffect(() => {
    generateCommitMessage();
  }, [generateCommitMessage, changeMap]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const subject = new FormData(e.currentTarget).get("commitMsg")?.toString() ?? "";
    const body = commitMessageBody(commitMessageSuggestion ?? "");
    const message = body ? `${subject}\n\n${body}` : subject;
    await handleCommit({ message });
    useUiState.getState().setEvolvePrompt("");
  }

  const commitSubject = (commitMessageSuggestion ?? "").split(/\r?\n/)[0] ?? "";
  const commitBody = commitMessageBody(commitMessageSuggestion ?? "");

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
            defaultValue={commitSubject || commitMessageSuggestion || ""}
            disabled={isProcessing}
            name="commitMsg"
            placeholder="Loading..."
          />
          {commitBody && <MarkdownDescription modalTitle={commitSubject} text={commitBody} />}
        </div>

        <Button
          className="bg-slate-200 hover:bg-slate-300 text-slate-800"
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
