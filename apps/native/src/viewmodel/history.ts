import { orpc, queryClient } from "@/lib/orpc";

/**
 * Invalidate the cached history query so any mounted `useHistoryQuery()` hook
 * refetches its loaded pages.
 *
 * History is server state owned by TanStack Query (`orpc.history.get`), not
 * the ViewModel — backend events (`change_map_changed`, `git_state_changed`)
 * call this instead of mirroring a snapshot into Zustand.
 */
export function invalidateHistory(): void {
  void queryClient.invalidateQueries({ queryKey: orpc.history.key() });
}
