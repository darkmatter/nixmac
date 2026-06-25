"use client";

import { useCallback, useEffect, useState } from "react";

import { tauriAPI } from "@/ipc/api";
import type { LaunchdItem } from "@/ipc/types";

export function useLaunchdItems(enabled = true) {
  const [items, setItems] = useState<LaunchdItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (isCancelled: () => boolean = () => false) => {
    setError(null);
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      const result = await tauriAPI.launchd.scanLaunchdItems();
      if (!isCancelled()) setItems(result);
    } catch (e: unknown) {
      if (!isCancelled()) setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setItems(null);
      setError(null);
      return;
    }

    let cancelled = false;
    void refresh(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [enabled, refresh]);

  return { items, error, refresh };
}
