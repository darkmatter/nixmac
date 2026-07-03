"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownDescription } from "@/components/widget/summaries/markdown-description";
import { commitMessageBody } from "@/components/widget/summaries/markdown-utils";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useSummary } from "@/hooks/use-summary";
import { uiActions, useUiState, useViewModel } from "@nixmac/state";
import { GitMerge, Loader2, Pencil, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

export function MergeSection() {
  const isProcessing = useUiState((s) => s.isProcessing);
  const processingAction = useUiState((s) => s.processingAction);
  const commitMessageSuggestion = useUiState((s) => s.commitMessageSuggestion);
  const changeMap = useViewModel((s) => s.changeMap);

  const { handleCommit } = useGitOperations();
  const { generateCommitMessage } = useSummary();

  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsGenerating(true);
    generateCommitMessage().finally(() => {
      if (!cancelled) setIsGenerating(false);
    });
    return () => {
      cancelled = true;
    };
  }, [generateCommitMessage, changeMap]);

  async function handleRegenerate() {
    setIsGenerating(true);
    try {
      await generateCommitMessage();
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const subject = new FormData(e.currentTarget).get("commitMsg")?.toString() ?? "";
    const body = commitMessageBody(commitMessageSuggestion ?? "");
    const message = body ? `${subject}\n\n${body}` : subject;
    await handleCommit({ message });
    uiActions.setEvolvePrompt("");
  }

  const commitSubject = (commitMessageSuggestion ?? "").split(/\r?\n/)[0] ?? "";
  const commitBody = commitMessageBody(commitMessageSuggestion ?? "");

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-primary" />
          <h2 className="font-medium text-sm">
            Additional Description
            <span className="text-muted-foreground text-xs pl-2">
              (Stored in your version history)
            </span>
          </h2>
        </div>
      </div>

      <form className="pt-4" onSubmit={handleSubmit}>
        <div className="mb-4">
          <div className="flex gap-2">
            <Input
              key={commitMessageSuggestion}
              className="border-border bg-background mb-2 flex-1"
              defaultValue={commitSubject || commitMessageSuggestion || ""}
              disabled={isProcessing}
              name="commitMsg"
              placeholder="Commit message…"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mb-2 h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
              disabled={isProcessing || isGenerating}
              onClick={handleRegenerate}
              title="Regenerate commit message"
            >
              <RotateCw className={isGenerating ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </Button>
          </div>
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
