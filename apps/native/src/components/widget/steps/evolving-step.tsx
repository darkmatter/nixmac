"use client";

import { Eye, FileCode, Loader2, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";
import type { BundledLanguage } from "shiki";
import { EvolveProgress } from "@/components/evolve-progress";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockItem,
} from "@/components/kibo-ui/code-block";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useWidgetStore } from "@/stores/widget-store";
import { useEvolve } from "@/hooks/use-evolve";
import { useApply } from "@/hooks/use-apply";
import { useCommit } from "@/hooks/use-commit";
import { darwinAPI } from "@/tauri-api";
import { ChatInput } from "../chat-input";
import { Diff } from "../diff";

interface ParsedDiffSection {
  filename: string;
  hunks: string;
}

/**
 * Parse a unified diff into sections per file
 */
function parseDiffIntoSections(diffContent: string): ParsedDiffSection[] {
  const sections: ParsedDiffSection[] = [];
  const lines = diffContent.split("\n");

  let currentFilename = "";
  let currentHunks: string[] = [];

  for (const line of lines) {
    // Match "diff --git a/path/to/file b/path/to/file"
    const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitDiffMatch) {
      // Save previous section if exists
      if (currentFilename && currentHunks.length > 0) {
        sections.push({
          filename: currentFilename,
          hunks: currentHunks.join("\n"),
        });
      }
      currentFilename = gitDiffMatch[2];
      currentHunks = [];
      continue;
    }

    // Skip --- and +++ lines (file markers)
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }

    // Skip index lines
    if (line.startsWith("index ")) {
      continue;
    }

    // Skip "new file mode" or "deleted file mode" lines
    if (
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode")
    ) {
      continue;
    }

    // Collect all other lines (hunks, additions, deletions)
    if (currentFilename) {
      currentHunks.push(line);
    }
  }

  // Don't forget the last section
  if (currentFilename && currentHunks.length > 0) {
    sections.push({
      filename: currentFilename,
      hunks: currentHunks.join("\n"),
    });
  }

  return sections;
}

/**
 * Get a short filename from a path
 */
function getShortFilename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Get the directory from a path
 */
function getDirectory(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

/**
 * Evolving step - shows changes after evolution, allows preview/apply.
 */
export function EvolvingStep() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const evolvePrompt = useWidgetStore((s) => s.evolvePrompt);
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const isGenerating = useWidgetStore((s) => s.isGenerating);
  const evolveEvents = useWidgetStore((s) => s.evolveEvents);
  const summary = useWidgetStore((s) => s.summary);
  const summaryLoading = useWidgetStore((s) => s.summaryLoading);

  const { handleEvolve } = useEvolve();
  const { handleApply } = useApply();
  const { handleCancel } = useCommit();

  const handleStopEvolution = async () => {
    try {
      await darwinAPI.darwin.evolveCancel();
    } catch (e) {
      console.error("Failed to cancel evolution:", e);
    }
  };

  const changedFiles = gitStatus?.files || [];
  const hasUnstagedChanges = gitStatus?.hasUnstagedChanges ?? false;

  const [showDiff, setShowDiff] = useState(false);

  const diffContent = summary.diff || "";
  const diffSections = parseDiffIntoSections(diffContent);

  // Show progress when actively generating
  if (isGenerating && evolveEvents.length > 0) {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="font-semibold text-foreground text-lg">
            Evolving your configuration...
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            AI is making changes based on your request
          </p>
        </div>

        <EvolveProgress
          className="rounded-lg border border-border bg-muted/20"
          events={evolveEvents}
          isGenerating={isGenerating}
          onStop={handleStopEvolution}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4  px-4">
      <div className="flex flex-col items-center justify-center">
        <h3 className="mb-2 font-semibold text-lg">Ready to Apply?</h3>
        <p className="mb-6 text-center text-muted-foreground">
          Test your changes safely - you can roll back if needed.
        </p>
      </div>

      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-foreground text-lg">
          What's Changed
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {showDiff ? "Diff" : "Summary"}
            </span>
            <Switch checked={showDiff} onCheckedChange={setShowDiff} />
          </div>
        </div>
      </div>

      {/* Loading state */}
      {summaryLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Summarizing changes...
        </div>
      )}

      {/* Content: Summary view or Diff view */}
      {showDiff ? (
        // Parsed diff view with file dividers
        diffSections.length > 0 ? (
          <ScrollArea className="h-[400px] w-full rounded-lg border border-border">
            <div className="divide-y divide-border">
              {diffSections.map((section, index) => {
                const codeData = [
                  {
                    language: "diff",
                    filename: section.filename,
                    code: section.hunks,
                  },
                ];

                return (
                  <div key={section.filename + index}>
                    {/* File divider header */}
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-border border-b bg-muted/80 px-3 py-2 backdrop-blur-sm">
                      <FileCode className="h-4 w-4 text-primary" />
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate font-medium text-foreground text-sm">
                          {getShortFilename(section.filename)}
                        </span>
                        {getDirectory(section.filename) && (
                          <span className="truncate text-muted-foreground text-xs">
                            {getDirectory(section.filename)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Code diff for this file */}
                    <CodeBlock
                      className="border-0"
                      data={codeData}
                      value="diff"
                    >
                      <CodeBlockBody>
                        {(item) => (
                          <CodeBlockItem
                            className="w-max min-w-full"
                            key={item.language}
                            value={item.language}
                          >
                            <CodeBlockContent
                              language={item.language as BundledLanguage}
                            >
                              {item.code}
                            </CodeBlockContent>
                          </CodeBlockItem>
                        )}
                      </CodeBlockBody>
                    </CodeBlock>
                  </div>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-8 text-muted-foreground text-sm">
            No diff available
          </div>
        )
      ) : (
        // AI Summary list view
        <Diff
          changedFiles={changedFiles}
          showAdvancedStats={false}
          summary={summary}
        />
      )}

      {/* Instructions for testing changes */}
      {!summaryLoading && summary.instructions && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="font-medium text-foreground text-sm">Try it out</p>
              <p className="text-muted-foreground text-xs">
                {summary.instructions}
              </p>
            </div>
          </div>
        </div>
      )}

      {hasUnstagedChanges ? (
        <Button
          className="w-full"
          disabled={isProcessing}
          onClick={handleApply}
          size="lg"
        >
          {processingAction === "apply" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Eye className="mr-2 h-4 w-4" />
          )}
          Preview Changes
        </Button>
      ) : null}

      {!hasUnstagedChanges && (
        <p className="text-muted-foreground text-sm">Evolve Again</p>
      )}
      {!hasUnstagedChanges && (
        <ChatInput
          isLoading={isProcessing}
          onChange={setEvolvePrompt}
          onSubmit={handleEvolve}
          value={evolvePrompt}
        />
      )}

      {/* Discard changes button */}
      {hasUnstagedChanges && (
        <Button
          className="w-full"
          disabled={isProcessing}
          onClick={handleCancel}
          variant="ghost"
        >
          <Undo2 className="mr-2 h-4 w-4" />
          Discard Changes
        </Button>
      )}
    </div>
  );
}
