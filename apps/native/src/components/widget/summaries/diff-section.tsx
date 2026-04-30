"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  enrichChanges,
  type ChangeWithRichType,
} from "@/components/widget/utils";
import { darwinAPI } from "@/tauri-api";
import type { Change, FileDiffContents } from "@/types/shared";
import { useEffect, useMemo, useState } from "react";
import { FullFileDiffEditor } from "./full-file-diff-editor";

interface DiffSectionProps {
  changes: Change[];
}

export function DiffSection({ changes }: DiffSectionProps) {
  const [fileContents, setFileContents] = useState<Record<string, FileDiffContents>>({});

  const enriched = useMemo(() => enrichChanges(changes), [changes]);

  const byFile = useMemo(() => {
    const map = new Map<string, ChangeWithRichType[]>();
    for (const c of enriched) {
      const arr = map.get(c.filename) ?? [];
      arr.push(c);
      map.set(c.filename, arr);
    }
    return map;
  }, [enriched]);

  const filenames = useMemo(() => [...byFile.keys()], [byFile]);
  const filenamesKey = filenames.join(",");
  useEffect(() => {
    if (filenames.length === 0) {
      setFileContents({});
      return;
    }
    darwinAPI.git
      .fileDiffContents(filenames)
      .then(setFileContents)
      .catch(() => setFileContents({}));
  }, [filenamesKey]);

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
        {[...byFile.entries()].map(([filename, fileChanges], index) => (
          <FullFileDiffEditor
            key={filename}
            filename={filename}
            changes={fileChanges}
            contents={fileContents[filename]}
            defaultOpen={index === 0}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
