/**
 * oRPC client for native ↔ Rust IPC.
 *
 * Procedures are defined in Rust (`src-tauri/src/orpc/`) and type-checked end to
 * end. Bindings live in `@/ipc/orpc-bindings` — regenerate after router changes:
 *
 * ```sh
 * bun run gen:orpc
 * ```
 *
 * ## Two ways to call procedures
 *
 * **`client`** — direct async calls (like `invoke`, but typed). Use in event
 * handlers, one-off effects, or anywhere you do not need cached/shared async state.
 *
 * **`orpc`** — TanStack Query helpers built on top of `client`. Use when data
 * should be cached, deduplicated, refetched, or tied to React lifecycle via hooks.
 *
 * ## TanStack Query primer (for `orpc`)
 *
 * A **query** fetches read-only data. TanStack Query keeps the result in a cache
 * keyed by the procedure + input, tracks loading/error state, and can refetch in
 * the background. A **mutation** changes data on the server; you typically
 * invalidate related queries after it succeeds.
 *
 * Wire up the app once (e.g. in `main.tsx`):
 *
 * ```tsx
 * import { QueryClientProvider } from "@tanstack/react-query";
 * import { queryClient } from "@/lib/orpc";
 *
 * <QueryClientProvider client={queryClient}>
 *   <App />
 * </QueryClientProvider>
 * ```
 *
 * ### Query example — load GitHub repos when connected
 *
 * ```tsx
 * import { useQuery } from "@tanstack/react-query";
 * import { orpc } from "@/lib/orpc";
 *
 * function RepoList({ enabled }: { enabled: boolean }) {
 *   const { data, isLoading, error, refetch } = useQuery(
 *     orpc.github.listRepos.queryOptions({
 *       input: undefined,
 *       enabled, // skip the IPC call until the user is connected
 *     }),
 *   );
 *
 *   if (isLoading) return <p>Loading repos…</p>;
 *   if (error) return <p>{error.message}</p>;
 *   return (
 *     <ul>
 *       {data?.map((repo) => (
 *         <li key={`${repo.owner}/${repo.name}`}>{repo.name}</li>
 *       ))}
 *       <button type="button" onClick={() => refetch()}>Refresh</button>
 *     </ul>
 *   );
 * }
 * ```
 *
 * ### Query with input — poll bootstrap status
 *
 * Procedures that take input pass it via `input`. The cache key includes the
 * input, so different `state` values are cached separately.
 *
 * ```tsx
 * import { useQuery } from "@tanstack/react-query";
 * import { orpc } from "@/lib/orpc";
 *
 * useQuery(
 *   orpc.github.bootstrapStatus.queryOptions({
 *     input: { state: bootstrapState },
 *     enabled: bootstrapState !== null,
 *     refetchInterval: 2500, // poll while the browser install is in progress
 *   }),
 * );
 * ```
 *
 * ### Direct call — fire-and-forget or imperative flows
 *
 * When you do not need caching (e.g. opening a URL after starting connect):
 *
 * ```ts
 * import { client } from "@/lib/orpc";
 *
 * const { installUrl, state } = await client.github.connectStart();
 * // or via query utils: await orpc.github.connectStart.call();
 * ```
 *
 * ### Mutation + cache invalidation
 *
 * ```tsx
 * import { useMutation, useQueryClient } from "@tanstack/react-query";
 * import { orpc } from "@/lib/orpc";
 *
 * const queryClient = useQueryClient();
 * const disconnect = useMutation(
 *   orpc.github.disconnect.mutationOptions({
 *     onSuccess: () => {
 *       queryClient.invalidateQueries({ queryKey: orpc.github.key() });
 *     },
 *   }),
 * );
 *
 * disconnect.mutate();
 * ```
 *
 * @see https://orpc.dev/docs/integrations/tanstack-query
 * @see {@link import("@/ipc/orpc-bindings").Procedures} for the full procedure tree
 */
import type { Procedures } from "@/ipc/orpc-bindings";
import { TauriLink } from "@orpc-rs/tauri";
import { createORPCClient } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";

export type {
  AdoptManualChangesResult,
  BuildCheckResult,
  CommitResult,
  Config,
  EvolveCancelResult,
  EvolveState,
  EvolveStep,
  EvolutionState,
  FileDiffContents,
  GithubBootstrapState,
  GithubBootstrapStatus,
  GithubConnectStart,
  GithubRepo,
  GithubStatus,
  HistoryItem,
  OkResult,
  PreviewIndicatorState,
  RebuildStatus,
  RollbackResult,
  SemanticChangeMap,
  SetDirResult,
} from "@/ipc/orpc-bindings";

/** Routes RPC calls through Tauri IPC (`plugin:orpc|handle_rpc`), not HTTP. */
const link = TauriLink();

/** Typed procedure client. Prefer `orpc` + hooks when you want query caching. */
export const client = createORPCClient<Procedures>(link);

/** TanStack Query option builders for every procedure on `client`. */
export const orpc = createTanstackQueryUtils(client);

/**
 * Shared query cache for the app. Pass to `QueryClientProvider` at the root.
 * `staleTime` avoids refetching unchanged data on every mount.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
    },
  },
});
