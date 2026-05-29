import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type { EvolveState } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";

export function mirrorEvolveState(evolve: EvolveState | null): void {
  useViewModel.setState({ evolve });
}

export async function startEvolveSync(): Promise<() => void> {
  mirrorEvolveState(await tauriAPI.evolveState.get());

  return ipcRenderer.on<EvolveState>("evolve_state_changed", (event) => {
    mirrorEvolveState(event.payload);
  });
}
