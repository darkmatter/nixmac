import { onboardingActions, uiActions } from "@nixmac/state";
import { tauriAPI } from "@/ipc/api";
import { clearChangeMap } from "@/viewmodel/change-map";
import { clearEvolveEvents } from "@/viewmodel/evolution";
import { clearRebuildLog } from "@/viewmodel/rebuild";

export interface ResetOnboardingOptions {
  reload?: boolean;
}

export interface ResetOnboardingResult {
  ok: true;
  reloaded: boolean;
}

async function resetOnboarding(options: ResetOnboardingOptions = {}): Promise<ResetOnboardingResult> {
  const reload = options.reload ?? true;

  // deprecated(orpc): replace with client/orpc from @/lib/orpc
  await tauriAPI.account.signOut();
  // deprecated(orpc): replace with client/orpc from @/lib/orpc
  await tauriAPI.ui.setPrefs({ developerMode: true });
  // deprecated(orpc): replace with client/orpc from @/lib/orpc
  await tauriAPI.debug.clearTauriState();

  onboardingActions.reset();
  uiActions.clearLogs();
  uiActions.setRebuildPanelDismissed(true);
  uiActions.setConversationalResponse(null);
  uiActions.setCommitMessageSuggestion(null);
  clearEvolveEvents();
  clearChangeMap();
  clearRebuildLog();
  window.localStorage.clear();
  window.sessionStorage.clear();

  if (reload) {
    window.location.reload();
  }

  return { ok: true, reloaded: reload };
}

declare global {
  interface Window {
    __NIXMAC_DEV__?: {
      resetOnboarding: typeof resetOnboarding;
    };
  }
}

window.__NIXMAC_DEV__ = {
  ...(window.__NIXMAC_DEV__ ?? {}),
  resetOnboarding,
};

console.log(`%cWelcome to nixmac dev mode`, "font-weight: 700; color: #7c3aed");
console.log(`Available console utilities:

window.__NIXMAC_DEV__.resetOnboarding()
  Reset local onboarding/account/app state and reload.

window.__NIXMAC_DEV__.resetOnboarding({ reload: false })
  Reset state without reloading, useful for inspecting the cleared stores.

window.__NIXMAC__
window.tauriAPI
  Tauri IPC API surface for manual debugging. Example:
  await window.__NIXMAC__.account.status()

Notes:
- Dev reset clears app/onboarding/account state, localStorage, and sessionStorage.
- Dev reset does not delete files such as ~/.darwin.
- These helpers are installed only in Vite dev builds.`);
