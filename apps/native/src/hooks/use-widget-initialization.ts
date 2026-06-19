import { refreshEvolveSnapshot } from "@/viewmodel/evolve";

/** Loads persisted evolve state from backend and syncs to store on startup. */
export async function loadEvolveState() {
  try {
    await refreshEvolveSnapshot();
  } catch {
    // Non-fatal — evolve state defaults to Begin if unavailable.
  }
}
