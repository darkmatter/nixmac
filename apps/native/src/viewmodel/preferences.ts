import { tauriAPI } from "@/ipc/api";
import type { GlobalPreferences } from "@/ipc/types";
import { viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

export function mirrorPreferences(preferences: GlobalPreferences): void {
  viewModelActions.setState({ preferences });
}

/**
 * Re-list the flake hosts and mirror them into the ViewModel. Hosts are a
 * derived query (no backend change event), refreshed whenever preferences
 * change. On failure the previous hosts are kept.
 */
export async function refreshHostsSnapshot(): Promise<void> {
  const preferences = viewModelActions.getState().preferences;
  if (!preferences?.configDir) return;
  try {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    const hosts = await tauriAPI.flake.listHosts();
    viewModelActions.setState({ hosts });
  } catch (error) {
    console.error("[viewmodel] hosts refresh failed:", error);
  }
}

export async function startPreferencesSync(): Promise<() => void> {
  const unlisten = await bindBackendSlice<GlobalPreferences>({
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    hydrate: () => tauriAPI.preferences.get(),
    event: "global_preferences_changed",
    mirror: mirrorPreferences,
    onEvent: () => void refreshHostsSnapshot(),
  });
  await refreshHostsSnapshot();
  return unlisten;
}
