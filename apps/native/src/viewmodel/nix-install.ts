import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type { NixInstallProgressEvent, NixInstallState } from "@/ipc/types";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";

function mirrorNixInstallState(next: NixInstallState): void {
  const prev = useViewModel.getState().nixInstall;
  useViewModel.setState((state) => ({
    nixInstall: next,
    // Per-tick download progress only makes sense while an install runs.
    nixDownloadProgress: next.installing ? state.nixDownloadProgress : null,
  }));
  // Surface a freshly recorded install/prefetch failure, like the old
  // `nix:install:end` / `nix:darwin-rebuild:end` listeners did.
  if (next.lastError && next.lastError !== prev?.lastError) {
    useUiState.getState().setError(next.lastError);
  }
}

export async function startNixInstallSync(): Promise<() => void> {
  const [stateUnlisten, progressUnlisten] = await Promise.all([
    bindBackendSlice<NixInstallState>({
      hydrate: () => tauriAPI.nix.installState(),
      event: "nix_install_state_changed",
      mirror: mirrorNixInstallState,
    }),
    ipcRenderer.on<NixInstallProgressEvent>("nix:install:progress", (event) => {
      const { downloaded, total } = event.payload;
      if (downloaded != null && total != null) {
        useViewModel.setState({ nixDownloadProgress: { downloaded, total } });
      }
    }),
  ]);

  return () => {
    stateUnlisten();
    progressUnlisten();
  };
}
