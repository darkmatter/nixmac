"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useWidgetStore } from "@/stores/widget-store";
import { GitMerge, Loader2 } from "lucide-react";
import { useState } from "react";

export function MergeSection() {
  const [keepCommits, setKeepCommits] = useState(false);
  const summary = useWidgetStore((s) => s.summary);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const gitStatus = useWidgetStore((s) => s.gitStatus);

  const { handleMerge } = useGitOperations();

  const commits = gitStatus?.branchCommitMessages ?? [];
  const defaultCommitMsg = summary.commitMessage || commits[commits.length - 1] || "";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const squash = commits.length > 1 && !keepCommits;
    const msg = new FormData(e.currentTarget).get("commitMsg") as string;
    handleMerge(squash, squash ? msg : undefined);
  }

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-primary" />
          <h2 className="font-medium text-sm">Merge Changes</h2>
        </div>
        {commits.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Keep commits</span>
            <Switch checked={keepCommits} onCheckedChange={setKeepCommits} />
          </div>
        )}
      </div>

      <form className="pt-4" onSubmit={handleSubmit}>
        {commits.length > 1 && (
          <div className="mb-4">
            <p className="text-muted-foreground text-xs mb-2">
              {commits.length} commits on this branch:
            </p>
            <div className="max-h-24 overflow-y-auto rounded border border-border/50 bg-background/50 p-2">
              {commits.map((msg, i) => (
                <div key={i} className="text-xs text-muted-foreground py-0.5">
                  • {msg}
                </div>
              ))}
            </div>
          </div>
        )}

        {!keepCommits && (
          <div className="mb-4">
            <Input
              className="border-border bg-background mb-2"
              defaultValue={defaultCommitMsg}
              disabled={isProcessing}
              name="commitMsg"
              placeholder="Commit message..."
            />
          </div>
        )}

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
          {commits.length > 1 && !keepCommits ? "Squash and Merge" : "Merge"}
        </Button>
      </form>
    </div>
  );
}
