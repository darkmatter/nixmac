"use client";

import { useCallback, useEffect, useState } from "react";

import { tauriAPI } from "@/ipc/api";
import type { SystemDefaultsScan } from "@/ipc/types";

export function useSystemDefaultsScan(enabled = true) {
  const [scan, setScan] = useState<SystemDefaultsScan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (isCancelled: () => boolean = () => false) => {
    setError(null);
    try {
      const result = await tauriAPI.scanner.scanDefaults();
      if (!isCancelled()) setScan(result);
    } catch (e: unknown) {
      if (!isCancelled()) setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setScan(null);
      setError(null);
      return;
    }

    let cancelled = false;
    void refresh(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [enabled, refresh]);

  return { scan, error, refresh };
}
