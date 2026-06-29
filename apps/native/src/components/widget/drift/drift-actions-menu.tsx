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
 * Per-file actions shown on the drift rows. The hidden-until-hover trigger
 * expects the row to be a `group`. "Refine with AI" only applies to manual
 * drift; commit/discard operate on the single file via the git bindings.
 */
export function DriftActionsMenu({ filename }: { filename: string }) {
  const { evolveFromManual } = useEvolve();
  const evolutionId = useViewModel((s) => s.evolve?.evolutionId ?? null);
  const isManualDrift = evolutionId === null;
  const shortName = getShortFilename(filename);

  const reportError = (error: unknown) =>
    uiActions.setError((error as Error)?.message ?? String(error));

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
        <DropdownMenuItem
          onSelect={() => {
            client.git.commitFile({ filename, message: `Update ${shortName}` }).catch(reportError);
          }}
        >
          <GitCommitHorizontal />
          Commit only this
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onSelect={() => {
            client.git.discardFile({ filename }).catch(reportError);
          }}
        >
          <Trash2 />
          Discard change
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
