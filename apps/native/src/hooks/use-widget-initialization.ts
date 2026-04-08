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

/** Loads persisted evolve state from backend and syncs to store on startup. */
export async function loadEvolveState() {
  try {
    const evolveState = await darwinAPI.evolveState.get();
    useWidgetStore.getState().setEvolveState(evolveState);
  } catch {
    // Non-fatal — evolve state defaults to Begin if unavailable.
  }
}

/**
 * Loads available hosts from flake and updates store.
 * Silently sets hosts to [] if Nix isn't installed or flake isn't found.
 */
export async function loadHosts() {
  try {
    const hosts = (await darwinAPI.flake.listHosts()) as string[];
    if (Array.isArray(hosts)) {
      useWidgetStore.getState().setHosts(hosts);
    }
  } catch {
    useWidgetStore.getState().setHosts([]);
  }
}
