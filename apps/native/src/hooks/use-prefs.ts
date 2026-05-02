import { useWidgetStore, type BoolPrefKey, type ConfirmPrefKey } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";

export function usePrefs() {
  const loadPrefs = async () => {
    const prefs = await darwinAPI.ui.getPrefs().catch(() => null);
    if (prefs) {
      useWidgetStore.getState().initConfirmPrefs(prefs);
      useWidgetStore.getState().setAutoSummarizeOnFocus(prefs.autoSummarizeOnFocus ?? false);
      useWidgetStore
        .getState()
        .setBoolPref("scanHomebrewOnStartup", prefs.scanHomebrewOnStartup ?? true);
      useWidgetStore.getState().setDeveloperMode(prefs.developerMode ?? false);
      useWidgetStore.getState().setPinnedVersion(prefs.pinnedVersion ?? null);
    }
    useWidgetStore.getState().setPrefsLoaded(true);
  };

  const setPref = async (key: BoolPrefKey, value: boolean) => {
    const previous = useWidgetStore.getState()[key];
    useWidgetStore.getState().setBoolPref(key, value);
    try {
      await darwinAPI.ui.setPrefs({ [key]: value });
    } catch {
      useWidgetStore.getState().setBoolPref(key, previous);
    }
  };

  return { loadPrefs, setPref };
}

export type { ConfirmPrefKey, BoolPrefKey };
