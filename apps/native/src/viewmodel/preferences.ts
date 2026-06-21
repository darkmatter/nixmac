import { tauriAPI } from "@/ipc/api";
import type { GlobalPreferences } from "@/ipc/types";
import { useViewModel } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

export function mirrorPreferences(preferences: GlobalPreferences): void {
  useViewModel.setState({ preferences });
}

/**
 * Re-list the flake hosts and mirror them into the ViewModel. Hosts are a
 * derived query (no backend change event), refreshed whenever preferences
 * change. On failure the previous hosts are kept.
 */
export async function refreshHostsSnapshot(): Promise<void> {
  const preferences = useViewModel.getState().preferences;
  if (!preferences?.configDir) return;
  try {
    const hosts = await tauriAPI.flake.listHosts();
    useViewModel.setState({ hosts });
  } catch (error) {
    console.error("[viewmodel] hosts refresh failed:", error);
  }
}

export async function startPreferencesSync(): Promise<() => void> {
  const unlisten = await bindBackendSlice<GlobalPreferences>({
    hydrate: () => tauriAPI.preferences.get(),
    event: "global_preferences_changed",
    mirror: mirrorPreferences,
    onEvent: () => void refreshHostsSnapshot(),
  });
  await refreshHostsSnapshot();
  return unlisten;
}
