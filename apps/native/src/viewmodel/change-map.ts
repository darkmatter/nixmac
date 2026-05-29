import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type { SemanticChangeMap } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { refreshHistorySnapshot } from "./history";

export function mirrorChangeMapState(changeMap: SemanticChangeMap | null): void {
  useViewModel.setState({ changeMap });
}

export async function startChangeMapSync(): Promise<() => void> {
  mirrorChangeMapState(await tauriAPI.summarizedChanges.findChangeMap());

  return ipcRenderer.on<SemanticChangeMap>("change_map_changed", (event) => {
    mirrorChangeMapState(event.payload);
    void refreshHistorySnapshot();
  });
}
