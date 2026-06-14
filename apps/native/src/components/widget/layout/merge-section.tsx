"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownDescription } from "@/components/widget/summaries/markdown-description";
import { useCommitMessageDraft } from "@/components/widget/layout/use-commit-message-draft";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { GitMerge, Loader2 } from "lucide-react";

export function MergeSection() {
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const changeMap = useViewModel((s) => s.changeMap);

  const { handleCommit } = useGitOperations();
  const {
    body: commitBody,
    reset: resetCommitMessageDraft,
    setSubject: setCommitSubject,
    status,
    subject: commitSubject,
  } = useCommitMessageDraft(changeMap);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const subject = commitSubject.trim();
    if (!subject) {
      return;
    }

    const message = commitBody ? `${subject}\n\n${commitBody}` : subject;
    const didCommit = await handleCommit({ message });
    if (!didCommit) {
      return;
    }

    const store = useWidgetStore.getState();
    store.setCommitMessageSuggestion(null);
    store.setEvolvePrompt("");
    resetCommitMessageDraft();
  }

  const canCommit = !isProcessing && commitSubject.trim().length > 0;

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
            className="border-border bg-background mb-2"
            name="commitMsg"
            onChange={(event) => {
              setCommitSubject(event.target.value);
            }}
            placeholder={status === "loading" ? "Loading..." : undefined}
            value={commitSubject}
            disabled={isProcessing}
          />
          {status === "fallback" && (
            <p className="mb-2 text-muted-foreground text-xs">
              Still generating a better suggestion. This fallback will update if
              one arrives.
            </p>
          )}
          {status === "error" && (
            <p className="mb-2 text-muted-foreground text-xs">
              Suggestion unavailable. You can commit with this fallback or edit it.
            </p>
          )}
          {commitBody && (
            <MarkdownDescription modalTitle={commitSubject} text={commitBody} />
          )}
        </div>

        <Button
          className="bg-slate-200 hover:bg-slate-300 text-slate-800"
          disabled={!canCommit}
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
