"use client";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";

export function useSystemDefaultsScan(enabled = true) {
  const { data, error, refetch } = useQuery(orpc.scanner.scanDefaults.queryOptions({ enabled }));

  return {
    scan: enabled ? (data ?? null) : null,
    error: error ? String(error) : null,
    refresh: refetch,
  };
}
