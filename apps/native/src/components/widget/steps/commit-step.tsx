"use client";

import { GitBranch, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  analyzeGitStatus,
  type GitStatus,
  type ProcessingAction,
  type SummaryState,
} from "@/stores/widget-store";
import { Diff } from "../diff";

interface CommitStepProps {
  gitStatus: GitStatus | null;
  commitMsg: string;
  setCommitMsg: (s: string) => void;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  handleCommit: () => void;
  handleCancel: () => void;
  handleEvolve: () => void;
  setEvolvePrompt: (s: string) => void;
  evolvePrompt: string;
  summary: SummaryState;
}

export function CommitStep({
  gitStatus,
  commitMsg,
  setCommitMsg,
  isProcessing,
  processingAction,
  handleCommit,
  handleCancel,
  handleEvolve,
  setEvolvePrompt,
  evolvePrompt,
  summary,
}: CommitStepProps) {
  const { stagedFiles, allChangesStaged } = analyzeGitStatus(gitStatus);
  const [selectedAction, setSelectedAction] = useState<"commit" | "update" | "rollback" | null>(
    allChangesStaged && stagedFiles.length > 0 ? "commit" : null,
  );

  const actions = [
    {
      id: "commit" as const,
      name: "Commit",
      icon: GitBranch,
      desc: "Save changes to git",
      color: "white",
      disabled: !allChangesStaged || stagedFiles.length === 0,
    },
    {
      id: "update" as const,
      name: "Update",
      icon: RefreshCw,
      desc: "Make more changes",
      color: "blue",
      disabled: false,
    },
    {
      id: "rollback" as const,
      name: "Rollback",
      icon: Undo2,
      desc: "Undo all changes",
      color: "amber",
      disabled: false,
    },
  ];

  return (
    <div className="flex h-full w-full max-w-full flex-col items-center justify-start py-4">
      <h3 className="mb-2 font-semibold text-lg">Ready to Apply?</h3>
      <p className="mb-6 text-center text-muted-foreground">Pick how you'd like to proceed:</p>

      {/* Action Cards */}
      <div className="grid w-full max-w-lg grid-cols-3 gap-4">
        {actions.map((action) => (
          <button
            className={cn(
              "flex flex-col items-center rounded-xl border-2 p-5 transition-all",
              action.disabled
                ? "cursor-not-allowed border-border/50 opacity-50"
                : selectedAction === action.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50",
            )}
            disabled={action.disabled}
            key={action.id}
            onClick={() => !action.disabled && setSelectedAction(action.id)}
          >
            <div
              className={cn(
                "mb-3 rounded-full p-3",
                action.color === "white" && "bg-white-500/10 text-white-500",
                action.color === "teal" && "bg-teal-300/10 text-teal-300",
                action.color === "blue" && "bg-teal-300/10 text-teal-300",
                action.color === "amber" && "bg-rose-300/10 text-rose-300",
              )}
            >
              <action.icon className="h-6 w-6" />
            </div>
            <p className="font-medium">{action.name}</p>
            <p className="mt-1 text-center text-muted-foreground text-xs">{action.desc}</p>
          </button>
        ))}
      </div>

      {/* Action-specific content */}
      <div className="mt-6 w-full">
        {selectedAction === "commit" && (
          <div className="space-y-3">
            <div className="my-2 w-full">
              <Diff changedFiles={stagedFiles} showAdvancedStats={false} summary={summary} />
            </div>
            <h3 className="font-medium text-sm">Checkpoint Summary</h3>
            <p className="text-muted-foreground text-xs">
              This will help you identify the checkpoint if you need to rollback later.
            </p>
            <Input
              className="border-border bg-background"
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
            {summary.commitMessage && commitMsg !== summary.commitMessage && (
              <button
                className="text-muted-foreground text-xs hover:text-foreground"
                onClick={() => setCommitMsg(summary.commitMessage || "")}
                type="button"
              >
                Use suggested: "{summary.commitMessage}"
              </button>
            )}
            <Button
              className="w-full bg-primary/90 hover:bg-primary"
              disabled={isProcessing || !commitMsg.trim()}
              onClick={handleCommit}
            >
              {processingAction === "commit" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GitBranch className="mr-2 h-4 w-4" />
              )}
              Commit Changes
            </Button>
          </div>
        )}

        {selectedAction === "update" && (
          <div className="space-y-3">
            <Input
              className="border-border bg-background"
              disabled={isProcessing}
              onChange={(e) => setEvolvePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && evolvePrompt.trim() && !isProcessing) {
                  handleEvolve();
                }
              }}
              placeholder="Describe what to change..."
              value={evolvePrompt}
            />
            <Button
              className="w-full"
              disabled={isProcessing || !evolvePrompt.trim()}
              onClick={handleEvolve}
            >
              {processingAction === "evolve" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Evolve Configuration
            </Button>
          </div>
        )}

        {selectedAction === "rollback" && (
          <div className="space-y-3">
            <p className="text-center text-muted-foreground text-sm">
              This will discard all pending changes and restore the previous configuration.
            </p>
            <Button
              className="w-full"
              disabled={isProcessing}
              onClick={handleCancel}
              variant="destructive"
            >
              {processingAction === "cancel" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="mr-2 h-4 w-4" />
              )}
              Rollback All Changes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
