"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { countDiffItems, useHomebrewDiff } from "@/hooks/use-homebrew-diff";
import { uiActions, useViewModel } from "@nixmac/state";
import { Package } from "lucide-react";

/**
 * Badge + popover for untracked Homebrew packages.
 * Appears in the prompt badge row when Homebrew is installed,
 * the working tree is clean, and there are packages not yet in config.
 */
export function HomebrewBadge() {
  const evolveState = useViewModel((s) => s.evolve);
  const prefsLoaded = useViewModel((s) => s.preferences !== null);
  const scanHomebrewOnStartup = useViewModel((s) => s.preferences?.scanHomebrewOnStartup ?? true);
  const shouldScan = prefsLoaded && scanHomebrewOnStartup;
    const { diff, hasDiff, isApplying, applyDiff } = useHomebrewDiff(shouldScan);

  // Only show on the begin step (clean tree, no in-progress evolution).
  if (!shouldScan || evolveState?.step !== "begin" || !diff || !diff.isInstalled) return null;

  if (!hasDiff) {
    return (
      <BadgeButton icon={Package} badgeVariant="muted" disabled>
        All Homebrew items tracked
      </BadgeButton>
    );
  }

  const total = countDiffItems(diff);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <BadgeButton icon={Package} badgeVariant="muted" data-testid="managed-homebrew-badge">
          {total} untracked Homebrew {total === 1 ? "item" : "items"}
        </BadgeButton>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-3" align="start" data-testid="managed-homebrew-popover">
        <div className="flex flex-col text-sm">
          <div className="max-h-56 overflow-y-auto pr-2">
            {diff.taps.length > 0 && <HomebrewGroup label="Taps" items={diff.taps} />}
            {diff.brews.length > 0 && <HomebrewGroup label="Brews" items={diff.brews} />}
            {diff.casks.length > 0 && <HomebrewGroup label="Casks" items={diff.casks} />}
          </div>

          <Button
            size="sm"
            className="mt-3 w-full"
            data-testid="managed-homebrew-add-to-config"
            disabled={isApplying}
            onClick={() => {
              applyDiff();
              uiActions.setConversationalResponse(null);
            }}
          >
            {isApplying ? "Adding…" : "Add to config"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HomebrewGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="mb-1 font-medium text-foreground/80">
        {label} ({items.length})
      </p>
      <ul className="space-y-0.5 text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-1.5">
            <span className="text-muted-foreground/50">–</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
