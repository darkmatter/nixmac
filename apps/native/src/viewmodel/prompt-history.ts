import { tauriAPI } from "@/ipc/api";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";

export function mirrorPromptHistory(promptHistory: string[]): void {
  useViewModel.setState({ promptHistory });
}

export function startPromptHistorySync(): Promise<() => void> {
  return bindBackendSlice<string[]>({
    hydrate: () => tauriAPI.promptHistory.get(),
    event: "prompt_history_changed",
    mirror: mirrorPromptHistory,
  });
}
