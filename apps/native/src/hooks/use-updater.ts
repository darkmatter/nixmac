import { useState, useEffect, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

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

  const checkForUpdates = useCallback(async () => {
    setState((s) => ({ ...s, checking: true, error: null }));
    try {
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
      console.error("[updater] check failed:", err);
      setState((s) => ({
        ...s,
        checking: false,
        error: err instanceof Error ? err.message : String(err),
        errorSource: "check",
      }));
    }
  }, []);

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

      // Relaunch the app after install
      await relaunch();
    } catch (err) {
      console.error("[updater] install failed:", err);
      setState((s) => ({
        ...s,
        downloading: false,
        progress: null,
        error: err instanceof Error ? err.message : String(err),
        errorSource: "install",
      }));
    }
  }, [state.available]);

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
