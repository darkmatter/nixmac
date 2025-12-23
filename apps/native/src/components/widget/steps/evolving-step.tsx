"use client";

import { Eye, Loader2, Shield, Sparkles } from "lucide-react";
import { useState } from "react";
import { EvolveProgress } from "@/components/evolve-progress";
import { Button } from "@/components/ui/button";
import {
  analyzeGitStatus,
  type EvolveEvent,
  type GitStatus,
  type ProcessingAction,
  type SummaryState,
} from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { ChatInput } from "../chat-input";
import { Diff } from "../diff";

interface EvolvingStepProps {
  gitStatus: GitStatus | null;
  evolvePrompt: string;
  setEvolvePrompt: (s: string) => void;
  isProcessing: boolean;
  isGenerating: boolean;
  processingAction: ProcessingAction;
  evolveEvents: EvolveEvent[];
  handleEvolve: () => void;
  handleCancel: () => void;
  handleShowCommit: () => void;
  summary: SummaryState;
}

export function EvolvingStep({
  gitStatus,
  evolvePrompt,
  setEvolvePrompt,
  isProcessing,
  isGenerating,
  processingAction,
  evolveEvents,
  handleEvolve,
  summary,
}: EvolvingStepProps) {
  const changedFiles = gitStatus?.files || [];
  const { hasUnstagedChanges } = analyzeGitStatus(gitStatus);

  const [showAdvancedStats, _setShowAdvancedStats] = useState(false);

  // Show progress when actively generating
  if (isGenerating && evolveEvents.length > 0) {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="font-semibold text-foreground text-lg">Evolving your configuration...</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            AI is making changes based on your request
          </p>
        </div>

        <EvolveProgress
          className="rounded-lg border border-border bg-muted/20"
          events={evolveEvents}
          isGenerating={isGenerating}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center">
        <h3 className="mb-2 font-semibold text-lg">Ready to Apply?</h3>
        <p className="mb-6 text-center text-muted-foreground">
          Test your changes safely - you can roll back if needed.
        </p>
      </div>
      {/* Header */}
      {/* <div className="flex items-center justify-between">
        <h2 className="font-semibold text-foreground text-lg">{title}</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Diff</span>
            <Switch
              checked={showAdvancedStats}
              onCheckedChange={setShowAdvancedStats}
            />
          </div>
        </div>
      </div> */}

      {/* Loading state */}
      {summary.isLoading === true && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Summarizing changes...
        </div>
      )}

      {/* AI Summary list - default view */}
      <Diff changedFiles={changedFiles} showAdvancedStats={showAdvancedStats} summary={summary} />
      {/* Instructions for testing changes */}
      {!summary.isLoading && summary.instructions && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="font-medium text-foreground text-sm">Try it out</p>
              <p className="text-muted-foreground text-xs">{summary.instructions}</p>
            </div>
          </div>
        </div>
      )}

      {hasUnstagedChanges ? (
        <>
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400" />
              <div className="space-y-1">
                <p className="font-medium text-blue-200 text-sm">Preview applies changes safely</p>
                <p className="text-blue-200/70 text-xs">
                  You'll be asked for your password. Changes can be rolled back if needed.
                </p>
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={isProcessing}
            onClick={() => darwinAPI.rebuildOverlay.show()}
            size="lg"
          >
            {processingAction === "apply" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            Preview Changes
          </Button>
        </>
      ) : null}

      {!hasUnstagedChanges && <p className="text-muted-foreground text-sm">Evolve Again</p>}
      {!hasUnstagedChanges && (
        <ChatInput
          isLoading={isProcessing}
          onChange={setEvolvePrompt}
          onSubmit={handleEvolve}
          value={evolvePrompt}
        />
      )}
    </div>
  );
}
