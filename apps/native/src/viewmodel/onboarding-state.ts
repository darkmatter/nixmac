import type { OnboardingState } from "@/ipc/types";
import { client } from "@/lib/orpc";
import { viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

export async function startOnboardingStateSync(): Promise<() => void> {
  return bindBackendSlice<OnboardingState>({
    hydrate: () => client.onboarding.getState(),
    event: "onboarding_state_changed",
    mirror: (onboardingState) => viewModelActions.setState({ onboardingState }),
  });
}
