/**
 * Simple in-memory cache for preferences
 *
 * IMPORTANT: Removing this will cause the app to ask you for your password over and
 * over proportional to how many api keys you have. Since this happens early in the
 * startup, we don't attempt to store it in the UI store which may require it's own
 * initialization to finish first.
 *
 */
import type {
  UiPrefs as DarwinPrefs,
  UiPrefsUpdate as DarwinPrefsUpdate,
  OkResult,
} from "@/ipc/types";
import { migrateLegacyOpenaiProviderPrefs } from "@/lib/providers/ai-provider-migration";
import { invoke } from "@tauri-apps/api/core";

let cachedPrefs: DarwinPrefs | null = null;
let pendingPrefs: Promise<DarwinPrefs> | null = null;

export function getCachedPrefs(): Promise<DarwinPrefs> {
  if (cachedPrefs) {
    return Promise.resolve(cachedPrefs);
  }
  if (pendingPrefs) {
    return pendingPrefs;
  }

  pendingPrefs = invoke<DarwinPrefs>("ui_get_prefs")
    .then(async (prefs) => {
      const migration = migrateLegacyOpenaiProviderPrefs(prefs);
      let nextPrefs = prefs;

      if (migration.update) {
        await invoke<OkResult>("ui_set_prefs", { prefs: migration.update });
        // Model updates are folded into the per-provider maps backend-side;
        // re-read instead of reimplementing that fold on the update payload.
        nextPrefs = await invoke<DarwinPrefs>("ui_get_prefs");
      }

      cachedPrefs = nextPrefs;
      return nextPrefs;
    })
    .finally(() => {
      pendingPrefs = null;
    });
  return pendingPrefs;
}

export async function setPrefs(prefs: Partial<DarwinPrefsUpdate>): Promise<OkResult> {
  const result = await invoke<OkResult>("ui_set_prefs", { prefs });
  cachedPrefs = null;
  pendingPrefs = null;
  return result;
}

/**
 * Folds a backend-emitted `global_preferences_changed` payload into the cache.
 * Frontend `setPrefs` is not the only preferences writer — the backend mutates
 * them too (apply bookkeeping, onboarding reset, settings import) — so without
 * this the cache serves stale values after any backend-initiated write. Only
 * keys already present in the cache are overwritten: the keychain-backed
 * fields the cache exists to protect are absent from the event payload and
 * must survive the merge, which is also why the cache is merged rather than
 * dropped (a refetch would hit the keychain again).
 */
export function refreshCachedPrefs(update: Record<string, unknown>): void {
  if (!cachedPrefs) return;
  const next: Record<string, unknown> = { ...cachedPrefs };
  for (const key of Object.keys(next)) {
    if (key in update) next[key] = update[key];
  }
  cachedPrefs = next as DarwinPrefs;
}
