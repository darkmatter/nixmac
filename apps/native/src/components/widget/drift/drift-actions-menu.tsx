"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getShortFilename } from "@/components/widget/utils";
import { useEvolve } from "@/hooks/use-evolve";
import { uiActions, useViewModel } from "@nixmac/state";
import { Eye, GitCommitHorizontal, MoreVertical, Sparkles, Trash2 } from "lucide-react";

/** A "Soon" tag for menu actions that have no backend support yet. */
function SoonTag() {
  return (
    <span className="ml-auto rounded bg-muted px-1 py-0.5 font-medium text-[9px] text-muted-foreground uppercase tracking-wide">
      Soon
    </span>
  );
}

/**
 * Per-file actions shown on both the technical and plain drift rows. The
 * hidden-until-hover trigger expects the row to be a `group`.
 */
export function DriftActionsMenu({ filename }: { filename: string }) {
  const { evolveFromManual } = useEvolve();
  const evolutionId = useViewModel((s) => s.evolve?.evolutionId ?? null);
  // Adopting into AI only applies to manual drift; an active session refines via
  // its own prompt input.
  const isManualDrift = evolutionId === null;
  const shortName = getShortFilename(filename);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${shortName}`}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => uiActions.setEditingFile(filename)}>
          <Eye />
          View diff
        </DropdownMenuItem>
        {isManualDrift && (
          <DropdownMenuItem
            onSelect={() => {
              void evolveFromManual();
            }}
          >
            <Sparkles />
            Refine with AI
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <GitCommitHorizontal />
          Commit only this
          <SoonTag />
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="text-destructive">
          <Trash2 />
          Discard change
          <SoonTag />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
