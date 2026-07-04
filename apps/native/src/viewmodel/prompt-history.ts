import { tauriAPI } from "@/ipc/api";
import { viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

function mirrorPromptHistory(promptHistory: string[]): void {
  viewModelActions.setState({ promptHistory });
}

export function startPromptHistorySync(): Promise<() => void> {
  return bindBackendSlice<string[]>({
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    hydrate: () => tauriAPI.promptHistory.get(),
    event: "prompt_history_changed",
    mirror: mirrorPromptHistory,
  });
}
