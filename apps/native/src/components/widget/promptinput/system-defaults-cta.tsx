"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUiState } from "@/stores/ui-state";
import { useWidgetStore } from "@/stores/widget-store";
import type { SystemDefault, SystemDefaultsScan } from "@/ipc/types";
import { tauriAPI } from "@/ipc/api";
import { useViewModel } from "@/stores/view-model";
import { mirrorChangeMapState } from "@/viewmodel/change-map";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";
import { Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";

const DISMISS_KEY = "nixmac:system-defaults-dismissed";

function groupByCategory(
  defaults: SystemDefault[],
): Map<string, SystemDefault[]> {
  const map = new Map<string, SystemDefault[]>();
  for (const d of defaults) {
    const group = map.get(d.category);
    if (group) {
      group.push(d);
    } else {
      map.set(d.category, [d]);
    }
  }
  return map;
}

function formatValue(value: string): string {
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1") return "on";
  if (lower === "false" || lower === "0") return "off";
  if (value.length > 24) return `${value.slice(0, 24)}...`;
  return value;
}

function formatUntrackedSettings(count: number): string {
  return `${count} untracked setting${count === 1 ? "" : "s"}`;
}

/**
 * Badge + popover for untracked macOS system defaults.
 * Appears in the prompt badge row when non-default settings are detected.
 */
export function SystemDefaultsCTA() {
  const evolveState = useViewModel((s) => s.evolve);
  const [scan, setScan] = useState<SystemDefaultsScan | null>(null);
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "true",
  );

  const eligible = evolveState?.step === "begin";

  // Re-scan whenever we land on main with a clean working tree.
  // The backend returns an empty scan if system-defaults.nix already exists.
  useEffect(() => {
    if (!eligible) {
      setScan(null);
      return;
    }

    let cancelled = false;
    tauriAPI.scanner
      .scanDefaults()
      .then((result) => {
        if (!cancelled) setScan(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  const handleApply = async (defaults: SystemDefault[]) => {
    setApplying(true);
    useUiState.getState().setProcessing(true, "apply");

    try {
      const result = await tauriAPI.scanner.applyDefaults(defaults);
      mirrorEvolveState(result.evolveState);
      mirrorChangeMapState(result.changeMap);
      mirrorGitState(result.gitStatus);
      // Invalidate recommended prompt — settings changed
      useWidgetStore.getState().setRecommendedPrompt(undefined);
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      console.error("[SystemDefaultsCTA] apply failed:", msg);
    } finally {
      setApplying(false);
      setOpen(false);
      useUiState.getState().setProcessing(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
    setOpen(false);
  };

  const categories = scan ? groupByCategory(scan.defaults) : new Map<string, SystemDefault[]>();

  if (dismissed) return null;
  if (!eligible) return null;
  if (!scan || scan.defaults.length === 0) return null;

  const count = scan.defaults.length;
  const label = formatUntrackedSettings(count);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <BadgeButton
          icon={Settings2}
          badgeVariant="default"
          data-testid="managed-system-defaults-badge"
        >
          {label}
        </BadgeButton>
      </PopoverTrigger>
      <PopoverContent
        className="w-[340px] p-0"
        align="start"
        data-testid="managed-system-defaults-popover"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="font-medium text-sm">{label}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-muted/60 hover:text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Category list */}
        <div className="max-h-52 overflow-y-auto border-border/50 border-t px-3 py-2">
          {[...categories.entries()].map(([cat, items]) => (
            <div key={cat} className="py-2 first:pt-0 last:pb-0">
              <div className="mb-1 font-medium text-muted-foreground text-xs">
                {cat} ({items.length})
              </div>
              <div className="space-y-0.5">
                {items.map((d) => (
                  <div
                    key={d.nixKey}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate text-foreground/80">
                      {d.label}
                    </span>
                    <span className="ml-2 shrink-0 text-muted-foreground">
                      {formatValue(d.currentValue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 border-border/50 border-t px-3 py-2">
          <button
            type="button"
            data-testid="managed-system-defaults-add-to-config"
            disabled={applying}
            onClick={() => handleApply(scan.defaults)}
            className="w-full rounded-md bg-primary/10 py-1.5 font-medium text-primary text-sm transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            {applying ? "Applying..." : "Add to config"}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="w-full py-1 text-muted-foreground/60 text-xs transition-colors hover:text-muted-foreground"
          >
            Don't track
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
