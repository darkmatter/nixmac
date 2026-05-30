import { useState, useEffect, useCallback, useRef } from "react";
import { tauriAPI } from "@/ipc/api";
import type { UpdateInfo } from "@/ipc/types";
import { useWidgetStore } from "@/stores/widget-store";

interface UpdateState {
  /** Whether we're currently checking for updates */
  checking: boolean;
  /** Available update (null if none) */
  available: UpdateInfo | null;
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
  const pinnedVersion = useWidgetStore((s) => s.pinnedVersion);
  const updateChannel = useWidgetStore((s) => s.updateChannel);

  const checkForUpdates = useCallback(async () => {
    setState((s) => ({ ...s, checking: true, error: null }));
    try {
      const update = await tauriAPI.updater.checkUpdate();
      if (update) {
        setState((s) => ({
          ...s,
          checking: false,
          available: update,
          version: update.version,
          notes: update.notes ?? null,
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

  const installUpdate = async () => {
    const update = state.available;
    if (!update) return;

    setState((s) => ({ ...s, downloading: true, progress: 0, error: null }));

    try {
      await tauriAPI.updater.installUpdate();
      setState((s) => ({ ...s, progress: 100 }));

      // On macOS the updater swaps the .app bundle on disk; using the
      // custom relaunch_after_update command opens the newly-installed
      // bundle via LaunchServices instead of re-exec-ing the cached
      // (potentially stale) binary path from the old bundle.
      await tauriAPI.updater.relaunch();
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
  };

  const installVersion = useCallback(async (version: string): Promise<void> => {
    await tauriAPI.updater.installVersion(version);
  }, []);

  const relaunch = useCallback(async (): Promise<void> => {
    await tauriAPI.updater.relaunch();
  }, []);

  const clearPinnedVersion = useCallback(async (): Promise<void> => {
    await tauriAPI.updater.clearPinnedVersion();
  }, []);

  const dismiss = () => {
    setState(initialState);
  };

  // Silent check on mount — skipped while a developer pin is active so the app
  // doesn't try to jump back to latest mid-bisect. Wait for prefs to load before
  // deciding, otherwise pinnedVersion is still the store default (null) and the
  // check fires before the actual pin has been hydrated from disk.
  useEffect(() => {
    if (checkedRef.current) return;

    if (pinnedVersion) {
      checkedRef.current = true;
      console.debug("[updater] silent check suppressed (pinned to", pinnedVersion, ")");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const prefs = await tauriAPI.ui.getPrefs();
        if (cancelled || checkedRef.current) return;
        if (prefs?.pinnedVersion) {
          checkedRef.current = true;
          console.debug("[updater] silent check suppressed (pinned to", prefs.pinnedVersion, ")");
          return;
        }
      } catch {
        // If prefs can't be read here, fall back to checking for updates.
      }

      if (cancelled || checkedRef.current) return;
      checkedRef.current = true;
      checkForUpdates();
    })();

    return () => {
      cancelled = true;
    };
  }, [checkForUpdates, pinnedVersion, updateChannel]);

  return {
    ...state,
    checkForUpdates,
    installUpdate,
    installVersion,
    relaunch,
    clearPinnedVersion,
    dismiss,
  };
}
