"use client";

import { tauriAPI } from "@/ipc/api";
import { uiActions } from "@nixmac/state";
import type { HomebrewState } from "@/ipc/types";
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
    tauriAPI.homebrew
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
    setIsApplying(true);
    uiActions.setProcessing(true, "apply");
    try {
      // The backend records the resulting evolve/change-map/git state in the
      // cells; the `*_changed` events mirror it into the ViewModel.
      await tauriAPI.homebrew.applyDiff(diff);
      uiActions.setRecommendedPrompt(undefined);
      // Clear so we re-fetch on next render (the watcher will also advance the step).
      setDiff(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setIsApplying(false);
      uiActions.setProcessing(false);
    }
  }, [diff]);

  const hasDiff = enabled && diff !== null && diff.isInstalled && hasDiffItems(diff);

  return { diff, hasDiff, isLoading, isApplying, error, refresh, applyDiff };
}
