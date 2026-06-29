"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { countDiffItems, useHomebrewDiff } from "@/hooks/use-homebrew-diff";
import type { HomebrewState } from "@/ipc/types";
import { uiActions, useViewModel } from "@nixmac/state";
import { AlertTriangle, Package } from "lucide-react";
import { useEffect, useState } from "react";

/** Untracked-item categories, used to key selection independently per group. */
type HomebrewItemType = "tap" | "brew" | "cask";
const itemKey = (type: HomebrewItemType, name: string) => `${type}:${name}`;

/** All untracked item keys for a diff, in a stable display order. */
function diffKeys(diff: HomebrewState | null): string[] {
  if (!diff) return [];
  return [
    ...diff.taps.map((t) => itemKey("tap", t)),
    ...diff.brews.map((b) => itemKey("brew", b)),
    ...diff.casks.map((c) => itemKey("cask", c)),
  ];
}

/**
 * Badge + popover for untracked Homebrew packages.
 * Appears in the prompt badge row when Homebrew is installed,
 * the working tree is clean, and there are packages not yet in config.
 *
 * Each item has a checkbox so the user can adopt a subset; everything is
 * selected by default. When only some items are selected we warn that the
 * unchecked ones aren't in the config and may be removed on the next build.
 */
export function HomebrewBadge() {
  const evolveState = useViewModel((s) => s.evolve);
  const prefsLoaded = useViewModel((s) => s.preferences !== null);
  const scanHomebrewOnStartup = useViewModel((s) => s.preferences?.scanHomebrewOnStartup ?? true);
  const shouldScan = prefsLoaded && scanHomebrewOnStartup;
  const { diff, hasDiff, isApplying, applyDiff } = useHomebrewDiff(shouldScan);

  // Which items the user wants to adopt. Defaults to everything, and re-seeds
  // whenever the underlying diff changes (a fresh scan, or after an apply).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(diffKeys(diff)));
  useEffect(() => {
    setSelected(new Set(diffKeys(diff)));
  }, [diff]);

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
  const selectedCount = selected.size;
  const isPartial = selectedCount > 0 && selectedCount < total;

  const toggle = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleAdd = () => {
    // Adopt only the checked items by narrowing the diff before applying.
    applyDiff({
      ...diff,
      taps: diff.taps.filter((t) => selected.has(itemKey("tap", t))),
      brews: diff.brews.filter((b) => selected.has(itemKey("brew", b))),
      casks: diff.casks.filter((c) => selected.has(itemKey("cask", c))),
    });
    uiActions.setConversationalResponse(null);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <BadgeButton icon={Package} badgeVariant="default" data-testid="managed-homebrew-badge">
          {total} untracked {total === 1 ? "Homebrew item" : "Homebrew items"}
        </BadgeButton>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-3" align="start" data-testid="managed-homebrew-popover">
        <div className="flex flex-col text-sm">
          <div className="max-h-56 overflow-y-auto pr-2">
            {diff.taps.length > 0 && (
              <HomebrewGroup
                label="Taps"
                type="tap"
                items={diff.taps}
                selected={selected}
                onToggle={toggle}
              />
            )}
            {diff.brews.length > 0 && (
              <HomebrewGroup
                label="Brews"
                type="brew"
                items={diff.brews}
                selected={selected}
                onToggle={toggle}
              />
            )}
            {diff.casks.length > 0 && (
              <HomebrewGroup
                label="Casks"
                type="cask"
                items={diff.casks}
                selected={selected}
                onToggle={toggle}
              />
            )}
          </div>

          {isPartial && (
            <div
              className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/6 px-2.5 py-2 text-[11px] text-muted-foreground"
              data-testid="managed-homebrew-partial-warning"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>
                Unselected items won't be added to your config and may be removed on the next build.
              </span>
            </div>
          )}

          <Button
            size="sm"
            className="mt-3 w-full"
            data-testid="managed-homebrew-add-to-config"
            disabled={isApplying || selectedCount === 0}
            onClick={handleAdd}
          >
            {isApplying
              ? "Adding…"
              : selectedCount === total
                ? "Add to config"
                : `Add ${selectedCount} to config`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HomebrewGroup({
  label,
  type,
  items,
  selected,
  onToggle,
}: {
  label: string;
  type: HomebrewItemType;
  items: string[];
  selected: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="mb-1 font-medium text-foreground/80">
        {label} ({items.length})
      </p>
      <ul className="space-y-0.5 text-muted-foreground">
        {items.map((item) => {
          const key = itemKey(type, item);
          return (
            <li key={key}>
              <label className="flex cursor-pointer items-center gap-1.5 hover:text-foreground">
                <Checkbox
                  checked={selected.has(key)}
                  onCheckedChange={(v) => onToggle(key, v === true)}
                  className="size-3.5"
                />
                <span className="truncate">{item}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
