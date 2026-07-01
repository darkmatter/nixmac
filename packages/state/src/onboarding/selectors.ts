import { onboardingStore } from "./store";
import type { OnboardingStore } from "./store";
import { OnboardingStateValues } from "./types";

/** Subscribe to transient onboarding UI state. */
export const useOnboarding = onboardingStore;

export type OnboardingSelector<T> = (state: OnboardingStore) => T;

export const selectTrackedCustomizations = (state: OnboardingStore) =>
  state.trackedCustomizations;
export const selectTrackedCustomizationSources = (state: OnboardingStateValues) =>
  state.trackedCustomizationSources;
export const selectInferenceDeferred = (state: OnboardingStore) => state.inferenceDeferred;
export const selectCelebrating = (state: OnboardingStore) => state.celebrating;
export const selectViewingStep = (state: OnboardingStore) => state.viewingStep;
