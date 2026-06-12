import { tauriAPI } from "@/ipc/api";
import { mirrorEvolveState } from "@/viewmodel/evolve";

/** Loads persisted evolve state from backend and syncs to store on startup. */
export async function loadEvolveState() {
  try {
    const evolveState = await tauriAPI.evolveState.get();
    mirrorEvolveState(evolveState);
  } catch {
    // Non-fatal — evolve state defaults to Begin if unavailable.
  }
}
