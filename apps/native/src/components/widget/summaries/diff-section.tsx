"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  enrichChanges,
  type ChangeWithRichType,
} from "@/components/widget/utils";
import { useWidgetStore } from "@/stores/widget-store";
import type { Change } from "@/ipc/types";
import { useMemo } from "react";
import { FullFileDiffEditor } from "./full-file-diff-editor";

interface DiffSectionProps {
  changes: Change[];
  openFiles: Record<string, boolean>;
  onOpenFilesChange: (next: Record<string, boolean>) => void;
}

export function DiffSection({ changes, openFiles, onOpenFilesChange }: DiffSectionProps) {
  const fileContents = useWidgetStore((s) => s.fileDiffContents);

  const byFile = useMemo(() => {
    const map = new Map<string, ChangeWithRichType[]>();
    for (const c of enrichChanges(changes)) {
      const arr = map.get(c.filename) ?? [];
      arr.push(c);
      map.set(c.filename, arr);
    }
    return map;
  }, [changes]);

  if (changes.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-8 text-muted-foreground text-sm">
        No diff available
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 w-full flex-1" data-testid="diff-section">
      <div className="flex flex-col gap-2 py-2">
        {[...byFile.entries()].map(([filename, fileChanges]) => (
          <FullFileDiffEditor
            key={filename}
            filename={filename}
            changes={fileChanges}
            contents={fileContents[filename]}
            isOpen={openFiles[filename] ?? false}
            onOpenChange={(open) =>
              onOpenFilesChange({ ...openFiles, [filename]: open })
            }
          />
        ))}
      </div>
    </ScrollArea>
  );
}
