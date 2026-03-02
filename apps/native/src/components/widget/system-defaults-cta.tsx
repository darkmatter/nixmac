"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useWidgetStore } from "@/stores/widget-store";
import type { SystemDefault, SystemDefaultsScan } from "@/tauri-api";
import { darwinAPI } from "@/tauri-api";
import { Monitor, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

/**
 * Badge + popover for untracked macOS system defaults.
 * Appears in the prompt badge row when non-default settings are detected.
 */
export function SystemDefaultsCTA() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const [scan, setScan] = useState<SystemDefaultsScan | null>(null);
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "true",
  );

  const eligible = Boolean(gitStatus?.isMainBranch && !gitStatus?.diff);

  // Re-scan whenever we land on main with a clean working tree.
  // The backend returns an empty scan if system-defaults.nix already exists.
  useEffect(() => {
    if (!eligible) {
      setScan(null);
      return;
    }

    let cancelled = false;
    darwinAPI.scanner
      .scanDefaults()
      .then((result) => {
        if (!cancelled) setScan(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  const handleApply = useCallback(async (defaults: SystemDefault[]) => {
    const store = useWidgetStore.getState();
    setApplying(true);
    store.setProcessing(true, "apply");

    try {
      const result = await darwinAPI.scanner.applyDefaults(defaults);
      useWidgetStore.getState().setSummary(result.summary);
      useWidgetStore.getState().setGitStatus(result.gitStatus);
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      console.error("[SystemDefaultsCTA] apply failed:", msg);
    } finally {
      setApplying(false);
      setOpen(false);
      useWidgetStore.getState().setProcessing(false);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
    setOpen(false);
  };

  const categories = useMemo(() => {
    if (!scan) return new Map<string, SystemDefault[]>();
    return groupByCategory(scan.defaults);
  }, [scan]);

  if (dismissed) return null;
  if (!eligible) return null;
  if (!scan || scan.defaults.length === 0) return null;

  const count = scan.defaults.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <BadgeButton icon={Monitor} badgeVariant="default">
          {count} untracked customization{count === 1 ? "" : "s"}
        </BadgeButton>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="font-medium text-sm">
            {count} untracked Mac customization{count === 1 ? "" : "s"}
          </span>
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
