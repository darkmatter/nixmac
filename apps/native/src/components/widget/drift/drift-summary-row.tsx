"use client";

import { DiffLineStatsBadge, sumDiffLineStats } from "@/components/widget/summaries/diff-line-stats";
import { getShortFilename, inferChangeType } from "@/components/widget/utils";
import type { ChangeType } from "@/ipc/types";
import { File, Files } from "lucide-react";
import { DriftActionsMenu } from "./drift-actions-menu";

// For a single summarized file the name is colored by change type; a group's
// names stay neutral and the aggregate +/- delta carries the signal instead.
const NAME_COLOR: Record<ChangeType, string> = {
  new: "text-emerald-400",
  removed: "text-red-400 line-through",
  edited: "text-foreground",
  renamed: "text-foreground",
};

const MAX_NAMES = 2;

type SummaryRowFile = { filename: string; diff: string };

/**
 * A summarized entry in the "Summary" view. A single file keeps the
 * color-coded filename; a multi-file group collapses to
 * "file1, file2, +n" (neutral names) with a `+n -m` line-delta badge, and uses
 * the stacked-files icon. The AI summary sits underneath either way.
 */
export function DriftSummaryRow({
  files,
  summary,
}: {
  files: SummaryRowFile[];
  summary: string;
}) {
  const shown = files.slice(0, MAX_NAMES);
  const rest = files.length - shown.length;
  const isGroup = files.length > 1;
  const Icon = isGroup ? Files : File;
  const stats = isGroup ? sumDiffLineStats(files) : null;

  return (
    <li className="group flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-medium font-mono text-[13px]">
            {shown.map((file, i) => (
              <span key={file.filename}>
                {i > 0 && <span className="font-normal text-muted-foreground">, </span>}
                <span className={isGroup ? "text-foreground" : NAME_COLOR[inferChangeType(file.diff)]}>
                  {getShortFilename(file.filename)}
                </span>
              </span>
            ))}
            {rest > 0 && <span className="font-normal text-muted-foreground">, +{rest}</span>}
          </p>
          {stats && <DiffLineStatsBadge stats={stats} className="shrink-0" />}
        </div>
        <p className="mt-0.5 truncate text-muted-foreground text-xs">
          {summary || "Summarizing…"}
        </p>
      </div>
      <DriftActionsMenu filename={files[0]?.filename ?? ""} />
    </li>
  );
}
