import { tauriAPI } from "@/ipc/api";
import { useViewModel } from "@/stores/view-model";

export async function refreshHistorySnapshot(): Promise<void> {
  try {
    const items = await tauriAPI.history.get();
    useViewModel.setState({ history: items });
  } catch (error) {
    console.error("[viewmodel] history refresh failed:", error);
  }
}
