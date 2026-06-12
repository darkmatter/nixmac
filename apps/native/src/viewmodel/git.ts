import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type { GitState, GitStatus } from "@/ipc/types";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";
import { refreshHistorySnapshot } from "./history";

export function mirrorGitState(git: GitStatus | null, externalBuildDetected = false): void {
  useViewModel.setState((state) => ({
    git,
    build: {
      ...state.build,
      externalBuildDetected,
    },
  }));
}

export async function startGitSync(): Promise<() => void> {
  const [stateUnlisten, errorUnlisten] = await Promise.all([
    bindBackendSlice<GitState>({
      hydrate: async () => ({
        gitStatus: await tauriAPI.git.status(),
        externalBuildDetected: false,
      }),
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
