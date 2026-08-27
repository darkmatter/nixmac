import type { AuthStatus } from "@/ipc/types";
import { orpc } from "@/lib/orpc";
import type { QueryClient } from "@tanstack/react-query";

const accountStatusQueryKey = orpc.account.status.queryOptions({}).queryKey;

/**
 * The frontend projection of Rust-owned account credentials. The snapshot is
 * local and cheap to read, so revalidate whenever a consumer mounts or the app
 * regains focus rather than trusting a potentially stale auth decision.
 */
export function accountStatusQueryOptions(enabled = true) {
  return orpc.account.status.queryOptions({
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
}

export function setCachedAccountStatus(queryClient: QueryClient, status: AuthStatus): void {
  queryClient.setQueryData(accountStatusQueryKey, status);
}

export function invalidateCachedAccountStatus(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: accountStatusQueryKey });
}
