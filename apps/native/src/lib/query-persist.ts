/**
 * On-disk persistence for the React Query cache.
 *
 * The cache is written to a `tauri-plugin-store` JSON file (real disk, same
 * mechanism as the app's other persisted state) via an {@link AsyncStorage}
 * adapter, so cached server state survives app restarts and is available
 * instantly on next launch before the network round-trips.
 *
 * Persistence is **deny-by-default**: only queries that explicitly opt in with
 * `meta: { persist: true }` are written to disk. This keeps sensitive,
 * fast-moving, or large server state (account/billing snapshots, GitHub repos,
 * build/evolve state) out of the on-disk cache; persist only stable, non-secret
 * reads (e.g. public billing products, docs-like lookups).
 */
import { isE2eProfile, nixmacVersion } from "@/lib/env";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query } from "@tanstack/react-query";
import type {
  AsyncStorage,
  PersistQueryClientOptions,
} from "@tanstack/react-query-persist-client";
import { load, type Store } from "@tauri-apps/plugin-store";

/** Disk file (under the app's data dir) backing the persisted query cache. */
const STORE_FILE = "query-cache.json";

/** Discard persisted cache older than this on restore (also drives `gcTime`). */
export const QUERY_PERSIST_MAX_AGE = 1000 * 60 * 60 * 24; // 24h

/**
 * Lazily-opened Tauri store. `autoSave` debounces disk writes so the frequent
 * `setItem` calls from the persister don't fsync on every keystroke-grade
 * cache mutation.
 */
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { defaults: {}, autoSave: 200 });
  return storePromise;
}

/**
 * `AsyncStorage<string>` over the Tauri store. The persister serializes the
 * dehydrated cache to a single string, so we keep one string value per key.
 *
 * Every method is fail-safe: the on-disk cache is a pure optimization, so a
 * store failure (e.g. running outside a Tauri context, or a corrupt/locked
 * file) must degrade to "no cache", never throw — the persister does not await
 * its own save path, so an unhandled rejection here would surface as a noisy
 * uncaught error during normal cache updates.
 */
const tauriStorage: AsyncStorage<string> = {
  async getItem(key) {
    try {
      const store = await getStore();
      return (await store.get<string>(key)) ?? null;
    } catch (error) {
      console.warn("[query-persist] read failed; ignoring cached state", error);
      return null;
    }
  },
  async setItem(key, value) {
    try {
      const store = await getStore();
      await store.set(key, value);
    } catch (error) {
      console.warn("[query-persist] write failed; cache not persisted", error);
    }
  },
  async removeItem(key) {
    try {
      const store = await getStore();
      await store.delete(key);
    } catch (error) {
      console.warn("[query-persist] delete failed", error);
    }
  },
};

/**
 * Whole-cache persister for `PersistQueryClientProvider`. Disabled under the
 * e2e profile so tests start from a clean, deterministic cache.
 */
export const queryPersister = isE2eProfile
  ? undefined
  : createAsyncStoragePersister({
      storage: tauriStorage,
      key: "nixmac-query-cache",
    });

/**
 * Persist options for `PersistQueryClientProvider`. `buster` is the app
 * version, so a new build transparently discards any incompatible cache shape.
 */
export const queryPersistOptions: Omit<PersistQueryClientOptions, "queryClient"> | undefined =
  queryPersister
    ? {
        persister: queryPersister,
        maxAge: QUERY_PERSIST_MAX_AGE,
        buster: nixmacVersion,
        dehydrateOptions: {
          // Deny-by-default: only `meta.persist === true` queries hit disk.
          shouldDehydrateQuery: (query: Query) =>
            query.state.status === "success" && query.meta?.persist === true,
        },
      }
    : undefined;
