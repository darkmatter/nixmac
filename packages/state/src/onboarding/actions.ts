import type { OnboardingStepId } from "./types";
import { initialOnboardingState, onboardingStore } from "./store";

/**
 * Actions over the transient onboarding UI store. Durable per-step progress
 * (mac scan, login decision, build completion) is persisted to
 * `GlobalPreferences` from the components instead — `packages/state` must not
 * import the oRPC client.
 */
export const onboardingActions = {
  getState: onboardingStore.getState,
  setState: onboardingStore.setState,
  subscribe: onboardingStore.subscribe,
  reset: () => onboardingStore.setState(initialOnboardingState),

  setTrackedCustomizations: (trackedCustomizations: string[]) =>
    onboardingStore.setState({ trackedCustomizations }),
  /** Defer inference to the build step (inline setup runs alongside the build). */
  deferInference: () => onboardingStore.setState({ inferenceDeferred: true }),
  /** Keep the success celebration mounted after the build gate is satisfied. */
  setCelebrating: (celebrating: boolean) => onboardingStore.setState({ celebrating }),
  setViewingStep: (viewingStep: OnboardingStepId | null) =>
    onboardingStore.setState({ viewingStep }),
};
