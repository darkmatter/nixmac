import type { InferenceConfig } from "../onboarding-types";
import type { OnboardingStepId } from "./types";
import { initialOnboardingState, onboardingStore } from "./store";

export const onboardingActions = {
  getState: onboardingStore.getState,
  setState: onboardingStore.setState,
  subscribe: onboardingStore.subscribe,
  reset: () => onboardingStore.setState(initialOnboardingState),

  setTrackedCustomizations: (trackedCustomizations: string[]) =>
    onboardingStore.setState({ trackedCustomizations }),
  reviewCustomizations: () => onboardingStore.setState({ customizationsReviewed: true }),
  configureInference: (inference: InferenceConfig) =>
    onboardingStore.setState({ inference, inferenceSkipped: false }),
  skipInference: () => onboardingStore.setState({ inferenceSkipped: true }),
  setBuildComplete: (buildComplete: boolean) => onboardingStore.setState({ buildComplete }),
  /** Called when the flake-import step is satisfied, opening the new steps. */
  beginPostSetup: () => onboardingStore.setState({ active: true }),
  complete: () => onboardingStore.setState({ completed: true, active: false }),
  setViewingStep: (viewingStep: OnboardingStepId | null) =>
    onboardingStore.setState({ viewingStep }),
};
