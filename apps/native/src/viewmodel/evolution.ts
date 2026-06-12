import { ipcRenderer } from "@/ipc/api";
import type { EvolveEvent } from "@/ipc/types";
import { EVOLVE_EVENT_CHANNEL } from "@/lib/constants";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";

/** Reset the evolve event stream (debug tooling / e2e reset / cancel). */
export function clearEvolveEvents(): void {
  useViewModel.setState({ evolveEvents: [] });
}

/**
 * Always-on fold over the evolve agent event stream. There is no state to
 * hydrate — the buffer resets itself on each run's `start` event instead of
 * the UI clearing it before invoking.
 */
export function startEvolutionSync(): Promise<() => void> {
  return ipcRenderer.on<EvolveEvent>(EVOLVE_EVENT_CHANNEL, (event) => {
    const payload = event.payload;
    if (!payload) return;

    useViewModel.setState((state) => ({
      evolveEvents:
        payload.eventType === "start" ? [payload] : [...state.evolveEvents, payload],
    }));

    if (payload.raw) {
      useUiState.getState().appendLog(`${payload.raw}\n`);
    }
  });
}
