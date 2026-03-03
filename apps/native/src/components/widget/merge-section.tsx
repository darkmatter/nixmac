"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useWidgetStore } from "@/stores/widget-store";
import { GitMerge, Loader2 } from "lucide-react";
import { useState } from "react";

export function MergeSection() {
  const [squash, setSquash] = useState(true);
  const commitMsg = useWidgetStore((s) => s.commitMsg);
  const setCommitMsg = useWidgetStore((s) => s.setCommitMsg);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const summary = useWidgetStore((s) => s.summary);

  const { handleMerge } = useGitOperations();

  const commits = gitStatus?.branchCommitMessages ?? [];

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-primary" />
          <h2 className="font-medium text-sm">Merge Changes</h2>
        </div>
        {commits.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {squash ? "Squash" : "Keep commits"}
            </span>
            <Switch checked={squash} onCheckedChange={setSquash} />
          </div>
        )}
      </div>

      <div className="pt-4">
        {/* Commit list */}
        {commits.length > 0 && (
          <div className="mb-4">
            <p className="text-muted-foreground text-xs mb-2">
              {commits.length} commit{commits.length !== 1 ? "s" : ""} on this branch:
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

        {/* Squash message input (conditional) */}
        {squash && (
          <div className="mb-4">
            <p className="text-muted-foreground text-xs mb-2">
              Enter a commit message for the squashed commit:
            </p>
            <Input
              className="border-border bg-background mb-2"
              disabled={isProcessing}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commitMsg.trim() && !isProcessing) {
                  handleMerge(squash, commitMsg);
                }
              }}
              placeholder="Squash commit message..."
              value={commitMsg}
            />
            {summary.commitMessage && commitMsg !== summary.commitMessage && (
              <button
                type="button"
                className="block w-full text-left text-muted-foreground text-xs hover:text-foreground break-words whitespace-normal"
                onClick={() => setCommitMsg(summary.commitMessage || "")}
              >
                Use suggested: "
                <span className="break-words whitespace-normal">{summary.commitMessage}</span>"
              </button>
            )}
          </div>
        )}

        {/* Merge button */}
        <Button
          className="bg-primary/90 hover:bg-primary"
          disabled={isProcessing || (squash && !commitMsg.trim())}
          onClick={() => handleMerge(squash, squash ? commitMsg : undefined)}
        >
          {processingAction === "merge" ? (
            <Loader2 className="mx-1 h-4 w-4 animate-spin" />
          ) : (
            <GitMerge className="mx-1 h-4 w-4" />
          )}
          {squash ? "Squash and Merge" : `Merge ${commits.length} Commits`}
        </Button>
      </div>
    </div>
  );
}
