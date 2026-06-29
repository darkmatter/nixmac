import type { BoolPrefKey } from "@/types/preferences";
import { getCachedPrefs, setPrefs } from "@/ipc/preferences";

export function usePrefs() {
  // Persist a boolean preference; the backend emits `global_preferences_changed`
  // and the preferences sync module mirrors it into the ViewModel.
  const setPref = async (key: BoolPrefKey, value: boolean) => {
    try {
      await setPrefs({ [key]: value });
    } catch (error) {
      console.error(`[prefs] failed to set ${key}:`, error);
    }
  };

  // Set or clear a single feature-flag override. The backend replaces the
  // entire `featureFlagOverrides` map, so we merge with the current value
  // and send `null` when no overrides remain. Errors propagate to the caller.
  const setFeatureFlagOverride = async (key: string, variant: string | null) => {
    const current = (await getCachedPrefs()).featureFlagOverrides;
    const next = { ...current };
    if (variant === null) {
      delete next[key];
    } else {
      next[key] = variant;
    }
    const merged = Object.keys(next).length > 0 ? next : null;
    await setPrefs({ featureFlagOverrides: merged });
  };

  return { setPref, setFeatureFlagOverride };
}

