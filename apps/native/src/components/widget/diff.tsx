"use client";

import { FileCode } from "lucide-react";
import type { BundledLanguage } from "shiki";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockItem,
} from "@/components/kibo-ui/code-block";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { FileDiff } from "@/components/widget/utils";
import { getDirectory, getShortFilename } from "@/components/widget/utils";

interface DiffProps {
  diffSections: FileDiff[];
}

export function Diff({ diffSections }: DiffProps) {
  if (diffSections.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-8 text-muted-foreground text-sm">
        No diff available
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 w-full flex-1 rounded-lg border border-border">
      <div className="divide-y divide-border">
        {diffSections.map((section, index) => {
          const codeData = [
            {
              language: "diff",
              filename: section.filename,
              code: section.chunks,
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
              <CodeBlock className="border-0" data={codeData} value="diff">
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
  );
}
