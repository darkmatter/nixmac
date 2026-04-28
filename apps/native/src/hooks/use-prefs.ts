import { useWidgetStore, type BoolPrefKey, type ConfirmPrefKey } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";

export function usePrefs() {
  const loadPrefs = async () => {
    const prefs = await darwinAPI.ui.getPrefs();
    if (prefs) {
      useWidgetStore.getState().initConfirmPrefs(prefs);
      useWidgetStore.getState().setAutoSummarizeOnFocus(prefs.autoSummarizeOnFocus ?? false);
    }
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
