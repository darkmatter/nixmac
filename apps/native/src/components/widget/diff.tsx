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
import { useWidgetStore } from "@/stores/widget-store";

interface FileDiff {
  filename: string;
  chunks: string;
}

/**
 * Parse a unified diff into sections per file
 */
function parseDiffIntoSections(diffContent: string): FileDiff[] {
  const sections: FileDiff[] = [];
  const lines = diffContent.split("\n");

  let currentFilename = "";
  let currentChunks: string[] = [];

  for (const line of lines) {
    // Match "diff --git a/path/to/file b/path/to/file"
    const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitDiffMatch) {
      // Save previous section if exists
      if (currentFilename && currentChunks.length > 0) {
        sections.push({
          filename: currentFilename,
          chunks: currentChunks.join("\n"),
        });
      }
      currentFilename = gitDiffMatch[2];
      currentChunks = [];
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
      currentChunks.push(line);
    }
  }

  // Don't forget the last section
  if (currentFilename && currentChunks.length > 0) {
    sections.push({
      filename: currentFilename,
      chunks: currentChunks.join("\n"),
    });
  }

  return sections;
}

// Get a short filename from a path
function getShortFilename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

// Get the directory from a path
function getDirectory(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

export function Diff() {
  const summary = useWidgetStore((s) => s.summary);

  const diffContent = summary.diff || "";
  const diffSections = parseDiffIntoSections(diffContent);

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
