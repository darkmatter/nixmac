import { ipcRenderer, tauriAPI } from "@/ipc/api";
import type { HomebrewInstallDataEvent, HomebrewInstallState } from "@/ipc/types";
import { viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

/** Cap the retained installer output; the pane only ever shows the tail. */
const MAX_LOG_LINES = 500;

function mirrorHomebrewInstallState(next: HomebrewInstallState): void {
  const wasInstalling = viewModelActions.getState().homebrewInstall?.installing ?? false;

  // A new run started: clear the previous run's output so a retry doesn't
  // render stacked on top of the failure that prompted it.
  if (next.installing && !wasInstalling) {
    viewModelActions.setState({ homebrewInstall: next, homebrewLog: [] });
    return;
  }

  viewModelActions.setState({ homebrewInstall: next });
}

function appendLogLines(lines: string[]): void {
  viewModelActions.setState((state) => ({
    homebrewLog: [...state.homebrewLog, ...lines].slice(-MAX_LOG_LINES),
  }));
}

/**
 * Mirrors the backend-owned Homebrew installation cell and folds the installer
 * output stream into the ViewModel.
 *
 * Both live here rather than in the onboarding step's component state so that
 * leaving the step mid-install and returning finds the run — and its log —
 * still intact, and so a single probed value decides whether Homebrew is
 * present.
 */
export async function startHomebrewSync(): Promise<() => void> {
  const [stateUnlisten, dataUnlisten] = await Promise.all([
    bindBackendSlice<HomebrewInstallState>({
      hydrate: () => tauriAPI.homebrew.installState(),
      event: "homebrew_install_state_changed",
      mirror: mirrorHomebrewInstallState,
    }),
    ipcRenderer.on<HomebrewInstallDataEvent>("homebrew:install:data", (event) => {
      const lines = event.payload.chunk.split("\n").filter((line) => line.trim() !== "");
      if (lines.length === 0) return;
      appendLogLines(lines);
    }),
  ]);

  return () => {
    stateUnlisten();
    dataUnlisten();
  };
}
