import { tauriAPI } from "@/ipc/api";
import { viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

export function mirrorPromptHistory(promptHistory: string[]): void {
  viewModelActions.setState({ promptHistory });
}

export function startPromptHistorySync(): Promise<() => void> {
  return bindBackendSlice<string[]>({
    hydrate: () => tauriAPI.promptHistory.get(),
    event: "prompt_history_changed",
    mirror: mirrorPromptHistory,
  });
}
