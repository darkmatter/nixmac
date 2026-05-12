import { AlertTriangle, MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { FsFile } from "./data";
import { seedForUntrackedBanner } from "./seed-prompt";

interface UntrackedBannerProps {
  /** All untracked candidate sections — used both for the count and for the seed. */
  candidates: FsFile[];
  /** Called when the user wants the AI to track everything. Caller seeds the prompt. */
  onTrackAll: (seed: string) => void;
  /** Called when the user wants to browse the Untracked surface in detail. */
  onView: () => void;
}

export function UntrackedBanner({ candidates, onTrackAll, onView }: UntrackedBannerProps) {
  const total = candidates.reduce((acc, f) => acc + (f.items?.length ?? 0), 0);
  if (total === 0) return null;

  const sectionCount = candidates.length;

  return (
    <div
      className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2"
      data-testid="untracked-banner"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[12px]">
          {total} item{total === 1 ? "" : "s"} on your Mac aren't in your config
        </div>
        <div className="mt-0.5 text-[10.5px] text-muted-foreground">
          {sectionCount === 1
            ? "On a fresh install, they wouldn't come back."
            : `Across ${sectionCount} surfaces (Homebrew, defaults, login items). On a fresh install, none of them would come back.`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10.5px] text-muted-foreground hover:text-foreground"
          onClick={onView}
          data-testid="untracked-banner-view"
        >
          View
        </Button>
        <Button
          size="sm"
          className="h-6 gap-1 bg-teal-500 px-2 text-[10.5px] text-background hover:bg-teal-400"
          onClick={() => onTrackAll(seedForUntrackedBanner(candidates))}
          data-testid="untracked-banner-track-all"
        >
          <MessageSquarePlus className="h-3 w-3" /> Track them
        </Button>
      </div>
    </div>
  );
}
