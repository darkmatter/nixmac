"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { orpc } from "@/lib/orpc";
import { uiActions } from "@nixmac/state";
import type { HomebrewState } from "@/ipc/types";

// Homebrew scans are cached this long before React Query refetches on mount.
const TWENTY_MINUTES_MS = 20 * 60 * 1000;

export function countDiffItems(diff: HomebrewState): number {
  return diff.casks.length + diff.brews.length + diff.taps.length;
}

export function useHomebrewDiff(enabled = true) {
  const queryClient = useQueryClient();

  const query = useQuery(
    orpc.homebrew.getStateDiff.queryOptions({ enabled, staleTime: TWENTY_MINUTES_MS }),
  );
  const diff = enabled ? (query.data ?? null) : null;

  const {
    mutateAsync: applyStateDiff,
    isPending: isApplying,
    error: applyError,
  } = useMutation(
    orpc.homebrew.applyDiff.mutationOptions({
      onSuccess: () => {
        uiActions.setRecommendedPrompt(undefined);
        queryClient.invalidateQueries({ queryKey: orpc.homebrew.getStateDiff.key() });
      },
    }),
  );

  const applyDiff = useCallback(async () => {
    if (!diff || countDiffItems(diff) === 0) return;
    uiActions.setProcessing(true, "apply");
    try {
      await applyStateDiff({ diff });
    } finally {
      uiActions.setProcessing(false);
    }
  }, [diff, applyStateDiff]);

  const hasDiff = enabled && diff !== null && diff.isInstalled && countDiffItems(diff) > 0;
  const error = query.error
    ? String(query.error)
    : applyError
      ? String(applyError)
      : null;

  return {
    diff,
    hasDiff,
    isLoading: query.isLoading,
    isApplying,
    error,
    refresh: query.refetch,
    applyDiff,
  };
}
