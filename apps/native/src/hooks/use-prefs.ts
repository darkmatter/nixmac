import { tauriAPI } from "@/ipc/api";
import { usePrefStore, type BoolPrefKey } from "@/stores/pref-store";

export function usePrefs() {
  const loadPrefs = async () => {
    const prefs = await tauriAPI.ui.getPrefs().catch(() => null);
    if (prefs) {
      usePrefStore.getState().initConfirmPrefs(prefs);
      usePrefStore
        .getState()
        .setAutoSummarizeOnFocus(prefs.autoSummarizeOnFocus ?? false);
      usePrefStore
        .getState()
        .setBoolPref(
          "scanHomebrewOnStartup",
          prefs.scanHomebrewOnStartup ?? true,
        );
      usePrefStore
        .getState()
        .setBoolPref("defaultToDiffTab", prefs.defaultToDiffTab ?? false);
      usePrefStore.getState().setDeveloperMode(prefs.developerMode ?? false);
      usePrefStore.getState().setPinnedVersion(prefs.pinnedVersion ?? null);
      usePrefStore.getState().setUpdateChannel(prefs.updateChannel ?? "stable");
    }
    usePrefStore.getState().setPrefsLoaded(true);
  };

  const setPref = async (key: BoolPrefKey, value: boolean) => {
    const previous = usePrefStore.getState()[key];
    usePrefStore.getState().setBoolPref(key, value);
    try {
      await tauriAPI.ui.setPrefs({ [key]: value });
    } catch {
      usePrefStore.getState().setBoolPref(key, previous);
    }
  };

  return { loadPrefs, setPref };
}
