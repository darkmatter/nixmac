"use client";

import {
  type ChangeFileSummary,
  CHANGE_TYPE_STYLES,
  getDirectory,
  getShortFilename,
} from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import type { ChangeType } from "@/ipc/types";
import { ArrowRightLeft, type LucideIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { DriftActionsMenu } from "./drift-actions-menu";
import { CHANGE_TYPE_GLYPH } from "./drift-utils";

// Verb-style icons (vs. the file icons used in the technical view).
const PLAIN_ICON: Record<ChangeType, LucideIcon> = {
  new: Plus,
  edited: Pencil,
  removed: Trash2,
  renamed: ArrowRightLeft,
};

/**
 * A single file in the "Summary" view when there's no AI summary yet:
 * a friendly verb icon, the filename, where it lives, a verb badge, and the
 * same per-file actions. Factual framing only — no fabricated descriptions.
 */
export function DriftPlainRow({ file }: { file: ChangeFileSummary }) {
  const { changeType, filename, oldFilename } = file;
  const { iconColor } = CHANGE_TYPE_STYLES[changeType];
  const Icon = PLAIN_ICON[changeType];
  const verb = CHANGE_TYPE_GLYPH[changeType].verb;
  const dir = getDirectory(filename);

  const where = oldFilename
    ? `Renamed from ${oldFilename}`
    : dir
      ? `in ${dir}/`
      : "in your config root";

  return (
    <li className="group flex items-start gap-3 px-4 py-3">
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted",
          iconColor,
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-card-foreground text-sm">
          {getShortFilename(filename)}
        </p>
        <p className="mt-0.5 truncate text-muted-foreground text-xs">{where}</p>
      </div>
      <span className="mt-1 shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
        {verb}
      </span>
      <DriftActionsMenu filename={filename} />
    </li>
  );
}
