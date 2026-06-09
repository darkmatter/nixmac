import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";

const checkNix = async () => {
  try {
    const result = await tauriAPI.nix.check();
    const store = useWidgetStore.getState();
    store.setNixInstalled(result.installed);
    store.setDarwinRebuildAvailable(result.installed ? result.darwinRebuildAvailable : null);
  } catch {
    useWidgetStore.getState().setNixInstalled(false);
  }
};

export function useNixInstall() {
  return { checkNix };
}
