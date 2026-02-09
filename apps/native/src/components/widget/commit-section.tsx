"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCommit } from "@/hooks/use-commit";
import { useWidgetStore } from "@/stores/widget-store";
import { GitBranch, Loader2 } from "lucide-react";

export function CommitSection() {
  const commitMsg = useWidgetStore((s) => s.commitMsg);
  const setCommitMsg = useWidgetStore((s) => s.setCommitMsg);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const summary = useWidgetStore((s) => s.summary);

  const { handleCommit } = useCommit();

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border/50 border-b py-2">
        <GitBranch className="h-4 w-4 text-primary" />
        <h2 className="font-medium text-sm">Enter a commit message</h2>
      </div>

      <div className="pt-4">
        <p className="text-muted-foreground text-xs mb-2">
          This message will categorize changes and help you roll back.
        </p>
        <Input
          className="border-border bg-background mb-2"
          disabled={isProcessing}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && commitMsg.trim() && !isProcessing) {
              handleCommit();
            }
          }}
          placeholder="Commit message..."
          value={commitMsg}
        />
        <div className="flex flex-col items-start gap-6">
          {summary.commitMessage && commitMsg !== summary.commitMessage && (
            <button
              type="button"
              className="text-muted-foreground text-xs hover:text-foreground"
              onClick={() => setCommitMsg(summary.commitMessage || "")}
            >
              Use suggested: "{summary.commitMessage}"
            </button>
          )}
          <Button
            className="bg-primary/90 hover:bg-primary"
            disabled={isProcessing || !commitMsg.trim()}
            onClick={handleCommit}
          >
            {processingAction === "commit" ? (
              <Loader2 className="mx-1 h-4 w-4 animate-spin" />
            ) : (
              <GitBranch className="mx-1 h-4 w-4" />
            )}
            Commit Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
