import { tauriAPI } from "@/ipc/api";
import type { SemanticChangeMap } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";
import { refreshHistorySnapshot } from "./history";

export function mirrorChangeMapState(changeMap: SemanticChangeMap | null): void {
  useViewModel.setState({ changeMap });
}

export function startChangeMapSync(): Promise<() => void> {
  return bindBackendSlice({
    hydrate: () => tauriAPI.summarizedChanges.findChangeMap(),
    event: "change_map_changed",
    mirror: mirrorChangeMapState,
    onEvent: () => void refreshHistorySnapshot(),
  });
}
