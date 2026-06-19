import { tauriAPI } from "@/ipc/api";
import type { SemanticChangeMap } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";
import { refreshHistorySnapshot } from "./history";

function mirrorChangeMapState(changeMap: SemanticChangeMap | null): void {
  useViewModel.setState({ changeMap });
}

/** Reset the mirrored change map (debug tooling / e2e reset). */
export function clearChangeMap(): void {
  mirrorChangeMapState(null);
}

export function startChangeMapSync(): Promise<() => void> {
  return bindBackendSlice({
    hydrate: () => tauriAPI.summarizedChanges.getChangeMap(),
    event: "change_map_changed",
    mirror: mirrorChangeMapState,
    onEvent: () => void refreshHistorySnapshot(),
  });
}
