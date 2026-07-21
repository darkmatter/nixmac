"use client";

import {
  type ChangeFileSummary,
  getDirectory,
  getShortFilename,
} from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import type { ChangeType } from "@/ipc/types";
import { File } from "lucide-react";
import { useDisplayPath } from "@/hooks/use-display-path";
import { DriftActionsMenu } from "./drift-actions-menu";

// The change type is conveyed by the filename's color (git-diff convention):
// added is green, removed is red + struck through, edited/renamed stay default.
const NAME_COLOR: Record<ChangeType, string> = {
  new: "text-emerald-400",
  removed: "text-red-400 line-through",
  edited: "text-foreground",
  renamed: "text-foreground",
};

/**
 * A single file in the "Summary" view when there's no AI summary yet: a plain
 * file icon, the filename (colored by change type), and its location. The icon
 * is just a marker — the color carries the meaning.
 */
export function DriftPlainRow({ file }: { file: ChangeFileSummary }) {
  const { changeType, filename } = file;
  const displayPath = useDisplayPath()(filename);
  const dir = getDirectory(displayPath);
  // Directory as a muted path prefix so the whole entry fits on one line.
  const prefix = dir ? `${dir}/` : "";

  return (
    <li className="group flex items-center gap-3 py-2.5">
      <File className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate font-mono text-[13px]">
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <span className={cn("font-medium", NAME_COLOR[changeType])}>
          {getShortFilename(displayPath)}
        </span>
      </p>
      <DriftActionsMenu filename={filename} />
    </li>
  );
}
