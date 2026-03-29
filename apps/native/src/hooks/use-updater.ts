import { useState, useEffect, useCallback, useRef } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateState {
  /** Whether we're currently checking for updates */
  checking: boolean;
  /** Available update (null if none) */
  available: Update | null;
  /** Version string of the available update */
  version: string | null;
  /** Release notes / changelog */
  notes: string | null;
  /** Whether download+install is in progress */
  downloading: boolean;
  /** Download progress 0–100, null if not downloading */
  progress: number | null;
  /** Error message if something failed */
  error: string | null;
  /** Which phase produced the error */
  errorSource: "check" | "install" | null;
}

const initialState: UpdateState = {
  checking: false,
  available: null,
  version: null,
  notes: null,
  downloading: false,
  progress: null,
  error: null,
  errorSource: null,
};

export function useUpdater() {
  const [state, setState] = useState<UpdateState>(initialState);
  const checkedRef = useRef(false);
  const isDevMode = import.meta.env.DEV;

  const checkForUpdates = useCallback(async () => {
    setState((s) => ({ ...s, checking: true, error: null }));
    try {
      // Dynamic import: if the updater plugin isn't registered (e.g. NIXMAC_DISABLE_UPDATER=1),
      // the import will succeed but check() will throw — which we catch below.
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setState((s) => ({
          ...s,
          checking: false,
          available: update,
          version: update.version,
          notes: update.body ?? null,
        }));
      } else {
        setState((s) => ({ ...s, checking: false }));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isPluginMissing = errMsg.includes("plugin updater not found") ||
                              errMsg.includes("plugin not found");

      if (isDevMode || isPluginMissing) {
        // Suppress errors when the updater plugin isn't registered (NIXMAC_DISABLE_UPDATER=1)
        // or in dev mode where it's always noisy.
        if (isPluginMissing) {
          console.debug("[updater] plugin not registered, skipping update check");
        }
        setState((s) => ({
          ...s,
          checking: false,
          error: null,
          errorSource: null,
        }));
        return;
      }

      console.error("[updater] check failed:", err);
      setState((s) => ({
        ...s,
        checking: false,
        error: err instanceof Error ? err.message : String(err),
        errorSource: "check",
      }));
    }
  }, [isDevMode]);

  const installUpdate = useCallback(async () => {
    const update = state.available;
    if (!update) return;

    setState((s) => ({ ...s, downloading: true, progress: 0, error: null }));

    try {
      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            if (totalBytes > 0) {
              const pct = Math.round((downloadedBytes / totalBytes) * 100);
              setState((s) => ({ ...s, progress: pct }));
            }
            break;
          case "Finished":
            setState((s) => ({ ...s, progress: 100 }));
            break;
        }
      });

      // On macOS the updater swaps the .app bundle on disk; using the
      // custom relaunch_after_update command opens the newly-installed
      // bundle via LaunchServices instead of re-exec-ing the cached
      // (potentially stale) binary path from the old bundle.
      await invoke("relaunch_after_update");
    } catch (err) {
      if (isDevMode) {
        setState((s) => ({
          ...s,
          downloading: false,
          progress: null,
          error: null,
          errorSource: null,
        }));
        return;
      }

      console.error("[updater] install failed:", err);
      setState((s) => ({
        ...s,
        downloading: false,
        progress: null,
        error: err instanceof Error ? err.message : String(err),
        errorSource: "install",
      }));
    }
  }, [isDevMode, state.available]);

  const dismiss = useCallback(() => {
    setState(initialState);
  }, []);

  // Silent check on mount
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    checkForUpdates();
  }, [checkForUpdates]);

  return {
    ...state,
    checkForUpdates,
    installUpdate,
    dismiss,
  };
}
