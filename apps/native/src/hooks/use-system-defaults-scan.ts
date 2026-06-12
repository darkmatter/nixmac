"use client";

import { useEffect, useState } from "react";

import { tauriAPI } from "@/ipc/api";
import type { SystemDefaultsScan } from "@/ipc/types";

export function useSystemDefaultsScan(enabled = true) {
  const [scan, setScan] = useState<SystemDefaultsScan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setScan(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);
    tauriAPI.scanner
      .scanDefaults()
      .then((result) => {
        if (!cancelled) setScan(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { scan, error };
}
