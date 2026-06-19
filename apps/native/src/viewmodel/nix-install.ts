import { tauriAPI } from "@/ipc/api";
import type { NixInstallState } from "@/ipc/types";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";

function mirrorNixInstallState(next: NixInstallState): void {
  const prev = useViewModel.getState().nixInstall;
  useViewModel.setState({ nixInstall: next });
  // Surface a freshly recorded failure (e.g. a future install/prefetch path).
  if (next.lastError && next.lastError !== prev?.lastError) {
    useUiState.getState().setError(next.lastError);
  }
}

// nix setup is guided externally (no in-app installer), so this slice only
// mirrors the NixInstallState cell — written by `nix_check` — into the
// ViewModel. There is no install-progress stream to fold.
export function startNixInstallSync(): Promise<() => void> {
  return bindBackendSlice<NixInstallState>({
    hydrate: () => tauriAPI.nix.installState(),
    event: "nix_install_state_changed",
    mirror: mirrorNixInstallState,
  });
}
