import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type { GitState, GitStatus } from "@/ipc/types";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";
import { refreshHistorySnapshot } from "./history";

function mirrorGitState(git: GitStatus | null, externalBuildDetected = false): void {
  useViewModel.setState((state) => ({
    git,
    build: {
      ...state.build,
      externalBuildDetected,
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
  const status = await tauriAPI.git.statusAndCache();
  mirrorGitState(status);
}

export async function startGitSync(): Promise<() => void> {
  const [stateUnlisten, errorUnlisten] = await Promise.all([
    bindBackendSlice<GitState>({
      hydrate: () => tauriAPI.git.state(),
      event: "git_state_changed",
      mirror: ({ gitStatus, externalBuildDetected }) =>
        mirrorGitState(gitStatus, externalBuildDetected),
      onEvent: () => void refreshHistorySnapshot(),
    }),
    ipcRenderer.on<string>("git_state_error", (event) => {
      useUiState.getState().setError(event.payload);
    }),
  ]);

  return () => {
    stateUnlisten();
    errorUnlisten();
  };
}
