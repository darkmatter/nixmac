import { tauriAPI } from "@/ipc/api";
import { onboardingActions } from "@nixmac/state";

/**
 * Persists durable onboarding progress into `GlobalPreferences`. These facts —
 * unlike the transient onboarding UI store — survive restarts and are what the
 * step machine derives completion from. The backend emits
 * `global_preferences_changed`, which the preferences sync mirrors into the
 * ViewModel, so the flow re-derives automatically after each write.
 */
export function useOnboardingProgress() {
	// The user ran the "scan this Mac" customizations pass (or skipped it from the
	// scan screen). Records when, so the customizations gate stays satisfied.
	const markMacScanned = async () => {
		// If the user navigated backward in the sidebar, resume normal step routing.
		onboardingActions.setViewingStep(null);
		try {
			await tauriAPI.ui.setPrefs({
				onboardingMacScannedAt: Math.floor(Date.now() / 1000),
			});
		} catch (error) {
			console.error("[onboarding] failed to record mac scan:", error);
		}
	};

	// The user logged in or explicitly chose bring-your-own-key. Provider/model
	// are persisted by InferenceSetup itself; this records the login decision.
	const markLoginDecided = async () => {
		// If the user navigated backward in the sidebar, resume normal step routing.
		onboardingActions.setViewingStep(null);
		try {
			await tauriAPI.ui.setPrefs({ onboardingLoginDecided: true });
		} catch (error) {
			console.error("[onboarding] failed to record login decision:", error);
		}
	};

	return { markMacScanned, markLoginDecided };
}
