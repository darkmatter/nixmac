import { ipcRenderer, tauriAPI } from "@/ipc/api";
import type {
  HomebrewInstallDataEvent,
  HomebrewInstallEndEvent,
} from "@/ipc/types";
import { onboardingActions } from "@nixmac/state";

const checkHomebrew = async () => {
  try {
    const result = await tauriAPI.homebrew.check();
    onboardingActions.setHomebrewInstalled(result.installed);
  } catch {
    onboardingActions.setHomebrewInstalled(false);
  }
};

interface InstallOptions {
  onLine?: (line: string) => void;
  onDone?: (ok: boolean, error?: string | null) => void;
}

/**
 * Runs the guided Homebrew install, streaming installer output line-by-line.
 * On completion it re-checks `brew` so the store reflects the real state.
 */
const installHomebrew = async (options: InstallOptions = {}) => {
  const unlistenData = await ipcRenderer.on<HomebrewInstallDataEvent>(
    "homebrew:install:data",
    (event) => {
      for (const line of event.payload.chunk.split("\n")) {
        if (line.trim() !== "") options.onLine?.(line);
      }
    },
  );

  const unlistenEnd = await ipcRenderer.on<HomebrewInstallEndEvent>(
    "homebrew:install:end",
    async (event) => {
      unlistenData();
      unlistenEnd();
      // Re-detect so a successful install flips the store to installed and the
      // onboarding step advances; a failed install leaves it false.
      await checkHomebrew();
      options.onDone?.(event.payload.ok, event.payload.error);
    },
  );

  try {
    await tauriAPI.homebrew.installStream();
  } catch (e) {
    unlistenData();
    unlistenEnd();
    options.onDone?.(false, (e as Error)?.message ?? String(e));
  }
};

export function useHomebrewInstall() {
  return { checkHomebrew, installHomebrew };
}
