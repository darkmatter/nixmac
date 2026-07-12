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
 * ## Adding a procedure on the Rust side
 *
 * Procedures live in `src-tauri/src/orpc/<area>.rs` and are wired into the router
 * in `src-tauri/src/orpc/mod.rs`. Each area file follows the same shape:
 *
 * 1. **(Optional) Define input/output types.** Derive `Deserialize`, `Serialize`,
 *    and `Type`, and use `#[serde(rename_all = "camelCase")]` so the generated TS
 *    bindings match the rest of the codebase. Put shared output types in
 *    `crate::shared_types`; keep area-private input structs in the area file.
 *
 *    ```rust
 *    #[derive(Debug, Deserialize, Serialize, Type)]
 *    #[serde(rename_all = "camelCase")]
 *    struct RenameRepoInput {
 *        repo_ref: String,
 *        new_name: String,
 *    }
 *    ```
 *
 * 2. **Write the handler.** Signature is `async fn(ctx: OrpcCtx, input: I) -> Result<O, ORPCError>`.
 *    Use `()` for no input/output. Map errors through `helpers::internal_err`
 *    (or a local `*_err` helper) so failures are logged with a stable command tag.
 *
 *    ```rust
 *    async fn rename_repo(
 *        ctx: OrpcCtx,
 *        input: RenameRepoInput,
 *    ) -> Result<(), ORPCError> {
 *        sync::github_rename_repo(&ctx.app, &input.repo_ref, &input.new_name)
 *            .await
 *            .map_err(|e| internal_err("github.renameRepo", e))
 *    }
 *    ```
 *
 * 3. **Register the route** in the area's `routes()` function via the `router!` macro.
 *    Each procedure is `"camelCaseName" => os::<OrpcCtx>()` chained with
 *    `.input(orpc_specta::specta::<InputType>())` and/or
 *    `.output(orpc_specta::specta::<OutputType>())`, then `.handler(fn)`.
 *    Omit `.input()`/`.output()` for `()`. Nest a new area with
 *    `.nest("areaName", area::routes())` in `mod.rs` `build_router()`.
 *
 *    ```rust
 *    pub fn routes() -> Router<OrpcCtx> {
 *        router! {
 *            "renameRepo" => os::<OrpcCtx>()
 *                .input(orpc_specta::specta::<RenameRepoInput>())
 *                .handler(rename_repo),
 *        }
 *    }
 *    ```
 *
 * 4. **Regenerate bindings** so the TS side picks up the new procedure and types:
 *
 *    ```sh
 *    cd apps/native && bun run gen:orpc
 *    ```
 *
 * 5. **Call it from TS** via `client.<area>.<name>(input)` or
 *    `orpc.<area>.<name>.queryOptions({ input })` / `.mutationOptions()`.
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
 * ### Usage example — load GitHub repos when connected
 *
 * ```tsx
 * import { useQuery } from "@tanstack/react-query";
 * import { orpc } from "@/lib/orpc";
 *
 * function RepoList({ enabled }: { enabled: boolean }) {
 *   const { data, isLoading, error, refetch } = useQuery(
 *     orpc.github.listRepos.queryOptions({
 *       // Optional: If the function accepts input, you can pass it here.
 *       input: { owner: "owner", repo: "repo" },
 *       // Optional: If you want to control when the query is executed, e.g. you don't
 *       // want to make the call until some condition is met, you can use this
 *       enabled,
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
  AccountBilling,
  BillingProductInfo,
  PreviewIndicatorState
} from "@/ipc/orpc-bindings";

/** Routes RPC calls through Tauri IPC (`plugin:orpc|handle_rpc`), not HTTP. */
const link = TauriLink();

/** Typed procedure client. Prefer `orpc` + hooks when you want query caching. */
export const client = createORPCClient<Procedures>(link);

/** TanStack Query option builders for every procedure on `client`. */
export const orpc = createTanstackQueryUtils(client);

/**
 * Shared query cache for the app. Pass to `QueryClientProvider` at the root.
 * `staleTime` avoids refetching unchanged data on every mount; `gcTime` matches
 * the on-disk persist `maxAge` (see `query-persist.ts`) so persisted entries are
 * not garbage-collected before they can be restored after a restart.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      gcTime: 1000 * 60 * 60 * 24, // 24h — keep in sync with QUERY_PERSIST_MAX_AGE
    },
  },
});


if (import.meta.env.DEV) {
  // oxlint-disable-next-line no-unused-expressions
  (window as any).__NIXMAC_ORPC__ = {
    client,
    queryUtils: orpc,
    queryClient,
  }
}