import { tauriAPI } from "@/ipc/api";
import { viewModelActions } from "@nixmac/state";

export async function refreshHistorySnapshot(): Promise<void> {
  try {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    const items = await tauriAPI.history.get();
    viewModelActions.setState({ history: items });
  } catch (error) {
    console.error("[viewmodel] history refresh failed:", error);
  }
}
