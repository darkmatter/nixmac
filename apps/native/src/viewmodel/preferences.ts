import { tauriAPI } from "@/ipc/api";
import { refreshCachedPrefs } from "@/ipc/preferences";
import type { GlobalPreferences } from "@/ipc/types";
import { viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

function mirrorPreferences(preferences: GlobalPreferences): void {
  viewModelActions.setState({ preferences });
  // Keep the UiPrefs read-path cache coherent with backend-initiated writes.
  refreshCachedPrefs(preferences as unknown as Record<string, unknown>);
}

/**
 * Re-list the flake hosts and mirror them into the ViewModel. Hosts are a
 * derived query (no backend change event), refreshed whenever preferences
 * change. On failure the previous hosts are kept.
 */
export async function refreshHostsSnapshot({
  force = false,
}: { force?: boolean } = {}): Promise<void> {
  const state = viewModelActions.getState();
  // Staged-first: an uncommitted onboarding selection is the active config.
  const configDir = state.onboardingState?.stagedConfigDir ?? state.preferences?.configDir;
  if (!force && !configDir) return;
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
