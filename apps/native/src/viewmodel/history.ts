import { tauriAPI } from "@/ipc/api";
import { useViewModel } from "@nixmac/state";

export async function refreshHistorySnapshot(): Promise<void> {
  try {
    const items = await tauriAPI.history.get();
    useViewModel.setState({ history: items });
  } catch (error) {
    console.error("[viewmodel] history refresh failed:", error);
  }
}
