import type { BoolPrefKey } from "@/types/preferences";
import { tauriAPI } from "@/ipc/api";

export function usePrefs() {
  // Persist the preference; the backend emits `global_preferences_changed`
  // and the preferences sync module mirrors it into the ViewModel.
  const setPref = async (key: BoolPrefKey, value: boolean) => {
    try {
      await tauriAPI.ui.setPrefs({ [key]: value });
    } catch (error) {
      console.error(`[prefs] failed to set ${key}:`, error);
    }
  };

  return { setPref };
}
