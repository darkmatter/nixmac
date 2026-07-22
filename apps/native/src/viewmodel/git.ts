import { ipcRenderer, tauriAPI } from "@/ipc/api";
import type { GitState, GitStatus } from "@/ipc/types";
import { uiActions, viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";
import { invalidateHistory } from "./history";

function mirrorGitState(
  git: GitStatus | null,
  externalBuildDetected = false,
  upstreamUpdateAvailable = false,
  rebuildNeeded = false,
): void {
  viewModelActions.setState((state) => ({
    git,
    build: {
      ...state.build,
      externalBuildDetected,
      upstreamUpdateAvailable,
      rebuildNeeded,
    },
  }));
}

/**
 * Recompute the git status against the live repo and mirror it. The backend
 * command also writes the git-state cell, so the event path stays consistent.
 * Used by flows (rebuild stream, e2e helpers) that mutate the repo and cannot
 * wait for the watcher's poll interval.
 */
export async function refreshGitSnapshot(): Promise<void> {
  // deprecated(orpc): replace with client/orpc from @/lib/orpc
  await tauriAPI.git.statusAndCache();
}

export async function startGitSync(): Promise<() => void> {
  const [stateUnlisten, errorUnlisten] = await Promise.all([
    bindBackendSlice<GitState>({
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      hydrate: () => tauriAPI.git.state(),
      event: "git_state_changed",
      mirror: ({ gitStatus, externalBuildDetected, upstreamUpdateAvailable, rebuildNeeded }) =>
        mirrorGitState(
          gitStatus,
          externalBuildDetected,
          upstreamUpdateAvailable,
          rebuildNeeded,
        ),
      onEvent: () => invalidateHistory(),
    }),
    ipcRenderer.on<string>("git_state_error", (event) => {
      uiActions.setError(event.payload);
    }),
  ]);

  return () => {
    stateUnlisten();
    errorUnlisten();
  };
}
