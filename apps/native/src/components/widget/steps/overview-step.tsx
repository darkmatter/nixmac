"use client";

import { Check } from "lucide-react";
import { EvolveProgress } from "@/components/evolve-progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EvolveEvent, GitStatus } from "@/stores/widget-store";
import { ChatInput } from "../chat-input";
import { categorizeChanges } from "../utils";

interface OverviewStepProps {
  evolvePrompt: string;
  setEvolvePrompt: (s: string) => void;
  isProcessing: boolean;
  isGenerating: boolean;
  evolveEvents: EvolveEvent[];
  handleEvolve: () => void;
  gitStatus: GitStatus | null;
}

export function OverviewStep({
  evolvePrompt,
  setEvolvePrompt,
  isProcessing,
  isGenerating,
  evolveEvents,
  handleEvolve,
  gitStatus,
}: OverviewStepProps) {
  const changedFiles = gitStatus?.files || [];
  const categories = categorizeChanges(changedFiles);
  const totalChanges = changedFiles.length;

  // Show progress when generating
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

  // Show categorized changes if there are any
  if (totalChanges > 0) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-lg">What's Changed</h3>
          <Badge variant="secondary">{totalChanges} files</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((cat) => (
            <div className="rounded-lg border border-border bg-muted/30 p-4" key={cat.title}>
              <div className="mb-3 flex items-center gap-3">
                <div
                  className={cn(
                    "rounded-lg p-2",
                    cat.color === "teal" && "bg-teal-500/10 text-teal-500",
                    cat.color === "blue" && "bg-blue-500/10 text-blue-500",
                    cat.color === "red" && "bg-red-500/10 text-red-500",
                  )}
                >
                  <cat.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium">{cat.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {cat.items.length} file{cat.items.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <ul className="space-y-1">
                {cat.items.map((item, i) => (
                  <li className="flex items-center gap-2 text-muted-foreground text-sm" key={i}>
                    <Check className="h-3 w-3 text-teal-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default: show prompt input
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="font-semibold text-foreground text-lg">What would you like to change?</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Describe your desired configuration changes
        </p>
      </div>

      <div className="space-y-3">
        <ChatInput
          isLoading={isProcessing}
          onChange={setEvolvePrompt}
          onSubmit={handleEvolve}
          value={evolvePrompt}
        />
        {/* <Input
          className="border-border bg-background"
          disabled={isProcessing}
          onChange={(e) => setEvolvePrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && evolvePrompt.trim() && !isProcessing) {
              handleEvolve();
            }
          }}
          placeholder="e.g., install vim, add homebrew packages, configure git..."
          value={evolvePrompt}
        /> */}

        <div className="flex flex-wrap gap-2">
          {["Install vim", "Add Rectangle app", "Configure git"].map((example) => (
            <button
              className="rounded-full border border-border bg-muted/50 px-3 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
              key={example}
              onClick={() => setEvolvePrompt(example)}
              type="button"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
