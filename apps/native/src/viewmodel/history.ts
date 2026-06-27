import { client } from "@/lib/orpc";
import { viewModelActions } from "@nixmac/state";

export async function refreshHistorySnapshot(): Promise<void> {
  try {
    const items = await client.history.get();
    viewModelActions.setState({ history: items });
  } catch (error) {
    console.error("[viewmodel] history refresh failed:", error);
  }
}
