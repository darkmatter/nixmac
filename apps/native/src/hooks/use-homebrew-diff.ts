"use client";

import { darwinAPI } from "@/tauri-api";
import { useWidgetStore } from "@/stores/widget-store";
import type { HomebrewState } from "@/types/shared";
import { useCallback, useEffect, useState } from "react";

const TWENTY_MINUTES_SECS = 20 * 60;

function hasDiffItems(diff: HomebrewState): boolean {
  return diff.casks.length > 0 || diff.brews.length > 0 || diff.taps.length > 0;
}

function isStale(diff: HomebrewState): boolean {
  const nowSecs = Math.floor(Date.now() / 1000);
  return nowSecs - diff.lastChecked > TWENTY_MINUTES_SECS;
}

export function countDiffItems(diff: HomebrewState): number {
  return diff.casks.length + diff.brews.length + diff.taps.length;
}

export function useHomebrewDiff(enabled = true) {
  const [diff, setDiff] = useState<HomebrewState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    darwinAPI.homebrew
      .getStateDiff()
      .then(setDiff)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setDiff(null);
      setIsLoading(false);
      return;
    }

    if (diff === null || isStale(diff)) {
      refresh();
    }
  }, [diff, enabled, refresh]);

  const applyDiff = useCallback(async () => {
    if (!diff || !hasDiffItems(diff)) return;
    const store = useWidgetStore.getState();
    setIsApplying(true);
    store.setProcessing(true, "apply");
    try {
      const result = await darwinAPI.homebrew.applyDiff(diff);
      store.setEvolveState(result.evolveState);
      store.setChangeMap(result.changeMap);
      store.setSummaryAvailable(
        result.changeMap.groups.length > 0 || result.changeMap.singles.length > 0,
      );
      store.setGitStatus(result.gitStatus);
      store.setRecommendedPrompt(undefined);
      // Clear so we re-fetch on next render (the watcher will also advance the step).
      setDiff(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setIsApplying(false);
      store.setProcessing(false);
    }
  }, [diff]);

  const hasDiff = enabled && diff !== null && diff.isInstalled && hasDiffItems(diff);

  return { diff, hasDiff, isLoading, isApplying, error, refresh, applyDiff };
}
