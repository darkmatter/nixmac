/**
 * Simple in-memory cache for preferences
 *
 * IMPORTANT: Removing this will cause the app to ask you for your password over and
 * over proportional to how many api keys you have. Since this happens early in the
 * startup, we don't attempt to store it in the UI store which may require it's own
 * initialization to finish first.
 *
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  OkResult,
  UiPrefs as DarwinPrefs,
  UiPrefsUpdate as DarwinPrefsUpdate,
} from "@/ipc/types";

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
    .then((prefs) => {
      cachedPrefs = prefs;
      return prefs;
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
