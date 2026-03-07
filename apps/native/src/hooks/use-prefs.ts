import { useWidgetStore, type ConfirmPrefKey } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";

export function usePrefs() {
  const loadPrefs = async () => {
    const prefs = await darwinAPI.ui.getPrefs();
    if (prefs) {
      useWidgetStore.getState().initConfirmPrefs(prefs);
    }
  };

  const setPref = async (key: ConfirmPrefKey, value: boolean) => {
    const previous = useWidgetStore.getState()[key];
    useWidgetStore.getState().setConfirmPref(key, value);
    try {
      await darwinAPI.ui.setPrefs({ [key]: value });
    } catch {
      useWidgetStore.getState().setConfirmPref(key, previous);
    }
  };

  return { loadPrefs, setPref };
}
