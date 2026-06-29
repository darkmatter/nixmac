import type { EvolveState } from "@/ipc/types";
import { client } from "@/lib/orpc";
import { viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

function mirrorEvolveState(evolve: EvolveState | null): void {
  viewModelActions.setState({ evolve });
}

/**
 * Re-hydrate the evolve slice through `get_evolve_state` (which recomputes the
 * step against the live repo). The observable only emits when the value
 * changes, so the explicit mirror here keeps callers (startup, e2e helpers)
 * deterministic.
 */
export async function refreshEvolveSnapshot(): Promise<void> {
  mirrorEvolveState(await client.evolveState.get());
}

export function startEvolveSync(): Promise<() => void> {
  return bindBackendSlice({
    hydrate: () => client.evolveState.get(),
    event: "evolve_state_changed",
    mirror: mirrorEvolveState,
  });
}
