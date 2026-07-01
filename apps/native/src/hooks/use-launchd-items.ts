"use client";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";

export function useLaunchdItems(enabled = true) {
  const { data, error, refetch } = useQuery(orpc.launchd.scanItems.queryOptions({ enabled }));

  return {
    items: enabled ? (data ?? null) : null,
    error: error ? String(error) : null,
    refresh: refetch,
  };
}
