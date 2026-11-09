import type { SecretsVaultState } from "@/ipc/types";
import { ipcRenderer } from "@/ipc/api";
import { client } from "@/lib/orpc";
import { viewModelActions } from "@nixmac/state";

export async function startSecretsVaultSync(): Promise<() => void> {
  // Subscribe before activating the expensive backend derivation so even a
  // very fast completion cannot be missed between hydration and listening.
  let eventSeenDuringHydration = false;
  const unlisten = await ipcRenderer.on<SecretsVaultState>(
    "secrets_vault_state_changed",
    (event) => {
      eventSeenDuringHydration = true;
      viewModelActions.setState({ secretsVaultState: event.payload });
    },
  );
  try {
    const secretsVaultState = await client.secrets.getState();
    // If activation emitted while the getter was in flight, the event is at
    // least as fresh as the getter response and must not be overwritten by a
    // loading snapshot returned just before evaluation completed.
    if (!eventSeenDuringHydration) {
      viewModelActions.setState({ secretsVaultState });
    }
    return unlisten;
  } catch (error) {
    unlisten();
    viewModelActions.setState({
      secretsVaultState: {
        vault: null,
        activated: true,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return () => {};
  }
}
