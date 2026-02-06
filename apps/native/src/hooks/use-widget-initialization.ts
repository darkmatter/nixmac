import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";

export type Config = {
  configDir: string;
  hostAttr?: string;
};

/**
 * Loads config from backend and updates store.
 */
export async function loadConfig() {
  const cfg = (await darwinAPI.config.get()) as Config | null;
  if (cfg?.configDir) {
    useWidgetStore.getState().setConfigDir(cfg.configDir);
  }
  if (cfg?.hostAttr) {
    useWidgetStore.getState().setHost(cfg.hostAttr);
  }
}

/**
 * Loads available hosts from flake and updates store.
 */
export async function loadHosts() {
  const hosts = (await darwinAPI.flake.listHosts()) as string[];
  if (Array.isArray(hosts)) {
    useWidgetStore.getState().setHosts(hosts);
  }
}
