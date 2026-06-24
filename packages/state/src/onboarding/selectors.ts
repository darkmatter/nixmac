import { onboardingStore } from "./store";
import type { OnboardingStateValues } from "./types";

/** Subscribe to session-local onboarding flow state. */
export const useOnboarding = onboardingStore;

export type OnboardingSelector<T> = (state: OnboardingStateValues) => T;

export const selectOnboardingActive = (state: OnboardingStateValues) => state.active;
export const selectOnboardingCompleted = (state: OnboardingStateValues) => state.completed;
export const selectTrackedCustomizations = (state: OnboardingStateValues) =>
  state.trackedCustomizations;
export const selectCustomizationsReviewed = (state: OnboardingStateValues) =>
  state.customizationsReviewed;
export const selectInference = (state: OnboardingStateValues) => state.inference;
export const selectInferenceSkipped = (state: OnboardingStateValues) => state.inferenceSkipped;
export const selectBuildComplete = (state: OnboardingStateValues) => state.buildComplete;
export const selectViewingStep = (state: OnboardingStateValues) => state.viewingStep;
