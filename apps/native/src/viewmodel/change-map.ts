import { tauriAPI } from "@/ipc/api";
import type { SemanticChangeMap } from "@/ipc/types";
import { viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";
import { refreshHistorySnapshot } from "./history";

function mirrorChangeMapState(changeMap: SemanticChangeMap | null): void {
  viewModelActions.setState({ changeMap });
}

/** Reset the mirrored change map (debug tooling / e2e reset). */
export function clearChangeMap(): void {
  mirrorChangeMapState(null);
}

export function startChangeMapSync(): Promise<() => void> {
  return bindBackendSlice({
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    hydrate: () => tauriAPI.summarizedChanges.getChangeMap(),
    event: "change_map_changed",
    mirror: mirrorChangeMapState,
    onEvent: () => void refreshHistorySnapshot(),
  });
}
