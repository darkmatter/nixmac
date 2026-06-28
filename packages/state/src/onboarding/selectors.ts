import { onboardingStore } from "./store";
import type { OnboardingStateValues } from "./types";

/** Subscribe to transient onboarding UI state. */
export const useOnboarding = onboardingStore;

export type OnboardingSelector<T> = (state: OnboardingStateValues) => T;

export const selectTrackedCustomizations = (state: OnboardingStateValues) =>
  state.trackedCustomizations;
export const selectInferenceDeferred = (state: OnboardingStateValues) => state.inferenceDeferred;
export const selectCelebrating = (state: OnboardingStateValues) => state.celebrating;
export const selectViewingStep = (state: OnboardingStateValues) => state.viewingStep;
