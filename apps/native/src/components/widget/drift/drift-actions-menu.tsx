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
import { client } from "@/lib/orpc";
import { uiActions, useViewModel } from "@nixmac/state";
import { GitCommitHorizontal, MoreVertical, Sparkles, Trash2 } from "lucide-react";

/**
 * Actions shown on the drift rows. The hidden-until-hover trigger expects the
 * row to be a `group`. "Refine with AI" only applies to manual drift.
 *
 * Commit/discard granularity follows the row: pass `hash` (a per-change row's
 * `Change.hash`) to operate on that single hunk via the git bindings, or omit
 * it for file-level rows to commit/discard the whole file.
 */
export function DriftActionsMenu({ filename, hash }: { filename: string; hash?: string }) {
  const { evolveFromManual } = useEvolve();
  const evolutionId = useViewModel((s) => s.evolve?.evolutionId ?? null);
  const isManualDrift = evolutionId === null;
  const shortName = getShortFilename(filename);

  const reportError = (error: unknown) =>
    uiActions.setError((error as Error)?.message ?? String(error));

  const commitThisChange = () => {
    if (hash === undefined) {
      client.git.commitFile({ filename, message: `Update ${shortName}` }).catch(reportError);
    } else {
      client.git.commitChange({ filename, hash, message: `Update ${shortName}` }).catch(reportError);
    }
  };

  const discardThisChange = () => {
    if (hash === undefined) {
      client.git.discardFile({ filename }).catch(reportError);
    } else {
      // Scoped to this row's hunk, so sibling changes to the same file survive.
      client.git.discardChange({ filename, hash }).catch(reportError);
    }
  };

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
        {isManualDrift && (
          <>
            <DropdownMenuItem
              onSelect={() => {
                void evolveFromManual();
              }}
            >
              <Sparkles />
              Refine with AI
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={commitThisChange}>
          <GitCommitHorizontal />
          Commit only this
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onSelect={discardThisChange}>
          <Trash2 />
          Discard change
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
