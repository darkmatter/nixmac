"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { EvolveProgress } from "@/components/evolve-progress";
import {
  type BundledLanguage,
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockItem,
} from "@/components/kibo-ui/code-block";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { useEvolve } from "@/hooks/use-evolve";
import { ChatInput } from "../chat-input";
import { categorizeChanges } from "../utils";

/**
 * Overview step - shows prompt input or displays existing changes.
 * Accesses state directly from the store instead of receiving props.
 */
export function OverviewStep() {
  const evolvePrompt = useWidgetStore((s) => s.evolvePrompt);
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const isGenerating = useWidgetStore((s) => s.isGenerating);
  const evolveEvents = useWidgetStore((s) => s.evolveEvents);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const summary = useWidgetStore((s) => s.summary);
  const { handleEvolve } = useEvolve();

  const isProcessingEvolve = isProcessing && processingAction === "evolve";

  // Local UI state
  const [viewMode, setViewMode] = useState<"summary" | "diff">("summary");
  const changedFiles = gitStatus?.files || [];
  const categories = categorizeChanges(changedFiles);
  const totalChanges = changedFiles.length;
  const diffContent = summary.diff || "";

  // Prepare code block data for the diff view
  const codeData = [
    {
      language: "diff",
      filename: "changes.diff",
      code: diffContent,
    },
  ];

  // Show progress when generating
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
        />
      </div>
    );
  }

  // Show categorized changes if there are any
  if (totalChanges > 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">What's Changed</h3>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{totalChanges} files</Badge>
          </div>
        </div>

        <Tabs
          onValueChange={(v) => setViewMode(v as "summary" | "diff")}
          value={viewMode}
        >
          <TabsList className="w-full">
            <TabsTrigger className="flex-1" value="summary">
              Summary
            </TabsTrigger>
            <TabsTrigger
              className="flex-1"
              disabled={!diffContent}
              value="diff"
            >
              Diff
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4" value="summary">
            <div className="grid gap-3 sm:grid-cols-2">
              {categories.map((cat) => (
                <div
                  className="rounded-lg border border-border bg-muted/30 p-4"
                  key={cat.title}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div
                      className={cn(
                        "rounded-lg p-2",
                        cat.color === "teal" && "bg-teal-500/10 text-teal-500",
                        cat.color === "blue" && "bg-blue-500/10 text-blue-500",
                        cat.color === "red" && "bg-red-500/10 text-red-500"
                      )}
                    >
                      <cat.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">{cat.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {cat.items.length} file
                        {cat.items.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {cat.items.map((item, i) => (
                      <li
                        className="flex items-center gap-2 text-muted-foreground text-sm"
                        key={i}
                      >
                        <Check className="h-3 w-3 text-teal-500" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent className="mt-4" value="diff">
            {diffContent ? (
              <CodeBlock className="max-h-[400px]" data={codeData} value="diff">
                <CodeBlockHeader className="justify-between">
                  <span className="px-2 text-muted-foreground text-xs">
                    {summary.additions !== undefined &&
                      summary.deletions !== undefined && (
                        <>
                          <span className="text-green-500">
                            +{summary.additions}
                          </span>
                          {" / "}
                          <span className="text-red-500">
                            -{summary.deletions}
                          </span>
                        </>
                      )}
                  </span>
                  <CodeBlockCopyButton />
                </CodeBlockHeader>
                <ScrollArea className="h-[350px] w-full">
                  <CodeBlockBody>
                    {(item) => (
                      <CodeBlockItem
                        className="min-h-full w-max min-w-full"
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
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CodeBlock>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-8 text-muted-foreground text-sm">
                No diff available
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // Default: show prompt input
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="font-semibold text-foreground text-lg">
          What would you like to change?
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Describe your desired configuration changes
        </p>
      </div>

      <div className="space-y-3">
        <ChatInput
          isLoading={isProcessingEvolve}
          onChange={setEvolvePrompt}
          onSubmit={handleEvolve}
          value={evolvePrompt}
        />

        <div className="flex flex-wrap gap-2">
          {["Install vim", "Add Rectangle app", "Configure git"].map(
            (example) => (
              <button
                className="rounded-full border border-border bg-muted/50 px-3 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
                key={example}
                onClick={() => setEvolvePrompt(example)}
                type="button"
              >
                {example}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
