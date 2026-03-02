"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWidgetStore } from "@/stores/widget-store";
import type { SystemDefault, SystemDefaultsScan } from "@/tauri-api";
import { darwinAPI } from "@/tauri-api";
import { Monitor } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Shuffle an array using Fisher-Yates and return a new array.
 */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * CTA button that appears below the prompt input when non-default macOS
 * system settings are detected. On click it writes a system-defaults.nix
 * module, creates a git branch + commit, and refreshes the UI.
 *
 * Only visible when:
 * - On main branch with no uncommitted changes
 * - Scan found >0 non-default settings
 * - system-defaults.nix hasn't been applied yet (checked by backend scan)
 */
export function SystemDefaultsCTA() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const [scan, setScan] = useState<SystemDefaultsScan | null>(null);
  const [applying, setApplying] = useState(false);

  // Whether the CTA is eligible to show — on main with no diff.
  const eligible = Boolean(gitStatus?.isMainBranch && !gitStatus?.diff);

  // Re-scan whenever we land on main with a clean working tree.
  // Fires on: initial mount, returning after evolve→clear, and
  // returning after apply→clear. The backend checks if the nix file
  // already exists on disk and returns an empty scan if so.
  // The scan is fast (~90ms) so re-running is fine.
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

    // Suppress watcher events during apply — same pattern as evolve/rollback.
    store.setProcessing(true, "apply");

    try {
      const result = await darwinAPI.scanner.applyDefaults(defaults);

      // Set summary and git status atomically from the response.
      // gitStatus will now have a diff (on the scan branch), so
      // eligible becomes false and the CTA hides naturally.
      store.setSummary(result.summary);
      store.setGitStatus(result.gitStatus);
    } catch (err) {
      console.error("Failed to apply system defaults:", err);
    } finally {
      setApplying(false);
      useWidgetStore.getState().setProcessing(false);
    }
  }, []);

  // Randomised preview for tooltip — stable across re-renders via useMemo
  const tooltipText = useMemo(() => {
    if (!scan || scan.defaults.length === 0) return "";
    const shuffled = shuffle(scan.defaults);
    const labels = shuffled.slice(0, 5).map((d) => d.label);
    const remaining =
      scan.defaults.length > 5 ? `\n...and ${scan.defaults.length - 5} more` : "";
    return labels.join("\n") + remaining;
  }, [scan]);

  // Visibility: on main, no diff, scan found results
  if (!eligible) return null;
  if (!scan || scan.defaults.length === 0) return null;

  const count = scan.defaults.length;

  return (
    <div className="mt-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={applying}
            onClick={() => handleApply(scan.defaults)}
            className="flex w-full items-center gap-2.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
          >
            <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              {applying
                ? "Applying..."
                : `Add your ${count} Mac customization${count === 1 ? "" : "s"}`}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-pre-line">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
