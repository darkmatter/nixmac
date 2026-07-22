"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DiffLineStatsBadge } from "@/components/widget/summaries/diff-line-stats";
import { CHANGE_TYPE_STYLES, getDirectory, getShortFilename } from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import { ChevronRight, MoveRight } from "lucide-react";
import { useState } from "react";
import { DriftActionsMenu } from "./drift-actions-menu";
import { DriftDiffPreview } from "./drift-diff-preview";
import { useDisplayPath } from "@/hooks/use-display-path";
import { CHANGE_TYPE_GLYPH, type DriftFileRowData } from "./drift-utils";

function FilePath({ path, role }: { path: string; role?: "old" | "new" }) {
  const displayPath = useDisplayPath()(path);
  const dir = getDirectory(displayPath);
  const name = getShortFilename(displayPath);
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
 * A single file in the "Diff" view: change-type glyph + icon, path, hunk count,
 * +/- line stats, and a per-file actions menu. The row expands to reveal the
 * file's unified diff inline; the actions menu sits outside the toggle so its
 * clicks don't collapse the row.
 */
type DriftFileRowProps = {
  file: DriftFileRowData;
  included?: boolean;
  onIncludedChange?: (included: boolean) => void;
  showActions?: boolean;
  /** Start with the diff expanded (used for the first row of a list). */
  defaultOpen?: boolean;
};

export function DriftFileRow({
  file,
  included,
  onIncludedChange,
  showActions = true,
  defaultOpen = false,
}: DriftFileRowProps) {
  const { changeType, filename, oldFilename, hunkCount, stats, diffText } = file;
  const { icon: Icon, iconColor } = CHANGE_TYPE_STYLES[changeType];
  const glyph = CHANGE_TYPE_GLYPH[changeType];
  const hasDiff = diffText.trim().length > 0;
  const [open, setOpen] = useState(defaultOpen && hasDiff);

  return (
    <li className="group">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
          <CollapsibleTrigger
            disabled={!hasDiff}
            aria-label={`${open ? "Collapse" : "Expand"} diff for ${getShortFilename(filename)}`}
            className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none disabled:cursor-default"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-90",
                !hasDiff && "invisible",
              )}
              aria-hidden="true"
            />
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
          </CollapsibleTrigger>

          {onIncludedChange && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/80 shadow-sm">
              <Checkbox
                checked={included ?? true}
                onCheckedChange={(checked) => onIncludedChange(checked === true)}
                aria-label={`Include ${filename}`}
              />
            </div>
          )}
          {showActions && <DriftActionsMenu filename={filename} />}
        </div>

        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
          <DriftDiffPreview diff={diffText} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
