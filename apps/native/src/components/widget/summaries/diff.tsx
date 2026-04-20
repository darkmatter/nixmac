"use client";

import { ChevronRight, FileCode, Pencil } from "lucide-react";
import type { BundledLanguage } from "shiki";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockItem,
} from "@/components/kibo-ui/code-block";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWidgetStore } from "@/stores/widget-store";
import type { Change } from "@/types/shared";
import { getDirectory, getShortFilename } from "@/components/widget/utils";

interface DiffProps {
  changes: Change[];
}

export function Diff({ changes }: DiffProps) {
  if (changes.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-8 text-muted-foreground text-sm">
        No diff available
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 w-full flex-1">
      <div className="flex flex-col gap-2 py-2">
        {changes.map((change, index) => {
          const codeData = [
            {
              language: "diff",
              filename: change.filename,
              code: change.diff,
            },
          ];

          return (
            <Collapsible
              className="rounded-md border border-border"
              defaultOpen={index === 0}
              key={change.filename + index}
            >
              {/* File header */}
              <div className="flex items-center gap-2 rounded-t-md bg-muted/50 px-2 py-1.5">
                <CollapsibleTrigger className="group inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted">
                  <ChevronRight className="h-4 w-4 text-muted-foreground hover:text-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
                </CollapsibleTrigger>
                <FileCode className="h-4 w-4 shrink-0 text-primary" />
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate font-medium text-foreground text-sm">
                    {getShortFilename(change.filename)}
                  </span>
                  {getDirectory(change.filename) && (
                    <span className="truncate text-muted-foreground text-xs">
                      {getDirectory(change.filename)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    useWidgetStore.setState({ editingFile: change.filename });
                  }}
                  title="Edit file"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Code diff */}
              <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
                <div className="max-h-72 overflow-auto border-border border-t">
                  <CodeBlock className="border-0 overflow-x-auto" data={codeData} value="diff">
                    <CodeBlockBody>
                      {(item) => (
                        <CodeBlockItem
                          className=""
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
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </ScrollArea>
  );
}
