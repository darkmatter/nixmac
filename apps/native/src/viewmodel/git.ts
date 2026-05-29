import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type { GitState, GitStatus } from "@/ipc/types";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
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
  mirrorGitState(await tauriAPI.git.status());

  const [stateUnlisten, errorUnlisten] = await Promise.all([
    ipcRenderer.on<GitState>("git_state_changed", (event) => {
      const { gitStatus, externalBuildDetected } = event.payload;
      mirrorGitState(gitStatus, externalBuildDetected);
      void refreshHistorySnapshot();
    }),
    ipcRenderer.on<string>("git_state_error", (event) => {
      const error = event.payload;
      useUiState.getState().setError(error);
    }),
  ]);

  return () => {
    stateUnlisten();
    errorUnlisten();
  };
}
