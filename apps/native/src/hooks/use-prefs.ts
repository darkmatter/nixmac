import { useWidgetStore, type BoolPrefKey } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";

export function usePrefs() {
  const loadPrefs = async () => {
    const prefs = await tauriAPI.ui.getPrefs().catch(() => null);
    if (prefs) {
      useWidgetStore.getState().initConfirmPrefs(prefs);
      useWidgetStore.getState().setAutoSummarizeOnFocus(prefs.autoSummarizeOnFocus ?? false);
      useWidgetStore
        .getState()
        .setBoolPref("scanHomebrewOnStartup", prefs.scanHomebrewOnStartup ?? true);
      useWidgetStore
        .getState()
        .setBoolPref("defaultToDiffTab", prefs.defaultToDiffTab ?? false);
      useWidgetStore
        .getState()
        .setBoolPref("experimentalSpinningMascot", prefs.experimentalSpinningMascot ?? false);
      useWidgetStore.getState().setDeveloperMode(prefs.developerMode ?? false);
      useWidgetStore.getState().setPinnedVersion(prefs.pinnedVersion ?? null);
      useWidgetStore.getState().setUpdateChannel(prefs.updateChannel ?? "stable");
    }
    useWidgetStore.getState().setPrefsLoaded(true);
  };

  const setPref = async (key: BoolPrefKey, value: boolean) => {
    const previous = useWidgetStore.getState()[key];
    useWidgetStore.getState().setBoolPref(key, value);
    try {
      await tauriAPI.ui.setPrefs({ [key]: value });
    } catch {
      useWidgetStore.getState().setBoolPref(key, previous);
    }
  };

  return { loadPrefs, setPref };
}

;
