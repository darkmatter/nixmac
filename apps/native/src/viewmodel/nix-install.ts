import { tauriAPI } from "@/ipc/api";
import type { NixInstallState } from "@/ipc/types";
import { uiActions, viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

function mirrorNixInstallState(next: NixInstallState): void {
  const prev = viewModelActions.getState().nixInstall;
  viewModelActions.setState({ nixInstall: next });
  // Surface a freshly recorded failure (e.g. a future install/prefetch path).
  if (next.lastError && next.lastError !== prev?.lastError) {
    uiActions.setError(next.lastError);
  }
}

// nix setup is guided externally (no in-app installer), so this slice only
// mirrors the NixInstallState cell — written by `nix_check` — into the
// ViewModel. There is no install-progress stream to fold.
export function startNixInstallSync(): Promise<() => void> {
  return bindBackendSlice<NixInstallState>({
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    hydrate: () => tauriAPI.nix.installState(),
    event: "nix_install_state_changed",
    mirror: mirrorNixInstallState,
  });
}
