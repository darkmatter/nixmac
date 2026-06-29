"use client";

import { DiffLineStatsBadge } from "@/components/widget/summaries/diff-line-stats";
import { CHANGE_TYPE_STYLES, getDirectory, getShortFilename } from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import { MoveRight } from "lucide-react";
import { DriftActionsMenu } from "./drift-actions-menu";
import { CHANGE_TYPE_GLYPH, type DriftFileRowData } from "./drift-utils";

function FilePath({ path, role }: { path: string; role?: "old" | "new" }) {
  const dir = getDirectory(path);
  const name = getShortFilename(path);
  return (
    <span className="min-w-0 truncate font-mono text-[13px]">
      {dir && (
        <span className={cn("text-muted-foreground", role === "old" && "line-through opacity-50")}>
          {dir}/
        </span>
      )}
      <span className="text-card-foreground">{name}</span>
    </span>
  );
}

/**
 * A single file in the "File changes" view: change-type glyph + icon, path,
 * hunk count, +/- line stats, and a per-file actions menu.
 */
export function DriftFileRow({ file }: { file: DriftFileRowData }) {
  const { changeType, filename, oldFilename, hunkCount, stats } = file;
  const { icon: Icon, iconColor } = CHANGE_TYPE_STYLES[changeType];
  const glyph = CHANGE_TYPE_GLYPH[changeType];

  return (
    <li className="group flex items-center gap-3 py-2.5">
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted font-mono font-bold text-[10px]",
          iconColor,
        )}
        title={changeType}
      >
        {glyph.label}
      </span>
      <Icon className={cn("h-4 w-4 shrink-0", iconColor)} aria-hidden="true" />

      {oldFilename ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <FilePath path={oldFilename} role="old" />
          <MoveRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <FilePath path={filename} role="new" />
        </span>
      ) : (
        <span className="min-w-0 flex-1 overflow-hidden">
          <FilePath path={filename} />
        </span>
      )}

      {hunkCount > 1 && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          x{hunkCount}
        </span>
      )}
      <DiffLineStatsBadge stats={stats} />

      <DriftActionsMenu filename={filename} />
    </li>
  );
}
