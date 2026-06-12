import { tauriAPI } from "@/ipc/api";
import type { EvolveState } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";

export function mirrorEvolveState(evolve: EvolveState | null): void {
  useViewModel.setState({ evolve });
}

export function startEvolveSync(): Promise<() => void> {
  return bindBackendSlice({
    hydrate: () => tauriAPI.evolveState.get(),
    event: "evolve_state_changed",
    mirror: mirrorEvolveState,
  });
}
