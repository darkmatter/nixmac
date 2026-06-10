import { useWidgetStore, type BoolPrefKey } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";
import type { UiPrefs } from "@/ipc/types";
import { getProviderConfigInvalidReason } from "@/lib/ai-provider-validation";

export function hasConfiguredAiProvider(prefs: UiPrefs): boolean {
  const providerPrefs = {
    openrouterApiKey: prefs.openrouterApiKey ?? "",
    openaiApiKey: prefs.openaiApiKey ?? "",
    vllmApiBaseUrl: prefs.vllmApiBaseUrl ?? "",
  };
  const evolveProvider = prefs.evolveProvider ?? "openrouter";
  const summaryProvider = prefs.summaryProvider ?? "openrouter";
  const evolveConfigured =
    getProviderConfigInvalidReason(evolveProvider, providerPrefs, null, prefs.evolveModel) === null;
  const summaryConfigured =
    getProviderConfigInvalidReason(summaryProvider, providerPrefs, null, prefs.summaryModel) ===
    null;

  return evolveConfigured && summaryConfigured;
}

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
      useWidgetStore
        .getState()
        .setAiProviderOnboardingComplete(
          hasConfiguredAiProvider(prefs) || prefs.aiProviderOnboardingSkipped,
        );
    } else {
      // If preferences are temporarily unavailable, avoid trapping users in a setup step
      // whose save/skip actions would depend on the same unavailable preference store.
      useWidgetStore.getState().setAiProviderOnboardingComplete(true);
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
